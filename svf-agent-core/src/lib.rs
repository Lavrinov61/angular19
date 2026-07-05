//! SVF Agent Core — shared infrastructure for all SvoePhoto field agents.
//!
//! Provides:
//! - MQTT connection with auto-reconnect
//! - Offline SQLite store for message persistence
//! - TOML config loading with hot-reload support
//! - Heartbeat publisher
//! - Auto-update engine (download, verify SHA-256, install)
//! - Tracing/logging setup

pub mod config;
pub mod mqtt;
pub mod offline;
pub mod heartbeat;
pub mod updater;
pub mod logging;
pub mod error;
pub mod health;
pub mod circuit_breaker;
pub mod agent;
pub mod runner;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/svf.infra.rs"));
}

/// Agent types supported by the system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Print,
    Pos,
    Vision,
    Monitor,
    Guard,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Print => "print",
            Self::Pos => "pos",
            Self::Vision => "vision",
            Self::Monitor => "monitor",
            Self::Guard => "guard",
        }
    }
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
