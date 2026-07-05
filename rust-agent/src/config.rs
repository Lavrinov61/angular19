use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct Config {
    pub agent: AgentConfig,
    pub mqtt: MqttConfig,
    pub cups: CupsConfig,
    pub offline: OfflineConfig,
    pub telemetry: TelemetryConfig,
    pub download: DownloadConfig,
    #[serde(default)]
    pub icc: IccConfig,
}

#[derive(Debug, Deserialize)]
pub struct AgentConfig {
    pub bridge_id: String,
    pub studio_id: String,
    #[serde(default = "default_version")]
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct MqttConfig {
    pub host: String,
    #[serde(default = "default_mqtt_port")]
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub use_tls: bool,
}

#[derive(Debug, Deserialize)]
pub struct CupsConfig {
    #[serde(default = "default_dpi")]
    pub target_dpi: u32,
    #[serde(default)]
    pub default_printer: String,
}

#[derive(Debug, Deserialize)]
pub struct OfflineConfig {
    #[serde(default = "default_db_path")]
    pub db_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryConfig {
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_secs: u64,
}

#[derive(Debug, Deserialize)]
pub struct DownloadConfig {
    #[serde(default = "default_temp_dir")]
    pub temp_dir: PathBuf,
    #[serde(default = "default_download_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u64,
}

#[derive(Debug, Deserialize)]
pub struct IccConfig {
    #[serde(default = "default_icc_cache_dir")]
    pub cache_dir: PathBuf,
}

impl Default for IccConfig {
    fn default() -> Self {
        Self { cache_dir: default_icc_cache_dir() }
    }
}

fn default_icc_cache_dir() -> PathBuf { PathBuf::from("/var/lib/svf-agent/icc") }
fn default_version() -> String { "0.1.0".into() }
fn default_mqtt_port() -> u16 { 1883 }
fn default_dpi() -> u32 { 300 }
fn default_db_path() -> PathBuf { PathBuf::from("/var/lib/svf-agent/offline.db") }
fn default_poll_interval() -> u64 { 30 }
fn default_heartbeat_interval() -> u64 { 60 }
fn default_temp_dir() -> PathBuf { PathBuf::from("/tmp/svf-agent") }
fn default_download_timeout() -> u64 { 120 }
fn default_max_file_size() -> u64 { 104_857_600 }

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let config_paths = [
            PathBuf::from("/etc/svf-agent/config.toml"),
            PathBuf::from("config.toml"),
            PathBuf::from("config.example.toml"),
        ];

        let path = config_paths
            .iter()
            .find(|p| p.exists())
            .ok_or_else(|| anyhow::anyhow!(
                "Config not found. Searched: {}",
                config_paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
            ))?;

        Self::load_from(path)
    }

    pub fn load_from(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("Failed to read {}: {e}", path.display()))?;
        let config: Config = toml::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse {}: {e}", path.display()))?;
        Ok(config)
    }
}
