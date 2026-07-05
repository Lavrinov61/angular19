//! POS telemetry — periodic health checks for INPAS terminal + АТОЛ fiscal device.

use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::QoS;
use tracing::{debug, error};

use svf_agent_core::mqtt;

use crate::AgentState;
use crate::proto;

/// Run POS telemetry collector: check INPAS + АТОЛ health every interval.
pub async fn run(state: Arc<AgentState>) {
    let interval_secs = state.config.pos_telemetry.interval_secs;
    let interval = Duration::from_secs(interval_secs);

    // Initial delay
    tokio::time::sleep(Duration::from_secs(5)).await;

    loop {
        collect_and_publish(&state).await;
        tokio::time::sleep(interval).await;
    }
}

async fn collect_and_publish(state: &AgentState) {
    // Check device availability in parallel
    let (terminal_online, fiscal_online, fiscal_shift_status) = tokio::join!(
        state.inpas_client.is_online(),
        state.atol_client.is_online(),
        state.atol_client.shift_status(),
    );
    let shift_status = fiscal_shift_status.unwrap_or_else(|| "unknown".into());

    let telemetry = proto::PosTelemetry {
        agent_id: state.config.base.agent.agent_id.clone(),
        terminal_online,
        fiscal_online,
        terminal_model: String::new(), // populated from device status in future
        fiscal_model: String::new(),
        shift_status: shift_status.clone(),
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    };

    debug!(
        terminal = terminal_online,
        fiscal = fiscal_online,
        shift_status,
        "POS telemetry"
    );

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );

    let topic = format!("{prefix}/telemetry");

    let mut buf = Vec::with_capacity(telemetry.encoded_len());
    if let Err(e) = telemetry.encode(&mut buf) {
        error!(error = %e, "Failed to encode POS telemetry");
        return;
    }

    if state.mqtt_handle.is_connected().await {
        if let Err(e) = state
            .mqtt_handle
            .publish(&topic, QoS::AtMostOnce, false, buf)
            .await
        {
            debug!(error = %e, "Failed to publish POS telemetry");
        }
    }

    // Send alert if terminal or fiscal device is offline
    if !terminal_online || !fiscal_online {
        let (severity, title) = build_alert_info(terminal_online, fiscal_online);

        let alert = proto::AgentAlert {
            agent_id: state.config.base.agent.agent_id.clone(),
            alert_type: "device_offline".into(),
            severity,
            title,
            details_json: serde_json::json!({
                "terminal_online": terminal_online,
                "fiscal_online": fiscal_online,
            })
            .to_string(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };

        let alert_topic = format!("{prefix}/alerts");
        let mut alert_buf = Vec::with_capacity(alert.encoded_len());
        if alert.encode(&mut alert_buf).is_ok() {
            let _ = state
                .mqtt_handle
                .publish(&alert_topic, QoS::AtLeastOnce, false, alert_buf)
                .await;
        }
    }
}

/// Build alert severity and title from device online status.
/// Extracted for testability.
fn build_alert_info(terminal_online: bool, fiscal_online: bool) -> (String, String) {
    let mut devices_down = Vec::new();
    if !terminal_online {
        devices_down.push("INPAS terminal");
    }
    if !fiscal_online {
        devices_down.push("АТОЛ fiscal");
    }

    let severity = if !terminal_online && !fiscal_online {
        "critical"
    } else {
        "warning"
    };

    let title = format!("POS: {} недоступен", devices_down.join(", "));
    (severity.into(), title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alert_both_offline_is_critical() {
        let (severity, title) = build_alert_info(false, false);
        assert_eq!(severity, "critical");
        assert!(title.contains("INPAS terminal"));
        assert!(title.contains("АТОЛ fiscal"));
    }

    #[test]
    fn alert_only_terminal_offline_is_warning() {
        let (severity, title) = build_alert_info(false, true);
        assert_eq!(severity, "warning");
        assert!(title.contains("INPAS terminal"));
        assert!(!title.contains("АТОЛ fiscal"));
    }

    #[test]
    fn alert_only_fiscal_offline_is_warning() {
        let (severity, title) = build_alert_info(true, false);
        assert_eq!(severity, "warning");
        assert!(!title.contains("INPAS terminal"));
        assert!(title.contains("АТОЛ fiscal"));
    }

    #[test]
    fn alert_details_json_structure() {
        let terminal_online = false;
        let fiscal_online = true;
        let details = serde_json::json!({
            "terminal_online": terminal_online,
            "fiscal_online": fiscal_online,
        });
        let parsed: serde_json::Value = serde_json::from_str(&details.to_string()).unwrap();
        assert_eq!(parsed["terminal_online"], false);
        assert_eq!(parsed["fiscal_online"], true);
    }
}
