//! Monitor agent — Agent trait implementation.

use std::sync::Arc;
use std::time::Instant;

use svf_agent_core::agent::{Agent, AgentConfig};
use svf_agent_core::config::BaseConfig;
use svf_agent_core::error::AgentError;
use svf_agent_core::mqtt::MqttHandle;
use svf_agent_core::offline::OfflineStore;
use svf_agent_core::AgentType;

use crate::commands;

// ── Config ──

/// Monitor agent config extends BaseConfig with monitor-specific settings.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MonitorAgentConfig {
    #[serde(flatten)]
    pub base: BaseConfig,
    #[serde(default)]
    pub monitor: MonitorConfig,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct MonitorConfig {
    #[serde(default = "default_exec_timeout")]
    pub exec_timeout_secs: u64,
    #[serde(default = "default_max_output")]
    pub max_output_bytes: usize,
    #[serde(default)]
    pub whitelisted_paths: Vec<String>,
    /// Allowed executables — loaded from config, NOT compiled into binary.
    #[serde(default)]
    pub allowed_commands: Vec<String>,
    /// Allowed PowerShell cmdlets — loaded from config.
    #[serde(default)]
    pub allowed_ps_commands: Vec<String>,
    /// Blocked substrings in PowerShell args (safety net).
    #[serde(default = "default_blocked_ps")]
    pub blocked_ps_patterns: Vec<String>,
    /// Configurable list of Windows services that can be managed.
    /// If empty, falls back to the built-in default in service.rs.
    #[serde(default)]
    pub allowed_services: Vec<String>,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            exec_timeout_secs: default_exec_timeout(),
            max_output_bytes: default_max_output(),
            whitelisted_paths: vec!["C:\\ProgramData\\SvoePhoto\\".into()],
            allowed_commands: Vec::new(),
            allowed_ps_commands: Vec::new(),
            blocked_ps_patterns: default_blocked_ps(),
            allowed_services: Vec::new(),
        }
    }
}

fn default_exec_timeout() -> u64 { 60 }
fn default_max_output() -> usize { 131072 }
fn default_blocked_ps() -> Vec<String> {
    vec![
        "invoke-expression".into(),
        "iex ".into(),
        "format-volume".into(),
        "clear-disk".into(),
    ]
}

impl AgentConfig for MonitorAgentConfig {
    fn base(&self) -> &BaseConfig {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseConfig {
        &mut self.base
    }
}

// ── State ──

/// Shared state for all async tasks.
pub struct MonitorAgentState {
    pub config: MonitorAgentConfig,
    pub mqtt_handle: MqttHandle,
    pub offline_store: OfflineStore,
    pub start_time: Instant,
}

// ── Agent impl ──

pub struct MonitorAgent;

impl Agent for MonitorAgent {
    type Config = MonitorAgentConfig;
    type State = MonitorAgentState;

    fn agent_type(&self) -> AgentType {
        AgentType::Monitor
    }

    fn service_name(&self) -> &'static str {
        "SvfMonitorAgent"
    }

    fn log_name(&self) -> &'static str {
        "svf_monitor_agent"
    }

    fn client_id_prefix(&self) -> &'static str {
        "svf-mon"
    }

    fn validate_config(&self, config: &MonitorAgentConfig) -> Result<(), AgentError> {
        if config.base.agent.studio_id.is_empty() {
            return Err(AgentError::Config("agent.studio_id must not be empty".into()));
        }
        if config.base.agent.agent_id.is_empty() {
            return Err(AgentError::Config("agent.agent_id must not be empty".into()));
        }
        if config.base.heartbeat.interval_secs < 5 {
            return Err(AgentError::Config(format!(
                "heartbeat.interval_secs must be >= 5, got {}",
                config.base.heartbeat.interval_secs
            )));
        }
        Ok(())
    }

    fn build_state(
        &self,
        config: MonitorAgentConfig,
        mqtt_handle: MqttHandle,
        offline_store: OfflineStore,
        start_time: Instant,
    ) -> Result<Arc<MonitorAgentState>, AgentError> {
        Ok(Arc::new(MonitorAgentState {
            config,
            mqtt_handle,
            offline_store,
            start_time,
        }))
    }

    fn subscribe_topics(&self) -> Vec<&'static str> {
        vec![
            "commands/exec",
            "commands/sysinfo",
            "commands/service",
            "commands/logs",
            "commands/file",
            "commands/update",
            "commands/restart",
            "config",
        ]
    }

    async fn handle_message(state: Arc<MonitorAgentState>, topic: String, payload: Vec<u8>) {
        commands::handle_message(&state, &topic, &payload).await;
    }

    fn spawn_tasks(
        &self,
        state: Arc<MonitorAgentState>,
    ) -> Vec<(&'static str, tokio::task::JoinHandle<()>)> {
        vec![
            ("offline_sync", tokio::spawn(commands::run_offline_sync(Arc::clone(&state)))),
        ]
    }
}
