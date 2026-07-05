use prost::Message;
use rumqttc::QoS;
use sqlx::postgres::PgListener;
use std::sync::Arc;
use uuid::Uuid;

use super::BridgeShared;
use crate::infra_proto;
use crate::proto;

/// Continuously listen for PG NOTIFY 'print_jobs_new' + 'pos_transactions_new' and dispatch to MQTT.
/// Reconnects automatically on PG connection loss.
pub async fn run_pg_listener(shared: Arc<BridgeShared>, database_url: &str) {
    loop {
        match run_pg_listener_inner(&shared, database_url).await {
            Ok(()) => {
                tracing::info!("PG listener exited");
                return;
            }
            Err(e) => {
                tracing::error!("PG listener error: {e}, reconnecting in 5s...");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn run_pg_listener_inner(
    shared: &Arc<BridgeShared>,
    database_url: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut listener = PgListener::connect(database_url).await?;
    listener.listen("print_jobs_new").await?;
    listener.listen("pos_transactions_new").await?;
    tracing::info!("PG LISTEN 'print_jobs_new' + 'pos_transactions_new' active");

    loop {
        let notification = listener.recv().await?;
        let channel = notification.channel();
        let payload = notification.payload();

        let result = match channel {
            "pos_transactions_new" => handle_pos_notification(shared, payload).await,
            _ => handle_notification(shared, payload).await,
        };

        if let Err(e) = result {
            tracing::error!(channel, "Failed to handle notification: {e}");
        }
    }
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct NotifyPayload {
    id: Uuid,
    printer_id: Uuid,
    studio_id: Option<Uuid>,
    status: String,
}

async fn handle_notification(
    shared: &BridgeShared,
    payload: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // NOTIFY triggers processing, but we always claim the highest-priority queued job
    let _notify: NotifyPayload = serde_json::from_str(payload)?;

    // Retry with backoff: PG NOTIFY arrives after COMMIT, but the row may not be
    // visible to other pool connections yet (PgBouncer transaction mode delay).
    let claim_sql = r#"WITH next_job AS (
             SELECT pj.id FROM print_jobs pj
             JOIN printers p ON p.id = pj.printer_id
             WHERE pj.status = 'queued'
               AND COALESCE(p.queue_paused, FALSE) = FALSE
               AND p.is_active = TRUE
               AND (pj.child_count IS NULL OR pj.child_count = 0)
             ORDER BY pj.priority DESC, pj.created_at ASC
             LIMIT 1
             FOR UPDATE OF pj SKIP LOCKED
           )
           UPDATE print_jobs pj SET status = 'sending'
           FROM next_job
           WHERE pj.id = next_job.id
           RETURNING pj.id, pj.printer_id, pj.file_url, pj.file_name,
                     pj.copies, pj.paper_size, pj.color_mode, pj.quality,
                     pj.duplex, pj.orientation, pj.borderless, pj.media_type,
                     pj.fit_mode, pj.studio_id,
                     pj.service_slug, pj.document_template_slug,
                     pj.icc_profile_id, pj.cut_marks,
                     pj.cut_mark_length_mm, pj.cut_mark_offset_mm,
                     pj.layout_rows, pj.layout_cols, pj.cut_margin_mm,
                     pj.custom_photo_width_mm, pj.custom_photo_height_mm,
                     pj.rendering_intent,
                     pj.paper_source,
                     (SELECT cups_printer_name FROM printers WHERE id = pj.printer_id) AS cups_printer_name,
                     (SELECT studio_id FROM printers WHERE id = pj.printer_id) AS printer_studio_id,
                     pj.finishing_options,
                     pj.mirror, pj.rotation,
                     pj.crop_x, pj.crop_y, pj.crop_width, pj.crop_height,
                     pj.photo_enhance, pj.brightness, pj.contrast, pj.saturation,
                     pj.watermark_text, pj.watermark_opacity, pj.watermark_position,
                     pj.banner_page,
                     pj.nup, pj."collate", pj.resolution_dpi, pj.color_auto_detect,
                     pj.booklet, pj.pages_per_sheet, pj.binding, pj.staple_position,
                     pj.hole_punch, pj.hole_punch_type, pj.duplex_mode, pj.scaling_percent,
                     pj.output_bin, pj.toner_save, pj.department_id, pj.secure_pin,
                     pj.gray_mode"#;

    let delays_ms = [0, 100, 300, 700];
    let mut job = None;
    for (attempt, &delay) in delays_ms.iter().enumerate() {
        if delay > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        }
        match sqlx::query_as::<_, JobForPublish>(claim_sql)
            .fetch_optional(&shared.db)
            .await?
        {
            Some(j) => {
                job = Some(j);
                break;
            }
            None if attempt < delays_ms.len() - 1 => {
                tracing::debug!(
                    attempt = attempt + 1,
                    next_delay_ms = delays_ms.get(attempt + 1).unwrap_or(&0),
                    "No queued job, retrying (NOTIFY race)"
                );
            }
            None => {}
        }
    }

    let Some(job) = job else {
        tracing::debug!("No queued jobs after {} retries", delays_ms.len());
        return Ok(());
    };

    // ── CUPS direct print branch ──
    // If CUPS_ENABLED and printer has cups_printer_name, handle locally without MQTT agent
    let cups_enabled = std::env::var("CUPS_ENABLED")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if cups_enabled
        && job.cups_printer_name.is_some()
        && !job.cups_printer_name.as_deref().unwrap_or("").is_empty()
    {
        let studio_id = match job.studio_id.or(job.printer_studio_id) {
            Some(sid) => sid,
            None => {
                fail_job(&shared.db, job.id, "Не найдена студия для задания").await;
                return Ok(());
            }
        };

        let db = shared.db.clone();
        let redis = shared.redis.clone();
        let config = shared.config.clone();
        let cups_printer = job.cups_printer_name.clone().unwrap_or_default();

        tracing::info!(
            job_id = %job.id,
            printer = %cups_printer,
            "Routing job to CUPS (direct print)"
        );

        tokio::spawn(async move {
            crate::cups::executor::execute_cups_job(
                db,
                redis,
                config,
                job.id,
                studio_id,
                job.file_url.clone(),
                job.file_name.clone(),
                cups_printer,
                job.copies,
                job.paper_size.clone(),
                job.color_mode.clone(),
                job.quality.clone(),
                job.duplex,
                job.booklet,
                job.pages_per_sheet,
                job.duplex_mode.clone(),
                job.orientation.clone(),
                job.borderless,
                job.media_type.clone(),
                job.paper_source.clone(),
                job.fit_mode.clone(),
                job.document_template_slug.clone(),
                job.mirror,
                job.rotation,
                job.crop_x,
                job.crop_y,
                job.crop_width,
                job.crop_height,
                job.layout_rows,
                job.layout_cols,
                job.custom_photo_width_mm,
                job.custom_photo_height_mm,
                job.cut_marks,
                job.cut_margin_mm,
                job.cut_mark_length_mm,
                job.cut_mark_offset_mm,
                job.photo_enhance,
                job.brightness,
                job.contrast,
                job.saturation,
                job.resolution_dpi,
            )
            .await;
        });

        return Ok(());
    }

    // Resolve studio_id (job → printer fallback)
    let studio_id = match job.studio_id.or(job.printer_studio_id) {
        Some(sid) => sid,
        None => {
            fail_job(&shared.db, job.id, "Не найдена студия для задания").await;
            return Ok(());
        }
    };

    // Resolve CUPS printer name
    let printer_name = job.cups_printer_name.as_deref().unwrap_or_default();

    if printer_name.is_empty() {
        fail_job(&shared.db, job.id, "Принтер не найден или не настроен").await;
        return Ok(());
    }

    // Resolve ICC profile S3 key
    let icc_profile_key = match job.icc_profile_id {
        Some(icc_id) => sqlx::query_scalar::<_, String>(
            "SELECT file_key FROM icc_profiles WHERE id = $1 AND is_active = TRUE",
        )
        .bind(icc_id)
        .fetch_optional(&shared.db)
        .await?
        .unwrap_or_default(),
        None => String::new(),
    };

    // Build Protobuf PrintCommand
    let command = proto::PrintCommand {
        job_id: job.id.to_string(),
        printer_id: printer_name.to_string(), // Windows/CUPS printer name (not UUID) — agent resolves by name
        command_type: proto::CommandType::Print as i32,
        file_url: job.file_url.clone(),
        file_name: job.file_name.clone().unwrap_or_default(),
        copies: job.copies,
        paper_size: job.paper_size.clone(),
        color_mode: match job.color_mode.as_str() {
            "bw" => proto::ColorMode::Bw as i32,
            _ => proto::ColorMode::Color as i32,
        },
        quality: job.quality.clone(),
        duplex: job.duplex,
        orientation: match job.orientation.as_str() {
            "portrait" => proto::Orientation::Portrait as i32,
            "landscape" => proto::Orientation::Landscape as i32,
            _ => proto::Orientation::Auto as i32,
        },
        borderless: job.borderless,
        media_type: job.media_type.clone().unwrap_or_default(),
        fit_mode: match job.fit_mode.as_str() {
            "fill" => proto::FitMode::Fill as i32,
            "stretch" => proto::FitMode::Stretch as i32,
            "actual" => proto::FitMode::Actual as i32,
            _ => proto::FitMode::Fit as i32,
        },
        icc_profile_key,
        layout: if job.layout_rows.unwrap_or(1) > 1
            || job.layout_cols.unwrap_or(1) > 1
            || job.cut_marks.unwrap_or(false)
        {
            Some(proto::LayoutSettings {
                rows: job.layout_rows.unwrap_or(1),
                cols: job.layout_cols.unwrap_or(1),
                cut_margin_mm: job.cut_margin_mm.unwrap_or(1.0) as f32,
                cut_marks: job.cut_marks.unwrap_or(false),
                cut_mark_length_mm: job.cut_mark_length_mm.unwrap_or(5.0) as f32,
                cut_mark_offset_mm: job.cut_mark_offset_mm.unwrap_or(2.0) as f32,
            })
        } else {
            None
        },
        service_slug: job.service_slug.clone().unwrap_or_default(),
        document_template_slug: job.document_template_slug.clone().unwrap_or_default(),
        idempotency_key: job.id.to_string(),
        rendering_intent: match job.rendering_intent.as_deref().unwrap_or("perceptual") {
            "relative_colorimetric" => proto::RenderingIntent::RelativeColorimetric as i32,
            "saturation" => proto::RenderingIntent::Saturation as i32,
            "absolute_colorimetric" => proto::RenderingIntent::AbsoluteColorimetric as i32,
            _ => proto::RenderingIntent::Perceptual as i32,
        },
        paper_source: job.paper_source.clone().unwrap_or_default(),
        finishing: None,
        collate: job.collate.unwrap_or(true),
        nup: job.nup.unwrap_or(1),
        binding: job.binding.clone().unwrap_or_default(),
        staple_position: job.staple_position.clone().unwrap_or_default(),
        hole_punch: job.hole_punch.clone().unwrap_or_default(),
        hole_punch_type: job.hole_punch_type.clone().unwrap_or_default(),
        resolution_dpi: job.resolution_dpi.unwrap_or(0),
        color_auto_detect: job.color_auto_detect.unwrap_or(false),
        stapleless_position: String::new(),
        resolution: String::new(),
        color_management: String::new(),
        pages_per_sheet: job.pages_per_sheet.unwrap_or(0),
        booklet: job.booklet.unwrap_or(false),
        red_eye_fix: false,
        bidirectional: false,
        quiet_mode: false,
        staple: String::new(),
        // Copy center features (Canon C3226i) — from dedicated columns
        duplex_mode: job.duplex_mode.clone().unwrap_or_default(),
        scaling_percent: job.scaling_percent.unwrap_or(0),
        output_bin: job.output_bin.clone().unwrap_or_default(),
        toner_save: job.toner_save.clone().unwrap_or_else(|| "off".into()),
        department_id: job.department_id.clone().unwrap_or_default(),
        secure_pin: job.secure_pin.clone().unwrap_or_default(),
        gray_mode: job.gray_mode.clone().unwrap_or_default(),
        // Mirror and rotation
        mirror: job.mirror.unwrap_or(false),
        rotation_degrees: job.rotation.unwrap_or(0) as i32,
        // Crop region
        crop_x: job.crop_x.unwrap_or(0.0),
        crop_y: job.crop_y.unwrap_or(0.0),
        crop_width: job.crop_width.unwrap_or(0.0),
        crop_height: job.crop_height.unwrap_or(0.0),
        // Watermark
        watermark_text: job.watermark_text.clone().unwrap_or_default(),
        watermark_opacity: job.watermark_opacity.unwrap_or(0.3),
        watermark_position: job
            .watermark_position
            .clone()
            .unwrap_or_else(|| "center".into()),
        // Banner page
        banner_page: job.banner_page.unwrap_or(false),
        // Page ranges for source documents are handled in conversion_tasks before raster jobs are queued.
        page_range: Vec::new(),
    };

    // Encode Protobuf
    let mut buf = Vec::with_capacity(command.encoded_len());
    command.encode(&mut buf)?;

    // Publish to MQTT
    let topic = format!("svoefoto/{studio_id}/print/commands/print");
    tracing::info!(
        job_id = %job.id,
        studio_id = %studio_id,
        printer = %printer_name,
        %topic,
        payload_bytes = buf.len(),
        "Publishing print command to MQTT..."
    );
    match shared
        .client
        .publish(&topic, QoS::AtLeastOnce, false, buf)
        .await
    {
        Ok(()) => {
            tracing::info!(job_id = %job.id, "✅ Print command published OK");
        }
        Err(e) => {
            tracing::error!(job_id = %job.id, error = %e, "❌ MQTT publish FAILED");
            fail_job(&shared.db, job.id, &format!("MQTT publish failed: {e}")).await;
            return Ok(());
        }
    }

    // Notify CRM via Redis
    publish_redis_job_update(shared, job.id, "sending", None, studio_id).await;

    Ok(())
}

async fn fail_job(db: &sqlx::PgPool, job_id: Uuid, error: &str) {
    let result = sqlx::query(
        "UPDATE print_jobs SET status = 'failed', error_message = $2, completed_at = NOW()
         WHERE id = $1",
    )
    .bind(job_id)
    .bind(error)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::error!(job_id = %job_id, "Failed to mark job as failed: {e}");
    } else {
        tracing::warn!(job_id = %job_id, error = error, "Job failed");
    }
}

/// Publish job status update to Redis for Socket.IO relay.
pub async fn publish_redis_job_update(
    shared: &BridgeShared,
    job_id: Uuid,
    status: &str,
    error: Option<&str>,
    studio_id: Uuid,
) {
    let payload = serde_json::json!({
        "job_id": job_id,
        "status": status,
        "error": error,
        "studio_id": studio_id,
    });

    let mut conn = shared.redis.clone();
    if let Err(e) = redis::cmd("PUBLISH")
        .arg("print:job_update")
        .arg(payload.to_string())
        .query_async::<()>(&mut conn)
        .await
    {
        tracing::warn!("Redis publish (print:job_update) failed: {e}");
    }
}

// ── Phase 5: POS transaction dispatch ──

#[allow(dead_code)]
#[derive(serde::Deserialize)]
struct PosNotifyPayload {
    id: Uuid,
    studio_id: Uuid,
    agent_id: Option<Uuid>,
    transaction_type: String,
    #[allow(dead_code)]
    amount: Option<f64>,
    status: String,
}

#[derive(Clone, Debug)]
struct ReceiptPrintSettingsForPublish {
    print_receipt: bool,
    receipt_copies: u32,
    header_lines: Vec<String>,
    footer_lines: Vec<String>,
    show_cashier: bool,
    show_receipt_number: bool,
    show_order_number: bool,
    show_customer: bool,
    cashier_inn: Option<String>,
}

#[derive(Clone, Debug)]
struct BankSlipSettingsForPublish {
    print_bank_slip_on_atol: bool,
    bank_slip_copies: u32,
    print_merchant_copy: bool,
    print_customer_copy: bool,
    include_rrn: bool,
    include_approval_code: bool,
    include_card_mask: bool,
    include_sbp_id: bool,
    footer_lines: Vec<String>,
}

#[derive(Clone, Debug)]
struct ShiftPrintSettingsForPublish {
    auto_open_before_card_sbp: bool,
    auto_close_on_last_pos_shift_close: bool,
    print_open_report: bool,
    print_close_report: bool,
}

#[derive(Clone, Debug)]
struct PosFiscalSettingsForPublish {
    receipt: ReceiptPrintSettingsForPublish,
    slip: BankSlipSettingsForPublish,
    shift: ShiftPrintSettingsForPublish,
}

#[derive(sqlx::FromRow)]
struct PosFiscalSettingsForPublishRow {
    receipt_settings: serde_json::Value,
    slip_settings: serde_json::Value,
    shift_settings: serde_json::Value,
}

impl PosFiscalSettingsForPublish {
    fn cashier_inn(&self) -> String {
        self.receipt.cashier_inn.clone().unwrap_or_default()
    }

    fn receipt_proto(&self) -> infra_proto::FiscalReceiptPrintOptions {
        infra_proto::FiscalReceiptPrintOptions {
            print_receipt: self.receipt.print_receipt,
            receipt_copies: self.receipt.receipt_copies,
            header_lines: self.receipt.header_lines.clone(),
            footer_lines: self.receipt.footer_lines.clone(),
            show_cashier: self.receipt.show_cashier,
            show_receipt_number: self.receipt.show_receipt_number,
            show_order_number: self.receipt.show_order_number,
            show_customer: self.receipt.show_customer,
        }
    }

    fn slip_proto(&self) -> infra_proto::BankSlipPrintOptions {
        infra_proto::BankSlipPrintOptions {
            print_bank_slip_on_atol: self.slip.print_bank_slip_on_atol,
            bank_slip_copies: self.slip.bank_slip_copies,
            print_merchant_copy: self.slip.print_merchant_copy,
            print_customer_copy: self.slip.print_customer_copy,
            include_rrn: self.slip.include_rrn,
            include_approval_code: self.slip.include_approval_code,
            include_card_mask: self.slip.include_card_mask,
            include_sbp_id: self.slip.include_sbp_id,
            footer_lines: self.slip.footer_lines.clone(),
        }
    }

    fn shift_proto(&self) -> infra_proto::ShiftPrintOptions {
        infra_proto::ShiftPrintOptions {
            print_open_report: self.shift.print_open_report,
            print_close_report: self.shift.print_close_report,
        }
    }

    fn audit_payload(&self) -> serde_json::Value {
        serde_json::json!({
            "receipt": {
                "print_receipt": self.receipt.print_receipt,
                "receipt_copies": self.receipt.receipt_copies,
                "header_lines": self.receipt.header_lines,
                "footer_lines": self.receipt.footer_lines,
                "show_cashier": self.receipt.show_cashier,
                "show_receipt_number": self.receipt.show_receipt_number,
                "show_order_number": self.receipt.show_order_number,
                "show_customer": self.receipt.show_customer,
                "cashier_inn": self.receipt.cashier_inn,
            },
            "slip": {
                "print_bank_slip_on_atol": self.slip.print_bank_slip_on_atol,
                "bank_slip_copies": self.slip.bank_slip_copies,
                "print_merchant_copy": self.slip.print_merchant_copy,
                "print_customer_copy": self.slip.print_customer_copy,
                "include_rrn": self.slip.include_rrn,
                "include_approval_code": self.slip.include_approval_code,
                "include_card_mask": self.slip.include_card_mask,
                "include_sbp_id": self.slip.include_sbp_id,
                "footer_lines": self.slip.footer_lines,
            },
            "shift": {
                "auto_open_before_card_sbp": self.shift.auto_open_before_card_sbp,
                "auto_close_on_last_pos_shift_close": self.shift.auto_close_on_last_pos_shift_close,
                "print_open_report": self.shift.print_open_report,
                "print_close_report": self.shift.print_close_report,
            },
        })
    }
}

async fn fiscal_settings_for_studio(
    shared: &BridgeShared,
    studio_id: Uuid,
) -> Result<PosFiscalSettingsForPublish, sqlx::Error> {
    let row = sqlx::query_as::<_, PosFiscalSettingsForPublishRow>(
        r#"SELECT receipt_settings, slip_settings, shift_settings
           FROM pos_fiscal_settings
           WHERE studio_id = $1 AND enabled = TRUE"#,
    )
    .bind(studio_id)
    .fetch_optional(&shared.db)
    .await?;

    Ok(normalize_fiscal_settings_for_publish(row))
}

fn normalize_fiscal_settings_for_publish(
    row: Option<PosFiscalSettingsForPublishRow>,
) -> PosFiscalSettingsForPublish {
    let receipt_json = row
        .as_ref()
        .map(|r| &r.receipt_settings)
        .unwrap_or(&serde_json::Value::Null);
    let slip_json = row
        .as_ref()
        .map(|r| &r.slip_settings)
        .unwrap_or(&serde_json::Value::Null);
    let shift_json = row
        .as_ref()
        .map(|r| &r.shift_settings)
        .unwrap_or(&serde_json::Value::Null);

    PosFiscalSettingsForPublish {
        receipt: ReceiptPrintSettingsForPublish {
            print_receipt: json_bool(receipt_json, "print_receipt", true),
            receipt_copies: json_copy_count(receipt_json, "receipt_copies", 1),
            header_lines: json_lines(receipt_json, "header_lines"),
            footer_lines: json_lines(receipt_json, "footer_lines"),
            show_cashier: json_bool(receipt_json, "show_cashier", true),
            show_receipt_number: json_bool(receipt_json, "show_receipt_number", true),
            show_order_number: json_bool(receipt_json, "show_order_number", true),
            show_customer: json_bool(receipt_json, "show_customer", false),
            cashier_inn: json_cashier_inn(receipt_json, "cashier_inn"),
        },
        slip: BankSlipSettingsForPublish {
            print_bank_slip_on_atol: json_bool(slip_json, "print_bank_slip_on_atol", true),
            bank_slip_copies: json_copy_count(slip_json, "bank_slip_copies", 1),
            print_merchant_copy: json_bool(slip_json, "print_merchant_copy", true),
            print_customer_copy: json_bool(slip_json, "print_customer_copy", true),
            include_rrn: json_bool(slip_json, "include_rrn", true),
            include_approval_code: json_bool(slip_json, "include_approval_code", true),
            include_card_mask: json_bool(slip_json, "include_card_mask", true),
            include_sbp_id: json_bool(slip_json, "include_sbp_id", true),
            footer_lines: json_lines(slip_json, "footer_lines"),
        },
        shift: ShiftPrintSettingsForPublish {
            auto_open_before_card_sbp: json_bool(shift_json, "auto_open_before_card_sbp", true),
            auto_close_on_last_pos_shift_close: json_bool(
                shift_json,
                "auto_close_on_last_pos_shift_close",
                false,
            ),
            print_open_report: json_bool(shift_json, "print_open_report", true),
            print_close_report: json_bool(shift_json, "print_close_report", true),
        },
    }
}

fn json_bool(value: &serde_json::Value, key: &str, default: bool) -> bool {
    value
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(default)
}

fn json_copy_count(value: &serde_json::Value, key: &str, default: u32) -> u32 {
    value
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .map(|copies| copies.clamp(1, 3) as u32)
        .unwrap_or(default)
}

fn json_lines(value: &serde_json::Value, key: &str) -> Vec<String> {
    let raw_lines: Vec<String> = match value.get(key) {
        Some(serde_json::Value::Array(lines)) => lines
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        Some(serde_json::Value::String(lines)) => lines.lines().map(ToOwned::to_owned).collect(),
        _ => Vec::new(),
    };

    raw_lines
        .into_iter()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trim_chars(trimmed, 64))
            }
        })
        .take(4)
        .collect()
}

fn json_cashier_inn(value: &serde_json::Value, key: &str) -> Option<String> {
    let normalized: String = value
        .get(key)?
        .as_str()?
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect();

    match normalized.len() {
        10 | 12 => Some(normalized),
        _ => None,
    }
}

fn trim_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

async fn store_pos_command_payload(
    shared: &BridgeShared,
    transaction_id: Uuid,
    payload: serde_json::Value,
) {
    if let Err(error) =
        sqlx::query("UPDATE pos_transactions SET command_payload = $2 WHERE id = $1")
            .bind(transaction_id)
            .bind(payload)
            .execute(&shared.db)
            .await
    {
        tracing::warn!(
            tx_id = %transaction_id,
            error = %error,
            "Failed to store POS command payload"
        );
    }
}

/// Handle POS transaction notification — claim and dispatch to MQTT.
async fn handle_pos_notification(
    shared: &BridgeShared,
    payload: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let notify: PosNotifyPayload = serde_json::from_str(payload)?;

    if notify.status != "pending" {
        return Ok(());
    }

    // Atomic claim
    let claimed = sqlx::query_scalar::<_, bool>(
        "UPDATE pos_transactions SET status = 'processing'
         WHERE id = $1 AND status = 'pending' RETURNING TRUE",
    )
    .bind(notify.id)
    .fetch_optional(&shared.db)
    .await?;

    if claimed.is_none() {
        tracing::debug!(tx_id = %notify.id, "POS transaction already claimed");
        return Ok(());
    }

    // Fetch full transaction details
    let tx = sqlx::query_as::<_, PosTransactionForPublish>(
        r#"SELECT pt.id, pt.studio_id, pt.agent_id, pt.transaction_type,
                  pt.amount::float8 AS amount, pt.order_id, pt.receipt_id, pt.payment_method,
                  pt.initiated_by, COALESCE(pt.command_payload, '{}'::jsonb) AS command_payload
           FROM pos_transactions pt
           WHERE pt.id = $1"#,
    )
    .bind(notify.id)
    .fetch_optional(&shared.db)
    .await?;

    let Some(tx) = tx else {
        tracing::warn!(tx_id = %notify.id, "POS transaction not found after claiming");
        return Ok(());
    };

    // Find the POS agent for this studio
    let agent_studio_id = tx.studio_id;

    // Build and publish MQTT command based on transaction type
    let topic_prefix = format!("svoefoto/{agent_studio_id}/pos/commands");
    let amount_kopecks = (tx.amount * 100.0) as i64;

    match tx.transaction_type.as_str() {
        "payment" => {
            let cmd = infra_proto::PosPayCommand {
                transaction_id: tx.id.to_string(),
                amount_kopecks,
                order_id: tx.order_id.map(|id| id.to_string()).unwrap_or_default(),
                payment_method: tx.payment_method.clone().unwrap_or_else(|| "card".into()),
                description: String::new(),
            };
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(&format!("{topic_prefix}/pay"), QoS::AtLeastOnce, false, buf)
                .await?;
        }
        "refund" => {
            let refund_reference = refund_reference_from_payload(&tx.command_payload);
            let original_rrn = match refund_reference.original_rrn.clone() {
                Some(rrn) => Some(rrn),
                None => {
                    // Legacy fallback for older refund rows that only linked by order_id.
                    sqlx::query_scalar(
                        r#"SELECT rrn FROM pos_transactions
                           WHERE order_id = $1 AND transaction_type = 'payment' AND status = 'completed'
                           ORDER BY completed_at DESC LIMIT 1"#,
                    )
                    .bind(tx.order_id)
                    .fetch_optional(&shared.db)
                    .await?
                }
            };

            let cmd = infra_proto::PosRefundCommand {
                transaction_id: tx.id.to_string(),
                amount_kopecks,
                original_transaction_id: refund_reference.original_transaction_id,
                original_rrn: original_rrn.unwrap_or_default(),
            };
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/refund"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "sbp_payment" => {
            let cmd = infra_proto::PosSbpGenerateCommand {
                transaction_id: tx.id.to_string(),
                amount_kopecks,
                order_id: tx.order_id.map(|id| id.to_string()).unwrap_or_default(),
            };
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/sbp_generate"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "cash_drawer" => {
            let cmd = infra_proto::PosCashDrawerCommand {
                command_id: tx.id.to_string(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            };
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/cash_drawer"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "bank_settlement" => {
            let cmd = infra_proto::PosSettlementCommand {
                transaction_id: tx.id.to_string(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            };
            store_pos_command_payload(
                shared,
                tx.id,
                serde_json::json!({
                    "command": "settlement",
                    "provider": "dualconnector",
                    "operation": "59",
                }),
            )
            .await;
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/settlement"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "shift_open" | "shift_close" => {
            let action = if tx.transaction_type == "shift_open" {
                "open"
            } else {
                "close"
            };
            let cashier = cashier_name_for_user(shared, tx.initiated_by).await?;
            let fiscal_settings = fiscal_settings_for_studio(shared, tx.studio_id).await?;
            let cashier_inn = fiscal_settings.cashier_inn();
            let cmd = infra_proto::PosShiftCommand {
                command_id: tx.id.to_string(),
                action: action.into(),
                cashier: cashier.clone(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                cashier_inn: cashier_inn.clone(),
                shift_print_options: Some(fiscal_settings.shift_proto()),
            };
            store_pos_command_payload(
                shared,
                tx.id,
                serde_json::json!({
                    "command": "shift",
                    "action": action,
                    "cashier": cashier,
                    "cashier_inn": cashier_inn,
                    "settings": fiscal_settings.audit_payload(),
                }),
            )
            .await;
            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/shift"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "receipt_copy_print" => {
            let Some(receipt_id) = tx.receipt_id else {
                tracing::warn!(
                    tx_id = %tx.id,
                    "receipt_copy_print transaction has no receipt_id"
                );
                sqlx::query(
                    "UPDATE pos_transactions SET status = 'failed', error_message = $2, completed_at = NOW()
                     WHERE id = $1",
                )
                .bind(tx.id)
                .bind("Не найден чек для печати копии")
                .execute(&shared.db)
                .await?;
                return Ok(());
            };

            let Some(meta) = sqlx::query_as::<_, ReceiptCopyMetaRow>(
                r#"SELECT pr.receipt_number,
                          COALESCE(to_char(pr.created_at AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'), '') AS created_at,
                          pr.total::float8 AS total,
                          COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), NULLIF(u.email, ''), 'Кассир') AS cashier
                   FROM pos_receipts pr
                   LEFT JOIN users u ON u.id = pr.employee_id
                   WHERE pr.id = $1"#,
            )
            .bind(receipt_id)
            .fetch_optional(&shared.db)
            .await?
            else {
                tracing::warn!(tx_id = %tx.id, receipt_id = %receipt_id, "Receipt for copy print not found");
                sqlx::query(
                    "UPDATE pos_transactions SET status = 'failed', error_message = $2, completed_at = NOW()
                     WHERE id = $1",
                )
                .bind(tx.id)
                .bind("Чек для печати копии не найден")
                .execute(&shared.db)
                .await?;
                return Ok(());
            };

            let items = sqlx::query_as::<_, ReceiptCopyItemRow>(
                r#"SELECT product_name,
                          quantity::float8 AS quantity,
                          total::float8 AS total
                   FROM pos_receipt_items
                   WHERE receipt_id = $1
                   ORDER BY sort_order"#,
            )
            .bind(receipt_id)
            .fetch_all(&shared.db)
            .await?;

            let payments = sqlx::query_as::<_, ReceiptCopyPaymentRow>(
                r#"SELECT prp.payment_type,
                          prp.amount::float8 AS amount,
                          pt.approval_code,
                          pt.rrn,
                          pt.card_mask
                   FROM pos_receipt_payments prp
                   LEFT JOIN pos_transactions pt ON pt.id::text = prp.transaction_id
                   WHERE prp.receipt_id = $1
                     AND prp.status = 'completed'
                     AND prp.amount <> 0
                   ORDER BY prp.id"#,
            )
            .bind(receipt_id)
            .fetch_all(&shared.db)
            .await?;

            let copy_lines = build_receipt_copy_lines(&items);
            let copy_payments: Vec<infra_proto::ReceiptCopyPayment> =
                payments.iter().map(receipt_copy_payment_from_row).collect();
            let total_kopecks = money_to_kopecks(meta.total.abs());
            let cmd = infra_proto::PosReceiptCopyCommand {
                command_id: tx.id.to_string(),
                receipt_number: meta.receipt_number,
                created_at: meta.created_at,
                lines: copy_lines,
                payments: copy_payments,
                total_kopecks,
                cashier: meta.cashier,
            };

            store_pos_command_payload(
                shared,
                tx.id,
                serde_json::json!({
                    "command": "receipt_copy_print",
                    "receipt_id": receipt_id,
                    "receipt_number": cmd.receipt_number.clone(),
                    "total_kopecks": total_kopecks,
                    "line_count": cmd.lines.len(),
                    "payment_count": cmd.payments.len(),
                    "cashier": cmd.cashier.clone(),
                }),
            )
            .await;

            let mut buf = Vec::with_capacity(cmd.encoded_len());
            cmd.encode(&mut buf)?;
            shared
                .client
                .publish(
                    &format!("{topic_prefix}/receipt_copy"),
                    QoS::AtLeastOnce,
                    false,
                    buf,
                )
                .await?;
        }
        "fiscal_sale" | "fiscal_refund" | "fiscal_correction" => {
            // Fetch receipt items for fiscal command
            if let Some(receipt_id) = tx.receipt_id {
                let items = sqlx::query_as::<_, FiscalItemRow>(
                    r#"SELECT product_name,
                              unit_price::float8 AS unit_price,
                              quantity::float8 AS quantity,
                              vat_rate,
                              total::float8 AS total,
                              COALESCE(subscription_credits_used, 0)::float8 AS subscription_credits_used
                       FROM pos_receipt_items WHERE receipt_id = $1 ORDER BY sort_order"#,
                )
                .bind(receipt_id)
                .fetch_all(&shared.db)
                .await?;

                let fiscal_items: Vec<infra_proto::FiscalItem> =
                    items.iter().flat_map(build_fiscal_items).collect();

                let receipt_payments = sqlx::query_as::<_, FiscalPaymentRow>(
                    r#"SELECT prp.payment_type,
                              prp.amount::float8 AS amount,
                              prp.card_info,
                              prp.transaction_id,
                              pt.approval_code,
                              pt.rrn,
                              pt.card_mask
                       FROM pos_receipt_payments prp
                       LEFT JOIN pos_transactions pt ON pt.id::text = prp.transaction_id
                       WHERE prp.receipt_id = $1 AND prp.status = 'completed'
                       ORDER BY prp.id"#,
                )
                .bind(receipt_id)
                .fetch_all(&shared.db)
                .await?;

                let fiscal_total_kopecks = if tx.transaction_type == "fiscal_refund" {
                    amount_kopecks.abs()
                } else {
                    amount_kopecks
                };

                let fiscal_payments = build_fiscal_payments(
                    &receipt_payments,
                    tx.payment_method.as_deref(),
                    fiscal_total_kopecks,
                );

                let receipt_meta = sqlx::query_as::<_, FiscalReceiptMetaRow>(
                    r#"SELECT pr.receipt_number,
                              pr.created_at,
                              COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), NULLIF(u.email, ''), 'Кассир') AS cashier
                       FROM pos_receipts pr
                       LEFT JOIN pos_shifts ps ON ps.id = pr.shift_id
                       LEFT JOIN users u ON u.id = ps.employee_id
                       WHERE pr.id = $1"#,
                )
                .bind(receipt_id)
                .fetch_optional(&shared.db)
                .await?;

                let receipt_type = match tx.transaction_type.as_str() {
                    "fiscal_refund" => "refund",
                    "fiscal_correction" => "correction",
                    _ => "sale",
                };

                let studio_taxation_system: Option<String> = sqlx::query_scalar(
                    r#"SELECT COALESCE(taxation_system, '') FROM studios WHERE id = $1"#,
                )
                .bind(tx.studio_id)
                .fetch_optional(&shared.db)
                .await?;

                let fiscal_settings = fiscal_settings_for_studio(shared, tx.studio_id).await?;
                let command_receipt_id = fiscal_command_receipt_id(tx.id, receipt_id);
                let created_at = receipt_meta
                    .as_ref()
                    .map(|meta| meta.created_at)
                    .unwrap_or_else(chrono::Utc::now);
                let correction_details = if tx.transaction_type == "fiscal_correction" {
                    Some(fiscal_correction_details_from_payload(
                        &tx.command_payload,
                        receipt_meta
                            .as_ref()
                            .and_then(|meta| meta.receipt_number.as_deref()),
                        created_at,
                    ))
                } else {
                    None
                };
                let cashier = receipt_meta
                    .as_ref()
                    .and_then(|meta| meta.cashier.clone())
                    .unwrap_or_else(|| "Кассир".into());
                let taxation_type = normalize_taxation_type(studio_taxation_system.as_deref());
                let payment_method =
                    primary_fiscal_payment_method(&receipt_payments, tx.payment_method.as_deref());
                let cashier_inn = fiscal_settings.cashier_inn();
                let cmd = infra_proto::PosFiscalCommand {
                    receipt_id: command_receipt_id.clone(),
                    receipt_type: receipt_type.into(),
                    items: fiscal_items,
                    total_kopecks: fiscal_total_kopecks,
                    payment_method: payment_method.clone(),
                    cashier: cashier.clone(),
                    customer_email: String::new(),
                    taxation_type: taxation_type.clone(),
                    payments: fiscal_payments,
                    receipt_print_options: Some(fiscal_settings.receipt_proto()),
                    bank_slip_options: Some(fiscal_settings.slip_proto()),
                    cashier_inn: cashier_inn.clone(),
                    correction_type: correction_details
                        .as_ref()
                        .map(|details| details.correction_type.clone())
                        .unwrap_or_default(),
                    correction_base_date: correction_details
                        .as_ref()
                        .map(|details| details.correction_base_date.clone())
                        .unwrap_or_default(),
                    correction_base_number: correction_details
                        .as_ref()
                        .map(|details| details.correction_base_number.clone())
                        .unwrap_or_default(),
                    correction_base_name: correction_details
                        .as_ref()
                        .map(|details| details.correction_base_name.clone())
                        .unwrap_or_default(),
                };
                store_pos_command_payload(
                    shared,
                    tx.id,
                    serde_json::json!({
                        "command": "fiscal",
                        "transaction_type": tx.transaction_type,
                        "receipt_id": receipt_id,
                        "command_receipt_id": command_receipt_id,
                        "receipt_type": receipt_type,
                        "total_kopecks": fiscal_total_kopecks,
                        "payment_method": payment_method,
                        "cashier": cashier,
                        "cashier_inn": cashier_inn,
                        "taxation_type": taxation_type,
                        "correction": correction_details,
                        "settings": fiscal_settings.audit_payload(),
                    }),
                )
                .await;
                let mut buf = Vec::with_capacity(cmd.encoded_len());
                cmd.encode(&mut buf)?;
                shared
                    .client
                    .publish(
                        &format!("{topic_prefix}/fiscal"),
                        QoS::AtLeastOnce,
                        false,
                        buf,
                    )
                    .await?;
            }
        }
        other => {
            tracing::warn!(tx_type = other, "Unknown POS transaction type");
            return Ok(());
        }
    }

    tracing::info!(
        tx_id = %tx.id,
        tx_type = %tx.transaction_type,
        studio_id = %agent_studio_id,
        "Published POS command to MQTT"
    );

    // Notify CRM
    publish_redis_pos_update(shared, tx.id, "processing", agent_studio_id).await;

    Ok(())
}

async fn publish_redis_pos_update(
    shared: &BridgeShared,
    tx_id: Uuid,
    status: &str,
    studio_id: Uuid,
) {
    let payload = serde_json::json!({
        "type": "pos_transaction",
        "transaction_id": tx_id,
        "status": status,
        "studio_id": studio_id,
    });

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("pos:transaction_update")
        .arg(payload.to_string())
        .query_async::<()>(&mut conn)
        .await;
}

fn vat_rate_to_atol(rate: &str) -> String {
    match rate {
        "NoVat" | "none" | "" => "none".into(),
        "Zero" | "vat0" => "vat0".into(),
        "Main" | "vat20" | "20" => "vat20".into(),
        "Preferential" | "vat10" | "10" => "vat10".into(),
        _ => "none".into(),
    }
}

async fn cashier_name_for_user(
    shared: &BridgeShared,
    user_id: Option<Uuid>,
) -> Result<String, sqlx::Error> {
    let Some(user_id) = user_id else {
        return Ok("Кассир".into());
    };

    let cashier: Option<String> = sqlx::query_scalar(
        r#"SELECT COALESCE(NULLIF(display_name, ''), NULLIF(username, ''), NULLIF(email, ''), 'Кассир')
           FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&shared.db)
    .await?;

    Ok(cashier.unwrap_or_else(|| "Кассир".into()))
}

fn money_to_kopecks(amount: f64) -> i64 {
    (amount * 100.0).round() as i64
}

fn normalize_fiscal_payment_method(payment_type: &str) -> &'static str {
    match payment_type {
        "cash" => "cash",
        "card" | "online" | "transfer" => "card",
        "sbp" => "sbp",
        "subscription" | "prepaid" => "prepaid",
        _ => "card",
    }
}

fn normalize_taxation_type(taxation_system: Option<&str>) -> String {
    let normalized = taxation_system
        .unwrap_or_default()
        .trim()
        .to_lowercase()
        .replace('-', "_");

    match normalized.as_str() {
        "" | "osn" | "general" | "common" => "osn".into(),
        "usn"
        | "усн"
        | "usn_income"
        | "usnincome"
        | "usn_dohod"
        | "usn_dohody"
        | "усн доходы"
        | "доходы" => "usnIncome".into(),
        "usn_income_outcome"
        | "usn_income_expense"
        | "usnincomeoutcome"
        | "usnincomeexpense"
        | "usn_dohod_rashod"
        | "usn_dohody_rashody"
        | "усн доходы минус расходы"
        | "доходы минус расходы" => "usnIncomeOutcome".into(),
        "patent" | "psn" | "патент" => "patent".into(),
        other => {
            tracing::warn!(
                taxation_system = other,
                "Unknown studio taxation system, falling back to OSN"
            );
            "osn".into()
        }
    }
}

const FISCAL_QUANTITY_INTEGER_EPSILON: f64 = 0.000_001;
const DEFAULT_FISCAL_MEASUREMENT_UNIT: &str = "piece";

fn integral_receipt_quantity(quantity: f64) -> Option<i32> {
    if !quantity.is_finite() {
        return None;
    }

    let rounded = quantity.round();
    if rounded < 1.0 || rounded > i32::MAX as f64 {
        return None;
    }

    if (quantity - rounded).abs() > FISCAL_QUANTITY_INTEGER_EPSILON {
        return None;
    }

    Some(rounded as i32)
}

fn fiscal_item_price_and_quantity(item: &FiscalItemRow, total: f64) -> (i64, i32) {
    let total_kopecks = money_to_kopecks(total);

    match integral_receipt_quantity(item.quantity) {
        Some(quantity) => {
            let price_kopecks = money_to_kopecks(item.unit_price.abs());
            let quantity_kopecks = i64::from(quantity);

            if price_kopecks.saturating_mul(quantity_kopecks) == total_kopecks {
                return (price_kopecks, quantity);
            }

            if total_kopecks % quantity_kopecks == 0 {
                return (total_kopecks / quantity_kopecks, quantity);
            }

            (total_kopecks, 1)
        }
        None => (total_kopecks, 1),
    }
}

fn build_fiscal_items(item: &FiscalItemRow) -> Vec<infra_proto::FiscalItem> {
    let vat_rate = vat_rate_to_atol(&item.vat_rate);
    let total = item.total.abs();
    let subscription_amount = item.subscription_credits_used.clamp(0.0, total);
    let remainder_amount = (total - subscription_amount).max(0.0);

    if subscription_amount <= 0.004 {
        let (price_kopecks, quantity) = fiscal_item_price_and_quantity(item, total);
        return vec![infra_proto::FiscalItem {
            name: item.product_name.clone(),
            price_kopecks,
            quantity,
            vat_rate,
            payment_method: "fullPayment".into(),
            payment_object: "commodity".into(),
            measurement_unit: DEFAULT_FISCAL_MEASUREMENT_UNIT.into(),
        }];
    }

    let mut fiscal_items = Vec::with_capacity(2);
    fiscal_items.push(infra_proto::FiscalItem {
        name: item.product_name.clone(),
        price_kopecks: money_to_kopecks(subscription_amount),
        quantity: 1,
        vat_rate: vat_rate.clone(),
        payment_method: "advance".into(),
        payment_object: "commodity".into(),
        measurement_unit: DEFAULT_FISCAL_MEASUREMENT_UNIT.into(),
    });

    if remainder_amount > 0.004 {
        fiscal_items.push(infra_proto::FiscalItem {
            name: item.product_name.clone(),
            price_kopecks: money_to_kopecks(remainder_amount),
            quantity: 1,
            vat_rate,
            payment_method: "fullPayment".into(),
            payment_object: "commodity".into(),
            measurement_unit: DEFAULT_FISCAL_MEASUREMENT_UNIT.into(),
        });
    }

    fiscal_items
}

fn build_fiscal_payments(
    payments: &[FiscalPaymentRow],
    fallback_method: Option<&str>,
    fallback_amount_kopecks: i64,
) -> Vec<infra_proto::FiscalPayment> {
    let fiscal_payments: Vec<infra_proto::FiscalPayment> = payments
        .iter()
        .filter(|payment| payment.amount.abs() > 0.004)
        .map(|payment| infra_proto::FiscalPayment {
            payment_method: normalize_fiscal_payment_method(&payment.payment_type).into(),
            amount_kopecks: money_to_kopecks(payment.amount.abs()),
            transaction_id: clean_proto_string(payment.transaction_id.as_deref()),
            approval_code: clean_proto_string(payment.approval_code.as_deref()),
            rrn: clean_proto_string(payment.rrn.as_deref()),
            card_mask: clean_proto_string(payment.card_mask.as_deref()),
            card_info: clean_proto_string(payment.card_info.as_deref()),
        })
        .collect();

    if !fiscal_payments.is_empty() {
        return fiscal_payments;
    }

    vec![infra_proto::FiscalPayment {
        payment_method: normalize_fiscal_payment_method(fallback_method.unwrap_or("card")).into(),
        amount_kopecks: fallback_amount_kopecks.abs(),
        transaction_id: String::new(),
        approval_code: String::new(),
        rrn: String::new(),
        card_mask: String::new(),
        card_info: String::new(),
    }]
}

fn build_receipt_copy_lines(items: &[ReceiptCopyItemRow]) -> Vec<infra_proto::ReceiptCopyLine> {
    items
        .iter()
        .filter(|item| item.total.abs() > 0.004)
        .map(|item| infra_proto::ReceiptCopyLine {
            name: item.product_name.clone(),
            quantity: item.quantity,
            amount_kopecks: money_to_kopecks(item.total.abs()),
        })
        .collect()
}

fn receipt_copy_payment_from_row(row: &ReceiptCopyPaymentRow) -> infra_proto::ReceiptCopyPayment {
    infra_proto::ReceiptCopyPayment {
        payment_method: normalize_fiscal_payment_method(&row.payment_type).into(),
        amount_kopecks: money_to_kopecks(row.amount.abs()),
        approval_code: clean_proto_string(row.approval_code.as_deref()),
        rrn: clean_proto_string(row.rrn.as_deref()),
        card_mask: clean_proto_string(row.card_mask.as_deref()),
    }
}

fn clean_proto_string(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_owned()
}

fn primary_fiscal_payment_method(
    payments: &[FiscalPaymentRow],
    fallback_method: Option<&str>,
) -> String {
    payments
        .iter()
        .find(|payment| payment.payment_type != "subscription")
        .map(|payment| normalize_fiscal_payment_method(&payment.payment_type).to_string())
        .unwrap_or_else(|| {
            normalize_fiscal_payment_method(fallback_method.unwrap_or("prepaid")).to_string()
        })
}

fn fiscal_command_receipt_id(tx_id: Uuid, _receipt_id: Uuid) -> String {
    // The POS agent uses PosFiscalCommand.receipt_id as its idempotency key and
    // MQTT result topic segment. The real receipt id stays in pos_transactions.
    tx_id.to_string()
}

fn command_payload_string(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn refund_reference_from_payload(payload: &serde_json::Value) -> RefundReference {
    RefundReference {
        original_transaction_id: command_payload_string(payload, "original_transaction_id")
            .unwrap_or_default(),
        original_rrn: command_payload_string(payload, "original_rrn"),
    }
}

fn fiscal_correction_payload_string(payload: &serde_json::Value, key: &str) -> Option<String> {
    command_payload_string(payload, key)
}

fn fiscal_correction_type(payload: &serde_json::Value) -> String {
    match fiscal_correction_payload_string(payload, "correction_type").as_deref() {
        Some("instruction") => "instruction".into(),
        _ => "self".into(),
    }
}

fn normalize_atol_correction_date(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 {
        return None;
    }

    if bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4] == b'.'
        && bytes[5].is_ascii_digit()
        && bytes[6].is_ascii_digit()
        && bytes[7] == b'.'
        && bytes[8].is_ascii_digit()
        && bytes[9].is_ascii_digit()
    {
        return Some(value.to_owned());
    }

    if bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2] == b'.'
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && bytes[5] == b'.'
        && bytes[6].is_ascii_digit()
        && bytes[7].is_ascii_digit()
        && bytes[8].is_ascii_digit()
        && bytes[9].is_ascii_digit()
    {
        return Some(format!(
            "{}.{}.{}",
            &value[6..10],
            &value[3..5],
            &value[0..2]
        ));
    }

    None
}

fn fiscal_correction_base_date(
    payload: &serde_json::Value,
    created_at: chrono::DateTime<chrono::Utc>,
) -> String {
    if let Some(value) = fiscal_correction_payload_string(payload, "correction_base_date") {
        if let Some(normalized) = normalize_atol_correction_date(&value) {
            return normalized;
        }
    }

    let Some(moscow_offset) = chrono::FixedOffset::east_opt(3 * 60 * 60) else {
        return created_at.format("%Y.%m.%d").to_string();
    };
    created_at
        .with_timezone(&moscow_offset)
        .format("%Y.%m.%d")
        .to_string()
}

fn fiscal_correction_details_from_payload(
    payload: &serde_json::Value,
    receipt_number: Option<&str>,
    created_at: chrono::DateTime<chrono::Utc>,
) -> FiscalCorrectionDetails {
    let correction_base_number =
        fiscal_correction_payload_string(payload, "correction_base_number").unwrap_or_else(|| {
            receipt_number
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("ФД {value}"))
                .unwrap_or_else(|| "POS receipt".into())
        });

    FiscalCorrectionDetails {
        correction_type: fiscal_correction_type(payload),
        correction_base_date: fiscal_correction_base_date(payload, created_at),
        correction_base_number,
        correction_base_name: fiscal_correction_payload_string(payload, "correction_base_name")
            .unwrap_or_else(|| "Самостоятельная коррекция после ошибки фискализации".into()),
    }
}

#[derive(sqlx::FromRow)]
struct PosTransactionForPublish {
    id: Uuid,
    studio_id: Uuid,
    #[allow(dead_code)]
    agent_id: Option<Uuid>,
    transaction_type: String,
    amount: f64,
    order_id: Option<Uuid>,
    receipt_id: Option<Uuid>,
    payment_method: Option<String>,
    initiated_by: Option<Uuid>,
    command_payload: serde_json::Value,
}

#[derive(sqlx::FromRow)]
struct FiscalItemRow {
    product_name: String,
    unit_price: f64,
    quantity: f64,
    vat_rate: String,
    total: f64,
    subscription_credits_used: f64,
}

#[derive(sqlx::FromRow)]
struct FiscalPaymentRow {
    payment_type: String,
    amount: f64,
    card_info: Option<String>,
    transaction_id: Option<String>,
    approval_code: Option<String>,
    rrn: Option<String>,
    card_mask: Option<String>,
}

#[derive(sqlx::FromRow)]
struct FiscalReceiptMetaRow {
    receipt_number: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    cashier: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ReceiptCopyMetaRow {
    receipt_number: String,
    created_at: String,
    total: f64,
    cashier: String,
}

#[derive(sqlx::FromRow)]
struct ReceiptCopyItemRow {
    product_name: String,
    quantity: f64,
    total: f64,
}

#[derive(sqlx::FromRow)]
struct ReceiptCopyPaymentRow {
    payment_type: String,
    amount: f64,
    approval_code: Option<String>,
    rrn: Option<String>,
    card_mask: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
struct FiscalCorrectionDetails {
    correction_type: String,
    correction_base_date: String,
    correction_base_number: String,
    correction_base_name: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct RefundReference {
    original_transaction_id: String,
    original_rrn: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct JobForPublish {
    id: Uuid,
    #[allow(dead_code)]
    printer_id: Uuid,
    file_url: String,
    file_name: Option<String>,
    copies: i32,
    paper_size: String,
    color_mode: String,
    quality: String,
    duplex: bool,
    orientation: String,
    borderless: bool,
    media_type: Option<String>,
    fit_mode: String,
    studio_id: Option<Uuid>,
    service_slug: Option<String>,
    document_template_slug: Option<String>,
    icc_profile_id: Option<Uuid>,
    cut_marks: Option<bool>,
    cut_mark_length_mm: Option<f64>,
    cut_mark_offset_mm: Option<f64>,
    layout_rows: Option<i32>,
    layout_cols: Option<i32>,
    cut_margin_mm: Option<f64>,
    custom_photo_width_mm: Option<f64>,
    custom_photo_height_mm: Option<f64>,
    rendering_intent: Option<String>,
    paper_source: Option<String>,
    cups_printer_name: Option<String>,
    printer_studio_id: Option<Uuid>,
    #[allow(dead_code)]
    finishing_options: Option<serde_json::Value>,
    mirror: Option<bool>,
    rotation: Option<i16>,
    crop_x: Option<f32>,
    crop_y: Option<f32>,
    crop_width: Option<f32>,
    crop_height: Option<f32>,
    photo_enhance: Option<bool>,
    brightness: Option<i16>,
    contrast: Option<i16>,
    saturation: Option<i16>,
    watermark_text: Option<String>,
    watermark_opacity: Option<f32>,
    watermark_position: Option<String>,
    banner_page: Option<bool>,
    // Extended print options (migration 086)
    nup: Option<i32>,
    #[sqlx(rename = "collate")]
    collate: Option<bool>,
    resolution_dpi: Option<i32>,
    color_auto_detect: Option<bool>,
    booklet: Option<bool>,
    pages_per_sheet: Option<i32>,
    binding: Option<String>,
    staple_position: Option<String>,
    hole_punch: Option<String>,
    hole_punch_type: Option<String>,
    duplex_mode: Option<String>,
    scaling_percent: Option<i32>,
    output_bin: Option<String>,
    toner_save: Option<String>,
    department_id: Option<String>,
    secure_pin: Option<String>,
    gray_mode: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fiscal_items_use_absolute_refund_total_for_subscription_split() {
        let items = build_fiscal_items(&FiscalItemRow {
            product_name: "Фото".into(),
            unit_price: 100.0,
            quantity: 3.0,
            vat_rate: "none".into(),
            total: -300.0,
            subscription_credits_used: 200.0,
        });

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].payment_method, "advance");
        assert_eq!(items[0].price_kopecks, 20_000);
        assert_eq!(items[1].payment_method, "fullPayment");
        assert_eq!(items[1].price_kopecks, 10_000);
    }

    #[test]
    fn fiscal_items_accept_numeric_receipt_quantity() {
        let items = build_fiscal_items(&FiscalItemRow {
            product_name: "Фото".into(),
            unit_price: 100.0,
            quantity: 3.0,
            vat_rate: "none".into(),
            total: 300.0,
            subscription_credits_used: 0.0,
        });

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].quantity, 3);
        assert_eq!(items[0].price_kopecks, 10_000);
        assert_eq!(items[0].measurement_unit, DEFAULT_FISCAL_MEASUREMENT_UNIT);
    }

    #[test]
    fn fiscal_items_use_receipt_line_total_when_unit_price_differs() {
        let items = build_fiscal_items(&FiscalItemRow {
            product_name: "Фото 10x15 премиум".into(),
            unit_price: 20.0,
            quantity: 1.0,
            vat_rate: "none".into(),
            total: 19.5,
            subscription_credits_used: 0.0,
        });

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].quantity, 1);
        assert_eq!(items[0].price_kopecks, 1_950);
    }

    #[test]
    fn fiscal_items_preserve_fractional_receipt_quantity_total() {
        let items = build_fiscal_items(&FiscalItemRow {
            product_name: "Материал".into(),
            unit_price: 10.0,
            quantity: 1.5,
            vat_rate: "none".into(),
            total: 15.0,
            subscription_credits_used: 0.0,
        });

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].quantity, 1);
        assert_eq!(items[0].price_kopecks, 1_500);
    }

    #[test]
    fn fiscal_payments_use_absolute_refund_payment_amounts() {
        let payments = build_fiscal_payments(
            &[
                FiscalPaymentRow {
                    payment_type: "subscription".into(),
                    amount: -200.0,
                    card_info: None,
                    transaction_id: None,
                    approval_code: None,
                    rrn: None,
                    card_mask: None,
                },
                FiscalPaymentRow {
                    payment_type: "cash".into(),
                    amount: -100.0,
                    card_info: None,
                    transaction_id: None,
                    approval_code: None,
                    rrn: None,
                    card_mask: None,
                },
            ],
            Some("card"),
            -30_000,
        );

        assert_eq!(payments.len(), 2);
        assert_eq!(payments[0].payment_method, "prepaid");
        assert_eq!(payments[0].amount_kopecks, 20_000);
        assert_eq!(payments[1].payment_method, "cash");
        assert_eq!(payments[1].amount_kopecks, 10_000);
    }

    #[test]
    fn fiscal_payments_include_terminal_metadata_for_slips() {
        let payments = build_fiscal_payments(
            &[FiscalPaymentRow {
                payment_type: "card".into(),
                amount: 123.45,
                card_info: Some("  424242****4242 (Visa)  ".into()),
                transaction_id: Some("tx-card-1".into()),
                approval_code: Some(" A12345 ".into()),
                rrn: Some(" 999888777666 ".into()),
                card_mask: Some(" ****4242 ".into()),
            }],
            None,
            12_345,
        );

        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].payment_method, "card");
        assert_eq!(payments[0].amount_kopecks, 12_345);
        assert_eq!(payments[0].transaction_id, "tx-card-1");
        assert_eq!(payments[0].approval_code, "A12345");
        assert_eq!(payments[0].rrn, "999888777666");
        assert_eq!(payments[0].card_mask, "****4242");
        assert_eq!(payments[0].card_info, "424242****4242 (Visa)");
    }

    #[test]
    fn fiscal_payment_fallback_uses_absolute_refund_total() {
        let payments = build_fiscal_payments(&[], Some("sbp"), -30_000);

        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0].payment_method, "sbp");
        assert_eq!(payments[0].amount_kopecks, 30_000);
    }

    #[test]
    fn receipt_copy_lines_include_items_total_and_payment_metadata() {
        let lines = build_receipt_copy_lines(&[
            ReceiptCopyItemRow {
                product_name: "Фото для пропуска".into(),
                quantity: 1.0,
                total: 700.0,
            },
            ReceiptCopyItemRow {
                product_name: "Максимальная обработка".into(),
                quantity: 1.0,
                total: 1400.0,
            },
        ]);

        assert!(lines.iter().any(|line| line.name == "Фото для пропуска"));
        assert_eq!(lines[0].amount_kopecks, 70_000);

        let payment = receipt_copy_payment_from_row(&ReceiptCopyPaymentRow {
            payment_type: "card".into(),
            amount: 2100.0,
            approval_code: Some("076671".into()),
            rrn: Some("617609255403".into()),
            card_mask: Some("************3904".into()),
        });

        assert_eq!(payment.payment_method, "card");
        assert_eq!(payment.amount_kopecks, 210_000);
        assert_eq!(payment.rrn, "617609255403");
    }

    #[test]
    fn fiscal_command_receipt_id_uses_transaction_id_for_result_correlation() {
        let tx_id = Uuid::parse_str("6ad7aa8a-5729-4bc9-8a04-1928bf48d953").unwrap();
        let receipt_id = Uuid::parse_str("9d665639-46a8-47e9-8f06-41c7e90d8e87").unwrap();

        let command_receipt_id = fiscal_command_receipt_id(tx_id, receipt_id);

        assert_eq!(command_receipt_id, tx_id.to_string());
        assert_ne!(command_receipt_id, receipt_id.to_string());
    }

    #[test]
    fn refund_reference_prefers_command_payload_fields() {
        let reference = refund_reference_from_payload(&serde_json::json!({
            "original_transaction_id": "tx-payment-1",
            "original_rrn": " 123456789012 "
        }));

        assert_eq!(reference.original_transaction_id, "tx-payment-1");
        assert_eq!(reference.original_rrn.as_deref(), Some("123456789012"));
    }

    #[test]
    fn fiscal_correction_details_default_to_failed_receipt_context() {
        let created_at = chrono::DateTime::parse_from_rfc3339("2026-05-24T17:13:00+03:00")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let details = fiscal_correction_details_from_payload(
            &serde_json::json!({}),
            Some("4773"),
            created_at,
        );

        assert_eq!(details.correction_type, "self");
        assert_eq!(details.correction_base_date, "2026.05.24");
        assert_eq!(details.correction_base_number, "ФД 4773");
    }

    #[test]
    fn fiscal_correction_details_use_command_payload_overrides() {
        let created_at = chrono::DateTime::parse_from_rfc3339("2026-05-24T17:13:00+03:00")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let details = fiscal_correction_details_from_payload(
            &serde_json::json!({
                "correction_type": "instruction",
                "correction_base_date": "25.05.2026",
                "correction_base_number": "Акт 12"
            }),
            Some("4773"),
            created_at,
        );

        assert_eq!(details.correction_type, "instruction");
        assert_eq!(details.correction_base_date, "2026.05.25");
        assert_eq!(details.correction_base_number, "Акт 12");
    }

    #[test]
    fn taxation_type_normalization_supports_usn_aliases() {
        assert_eq!(normalize_taxation_type(Some("osn")), "osn");
        assert_eq!(normalize_taxation_type(Some("УСН")), "usnIncome");
        assert_eq!(normalize_taxation_type(Some("usn_income")), "usnIncome");
        assert_eq!(
            normalize_taxation_type(Some("usn-income-outcome")),
            "usnIncomeOutcome"
        );
        assert_eq!(normalize_taxation_type(Some("patent")), "patent");
    }

    #[test]
    fn fiscal_settings_normalization_clamps_copies_and_lines() {
        let settings =
            normalize_fiscal_settings_for_publish(Some(PosFiscalSettingsForPublishRow {
                receipt_settings: serde_json::json!({
                    "print_receipt": true,
                    "receipt_copies": 9,
                    "header_lines": ["  Свое фото  ", "", "Соборный 21", "line3", "line4", "line5"],
                    "footer_lines": ["Спасибо", "  "],
                    "show_cashier": false,
                    "show_receipt_number": false,
                    "show_order_number": true,
                    "show_customer": true,
                    "cashier_inn": " 123456789012 "
                }),
                slip_settings: serde_json::json!({
                    "print_bank_slip_on_atol": true,
                    "bank_slip_copies": 7,
                    "print_merchant_copy": true,
                    "print_customer_copy": false,
                    "include_rrn": false,
                    "include_approval_code": true,
                    "include_card_mask": false,
                    "include_sbp_id": true,
                    "footer_lines": ["Копия банка", "  "]
                }),
                shift_settings: serde_json::json!({
                    "auto_open_before_card_sbp": false,
                    "auto_close_on_last_pos_shift_close": true,
                    "print_open_report": false,
                    "print_close_report": false
                }),
            }));

        assert_eq!(settings.receipt.receipt_copies, 3);
        assert_eq!(
            settings.receipt.header_lines,
            vec!["Свое фото", "Соборный 21", "line3", "line4"]
        );
        assert_eq!(settings.receipt.footer_lines, vec!["Спасибо"]);
        assert!(!settings.receipt.show_cashier);
        assert_eq!(
            settings.receipt.cashier_inn.as_deref(),
            Some("123456789012")
        );
        assert_eq!(settings.slip.bank_slip_copies, 3);
        assert!(settings.slip.print_bank_slip_on_atol);
        assert!(!settings.slip.print_customer_copy);
        assert_eq!(settings.slip.footer_lines, vec!["Копия банка"]);
        assert!(!settings.shift.auto_open_before_card_sbp);
        assert!(settings.shift.auto_close_on_last_pos_shift_close);
        assert!(!settings.shift.print_open_report);
    }

    #[test]
    fn fiscal_settings_default_to_atol_receipt_and_slip_printing() {
        let settings = normalize_fiscal_settings_for_publish(None);

        assert!(settings.receipt.print_receipt);
        assert_eq!(settings.receipt.receipt_copies, 1);
        assert!(settings.receipt.show_cashier);
        assert!(settings.slip.print_bank_slip_on_atol);
        assert_eq!(settings.slip.bank_slip_copies, 1);
        assert!(settings.slip.print_merchant_copy);
        assert!(settings.slip.print_customer_copy);
        assert!(settings.shift.auto_open_before_card_sbp);
        assert!(settings.shift.print_open_report);
        assert!(settings.shift.print_close_report);
    }
}
