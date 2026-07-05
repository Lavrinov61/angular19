use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Relation {
    pub id: Uuid,
    pub from_entity_id: Uuid,
    pub to_entity_id: Uuid,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: sqlx::types::BigDecimal,
    pub bidirectional: bool,
    pub metadata: serde_json::Value,
    pub source_type: String,
    pub confidence: sqlx::types::BigDecimal,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Relation with resolved entity names (for API responses)
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct RelationExpanded {
    pub id: Uuid,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: sqlx::types::BigDecimal,
    pub bidirectional: bool,
    pub from_id: Uuid,
    pub from_name: String,
    pub from_type: String,
    pub to_id: Uuid,
    pub to_name: String,
    pub to_type: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRelation {
    pub from_slug: String,
    pub to_slug: String,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: Option<f64>,
    pub bidirectional: Option<bool>,
}
