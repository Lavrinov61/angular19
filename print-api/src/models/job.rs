use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PrintJobRow {
    pub id: Uuid,
    pub printer_id: Option<Uuid>,
    pub file_url: String,
    pub file_name: Option<String>,
    pub copies: i32,
    pub paper_size: String,
    pub color_mode: String,
    pub quality: String,
    pub duplex: bool,
    pub orientation: String,
    pub borderless: bool,
    pub media_type: Option<String>,
    pub fit_mode: String,
    pub status: String,
    pub error_message: Option<String>,
    pub order_id: Option<String>,
    pub order_type: Option<String>,
    pub receipt_id: Option<Uuid>,
    pub created_by: Uuid,
    pub studio_id: Option<Uuid>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    // v2 fields
    pub customer_id: Option<Uuid>,
    pub service_slug: Option<String>,
    pub document_template_slug: Option<String>,
    pub original_job_id: Option<Uuid>,
    pub icc_profile_id: Option<Uuid>,
    pub cut_marks: Option<bool>,
    pub cut_mark_length_mm: Option<f64>,
    pub cut_mark_offset_mm: Option<f64>,
    pub consumable_usage: Option<serde_json::Value>,
    // layout fields
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub cut_margin_mm: Option<f64>,
    pub custom_photo_width_mm: Option<f64>,
    pub custom_photo_height_mm: Option<f64>,
    pub rotation: Option<i16>,
    // Reassign fields
    pub reassigned_from: Option<Uuid>,
    pub reassign_reason: Option<String>,
    pub reassigned_at: Option<chrono::DateTime<chrono::Utc>>,
    pub reassigned_by: Option<Uuid>,
    // Priority
    pub priority: i32,
    // Analytics fields
    pub price_total: Option<bigdecimal::BigDecimal>,
    pub duration_ms: Option<i32>,
    pub pages_printed: Option<i32>,
    pub batch_id: Option<Uuid>,
    pub batch_sequence: Option<i32>,
    // Document conversion fields
    pub source_file_url: Option<String>,
    pub source_file_type: Option<String>,
    pub parent_job_id: Option<Uuid>,
    pub page_number: Option<i32>,
    pub conversion_dpi: Option<i32>,
    pub font_size_delta_pt: Option<i16>,
    pub rendering_intent: Option<String>,
    // Traceability fields (migration 047)
    pub preset_id: Option<Uuid>,
    pub face_validation_id: Option<Uuid>,
    pub trace_id: Option<String>,
    // Copy splitting fields
    pub current_copy: Option<i32>,
    pub total_copies_needed: Option<i32>,
    pub split_strategy: Option<String>,
    pub child_count: Option<i32>,
    pub auto_balanced: Option<bool>,
    pub original_printer_id: Option<Uuid>,
    // Scheduling & hold fields
    pub scheduled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub held_by: Option<Uuid>,
    pub held_at: Option<chrono::DateTime<chrono::Utc>>,
    pub released_by: Option<Uuid>,
    pub released_at: Option<chrono::DateTime<chrono::Utc>>,
    // Finishing fields
    pub finishing_ops: Option<Vec<String>>,
    pub finishing_status: Option<String>,
    pub finishing_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finishing_completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finishing_notes: Option<String>,
    // Group fields
    pub group_id: Option<Uuid>,
    pub group_sequence: Option<i32>,
    pub tracking_code: Option<String>,
    // Paper source (tray selection)
    pub paper_source: Option<String>,
    // Watermark fields
    pub watermark_text: Option<String>,
    pub watermark_opacity: Option<f32>,
    pub watermark_position: Option<String>,
    // Banner page fields
    pub banner_page: Option<bool>,
    pub banner_info: Option<serde_json::Value>,
    // Mirror + crop fields (migration 083)
    pub mirror: Option<bool>,
    pub crop_x: Option<f32>,
    pub crop_y: Option<f32>,
    pub crop_width: Option<f32>,
    pub crop_height: Option<f32>,
    // Photo adjustment fields
    pub photo_enhance: Option<bool>,
    pub brightness: Option<i16>,
    pub contrast: Option<i16>,
    pub saturation: Option<i16>,
    // Extended print options (migration 086)
    pub nup: Option<i32>,
    #[sqlx(rename = "collate")]
    pub collate: Option<bool>,
    pub resolution_dpi: Option<i32>,
    pub color_auto_detect: Option<bool>,
    pub booklet: Option<bool>,
    pub pages_per_sheet: Option<i32>,
    pub binding: Option<String>,
    pub staple_position: Option<String>,
    pub hole_punch: Option<String>,
    pub hole_punch_type: Option<String>,
    pub duplex_mode: Option<String>,
    pub scaling_percent: Option<i32>,
    pub output_bin: Option<String>,
    pub toner_save: Option<String>,
    pub department_id: Option<String>,
    pub secure_pin: Option<String>,
    pub gray_mode: Option<String>,
    // Joined fields
    pub printer_name: Option<String>,
    pub printer_type: Option<String>,
    pub creator_name: Option<String>,
    // Pagination window (not serialized to clients)
    #[serde(skip_serializing)]
    #[sqlx(default)]
    pub total_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JobStateTransitionRow {
    pub id: i64,
    pub job_id: Uuid,
    pub from_status: Option<String>,
    pub to_status: String,
    pub actor_id: Option<Uuid>,
    pub actor_type: String,
    pub reason: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePrintJobDto {
    pub printer_id: String,
    pub file_url: String,
    pub file_name: Option<String>,
    pub copies: Option<i32>,
    pub paper_size: Option<String>,
    pub color_mode: Option<String>,
    pub quality: Option<String>,
    pub duplex: Option<bool>,
    pub orientation: Option<String>,
    pub borderless: Option<bool>,
    pub media_type: Option<String>,
    pub fit_mode: Option<String>,
    pub order_id: Option<String>,
    pub order_type: Option<String>,
    pub receipt_id: Option<String>,
    // v2 fields
    pub customer_id: Option<String>,
    pub service_slug: Option<String>,
    pub document_template_slug: Option<String>,
    pub icc_profile_id: Option<String>,
    pub cut_marks: Option<bool>,
    pub cut_mark_length_mm: Option<f64>,
    pub cut_mark_offset_mm: Option<f64>,
    // layout fields
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub cut_margin_mm: Option<f64>,
    pub custom_photo_width_mm: Option<f64>,
    pub custom_photo_height_mm: Option<f64>,
    pub rotation: Option<i16>,
    pub priority: Option<i32>,
    // Document conversion options
    pub pages: Option<Vec<i32>>,
    pub dpi: Option<i32>,
    pub font_size_delta_pt: Option<i16>,
    pub rendering_intent: Option<String>,
    pub coverage_percent: Option<f64>,
    pub price_total: Option<f64>,
    pub preset_id: Option<String>,
    pub trace_id: Option<String>,
    pub paper_source: Option<String>,
    // Mirror + crop
    pub mirror: Option<bool>,
    pub crop_x: Option<f32>,
    pub crop_y: Option<f32>,
    pub crop_width: Option<f32>,
    pub crop_height: Option<f32>,
    // Photo adjustments
    pub photo_enhance: Option<bool>,
    pub brightness: Option<i16>,
    pub contrast: Option<i16>,
    pub saturation: Option<i16>,
    // Finishing operations
    pub finishing_ops: Option<Vec<String>>,
    // Watermark
    pub watermark_text: Option<String>,
    pub watermark_opacity: Option<f32>,
    pub watermark_position: Option<String>,
    // Banner page
    pub banner_page: Option<bool>,
    // Extended print options (migration 086)
    pub nup: Option<i32>,
    pub collate: Option<bool>,
    pub resolution_dpi: Option<i32>,
    pub color_auto_detect: Option<bool>,
    pub booklet: Option<bool>,
    pub pages_per_sheet: Option<i32>,
    pub binding: Option<String>,
    pub staple_position: Option<String>,
    pub hole_punch: Option<String>,
    pub hole_punch_type: Option<String>,
    pub duplex_mode: Option<String>,
    pub scaling_percent: Option<i32>,
    pub output_bin: Option<String>,
    pub toner_save: Option<String>,
    pub department_id: Option<String>,
    pub secure_pin: Option<String>,
    pub gray_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetPriorityDto {
    pub priority: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReassignJobDto {
    pub target_printer_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ScheduleJobDto {
    pub scheduled_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SplitJobDto {
    pub strategy: String,
    pub printer_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PrintQueueQuery {
    pub printer_id: Option<String>,
    pub status: Option<String>,
    pub studio_id: Option<String>,
    pub limit: Option<i64>,
    pub sort: Option<String>,
    // Extended pagination & filter fields
    pub page: Option<i64>,
    pub offset: Option<i64>,
    pub created_by: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}
