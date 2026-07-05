mod config;
mod cups;
mod icc;
mod mqtt;
mod offline;
mod pipeline;
mod telemetry;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/svf.print.rs"));
}

use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tracing::{info, error};

/// Shared state accessible by all async tasks
pub struct AgentState {
    pub config: config::Config,
    pub mqtt_client: RwLock<Option<rumqttc::AsyncClient>>,
    pub offline_store: offline::OfflineStore,
    pub http_client: reqwest::Client,
    pub icc_cache: Option<icc::IccCache>,
    pub start_time: Instant,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,svf_print_agent=debug".parse().unwrap()),
        )
        .init();

    let config = config::Config::load()?;
    info!(
        bridge_id = %config.agent.bridge_id,
        studio_id = %config.agent.studio_id,
        version = %config.agent.version,
        "SVF Print Agent starting"
    );

    // Ensure temp directory exists
    std::fs::create_dir_all(&config.download.temp_dir)?;

    // Initialize offline SQLite store
    let offline_store = offline::OfflineStore::open(&config.offline.db_path)?;
    info!(path = %config.offline.db_path.display(), "Offline store ready");

    // Initialize ICC profile cache (Phase 4.1)
    let icc_cache = match icc::IccCache::new(&config.icc.cache_dir) {
        Ok(cache) => {
            info!(path = %config.icc.cache_dir.display(), "ICC cache ready");
            Some(cache)
        }
        Err(e) => {
            error!("Failed to initialize ICC cache: {e} — ICC transforms disabled");
            None
        }
    };

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.download.timeout_secs))
        .build()?;

    let state = Arc::new(AgentState {
        config,
        mqtt_client: RwLock::new(None),
        offline_store,
        http_client,
        icc_cache,
        start_time: Instant::now(),
    });

    // Spawn MQTT connection + command handler
    let mqtt_handle = tokio::spawn(mqtt::run(Arc::clone(&state)));

    // Spawn telemetry collector
    let telemetry_handle = tokio::spawn(telemetry::run(Arc::clone(&state)));

    // Spawn offline sync (drain queued jobs when MQTT reconnects)
    let sync_handle = tokio::spawn(offline::run_sync(Arc::clone(&state)));

    info!("All tasks started. Waiting for shutdown signal...");

    // Graceful shutdown on SIGTERM/SIGINT
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received SIGINT, shutting down...");
        }
        result = mqtt_handle => {
            error!(?result, "MQTT task exited unexpectedly");
        }
        result = telemetry_handle => {
            error!(?result, "Telemetry task exited unexpectedly");
        }
        result = sync_handle => {
            error!(?result, "Offline sync task exited unexpectedly");
        }
    }

    info!("SVF Print Agent stopped");
    Ok(())
}
