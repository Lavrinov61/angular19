use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct BridgeDeviceRow {
    pub id: Uuid,
    pub studio_id: Option<Uuid>,
    pub api_key: String,
    pub name: String,
    pub hostname: Option<String>,
    pub bridge_version: Option<String>,
    pub os_version: Option<String>,
    pub is_online: bool,
    pub last_connected_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_disconnected_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    pub mqtt_username: String,
    pub agent_type: Option<String>,
    pub cups_version: Option<String>,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub studio_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBridgeDeviceDto {
    pub studio_id: String,
    pub name: String,
    pub mqtt_username: String,
    pub mqtt_password_hash: String,
    pub agent_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBridgeDeviceDto {
    pub name: Option<String>,
    pub studio_id: Option<String>,
    pub agent_type: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct BridgeListQuery {
    pub studio_id: Option<String>,
}
