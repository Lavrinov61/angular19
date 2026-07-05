use axum::{
    extract::{Path, Query, State},
    Json,
};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::enrichment::{
    BatchEnrichmentRequest, CreateEnrichmentTask, EnrichmentTask,
    EnrichmentTaskExpanded, ListEnrichmentQuery, UpdateEnrichmentTask,
};
use crate::AppState;

/// GET /api/kb/enrichment — list enrichment tasks
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListEnrichmentQuery>,
) -> Result<Json<Vec<EnrichmentTaskExpanded>>> {
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let tasks = sqlx::query_as::<_, EnrichmentTaskExpanded>(
        "SELECT t.*,
                COALESCE(e.name, s.name, t.payload->>'source_slug') AS entity_name,
                COALESCE(e.entity_type, 'source') AS entity_type
         FROM kb_enrichment_tasks t
         LEFT JOIN kb_entities e ON e.id = t.entity_id
         LEFT JOIN kb_data_sources s ON s.slug = t.payload->>'source_slug' AND t.entity_id IS NULL
         WHERE ($1::text IS NULL OR t.status = $1)
           AND ($2::text IS NULL OR t.task_type = $2)
           AND ($3::uuid IS NULL OR t.entity_id = $3)
         ORDER BY
           CASE t.status
             WHEN 'processing' THEN 1
             WHEN 'pending' THEN 2
             WHEN 'failed' THEN 3
             WHEN 'scheduled' THEN 4
             WHEN 'completed' THEN 5
             WHEN 'cancelled' THEN 6
           END,
           t.priority ASC,
           t.scheduled_at ASC
         LIMIT $4 OFFSET $5",
    )
    .bind(&q.status)
    .bind(&q.task_type)
    .bind(q.entity_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tasks))
}

/// GET /api/kb/enrichment/queue — ready-to-process tasks (from view)
pub async fn queue(State(state): State<AppState>) -> Result<Json<Vec<EnrichmentTaskExpanded>>> {
    let tasks = sqlx::query_as::<_, EnrichmentTaskExpanded>(
        "SELECT * FROM kb_enrichment_ready LIMIT 50",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tasks))
}

/// GET /api/kb/enrichment/:id
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<EnrichmentTask>> {
    let task = sqlx::query_as::<_, EnrichmentTask>(
        "SELECT * FROM kb_enrichment_tasks WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Enrichment task not found"))?;

    Ok(Json(task))
}

/// POST /api/kb/enrichment — create a new enrichment task
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateEnrichmentTask>,
) -> Result<Json<EnrichmentTask>> {
    // Resolve entity slug to ID if provided
    let entity_id = if let Some(ref slug) = body.entity_slug {
        let id: Uuid = sqlx::query_scalar(
            "SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::bad_request(format!("Entity '{slug}' not found")))?;
        Some(id)
    } else {
        None
    };

    let task = sqlx::query_as::<_, EnrichmentTask>(
        "INSERT INTO kb_enrichment_tasks (
           entity_id, task_type, priority, payload, max_attempts,
           cron_expression, scheduled_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *",
    )
    .bind(entity_id)
    .bind(&body.task_type)
    .bind(body.priority.unwrap_or(5))
    .bind(body.payload.as_ref().unwrap_or(&serde_json::json!({})))
    .bind(body.max_attempts.unwrap_or(3))
    .bind(&body.cron_expression)
    .bind(body.scheduled_at.unwrap_or_else(chrono::Utc::now))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(task))
}

/// PATCH /api/kb/enrichment/:id — update task status/result
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateEnrichmentTask>,
) -> Result<Json<EnrichmentTask>> {
    // Handle status transitions with appropriate timestamp updates
    let task = sqlx::query_as::<_, EnrichmentTask>(
        "UPDATE kb_enrichment_tasks SET
           status = COALESCE($2, status),
           priority = COALESCE($3, priority),
           result = COALESCE($4, result),
           error = COALESCE($5, error),
           max_attempts = COALESCE($6, max_attempts),
           started_at = CASE WHEN $2 = 'processing' THEN NOW() ELSE started_at END,
           completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
           attempts = CASE WHEN $2 = 'processing' THEN attempts + 1 ELSE attempts END,
           last_run_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE last_run_at END
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(&body.status)
    .bind(body.priority)
    .bind(&body.result)
    .bind(&body.error)
    .bind(body.max_attempts)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Enrichment task not found"))?;

    Ok(Json(task))
}

/// DELETE /api/kb/enrichment/:id — cancel a task
pub async fn cancel(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let rows = sqlx::query(
        "UPDATE kb_enrichment_tasks SET status = 'cancelled', completed_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'scheduled')",
    )
    .bind(id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if rows == 0 {
        return Err(AppError::bad_request(
            "Task not found or cannot be cancelled (already processing/completed)",
        ));
    }

    Ok(Json(serde_json::json!({ "cancelled": true })))
}

/// POST /api/kb/enrichment/batch — batch-enqueue tasks for all matching entities
pub async fn batch_enqueue(
    State(state): State<AppState>,
    Json(body): Json<BatchEnrichmentRequest>,
) -> Result<Json<serde_json::Value>> {
    let priority = body.priority.unwrap_or(5);

    let count = sqlx::query_scalar::<_, i64>(
        "INSERT INTO kb_enrichment_tasks (entity_id, task_type, priority, payload)
         SELECT e.id, $1, $2, '{}'::jsonb
         FROM kb_entities e
         JOIN kb_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL
           AND e.status = 'active'
           AND ($3::text IS NULL OR e.entity_type = $3)
           AND ($4::text IS NULL OR c.path LIKE $4 || '%')
           AND NOT EXISTS (
             SELECT 1 FROM kb_enrichment_tasks t
             WHERE t.entity_id = e.id
               AND t.task_type = $1
               AND t.status IN ('pending', 'processing')
           )
         RETURNING 1",
    )
    .bind(&body.task_type)
    .bind(priority)
    .bind(&body.entity_type)
    .bind(&body.category_slug)
    .fetch_all(&state.db)
    .await?
    .len() as i64;

    Ok(Json(serde_json::json!({
        "enqueued": count,
        "task_type": body.task_type
    })))
}

/// POST /api/kb/enrichment/:id/retry — retry a failed task
pub async fn retry(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<EnrichmentTask>> {
    let task = sqlx::query_as::<_, EnrichmentTask>(
        "UPDATE kb_enrichment_tasks SET
           status = 'pending',
           error = NULL,
           result = NULL,
           started_at = NULL,
           completed_at = NULL,
           scheduled_at = NOW()
         WHERE id = $1 AND status = 'failed'
         RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad_request("Task not found or not in failed state"))?;

    Ok(Json(task))
}

/// GET /api/kb/enrichment/stats — enrichment pipeline statistics
pub async fn stats(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let by_status = sqlx::query_as::<_, StatusCount>(
        "SELECT status, count(*) AS count
         FROM kb_enrichment_tasks
         GROUP BY status ORDER BY count DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let by_type = sqlx::query_as::<_, TypeStatusCount>(
        "SELECT task_type, status, count(*) AS count
         FROM kb_enrichment_tasks
         GROUP BY task_type, status
         ORDER BY task_type, status",
    )
    .fetch_all(&state.db)
    .await?;

    let avg_duration = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT EXTRACT(EPOCH FROM AVG(completed_at - started_at))
         FROM kb_enrichment_tasks
         WHERE status = 'completed' AND started_at IS NOT NULL",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "by_status": by_status,
        "by_type": by_type,
        "avg_duration_seconds": avg_duration,
    })))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct StatusCount {
    status: String,
    count: i64,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct TypeStatusCount {
    task_type: String,
    status: String,
    count: i64,
}
