use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ───────────────────────────────────────────────────
//  Price History
// ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct PriceHistoryEntry {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub service_name: String,
    pub service_category: String,
    pub old_price: Option<i32>,
    pub new_price: Option<i32>,
    pub change_pct: Option<sqlx::types::BigDecimal>,
    pub change_type: String,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PriceHistoryWithCompetitor {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub competitor_name: String,
    pub service_name: String,
    pub service_category: String,
    pub old_price: Option<i32>,
    pub new_price: Option<i32>,
    pub change_pct: Option<sqlx::types::BigDecimal>,
    pub change_type: String,
    pub recorded_at: DateTime<Utc>,
}

// ───────────────────────────────────────────────────
//  Price Trends (for charts)
// ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct PriceTrendPoint {
    pub competitor_name: String,
    pub price: Option<i32>,
    pub recorded_at: DateTime<Utc>,
}

// ───────────────────────────────────────────────────
//  Alerts
// ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct PriceAlert {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: Option<String>,
    pub metadata: serde_json::Value,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PriceAlertWithCompetitor {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub competitor_name: String,
    pub alert_type: String,
    pub severity: String,
    pub title: String,
    pub description: Option<String>,
    pub metadata: serde_json::Value,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

// ───────────────────────────────────────────────────
//  Scrape Logs
// ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct ScrapeLog {
    pub id: Uuid,
    pub source_slug: String,
    pub competitor_slug: Option<String>,
    pub status: String,
    pub pages_discovered: i32,
    pub pages_scraped: i32,
    pub items_found: i32,
    pub prices_extracted: i32,
    pub prices_saved: i32,
    pub extraction_method: Option<String>,
    pub chrome_used: bool,
    pub reqwest_used: bool,
    pub errors: serde_json::Value,
    pub duration_ms: Option<i32>,
    pub created_at: DateTime<Utc>,
}

// ───────────────────────────────────────────────────
//  Summary / Positioning
// ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct CompetitorSummary {
    pub competitor_name: String,
    pub competitor_slug: String,
    pub total_prices: i64,
    pub last_scraped: Option<DateTime<Utc>>,
    pub avg_price: Option<sqlx::types::BigDecimal>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CategoryPositioning {
    pub service_category: String,
    pub competitor_name: String,
    pub competitor_slug: String,
    pub min_price: Option<i32>,
    pub avg_price: Option<sqlx::types::BigDecimal>,
    pub service_count: i64,
}

// ───────────────────────────────────────────────────
//  Query params
// ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AlertsQuery {
    pub alert_type: Option<String>,
    pub severity: Option<String>,
    pub is_read: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub days: Option<i64>,
    pub service_name: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TrendsQuery {
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ScrapeLogsQuery {
    pub source_slug: Option<String>,
    pub limit: Option<i64>,
}
