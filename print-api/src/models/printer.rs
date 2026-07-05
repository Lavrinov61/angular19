use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperSize {
    pub id: String,
    pub name: String,
    pub width_mm: f64,
    pub height_mm: f64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaType {
    pub id: String,
    pub name: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityMode {
    pub id: String,
    pub name: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterCapabilities {
    pub paper_sizes: Vec<PaperSize>,
    pub media_types: Vec<MediaType>,
    pub quality_modes: Vec<QualityMode>,
    pub color: bool,
    pub duplex: bool,
    pub borderless: bool,
    pub max_dpi: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PrinterRow {
    pub id: Uuid,
    pub name: String,
    pub printer_type: String,
    pub cups_printer_name: Option<String>,
    pub default_icc_profile_id: Option<Uuid>,
    pub studio_id: Option<Uuid>,
    pub capabilities: serde_json::Value,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    // Queue pause fields
    pub queue_paused: Option<bool>,
    pub queue_paused_at: Option<chrono::DateTime<chrono::Utc>>,
    pub queue_paused_by: Option<Uuid>,
    pub queue_paused_reason: Option<String>,
    pub auto_pause_supply_threshold: Option<i32>,
    pub queue_depth: Option<i32>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PrinterWithStudioRow {
    pub id: Uuid,
    pub name: String,
    pub printer_type: String,
    pub cups_printer_name: Option<String>,
    pub default_icc_profile_id: Option<Uuid>,
    pub studio_id: Option<Uuid>,
    pub capabilities: serde_json::Value,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub studio_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePrinterDto {
    pub name: String,
    pub printer_type: String,
    pub cups_printer_name: Option<String>,
    pub default_icc_profile_id: Option<String>,
    pub studio_id: Option<String>,
    pub capabilities: serde_json::Value,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePrinterDto {
    pub name: Option<String>,
    pub printer_type: Option<String>,
    pub cups_printer_name: Option<Option<String>>,
    pub default_icc_profile_id: Option<Option<String>>,
    pub studio_id: Option<Option<String>>,
    pub capabilities: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PrinterListQuery {
    pub studio_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PauseQueueDto {
    pub reason: Option<String>,
}
