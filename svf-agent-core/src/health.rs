//! Health-check primitives for SVF agents.
//!
//! Each agent aggregates [`ComponentHealth`] entries into a single
//! [`HealthReport`] that can be serialised to JSON for the monitoring
//! endpoint or published via MQTT telemetry.

use chrono::{DateTime, Utc};

/// Overall health status of a component or agent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum HealthStatus {
    Healthy,
    Degraded { reason: String },
    Unhealthy { reason: String },
}

impl HealthStatus {
    pub fn is_healthy(&self) -> bool {
        matches!(self, Self::Healthy)
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded { .. } => "degraded",
            Self::Unhealthy { .. } => "unhealthy",
        }
    }

    pub fn reason(&self) -> Option<&str> {
        match self {
            Self::Healthy => None,
            Self::Degraded { reason } | Self::Unhealthy { reason } => Some(reason),
        }
    }

    /// Severity rank used for worst-status aggregation (higher = worse).
    fn severity(&self) -> u8 {
        match self {
            Self::Healthy => 0,
            Self::Degraded { .. } => 1,
            Self::Unhealthy { .. } => 2,
        }
    }
}

/// Health of a single named subsystem (e.g. "mqtt", "printer", "sqlite").
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ComponentHealth {
    pub name: String,
    pub status: HealthStatus,
}

/// Aggregated health report for the whole agent.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HealthReport {
    pub overall: HealthStatus,
    pub components: Vec<ComponentHealth>,
    pub uptime_secs: u64,
    pub checked_at: DateTime<Utc>,
}

impl HealthReport {
    /// Build a report from component checks, deriving the worst overall status.
    pub fn from_components(components: Vec<ComponentHealth>, uptime_secs: u64) -> Self {
        let overall = components
            .iter()
            .max_by_key(|c| c.status.severity())
            .map(|c| c.status.clone())
            .unwrap_or(HealthStatus::Healthy);

        Self {
            overall,
            components,
            uptime_secs,
            checked_at: Utc::now(),
        }
    }
}
