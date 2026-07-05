use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Entity {
    pub id: Uuid,
    pub category_id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub status: String,
    pub visibility: String,
    pub name: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub metadata: serde_json::Value,
    pub tags: Vec<String>,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub confidence: sqlx::types::BigDecimal,
    pub is_verified: bool,
    pub verified_by: Option<Uuid>,
    pub verified_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight entity for list views
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EntitySummary {
    pub id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub status: String,
    pub name: String,
    pub summary: Option<String>,
    pub tags: Vec<String>,
    pub confidence: sqlx::types::BigDecimal,
    pub is_verified: bool,
    pub category_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEntity {
    pub category_slug: String,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub source_type: Option<String>,
    pub source_ref: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEntity {
    pub name: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct ListEntitiesQuery {
    pub entity_type: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
    pub verified: Option<bool>,
    pub tag: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EntityVersion {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub version: i32,
    pub name: String,
    pub change_type: String,
    pub change_reason: Option<String>,
    pub changed_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
