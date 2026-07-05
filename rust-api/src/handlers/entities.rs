use axum::{
    extract::{Path, Query, State},
    Json,
};

use crate::error::{AppError, Result};
use crate::models::entity::{
    CreateEntity, Entity, EntitySummary, EntityVersion, ListEntitiesQuery, UpdateEntity,
};
use crate::AppState;

/// GET /api/kb/entities
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListEntitiesQuery>,
) -> Result<Json<Vec<EntitySummary>>> {
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let entities = sqlx::query_as::<_, EntitySummary>(
        "SELECT e.id, e.entity_type, e.slug, e.status, e.name, e.summary,
                e.tags, e.confidence, e.is_verified, c.path AS category_path,
                e.created_at, e.updated_at
         FROM kb_entities e
         JOIN kb_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL
           AND ($1::text IS NULL OR e.entity_type = $1)
           AND ($2::text IS NULL OR c.path LIKE $2 || '%')
           AND ($3::text IS NULL OR e.status = $3)
           AND ($4::bool IS NULL OR e.is_verified = $4)
           AND ($5::text IS NULL OR $5 = ANY(e.tags))
         ORDER BY e.updated_at DESC
         LIMIT $6 OFFSET $7",
    )
    .bind(&q.entity_type)
    .bind(&q.category)
    .bind(&q.status)
    .bind(q.verified)
    .bind(&q.tag)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(entities))
}

/// GET /api/kb/entities/:key (slug or UUID)
pub async fn get_by_slug(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<Entity>> {
    let entity = if let Ok(id) = key.parse::<uuid::Uuid>() {
        sqlx::query_as::<_, Entity>(
            "SELECT * FROM kb_entities WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Entity>(
            "SELECT * FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(&key)
        .fetch_optional(&state.db)
        .await?
    };

    entity.map(Json).ok_or_else(|| AppError::not_found(format!("Entity '{key}' not found")))
}

/// POST /api/kb/entities
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateEntity>,
) -> Result<Json<Entity>> {
    let category_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM kb_categories WHERE slug = $1",
    )
    .bind(&body.category_slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad_request(format!("Category '{}' not found", body.category_slug)))?;

    let entity = sqlx::query_as::<_, Entity>(
        "INSERT INTO kb_entities (
           category_id, entity_type, slug, name, summary, content,
           metadata, tags, status, visibility, source_type, source_ref, confidence
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *",
    )
    .bind(category_id)
    .bind(&body.entity_type)
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.summary)
    .bind(&body.content)
    .bind(body.metadata.as_ref().unwrap_or(&serde_json::json!({})))
    .bind(body.tags.as_deref().unwrap_or(&[]))
    .bind(body.status.as_deref().unwrap_or("draft"))
    .bind(body.visibility.as_deref().unwrap_or("internal"))
    .bind(body.source_type.as_deref().unwrap_or("manual"))
    .bind(&body.source_ref)
    .bind(body.confidence.unwrap_or(1.0))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(entity))
}

/// PATCH /api/kb/entities/:key (UUID or slug)
pub async fn update(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<UpdateEntity>,
) -> Result<Json<Entity>> {
    let id = resolve_entity_id(&state.db, &key).await?;
    let entity = sqlx::query_as::<_, Entity>(
        "UPDATE kb_entities SET
           name = COALESCE($2, name),
           summary = COALESCE($3, summary),
           content = COALESCE($4, content),
           metadata = COALESCE($5, metadata),
           tags = COALESCE($6, tags),
           status = COALESCE($7, status),
           visibility = COALESCE($8, visibility),
           confidence = COALESCE($9, confidence)
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *",
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.summary)
    .bind(&body.content)
    .bind(&body.metadata)
    .bind(&body.tags)
    .bind(&body.status)
    .bind(&body.visibility)
    .bind(body.confidence.map(|c| sqlx::types::BigDecimal::try_from(c).unwrap()))
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Entity not found"))?;

    Ok(Json(entity))
}

/// DELETE /api/kb/entities/:key (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let id = resolve_entity_id(&state.db, &key).await?;
    let rows = sqlx::query(
        "UPDATE kb_entities SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if rows == 0 {
        return Err(AppError::not_found("Entity not found"));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// POST /api/kb/entities/:id/verify
pub async fn verify(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<Entity>> {
    let entity = sqlx::query_as::<_, Entity>(
        "UPDATE kb_entities SET is_verified = TRUE, verified_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Entity not found"))?;

    Ok(Json(entity))
}

/// GET /api/kb/entities/:id/versions
pub async fn versions(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<Vec<EntityVersion>>> {
    let versions = sqlx::query_as::<_, EntityVersion>(
        "SELECT id, entity_id, version, name, change_type, change_reason, changed_by, created_at
         FROM kb_entity_versions
         WHERE entity_id = $1
         ORDER BY version DESC
         LIMIT 50",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(versions))
}

/// Resolve a key (UUID or slug) to a UUID
async fn resolve_entity_id(db: &sqlx::PgPool, key: &str) -> Result<uuid::Uuid> {
    if let Ok(id) = key.parse::<uuid::Uuid>() {
        Ok(id)
    } else {
        sqlx::query_scalar("SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL")
            .bind(key)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Entity '{key}' not found")))
    }
}
