use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

use crate::error::Result;
use crate::AppState;

/// GET /api/kb/export/entities — export entities as JSON
pub async fn export_entities(
    State(state): State<AppState>,
    Query(q): Query<ExportQuery>,
) -> Result<Response> {
    let entities = sqlx::query_as::<_, ExportEntity>(
        "SELECT e.id, e.entity_type, e.slug, e.name, e.summary, e.content,
                e.metadata, e.tags, e.status, e.visibility, e.source_type,
                e.source_ref, e.confidence, e.is_verified, e.version,
                c.slug AS category_slug, c.path AS category_path,
                e.created_at, e.updated_at
         FROM kb_entities e
         JOIN kb_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL
           AND ($1::text IS NULL OR e.entity_type = $1)
           AND ($2::text IS NULL OR c.path LIKE $2 || '%')
           AND ($3::text IS NULL OR e.status = $3)
         ORDER BY c.path, e.name",
    )
    .bind(&q.entity_type)
    .bind(&q.category)
    .bind(&q.status)
    .fetch_all(&state.db)
    .await?;

    let json = serde_json::json!({
        "export_date": chrono::Utc::now().to_rfc3339(),
        "count": entities.len(),
        "filters": {
            "entity_type": q.entity_type,
            "category": q.category,
            "status": q.status,
        },
        "entities": entities,
    });

    let body = serde_json::to_string_pretty(&json).unwrap();

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"kb-export.json\"",
            ),
        ],
        body,
    )
        .into_response())
}

/// GET /api/kb/export/relations — export relations as JSON
pub async fn export_relations(State(state): State<AppState>) -> Result<Response> {
    let relations = sqlx::query_as::<_, ExportRelation>(
        "SELECT r.id, r.relation_type, r.label, r.weight, r.bidirectional,
                r.source_type, r.confidence,
                f.slug AS from_slug, f.name AS from_name, f.entity_type AS from_type,
                t.slug AS to_slug, t.name AS to_name, t.entity_type AS to_type,
                r.created_at
         FROM kb_relations r
         JOIN kb_entities f ON f.id = r.from_entity_id AND f.deleted_at IS NULL
         JOIN kb_entities t ON t.id = r.to_entity_id AND t.deleted_at IS NULL
         ORDER BY r.relation_type, f.name",
    )
    .fetch_all(&state.db)
    .await?;

    let json = serde_json::json!({
        "export_date": chrono::Utc::now().to_rfc3339(),
        "count": relations.len(),
        "relations": relations,
    });

    let body = serde_json::to_string_pretty(&json).unwrap();

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"kb-relations-export.json\"",
            ),
        ],
        body,
    )
        .into_response())
}

#[derive(Debug, serde::Deserialize)]
pub struct ExportQuery {
    pub entity_type: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportEntity {
    id: uuid::Uuid,
    entity_type: String,
    slug: String,
    name: String,
    summary: Option<String>,
    content: Option<String>,
    metadata: serde_json::Value,
    tags: Vec<String>,
    status: String,
    visibility: String,
    source_type: String,
    source_ref: Option<String>,
    confidence: sqlx::types::BigDecimal,
    is_verified: bool,
    version: i32,
    category_slug: String,
    category_path: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportRelation {
    id: uuid::Uuid,
    relation_type: String,
    label: Option<String>,
    weight: sqlx::types::BigDecimal,
    bidirectional: bool,
    source_type: String,
    confidence: sqlx::types::BigDecimal,
    from_slug: String,
    from_name: String,
    from_type: String,
    to_slug: String,
    to_name: String,
    to_type: String,
    created_at: chrono::DateTime<chrono::Utc>,
}
