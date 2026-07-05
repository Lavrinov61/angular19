use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JobTemplateRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub settings: serde_json::Value,
    pub printer_type: String,
    pub printer_id: Option<Uuid>,
    pub studio_id: Option<Uuid>,
    pub is_global: bool,
    pub usage_count: i32,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub sort_order: i32,
    pub is_active: bool,
    pub created_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListTemplatesQuery {
    pub printer_type: Option<String>,
    pub studio_id: Option<String>,
    pub is_global: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplateDto {
    pub name: String,
    pub description: Option<String>,
    pub settings: serde_json::Value,
    pub printer_type: String,
    pub printer_id: Option<String>,
    pub studio_id: Option<String>,
    pub is_global: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTemplateDto {
    pub name: Option<String>,
    pub description: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub printer_type: Option<String>,
    pub is_global: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ApplyTemplateDto {
    pub file_url: String,
    pub file_name: Option<String>,
    pub copies: Option<i32>,
    pub priority: Option<i32>,
}
