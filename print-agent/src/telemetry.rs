//! Printer telemetry collection — periodically polls printer status and publishes via MQTT.

use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::QoS;
use tracing::debug;

use crate::printing;
use crate::print_proto;
use crate::snmp;
use crate::AgentState;
use svf_agent_core::circuit_breaker::CircuitBreaker;
use svf_agent_core::mqtt;

/// Background task: periodically poll printer status and report via MQTT.
pub async fn run(state: Arc<AgentState>) {
    let poll_interval = Duration::from_secs(state.config.telemetry.poll_interval_secs);

    // Wait for MQTT to connect
    tokio::time::sleep(Duration::from_secs(5)).await;

    let mut ticker = tokio::time::interval(poll_interval);
    let mut snmp_cache: Option<(snmp::SnmpPrinterData, std::time::Instant)> = None;
    // Circuit breaker: 5 consecutive SNMP failures → open for 5 minutes
    let mut snmp_cb = CircuitBreaker::new("snmp-telemetry", 5, Duration::from_secs(300));

    loop {
        ticker.tick().await;
        collect_and_report(&state, &mut snmp_cache, &mut snmp_cb).await;
    }
}

async fn collect_and_report(
    state: &AgentState,
    snmp_cache: &mut Option<(snmp::SnmpPrinterData, std::time::Instant)>,
    snmp_cb: &mut CircuitBreaker,
) {
    // Use cached printers, refresh if older than 5 minutes
    let cache = state.printer_cache.read().await;
    let printers = if cache.1.elapsed() > std::time::Duration::from_secs(300) {
        drop(cache);
        let fresh = crate::discovery::discover_printers();
        *state.printer_cache.write().await = (fresh.clone(), std::time::Instant::now());
        fresh
    } else {
        cache.0.clone()
    };

    if printers.is_empty() {
        debug!("No printers found");
        return;
    }

    // Poll Canon printer via SNMP if configured (cached with 5-minute TTL)
    let snmp_data = if !state.config.telemetry.printer_ip.is_empty() {
        // Check circuit breaker before SNMP poll
        if let Err(wait) = snmp_cb.check() {
            debug!(wait_secs = wait.as_secs(), "SNMP circuit open, skipping poll");
            // Return cached data if available, otherwise None
            snmp_cache.as_ref().map(|(data, _)| data.clone())
        } else if let Some((data, ts)) = snmp_cache.as_ref() {
            if ts.elapsed() < Duration::from_secs(300) {
                Some(data.clone())
            } else {
                let fresh = snmp::poll_printer(
                    &state.config.telemetry.printer_ip,
                    &state.config.telemetry.snmp_community,
                    2000,
                ).await;
                match fresh {
                    Some(ref d) => {
                        snmp_cb.record_success();
                        *snmp_cache = Some((d.clone(), std::time::Instant::now()));
                    }
                    None => {
                        snmp_cb.record_failure();
                    }
                }
                fresh
            }
        } else {
            let fresh = snmp::poll_printer(
                &state.config.telemetry.printer_ip,
                &state.config.telemetry.snmp_community,
                2000,
            ).await;
            match fresh {
                Some(ref d) => {
                    snmp_cb.record_success();
                    *snmp_cache = Some((d.clone(), std::time::Instant::now()));
                }
                None => {
                    snmp_cb.record_failure();
                }
            }
            fresh
        }
    } else {
        None
    };

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );

    for printer in &printers {
        let status = printing::get_printer_status(&printer.name);
        let supplies = if let Some(ref data) = snmp_data {
            if !data.supplies.is_empty() && printer.printer_type == printing::PrinterType::LaserMfp {
                data.supplies.iter().map(|s| printing::SupplyLevel {
                    name: s.name.clone(),
                    level: if s.max_capacity > 0 {
                        (s.current_level * 100) / s.max_capacity
                    } else {
                        s.current_level
                    },
                    supply_type: "toner".into(),
                    color: s.color.clone(),
                }).collect()
            } else {
                printing::get_printer_supplies(&printer.name)
            }
        } else {
            printing::get_printer_supplies(&printer.name)
        };

        let supplies_json = if supplies.is_empty() {
            String::new()
        } else {
            let supply_data: Vec<serde_json::Value> = supplies
                .iter()
                .map(|s| {
                    serde_json::json!({
                        "name": s.name,
                        "level": s.level,
                        "type": s.supply_type,
                        "color": s.color,
                    })
                })
                .collect();
            serde_json::json!(supply_data).to_string()
        };

        let report = print_proto::TelemetryReport {
            bridge_id: state.config.base.agent.agent_id.clone(),
            printer_id: printer.name.clone(),
            is_online: status.is_online,
            state: status.state.to_string(),
            state_reasons: status.state_reasons.clone(),
            supplies_json,
            trays_json: serde_json::json!(printer.trays).to_string(),
            counters_json: String::new(),
            errors_json: if status.state == printing::PrinterState::Error {
                serde_json::json!({"state": "error", "reasons": status.state_reasons}).to_string()
            } else {
                String::new()
            },
            model: printer.driver.clone(),
            manufacturer: snmp_data.as_ref()
                .filter(|d| d.sys_descr.to_lowercase().contains("canon"))
                .map(|_| "Canon".to_string())
                .unwrap_or_default(),
            serial_number: String::new(),
            firmware_version: snmp_data.as_ref()
                .map(|d| d.firmware.clone())
                .unwrap_or_default(),
            consumable_usage: None,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };

        let topic = format!("{prefix}/telemetry");
        let payload = report.encode_to_vec();

        if let Err(e) = state
            .mqtt_handle
            .publish(&topic, QoS::AtMostOnce, false, payload)
            .await
        {
            tracing::warn!(printer = %printer.name, "Failed to publish telemetry: {e}");
        }
    }
}
