//! MQTT command dispatcher — routes guard commands to handler modules.

use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::QoS;
use tracing::{error, info, warn};

use svf_agent_core::mqtt;

use crate::AgentState;

/// Handle an incoming MQTT message by routing to the appropriate handler.
pub async fn handle_message(state: &AgentState, topic: &str, payload: &[u8]) {
    let parts: Vec<&str> = topic.split('/').collect();
    // Expected: svoefoto/{studio_id}/guard/commands/{command_type}
    if parts.len() < 5 || parts[2] != "guard" || parts[3] != "commands" {
        // Not a guard command — might be config topic
        handle_infra_command(state, topic, parts.as_slice(), payload).await;
        return;
    }

    let command_type = parts[4];

    let result: anyhow::Result<()> = match command_type {
        "scan" => {
            info!("Force scan command received");
            crate::scanner::force_scan(state).await;

            // ACK: notify that scan completed
            let prefix = guard_prefix(state);
            let ack = serde_json::json!({
                "command": "scan",
                "status": "completed",
                "agent_id": state.config.base.agent.agent_id,
                "timestamp_ms": chrono::Utc::now().timestamp_millis(),
            });
            let _ = state
                .mqtt_handle
                .publish(
                    &format!("{prefix}/guard/ack"),
                    QoS::AtLeastOnce,
                    false,
                    ack.to_string().into_bytes(),
                )
                .await;

            Ok(())
        }
        "update" => {
            handle_update_command(state, payload).await;
            Ok(())
        }
        "restart" => {
            handle_restart_command(state, payload).await;
            Ok(())
        }
        _ => {
            warn!(command_type, "Unknown guard command");
            Ok(())
        }
    };

    if let Err(e) = result {
        error!(command_type, error = %e, "Guard command handler error");
    }
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
        .map(|pd| format!("{pd}\\SvoePhoto\\guard-config.toml"))
        .unwrap_or_else(|_| "config.toml".into());
    #[cfg(not(target_os = "windows"))]
    let config_path = "/etc/svf-agent/guard-config.toml".to_string();

    let prefix = guard_prefix(state);

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

fn guard_prefix(state: &AgentState) -> String {
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

    let prefix = guard_prefix(state);
    let topic = format!("{prefix}/updates/status");
    let payload = status.encode_to_vec();

    let _ = state
        .mqtt_handle
        .publish(&topic, QoS::AtLeastOnce, false, payload)
        .await;
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
