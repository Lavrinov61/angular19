use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DataSource {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub source_type: String,
    pub config: serde_json::Value,
    pub sync_schedule: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub sync_status: Option<String>,
    pub sync_error: Option<String>,
    pub entity_count: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SourceLink {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub source_id: Uuid,
    pub external_id: Option<String>,
    pub sync_hash: Option<String>,
    pub last_synced_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDataSource {
    pub slug: String,
    pub name: String,
    pub source_type: String,
    pub config: Option<serde_json::Value>,
    pub sync_schedule: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDataSource {
    pub name: Option<String>,
    pub config: Option<serde_json::Value>,
    pub sync_schedule: Option<String>,
    pub is_active: Option<bool>,
}

/// Source link with entity and source names for list views
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SourceLinkExpanded {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub entity_name: String,
    pub entity_slug: String,
    pub source_id: Uuid,
    pub source_name: String,
    pub source_slug: String,
    pub external_id: Option<String>,
    pub sync_hash: Option<String>,
    pub last_synced_at: DateTime<Utc>,
}

/// Sync status response
#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub source_slug: String,
    pub entities_created: i32,
    pub entities_updated: i32,
    pub entities_unchanged: i32,
    pub errors: Vec<String>,
    pub duration_ms: u64,
}
