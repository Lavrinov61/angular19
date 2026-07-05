use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DocumentTemplateRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub category: String,
    pub country_code: String,
    pub photo_width_mm: f64,
    pub photo_height_mm: f64,
    pub head_height_min_mm: Option<f64>,
    pub head_height_max_mm: Option<f64>,
    pub eye_line_from_bottom_mm: Option<f64>,
    pub background_color: String,
    pub default_media_size: String,
    pub photos_per_sheet: i32,
    pub layout_rows: i32,
    pub layout_cols: i32,
    pub cut_margin_mm: f64,
    pub validation_rules: serde_json::Value,
    pub overlay_svg: Option<String>,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDocumentTemplateDto {
    pub slug: String,
    pub name: String,
    pub category: String,
    pub country_code: Option<String>,
    pub photo_width_mm: f64,
    pub photo_height_mm: f64,
    pub head_height_min_mm: Option<f64>,
    pub head_height_max_mm: Option<f64>,
    pub eye_line_from_bottom_mm: Option<f64>,
    pub background_color: Option<String>,
    pub default_media_size: Option<String>,
    pub photos_per_sheet: Option<i32>,
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub cut_margin_mm: Option<f64>,
    pub validation_rules: Option<serde_json::Value>,
    pub overlay_svg: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDocumentTemplateDto {
    pub name: Option<String>,
    pub category: Option<String>,
    pub country_code: Option<String>,
    pub photo_width_mm: Option<f64>,
    pub photo_height_mm: Option<f64>,
    pub head_height_min_mm: Option<Option<f64>>,
    pub head_height_max_mm: Option<Option<f64>>,
    pub eye_line_from_bottom_mm: Option<Option<f64>>,
    pub background_color: Option<String>,
    pub default_media_size: Option<String>,
    pub photos_per_sheet: Option<i32>,
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub cut_margin_mm: Option<f64>,
    pub validation_rules: Option<serde_json::Value>,
    pub overlay_svg: Option<Option<String>>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct DocumentTemplateQuery {
    pub category: Option<String>,
    pub country_code: Option<String>,
}
