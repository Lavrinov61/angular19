//! MQTT command dispatcher — routes monitor commands to handler modules.

use std::sync::Arc;
use std::time::{Duration, Instant};

use prost::Message;
use rumqttc::QoS;
use tracing::{error, info, warn};

use svf_agent_core::mqtt;

use crate::AgentState;

/// Maximum number of messages allowed in the offline queue.
const OFFLINE_QUEUE_CAP: i64 = 10_000;

/// Handle an incoming MQTT message by routing to the appropriate handler.
pub async fn handle_message(state: &AgentState, topic: &str, payload: &[u8]) {
    // AUDIT: log every incoming command before processing
    tracing::info!(
        topic = %topic,
        payload_size = payload.len(),
        timestamp = %chrono::Utc::now().to_rfc3339(),
        "AUDIT: incoming command"
    );

    let started = Instant::now();

    let parts: Vec<&str> = topic.split('/').collect();
    // Expected: svoefoto/{studio_id}/monitor/commands/{command_type}
    if parts.len() < 5 || parts[2] != "monitor" || parts[3] != "commands" {
        // Not a monitor command — might be config/update/restart
        handle_infra_command(state, topic, parts.as_slice(), payload).await;
        let elapsed = started.elapsed();
        tracing::info!(
            topic = %topic,
            status = "ok",
            duration_ms = elapsed.as_millis() as u64,
            "AUDIT: command completed"
        );
        return;
    }

    let command_type = parts[4];

    let result = match command_type {
        "exec" => handle_exec_cmd(state, payload).await,
        "sysinfo" => handle_sysinfo(state, payload).await,
        "service" => handle_service(state, payload).await,
        "logs" => handle_logs(state, payload).await,
        "file" => handle_file(state, payload).await,
        "disk" => handle_disk_metrics(state).await,
        "network" => handle_network(state).await,
        "wininfo" => handle_wininfo(state).await,
        _ => {
            warn!(command_type, "Unknown monitor command");
            Ok(())
        }
    };

    let elapsed = started.elapsed();
    let success = result.is_ok();

    if let Err(e) = result {
        error!(command_type, error = %e, "Monitor command handler error");
    }

    // AUDIT: log command result with duration
    tracing::info!(
        topic = %topic,
        status = if success { "ok" } else { "error" },
        duration_ms = elapsed.as_millis() as u64,
        "AUDIT: command completed"
    );
}

// ── Command handler wrappers ──

async fn handle_exec_cmd(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd: crate::exec::ExecRequest = serde_json::from_slice(payload)?;
    let request_id = cmd.request_id.clone();

    info!(request_id = %request_id, command = %cmd.command, "Running whitelisted command");

    let result = crate::exec::run_whitelisted(state, cmd).await;
    let json = serde_json::to_vec(&result)?;

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/exec/{request_id}/result");
    publish_json(state, &topic, json).await;

    Ok(())
}

async fn handle_sysinfo(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd: crate::sysinfo_cmd::SysInfoRequest = serde_json::from_slice(payload)?;
    let request_id = cmd.request_id.clone();

    info!(request_id = %request_id, "Gathering system info");

    let result = crate::sysinfo_cmd::gather(request_id.clone());
    let json = serde_json::to_vec(&result)?;

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/sysinfo/{request_id}/result");
    publish_json(state, &topic, json).await;

    Ok(())
}

async fn handle_service(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd: crate::service::ServiceRequest = serde_json::from_slice(payload)?;
    let request_id = cmd.request_id.clone();

    info!(
        request_id = %request_id,
        service = %cmd.service_name,
        action = %cmd.action,
        "Service management"
    );

    let result = crate::service::manage(cmd, &state.config.monitor.allowed_services).await;
    let json = serde_json::to_vec(&result)?;

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/service/result");
    publish_json(state, &topic, json).await;

    Ok(())
}

async fn handle_logs(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd: crate::logs::LogsRequest = serde_json::from_slice(payload)?;
    let request_id = cmd.request_id.clone();

    info!(request_id = %request_id, source = %cmd.source, "Reading logs");

    let result = crate::logs::read_logs(state, cmd).await;
    let json = serde_json::to_vec(&result)?;

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/logs/{request_id}/chunk");
    publish_json(state, &topic, json).await;

    Ok(())
}

async fn handle_file(state: &AgentState, payload: &[u8]) -> anyhow::Result<()> {
    let cmd: crate::files::FileRequest = serde_json::from_slice(payload)?;
    let request_id = cmd.request_id.clone();

    info!(
        request_id = %request_id,
        op = %cmd.operation,
        path = %cmd.path,
        "File operation"
    );

    let result = crate::files::handle(state, cmd).await;
    let json = serde_json::to_vec(&result)?;

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/file/result");
    publish_json(state, &topic, json).await;

    Ok(())
}

// ── Enterprise monitoring commands ──

async fn handle_disk_metrics(state: &AgentState) -> anyhow::Result<()> {
    let report = tokio::task::spawn_blocking(crate::disk_metrics::collect_all).await?;
    let json = serde_json::to_vec(&report)?;
    let prefix = monitor_prefix(state);
    publish_json(state, &format!("{prefix}/disk/result"), json).await;
    Ok(())
}

async fn handle_network(state: &AgentState) -> anyhow::Result<()> {
    let mqtt_host = state.config.base.mqtt.host.clone();
    let report = tokio::task::spawn_blocking(move || crate::network::collect_all(&mqtt_host)).await?;
    let json = serde_json::to_vec(&report)?;
    let prefix = monitor_prefix(state);
    publish_json(state, &format!("{prefix}/network/result"), json).await;
    Ok(())
}

async fn handle_wininfo(state: &AgentState) -> anyhow::Result<()> {
    let report = tokio::task::spawn_blocking(crate::windows_info::collect_all).await?;
    let json = serde_json::to_vec(&report)?;
    let prefix = monitor_prefix(state);
    publish_json(state, &format!("{prefix}/wininfo/result"), json).await;
    Ok(())
}

// ── Infra commands (update, restart, config) ──

async fn handle_infra_command(
    state: &AgentState,
    topic: &str,
    parts: &[&str],
    payload: &[u8],
) {
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

    publish_update_status(
        state,
        &cmd.command_id,
        svf_agent_core::proto::UpdateState::Downloading,
        0,
        "",
    )
    .await;

    let dest_dir = std::path::Path::new(&state.config.base.download.temp_dir);

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(
            state.config.base.download.timeout_secs,
        ))
        .build()
        .unwrap();

    match svf_agent_core::updater::download_and_verify(
        &http_client,
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
                    let msg = format!("MSI install returned code: {code}");
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

async fn handle_restart_command(state: &AgentState, payload: &[u8]) {
    let cmd = match svf_agent_core::proto::RestartCommand::decode(payload) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to decode RestartCommand: {e}");
            return;
        }
    };

    info!(reason = %cmd.reason, delay = cmd.delay_seconds, "Restart requested");

    // Flush pending offline messages before stopping
    match state.offline_store.drain_pending(100) {
        Ok(pending) if !pending.is_empty() => {
            info!(count = pending.len(), "Flushing offline messages before restart");
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
        .map(|pd| format!("{pd}\\SvoePhoto\\monitor-config.toml"))
        .unwrap_or_else(|_| "config.toml".into());
    #[cfg(not(target_os = "windows"))]
    let config_path = "/etc/svf-agent/monitor-config.toml".to_string();

    let prefix = monitor_prefix(state);

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

fn monitor_prefix(state: &AgentState) -> String {
    mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    )
}

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

    let prefix = monitor_prefix(state);
    let topic = format!("{prefix}/updates/status");
    let payload = status.encode_to_vec();

    let _ = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload)
        .await;
}

/// Publish JSON payload to MQTT with offline fallback.
async fn publish_json(state: &AgentState, topic: &str, payload: Vec<u8>) {
    if state.mqtt_handle.is_connected().await {
        if let Err(e) = state
            .mqtt_handle
            .publish(topic, QoS::AtLeastOnce, false, payload.clone())
            .await
        {
            warn!(error = %e, "MQTT publish failed, queueing offline");
            enqueue_with_cap(state, topic, &payload);
        }
    } else {
        enqueue_with_cap(state, topic, &payload);
    }
}

/// Enqueue a message into the offline store, but only if the queue hasn't
/// exceeded [`OFFLINE_QUEUE_CAP`]. Prevents unbounded disk growth when MQTT
/// is down for a long time.
fn enqueue_with_cap(state: &AgentState, topic: &str, payload: &[u8]) {
    if let Ok(count) = state.offline_store.pending_count() {
        if count > OFFLINE_QUEUE_CAP {
            error!(count, "Offline queue full (>{OFFLINE_QUEUE_CAP}), dropping message");
            return;
        }
    }
    let _ = state.offline_store.queue_message(topic, payload, 1);
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
