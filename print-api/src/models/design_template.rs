use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DesignTemplateRow {
    pub id: Uuid,
    pub service_id: Option<Uuid>,
    pub name: String,
    pub category: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub canvas_json: Option<String>,
    pub thumbnail_url: Option<String>,
    pub editable_fields: serde_json::Value,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    // Joined
    pub service_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDesignTemplateDto {
    pub service_id: Option<String>,
    pub name: String,
    pub category: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub canvas_json: Option<String>,
    pub thumbnail_url: Option<String>,
    pub editable_fields: Option<serde_json::Value>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDesignTemplateDto {
    pub service_id: Option<Option<String>>,
    pub name: Option<String>,
    pub category: Option<String>,
    pub width_mm: Option<f64>,
    pub height_mm: Option<f64>,
    pub canvas_json: Option<Option<String>>,
    pub thumbnail_url: Option<Option<String>>,
    pub editable_fields: Option<serde_json::Value>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct DesignTemplateQuery {
    pub service_id: Option<String>,
    pub category: Option<String>,
}
