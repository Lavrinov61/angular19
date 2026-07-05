use axum::{
    extract::{Path, State},
    Json,
};

use crate::error::{AppError, Result};
use crate::models::relation::{CreateRelation, RelationExpanded};
use crate::AppState;

/// GET /api/kb/entities/:id/relations
pub async fn get_entity_relations(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<Vec<RelationExpanded>>> {
    let relations = sqlx::query_as::<_, RelationExpanded>(
        "SELECT r.id, r.relation_type, r.label, r.weight, r.bidirectional,
                r.from_entity_id AS from_id, f.name AS from_name, f.entity_type AS from_type,
                r.to_entity_id AS to_id, t.name AS to_name, t.entity_type AS to_type
         FROM kb_relations r
         JOIN kb_entities f ON f.id = r.from_entity_id
         JOIN kb_entities t ON t.id = r.to_entity_id
         WHERE r.from_entity_id = $1 OR r.to_entity_id = $1
         ORDER BY r.weight DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(relations))
}

/// POST /api/kb/relations
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateRelation>,
) -> Result<Json<serde_json::Value>> {
    let from_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
    )
    .bind(&body.from_slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad_request(format!("Entity '{}' not found", body.from_slug)))?;

    let to_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
    )
    .bind(&body.to_slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad_request(format!("Entity '{}' not found", body.to_slug)))?;

    sqlx::query(
        "INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, weight, bidirectional, source_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual')
         ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING",
    )
    .bind(from_id)
    .bind(to_id)
    .bind(&body.relation_type)
    .bind(&body.label)
    .bind(body.weight.unwrap_or(1.0))
    .bind(body.bidirectional.unwrap_or(false))
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "created": true })))
}

/// DELETE /api/kb/relations/:id
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>> {
    let rows = sqlx::query("DELETE FROM kb_relations WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::not_found("Relation not found"));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
