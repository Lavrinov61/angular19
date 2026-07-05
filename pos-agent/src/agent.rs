//! POS agent — Agent trait implementation.

use std::sync::Arc;
use std::time::Instant;

use svf_agent_core::AgentType;
use svf_agent_core::agent::{Agent, AgentConfig};
use svf_agent_core::config::BaseConfig;
use svf_agent_core::error::AgentError;
use svf_agent_core::mqtt::MqttHandle;
use svf_agent_core::offline::OfflineStore;

use crate::{atol, commands, inpas, telemetry};

// ── Config ──

/// POS agent config extends BaseConfig with POS-specific settings.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PosAgentConfig {
    #[serde(flatten)]
    pub base: BaseConfig,
    #[serde(default)]
    pub inpas: InpasConfig,
    #[serde(default)]
    pub atol: AtolConfig,
    #[serde(default)]
    pub pos_telemetry: PosTelemetryConfig,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct InpasConfig {
    #[serde(default = "default_inpas_url")]
    pub url: String,
    #[serde(default = "default_inpas_timeout")]
    pub timeout_secs: u64,
    #[serde(default)]
    pub terminal_id: String,
    #[serde(default = "default_inpas_currency")]
    pub currency_code: String,
}

impl Default for InpasConfig {
    fn default() -> Self {
        Self {
            url: default_inpas_url(),
            timeout_secs: default_inpas_timeout(),
            terminal_id: String::new(),
            currency_code: default_inpas_currency(),
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AtolConfig {
    #[serde(default = "default_atol_url")]
    pub url: String,
    #[serde(default = "default_atol_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_taxation_type")]
    pub taxation_type: String,
    #[serde(default = "default_atol_paper_width")]
    pub paper_width_mm: u32,
    pub dll_path: Option<String>,
    pub com_port: Option<String>,
    pub baud_rate: Option<u32>,
}

impl Default for AtolConfig {
    fn default() -> Self {
        Self {
            url: default_atol_url(),
            timeout_secs: default_atol_timeout(),
            taxation_type: default_taxation_type(),
            paper_width_mm: default_atol_paper_width(),
            dll_path: None,
            com_port: None,
            baud_rate: None,
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct PosTelemetryConfig {
    #[serde(default = "default_telemetry_interval")]
    pub interval_secs: u64,
}

impl Default for PosTelemetryConfig {
    fn default() -> Self {
        Self {
            interval_secs: default_telemetry_interval(),
        }
    }
}

fn default_inpas_url() -> String {
    "http://localhost:9015".into()
}
fn default_inpas_timeout() -> u64 {
    120
}
fn default_inpas_currency() -> String {
    "643".into()
}
fn default_atol_url() -> String {
    "http://localhost:16732".into()
}
fn default_atol_timeout() -> u64 {
    30
}
fn default_taxation_type() -> String {
    "osn".into()
}
fn default_atol_paper_width() -> u32 {
    58
}
fn default_telemetry_interval() -> u64 {
    60
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_atol_paper_width_is_58mm() {
        assert_eq!(AtolConfig::default().paper_width_mm, 58);
    }
}

impl AgentConfig for PosAgentConfig {
    fn base(&self) -> &BaseConfig {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseConfig {
        &mut self.base
    }
}

// ── State ──

/// Shared state for all async tasks.
pub struct PosAgentState {
    pub config: PosAgentConfig,
    pub mqtt_handle: MqttHandle,
    pub offline_store: OfflineStore,
    pub http_client: reqwest::Client,
    pub inpas_client: inpas::InpasClient,
    pub atol_client: atol::AtolClient,
    pub start_time: Instant,
}

// ── Agent impl ──

pub struct PosAgent;

impl Agent for PosAgent {
    type Config = PosAgentConfig;
    type State = PosAgentState;

    fn agent_type(&self) -> AgentType {
        AgentType::Pos
    }

    fn service_name(&self) -> &'static str {
        "SvfPosAgent"
    }

    fn log_name(&self) -> &'static str {
        "svf_pos_agent"
    }

    fn client_id_prefix(&self) -> &'static str {
        "svf-pos"
    }

    fn validate_config(&self, config: &PosAgentConfig) -> Result<(), AgentError> {
        if config.base.agent.studio_id.is_empty() {
            return Err(AgentError::Config(
                "agent.studio_id must not be empty".into(),
            ));
        }
        if config.base.agent.agent_id.is_empty() {
            return Err(AgentError::Config(
                "agent.agent_id must not be empty".into(),
            ));
        }
        if config.inpas.timeout_secs == 0 {
            return Err(AgentError::Config("inpas.timeout_secs must be > 0".into()));
        }
        if config.inpas.currency_code.trim().is_empty() {
            return Err(AgentError::Config(
                "inpas.currency_code must not be empty".into(),
            ));
        }
        if config.atol.timeout_secs == 0 {
            return Err(AgentError::Config("atol.timeout_secs must be > 0".into()));
        }
        if !matches!(config.atol.paper_width_mm, 57 | 58 | 80) {
            return Err(AgentError::Config(
                "atol.paper_width_mm must be 57, 58, or 80".into(),
            ));
        }
        Ok(())
    }

    fn build_state(
        &self,
        config: PosAgentConfig,
        mqtt_handle: MqttHandle,
        offline_store: OfflineStore,
        start_time: Instant,
    ) -> Result<Arc<PosAgentState>, AgentError> {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(
                config.base.download.timeout_secs,
            ))
            .build()
            .map_err(|e| AgentError::Config(format!("Failed to build HTTP client: {e}")))?;

        let inpas_client = inpas::InpasClient::new(&config.inpas);
        let atol_client = atol::AtolClient::new(&config.atol);

        Ok(Arc::new(PosAgentState {
            config,
            mqtt_handle,
            offline_store,
            http_client,
            inpas_client,
            atol_client,
            start_time,
        }))
    }

    fn subscribe_topics(&self) -> Vec<&'static str> {
        vec![
            "commands/pay",
            "commands/refund",
            "commands/fiscal",
            "commands/sbp_generate",
            "commands/sbp_status",
            "commands/shift",
            "commands/cash_drawer",
            "commands/settlement",
            "commands/receipt_copy",
            "commands/update",
            "commands/restart",
            "config",
        ]
    }

    async fn handle_message(state: Arc<PosAgentState>, topic: String, payload: Vec<u8>) {
        commands::handle_message(&state, &topic, &payload).await;
    }

    fn spawn_tasks(
        &self,
        state: Arc<PosAgentState>,
    ) -> Vec<(&'static str, tokio::task::JoinHandle<()>)> {
        vec![
            (
                "telemetry",
                tokio::spawn(telemetry::run(Arc::clone(&state))),
            ),
            (
                "offline_sync",
                tokio::spawn(commands::run_offline_sync(Arc::clone(&state))),
            ),
        ]
    }
}
