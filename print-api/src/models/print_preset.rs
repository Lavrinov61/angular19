use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PrintPresetRow {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub printer_type: String,
    pub sublimation: bool,
    pub paper_size: String,
    pub media_type: Option<String>,
    pub quality: String,
    pub fit_mode: String,
    pub borderless: bool,
    pub color_mode: String,
    pub duplex: bool,
    pub mirror: bool,
    pub price: f64,
    pub sort_order: i32,
    pub is_active: bool,
    pub created_by: Option<Uuid>,
    pub studio_id: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    // v2 fields (migration 047)
    pub slug: Option<String>,
    pub rendering_intent: Option<String>,
    pub face_requirements: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePresetDto {
    pub name: String,
    pub icon: Option<String>,
    pub printer_type: String,
    pub sublimation: Option<bool>,
    pub paper_size: String,
    pub media_type: Option<String>,
    pub quality: Option<String>,
    pub fit_mode: Option<String>,
    pub borderless: Option<bool>,
    pub color_mode: Option<String>,
    pub duplex: Option<bool>,
    pub mirror: Option<bool>,
    pub price: Option<f64>,
    pub sort_order: Option<i32>,
    pub studio_id: Option<String>,
    pub slug: Option<String>,
    pub rendering_intent: Option<String>,
    pub face_requirements: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePresetDto {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub printer_type: Option<String>,
    pub sublimation: Option<bool>,
    pub paper_size: Option<String>,
    pub media_type: Option<Option<String>>,
    pub quality: Option<String>,
    pub fit_mode: Option<String>,
    pub borderless: Option<bool>,
    pub color_mode: Option<String>,
    pub duplex: Option<bool>,
    pub mirror: Option<bool>,
    pub price: Option<f64>,
    pub sort_order: Option<i32>,
    pub is_active: Option<bool>,
    pub studio_id: Option<Option<String>>,
    pub slug: Option<String>,
    pub rendering_intent: Option<String>,
    pub face_requirements: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct PresetQuery {
    pub printer_type: Option<String>,
    pub studio_id: Option<String>,
}
