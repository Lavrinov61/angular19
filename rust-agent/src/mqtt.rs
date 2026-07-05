use std::sync::Arc;
use std::time::Duration;
use prost::Message;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use tracing::{debug, error, info, warn};

use crate::{AgentState, cups, pipeline, proto};

/// Main MQTT loop: connect → subscribe → handle incoming commands
pub async fn run(state: Arc<AgentState>) {
    loop {
        if let Err(e) = run_inner(Arc::clone(&state)).await {
            error!("MQTT connection lost: {e}. Reconnecting in 5s...");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn run_inner(state: Arc<AgentState>) -> anyhow::Result<()> {
    let cfg = &state.config.mqtt;
    let agent = &state.config.agent;

    let client_id = format!("svf-agent-{}", &agent.bridge_id[..8.min(agent.bridge_id.len())]);
    let mut opts = MqttOptions::new(&client_id, &cfg.host, cfg.port);
    opts.set_credentials(&cfg.username, &cfg.password);
    opts.set_keep_alive(Duration::from_secs(30));
    opts.set_clean_session(false);

    let (client, mut eventloop) = AsyncClient::new(opts, 64);

    // Store client for other tasks (telemetry, offline sync)
    {
        let mut guard = state.mqtt_client.write().await;
        *guard = Some(client.clone());
    }

    // Subscribe to command topic for this station
    let cmd_topic = format!("svoefoto/{}/commands/print", agent.studio_id);
    client.subscribe(&cmd_topic, QoS::AtLeastOnce).await?;
    info!(topic = %cmd_topic, "Subscribed to print commands");

    // Subscribe to ICC sync topic (Phase 4.1)
    let icc_topic = format!("svoefoto/{}/icc/sync", agent.studio_id);
    client.subscribe(&icc_topic, QoS::AtLeastOnce).await?;

    // Subscribe to preview request topic (Phase 4.5)
    let preview_topic = format!("svoefoto/{}/commands/preview", agent.studio_id);
    client.subscribe(&preview_topic, QoS::AtLeastOnce).await?;

    loop {
        let event = eventloop.poll().await?;

        if let Event::Incoming(Incoming::Publish(publish)) = event {
            let topic = publish.topic.clone();
            let payload = publish.payload.to_vec();
            let state = Arc::clone(&state);

            tokio::spawn(async move {
                if topic.ends_with("/commands/print") {
                    handle_print_command(&state, &payload).await;
                } else if topic.ends_with("/icc/sync") {
                    handle_icc_sync(&state, &payload).await;
                } else if topic.ends_with("/commands/preview") {
                    handle_preview_request(&state, &payload).await;
                }
            });
        }
    }
}

/// Process incoming PrintCommand — the core flow
async fn handle_print_command(state: &AgentState, payload: &[u8]) {
    let cmd = match proto::PrintCommand::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode PrintCommand: {e}");
            return;
        }
    };

    let job_id = cmd.job_id.clone();
    info!(job_id = %job_id, file = %cmd.file_name, printer = %cmd.printer_id, "Received print command");

    // Check idempotency — skip if already processed
    if !cmd.idempotency_key.is_empty() && state.offline_store.was_processed(&cmd.idempotency_key) {
        warn!(job_id = %job_id, key = %cmd.idempotency_key, "Duplicate job (idempotency), skipping");
        return;
    }

    // Report: SENDING
    report_status(state, &job_id, proto::JobState::Sending, "", 0, None).await;

    // 1. Download file
    let temp_dir = &state.config.download.temp_dir;
    let downloaded = match pipeline::download_file(
        &state.http_client,
        &cmd.file_url,
        temp_dir,
        state.config.download.max_file_size,
    ).await {
        Ok(path) => path,
        Err(e) => {
            error!(job_id = %job_id, "Download failed: {e}");
            report_status(state, &job_id, proto::JobState::Failed, &format!("Download failed: {e}"), 0, None).await;
            return;
        }
    };

    // 2. Apply ICC if profile is set (Phase 4.1)
    if !cmd.icc_profile_key.is_empty() {
        report_status(state, &job_id, proto::JobState::ApplyingIcc, "", 15, None).await;
    }

    // 3. Process image (scale, ICC, grayscale, layout)
    report_status(state, &job_id, proto::JobState::RenderingLayout, "", 25, None).await;

    let icc_cache = state.icc_cache.as_ref();
    let processed = match pipeline::process_image(&cmd, &downloaded, state.config.cups.target_dpi, icc_cache) {
        Ok(path) => path,
        Err(e) => {
            error!(job_id = %job_id, "Image processing failed: {e}");
            report_status(state, &job_id, proto::JobState::Failed, &format!("Image processing failed: {e}"), 0, None).await;
            let _ = std::fs::remove_file(&downloaded);
            return;
        }
    };

    // 4. Submit to CUPS
    report_status(state, &job_id, proto::JobState::Printing, "", 50, None).await;

    let cups_printer = resolve_cups_printer(state, &cmd);

    // 4.3: Estimate consumable usage
    let color_mode_str = match proto::ColorMode::try_from(cmd.color_mode) {
        Ok(proto::ColorMode::Bw) => "bw",
        _ => "color",
    };
    let usage = cups::estimate_consumable_usage(&cmd.paper_size, color_mode_str, cmd.copies);

    match crate::cups::submit_job(&cups_printer, &processed, &cmd) {
        Ok(cups_job_id) => {
            info!(job_id = %job_id, cups_job_id, "CUPS job submitted");
            report_status(state, &job_id, proto::JobState::Completed, "", 100, Some(usage)).await;
        }
        Err(e) => {
            error!(job_id = %job_id, "CUPS submission failed: {e}");
            report_status(state, &job_id, proto::JobState::Failed, &format!("CUPS: {e}"), 0, None).await;
        }
    }

    // Mark as processed for idempotency
    if !cmd.idempotency_key.is_empty() {
        let _ = state.offline_store.mark_processed(&cmd.idempotency_key);
    }

    // Cleanup temp files
    let _ = std::fs::remove_file(&downloaded);
    let _ = std::fs::remove_file(&processed);
}

/// Phase 4.1: Handle ICC sync — download and cache ICC profile.
async fn handle_icc_sync(state: &AgentState, payload: &[u8]) {
    let req = match proto::IccSyncRequest::decode(payload) {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to decode IccSyncRequest: {e}");
            return;
        }
    };

    let Some(ref icc_cache) = state.icc_cache else {
        warn!("ICC cache not initialized, ignoring sync request");
        return;
    };

    if req.file_url.is_empty() {
        warn!(profile_id = %req.profile_id, "ICC sync without file_url, skipping");
        return;
    }

    // Use profile_id as the cache key (or media_type as fallback identifier)
    let cache_key = if !req.profile_id.is_empty() {
        format!("{}.icc", req.profile_id)
    } else {
        format!("{}.icc", req.media_type)
    };

    match icc_cache.download_and_store(&state.http_client, &req.file_url, &cache_key).await {
        Ok(path) => {
            info!(
                profile_id = %req.profile_id,
                media_type = %req.media_type,
                path = %path.display(),
                is_default = req.is_default,
                "ICC profile synced"
            );
        }
        Err(e) => {
            error!(
                profile_id = %req.profile_id,
                error = %e,
                "Failed to sync ICC profile"
            );
        }
    }
}

/// Phase 4.5: Handle preview request — render and publish result.
async fn handle_preview_request(state: &AgentState, payload: &[u8]) {
    let req = match proto::PreviewRequest::decode(payload) {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to decode PreviewRequest: {e}");
            return;
        }
    };

    let job_id = req.job_id.clone();
    info!(job_id = %job_id, "Processing preview request");

    // Download file to temp dir
    let temp_dir = &state.config.download.temp_dir;
    let downloaded = match pipeline::download_file(
        &state.http_client,
        &req.file_url,
        temp_dir,
        state.config.download.max_file_size,
    ).await {
        Ok(path) => path,
        Err(e) => {
            error!(job_id = %job_id, "Preview download failed: {e}");
            return;
        }
    };

    // Build a synthetic PrintCommand for the preview pipeline
    let preview_cmd = proto::PrintCommand {
        job_id: req.job_id.clone(),
        paper_size: req.paper_size,
        fit_mode: req.fit_mode,
        icc_profile_key: req.icc_profile_key,
        layout: req.layout,
        color_mode: proto::ColorMode::Color as i32,
        orientation: proto::Orientation::Auto as i32,
        ..Default::default()
    };

    // Render preview at reduced DPI (72 for screen display)
    let preview_dpi = if req.preview_width_px > 0 { 72 } else { 72 };
    let icc_cache = state.icc_cache.as_ref();

    let preview_bytes = match pipeline::render_preview(&preview_cmd, &downloaded, preview_dpi, icc_cache) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(job_id = %job_id, "Preview rendering failed: {e}");
            let _ = std::fs::remove_file(&downloaded);
            return;
        }
    };

    // Determine dimensions from the rendered preview
    let preview_result = proto::PreviewResult {
        job_id: req.job_id,
        preview_image: preview_bytes,
        content_type: "image/jpeg".to_string(),
        width_px: 0,  // Set by consumer if needed
        height_px: 0,
    };

    // Publish preview result via MQTT
    let topic = format!(
        "svoefoto/{}/preview/{}/result",
        state.config.agent.studio_id, job_id
    );
    let payload = preview_result.encode_to_vec();

    let guard = state.mqtt_client.read().await;
    if let Some(client) = guard.as_ref() {
        if let Err(e) = client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
            error!(job_id = %job_id, "Failed to publish preview result: {e}");
        } else {
            info!(job_id = %job_id, "Preview result published");
        }
    }

    // Cleanup
    let _ = std::fs::remove_file(&downloaded);
}

/// Determine which CUPS printer name to use
fn resolve_cups_printer(state: &AgentState, cmd: &proto::PrintCommand) -> String {
    if state.config.cups.default_printer.is_empty() {
        cmd.printer_id.clone()
    } else {
        state.config.cups.default_printer.clone()
    }
}

/// Publish PrintStatus to MQTT (Phase 4.3: now includes consumable_usage)
pub async fn report_status(
    state: &AgentState,
    job_id: &str,
    job_state: proto::JobState,
    error_msg: &str,
    progress: i32,
    consumable_usage: Option<proto::ConsumableUsage>,
) {
    let status = proto::PrintStatus {
        job_id: job_id.to_string(),
        state: job_state.into(),
        error_message: error_msg.to_string(),
        progress_percent: progress,
        pages_printed: if job_state == proto::JobState::Completed { 1 } else { 0 },
        total_pages: 1,
        consumable_usage,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
        trace_id: String::new(),
    };

    let topic = format!(
        "svoefoto/{}/jobs/{}/progress",
        state.config.agent.studio_id, job_id
    );

    let payload = status.encode_to_vec();

    let guard = state.mqtt_client.read().await;
    if let Some(client) = guard.as_ref() {
        if let Err(e) = client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
            warn!(job_id, "Failed to publish status via MQTT: {e}");
            let _ = state.offline_store.queue_status(job_id, job_state as i32, error_msg);
        }
    } else {
        debug!(job_id, "MQTT not connected, queueing status update");
        let _ = state.offline_store.queue_status(job_id, job_state as i32, error_msg);
    }
}

/// Publish BridgeHeartbeat to MQTT (Phase 4.8: includes uptime)
pub async fn send_heartbeat(state: &AgentState) {
    let agent = &state.config.agent;

    let heartbeat = proto::BridgeHeartbeat {
        bridge_id: agent.bridge_id.clone(),
        agent_type: "rust_agent".to_string(),
        agent_version: agent.version.clone(),
        cups_version: crate::cups::get_cups_version(),
        os_info: get_os_info(),
        hostname: hostname(),
        uptime_seconds: state.start_time.elapsed().as_secs() as i64,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    let topic = format!("svoefoto/{}/heartbeat", agent.studio_id);
    let payload = heartbeat.encode_to_vec();

    let guard = state.mqtt_client.read().await;
    if let Some(client) = guard.as_ref() {
        if let Err(e) = client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
            warn!("Failed to publish heartbeat: {e}");
        }
    }
}

/// Publish TelemetryReport to MQTT
pub async fn send_telemetry(state: &AgentState, report: proto::TelemetryReport) {
    let topic = format!("svoefoto/{}/telemetry", state.config.agent.studio_id);
    let payload = report.encode_to_vec();

    let guard = state.mqtt_client.read().await;
    if let Some(client) = guard.as_ref() {
        if let Err(e) = client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
            warn!("Failed to publish telemetry: {e}");
        }
    }
}

fn hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn get_os_info() -> String {
    std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|content| {
            content.lines()
                .find(|l| l.starts_with("PRETTY_NAME="))
                .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "Linux".to_string())
}
