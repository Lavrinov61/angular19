use prost::Message;
use rumqttc::{Event, EventLoop, Packet, SubscribeReasonCode};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use uuid::Uuid;

use super::BridgeShared;
use super::publisher::publish_redis_job_update;
use crate::infra_proto;
use crate::proto;
use crate::scheduler;

/// Run the MQTT event loop. Processes incoming messages and re-subscribes on reconnect.
pub async fn run_event_loop(shared: Arc<BridgeShared>, mut event_loop: EventLoop) {
    let subscribe_retry_scheduled = Arc::new(AtomicBool::new(false));

    loop {
        match event_loop.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                subscribe_retry_scheduled.store(false, Ordering::Release);
                tracing::info!("MQTT connected to broker, subscribing...");
                super::subscribe_topics(&shared.client).await;
            }
            Ok(Event::Incoming(Packet::SubAck(suback))) => {
                let summary = summarize_suback_return_codes(&suback.return_codes);
                if summary.has_failures() {
                    tracing::warn!(
                        packet_id = suback.pkid,
                        granted = summary.granted,
                        failed = summary.failed,
                        "MQTT broker rejected one or more subscriptions; scheduling retry"
                    );
                    schedule_subscribe_retry(&shared, &subscribe_retry_scheduled);
                } else {
                    tracing::debug!(
                        packet_id = suback.pkid,
                        granted = summary.granted,
                        "MQTT subscription acknowledged"
                    );
                }
            }
            Ok(Event::Incoming(Packet::Publish(p))) => {
                let topic = p.topic.clone();
                let payload = p.payload.to_vec();
                let shared = Arc::clone(&shared);

                tokio::spawn(async move {
                    if let Err(e) = handle_message(&shared, &topic, &payload).await {
                        tracing::error!(topic = %topic, "MQTT message handler error: {e}");
                    }
                });
            }
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("MQTT event loop error: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SubAckSummary {
    granted: usize,
    failed: usize,
}

impl SubAckSummary {
    fn has_failures(self) -> bool {
        self.failed > 0
    }
}

fn summarize_suback_return_codes(return_codes: &[SubscribeReasonCode]) -> SubAckSummary {
    let failed = return_codes
        .iter()
        .filter(|code| matches!(code, SubscribeReasonCode::Failure))
        .count();

    SubAckSummary {
        granted: return_codes.len().saturating_sub(failed),
        failed,
    }
}

fn schedule_subscribe_retry(shared: &Arc<BridgeShared>, retry_scheduled: &Arc<AtomicBool>) {
    if retry_scheduled.swap(true, Ordering::AcqRel) {
        return;
    }

    let client = shared.client.clone();
    let retry_scheduled = Arc::clone(retry_scheduled);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        tracing::info!("Retrying MQTT topic subscriptions after failed SUBACK");
        super::subscribe_topics(&client).await;
        retry_scheduled.store(false, Ordering::Release);
    });
}

async fn handle_message(
    shared: &BridgeShared,
    topic: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let parts: Vec<&str> = topic.split('/').collect();

    // === Legacy flat topics (backward compat) ===
    // svoefoto/{studio_id}/jobs/{job_id}/progress
    if parts.len() == 5 && parts[2] == "jobs" && parts[4] == "progress" {
        handle_job_progress(shared, parts[1], parts[3], payload).await?;
    }
    // svoefoto/{studio_id}/preview/{preview_id}/result (Phase 4.5)
    else if parts.len() == 5 && parts[2] == "preview" && parts[4] == "result" {
        handle_preview_result(shared, parts[3], payload).await?;
    }
    // svoefoto/{studio_id}/telemetry
    else if parts.len() == 3 && parts[2] == "telemetry" {
        handle_telemetry(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/heartbeat
    else if parts.len() == 3 && parts[2] == "heartbeat" {
        handle_heartbeat(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/status (legacy JSON from Windows POS Bridge)
    else if parts.len() == 3 && parts[2] == "status" {
        handle_bridge_status_legacy(shared, parts[1], payload).await?;
    }
    // === Infra v2 topics (multi-agent) ===
    // svoefoto/{studio_id}/{agent_type}/heartbeat
    else if parts.len() == 4 && parts[3] == "heartbeat" && is_agent_type(parts[2]) {
        handle_agent_heartbeat(shared, parts[1], parts[2], payload).await?;
    }
    // svoefoto/{studio_id}/{agent_type}/telemetry
    else if is_generic_agent_telemetry_topic(&parts) {
        handle_agent_telemetry(shared, parts[1], parts[2], payload).await?;
    }
    // svoefoto/{studio_id}/{agent_type}/alerts
    else if parts.len() == 4 && parts[3] == "alerts" && is_agent_type(parts[2]) {
        handle_agent_alert(shared, parts[1], parts[2], payload).await?;
    }
    // svoefoto/{studio_id}/{agent_type}/commands/config_ack
    else if parts.len() == 5
        && parts[3] == "commands"
        && parts[4] == "config_ack"
        && is_agent_type(parts[2])
    {
        handle_config_ack(shared, parts[1], parts[2], payload).await?;
    }
    // svoefoto/{studio_id}/{agent_type}/commands/update_status
    else if parts.len() == 5
        && parts[3] == "commands"
        && parts[4] == "update_status"
        && is_agent_type(parts[2])
    {
        handle_update_status(shared, parts[1], parts[2], payload).await?;
    }
    // svoefoto/{studio_id}/monitor/system
    else if parts.len() == 4 && parts[2] == "monitor" && parts[3] == "system" {
        handle_system_metrics(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/print/jobs/{job_id}/progress (new prefix)
    else if parts.len() == 6
        && parts[2] == "print"
        && parts[3] == "jobs"
        && parts[5] == "progress"
    {
        handle_job_progress(shared, parts[1], parts[4], payload).await?;
    }
    // svoefoto/{studio_id}/pos/transactions/{tx_id}/result (Phase 5)
    else if parts.len() == 6
        && parts[2] == "pos"
        && parts[3] == "transactions"
        && parts[5] == "result"
    {
        handle_pos_transaction_result(shared, parts[1], parts[4], payload).await?;
    }
    // svoefoto/{studio_id}/pos/shift/result (Phase 5)
    else if parts.len() == 5 && parts[2] == "pos" && parts[3] == "shift" && parts[4] == "result" {
        handle_pos_shift_result(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/pos/sbp/qr_result (Phase 5)
    else if parts.len() == 5 && parts[2] == "pos" && parts[3] == "sbp" && parts[4] == "qr_result"
    {
        handle_pos_sbp_qr_result(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/pos/telemetry (Phase 5)
    else if parts.len() == 4 && parts[2] == "pos" && parts[3] == "telemetry" {
        handle_pos_telemetry(shared, parts[1], payload).await?;
    }
    // === Guard-agent specific topics ===
    // svoefoto/{studio_id}/guard/events/scan
    else if parts.len() == 5 && parts[2] == "guard" && parts[3] == "events" && parts[4] == "scan"
    {
        handle_guard_scan(shared, parts[1], payload).await?;
    }
    // svoefoto/{studio_id}/guard/events/threat
    else if parts.len() == 5
        && parts[2] == "guard"
        && parts[3] == "events"
        && parts[4] == "threat"
    {
        handle_guard_threat(shared, parts[1], payload).await?;
    }

    Ok(())
}

/// Handle job progress update from agent (Protobuf PrintStatus).
async fn handle_job_progress(
    shared: &BridgeShared,
    studio_id_str: &str,
    job_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let status_msg = proto::PrintStatus::decode(payload)?;

    let job_id = Uuid::parse_str(job_id_str)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;

    let db_status = match proto::JobState::try_from(status_msg.state) {
        Ok(proto::JobState::Sending) => "sending",
        Ok(proto::JobState::ApplyingIcc) => "applying_icc",
        Ok(proto::JobState::RenderingLayout) => "rendering_layout",
        Ok(proto::JobState::Printing) => "printing",
        Ok(proto::JobState::Completed) => "completed",
        Ok(proto::JobState::Failed) => "failed",
        Ok(proto::JobState::Cancelled) => "cancelled",
        _ => {
            tracing::warn!(job_id = %job_id, state = status_msg.state, "Unknown job state");
            return Ok(());
        }
    };

    let is_terminal = matches!(db_status, "completed" | "failed" | "cancelled");
    let error_message = if status_msg.error_message.is_empty() {
        None
    } else {
        Some(status_msg.error_message.as_str())
    };

    let consumable_json = status_msg.consumable_usage.as_ref().map(consumable_to_json);

    if is_terminal {
        sqlx::query(
            r#"UPDATE print_jobs SET
                status = $2, error_message = $3, completed_at = NOW(),
                duration_ms = EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000,
                consumable_usage = COALESCE($4, consumable_usage)
               WHERE id = $1"#,
        )
        .bind(job_id)
        .bind(db_status)
        .bind(error_message)
        .bind(&consumable_json)
        .execute(&shared.db)
        .await?;
    } else {
        sqlx::query(
            r#"UPDATE print_jobs SET
                status = $2, error_message = $3,
                consumable_usage = COALESCE($4, consumable_usage)
               WHERE id = $1"#,
        )
        .bind(job_id)
        .bind(db_status)
        .bind(error_message)
        .bind(&consumable_json)
        .execute(&shared.db)
        .await?;
    }

    tracing::info!(job_id = %job_id, status = db_status, "Job progress updated");

    // Phase 4.3/S24: Prefer agent-reported consumables. If the agent does not
    // send them, use the coverage estimate stored on the job at creation time.
    if db_status == "completed" {
        if let Some(ref usage) = status_msg.consumable_usage {
            deduct_consumable_stock(shared, studio_id, job_id, usage).await;
        } else if let Some(usage) = estimated_consumable_usage_for_job(shared, job_id).await {
            deduct_estimated_toner_stock(shared, studio_id, job_id, &usage).await;
        }
    }

    publish_redis_job_update(shared, job_id, db_status, error_message, studio_id).await;

    // Check if child job completed/failed → aggregate parent progress
    if db_status == "completed" || db_status == "failed" {
        let parent: Option<(String,)> = sqlx::query_as(
            "SELECT parent_job_id::text FROM print_jobs WHERE id = $1::uuid AND parent_job_id IS NOT NULL",
        )
        .bind(&job_id_str)
        .fetch_optional(&shared.db)
        .await
        .ok()
        .flatten();

        if let Some((parent_id,)) = parent {
            let stats: (i64, i64, i64, i64) = sqlx::query_as(
                r#"SELECT
                     COUNT(*) FILTER (WHERE status = 'completed'),
                     COUNT(*) FILTER (WHERE status = 'failed'),
                     COUNT(*),
                     COALESCE(SUM(copies) FILTER (WHERE status = 'completed'), 0)
                   FROM print_jobs
                   WHERE parent_job_id = $1::uuid"#,
            )
            .bind(&parent_id)
            .fetch_one(&shared.db)
            .await
            .unwrap_or((0, 0, 0, 0));

            let (completed, failed, total, done_copies) = stats;

            // Update parent current_copy with aggregate progress
            let _ = sqlx::query("UPDATE print_jobs SET current_copy = $2 WHERE id = $1::uuid")
                .bind(&parent_id)
                .bind(done_copies as i32)
                .execute(&shared.db)
                .await;

            // If all children are done → complete or fail parent
            if completed + failed == total {
                let final_status = if failed > 0 { "failed" } else { "completed" };
                let _ = sqlx::query(
                    r#"UPDATE print_jobs
                       SET status = $2,
                           completed_at = NOW(),
                           duration_ms = EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000
                       WHERE id = $1::uuid"#,
                )
                .bind(&parent_id)
                .bind(final_status)
                .execute(&shared.db)
                .await;

                // Redis publish parent update
                publish_redis_job_update(
                    shared,
                    Uuid::parse_str(&parent_id).unwrap_or(job_id),
                    final_status,
                    None,
                    studio_id,
                )
                .await;

                tracing::info!(
                    parent_id = %parent_id,
                    status = final_status,
                    completed_children = completed,
                    failed_children = failed,
                    "Parent job aggregation complete"
                );
            }
        }
    }

    Ok(())
}

/// Handle telemetry report from agent (Protobuf TelemetryReport).
async fn handle_telemetry(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let report = proto::TelemetryReport::decode(payload)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;

    let printer_id = if !report.printer_id.is_empty() {
        Uuid::parse_str(&report.printer_id)?
    } else {
        tracing::warn!(studio_id = %studio_id, "Telemetry without printer_id");
        return Ok(());
    };

    let bridge_id = if !report.bridge_id.is_empty() {
        Some(Uuid::parse_str(&report.bridge_id)?)
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM bridge_devices WHERE studio_id = $1 AND is_active = TRUE LIMIT 1",
        )
        .bind(studio_id)
        .fetch_optional(&shared.db)
        .await?
    };

    let consumable_json = report.consumable_usage.as_ref().map(consumable_to_json);

    // Parse JSON strings from protobuf (agent sends pre-serialized JSON in string fields)
    let supplies: Option<serde_json::Value> = parse_json_field(&report.supplies_json);
    let trays: Option<serde_json::Value> = parse_json_field(&report.trays_json);
    let counters: Option<serde_json::Value> = parse_json_field(&report.counters_json);
    let errors: Option<serde_json::Value> = parse_json_field(&report.errors_json);

    sqlx::query(
        r#"INSERT INTO printer_telemetry (
             printer_id, studio_id, bridge_device_id,
             is_online, state, state_reasons,
             supplies, trays, counters, errors,
             model, manufacturer, serial_number, firmware_version,
             consumable_usage, collected_at
           ) VALUES (
             $1, $2, $3,
             $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14,
             $15, NOW()
           )"#,
    )
    .bind(printer_id)
    .bind(studio_id)
    .bind(bridge_id)
    .bind(report.is_online)
    .bind(&report.state)
    .bind(&report.state_reasons)
    .bind(&supplies)
    .bind(&trays)
    .bind(&counters)
    .bind(&errors)
    .bind(if report.model.is_empty() {
        None
    } else {
        Some(&report.model)
    })
    .bind(if report.manufacturer.is_empty() {
        None
    } else {
        Some(&report.manufacturer)
    })
    .bind(if report.serial_number.is_empty() {
        None
    } else {
        Some(&report.serial_number)
    })
    .bind(if report.firmware_version.is_empty() {
        None
    } else {
        Some(&report.firmware_version)
    })
    .bind(&consumable_json)
    .execute(&shared.db)
    .await?;

    tracing::debug!(printer_id = %printer_id, state = %report.state, "Telemetry stored");

    // Sync supply levels to consumable_stock
    if let Some(station_id) = bridge_id {
        sync_supplies_to_stock(shared, studio_id, station_id, &report.supplies_json).await;
    }

    // Publish to Redis for Socket.IO
    let redis_payload = serde_json::json!({
        "studio_id": studio_id,
        "printer_id": printer_id,
        "state": report.state,
        "is_online": report.is_online,
    });

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("print:telemetry")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

/// Handle heartbeat from Rust agent (Protobuf BridgeHeartbeat).
async fn handle_heartbeat(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let heartbeat = proto::BridgeHeartbeat::decode(payload)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;
    let bridge_id = Uuid::parse_str(&heartbeat.bridge_id)?;

    sqlx::query(
        r#"UPDATE bridge_devices SET
             is_online = TRUE,
             last_heartbeat_at = NOW(),
             last_connected_at = COALESCE(last_connected_at, NOW()),
             hostname = COALESCE(NULLIF($3, ''), hostname),
             bridge_version = COALESCE(NULLIF($4, ''), bridge_version),
             os_version = COALESCE(NULLIF($5, ''), os_version),
             agent_type = COALESCE(NULLIF($6, ''), agent_type),
             cups_version = COALESCE(NULLIF($7, ''), cups_version)
           WHERE id = $1 AND studio_id = $2 AND is_active = TRUE"#,
    )
    .bind(bridge_id)
    .bind(studio_id)
    .bind(&heartbeat.hostname)
    .bind(&heartbeat.agent_version)
    .bind(&heartbeat.os_info)
    .bind(&heartbeat.agent_type)
    .bind(&heartbeat.cups_version)
    .execute(&shared.db)
    .await?;

    tracing::debug!(
        bridge_id = %bridge_id,
        agent = %heartbeat.agent_type,
        uptime_s = heartbeat.uptime_seconds,
        "Bridge heartbeat"
    );

    // Publish to Redis
    let redis_payload = serde_json::json!({
        "studio_id": studio_id,
        "bridge_id": bridge_id,
        "online": true,
    });

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("print:bridge_status")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

/// Handle legacy bridge status from Windows POS Bridge (JSON payload).
async fn handle_bridge_status_legacy(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Try Protobuf first (new agents might use 'status' topic too)
    if let Ok(_heartbeat) = proto::BridgeHeartbeat::decode(payload) {
        return handle_heartbeat(shared, studio_id_str, payload).await;
    }

    // Legacy JSON format
    #[derive(serde::Deserialize)]
    struct LegacyStatus {
        online: bool,
        hostname: Option<String>,
        bridge_version: Option<String>,
        os_version: Option<String>,
    }

    let status: LegacyStatus = serde_json::from_slice(payload)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;

    if status.online {
        sqlx::query(
            r#"UPDATE bridge_devices SET
                 is_online = TRUE,
                 last_connected_at = NOW(),
                 last_heartbeat_at = NOW(),
                 hostname = COALESCE($2, hostname),
                 bridge_version = COALESCE($3, bridge_version),
                 os_version = COALESCE($4, os_version)
               WHERE studio_id = $1 AND is_active = TRUE"#,
        )
        .bind(studio_id)
        .bind(&status.hostname)
        .bind(&status.bridge_version)
        .bind(&status.os_version)
        .execute(&shared.db)
        .await?;
    } else {
        sqlx::query(
            "UPDATE bridge_devices SET is_online = FALSE, last_disconnected_at = NOW()
             WHERE studio_id = $1 AND is_active = TRUE",
        )
        .bind(studio_id)
        .execute(&shared.db)
        .await?;
    }

    let redis_payload = serde_json::json!({
        "studio_id": studio_id,
        "online": status.online,
    });

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("print:bridge_status")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

fn consumable_to_json(cu: &proto::ConsumableUsage) -> serde_json::Value {
    serde_json::json!({
        "cyan_ml": cu.cyan_ml,
        "magenta_ml": cu.magenta_ml,
        "yellow_ml": cu.yellow_ml,
        "black_ml": cu.black_ml,
        "light_cyan_ml": cu.light_cyan_ml,
        "light_magenta_ml": cu.light_magenta_ml,
        "sheets_used": cu.sheets_used,
        "media_type": cu.media_type,
        "paper_size": cu.paper_size,
    })
}

fn parse_json_field(s: &str) -> Option<serde_json::Value> {
    if s.is_empty() {
        None
    } else {
        serde_json::from_str(s).ok()
    }
}

// ── Phase 4.5: Preview result handling ──

/// Handle preview result from agent — store image in Redis for CRM retrieval.
async fn handle_preview_result(
    shared: &BridgeShared,
    preview_id: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let result = proto::PreviewResult::decode(payload)?;

    if result.preview_image.is_empty() {
        tracing::warn!(preview_id, "Empty preview result received");
        return Ok(());
    }

    // Store preview image in Redis (TTL 5 minutes)
    let key = format!("print:preview:{}", result.job_id);
    let mut conn = shared.redis.clone();
    redis::cmd("SET")
        .arg(&key)
        .arg(result.preview_image.as_slice())
        .arg("EX")
        .arg(300) // 5 min TTL
        .query_async::<()>(&mut conn)
        .await?;

    tracing::info!(
        preview_id = %result.job_id,
        size = result.preview_image.len(),
        "Preview result stored in Redis"
    );

    // Notify CRM via Redis pub/sub
    let notify_payload = serde_json::json!({
        "preview_id": result.job_id,
        "status": "ready",
        "size": result.preview_image.len(),
    });
    let _ = redis::cmd("PUBLISH")
        .arg("print:preview_ready")
        .arg(notify_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

// ── Phase 4.3: Consumable stock deduction ──

async fn estimated_consumable_usage_for_job(
    shared: &BridgeShared,
    job_id: Uuid,
) -> Option<serde_json::Value> {
    match sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT consumable_usage FROM print_jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_optional(&shared.db)
    .await
    {
        Ok(value) => value.flatten(),
        Err(e) => {
            tracing::warn!(job_id = %job_id, error = %e, "Failed to load estimated consumable usage");
            None
        }
    }
}

/// Deduct consumable usage from stock after a print job completes.
async fn deduct_consumable_stock(
    shared: &BridgeShared,
    studio_id: Uuid,
    job_id: Uuid,
    usage: &proto::ConsumableUsage,
) {
    // Find the station (bridge device) for this studio
    let station_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM bridge_devices WHERE studio_id = $1 AND is_active = TRUE AND agent_type = 'print' LIMIT 1"
    )
    .bind(studio_id)
    .fetch_optional(&shared.db)
    .await
    .ok()
    .flatten();

    let Some(station_id) = station_id else { return };

    // Deduct ink from consumable_stock
    let ink_deductions = [
        ("cyan_ink", usage.cyan_ml),
        ("magenta_ink", usage.magenta_ml),
        ("yellow_ink", usage.yellow_ml),
        ("black_ink", usage.black_ml),
        ("light_cyan_ink", usage.light_cyan_ml),
        ("light_magenta_ink", usage.light_magenta_ml),
    ];

    for (consumable_type, amount) in &ink_deductions {
        if *amount <= 0.0 {
            continue;
        }

        // Deduct from stock
        let result = sqlx::query(
            r#"UPDATE consumable_stock
               SET current_amount = GREATEST(0, current_amount - $3), updated_at = NOW()
               WHERE station_id = $1 AND consumable_type = $2"#,
        )
        .bind(station_id)
        .bind(consumable_type)
        .bind(*amount as f64)
        .execute(&shared.db)
        .await;

        if let Err(e) = result {
            tracing::warn!(
                consumable_type,
                error = %e,
                "Failed to deduct consumable stock"
            );
        }

        // Record transaction
        let _ = sqlx::query(
            r#"INSERT INTO consumable_transactions (stock_id, job_id, transaction_type, amount, notes)
               SELECT cs.id, $3, 'usage', $4, $5
               FROM consumable_stock cs
               WHERE cs.station_id = $1 AND cs.consumable_type = $2"#,
        )
        .bind(station_id)
        .bind(consumable_type)
        .bind(job_id)
        .bind(-(*amount as f64))
        .bind(format!("Auto-deduct: print job {job_id}"))
        .execute(&shared.db)
        .await;
    }

    // Deduct paper
    if usage.sheets_used > 0 {
        let paper_type = if usage.paper_size.is_empty() {
            "paper_generic"
        } else {
            &usage.paper_size
        };

        let _ = sqlx::query(
            r#"UPDATE consumable_stock
               SET current_amount = GREATEST(0, current_amount - $3), updated_at = NOW()
               WHERE station_id = $1 AND consumable_type LIKE '%paper%'"#,
        )
        .bind(station_id)
        .bind(paper_type)
        .bind(usage.sheets_used as f64)
        .execute(&shared.db)
        .await;
    }

    // Check for low stock alerts and send Telegram notification
    check_low_stock_alerts(shared, station_id).await;
}

/// Deduct toner percentage from stock using coverage-derived job estimate.
async fn deduct_estimated_toner_stock(
    shared: &BridgeShared,
    studio_id: Uuid,
    job_id: Uuid,
    usage: &serde_json::Value,
) {
    let source = usage.get("source").and_then(serde_json::Value::as_str);
    if !matches!(
        source,
        Some("coverage_estimate") | Some("coverage_estimate_child")
    ) {
        return;
    }

    let Some(toner_percent) = usage
        .get("toner_percent")
        .and_then(serde_json::Value::as_object)
    else {
        return;
    };

    let station_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM bridge_devices WHERE studio_id = $1 AND is_active = TRUE AND agent_type = 'print' LIMIT 1"
    )
    .bind(studio_id)
    .fetch_optional(&shared.db)
    .await
    .ok()
    .flatten();

    let Some(station_id) = station_id else { return };

    let deductions = [
        ("black", "toner_black"),
        ("cyan", "toner_cyan"),
        ("magenta", "toner_magenta"),
        ("yellow", "toner_yellow"),
    ];
    let mut deducted_any = false;

    for (coverage_key, consumable_type) in deductions {
        let amount = toner_percent
            .get(coverage_key)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(0.0);

        if amount <= 0.0 {
            continue;
        }

        let result = sqlx::query(
            r#"UPDATE consumable_stock
               SET current_amount = GREATEST(0, current_amount - $3), updated_at = NOW()
               WHERE station_id = $1 AND consumable_type = $2"#,
        )
        .bind(station_id)
        .bind(consumable_type)
        .bind(amount)
        .execute(&shared.db)
        .await;

        match result {
            Ok(update) => {
                if update.rows_affected() == 0 {
                    tracing::debug!(
                        consumable_type,
                        station_id = %station_id,
                        "No stock row for coverage-derived toner deduction"
                    );
                    continue;
                }

                deducted_any = true;
            }
            Err(e) => {
                tracing::warn!(
                    consumable_type,
                    error = %e,
                    "Failed to deduct coverage-derived toner stock"
                );
                continue;
            }
        }

        let _ = sqlx::query(
            r#"INSERT INTO consumable_transactions (stock_id, job_id, transaction_type, amount, notes)
               SELECT cs.id, $3, 'usage', $4, $5
               FROM consumable_stock cs
               WHERE cs.station_id = $1 AND cs.consumable_type = $2"#,
        )
        .bind(station_id)
        .bind(consumable_type)
        .bind(job_id)
        .bind(-amount)
        .bind(format!("Auto-deduct coverage estimate: print job {job_id}"))
        .execute(&shared.db)
        .await;
    }

    if deducted_any {
        check_low_stock_alerts(shared, station_id).await;
    }
}

/// Check if any consumables are below threshold and send Telegram alert.
async fn check_low_stock_alerts(shared: &BridgeShared, station_id: Uuid) {
    #[derive(sqlx::FromRow)]
    struct LowStockAlert {
        consumable_type: String,
        current_amount: f64,
        low_threshold: f64,
        max_capacity: f64,
        unit: String,
    }

    let alerts: Vec<LowStockAlert> = sqlx::query_as(
        r#"SELECT consumable_type, current_amount, low_threshold, max_capacity, unit
           FROM consumable_stock
           WHERE station_id = $1 AND current_amount <= low_threshold AND current_amount > 0"#,
    )
    .bind(station_id)
    .fetch_all(&shared.db)
    .await
    .unwrap_or_default();

    if alerts.is_empty() {
        return;
    }

    // Get station name for the alert message
    let station_name: String = sqlx::query_scalar(
        "SELECT COALESCE(name, hostname, id::text) FROM bridge_devices WHERE id = $1",
    )
    .bind(station_id)
    .fetch_optional(&shared.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| station_id.to_string());

    let mut message = format!("⚠️ Низкий уровень расходников\nСтанция: {station_name}\n\n");
    for alert in &alerts {
        let percent = if alert.max_capacity > 0.0 {
            (alert.current_amount / alert.max_capacity * 100.0).round()
        } else {
            0.0
        };
        message.push_str(&format!(
            "• {} — {:.1} {} ({:.0}%)\n",
            alert.consumable_type, alert.current_amount, alert.unit, percent
        ));
    }

    send_telegram_alert(shared, &message).await;

    // Publish alert to Redis for CRM real-time notification
    let redis_payload = serde_json::json!({
        "type": "consumable_low",
        "station_id": station_id,
        "station_name": station_name,
        "alerts": alerts.iter().map(|a| serde_json::json!({
            "type": a.consumable_type,
            "current": a.current_amount,
            "threshold": a.low_threshold,
            "unit": a.unit,
        })).collect::<Vec<_>>(),
    });

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("print:consumable_alert")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;
}

// ── Phase 4.4: Supply-level sync from telemetry ──

/// Parse supplies_json from telemetry and UPSERT into consumable_stock.
/// Then check for low-level alerts with 24h dedup.
async fn sync_supplies_to_stock(
    shared: &BridgeShared,
    studio_id: Uuid,
    station_id: Uuid,
    supplies_json: &str,
) {
    if supplies_json.is_empty() {
        return;
    }

    #[derive(serde::Deserialize)]
    struct SupplyEntry {
        name: String,
        level_percent: f32,
        #[serde(default)]
        status: String,
    }

    let supplies: Vec<SupplyEntry> = match serde_json::from_str(supplies_json) {
        Ok(v) => v,
        Err(e) => {
            tracing::debug!(error = %e, "Could not parse supplies_json");
            return;
        }
    };

    if supplies.is_empty() {
        return;
    }

    let default_threshold: f64 = 15.0;

    for supply in &supplies {
        let consumable_type = format!("{}_ink", supply.name.to_lowercase().replace(' ', "_"));
        let level = supply.level_percent as f64;

        // UPSERT: update existing or create new consumable_stock row
        let result = sqlx::query(
            r#"INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold)
               VALUES ($1, $2, $3, 100, '%', $4)
               ON CONFLICT (station_id, consumable_type)
               DO UPDATE SET current_amount = $3, unit = '%', max_capacity = 100, updated_at = NOW()"#,
        )
        .bind(station_id)
        .bind(&consumable_type)
        .bind(level)
        .bind(default_threshold)
        .execute(&shared.db)
        .await;

        if let Err(e) = result {
            tracing::warn!(consumable = %consumable_type, error = %e, "Failed to upsert consumable_stock from telemetry");
        }

        // Check low threshold and create deduped alert
        let effective_threshold: f64 = sqlx::query_scalar(
            "SELECT COALESCE(low_threshold, $2) FROM consumable_stock WHERE station_id = $1 AND consumable_type = $3"
        )
        .bind(station_id)
        .bind(default_threshold)
        .bind(&consumable_type)
        .fetch_optional(&shared.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(default_threshold);

        if level <= effective_threshold {
            // Dedup: skip if unresolved alert of same type exists within 24 hours
            let existing: Option<i64> = sqlx::query_scalar(
                r#"SELECT id FROM infra_alerts
                   WHERE studio_id = $1 AND alert_type = 'consumable_low'
                     AND resolved_at IS NULL
                     AND created_at > NOW() - INTERVAL '24 hours'
                     AND details->>'consumable_type' = $2
                   LIMIT 1"#,
            )
            .bind(studio_id)
            .bind(&consumable_type)
            .fetch_optional(&shared.db)
            .await
            .ok()
            .flatten();

            if existing.is_none() {
                let station_name: String = sqlx::query_scalar(
                    "SELECT COALESCE(name, hostname, id::text) FROM bridge_devices WHERE id = $1",
                )
                .bind(station_id)
                .fetch_optional(&shared.db)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| station_id.to_string());

                let title = format!("Низкий уровень: {} ({:.0}%)", supply.name, level);
                let details = serde_json::json!({
                    "consumable_type": consumable_type,
                    "level_percent": level,
                    "threshold": effective_threshold,
                    "station_name": station_name,
                    "supply_status": supply.status,
                });

                let _ = sqlx::query(
                    r#"INSERT INTO infra_alerts (studio_id, alert_type, severity, title, details)
                       VALUES ($1, 'consumable_low', 'warning', $2, $3)"#,
                )
                .bind(studio_id)
                .bind(&title)
                .bind(&details)
                .execute(&shared.db)
                .await;

                // Publish to Redis for Socket.IO relay to CRM dashboard
                let mut conn = shared.redis.clone();
                let _ = redis::cmd("PUBLISH")
                    .arg("infra:alert")
                    .arg(
                        serde_json::json!({
                            "studio_id": studio_id,
                            "alert_type": "consumable_low",
                            "severity": "warning",
                            "title": title,
                            "consumable_type": consumable_type,
                            "level_percent": level,
                        })
                        .to_string(),
                    )
                    .query_async::<()>(&mut conn)
                    .await;

                tracing::info!(
                    station = %station_name,
                    consumable = %consumable_type,
                    level = %level,
                    "Low consumable alert created"
                );
            }
        }
    }
}

// ── Phase 5: POS Agent handlers ──

fn bank_report_from_receipt_data(receipt_data: &[u8]) -> Option<String> {
    let report = String::from_utf8_lossy(receipt_data).trim().to_owned();
    if report.is_empty() {
        None
    } else {
        Some(report)
    }
}

/// Handle POS transaction result from POS Agent (Protobuf PosTransactionResult).
async fn handle_pos_transaction_result(
    shared: &BridgeShared,
    studio_id_str: &str,
    tx_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let result = infra_proto::PosTransactionResult::decode(payload)?;
    let tx_id = Uuid::parse_str(tx_id_str)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;

    let db_status = if result.success {
        "completed"
    } else {
        "failed"
    };
    let error_msg = if result.error_message.is_empty() {
        None
    } else {
        Some(result.error_message.as_str())
    };

    let bank_report = bank_report_from_receipt_data(&result.receipt_data);

    // Build terminal_response JSONB
    let terminal_response = serde_json::json!({
        "approval_code": result.approval_code,
        "response_code": result.approval_code,
        "rrn": result.rrn,
        "card_mask": result.card_mask,
        "sbp_paid": result.sbp_paid,
        "bank_report": bank_report,
    });

    // Build fiscal_receipt JSONB
    let fiscal_receipt = serde_json::json!({
        "fiscal_number": result.fiscal_number,
        "fiscal_sign": result.fiscal_sign,
        "fiscal_receipt_url": result.fiscal_receipt_url,
    });

    sqlx::query(
        r#"UPDATE pos_transactions SET
             status = $2,
             error_message = $3,
             approval_code = $4,
             rrn = $5,
             card_mask = $6,
             fiscal_number = $7,
             fiscal_sign = $8,
             fiscal_receipt_url = $9,
             sbp_paid = $10,
             terminal_response = $11,
             fiscal_receipt = $12,
             completed_at = CASE WHEN $2 IN ('completed','failed') THEN NOW() ELSE completed_at END
           WHERE id = $1"#,
    )
    .bind(tx_id)
    .bind(db_status)
    .bind(error_msg)
    .bind(if result.approval_code.is_empty() {
        None
    } else {
        Some(&result.approval_code)
    })
    .bind(if result.rrn.is_empty() {
        None
    } else {
        Some(&result.rrn)
    })
    .bind(if result.card_mask.is_empty() {
        None
    } else {
        Some(&result.card_mask)
    })
    .bind(if result.fiscal_number.is_empty() {
        None
    } else {
        Some(&result.fiscal_number)
    })
    .bind(if result.fiscal_sign.is_empty() {
        None
    } else {
        Some(&result.fiscal_sign)
    })
    .bind(if result.fiscal_receipt_url.is_empty() {
        None
    } else {
        Some(&result.fiscal_receipt_url)
    })
    .bind(result.sbp_paid)
    .bind(&terminal_response)
    .bind(&fiscal_receipt)
    .execute(&shared.db)
    .await?;

    tracing::info!(
        tx_id = %tx_id,
        status = db_status,
        "POS transaction result updated"
    );

    // Publish to Redis for CRM real-time
    let redis_payload =
        pos_transaction_update_payload(&result, tx_id, studio_id, db_status, error_msg);

    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("pos:transaction_update")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

fn pos_transaction_update_payload(
    result: &infra_proto::PosTransactionResult,
    tx_id: Uuid,
    studio_id: Uuid,
    db_status: &str,
    error_msg: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "type": "pos_transaction",
        "transaction_id": tx_id,
        "studio_id": studio_id,
        "status": db_status,
        "success": result.success,
        "approval_code": result.approval_code,
        "rrn": result.rrn,
        "card_mask": result.card_mask,
        "fiscal_number": result.fiscal_number,
        "fiscal_sign": result.fiscal_sign,
        "fiscal_receipt_url": result.fiscal_receipt_url,
        "bank_report": bank_report_from_receipt_data(&result.receipt_data),
        "error_message": error_msg,
    })
}

/// Handle POS shift result.
async fn handle_pos_shift_result(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let studio_id = Uuid::parse_str(studio_id_str)?;
    let result = parse_pos_shift_result_payload(payload)?;
    let db_status = result.db_status();
    let error_message = result.error_message.as_deref();

    let update = sqlx::query(
        r#"UPDATE pos_transactions SET
             status = $2,
             error_message = $3,
             completed_at = NOW()
           WHERE id = $1
             AND studio_id = $4
             AND transaction_type IN ('shift_open', 'shift_close')"#,
    )
    .bind(result.command_id)
    .bind(db_status)
    .bind(error_message)
    .bind(studio_id)
    .execute(&shared.db)
    .await?;

    if update.rows_affected() == 0 {
        tracing::warn!(
            tx_id = %result.command_id,
            studio = %studio_id,
            action = %result.action,
            success = result.success,
            "POS shift result did not match a shift transaction"
        );
    }

    tracing::info!(
        tx_id = %result.command_id,
        studio = %studio_id,
        action = %result.action,
        status = db_status,
        "POS shift result"
    );

    // Publish to Redis for CRM
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("pos:shift_update")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "result": result.to_json(),
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedPosShiftResult {
    command_id: Uuid,
    success: bool,
    error_message: Option<String>,
    action: String,
    timestamp_ms: i64,
}

impl ParsedPosShiftResult {
    fn db_status(&self) -> &'static str {
        if self.success { "completed" } else { "failed" }
    }

    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "command_id": self.command_id,
            "success": self.success,
            "error_message": self.error_message.as_deref().unwrap_or(""),
            "action": self.action,
            "timestamp_ms": self.timestamp_ms,
        })
    }
}

#[derive(serde::Deserialize)]
struct LegacyPosShiftResult {
    command_id: String,
    success: bool,
    #[serde(default)]
    error_message: String,
    action: String,
    #[serde(default)]
    timestamp_ms: i64,
}

fn parse_pos_shift_result_payload(
    payload: &[u8],
) -> Result<ParsedPosShiftResult, Box<dyn std::error::Error + Send + Sync>> {
    if let Ok(result) = serde_json::from_slice::<LegacyPosShiftResult>(payload) {
        return parsed_pos_shift_result(
            &result.command_id,
            result.success,
            result.error_message,
            result.action,
            result.timestamp_ms,
        );
    }

    let msg = infra_proto::PosShiftResult::decode(payload)?;
    parsed_pos_shift_result(
        &msg.command_id,
        msg.success,
        msg.error_message,
        msg.action,
        msg.timestamp_ms,
    )
}

fn parsed_pos_shift_result(
    command_id: &str,
    success: bool,
    error_message: String,
    action: String,
    timestamp_ms: i64,
) -> Result<ParsedPosShiftResult, Box<dyn std::error::Error + Send + Sync>> {
    Ok(ParsedPosShiftResult {
        command_id: Uuid::parse_str(command_id)?,
        success,
        error_message: if error_message.is_empty() {
            None
        } else {
            Some(error_message)
        },
        action,
        timestamp_ms,
    })
}

/// Handle SBP QR result — store in Redis for CRM retrieval.
async fn handle_pos_sbp_qr_result(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let result = infra_proto::PosSbpQrResult::decode(payload)?;

    if result.success {
        // Store QR data in Redis (TTL 10 minutes)
        let key = format!("pos:sbp_qr:{}", result.transaction_id);
        let qr_data = serde_json::json!({
            "qr_data": result.qr_data,
            "qr_image": base64_encode(&result.qr_image),
        });

        let mut conn = shared.redis.clone();
        redis::cmd("SET")
            .arg(&key)
            .arg(qr_data.to_string())
            .arg("EX")
            .arg(600) // 10 min TTL
            .query_async::<()>(&mut conn)
            .await?;

        tracing::info!(
            transaction_id = %result.transaction_id,
            "SBP QR stored in Redis"
        );

        // Notify CRM
        let _ = redis::cmd("PUBLISH")
            .arg("pos:sbp_qr_ready")
            .arg(
                serde_json::json!({
                    "studio_id": studio_id_str,
                    "transaction_id": result.transaction_id,
                    "qr_data": result.qr_data,
                })
                .to_string(),
            )
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(())
}

/// Handle POS telemetry (terminal + fiscal health).
async fn handle_pos_telemetry(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let telem = infra_proto::PosTelemetry::decode(payload)?;

    tracing::debug!(
        studio = %studio_id_str,
        terminal = telem.terminal_online,
        fiscal = telem.fiscal_online,
        "POS telemetry"
    );

    if let Ok(studio_id) = Uuid::parse_str(studio_id_str) {
        let updated = sqlx::query(
            r#"UPDATE agents SET
                 is_online = TRUE,
                 last_heartbeat_at = NOW(),
                 last_connected_at = COALESCE(last_connected_at, NOW())
               WHERE studio_id = $1
                 AND agent_type = 'pos'
                 AND is_active = TRUE"#,
        )
        .bind(studio_id)
        .execute(&shared.db)
        .await?
        .rows_affected();

        if updated == 0 {
            tracing::warn!(
                studio = %studio_id,
                "POS telemetry received but no active pos agent row matched"
            );
        }
    }

    // Publish to Redis for CRM real-time dashboard
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("pos:telemetry")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_id": telem.agent_id,
                "terminal_online": telem.terminal_online,
                "fiscal_online": telem.fiscal_online,
                "shift_status": telem.shift_status,
                "timestamp_ms": telem.timestamp_ms,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

fn base64_encode(data: &[u8]) -> String {
    // Simple base64 encode using standard alphabet
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let combined = (b0 << 16) | (b1 << 8) | b2;
        result.push(ALPHABET[((combined >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((combined >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(ALPHABET[((combined >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(ALPHABET[(combined & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ── Guard-agent event handlers ──

/// Handle CDR scan result from guard agent (JSON).
/// Inserts into security_events and updates cdr_stats daily aggregate.
async fn handle_guard_scan(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if payload.iter().all(|b| b.is_ascii_whitespace()) {
        tracing::debug!(studio = %studio_id_str, "Skipping empty guard scan payload");
        return Ok(());
    }

    let scan: serde_json::Value = match serde_json::from_slice(payload) {
        Ok(scan) => scan,
        Err(e) => {
            tracing::warn!(studio = %studio_id_str, error = %e, "Skipping malformed guard scan payload");
            return Ok(());
        }
    };

    let studio_id = Uuid::parse_str(studio_id_str)?;
    let agent_id_str = scan.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    let agent_id = match Uuid::parse_str(agent_id_str) {
        Ok(agent_id) => agent_id,
        Err(e) => {
            tracing::warn!(
                studio = %studio_id,
                agent_id = %agent_id_str,
                error = %e,
                "Skipping guard scan payload without valid agent_id"
            );
            return Ok(());
        }
    };

    let file_name = scan.get("file_name").and_then(|v| v.as_str());
    let file_hash = scan.get("file_hash").and_then(|v| v.as_str());
    let original_size = scan.get("original_size").and_then(|v| v.as_i64());
    let clean_size = scan.get("clean_size").and_then(|v| v.as_i64());
    let details = scan.get("details").cloned().unwrap_or_default();

    sqlx::query(
        r#"INSERT INTO security_events (agent_id, studio_id, event_type, file_name, file_hash, original_size, clean_size, details)
           VALUES ($1, $2, 'scan', $3, $4, $5, $6, $7)"#,
    )
    .bind(agent_id)
    .bind(studio_id)
    .bind(file_name)
    .bind(file_hash)
    .bind(original_size)
    .bind(clean_size)
    .bind(&details)
    .execute(&shared.db)
    .await?;

    // Update daily CDR stats aggregate
    let was_cleaned = clean_size.unwrap_or(0) != original_size.unwrap_or(0) && clean_size.is_some();
    sqlx::query(
        r#"INSERT INTO cdr_stats (agent_id, studio_id, date, files_scanned, files_cleaned)
           VALUES ($1, $2, CURRENT_DATE, 1, $3)
           ON CONFLICT (agent_id, date) DO UPDATE SET
             files_scanned = cdr_stats.files_scanned + 1,
             files_cleaned = cdr_stats.files_cleaned + EXCLUDED.files_cleaned"#,
    )
    .bind(agent_id)
    .bind(studio_id)
    .bind(if was_cleaned { 1 } else { 0 })
    .execute(&shared.db)
    .await?;

    tracing::debug!(studio = %studio_id, file = ?file_name, "Guard scan event stored");

    // Publish to Redis for CRM real-time (Socket.IO relay)
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:security_event")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_type": "guard",
                "event_type": "scan",
                "file_name": file_name,
                "was_cleaned": was_cleaned,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

/// Handle security threat event from guard agent (JSON).
/// Inserts into security_events + infra_alerts, sends Telegram for critical threats.
async fn handle_guard_threat(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let threat: serde_json::Value = serde_json::from_slice(payload)?;

    let studio_id = Uuid::parse_str(studio_id_str)?;
    let agent_id_str = threat
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let agent_id = Uuid::parse_str(agent_id_str)?;

    let file_name = threat.get("file_name").and_then(|v| v.as_str());
    let threat_type = threat
        .get("threat_type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let details = threat.get("details").cloned().unwrap_or_default();

    // Insert security event
    sqlx::query(
        r#"INSERT INTO security_events (agent_id, studio_id, event_type, file_name, threat_type, details)
           VALUES ($1, $2, 'threat', $3, $4, $5)"#,
    )
    .bind(agent_id)
    .bind(studio_id)
    .bind(file_name)
    .bind(threat_type)
    .bind(&details)
    .execute(&shared.db)
    .await?;

    // Update daily stats — quarantined
    sqlx::query(
        r#"INSERT INTO cdr_stats (agent_id, studio_id, date, files_scanned, files_quarantined)
           VALUES ($1, $2, CURRENT_DATE, 0, 1)
           ON CONFLICT (agent_id, date) DO UPDATE SET
             files_quarantined = cdr_stats.files_quarantined + 1"#,
    )
    .bind(agent_id)
    .bind(studio_id)
    .execute(&shared.db)
    .await?;

    // Insert infra alert
    let alert_title = format!("Угроза: {threat_type}");
    let alert_details = serde_json::json!({
        "file_name": file_name,
        "threat_type": threat_type,
        "source": "guard_agent",
    });

    sqlx::query(
        r#"INSERT INTO infra_alerts (studio_id, agent_id, alert_type, severity, title, details)
           VALUES ($1, $2, 'threat_detected', 'critical', $3, $4)"#,
    )
    .bind(studio_id)
    .bind(agent_id)
    .bind(&alert_title)
    .bind(&alert_details)
    .execute(&shared.db)
    .await?;

    tracing::warn!(studio = %studio_id, threat = %threat_type, file = ?file_name, "Guard threat detected!");

    // Redis for CRM real-time — alert channel (infra dashboard)
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:alert")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_type": "guard",
                "alert_type": "threat_detected",
                "severity": "critical",
                "title": &alert_title,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    // Redis — security_event channel (Socket.IO relay for security panel)
    let _ = redis::cmd("PUBLISH")
        .arg("infra:security_event")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_type": "guard",
                "event_type": "threat",
                "threat_type": threat_type,
                "file_name": file_name,
                "severity": "critical",
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    // Telegram notification
    let msg = format!(
        "\u{1F6E1} <b>GUARD: Угроза обнаружена</b>\nТочка: {studio_id_str}\nТип: {threat_type}\nФайл: {}",
        file_name.unwrap_or("N/A")
    );
    send_telegram_alert(shared, &msg).await;

    Ok(())
}

fn is_agent_type(s: &str) -> bool {
    matches!(s, "print" | "pos" | "vision" | "monitor" | "guard")
}

fn is_generic_agent_telemetry_topic(parts: &[&str]) -> bool {
    parts.len() == 4 && parts[3] == "telemetry" && parts[2] != "pos" && is_agent_type(parts[2])
}

// ── Infrastructure v2 handlers ──

/// Handle heartbeat from any agent type (new multi-agent topics).
async fn handle_agent_heartbeat(
    shared: &BridgeShared,
    studio_id_str: &str,
    agent_type: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Try Protobuf first (Rust agents send AgentHeartbeat protobuf)
    let (agent_id_str, version, hostname, os_info, os_arch, uptime, _config_version) =
        if let Ok(pb) = crate::infra_proto::AgentHeartbeat::decode(payload) {
            (
                pb.agent_id.clone(),
                if pb.version.is_empty() {
                    None
                } else {
                    Some(pb.version.clone())
                },
                if pb.hostname.is_empty() {
                    None
                } else {
                    Some(pb.hostname.clone())
                },
                if pb.os_info.is_empty() {
                    None
                } else {
                    Some(pb.os_info.clone())
                },
                if pb.os_arch.is_empty() {
                    None
                } else {
                    Some(pb.os_arch.clone())
                },
                pb.uptime_seconds,
                pb.config_version,
            )
        } else {
            // Fallback to JSON (legacy agents)
            let hb: serde_json::Value =
                serde_json::from_slice(payload).unwrap_or_else(|_| serde_json::json!({}));
            (
                hb.get("agent_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                hb.get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                hb.get("hostname")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                hb.get("os_info")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                hb.get("os_arch")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                hb.get("uptime_seconds")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                hb.get("config_version")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32,
            )
        };

    // Also update bridge_devices for backward compat (preview handler looks there)
    if let Ok(studio_id) = Uuid::parse_str(studio_id_str) {
        sqlx::query(
            r#"UPDATE bridge_devices SET
                 is_online = TRUE,
                 last_heartbeat_at = NOW(),
                 last_connected_at = COALESCE(last_connected_at, NOW()),
                 hostname = COALESCE($3, hostname),
                 bridge_version = COALESCE($4, bridge_version),
                 os_version = COALESCE($5, os_version)
               WHERE studio_id = $1 AND agent_type = $2 AND is_active = TRUE"#,
        )
        .bind(studio_id)
        .bind(agent_type)
        .bind(hostname.as_deref())
        .bind(version.as_deref())
        .bind(os_info.as_deref())
        .execute(&shared.db)
        .await?;
    }

    let version_ref = version.as_deref();
    let hostname_ref = hostname.as_deref();
    let os_info_ref = os_info.as_deref();
    let os_arch_ref = os_arch.as_deref();

    // Update agents table
    if let Ok(agent_id) = Uuid::parse_str(&agent_id_str) {
        sqlx::query(
            r#"UPDATE agents SET
                 is_online = TRUE,
                 last_heartbeat_at = NOW(),
                 current_version = COALESCE($2, current_version),
                 hostname = COALESCE($3, hostname),
                 os_version = COALESCE($4, os_version),
                 os_arch = COALESCE($5, os_arch),
                 uptime_seconds = $6
               WHERE id = $1"#,
        )
        .bind(agent_id)
        .bind(version_ref)
        .bind(hostname_ref)
        .bind(os_info_ref)
        .bind(os_arch_ref)
        .bind(uptime)
        .execute(&shared.db)
        .await?;
    } else if let Ok(studio_id) = Uuid::parse_str(studio_id_str) {
        // Fallback: find agent by studio_id + agent_type
        sqlx::query(
            r#"UPDATE agents SET
                 is_online = TRUE,
                 last_heartbeat_at = NOW(),
                 current_version = COALESCE($3, current_version),
                 hostname = COALESCE($4, hostname),
                 os_version = COALESCE($5, os_version),
                 os_arch = COALESCE($6, os_arch),
                 uptime_seconds = $7
               WHERE studio_id = $1 AND agent_type = $2"#,
        )
        .bind(studio_id)
        .bind(agent_type)
        .bind(version_ref)
        .bind(hostname_ref)
        .bind(os_info_ref)
        .bind(os_arch_ref)
        .bind(uptime)
        .execute(&shared.db)
        .await?;
    }

    // Publish to Redis for CRM real-time
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:heartbeat")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_type": agent_type,
                "agent_id": agent_id_str,
                "version": version_ref,
                "is_online": true,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    // Auto-resolve heartbeat_timeout alerts when agent comes back
    if let (Ok(agent_id), Ok(studio_id)) = (
        Uuid::parse_str(&agent_id_str),
        Uuid::parse_str(studio_id_str),
    ) {
        scheduler::auto_resolve_heartbeat_alerts(
            &shared.db, &mut conn, agent_id, studio_id, agent_type,
        )
        .await;
    } else if let Ok(studio_id) = Uuid::parse_str(studio_id_str) {
        // Fallback: find agent_id by studio_id + agent_type
        if let Ok(Some(agent_id)) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM agents WHERE studio_id = $1 AND agent_type = $2",
        )
        .bind(studio_id)
        .bind(agent_type)
        .fetch_optional(&shared.db)
        .await
        {
            scheduler::auto_resolve_heartbeat_alerts(
                &shared.db, &mut conn, agent_id, studio_id, agent_type,
            )
            .await;
        }
    }

    Ok(())
}

/// Handle system telemetry from any agent type.
async fn handle_agent_telemetry(
    shared: &BridgeShared,
    studio_id_str: &str,
    agent_type: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing::debug!(studio = %studio_id_str, agent_type = %agent_type, "Agent telemetry received");

    if agent_type == "print" {
        return handle_print_agent_telemetry(shared, studio_id_str, payload).await;
    }

    Ok(())
}

/// Handle telemetry from Rust print-agent.
/// The agent sends Protobuf TelemetryReport but with printer NAME (not UUID) in printer_id field.
/// We resolve the name to UUID via the printers table.
async fn handle_print_agent_telemetry(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let report = proto::TelemetryReport::decode(payload)?;
    let studio_id = Uuid::parse_str(studio_id_str)?;

    if report.printer_id.is_empty() {
        tracing::warn!(studio = %studio_id, "Print agent telemetry without printer_id");
        return Ok(());
    }

    // printer_id from agent = Windows printer name (e.g. "Epson L8050"), resolve to UUID
    let printer_id = if let Ok(uuid) = Uuid::parse_str(&report.printer_id) {
        uuid
    } else {
        let resolved =
            resolve_print_telemetry_printer(shared, studio_id, &report.printer_id).await?;

        match resolved {
            Some(id) => id,
            None => {
                tracing::debug!(
                    printer_name = %report.printer_id, studio = %studio_id,
                    "Unknown or ambiguous printer name in telemetry, skipping"
                );
                return Ok(());
            }
        }
    };

    let bridge_id =
        resolve_print_telemetry_bridge_device(shared, studio_id, &report.bridge_id).await?;

    let supplies: Option<serde_json::Value> = parse_json_field(&report.supplies_json);
    let trays: Option<serde_json::Value> = parse_json_field(&report.trays_json);
    let counters: Option<serde_json::Value> = parse_json_field(&report.counters_json);
    let errors: Option<serde_json::Value> = parse_json_field(&report.errors_json);

    sqlx::query(
        r#"INSERT INTO printer_telemetry (
             printer_id, studio_id, bridge_device_id,
             is_online, state, state_reasons,
             supplies, trays, counters, errors,
             model, manufacturer, serial_number, firmware_version,
             collected_at
           ) VALUES (
             $1, $2, $3,
             $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14,
             NOW()
           )"#,
    )
    .bind(printer_id)
    .bind(studio_id)
    .bind(bridge_id)
    .bind(report.is_online)
    .bind(&report.state)
    .bind(&report.state_reasons)
    .bind(&supplies)
    .bind(&trays)
    .bind(&counters)
    .bind(&errors)
    .bind(if report.model.is_empty() {
        None
    } else {
        Some(&report.model)
    })
    .bind(if report.manufacturer.is_empty() {
        None
    } else {
        Some(&report.manufacturer)
    })
    .bind(if report.serial_number.is_empty() {
        None
    } else {
        Some(&report.serial_number)
    })
    .bind(if report.firmware_version.is_empty() {
        None
    } else {
        Some(&report.firmware_version)
    })
    .execute(&shared.db)
    .await?;

    tracing::debug!(printer = %report.printer_id, state = %report.state, "Print agent telemetry stored");

    // Publish to Redis for Socket.IO real-time
    let redis_payload = serde_json::json!({
        "studio_id": studio_id,
        "printer_id": printer_id,
        "state": report.state,
        "is_online": report.is_online,
    });
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("print:telemetry")
        .arg(redis_payload.to_string())
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct TelemetryPrinterLookupRow {
    id: Uuid,
    name: String,
    cups_printer_name: Option<String>,
    capabilities: serde_json::Value,
}

async fn resolve_print_telemetry_printer(
    shared: &BridgeShared,
    studio_id: Uuid,
    reported_name: &str,
) -> Result<Option<Uuid>, Box<dyn std::error::Error + Send + Sync>> {
    let exact = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM printers
           WHERE studio_id = $2
             AND is_active = TRUE
             AND (lower(name) = lower($1) OR lower(cups_printer_name) = lower($1))
           LIMIT 1"#,
    )
    .bind(reported_name)
    .bind(studio_id)
    .fetch_optional(&shared.db)
    .await?;

    if exact.is_some() {
        return Ok(exact);
    }

    let rows = sqlx::query_as::<_, TelemetryPrinterLookupRow>(
        r#"SELECT id, name, cups_printer_name, capabilities
           FROM printers
           WHERE studio_id = $1 AND is_active = TRUE"#,
    )
    .bind(studio_id)
    .fetch_all(&shared.db)
    .await?;

    Ok(match_unique_printer_lookup(&rows, reported_name))
}

async fn resolve_print_telemetry_bridge_device(
    shared: &BridgeShared,
    studio_id: Uuid,
    reported_bridge_id: &str,
) -> Result<Option<Uuid>, Box<dyn std::error::Error + Send + Sync>> {
    let bridge_id = reported_bridge_id.trim();
    if bridge_id.is_empty() {
        return Ok(None);
    }

    if let Ok(uuid) = Uuid::parse_str(bridge_id) {
        let bridge_device = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM bridge_devices
               WHERE id = $1
                 AND is_active = TRUE
                 AND (studio_id = $2 OR studio_id IS NULL)
               LIMIT 1"#,
        )
        .bind(uuid)
        .bind(studio_id)
        .fetch_optional(&shared.db)
        .await?;

        if bridge_device.is_some() {
            return Ok(bridge_device);
        }

        tracing::debug!(
            bridge_id = %uuid,
            studio = %studio_id,
            "Print telemetry bridge_id is not a bridge_devices id, storing without bridge_device_id"
        );
        return Ok(None);
    }

    let bridge_device = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM bridge_devices
           WHERE studio_id = $2
             AND is_active = TRUE
             AND agent_type = 'print'
             AND (name = $1 OR hostname = $1 OR id::text = $1)
           LIMIT 1"#,
    )
    .bind(bridge_id)
    .bind(studio_id)
    .fetch_optional(&shared.db)
    .await?;

    Ok(bridge_device)
}

fn match_unique_printer_lookup(
    rows: &[TelemetryPrinterLookupRow],
    reported_name: &str,
) -> Option<Uuid> {
    let reported_norm = normalize_printer_lookup_name(reported_name);

    let normalized_matches: Vec<Uuid> = rows
        .iter()
        .filter(|row| {
            printer_lookup_names(row)
                .iter()
                .any(|name| normalize_printer_lookup_name(name) == reported_norm)
        })
        .map(|row| row.id)
        .collect();

    if normalized_matches.len() == 1 {
        return normalized_matches.first().copied();
    }

    let reported_tokens = printer_model_tokens(reported_name);
    if reported_tokens.is_empty() {
        return None;
    }

    let reported_side = printer_side(reported_name);
    let model_matches: Vec<Uuid> = rows
        .iter()
        .filter(|row| {
            printer_lookup_names(row).iter().any(|name| {
                if let Some(side) = reported_side {
                    if printer_side(name) != Some(side) {
                        return false;
                    }
                }

                model_tokens_match(&reported_tokens, &printer_model_tokens(name))
            })
        })
        .map(|row| row.id)
        .collect();

    if model_matches.len() == 1 {
        model_matches.first().copied()
    } else {
        None
    }
}

fn printer_lookup_names(row: &TelemetryPrinterLookupRow) -> Vec<String> {
    let mut names = vec![row.name.clone()];
    if let Some(cups_name) = row.cups_printer_name.as_deref() {
        names.push(cups_name.to_string());
    }

    for key in [
        "telemetry_aliases",
        "printer_aliases",
        "aliases",
        "agent_names",
        "cups_aliases",
    ] {
        append_string_array(&row.capabilities, key, &mut names);
    }

    for section in ["telemetry", "mqtt", "agent"] {
        if let Some(value) = row.capabilities.get(section) {
            append_string_array(value, "aliases", &mut names);
            append_string_value(value, "printer_id", &mut names);
            append_string_value(value, "printer_name", &mut names);
            append_string_value(value, "name", &mut names);
        }
    }

    names
}

fn append_string_array(value: &serde_json::Value, key: &str, out: &mut Vec<String>) {
    if let Some(items) = value.get(key).and_then(serde_json::Value::as_array) {
        for item in items {
            if let Some(s) = item.as_str().filter(|s| !s.trim().is_empty()) {
                out.push(s.trim().to_string());
            }
        }
    }
}

fn append_string_value(value: &serde_json::Value, key: &str, out: &mut Vec<String>) {
    if let Some(s) = value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        out.push(s.trim().to_string());
    }
}

fn normalize_printer_lookup_name(value: &str) -> String {
    let mut normalized = String::new();
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            normalized.push(ch);
        }
    }
    normalized
}

fn printer_side(value: &str) -> Option<&'static str> {
    let normalized = normalize_printer_lookup_name(value);
    if normalized.contains("left") || normalized.contains("лев") {
        Some("left")
    } else if normalized.contains("right") || normalized.contains("прав") {
        Some("right")
    } else {
        None
    }
}

fn printer_model_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            current.push(ch);
            continue;
        }

        if !current.is_empty() {
            if current.len() >= 3 && current.chars().any(|c| c.is_ascii_digit()) {
                tokens.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }

    if current.len() >= 3 && current.chars().any(|c| c.is_ascii_digit()) {
        tokens.push(current);
    }

    tokens
}

fn model_tokens_match(left: &[String], right: &[String]) -> bool {
    left.iter().any(|a| {
        right
            .iter()
            .any(|b| a == b || (a.len() >= 4 && b.len() >= 4 && (a.contains(b) || b.contains(a))))
    })
}

#[derive(Debug, PartialEq)]
struct ParsedAgentAlert {
    agent_id: Option<Uuid>,
    alert_type: String,
    severity: String,
    title: String,
    details: serde_json::Value,
}

fn details_json_from_str(value: &str) -> serde_json::Value {
    if value.trim().is_empty() {
        return serde_json::json!({});
    }

    serde_json::from_str(value).unwrap_or_else(|_| serde_json::json!({ "raw": value }))
}

fn parse_json_agent_alert(alert: serde_json::Value) -> ParsedAgentAlert {
    let agent_id = alert
        .get("agent_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    let alert_type = alert
        .get("alert_type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_owned();
    let severity = alert
        .get("severity")
        .and_then(|v| v.as_str())
        .unwrap_or("warning")
        .to_owned();
    let title = alert
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Agent alert")
        .to_owned();
    let details = alert
        .get("details")
        .cloned()
        .or_else(|| {
            alert
                .get("details_json")
                .and_then(|v| v.as_str())
                .map(details_json_from_str)
        })
        .unwrap_or_else(|| serde_json::json!({}));

    ParsedAgentAlert {
        agent_id,
        alert_type,
        severity,
        title,
        details,
    }
}

fn parse_agent_alert_payload(
    payload: &[u8],
) -> Result<ParsedAgentAlert, Box<dyn std::error::Error + Send + Sync>> {
    if let Ok(alert) = serde_json::from_slice::<serde_json::Value>(payload) {
        return Ok(parse_json_agent_alert(alert));
    }

    let alert = infra_proto::AgentAlert::decode(payload)?;
    let agent_id = Uuid::parse_str(&alert.agent_id).ok();

    Ok(ParsedAgentAlert {
        agent_id,
        alert_type: if alert.alert_type.is_empty() {
            "unknown".into()
        } else {
            alert.alert_type
        },
        severity: if alert.severity.is_empty() {
            "warning".into()
        } else {
            alert.severity
        },
        title: if alert.title.is_empty() {
            "Agent alert".into()
        } else {
            alert.title
        },
        details: details_json_from_str(&alert.details_json),
    })
}

/// Handle alert from agent (device errors, critical issues).
async fn handle_agent_alert(
    shared: &BridgeShared,
    studio_id_str: &str,
    agent_type: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if payload.iter().all(|b| b.is_ascii_whitespace()) {
        tracing::debug!(
            studio = %studio_id_str,
            agent_type,
            "Skipping empty agent alert payload"
        );
        return Ok(());
    }

    let alert = match parse_agent_alert_payload(payload) {
        Ok(alert) => alert,
        Err(e) => {
            tracing::warn!(
                studio = %studio_id_str,
                agent_type,
                error = %e,
                "Skipping malformed agent alert payload"
            );
            return Ok(());
        }
    };

    let studio_id = Uuid::parse_str(studio_id_str)?;

    sqlx::query(
        r#"INSERT INTO infra_alerts (studio_id, agent_id, alert_type, severity, title, details)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(studio_id)
    .bind(alert.agent_id)
    .bind(&alert.alert_type)
    .bind(&alert.severity)
    .bind(&alert.title)
    .bind(&alert.details)
    .execute(&shared.db)
    .await?;

    // Redis for CRM real-time
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:alert")
        .arg(
            serde_json::json!({
                "studio_id": studio_id_str,
                "agent_type": agent_type,
                "alert_type": &alert.alert_type,
                "severity": &alert.severity,
                "title": &alert.title,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    // Telegram for critical alerts
    if alert.severity == "critical" {
        let msg = format!(
            "🚨 <b>INFRA ALERT</b>\n{title}\nТочка: {studio_id_str}\nАгент: {agent_type}\nТип: {alert_type}",
            title = &alert.title,
            alert_type = &alert.alert_type,
        );
        send_telegram_alert(shared, &msg).await;
    }

    Ok(())
}

/// Handle config acknowledgement from agent.
async fn handle_config_ack(
    shared: &BridgeShared,
    studio_id_str: &str,
    agent_type: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ack: serde_json::Value = serde_json::from_slice(payload)?;

    let agent_id = ack
        .get("agent_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());

    let applied_version = ack
        .get("applied_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let success = ack
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if success {
        if let Some(agent_id) = agent_id {
            // Copy desired_config to applied_config
            sqlx::query(
                "UPDATE agents SET applied_config = desired_config WHERE id = $1 AND config_version = $2"
            )
            .bind(agent_id)
            .bind(applied_version)
            .execute(&shared.db)
            .await?;

            tracing::info!(agent = %agent_id, version = applied_version, "Config applied successfully");
        }
    } else {
        let error = ack
            .get("error_message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        tracing::warn!(studio = %studio_id_str, agent_type, error, "Config apply failed");
    }

    Ok(())
}

/// Handle system metrics from Device Monitor agent.
async fn handle_system_metrics(
    shared: &BridgeShared,
    studio_id_str: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let metrics: serde_json::Value = serde_json::from_slice(payload)?;

    let studio_id = Uuid::parse_str(studio_id_str)?;
    let agent_id = metrics
        .get("agent_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());

    let Some(agent_id) = agent_id else {
        return Ok(());
    };

    sqlx::query(
        r#"INSERT INTO system_telemetry
             (agent_id, studio_id, cpu_percent, memory_used_mb, memory_total_mb,
              disk_used_gb, disk_total_gb, network_rx_bytes_sec, network_tx_bytes_sec,
              peripherals, agent_statuses)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
    )
    .bind(agent_id)
    .bind(studio_id)
    .bind(metrics.get("cpu_percent").and_then(|v| v.as_f64()))
    .bind(
        metrics
            .get("memory_used_mb")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
    )
    .bind(
        metrics
            .get("memory_total_mb")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
    )
    .bind(metrics.get("disk_used_gb").and_then(|v| v.as_f64()))
    .bind(metrics.get("disk_total_gb").and_then(|v| v.as_f64()))
    .bind(metrics.get("network_rx_bytes_sec").and_then(|v| v.as_i64()))
    .bind(metrics.get("network_tx_bytes_sec").and_then(|v| v.as_i64()))
    .bind(metrics.get("peripherals").unwrap_or(&serde_json::json!([])))
    .bind(
        metrics
            .get("agent_statuses")
            .unwrap_or(&serde_json::json!({})),
    )
    .execute(&shared.db)
    .await?;

    // Redis for CRM
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:system_telemetry")
        .arg(
            serde_json::json!({
                "agent_id": agent_id.to_string(),
                "studio_id": studio_id_str,
                "cpu_percent": metrics.get("cpu_percent"),
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

/// Handle update status from agent (download/verify/install/complete/fail progress).
async fn handle_update_status(
    shared: &BridgeShared,
    studio_id_str: &str,
    agent_type: &str,
    payload: &[u8],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let status: serde_json::Value = serde_json::from_slice(payload)?;

    let command_id = status
        .get("command_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());

    let Some(command_id) = command_id else {
        tracing::warn!("Update status without command_id");
        return Ok(());
    };

    let state_str = status
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let progress = status
        .get("progress_percent")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let error_msg = status
        .get("error_message")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let new_version = status.get("new_version").and_then(|v| v.as_str());

    // Map state to DB status
    let db_status = match state_str {
        "DOWNLOADING" | "downloading" => "downloading",
        "VERIFYING" | "verifying" => "downloading", // still in download phase
        "INSTALLING" | "installing" => "installing",
        "RESTARTING" | "restarting" => "installing",
        "COMPLETED" | "completed" => "completed",
        "FAILED" | "failed" => "failed",
        "ROLLED_BACK" | "rolled_back" => "rolled_back",
        _ => {
            tracing::warn!(state = state_str, "Unknown update state");
            return Ok(());
        }
    };

    let is_terminal = matches!(db_status, "completed" | "failed" | "rolled_back");

    // Update agent_update_commands
    if is_terminal {
        sqlx::query(
            r#"UPDATE agent_update_commands SET
                 status = $2, progress_percent = $3, error_message = $4,
                 started_at = COALESCE(started_at, NOW()),
                 completed_at = NOW()
               WHERE id = $1"#,
        )
        .bind(command_id)
        .bind(db_status)
        .bind(if db_status == "completed" {
            100
        } else {
            progress
        })
        .bind(error_msg)
        .execute(&shared.db)
        .await?;
    } else {
        sqlx::query(
            r#"UPDATE agent_update_commands SET
                 status = $2, progress_percent = $3, error_message = $4,
                 started_at = COALESCE(started_at, NOW())
               WHERE id = $1"#,
        )
        .bind(command_id)
        .bind(db_status)
        .bind(progress)
        .bind(error_msg)
        .execute(&shared.db)
        .await?;
    }

    // On completion: update agent's current_version, clear target_version
    if db_status == "completed" {
        if let Some(ver) = new_version {
            let agent_id: Option<Uuid> =
                sqlx::query_scalar("SELECT agent_id FROM agent_update_commands WHERE id = $1")
                    .bind(command_id)
                    .fetch_optional(&shared.db)
                    .await?;

            if let Some(agent_id) = agent_id {
                sqlx::query(
                    "UPDATE agents SET current_version = $1, target_version = NULL WHERE id = $2",
                )
                .bind(ver)
                .bind(agent_id)
                .execute(&shared.db)
                .await?;
            }
        }

        // Update rollout counters if part of a rollout
        sqlx::query(
            r#"UPDATE rollout_plans SET completed_agents = completed_agents + 1
               WHERE id = (SELECT rollout_id FROM agent_update_commands WHERE id = $1)
                 AND status = 'in_progress'"#,
        )
        .bind(command_id)
        .execute(&shared.db)
        .await?;

        // Increment release download_count
        sqlx::query(
            r#"UPDATE agent_releases SET download_count = download_count + 1
               WHERE id = (SELECT release_id FROM agent_update_commands WHERE id = $1)"#,
        )
        .bind(command_id)
        .execute(&shared.db)
        .await?;
    }

    // On failure: update rollout counters, create alert
    if db_status == "failed" {
        sqlx::query(
            r#"UPDATE rollout_plans SET failed_agents = failed_agents + 1
               WHERE id = (SELECT rollout_id FROM agent_update_commands WHERE id = $1)
                 AND status = 'in_progress'"#,
        )
        .bind(command_id)
        .execute(&shared.db)
        .await?;

        // Create infra alert for failed update
        let agent_info = sqlx::query_as::<_, (Uuid, Uuid, String)>(
            r#"SELECT a.id, a.studio_id, a.name
               FROM agent_update_commands auc
               JOIN agents a ON a.id = auc.agent_id
               WHERE auc.id = $1"#,
        )
        .bind(command_id)
        .fetch_optional(&shared.db)
        .await?;

        if let Some((agent_id, studio_id, agent_name)) = agent_info {
            let title = format!("Обновление агента «{agent_name}» не удалось");
            sqlx::query(
                r#"INSERT INTO infra_alerts (studio_id, agent_id, alert_type, severity, title, details)
                   VALUES ($1, $2, 'update_failed', 'critical', $3, $4)"#,
            )
            .bind(studio_id)
            .bind(agent_id)
            .bind(&title)
            .bind(serde_json::json!({
                "command_id": command_id.to_string(),
                "error_message": error_msg,
                "agent_type": agent_type,
            }))
            .execute(&shared.db)
            .await?;

            // Telegram for critical
            let msg = format!(
                "🚨 <b>UPDATE FAILED</b>\n{title}\n{}\nТочка: {studio_id}",
                error_msg.unwrap_or("Неизвестная ошибка")
            );
            send_telegram_alert(shared, &msg).await;
        }
    }

    tracing::info!(
        command_id = %command_id,
        status = db_status,
        progress,
        "Update status received"
    );

    // Publish to Redis for CRM real-time
    let mut conn = shared.redis.clone();
    let _ = redis::cmd("PUBLISH")
        .arg("infra:update_progress")
        .arg(
            serde_json::json!({
                "type": "agent_update",
                "command_id": command_id.to_string(),
                "studio_id": studio_id_str,
                "agent_type": agent_type,
                "status": db_status,
                "progress_percent": progress,
                "error_message": error_msg,
                "new_version": new_version,
            })
            .to_string(),
        )
        .query_async::<()>(&mut conn)
        .await;

    Ok(())
}

/// Send alert message via Telegram bot API.
async fn send_telegram_alert(shared: &BridgeShared, message: &str) {
    let Some(ref tg) = shared.telegram else {
        return;
    };

    let url = format!("https://api.telegram.org/bot{}/sendMessage", tg.bot_token);

    let body = serde_json::json!({
        "chat_id": tg.alert_chat_id,
        "text": message,
        "parse_mode": "HTML",
    });

    match shared.http_client.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("Telegram alert sent");
        }
        Ok(resp) => {
            tracing::warn!(status = %resp.status(), "Telegram alert failed");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Telegram alert request failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rumqttc::{QoS, SubscribeReasonCode};

    #[test]
    fn suback_summary_counts_failed_return_codes() {
        let summary = summarize_suback_return_codes(&[
            SubscribeReasonCode::Success(QoS::AtLeastOnce),
            SubscribeReasonCode::Failure,
            SubscribeReasonCode::Failure,
        ]);

        assert_eq!(summary.granted, 1);
        assert_eq!(summary.failed, 2);
        assert!(summary.has_failures());
    }

    #[test]
    fn shift_protobuf_result_maps_success_to_completed_transaction_status() {
        let command_id = Uuid::parse_str("6ad7aa8a-5729-4bc9-8a04-1928bf48d953").unwrap();
        let msg = infra_proto::PosShiftResult {
            command_id: command_id.to_string(),
            success: true,
            error_message: String::new(),
            action: "close".into(),
            timestamp_ms: 1_779_090_497_000,
        };
        let mut payload = Vec::new();
        msg.encode(&mut payload).unwrap();

        let result = parse_pos_shift_result_payload(&payload).unwrap();

        assert_eq!(result.command_id, command_id);
        assert_eq!(result.action, "close");
        assert_eq!(result.db_status(), "completed");
        assert_eq!(result.error_message.as_deref(), None);
    }

    #[test]
    fn shift_json_result_maps_failure_to_failed_transaction_status() {
        let command_id = Uuid::parse_str("9d665639-46a8-47e9-8f06-41c7e90d8e87").unwrap();
        let payload = serde_json::json!({
            "command_id": command_id,
            "success": false,
            "error_message": "ATOL error 83: Смена открыта, операция невозможна",
            "action": "open"
        })
        .to_string();

        let result = parse_pos_shift_result_payload(payload.as_bytes()).unwrap();

        assert_eq!(result.command_id, command_id);
        assert_eq!(result.action, "open");
        assert_eq!(result.db_status(), "failed");
        assert_eq!(
            result.error_message.as_deref(),
            Some("ATOL error 83: Смена открыта, операция невозможна")
        );
    }

    #[test]
    fn pos_transaction_update_payload_includes_fiscal_receipt_fields() {
        let tx_id = Uuid::parse_str("79fb25d6-76cc-480a-98b2-25a105e4d20c").unwrap();
        let studio_id = Uuid::parse_str("30ef357f-06a6-4b01-b1ff-dbbe7eaed446").unwrap();
        let result = infra_proto::PosTransactionResult {
            success: true,
            approval_code: "A1".into(),
            rrn: "R1".into(),
            card_mask: "411111******1111".into(),
            fiscal_number: "12345".into(),
            fiscal_sign: "987654321".into(),
            fiscal_receipt_url: "https://receipt.example/fiscal/12345".into(),
            ..Default::default()
        };

        let payload = pos_transaction_update_payload(&result, tx_id, studio_id, "completed", None);

        assert_eq!(payload["fiscal_number"], "12345");
        assert_eq!(payload["fiscal_sign"], "987654321");
        assert_eq!(
            payload["fiscal_receipt_url"],
            "https://receipt.example/fiscal/12345"
        );
    }

    #[test]
    fn pos_transaction_update_payload_includes_bank_report_from_receipt_data() {
        let tx_id = Uuid::parse_str("79fb25d6-76cc-480a-98b2-25a105e4d20c").unwrap();
        let studio_id = Uuid::parse_str("30ef357f-06a6-4b01-b1ff-dbbe7eaed446").unwrap();
        let result = infra_proto::PosTransactionResult {
            success: true,
            receipt_data: "СВЕРКА ИТОГОВ\nОТЧЕТ ЗАВЕРШЕН".as_bytes().to_vec(),
            ..Default::default()
        };

        let payload = pos_transaction_update_payload(&result, tx_id, studio_id, "completed", None);

        assert_eq!(payload["bank_report"], "СВЕРКА ИТОГОВ\nОТЧЕТ ЗАВЕРШЕН");
    }

    #[test]
    fn agent_alert_parser_accepts_pos_protobuf_payload() {
        let agent_id = Uuid::parse_str("0affa6d8-4ea9-4ce6-b54d-ef5cfe6e02ca").unwrap();
        let msg = infra_proto::AgentAlert {
            agent_id: agent_id.to_string(),
            alert_type: "device_offline".into(),
            severity: "warning".into(),
            title: "POS device offline".into(),
            details_json: serde_json::json!({
                "terminal_online": false,
                "fiscal_online": true,
            })
            .to_string(),
            timestamp_ms: 1_779_304_674_366,
        };
        let mut payload = Vec::new();
        msg.encode(&mut payload).unwrap();

        let alert = parse_agent_alert_payload(&payload).unwrap();

        assert_eq!(alert.agent_id, Some(agent_id));
        assert_eq!(alert.alert_type, "device_offline");
        assert_eq!(alert.severity, "warning");
        assert_eq!(alert.title, "POS device offline");
        assert_eq!(alert.details["terminal_online"], false);
        assert_eq!(alert.details["fiscal_online"], true);
    }

    #[test]
    fn agent_alert_parser_accepts_legacy_json_payload() {
        let payload = serde_json::json!({
            "agent_id": "0affa6d8-4ea9-4ce6-b54d-ef5cfe6e02ca",
            "alert_type": "heartbeat_timeout",
            "severity": "critical",
            "title": "Agent offline",
            "details_json": "{\"seconds\":120}"
        })
        .to_string();

        let alert = parse_agent_alert_payload(payload.as_bytes()).unwrap();

        assert_eq!(alert.alert_type, "heartbeat_timeout");
        assert_eq!(alert.severity, "critical");
        assert_eq!(alert.title, "Agent offline");
        assert_eq!(alert.details["seconds"], 120);
    }

    #[test]
    fn generic_agent_telemetry_route_does_not_capture_pos_telemetry() {
        let pos_parts = [
            "svoefoto",
            "30ef357f-06a6-4b01-b1ff-dbbe7eaed446",
            "pos",
            "telemetry",
        ];
        let monitor_parts = [
            "svoefoto",
            "30ef357f-06a6-4b01-b1ff-dbbe7eaed446",
            "monitor",
            "telemetry",
        ];

        assert!(!is_generic_agent_telemetry_topic(&pos_parts));
        assert!(is_generic_agent_telemetry_topic(&monitor_parts));
    }
}
