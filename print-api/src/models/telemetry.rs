use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TelemetryRow {
    pub id: i64,
    pub printer_id: Uuid,
    pub printer_name: Option<String>,
    pub printer_type: Option<String>,
    pub is_online: bool,
    pub state: Option<String>,
    pub state_reasons: Option<Vec<String>>,
    pub supplies: Option<serde_json::Value>,
    pub trays: Option<serde_json::Value>,
    pub counters: Option<serde_json::Value>,
    pub errors: Option<serde_json::Value>,
    pub model: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub consumable_usage: Option<serde_json::Value>,
    pub bridge_name: Option<String>,
    pub bridge_online: Option<bool>,
    pub cups_printer_name: Option<String>,
    pub agent_type: Option<String>,
    pub collected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryQuery {
    pub studio_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryHistoryQuery {
    pub limit: Option<i64>,
}
