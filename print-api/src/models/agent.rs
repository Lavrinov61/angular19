use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AgentRow {
    pub id: Uuid,
    pub studio_id: Uuid,
    pub agent_type: String,
    pub name: String,
    pub hostname: Option<String>,
    pub current_version: Option<String>,
    pub target_version: Option<String>,
    pub mqtt_username: String,
    pub is_online: bool,
    pub last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_connected_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_disconnected_at: Option<chrono::DateTime<chrono::Utc>>,
    pub os_version: Option<String>,
    pub os_arch: Option<String>,
    pub config_version: i32,
    pub desired_config: serde_json::Value,
    pub applied_config: serde_json::Value,
    pub uptime_seconds: Option<i64>,
    pub last_restart_reason: Option<String>,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    // JOIN field
    pub studio_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentDto {
    pub studio_id: String,
    pub agent_type: String,
    pub name: String,
    pub hostname: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentDto {
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub target_version: Option<String>,
    pub is_active: Option<bool>,
    pub desired_config: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AgentListQuery {
    pub studio_id: Option<String>,
    pub agent_type: Option<String>,
    pub is_online: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PushConfigDto {
    pub config: serde_json::Value,
    pub restart_required: Option<bool>,
}

// ── Releases ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AgentReleaseRow {
    pub id: Uuid,
    pub agent_type: String,
    pub version: String,
    pub platform: String,
    pub artifact_url: String,
    pub artifact_hash_sha256: String,
    pub artifact_size_bytes: i64,
    pub release_notes: Option<String>,
    pub is_stable: bool,
    pub min_os_version: Option<String>,
    pub released_by: Option<Uuid>,
    pub released_at: chrono::DateTime<chrono::Utc>,
    pub promoted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub download_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateReleaseDto {
    pub agent_type: String,
    pub version: String,
    pub platform: String,
    pub artifact_url: String,
    pub artifact_hash_sha256: String,
    pub artifact_size_bytes: i64,
    pub release_notes: Option<String>,
    pub is_stable: Option<bool>,
    pub min_os_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseListQuery {
    pub agent_type: Option<String>,
    pub platform: Option<String>,
    pub is_stable: Option<bool>,
}

// ── Updates ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UpdateCommandRow {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub release_id: Uuid,
    pub status: String,
    pub error_message: Option<String>,
    pub previous_version: Option<String>,
    pub rollback_url: Option<String>,
    pub initiated_by: Option<Uuid>,
    pub initiated_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub progress_percent: Option<i32>,
    pub rollout_id: Option<Uuid>,
    pub scheduled_at: Option<chrono::DateTime<chrono::Utc>>,
}

// ── Rollout Plans ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct RolloutPlanRow {
    pub id: Uuid,
    pub release_id: Uuid,
    pub strategy: String,
    pub status: String,
    pub target_agent_type: String,
    pub target_platform: Option<String>,
    pub total_agents: i32,
    pub completed_agents: i32,
    pub failed_agents: i32,
    pub canary_count: i32,
    pub canary_wait_minutes: i32,
    pub batch_percent: i32,
    pub batch_wait_minutes: i32,
    pub current_phase: String,
    pub phase_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub next_phase_at: Option<chrono::DateTime<chrono::Utc>>,
    pub initiated_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct StartRolloutDto {
    pub strategy: Option<String>,
    pub canary_count: Option<i32>,
    pub canary_wait_minutes: Option<i32>,
    pub batch_percent: Option<i32>,
    pub batch_wait_minutes: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct RolloutListQuery {
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FleetUpdateDto {
    pub release_id: String,
    pub force: Option<bool>,
}

// ── Alerts ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct InfraAlertRow {
    pub id: i64,
    pub studio_id: Uuid,
    pub agent_id: Option<Uuid>,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub details: serde_json::Value,
    pub is_acknowledged: bool,
    pub acknowledged_by: Option<Uuid>,
    pub acknowledged_at: Option<chrono::DateTime<chrono::Utc>>,
    pub resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    // JOIN fields
    pub studio_name: Option<String>,
    pub agent_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AlertListQuery {
    pub studio_id: Option<String>,
    pub severity: Option<String>,
    pub unresolved: Option<bool>,
    pub limit: Option<i64>,
}

// ── Alert Rules ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AlertRuleRow {
    pub id: Uuid,
    pub agent_type: Option<String>,
    pub alert_type: String,
    pub severity: String,
    pub condition_config: serde_json::Value,
    pub notification_channels: serde_json::Value,
    pub cooldown_minutes: Option<i32>,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleDto {
    pub agent_type: Option<String>,
    pub alert_type: String,
    pub severity: String,
    pub condition_config: serde_json::Value,
    pub notification_channels: Option<serde_json::Value>,
    pub cooldown_minutes: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAlertRuleDto {
    pub severity: Option<String>,
    pub condition_config: Option<serde_json::Value>,
    pub notification_channels: Option<serde_json::Value>,
    pub cooldown_minutes: Option<i32>,
    pub is_active: Option<bool>,
}

// ── System Telemetry ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SystemTelemetryRow {
    pub id: i64,
    pub agent_id: Uuid,
    pub studio_id: Uuid,
    pub cpu_percent: Option<f64>,
    pub memory_used_mb: Option<i32>,
    pub memory_total_mb: Option<i32>,
    pub disk_used_gb: Option<f64>,
    pub disk_total_gb: Option<f64>,
    pub network_rx_bytes_sec: Option<i64>,
    pub network_tx_bytes_sec: Option<i64>,
    pub peripherals: serde_json::Value,
    pub agent_statuses: serde_json::Value,
    pub collected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryHistoryQuery {
    pub hours: Option<i64>,
    pub limit: Option<i64>,
}

// ── Fleet ──

#[derive(Debug, Serialize, FromRow)]
pub struct FleetStatusRow {
    pub agent_type: String,
    pub current_version: Option<String>,
    pub total: Option<i64>,
    pub online: Option<i64>,
    pub offline: Option<i64>,
    pub pending_update: Option<i64>,
}

// ── Locations ──

#[derive(Debug, Serialize, FromRow)]
pub struct LocationRow {
    pub id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub timezone: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub is_infra_enabled: Option<bool>,
    pub agent_count: Option<i64>,
    pub online_count: Option<i64>,
    pub alert_count: Option<i64>,
}

// ── Security Events (guard agent) ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SecurityEventRow {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub studio_id: Uuid,
    pub event_type: String,
    pub file_name: Option<String>,
    pub file_hash: Option<String>,
    pub original_size: Option<i64>,
    pub clean_size: Option<i64>,
    pub threat_type: Option<String>,
    pub details: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
    // JOIN field
    pub agent_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SecurityEventsQuery {
    pub studio_id: Option<String>,
    pub event_type: Option<String>,
    pub limit: Option<i64>,
}

// ── CDR Stats (guard agent) ──

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CdrStatsRow {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub studio_id: Uuid,
    pub date: chrono::NaiveDate,
    pub files_scanned: Option<i32>,
    pub files_cleaned: Option<i32>,
    pub files_quarantined: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    // JOIN field
    pub agent_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CdrStatsQuery {
    pub studio_id: Option<String>,
    pub from: Option<chrono::NaiveDate>,
    pub to: Option<chrono::NaiveDate>,
}
