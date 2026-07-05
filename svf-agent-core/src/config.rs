//! TOML configuration loading with fallback chain and hot-reload support.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Base config shared by all agents.
#[derive(Debug, Clone, Deserialize)]
pub struct BaseConfig {
    pub agent: AgentConfig,
    pub mqtt: MqttConfig,
    pub offline: OfflineConfig,
    pub heartbeat: HeartbeatConfig,
    pub download: DownloadConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentConfig {
    pub agent_id: String,
    pub studio_id: String,
    pub agent_type: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MqttConfig {
    pub host: String,
    #[serde(default = "default_mqtt_port")]
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub use_tls: bool,
    #[serde(default)]
    pub use_websocket: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OfflineConfig {
    #[serde(default = "default_db_path")]
    pub db_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HeartbeatConfig {
    #[serde(default = "default_heartbeat_interval")]
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadConfig {
    #[serde(default = "default_temp_dir")]
    pub temp_dir: String,
    #[serde(default = "default_download_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u64,
}

fn default_mqtt_port() -> u16 { 8883 }
fn default_db_path() -> String { "offline.db".into() }
fn default_heartbeat_interval() -> u64 { 60 }
fn default_temp_dir() -> String { std::env::temp_dir().join("svf-agent").to_string_lossy().into() }
fn default_download_timeout() -> u64 { 120 }
fn default_max_file_size() -> u64 { 104_857_600 } // 100 MB

/// Load config from TOML file with fallback chain.
///
/// Searches paths in order:
/// 1. Provided `config_path` argument (if Some)
/// 2. `{exe_dir}/config.toml` — next to the executable (primary for Windows services)
/// 3. `./config.toml` — relative to CWD
/// 4. Platform-specific defaults (Linux: `/etc/svf-agent/config.toml`, Windows: `%ProgramData%\SvoePhoto\config.toml`)
pub fn load_config<T: serde::de::DeserializeOwned>(config_path: Option<&str>) -> anyhow::Result<T> {
    let candidates = build_candidate_paths(config_path);

    for path in &candidates {
        if path.exists() {
            tracing::info!("Loading config from: {}", path.display());
            let content = std::fs::read_to_string(path)?;
            let config: T = toml::from_str(&content)?;
            return Ok(config);
        }
    }

    anyhow::bail!(
        "Config not found. Searched: {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
    )
}

fn build_candidate_paths(config_path: Option<&str>) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(p) = config_path {
        paths.push(PathBuf::from(p));
    }

    // Primary: config.toml next to the executable (works for Windows services
    // where CWD is C:\Windows\system32, not the exe directory)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            paths.push(exe_dir.join("config.toml"));
        }
    }

    paths.push(PathBuf::from("./config.toml"));

    #[cfg(target_os = "linux")]
    paths.push(PathBuf::from("/etc/svf-agent/config.toml"));

    #[cfg(target_os = "windows")]
    {
        if let Ok(pd) = std::env::var("ProgramData") {
            paths.push(PathBuf::from(pd).join("SvoePhoto").join("config.toml"));
        }
    }

    paths
}

/// Watch a config file for changes (for MQTT hot-reload).
/// Returns the new config version if the file changed.
pub fn check_config_changed(path: &Path, last_modified: &mut std::time::SystemTime) -> Option<String> {
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if modified > *last_modified {
                *last_modified = modified;
                return std::fs::read_to_string(path).ok();
            }
        }
    }
    None
}
