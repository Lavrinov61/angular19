//! Periodic heartbeat publisher.

use std::time::{Duration, Instant};
use rumqttc::QoS;
use prost::Message;

use crate::config::BaseConfig;
use crate::mqtt::MqttHandle;

/// Run the heartbeat loop — publishes AgentHeartbeat to MQTT every `interval_secs`.
pub async fn run(
    config: &BaseConfig,
    handle: MqttHandle,
    start_time: Instant,
) {
    let interval = Duration::from_secs(config.heartbeat.interval_secs);
    let prefix = crate::mqtt::topic_prefix(&config.agent.studio_id, &config.agent.agent_type);
    let topic = format!("{prefix}/heartbeat");

    loop {
        tokio::time::sleep(interval).await;

        if !handle.is_connected().await {
            continue;
        }

        let heartbeat = crate::proto::AgentHeartbeat {
            agent_id: config.agent.agent_id.clone(),
            agent_type: agent_type_to_proto(&config.agent.agent_type),
            version: config.agent.version.clone(),
            os_info: std::env::consts::OS.to_string(),
            os_arch: std::env::consts::ARCH.to_string(),
            hostname: hostname(),
            uptime_seconds: start_time.elapsed().as_secs() as i64,
            config_version: 0,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            metadata: Default::default(),
        };

        let payload = heartbeat.encode_to_vec();

        if let Err(e) = handle.publish(&topic, QoS::AtLeastOnce, false, payload).await {
            tracing::warn!("Heartbeat publish failed: {e}");
        }
    }
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown".into())
}

fn agent_type_to_proto(t: &str) -> i32 {
    match t {
        "print" => 1,
        "pos" => 2,
        "vision" => 3,
        "monitor" => 4,
        "guard" => 5,
        _ => 0,
    }
}
