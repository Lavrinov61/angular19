use std::sync::Arc;
use std::time::Duration;
use tracing::debug;

use crate::{AgentState, cups, mqtt, proto};

/// Background task: periodically poll CUPS printer status and report via MQTT
pub async fn run(state: Arc<AgentState>) {
    let poll_interval = Duration::from_secs(state.config.telemetry.poll_interval_secs);
    let heartbeat_interval = Duration::from_secs(state.config.telemetry.heartbeat_interval_secs);

    // Wait for initial MQTT connection
    tokio::time::sleep(Duration::from_secs(5)).await;

    let mut poll_ticker = tokio::time::interval(poll_interval);
    let mut heartbeat_ticker = tokio::time::interval(heartbeat_interval);

    loop {
        tokio::select! {
            _ = poll_ticker.tick() => {
                collect_and_report(&state).await;
            }
            _ = heartbeat_ticker.tick() => {
                mqtt::send_heartbeat(&state).await;
            }
        }
    }
}

/// Collect CUPS printer status and publish telemetry report
async fn collect_and_report(state: &AgentState) {
    let printers = cups::list_printers();
    if printers.is_empty() {
        debug!("No CUPS printers found");
        return;
    }

    for printer_name in &printers {
        let status = cups::get_printer_status(printer_name);
        let supplies = cups::get_printer_supplies(printer_name);

        // Build supplies JSON from parsed CUPS marker attributes
        let supplies_json = if supplies.is_empty() {
            String::new()
        } else {
            let supply_data: Vec<serde_json::Value> = supplies.iter().map(|s| {
                serde_json::json!({
                    "name": s.name,
                    "level": s.level,
                    "type": s.supply_type,
                    "color": s.color,
                })
            }).collect();
            serde_json::json!(supply_data).to_string()
        };

        let report = proto::TelemetryReport {
            bridge_id: state.config.agent.bridge_id.clone(),
            printer_id: printer_name.clone(),
            is_online: status.is_online,
            state: status.state.clone(),
            state_reasons: status.state_reasons.clone(),
            supplies_json,
            trays_json: String::new(),
            counters_json: String::new(),
            errors_json: if status.state == "stopped" {
                serde_json::json!({"state": "stopped", "reasons": status.state_reasons}).to_string()
            } else {
                String::new()
            },
            model: String::new(),
            manufacturer: String::new(),
            serial_number: String::new(),
            firmware_version: String::new(),
            consumable_usage: None,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };

        mqtt::send_telemetry(state, report).await;
    }
}
