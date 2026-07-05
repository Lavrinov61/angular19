//! MQTT command handler — processes incoming PrintCommand, IccSync, Preview, Update, Config.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::QoS;
use tracing::{debug, error, info, warn};

use svf_agent_core::mqtt;

use crate::print_proto::{self, JobState};
use crate::printing;
use crate::AgentState;
use crate::pipeline;

/// RAII guard that removes temp files on drop (e.g. on early return / error).
struct TempFileGuard {
    paths: Vec<PathBuf>,
}

impl TempFileGuard {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn push(&mut self, path: PathBuf) {
        self.paths.push(path);
    }

    /// Consume the guard without cleaning up (call when files are cleaned up manually).
    #[allow(dead_code)]
    fn defuse(mut self) {
        self.paths.clear();
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        for p in &self.paths {
            if p.exists() {
                let _ = std::fs::remove_file(p);
                debug!(file = %p.display(), "Cleaned up temp file");
            }
        }
    }
}

/// Dispatch incoming MQTT message by topic.
pub async fn handle_message(state: &AgentState, topic: &str, payload: &[u8]) {
    if topic.ends_with("/commands/print") {
        handle_print_command(state, payload).await;
    } else if topic.ends_with("/commands/icc_sync") {
        handle_icc_sync(state, payload).await;
    } else if topic.ends_with("/commands/preview") {
        handle_preview_request(state, payload).await;
    } else if topic.ends_with("/commands/update") {
        handle_update_command(state, payload).await;
    } else if topic.ends_with("/commands/restart") {
        handle_restart_command(state, payload).await;
    } else if topic.ends_with("/config") {
        handle_config_update(state, payload).await;
    }
}

// ── Print Command ──

async fn handle_print_command(state: &AgentState, payload: &[u8]) {
    let cmd = match print_proto::PrintCommand::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode PrintCommand: {e}");
            return;
        }
    };

    let job_id = cmd.job_id.clone();
    info!(job_id = %job_id, file = %cmd.file_name, printer = %cmd.printer_id, "Received print command");

    let mut guard = TempFileGuard::new();

    // Idempotency check
    if !cmd.idempotency_key.is_empty()
        && state.offline_store.was_processed(&cmd.idempotency_key).unwrap_or(false)
    {
        warn!(job_id = %job_id, key = %cmd.idempotency_key, "Duplicate job, skipping");
        return;
    }

    // SENDING
    report_status(state, &job_id, JobState::Sending, "", 0, None).await;

    // 1. Download file
    let downloaded = match pipeline::download_file(
        &state.http_client,
        &cmd.file_url,
        &state.config.base.download.temp_dir,
        state.config.base.download.max_file_size,
    )
    .await
    {
        Ok(path) => {
            guard.push(path.clone());
            if let Err(e) = state.offline_store.persist_job_file(
                &job_id,
                path.to_str().unwrap_or(""),
                "downloaded",
            ) {
                warn!(job_id = %job_id, "Failed to persist job file for recovery: {e}");
            }
            path
        }
        Err(e) => {
            error!(job_id = %job_id, "Download failed: {e}");
            report_status(state, &job_id, JobState::Failed, &format!("Download failed: {e}"), 0, None).await;
            return;
        }
    };

    // 2. ICC (if set)
    if !cmd.icc_profile_key.is_empty() {
        report_status(state, &job_id, JobState::ApplyingIcc, "", 15, None).await;
    }

    // 3. Process image (scale, ICC, grayscale, layout) with timeout + spawn_blocking
    report_status(state, &job_id, JobState::RenderingLayout, "", 25, None).await;

    let cmd_clone = cmd.clone();
    let downloaded_clone = downloaded.clone();
    let target_dpi = state.config.printing.target_dpi;
    let jpeg_quality = state.config.printing.jpeg_quality;
    let icc_cache = state.icc_cache.clone();

    let process_result = tokio::time::timeout(
        Duration::from_secs(120),
        tokio::task::spawn_blocking(move || {
            pipeline::process_image(
                &cmd_clone,
                &downloaded_clone,
                target_dpi,
                icc_cache.as_ref(),
                jpeg_quality,
            )
        }),
    )
    .await;

    let processed = match process_result {
        Ok(Ok(Ok(path))) => {
            guard.push(path.clone());
            path
        }
        Ok(Ok(Err(e))) => {
            error!(job_id = %job_id, "Image processing failed: {e}");
            report_status(state, &job_id, JobState::Failed, &format!("Processing failed: {e}"), 0, None).await;
            return;
        }
        Ok(Err(e)) => {
            error!(job_id = %job_id, "Image processing task panicked: {e}");
            report_status(state, &job_id, JobState::Failed, "Processing task panicked", 0, None).await;
            return;
        }
        Err(_) => {
            error!(job_id = %job_id, "Image processing timed out (120s)");
            report_status(state, &job_id, JobState::Failed, "Image processing timeout (120s)", 0, None).await;
            return;
        }
    };

    // 4. Submit to OS spooler (CUPS or Windows Spooler)
    report_status(state, &job_id, JobState::Printing, "", 50, None).await;

    let printer_name = resolve_printer(state, &cmd);

    let color_mode_str = match print_proto::ColorMode::try_from(cmd.color_mode) {
        Ok(print_proto::ColorMode::Bw) => "bw",
        _ => "color",
    };
    let usage = printing::estimate_consumable_usage_with_service(
        &cmd.paper_size, color_mode_str, cmd.copies, &cmd.service_slug,
    );

    let printer = printer_name.clone();
    let processed_path = processed.clone();
    let cmd_clone = cmd.clone();
    let submit_result = tokio::time::timeout(
        Duration::from_secs(60),
        tokio::task::spawn_blocking(move || {
            printing::submit_job(&printer, &processed_path, &cmd_clone)
        }),
    )
    .await;

    match submit_result {
        Ok(Ok(Ok(result))) => {
            info!(job_id = %job_id, spooler_job_id = result.job_id, "Print job submitted");
            report_status(state, &job_id, JobState::Completed, "", 100, Some(usage)).await;
        }
        Ok(Ok(Err(e))) => {
            error!(job_id = %job_id, "Print submission failed: {e}");
            report_status(state, &job_id, JobState::Failed, &format!("Spooler: {e}"), 0, None).await;
        }
        Ok(Err(e)) => {
            error!(job_id = %job_id, "Spooler thread panicked: {e}");
            report_status(state, &job_id, JobState::Failed, &format!("Spooler thread panicked: {e}"), 0, None).await;
        }
        Err(_) => {
            error!(job_id = %job_id, "Spooler timeout after 60s");
            report_status(state, &job_id, JobState::Failed, "Spooler timeout after 60s — printer may be offline", 0, None).await;
        }
    }

    // Remove crash-recovery entry now that the job is done
    let _ = state.offline_store.remove_job_file(&job_id);

    // Mark idempotency
    if !cmd.idempotency_key.is_empty() {
        let _ = state.offline_store.mark_processed(&cmd.idempotency_key);
    }

    // Guard handles cleanup on drop
}

// ── ICC Sync ──

async fn handle_icc_sync(state: &AgentState, payload: &[u8]) {
    let req = match print_proto::IccSyncRequest::decode(payload) {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to decode IccSyncRequest: {e}");
            return;
        }
    };

    let Some(ref icc_cache) = state.icc_cache else {
        warn!("ICC cache not initialized, ignoring sync");
        return;
    };

    if req.file_url.is_empty() {
        warn!(profile_id = %req.profile_id, "ICC sync without file_url, skipping");
        return;
    }

    let cache_key = if !req.profile_id.is_empty() {
        format!("{}.icc", req.profile_id)
    } else {
        format!("{}.icc", req.media_type)
    };

    match icc_cache
        .download_and_store(&state.http_client, &req.file_url, &cache_key)
        .await
    {
        Ok(path) => {
            info!(
                profile_id = %req.profile_id,
                media_type = %req.media_type,
                path = %path.display(),
                "ICC profile synced"
            );
        }
        Err(e) => {
            error!(profile_id = %req.profile_id, error = %e, "ICC sync failed");
        }
    }
}

// ── Preview ──

async fn handle_preview_request(state: &AgentState, payload: &[u8]) {
    let req = match print_proto::PreviewRequest::decode(payload) {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to decode PreviewRequest: {e}");
            return;
        }
    };

    let job_id = req.job_id.clone();
    info!(job_id = %job_id, "Processing preview request");

    let mut guard = TempFileGuard::new();

    let downloaded = match pipeline::download_file(
        &state.http_client,
        &req.file_url,
        &state.config.base.download.temp_dir,
        state.config.base.download.max_file_size,
    )
    .await
    {
        Ok(path) => {
            guard.push(path.clone());
            path
        }
        Err(e) => {
            error!(job_id = %job_id, "Preview download failed: {e}");
            return;
        }
    };

    let preview_cmd = print_proto::PrintCommand {
        job_id: req.job_id.clone(),
        paper_size: req.paper_size,
        fit_mode: req.fit_mode,
        icc_profile_key: req.icc_profile_key,
        layout: req.layout,
        color_mode: print_proto::ColorMode::Color as i32,
        orientation: print_proto::Orientation::Auto as i32,
        ..Default::default()
    };

    let icc_cache = state.icc_cache.clone();

    let preview_bytes = match pipeline::render_preview(&preview_cmd, &downloaded, 72, icc_cache.as_ref()) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(job_id = %job_id, "Preview rendering failed: {e}");
            return; // guard cleans up downloaded file
        }
    };

    let preview_result = print_proto::PreviewResult {
        job_id: req.job_id,
        preview_image: preview_bytes,
        content_type: "image/jpeg".to_string(),
        width_px: 0,
        height_px: 0,
    };

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );
    let topic = format!("{prefix}/preview/{job_id}/result");
    let payload = preview_result.encode_to_vec();

    if let Err(e) = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload)
        .await
    {
        error!(job_id = %job_id, "Failed to publish preview result: {e}");
    } else {
        info!(job_id = %job_id, "Preview result published");
    }

    // guard cleans up on drop
}

// ── Update Command (from svf-agent-core) ──

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
    publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Downloading, 0, "").await;

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
            publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Verifying, 50, "").await;

            // Install
            publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Installing, 70, "").await;

            match svf_agent_core::updater::install_msi(&artifact_path).await {
                Ok(code) if code == 0 => {
                    publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Completed, 100, "").await;
                    info!("Update installed successfully, agent will restart");
                }
                Ok(code) => {
                    let msg = format!("MSI install exit code: {code}");
                    publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Failed, 0, &msg).await;
                }
                Err(e) => {
                    let msg = format!("Install failed: {e}");
                    publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Failed, 0, &msg).await;
                }
            }
        }
        Err(e) => {
            let msg = format!("Download/verify failed: {e}");
            error!("{msg}");
            publish_update_status(state, &cmd.command_id, svf_agent_core::proto::UpdateState::Failed, 0, &msg).await;
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

    if cmd.delay_seconds > 0 {
        tokio::time::sleep(Duration::from_secs(cmd.delay_seconds as u64)).await;
    }

    let _ = state.shutdown_tx.send(true);
}

// ── Config Update ──

async fn handle_config_update(state: &AgentState, payload: &[u8]) {
    let cmd = match svf_agent_core::proto::ConfigUpdate::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode ConfigUpdate: {e}");
            return;
        }
    };

    info!(version = cmd.config_version, "Config update received");

    // Write config to disk
    let config_toml = String::from_utf8_lossy(&cmd.config_toml);

    #[cfg(target_os = "windows")]
    let config_path = std::env::var("ProgramData")
        .map(|pd| format!("{pd}\\SvoePhoto\\config.toml"))
        .unwrap_or_else(|_| "config.toml".into());
    #[cfg(not(target_os = "windows"))]
    let config_path = "/etc/svf-agent/config.toml".to_string();

    match std::fs::write(&config_path, config_toml.as_ref()) {
        Ok(()) => {
            info!(path = %config_path, version = cmd.config_version, "Config written");

            // Ack success
            let ack = svf_agent_core::proto::ConfigAck {
                agent_id: state.config.base.agent.agent_id.clone(),
                applied_version: cmd.config_version,
                success: true,
                error_message: String::new(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            };

            let prefix = mqtt::topic_prefix(
                &state.config.base.agent.studio_id,
                &state.config.base.agent.agent_type,
            );
            let topic = format!("{prefix}/commands/config_ack");
            let _ = state
                .mqtt_handle
                .publish(&topic, QoS::AtLeastOnce, false, ack.encode_to_vec())
                .await;

            if cmd.restart_required {
                info!("Config requires restart, sending shutdown signal...");
                tokio::time::sleep(Duration::from_secs(2)).await;
                let _ = state.shutdown_tx.send(true);
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

            let prefix = mqtt::topic_prefix(
                &state.config.base.agent.studio_id,
                &state.config.base.agent.agent_type,
            );
            let topic = format!("{prefix}/commands/config_ack");
            let _ = state
                .mqtt_handle
                .publish(&topic, QoS::AtLeastOnce, false, ack.encode_to_vec())
                .await;
        }
    }
}

// ── Helpers ──

fn resolve_printer(state: &AgentState, cmd: &print_proto::PrintCommand) -> String {
    if state.config.printing.default_printer.is_empty() {
        cmd.printer_id.clone()
    } else {
        state.config.printing.default_printer.clone()
    }
}

/// Publish PrintStatus to MQTT.
async fn report_status(
    state: &AgentState,
    job_id: &str,
    job_state: JobState,
    error_msg: &str,
    progress: i32,
    consumable_usage: Option<print_proto::ConsumableUsage>,
) {
    let status = print_proto::PrintStatus {
        job_id: job_id.to_string(),
        state: job_state.into(),
        error_message: error_msg.to_string(),
        progress_percent: progress,
        pages_printed: if job_state == JobState::Completed {
            1
        } else {
            0
        },
        total_pages: 1,
        consumable_usage,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
        trace_id: String::new(),
    };

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );
    let topic = format!("{prefix}/jobs/{job_id}/progress");
    let payload = status.encode_to_vec();

    if let Err(e) = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload.clone())
        .await
    {
        warn!(job_id, "Failed to publish status: {e}");
        let _ = state.offline_store.queue_message(&topic, &payload, 1);
    }
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

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );
    let topic = format!("{prefix}/updates/status");
    let payload = status.encode_to_vec();

    let _ = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload)
        .await;
}

/// Background task: periodically drain offline queued messages when MQTT reconnects.
pub async fn run_offline_sync(state: Arc<AgentState>) {
    tokio::time::sleep(Duration::from_secs(10)).await;

    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;

        if !state.mqtt_handle.is_connected().await {
            continue;
        }

        match state.offline_store.drain_pending(100) {
            Ok(pending) if !pending.is_empty() => {
                info!(count = pending.len(), "Syncing pending offline messages");
                for msg in &pending {
                    let qos = if msg.qos >= 1 {
                        QoS::AtLeastOnce
                    } else {
                        QoS::AtMostOnce
                    };
                    if let Err(e) = state
                        .mqtt_handle
                        .publish(&msg.topic, qos, false, msg.payload.clone())
                        .await
                    {
                        warn!(topic = %msg.topic, "Failed to replay offline message: {e}");
                    }
                }
            }
            Err(e) => {
                warn!("Failed to drain offline messages: {e}");
            }
            _ => {}
        }
    }
}
