//! MQTT command handler — dispatches POS commands to INPAS/АТОЛ.

use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::QoS;
use tracing::{error, info, warn};

use svf_agent_core::mqtt;

use crate::AgentState;
use crate::atol;
use crate::proto;

/// Handle an incoming MQTT message by routing to the appropriate POS handler.
pub async fn handle_message(state: &AgentState, topic: &str, payload: &[u8]) {
    let parts: Vec<&str> = topic.split('/').collect();
    // Expected: svoefoto/{studio_id}/pos/commands/{command_type}
    if parts.len() < 5 || parts[2] != "pos" || parts[3] != "commands" {
        // Not a POS command — might be config/update/restart
        handle_infra_command(state, topic, parts.as_slice(), payload).await;
        return;
    }

    let command_type = parts[4];

    let result = match command_type {
        "pay" => handle_pay(state, payload).await,
        "refund" => handle_refund(state, payload).await,
        "fiscal" => handle_fiscal(state, payload).await,
        "sbp_generate" => handle_sbp_generate(state, payload).await,
        "sbp_status" => handle_sbp_status(state, payload).await,
        "shift" => handle_shift(state, payload).await,
        "cash_drawer" => handle_cash_drawer(state, payload).await,
        "settlement" => handle_settlement(state, payload).await,
        "receipt_copy" => handle_receipt_copy(state, payload).await,
        _ => {
            warn!(command_type, "Unknown POS command");
            Ok(())
        }
    };

    if let Err(e) = result {
        error!(command_type, error = %e, "POS command handler error");
    }
}

// ── Card payment ──

async fn handle_pay(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosPayCommand::decode(payload)?;
    let tx_id = cmd.transaction_id.clone();

    info!(
        transaction_id = %tx_id,
        amount = cmd.amount_kopecks / 100,
        method = %cmd.payment_method,
        "Processing payment"
    );

    // Check idempotency
    if state.offline_store.was_processed(&tx_id)? {
        info!(transaction_id = %tx_id, "Payment already processed (idempotent)");
        return Ok(());
    }

    // Route based on payment method
    let result = if cmd.payment_method == "sbp" {
        // SBP payment — first generate QR, then poll for status
        let qr = state
            .inpas_client
            .generate_sbp_qr(cmd.amount_kopecks, &cmd.order_id)
            .await;

        if !qr.success {
            publish_transaction_result(
                state,
                &tx_id,
                proto::PosTransactionType::SbpPayment,
                false,
                &qr.error_message,
                "",
                "",
                "",
            )
            .await;
            state.offline_store.mark_processed(&tx_id)?;
            return Ok(());
        }

        // Publish QR result for CRM display
        let qr_result = proto::PosSbpQrResult {
            transaction_id: tx_id.clone(),
            success: true,
            error_message: String::new(),
            qr_data: qr.qr_data,
            qr_image: qr.qr_image_base64.into_bytes(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };
        publish_protobuf(
            state,
            &format!("{}/sbp/qr_result", pos_prefix(state)),
            &qr_result,
        )
        .await;

        // Poll SBP status (up to 5 minutes, every 3 seconds)
        let mut paid = false;
        for _ in 0..100 {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let status = state.inpas_client.check_sbp_status(&cmd.order_id).await;
            if status.paid {
                paid = true;
                break;
            }
        }

        if paid {
            publish_transaction_result(
                state,
                &tx_id,
                proto::PosTransactionType::SbpPayment,
                true,
                "",
                "",
                "",
                "",
            )
            .await;
        } else {
            publish_transaction_result(
                state,
                &tx_id,
                proto::PosTransactionType::SbpPayment,
                false,
                "SBP payment timeout",
                "",
                "",
                "",
            )
            .await;
        }

        state.offline_store.mark_processed(&tx_id)?;
        return Ok(());
    } else {
        // Card payment
        state
            .inpas_client
            .pay(cmd.amount_kopecks, &cmd.order_id, &cmd.description)
            .await
    };

    publish_transaction_result(
        state,
        &tx_id,
        proto::PosTransactionType::CardPayment,
        result.success,
        &result.error_message,
        &result.approval_code,
        &result.rrn,
        &result.card_mask,
    )
    .await;

    state.offline_store.mark_processed(&tx_id)?;
    Ok(())
}

// ── Card refund ──

async fn handle_refund(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosRefundCommand::decode(payload)?;
    let tx_id = cmd.transaction_id.clone();

    info!(
        transaction_id = %tx_id,
        amount = cmd.amount_kopecks / 100,
        original_rrn = %cmd.original_rrn,
        "Processing refund"
    );

    if state.offline_store.was_processed(&tx_id)? {
        return Ok(());
    }

    let result = state
        .inpas_client
        .refund(cmd.amount_kopecks, &cmd.original_rrn)
        .await;

    publish_transaction_result(
        state,
        &tx_id,
        proto::PosTransactionType::CardRefund,
        result.success,
        &result.error_message,
        &result.approval_code,
        &result.rrn,
        &result.card_mask,
    )
    .await;

    state.offline_store.mark_processed(&tx_id)?;
    Ok(())
}

// ── Fiscal receipt ──

async fn handle_fiscal(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosFiscalCommand::decode(payload)?;
    let receipt_id = cmd.receipt_id.clone();

    info!(
        receipt_id = %receipt_id,
        receipt_type = %cmd.receipt_type,
        total = cmd.total_kopecks / 100,
        items = cmd.items.len(),
        "Processing fiscal receipt"
    );

    if state.offline_store.was_processed(&receipt_id)? {
        return Ok(());
    }

    let items: Vec<atol::FiscalItem> = cmd
        .items
        .iter()
        .map(|item| atol::FiscalItem {
            name: item.name.clone(),
            price_kopecks: item.price_kopecks,
            quantity: item.quantity,
            vat_rate: if item.vat_rate.is_empty() {
                "none".into()
            } else {
                item.vat_rate.clone()
            },
            payment_method: if item.payment_method.is_empty() {
                "fullPayment".into()
            } else {
                item.payment_method.clone()
            },
            payment_object: if item.payment_object.is_empty() {
                "commodity".into()
            } else {
                item.payment_object.clone()
            },
            measurement_unit: fiscal_measurement_unit(&item.measurement_unit),
        })
        .collect();

    let fiscal_result = state
        .atol_client
        .fiscal(atol::FiscalRequest {
            receipt_id: receipt_id.clone(),
            receipt_type: cmd.receipt_type.clone(),
            items,
            payment_method: cmd.payment_method.clone(),
            payments: cmd
                .payments
                .iter()
                .map(|payment| atol::FiscalPayment {
                    payment_method: payment.payment_method.clone(),
                    amount_kopecks: payment.amount_kopecks,
                    transaction_id: payment.transaction_id.clone(),
                    approval_code: payment.approval_code.clone(),
                    rrn: payment.rrn.clone(),
                    card_mask: payment.card_mask.clone(),
                    card_info: payment.card_info.clone(),
                })
                .collect(),
            total_kopecks: cmd.total_kopecks,
            cashier: cmd.cashier.clone(),
            cashier_inn: optional_proto_string(&cmd.cashier_inn),
            customer_email: if cmd.customer_email.is_empty() {
                None
            } else {
                Some(cmd.customer_email.clone())
            },
            taxation_type: if cmd.taxation_type.is_empty() {
                None
            } else {
                Some(cmd.taxation_type.clone())
            },
            receipt_print_options: receipt_print_options(cmd.receipt_print_options.as_ref()),
            bank_slip_options: bank_slip_options(cmd.bank_slip_options.as_ref()),
            correction: fiscal_correction_from_command(&cmd),
        })
        .await;

    let tx_type = match cmd.receipt_type.as_str() {
        "refund" => proto::PosTransactionType::FiscalRefund,
        "correction" | "refund_correction" => proto::PosTransactionType::FiscalCorrection,
        _ => proto::PosTransactionType::FiscalSale,
    };

    let result = proto::PosTransactionResult {
        transaction_id: receipt_id.clone(),
        transaction_type: tx_type.into(),
        success: fiscal_result.success,
        error_message: fiscal_result.error_message,
        approval_code: String::new(),
        rrn: String::new(),
        card_mask: String::new(),
        fiscal_number: fiscal_result.fiscal_number,
        fiscal_sign: fiscal_result.fiscal_sign,
        fiscal_receipt_url: fiscal_result.receipt_url,
        sbp_paid: false,
        receipt_data: Vec::new(),
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    publish_protobuf(
        state,
        &format!("{}/transactions/{}/result", pos_prefix(state), receipt_id),
        &result,
    )
    .await;

    state.offline_store.mark_processed(&receipt_id)?;
    Ok(())
}

fn fiscal_measurement_unit(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        "piece".into()
    } else {
        normalized.into()
    }
}

// ── SBP QR Generation ──

async fn handle_sbp_generate(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosSbpGenerateCommand::decode(payload)?;

    info!(
        transaction_id = %cmd.transaction_id,
        amount = cmd.amount_kopecks / 100,
        "Generating SBP QR"
    );

    let result = state
        .inpas_client
        .generate_sbp_qr(cmd.amount_kopecks, &cmd.order_id)
        .await;

    let qr_result = proto::PosSbpQrResult {
        transaction_id: cmd.transaction_id,
        success: result.success,
        error_message: result.error_message,
        qr_data: result.qr_data,
        qr_image: result.qr_image_base64.into_bytes(),
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    publish_protobuf(
        state,
        &format!("{}/sbp/qr_result", pos_prefix(state)),
        &qr_result,
    )
    .await;

    Ok(())
}

// ── SBP Status Check ──

async fn handle_sbp_status(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosSbpStatusCommand::decode(payload)?;

    let status = state.inpas_client.check_sbp_status(&cmd.order_id).await;

    publish_transaction_result(
        state,
        &cmd.transaction_id,
        proto::PosTransactionType::SbpPayment,
        status.paid,
        &status.error_message,
        "",
        "",
        "",
    )
    .await;

    Ok(())
}

// ── Shift management ──

async fn handle_shift(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosShiftCommand::decode(payload)?;

    info!(
        command_id = %cmd.command_id,
        action = %cmd.action,
        cashier = %cmd.cashier,
        "Processing shift command"
    );

    let cashier_inn = optional_proto_string(&cmd.cashier_inn);
    let print_options = shift_print_options(cmd.shift_print_options.as_ref());
    let result = match cmd.action.as_str() {
        "open" => {
            state
                .atol_client
                .open_shift(&cmd.cashier, cashier_inn.as_deref(), print_options.clone())
                .await
        }
        "close" => {
            state
                .atol_client
                .close_shift(&cmd.cashier, cashier_inn.as_deref(), print_options.clone())
                .await
        }
        other => {
            warn!(action = other, "Unknown shift action");
            return Ok(());
        }
    };

    let command_id = cmd.command_id.clone();

    let shift_result = proto::PosShiftResult {
        command_id: cmd.command_id,
        success: result.success,
        error_message: result.error_message,
        action: cmd.action,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    publish_protobuf(
        state,
        &format!("{}/shift/result", pos_prefix(state)),
        &shift_result,
    )
    .await;

    state.offline_store.mark_processed(&command_id)?;
    Ok(())
}

fn optional_proto_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

fn fiscal_correction_from_command(cmd: &proto::PosFiscalCommand) -> Option<atol::FiscalCorrection> {
    if cmd.receipt_type != "correction" && cmd.receipt_type != "refund_correction" {
        return None;
    }

    Some(atol::FiscalCorrection {
        correction_type: optional_proto_string(&cmd.correction_type)
            .unwrap_or_else(|| "self".into()),
        correction_base_date: optional_proto_string(&cmd.correction_base_date).unwrap_or_default(),
        correction_base_number: optional_proto_string(&cmd.correction_base_number)
            .unwrap_or_default(),
        correction_base_name: optional_proto_string(&cmd.correction_base_name).unwrap_or_default(),
    })
}

fn receipt_print_options(
    options: Option<&proto::FiscalReceiptPrintOptions>,
) -> atol::FiscalReceiptPrintOptions {
    let Some(options) = options else {
        return atol::FiscalReceiptPrintOptions::default();
    };

    atol::FiscalReceiptPrintOptions {
        print_receipt: options.print_receipt,
        receipt_copies: options.receipt_copies,
        header_lines: options.header_lines.clone(),
        footer_lines: options.footer_lines.clone(),
        show_cashier: options.show_cashier,
        show_receipt_number: options.show_receipt_number,
        show_order_number: options.show_order_number,
        show_customer: options.show_customer,
    }
}

fn bank_slip_options(options: Option<&proto::BankSlipPrintOptions>) -> atol::BankSlipPrintOptions {
    let Some(options) = options else {
        return atol::BankSlipPrintOptions::default();
    };

    atol::BankSlipPrintOptions {
        print_bank_slip_on_atol: options.print_bank_slip_on_atol,
        bank_slip_copies: options.bank_slip_copies,
        print_merchant_copy: options.print_merchant_copy,
        print_customer_copy: options.print_customer_copy,
        include_rrn: options.include_rrn,
        include_approval_code: options.include_approval_code,
        include_card_mask: options.include_card_mask,
        include_sbp_id: options.include_sbp_id,
        footer_lines: options.footer_lines.clone(),
    }
}

fn shift_print_options(options: Option<&proto::ShiftPrintOptions>) -> atol::ShiftPrintOptions {
    let Some(options) = options else {
        return atol::ShiftPrintOptions::default();
    };

    atol::ShiftPrintOptions {
        print_open_report: options.print_open_report,
        print_close_report: options.print_close_report,
    }
}

// ── Cash drawer ──

async fn handle_cash_drawer(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosCashDrawerCommand::decode(payload)?;
    let command_id = cmd.command_id.clone();

    info!(command_id = %command_id, "Opening cash drawer");

    if state.offline_store.was_processed(&command_id)? {
        info!(command_id = %command_id, "Cash drawer command already processed (idempotent)");
        return Ok(());
    }

    let result = state.atol_client.open_cash_drawer().await;
    publish_transaction_result(
        state,
        &command_id,
        proto::PosTransactionType::CashDrawer,
        result.success,
        &result.error_message,
        "",
        "",
        "",
    )
    .await;

    state.offline_store.mark_processed(&command_id)?;
    Ok(())
}

// ── Bank settlement ──

async fn handle_settlement(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosSettlementCommand::decode(payload)?;
    let tx_id = cmd.transaction_id.clone();

    info!(transaction_id = %tx_id, "Processing bank settlement");

    if state.offline_store.was_processed(&tx_id)? {
        info!(transaction_id = %tx_id, "Bank settlement already processed (idempotent)");
        return Ok(());
    }

    let result = state.inpas_client.settle().await;
    publish_transaction_result_with_receipt(
        state,
        &tx_id,
        proto::PosTransactionType::BankSettlement,
        result.success,
        &result.error_message,
        &result.response_code,
        "",
        "",
        result.report_text.into_bytes(),
    )
    .await;

    state.offline_store.mark_processed(&tx_id)?;
    Ok(())
}

// ── Receipt copy print ──

async fn handle_receipt_copy(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd = proto::PosReceiptCopyCommand::decode(payload)?;
    let command_id = cmd.command_id.clone();
    if command_id.is_empty() {
        anyhow::bail!("receipt_copy command_id is empty");
    }

    info!(
        transaction_id = %command_id,
        receipt_number = %cmd.receipt_number,
        "Processing receipt copy print"
    );

    if state.offline_store.was_processed(&command_id)? {
        info!(transaction_id = %command_id, "Receipt copy print already processed (idempotent)");
        return Ok(());
    }

    let result = state
        .atol_client
        .print_receipt_copy(atol::ReceiptCopyPrintRequest {
            receipt_number: cmd.receipt_number,
            created_at: cmd.created_at,
            lines: cmd
                .lines
                .into_iter()
                .map(|line| atol::ReceiptCopyLine {
                    name: line.name,
                    quantity: line.quantity,
                    amount_kopecks: line.amount_kopecks,
                })
                .collect(),
            payments: cmd
                .payments
                .into_iter()
                .map(|payment| atol::ReceiptCopyPayment {
                    payment_method: payment.payment_method,
                    amount_kopecks: payment.amount_kopecks,
                    approval_code: payment.approval_code,
                    rrn: payment.rrn,
                    card_mask: payment.card_mask,
                })
                .collect(),
            total_kopecks: cmd.total_kopecks,
            cashier: cmd.cashier,
        })
        .await;

    publish_transaction_result(
        state,
        &command_id,
        proto::PosTransactionType::ReceiptCopyPrint,
        result.success,
        &result.error_message,
        "",
        "",
        "",
    )
    .await;

    state.offline_store.mark_processed(&command_id)?;
    Ok(())
}

// ── Infra commands (update, restart, config) ──

async fn handle_infra_command(state: &AgentState, topic: &str, parts: &[&str], payload: &[u8]) {
    if parts.len() < 4 {
        return;
    }

    let command = if parts.len() == 5 && parts[3] == "commands" {
        parts[4]
    } else if parts.len() == 4 {
        parts[3]
    } else {
        return;
    };

    match command {
        "update" => handle_update_command(state, payload).await,
        "restart" => handle_restart_command(state, payload).await,
        "config" => handle_config_update(state, topic, payload).await,
        _ => {}
    }
}

// ── Update Command ──

async fn handle_update_command(state: &AgentState, payload: &[u8]) {
    let cmd = match svf_agent_core::proto::UpdateCommand::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode UpdateCommand: {e}");
            return;
        }
    };

    info!(
        target_version = %cmd.target_version,
        artifact_url = %cmd.artifact_url,
        "Received update command"
    );

    // Report DOWNLOADING
    publish_update_status(
        state,
        &cmd.command_id,
        svf_agent_core::proto::UpdateState::Downloading,
        0,
        "",
    )
    .await;

    // Download and verify artifact
    let dest_dir = std::path::Path::new(&state.config.base.download.temp_dir);
    match svf_agent_core::updater::download_and_verify(
        &state.http_client,
        &cmd.artifact_url,
        &cmd.artifact_hash_sha256,
        cmd.artifact_size_bytes as u64,
        dest_dir,
    )
    .await
    {
        Ok(artifact_path) => {
            publish_update_status(
                state,
                &cmd.command_id,
                svf_agent_core::proto::UpdateState::Verifying,
                50,
                "",
            )
            .await;

            // Install
            publish_update_status(
                state,
                &cmd.command_id,
                svf_agent_core::proto::UpdateState::Installing,
                70,
                "",
            )
            .await;

            match svf_agent_core::updater::install_msi(&artifact_path).await {
                Ok(code) if code == 0 => {
                    publish_update_status(
                        state,
                        &cmd.command_id,
                        svf_agent_core::proto::UpdateState::Completed,
                        100,
                        "",
                    )
                    .await;
                    info!("Update installed successfully, agent will restart");
                }
                Ok(code) => {
                    let msg = format!("MSI install exit code: {code}");
                    publish_update_status(
                        state,
                        &cmd.command_id,
                        svf_agent_core::proto::UpdateState::Failed,
                        0,
                        &msg,
                    )
                    .await;
                }
                Err(e) => {
                    let msg = format!("Install failed: {e}");
                    publish_update_status(
                        state,
                        &cmd.command_id,
                        svf_agent_core::proto::UpdateState::Failed,
                        0,
                        &msg,
                    )
                    .await;
                }
            }
        }
        Err(e) => {
            let msg = format!("Download/verify failed: {e}");
            error!("{msg}");
            publish_update_status(
                state,
                &cmd.command_id,
                svf_agent_core::proto::UpdateState::Failed,
                0,
                &msg,
            )
            .await;
        }
    }
}

// ── Restart Command ──

async fn handle_restart_command(state: &AgentState, payload: &[u8]) {
    let cmd = match svf_agent_core::proto::RestartCommand::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode RestartCommand: {e}");
            return;
        }
    };

    info!(reason = %cmd.reason, delay = cmd.delay_seconds, "Restart requested");

    // Flush any pending offline messages before exit
    match state.offline_store.drain_pending(100) {
        Ok(pending) if !pending.is_empty() => {
            info!(
                count = pending.len(),
                "Flushing offline messages before restart"
            );
            for msg in &pending {
                let qos = if msg.qos >= 1 {
                    QoS::AtLeastOnce
                } else {
                    QoS::AtMostOnce
                };
                let _ = state
                    .mqtt_handle
                    .publish(&msg.topic, qos, false, msg.payload.clone())
                    .await;
            }
        }
        _ => {}
    }

    if cmd.delay_seconds > 0 {
        tokio::time::sleep(Duration::from_secs(cmd.delay_seconds as u64)).await;
    }

    std::process::exit(0);
}

// ── Config Update ──

async fn handle_config_update(state: &AgentState, _topic: &str, payload: &[u8]) {
    let cmd = match svf_agent_core::proto::ConfigUpdate::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode ConfigUpdate: {e}");
            return;
        }
    };

    info!(version = cmd.config_version, "Config update received");

    let config_toml = String::from_utf8_lossy(&cmd.config_toml);

    #[cfg(target_os = "windows")]
    let config_path = std::env::var("ProgramData")
        .map(|pd| format!("{pd}\\SvoePhoto\\pos-config.toml"))
        .unwrap_or_else(|_| "config.toml".into());
    #[cfg(not(target_os = "windows"))]
    let config_path = "/etc/svf-agent/pos-config.toml".to_string();

    let prefix = pos_prefix(state);

    match std::fs::write(&config_path, config_toml.as_ref()) {
        Ok(()) => {
            info!(path = %config_path, version = cmd.config_version, "Config written");

            let ack = svf_agent_core::proto::ConfigAck {
                agent_id: state.config.base.agent.agent_id.clone(),
                applied_version: cmd.config_version,
                success: true,
                error_message: String::new(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            };

            let topic = format!("{prefix}/commands/config_ack");
            let _ = state
                .mqtt_handle
                .publish(&topic, QoS::AtLeastOnce, false, ack.encode_to_vec())
                .await;

            if cmd.restart_required {
                info!("Config requires restart, exiting...");
                tokio::time::sleep(Duration::from_secs(2)).await;
                std::process::exit(0);
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to write config");

            let ack = svf_agent_core::proto::ConfigAck {
                agent_id: state.config.base.agent.agent_id.clone(),
                applied_version: cmd.config_version,
                success: false,
                error_message: format!("Write failed: {e}"),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            };

            let topic = format!("{prefix}/commands/config_ack");
            let _ = state
                .mqtt_handle
                .publish(&topic, QoS::AtLeastOnce, false, ack.encode_to_vec())
                .await;
        }
    }
}

// ── Helpers ──

fn pos_prefix(state: &AgentState) -> String {
    mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    )
}

async fn publish_transaction_result(
    state: &AgentState,
    transaction_id: &str,
    tx_type: proto::PosTransactionType,
    success: bool,
    error_message: &str,
    approval_code: &str,
    rrn: &str,
    card_mask: &str,
) {
    publish_transaction_result_with_receipt(
        state,
        transaction_id,
        tx_type,
        success,
        error_message,
        approval_code,
        rrn,
        card_mask,
        Vec::new(),
    )
    .await;
}

async fn publish_transaction_result_with_receipt(
    state: &AgentState,
    transaction_id: &str,
    tx_type: proto::PosTransactionType,
    success: bool,
    error_message: &str,
    approval_code: &str,
    rrn: &str,
    card_mask: &str,
    receipt_data: Vec<u8>,
) {
    let result = proto::PosTransactionResult {
        transaction_id: transaction_id.to_owned(),
        transaction_type: tx_type.into(),
        success,
        error_message: error_message.to_owned(),
        approval_code: approval_code.to_owned(),
        rrn: rrn.to_owned(),
        card_mask: card_mask.to_owned(),
        fiscal_number: String::new(),
        fiscal_sign: String::new(),
        fiscal_receipt_url: String::new(),
        sbp_paid: success && tx_type == proto::PosTransactionType::SbpPayment,
        receipt_data,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    let topic = format!(
        "{}/transactions/{}/result",
        pos_prefix(state),
        transaction_id
    );

    publish_protobuf(state, &topic, &result).await;
}

/// Publish UpdateStatus to MQTT.
async fn publish_update_status(
    state: &AgentState,
    command_id: &str,
    update_state: svf_agent_core::proto::UpdateState,
    progress: i32,
    error_msg: &str,
) {
    let status = svf_agent_core::proto::UpdateStatus {
        command_id: command_id.to_string(),
        state: update_state.into(),
        progress_percent: progress,
        error_message: error_msg.to_string(),
        new_version: String::new(),
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    let prefix = pos_prefix(state);
    let topic = format!("{prefix}/updates/status");
    let payload = status.encode_to_vec();

    let _ = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload)
        .await;
}

async fn publish_protobuf<M: Message>(state: &AgentState, topic: &str, msg: &M) {
    let mut buf = Vec::with_capacity(msg.encoded_len());
    if let Err(e) = msg.encode(&mut buf) {
        error!(error = %e, "Failed to encode protobuf");
        return;
    }

    if state.mqtt_handle.is_connected().await {
        if let Err(e) = state
            .mqtt_handle
            .publish(topic, QoS::AtLeastOnce, false, buf.clone())
            .await
        {
            warn!(error = %e, "MQTT publish failed, queueing offline");
            let _ = state.offline_store.queue_message(topic, &buf, 1);
        }
    } else {
        let _ = state.offline_store.queue_message(topic, &buf, 1);
    }
}

/// Drain queued messages when MQTT reconnects.
pub async fn run_offline_sync(state: Arc<AgentState>) {
    let interval = Duration::from_secs(10);

    loop {
        tokio::time::sleep(interval).await;

        if !state.mqtt_handle.is_connected().await {
            continue;
        }

        let pending = match state.offline_store.drain_pending(50) {
            Ok(msgs) => msgs,
            Err(e) => {
                error!(error = %e, "Failed to drain offline store");
                continue;
            }
        };

        if pending.is_empty() {
            continue;
        }

        info!(count = pending.len(), "Syncing offline messages");

        for msg in pending {
            let qos = if msg.qos >= 1 {
                QoS::AtLeastOnce
            } else {
                QoS::AtMostOnce
            };

            if let Err(e) = state
                .mqtt_handle
                .publish(&msg.topic, qos, false, msg.payload)
                .await
            {
                warn!(error = %e, topic = %msg.topic, "Failed to sync offline message");
            }
        }
    }
}
