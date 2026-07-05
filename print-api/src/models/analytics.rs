use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AnalyticsQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub studio_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UtilizationQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub printer_id: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct AnalyticsSummary {
    pub total_jobs: i64,
    pub completed: i64,
    pub failed: i64,
    pub failure_rate: f64,
    pub total_copies: i64,
    pub revenue: f64,
    pub avg_duration_ms: f64,
    pub waste_sheets: i64,
}

#[derive(Debug, Serialize)]
pub struct PrinterAnalytics {
    pub printer_id: String,
    pub printer_name: String,
    pub total_jobs: i64,
    pub completed: i64,
    pub failed: i64,
    pub copies: i64,
    pub revenue: f64,
}

#[derive(Debug, Serialize)]
pub struct OperatorAnalytics {
    pub operator_id: String,
    pub operator_name: String,
    pub total_jobs: i64,
    pub completed: i64,
    pub failed: i64,
    pub copies: i64,
    pub avg_speed_ms: f64,
}

#[derive(Debug, Deserialize)]
pub struct CreateWasteDto {
    pub waste_type: String,
    pub sheets_wasted: i32,
    pub paper_size: Option<String>,
    pub media_type: Option<String>,
    pub printer_id: Option<String>,
    pub studio_id: Option<String>,
    pub print_job_id: Option<String>,
    pub notes: Option<String>,
    pub cost_estimate: Option<f64>,
}
