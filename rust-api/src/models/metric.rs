use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MetricDefinition {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub unit: String,
    pub aggregation: String,
    pub category: String,
    pub is_cumulative: bool,
    pub alert_threshold: Option<serde_json::Value>,
    pub dashboard_config: Option<serde_json::Value>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MetricPoint {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub metric_value: sqlx::types::BigDecimal,
    pub dimensions: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct RecordMetric {
    pub metric_slug: String,
    pub value: f64,
    pub dimensions: Option<serde_json::Value>,
    pub period_type: Option<String>,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub source_type: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MetricSeriesQuery {
    pub period_type: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub dimensions: Option<serde_json::Value>,
}
