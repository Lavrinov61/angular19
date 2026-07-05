//! Guard agent — Agent trait implementation.

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::RwLock;

use svf_agent_core::agent::{Agent, AgentConfig};
use svf_agent_core::config::BaseConfig;
use svf_agent_core::error::AgentError;
use svf_agent_core::health::HealthStatus;
use svf_agent_core::mqtt::MqttHandle;
use svf_agent_core::offline::OfflineStore;
use svf_agent_core::AgentType;

use crate::{cdr, commands, scanner};

// ── Config ──

/// Guard agent config extends BaseConfig with security-specific settings.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct GuardAgentConfig {
    #[serde(flatten)]
    pub base: BaseConfig,
    #[serde(default)]
    pub guard: GuardConfig,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct GuardConfig {
    /// Directories to watch for CDR scanning
    #[serde(default = "default_watch_dirs")]
    pub watch_dirs: Vec<String>,
    /// CDR scan interval in seconds
    #[serde(default = "default_scan_interval")]
    pub scan_interval_secs: u64,
    /// Defender check interval in seconds
    #[serde(default = "default_defender_interval")]
    pub defender_check_interval_secs: u64,
    /// Max file size to scan (bytes)
    #[serde(default = "default_max_scan_size")]
    pub max_scan_size: u64,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            watch_dirs: default_watch_dirs(),
            scan_interval_secs: default_scan_interval(),
            defender_check_interval_secs: default_defender_interval(),
            max_scan_size: default_max_scan_size(),
        }
    }
}

fn default_watch_dirs() -> Vec<String> {
    vec!["C:\\ProgramData\\SvoePhoto\\".into()]
}
fn default_scan_interval() -> u64 { 300 }
fn default_defender_interval() -> u64 { 60 }
fn default_max_scan_size() -> u64 { 52_428_800 } // 50 MB

impl AgentConfig for GuardAgentConfig {
    fn base(&self) -> &BaseConfig {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseConfig {
        &mut self.base
    }
}

// ── State ──

/// Shared state for all async tasks.
pub struct GuardAgentState {
    pub config: GuardAgentConfig,
    pub mqtt_handle: MqttHandle,
    pub offline_store: OfflineStore,
    pub cdr_scanner: RwLock<cdr::CdrScanner>,
    pub start_time: Instant,
}

// ── Agent impl ──

pub struct GuardAgent;

impl Agent for GuardAgent {
    type Config = GuardAgentConfig;
    type State = GuardAgentState;

    fn agent_type(&self) -> AgentType {
        AgentType::Guard
    }

    fn service_name(&self) -> &'static str {
        "SvfGuardAgent"
    }

    fn log_name(&self) -> &'static str {
        "svf_guard_agent"
    }

    fn client_id_prefix(&self) -> &'static str {
        "svf-guard"
    }

    fn validate_config(&self, config: &GuardAgentConfig) -> Result<(), AgentError> {
        if config.base.agent.studio_id.is_empty() {
            return Err(AgentError::Config("agent.studio_id must not be empty".into()));
        }
        if config.base.agent.agent_id.is_empty() {
            return Err(AgentError::Config("agent.agent_id must not be empty".into()));
        }
        if config.guard.scan_interval_secs < 30 {
            return Err(AgentError::Config(format!(
                "guard.scan_interval_secs must be >= 30, got {}",
                config.guard.scan_interval_secs
            )));
        }
        if config.guard.watch_dirs.is_empty() {
            return Err(AgentError::Config("guard.watch_dirs must not be empty".into()));
        }
        Ok(())
    }

    fn build_state(
        &self,
        config: GuardAgentConfig,
        mqtt_handle: MqttHandle,
        offline_store: OfflineStore,
        start_time: Instant,
    ) -> Result<Arc<GuardAgentState>, AgentError> {
        let watch_dirs = config.guard.watch_dirs.iter().map(Into::into).collect();
        let cdr_scanner = cdr::CdrScanner::new(watch_dirs, config.guard.max_scan_size);

        Ok(Arc::new(GuardAgentState {
            config,
            mqtt_handle,
            offline_store,
            cdr_scanner: RwLock::new(cdr_scanner),
            start_time,
        }))
    }

    fn subscribe_topics(&self) -> Vec<&'static str> {
        vec![
            "commands/scan",
            "commands/update",
            "commands/restart",
            "config",
        ]
    }

    async fn handle_message(state: Arc<GuardAgentState>, topic: String, payload: Vec<u8>) {
        commands::handle_message(&state, &topic, &payload).await;
    }

    fn spawn_tasks(
        &self,
        state: Arc<GuardAgentState>,
    ) -> Vec<(&'static str, tokio::task::JoinHandle<()>)> {
        let scanner_state = Arc::clone(&state);
        let sync_state = Arc::clone(&state);

        vec![
            ("scanner", tokio::spawn(scanner::run(scanner_state))),
            ("offline_sync", tokio::spawn(commands::run_offline_sync(sync_state))),
        ]
    }

    fn health_check(&self, state: &GuardAgentState) -> HealthStatus {
        let threats = scanner::threats_found();
        if threats > 0 {
            return HealthStatus::Unhealthy {
                reason: format!("{threats} active threat(s) detected"),
            };
        }

        let scan_ms = scanner::last_scan_duration_ms();
        if scan_ms > 60_000 {
            return HealthStatus::Degraded {
                reason: format!("Last scan took {scan_ms}ms (>60s)"),
            };
        }

        // Check Defender status could be added here in the future
        let _ = state;
        HealthStatus::Healthy
    }
}
