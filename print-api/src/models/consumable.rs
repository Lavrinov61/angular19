use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConsumableStockRow {
    pub id: Uuid,
    pub station_id: Uuid,
    pub consumable_type: String,
    pub current_amount: f64,
    pub max_capacity: Option<f64>,
    pub unit: String,
    pub low_threshold: Option<f64>,
    pub cost_per_unit: Option<f64>,
    pub last_refilled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    // Joined
    pub station_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConsumableTransactionRow {
    pub id: i64,
    pub stock_id: Uuid,
    pub job_id: Option<Uuid>,
    pub transaction_type: String,
    pub amount: f64,
    pub notes: Option<String>,
    pub created_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateConsumableStockDto {
    pub station_id: String,
    pub consumable_type: String,
    pub current_amount: Option<f64>,
    pub max_capacity: Option<f64>,
    pub unit: Option<String>,
    pub low_threshold: Option<f64>,
    pub cost_per_unit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConsumableStockDto {
    pub current_amount: Option<f64>,
    pub max_capacity: Option<f64>,
    pub low_threshold: Option<f64>,
    pub cost_per_unit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct RefillConsumableDto {
    pub amount: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConsumableStockQuery {
    pub station_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ConsumableTransactionQuery {
    pub stock_id: Option<String>,
    pub transaction_type: Option<String>,
    pub limit: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ConsumableAlertRow {
    pub id: Uuid,
    pub station_id: Uuid,
    pub station_name: Option<String>,
    pub consumable_type: String,
    pub current_amount: f64,
    pub low_threshold: f64,
    pub max_capacity: Option<f64>,
    pub unit: String,
    pub percent_remaining: Option<f64>,
}
