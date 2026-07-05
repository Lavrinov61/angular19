use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct IccProfileRow {
    pub id: Uuid,
    pub device_id: Uuid,
    pub media_type: String,
    pub profile_name: String,
    pub file_key: String,
    pub calibrated_at: Option<chrono::DateTime<chrono::Utc>>,
    pub calibrated_by: Option<Uuid>,
    pub is_default: bool,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    // Joined
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateIccProfileDto {
    pub device_id: String,
    pub media_type: String,
    pub profile_name: String,
    pub file_key: String,
    pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIccProfileDto {
    pub profile_name: Option<String>,
    pub file_key: Option<String>,
    pub media_type: Option<String>,
    pub is_default: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct IccProfileQuery {
    pub device_id: Option<String>,
}
