use axum::{
    extract::{Path, Query, State},
    Json,
};

use crate::error::{AppError, Result};
use crate::models::metric::{MetricDefinition, MetricPoint, MetricSeriesQuery, RecordMetric};
use crate::AppState;

/// GET /api/kb/metrics/definitions
pub async fn list_definitions(State(state): State<AppState>) -> Result<Json<Vec<MetricDefinition>>> {
    let defs = sqlx::query_as::<_, MetricDefinition>(
        "SELECT * FROM kb_metric_definitions WHERE is_active = TRUE ORDER BY category, slug",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(defs))
}

/// POST /api/kb/metrics
pub async fn record(
    State(state): State<AppState>,
    Json(body): Json<RecordMetric>,
) -> Result<Json<serde_json::Value>> {
    let def_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM kb_metric_definitions WHERE slug = $1",
    )
    .bind(&body.metric_slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad_request(format!("Metric '{}' not found", body.metric_slug)))?;

    sqlx::query(
        "INSERT INTO kb_metrics (definition_id, metric_value, dimensions, period_type, period_start, period_end, source_type, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (definition_id, dimensions, period_type, period_start) DO UPDATE SET metric_value = $2",
    )
    .bind(def_id)
    .bind(body.value)
    .bind(body.dimensions.as_ref().unwrap_or(&serde_json::json!({})))
    .bind(body.period_type.as_deref().unwrap_or("daily"))
    .bind(body.period_start)
    .bind(body.period_end)
    .bind(body.source_type.as_deref().unwrap_or("manual"))
    .bind(&body.notes)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "recorded": true })))
}

/// GET /api/kb/metrics/series/:slug
pub async fn series(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(q): Query<MetricSeriesQuery>,
) -> Result<Json<Vec<MetricPoint>>> {
    let points = sqlx::query_as::<_, MetricPoint>(
        "SELECT * FROM kb_metric_series($1, $2, $3, $4, $5)",
    )
    .bind(&slug)
    .bind(q.period_type.as_deref().unwrap_or("monthly"))
    .bind(q.from)
    .bind(q.to)
    .bind(q.dimensions.as_ref().unwrap_or(&serde_json::json!({})))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(points))
}
