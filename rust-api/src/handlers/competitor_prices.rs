use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::competitor::*;
use crate::services::scraper::ScraperService;
use crate::AppState;

// ═══════════════════════════════════════════════════════
//  EXISTING MODELS (kept for backward compat)
// ═══════════════════════════════════════════════════════

#[derive(Debug, Serialize, FromRow)]
pub struct CompetitorPrice {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub service_name: String,
    pub service_category: String,
    pub price_min: Option<i32>,
    pub price_max: Option<i32>,
    pub price_text: String,
    pub unit: Option<String>,
    pub notes: Option<String>,
    pub scraped_at: DateTime<Utc>,
    pub verified: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CompetitorPriceWithName {
    pub id: Uuid,
    pub competitor_id: Uuid,
    pub competitor_name: String,
    pub competitor_slug: String,
    pub service_name: String,
    pub service_category: String,
    pub price_min: Option<i32>,
    pub price_max: Option<i32>,
    pub price_text: String,
    pub unit: Option<String>,
    pub notes: Option<String>,
    pub scraped_at: DateTime<Utc>,
    pub verified: bool,
}

// ═══════════════════════════════════════════════════════
//  READ ENDPOINTS
// ═══════════════════════════════════════════════════════

/// GET /api/kb/competitor-prices — all prices across all competitors
pub async fn list_all(State(state): State<AppState>) -> Result<Json<Vec<CompetitorPriceWithName>>> {
    let prices = sqlx::query_as::<_, CompetitorPriceWithName>(
        "SELECT p.id, p.competitor_id, e.name AS competitor_name, e.slug AS competitor_slug,
                p.service_name, p.service_category, p.price_min, p.price_max,
                p.price_text, p.unit, p.notes, p.scraped_at, p.verified
         FROM kb_competitor_prices p
         JOIN kb_entities e ON e.id = p.competitor_id
         ORDER BY p.service_category, e.name, p.price_min NULLS LAST",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(prices))
}

/// GET /api/kb/competitor-prices/summary — aggregated stats per competitor
pub async fn summary(State(state): State<AppState>) -> Result<Json<Vec<CompetitorSummary>>> {
    let rows = sqlx::query_as::<_, CompetitorSummary>(
        "SELECT e.name AS competitor_name, e.slug AS competitor_slug,
                COUNT(p.id) AS total_prices,
                MAX(p.scraped_at) AS last_scraped,
                ROUND(AVG(p.price_min), 0) AS avg_price
         FROM kb_entities e
         LEFT JOIN kb_competitor_prices p ON p.competitor_id = e.id
         WHERE e.entity_type = 'competitor' AND e.deleted_at IS NULL
         GROUP BY e.id, e.name, e.slug
         ORDER BY e.name",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/kb/competitor-prices/compare/:category — compare prices by category
pub async fn compare_by_category(
    State(state): State<AppState>,
    Path(category): Path<String>,
) -> Result<Json<Vec<CompetitorPriceWithName>>> {
    let prices = sqlx::query_as::<_, CompetitorPriceWithName>(
        "SELECT p.id, p.competitor_id, e.name AS competitor_name, e.slug AS competitor_slug,
                p.service_name, p.service_category, p.price_min, p.price_max,
                p.price_text, p.unit, p.notes, p.scraped_at, p.verified
         FROM kb_competitor_prices p
         JOIN kb_entities e ON e.id = p.competitor_id
         WHERE p.service_category = $1
         ORDER BY p.price_min NULLS LAST, e.name",
    )
    .bind(&category)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(prices))
}

/// GET /api/kb/competitor-prices/positioning — our prices vs competitors by category
pub async fn positioning(State(state): State<AppState>) -> Result<Json<Vec<CategoryPositioning>>> {
    let rows = sqlx::query_as::<_, CategoryPositioning>(
        "SELECT p.service_category,
                e.name AS competitor_name, e.slug AS competitor_slug,
                MIN(p.price_min) AS min_price,
                ROUND(AVG(p.price_min), 0) AS avg_price,
                COUNT(p.id) AS service_count
         FROM kb_competitor_prices p
         JOIN kb_entities e ON e.id = p.competitor_id
         WHERE p.price_min IS NOT NULL
         GROUP BY p.service_category, e.id, e.name, e.slug
         ORDER BY p.service_category, e.name",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/kb/competitor-prices/:slug — prices for a specific competitor
pub async fn list_by_competitor(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<CompetitorPrice>>> {
    let prices = sqlx::query_as::<_, CompetitorPrice>(
        "SELECT p.*
         FROM kb_competitor_prices p
         JOIN kb_entities e ON e.id = p.competitor_id
         WHERE e.slug = $1
         ORDER BY p.service_category, p.price_min NULLS LAST",
    )
    .bind(&slug)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(prices))
}

// ═══════════════════════════════════════════════════════
//  HISTORY & TRENDS
// ═══════════════════════════════════════════════════════

/// GET /api/kb/competitor-prices/history/:slug — price change history for a competitor
pub async fn history(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<PriceHistoryEntry>>> {
    let days = q.days.unwrap_or(90);
    let limit = q.limit.unwrap_or(200).min(500);

    let rows = sqlx::query_as::<_, PriceHistoryEntry>(
        "SELECT h.id, h.competitor_id, h.service_name, h.service_category,
                h.old_price, h.new_price, h.change_pct, h.change_type, h.recorded_at
         FROM kb_price_history h
         JOIN kb_entities e ON e.id = h.competitor_id
         WHERE e.slug = $1
           AND h.recorded_at >= NOW() - make_interval(days => $2::int)
           AND ($3::text IS NULL OR h.service_name = $3)
         ORDER BY h.recorded_at DESC
         LIMIT $4",
    )
    .bind(&slug)
    .bind(days as i32)
    .bind(&q.service_name)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/kb/competitor-prices/trends/:category — trend data for charts
/// Returns [{competitor_name, price, recorded_at}] — ready for chart rendering
pub async fn trends(
    State(state): State<AppState>,
    Path(category): Path<String>,
    Query(q): Query<TrendsQuery>,
) -> Result<Json<Vec<PriceTrendPoint>>> {
    let days = q.days.unwrap_or(90);

    let rows = sqlx::query_as::<_, PriceTrendPoint>(
        "SELECT e.name AS competitor_name, h.new_price AS price, h.recorded_at
         FROM kb_price_history h
         JOIN kb_entities e ON e.id = h.competitor_id
         WHERE h.service_category = $1
           AND h.new_price IS NOT NULL
           AND h.recorded_at >= NOW() - make_interval(days => $2::int)
         ORDER BY h.recorded_at ASC",
    )
    .bind(&category)
    .bind(days as i32)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

// ═══════════════════════════════════════════════════════
//  ALERTS
// ═══════════════════════════════════════════════════════

/// GET /api/kb/price-alerts — list alerts
pub async fn list_alerts(
    State(state): State<AppState>,
    Query(q): Query<AlertsQuery>,
) -> Result<Json<Vec<PriceAlertWithCompetitor>>> {
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let rows = sqlx::query_as::<_, PriceAlertWithCompetitor>(
        "SELECT a.id, a.competitor_id, e.name AS competitor_name,
                a.alert_type, a.severity, a.title, a.description,
                a.metadata, a.is_read, a.created_at
         FROM kb_price_alerts a
         JOIN kb_entities e ON e.id = a.competitor_id
         WHERE ($1::text IS NULL OR a.alert_type = $1)
           AND ($2::text IS NULL OR a.severity = $2)
           AND ($3::bool IS NULL OR a.is_read = $3)
         ORDER BY a.created_at DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(&q.alert_type)
    .bind(&q.severity)
    .bind(q.is_read)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// GET /api/kb/price-alerts/unread-count — for sidebar badge
pub async fn unread_alert_count(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM kb_price_alerts WHERE NOT is_read",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "count": count })))
}

/// PATCH /api/kb/price-alerts/:id/read — mark alert as read
pub async fn mark_alert_read(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let result = sqlx::query(
        "UPDATE kb_price_alerts SET is_read = TRUE, read_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Alert not found"));
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

/// POST /api/kb/price-alerts/read-all — mark all alerts as read
pub async fn mark_all_alerts_read(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let result = sqlx::query(
        "UPDATE kb_price_alerts SET is_read = TRUE, read_at = NOW() WHERE NOT is_read",
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "marked": result.rows_affected() })))
}

// ═══════════════════════════════════════════════════════
//  SCRAPE LOGS
// ═══════════════════════════════════════════════════════

/// GET /api/kb/scrape-logs — scrape history with diagnostics
pub async fn scrape_logs(
    State(state): State<AppState>,
    Query(q): Query<ScrapeLogsQuery>,
) -> Result<Json<Vec<ScrapeLog>>> {
    let limit = q.limit.unwrap_or(50).min(200);

    let rows = sqlx::query_as::<_, ScrapeLog>(
        "SELECT * FROM kb_scrape_logs
         WHERE ($1::text IS NULL OR source_slug = $1)
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(&q.source_slug)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

// ═══════════════════════════════════════════════════════
//  WRITE ENDPOINTS (scrape triggers, verify, import)
// ═══════════════════════════════════════════════════════

/// POST /api/kb/competitor-prices/scrape/:source_slug — trigger manual scrape
pub async fn trigger_scrape(
    State(state): State<AppState>,
    Path(source_slug): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let scraper = ScraperService::new(state.db.clone());

    // Mark source as syncing
    let _ = sqlx::query("UPDATE kb_data_sources SET sync_status = 'syncing' WHERE slug = $1")
        .bind(&source_slug)
        .execute(&state.db)
        .await;

    let result = scraper.scrape_source(&source_slug).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Try to save structured prices
    let competitor_slug = source_slug
        .strip_prefix("web-")
        .map(|s| format!("competitor-{s}"));

    let mut prices_saved = 0;
    if let Some(ref slug) = competitor_slug {
        match scraper.save_structured_prices(slug, &result.data).await {
            Ok(count) => prices_saved = count,
            Err(e) => tracing::warn!("Failed to save structured prices: {e}"),
        }
    }

    // Update scrape log with prices_saved
    let _ = sqlx::query(
        "UPDATE kb_scrape_logs SET prices_saved = $2, extraction_method = 'llm'
         WHERE source_slug = $1 AND created_at = (SELECT MAX(created_at) FROM kb_scrape_logs WHERE source_slug = $1)",
    )
    .bind(&source_slug)
    .bind(prices_saved as i32)
    .execute(&state.db)
    .await;

    Ok(Json(serde_json::json!({
        "source": result.source,
        "pages_scraped": result.pages_scraped,
        "items_found": result.items_found,
        "prices_saved": prices_saved,
    })))
}

/// POST /api/kb/competitor-prices/scrape-all — trigger scrape for all active sources
/// Deduplicates: only one scrape-all can run at a time (AtomicBool guard).
pub async fn trigger_scrape_all(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let Some(guard) = ScraperService::try_start_scrape_all() else {
        return Ok(Json(serde_json::json!({
            "status": "already_running",
            "message": "Scrape-all is already in progress",
        })));
    };

    let sources: Vec<String> = sqlx::query_scalar(
        "SELECT slug FROM kb_data_sources WHERE source_type = 'scraper' AND is_active = TRUE",
    )
    .fetch_all(&state.db)
    .await?;

    let total = sources.len();
    let db = state.db.clone();

    // Spawn async — don't block the HTTP response
    tokio::spawn(async move {
        let _guard = guard; // lives until task ends, even on panic
        let scraper = ScraperService::new(db.clone());
        for source_slug in &sources {
            let _ = sqlx::query("UPDATE kb_data_sources SET sync_status = 'syncing' WHERE slug = $1")
                .bind(source_slug)
                .execute(&db)
                .await;

            match scraper.scrape_source(source_slug).await {
                Ok(result) => {
                    let competitor_slug = source_slug
                        .strip_prefix("web-")
                        .map(|s| format!("competitor-{s}"));

                    if let Some(ref slug) = competitor_slug {
                        let _ = scraper.save_structured_prices(slug, &result.data).await;
                    }
                    tracing::info!("Scrape-all: {source_slug} done ({} items)", result.items_found);
                }
                Err(e) => tracing::error!("Scrape-all: {source_slug} failed: {e}"),
            }
        }
        tracing::info!("Scrape-all completed: {total} sources");
        // _guard drops here, releasing the lock
    });

    Ok(Json(serde_json::json!({
        "status": "started",
        "sources": total,
    })))
}

/// POST /api/kb/competitor-prices/import-markdown — import from /конкуренты/ files
pub async fn import_markdown(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let result = crate::services::markdown_importer::import_all(&state.db).await
        .map_err(|e| AppError::Internal(e))?;

    Ok(Json(result))
}

/// PATCH /api/kb/competitor-prices/:id/verify — manually verify/correct a price
pub async fn verify_price(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let verified = body.get("verified").and_then(|v| v.as_bool()).unwrap_or(true);
    let price_min = body.get("price_min").and_then(|v| v.as_i64()).map(|v| v as i32);

    let mut query = String::from("UPDATE kb_competitor_prices SET verified = $2");
    if price_min.is_some() {
        query.push_str(", price_min = $3");
    }
    query.push_str(" WHERE id = $1");

    let result = if let Some(price) = price_min {
        sqlx::query(&query)
            .bind(id)
            .bind(verified)
            .bind(price)
            .execute(&state.db)
            .await?
    } else {
        sqlx::query(&query)
            .bind(id)
            .bind(verified)
            .execute(&state.db)
            .await?
    };

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Price not found"));
    }

    Ok(Json(serde_json::json!({ "success": true })))
}
