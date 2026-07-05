use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::source::{
    CreateDataSource, DataSource, SourceLinkExpanded, UpdateDataSource,
};
use crate::AppState;

/// GET /api/kb/sources — list all data sources
pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<DataSource>>> {
    let sources = sqlx::query_as::<_, DataSource>(
        "SELECT * FROM kb_data_sources ORDER BY is_active DESC, name",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(sources))
}

/// GET /api/kb/sources/:key — get by slug or UUID
pub async fn get(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<DataSource>> {
    let source = if let Ok(id) = key.parse::<Uuid>() {
        sqlx::query_as::<_, DataSource>("SELECT * FROM kb_data_sources WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
    } else {
        sqlx::query_as::<_, DataSource>("SELECT * FROM kb_data_sources WHERE slug = $1")
            .bind(&key)
            .fetch_optional(&state.db)
            .await?
    };

    source.map(Json).ok_or_else(|| AppError::not_found(format!("Data source '{key}' not found")))
}

/// POST /api/kb/sources — create a new data source
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateDataSource>,
) -> Result<Json<DataSource>> {
    let source = sqlx::query_as::<_, DataSource>(
        "INSERT INTO kb_data_sources (slug, name, source_type, config, sync_schedule)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *",
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.source_type)
    .bind(body.config.as_ref().unwrap_or(&serde_json::json!({})))
    .bind(&body.sync_schedule)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(source))
}

/// PATCH /api/kb/sources/:key — update a data source
pub async fn update(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<UpdateDataSource>,
) -> Result<Json<DataSource>> {
    let id = resolve_source_id(&state.db, &key).await?;

    let source = sqlx::query_as::<_, DataSource>(
        "UPDATE kb_data_sources SET
           name = COALESCE($2, name),
           config = COALESCE($3, config),
           sync_schedule = COALESCE($4, sync_schedule),
           is_active = COALESCE($5, is_active)
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.config)
    .bind(&body.sync_schedule)
    .bind(body.is_active)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Data source not found"))?;

    Ok(Json(source))
}

/// DELETE /api/kb/sources/:key — deactivate a data source
pub async fn deactivate(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let id = resolve_source_id(&state.db, &key).await?;

    sqlx::query("UPDATE kb_data_sources SET is_active = FALSE WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "deactivated": true })))
}

/// GET /api/kb/sources/:key/links — entities linked to this source
pub async fn links(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<Vec<SourceLinkExpanded>>> {
    let id = resolve_source_id(&state.db, &key).await?;

    let links = sqlx::query_as::<_, SourceLinkExpanded>(
        "SELECT sl.id, sl.entity_id, e.name AS entity_name, e.slug AS entity_slug,
                sl.source_id, ds.name AS source_name, ds.slug AS source_slug,
                sl.external_id, sl.sync_hash, sl.last_synced_at
         FROM kb_source_links sl
         JOIN kb_entities e ON e.id = sl.entity_id
         JOIN kb_data_sources ds ON ds.id = sl.source_id
         WHERE sl.source_id = $1
         ORDER BY sl.last_synced_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(links))
}

/// POST /api/kb/sources/:key/sync — trigger sync for a data source
///
/// This marks the source as syncing and creates enrichment tasks.
/// Actual sync happens asynchronously via the enrichment pipeline.
pub async fn trigger_sync(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let id = resolve_source_id(&state.db, &key).await?;

    // Check source is active
    let source = sqlx::query_as::<_, DataSource>(
        "SELECT * FROM kb_data_sources WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    if !source.is_active {
        return Err(AppError::bad_request("Data source is inactive"));
    }

    // Mark as syncing
    sqlx::query(
        "UPDATE kb_data_sources SET sync_status = 'syncing', sync_error = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    // Determine task type based on source type
    let task_type = match source.source_type.as_str() {
        "scraper" => "scrape_competitor",
        "file" => "import_file",
        "database" => "sync_database",
        "api" => "sync_api",
        _ => "sync_generic",
    };

    // Create enrichment task for the sync
    sqlx::query(
        "INSERT INTO kb_enrichment_tasks (task_type, priority, payload)
         VALUES ($1, 3, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(task_type)
    .bind(serde_json::json!({
        "source_id": id,
        "source_slug": source.slug,
        "source_type": source.source_type,
        "config": source.config,
    }))
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "sync_triggered": true,
        "source": source.slug,
        "task_type": task_type
    })))
}

async fn resolve_source_id(db: &sqlx::PgPool, key: &str) -> Result<Uuid> {
    if let Ok(id) = key.parse::<Uuid>() {
        Ok(id)
    } else {
        sqlx::query_scalar("SELECT id FROM kb_data_sources WHERE slug = $1")
            .bind(key)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Data source '{key}' not found")))
    }
}
