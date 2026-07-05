//! Print agent — Agent trait implementation.

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::RwLock;
use tracing::{error, info};

use svf_agent_core::agent::{Agent, AgentConfig};
use svf_agent_core::config::BaseConfig;
use svf_agent_core::error::AgentError;
use svf_agent_core::mqtt::MqttHandle;
use svf_agent_core::offline::OfflineStore;
use svf_agent_core::AgentType;

use crate::icc::IccCache;
use crate::{canon_api, commands, discovery, scan, telemetry};
use crate::PrintAgentConfig;

// ── Config ──

impl AgentConfig for PrintAgentConfig {
    fn base(&self) -> &BaseConfig {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseConfig {
        &mut self.base
    }
}

// ── State ──

/// Shared state for all async tasks.
pub struct PrintAgentState {
    pub config: PrintAgentConfig,
    pub mqtt_handle: MqttHandle,
    pub offline_store: OfflineStore,
    pub http_client: reqwest::Client,
    pub icc_cache: Option<IccCache>,
    pub start_time: Instant,
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,
    pub printer_cache: Arc<RwLock<(Vec<crate::printing::PrinterCapabilities>, Instant)>>,
}

// ── Agent impl ──

pub struct PrintAgent;

impl Agent for PrintAgent {
    type Config = PrintAgentConfig;
    type State = PrintAgentState;

    fn agent_type(&self) -> AgentType {
        AgentType::Print
    }

    fn service_name(&self) -> &'static str {
        "SvfPrintAgent"
    }

    fn log_name(&self) -> &'static str {
        "svf_print_agent"
    }

    fn client_id_prefix(&self) -> &'static str {
        "svf-print"
    }

    fn validate_config(&self, config: &PrintAgentConfig) -> Result<(), AgentError> {
        if config.base.agent.studio_id.is_empty() {
            return Err(AgentError::Config("agent.studio_id must not be empty".into()));
        }
        if config.base.agent.agent_id.is_empty() {
            return Err(AgentError::Config("agent.agent_id must not be empty".into()));
        }
        if config.printing.target_dpi == 0 || config.printing.target_dpi > 2400 {
            return Err(AgentError::Config(format!(
                "printing.target_dpi must be 1..2400, got {}",
                config.printing.target_dpi
            )));
        }
        if config.printing.jpeg_quality == 0 || config.printing.jpeg_quality > 100 {
            return Err(AgentError::Config(format!(
                "printing.jpeg_quality must be 1..100, got {}",
                config.printing.jpeg_quality
            )));
        }
        if config.telemetry.poll_interval_secs < 5 {
            return Err(AgentError::Config(format!(
                "telemetry.poll_interval_secs must be >= 5, got {}",
                config.telemetry.poll_interval_secs
            )));
        }
        Ok(())
    }

    fn build_state(
        &self,
        config: PrintAgentConfig,
        mqtt_handle: MqttHandle,
        offline_store: OfflineStore,
        start_time: Instant,
    ) -> Result<Arc<PrintAgentState>, AgentError> {
        // Ensure temp directory exists
        std::fs::create_dir_all(&config.base.download.temp_dir).map_err(|e| {
            AgentError::Config(format!("Failed to create temp dir: {e}"))
        })?;

        // Clean up stale temp files from previous crashes
        if let Ok(entries) = std::fs::read_dir(&config.base.download.temp_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if modified.elapsed().unwrap_or_default()
                            > std::time::Duration::from_secs(3600)
                        {
                            let _ = std::fs::remove_file(entry.path());
                            info!(file = %entry.path().display(), "Cleaned stale temp file");
                        }
                    }
                }
            }
        }

        // Shutdown channel for graceful shutdown via MQTT commands
        let (shutdown_tx, _shutdown_rx) = tokio::sync::watch::channel(false);

        // Initialize ICC profile cache
        let icc_cache = match IccCache::new(&config.icc.cache_dir) {
            Ok(cache) => {
                info!(path = %config.icc.cache_dir, "ICC cache ready");
                Some(cache)
            }
            Err(e) => {
                error!("Failed to initialize ICC cache: {e} — ICC transforms disabled");
                None
            }
        };

        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(
                config.base.download.timeout_secs,
            ))
            .build()
            .map_err(|e| AgentError::Config(format!("Failed to build HTTP client: {e}")))?;

        // Discover printers at startup
        let printers = discovery::discover_printers();
        info!(count = printers.len(), "Discovered printers");
        for p in &printers {
            info!(
                name = %p.name,
                printer_type = %p.printer_type,
                "  Printer: {} ({})",
                p.name,
                p.printer_type
            );
        }

        let printer_cache = Arc::new(RwLock::new((printers, Instant::now())));

        Ok(Arc::new(PrintAgentState {
            config,
            mqtt_handle,
            offline_store,
            http_client,
            icc_cache,
            start_time,
            shutdown_tx,
            printer_cache,
        }))
    }

    fn subscribe_topics(&self) -> Vec<&'static str> {
        vec![
            "commands/print",
            "commands/preview",
            "commands/icc_sync",
            "commands/update",
            "commands/restart",
            "config",
        ]
    }

    async fn handle_message(state: Arc<PrintAgentState>, topic: String, payload: Vec<u8>) {
        commands::handle_message(&state, &topic, &payload).await;
    }

    fn spawn_tasks(
        &self,
        state: Arc<PrintAgentState>,
    ) -> Vec<(&'static str, tokio::task::JoinHandle<()>)> {
        let telemetry_state = Arc::clone(&state);
        let sync_state = Arc::clone(&state);
        let canon_state = Arc::clone(&state);
        let scan_state = Arc::clone(&state);

        vec![
            ("telemetry", tokio::spawn(telemetry::run(telemetry_state))),
            ("offline_sync", tokio::spawn(commands::run_offline_sync(sync_state))),
            ("canon_api", tokio::spawn(canon_api::run(canon_state))),
            ("scan_watcher", tokio::spawn(scan::run(scan_state))),
        ]
    }

    async fn on_shutdown(&self, state: &PrintAgentState) {
        let _ = state.shutdown_tx.send(true);
        info!("Shutdown signal sent to all tasks");
    }
}
