use axum::{extract::State, Json};

use crate::error::{AppError, Result};
use crate::models::entity::Entity;
use crate::AppState;

/// POST /api/kb/bulk/entities — batch create entities
///
/// Accepts an array of entity definitions and inserts them in a single transaction.
/// Returns the count of successfully created entities and any errors.
pub async fn bulk_create_entities(
    State(state): State<AppState>,
    Json(body): Json<BulkCreateRequest>,
) -> Result<Json<BulkResult>> {
    if body.entities.is_empty() {
        return Err(AppError::bad_request("No entities provided"));
    }

    if body.entities.len() > 500 {
        return Err(AppError::bad_request(
            "Maximum 500 entities per batch request",
        ));
    }

    let mut tx = state.db.begin().await?;
    let mut created = 0i32;
    let mut errors: Vec<BulkError> = Vec::new();

    for (i, item) in body.entities.iter().enumerate() {
        // Resolve category
        let category_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM kb_categories WHERE slug = $1",
        )
        .bind(&item.category_slug)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(category_id) = category_id else {
            errors.push(BulkError {
                index: i,
                slug: item.slug.clone(),
                error: format!("Category '{}' not found", item.category_slug),
            });
            continue;
        };

        let result = sqlx::query(
            "INSERT INTO kb_entities (
               category_id, entity_type, slug, name, summary, content,
               metadata, tags, status, visibility, source_type, source_ref, confidence
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (slug) DO NOTHING",
        )
        .bind(category_id)
        .bind(&item.entity_type)
        .bind(&item.slug)
        .bind(&item.name)
        .bind(&item.summary)
        .bind(&item.content)
        .bind(item.metadata.as_ref().unwrap_or(&serde_json::json!({})))
        .bind(item.tags.as_deref().unwrap_or(&[]))
        .bind(item.status.as_deref().unwrap_or("draft"))
        .bind(item.visibility.as_deref().unwrap_or("internal"))
        .bind(item.source_type.as_deref().unwrap_or("import"))
        .bind(&item.source_ref)
        .bind(item.confidence.unwrap_or(1.0))
        .execute(&mut *tx)
        .await;

        match result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    created += 1;
                } else {
                    errors.push(BulkError {
                        index: i,
                        slug: item.slug.clone(),
                        error: "Entity with this slug already exists (skipped)".into(),
                    });
                }
            }
            Err(e) => {
                errors.push(BulkError {
                    index: i,
                    slug: item.slug.clone(),
                    error: e.to_string(),
                });
            }
        }
    }

    tx.commit().await?;

    Ok(Json(BulkResult {
        total: body.entities.len() as i32,
        created,
        skipped: body.entities.len() as i32 - created - errors.len() as i32,
        errors,
    }))
}

/// PATCH /api/kb/bulk/entities — batch update entities
pub async fn bulk_update_entities(
    State(state): State<AppState>,
    Json(body): Json<BulkUpdateRequest>,
) -> Result<Json<BulkUpdateResult>> {
    if body.updates.is_empty() {
        return Err(AppError::bad_request("No updates provided"));
    }

    if body.updates.len() > 500 {
        return Err(AppError::bad_request(
            "Maximum 500 updates per batch request",
        ));
    }

    let mut tx = state.db.begin().await?;
    let mut updated = 0i32;
    let mut errors: Vec<BulkError> = Vec::new();

    for (i, item) in body.updates.iter().enumerate() {
        let result = sqlx::query(
            "UPDATE kb_entities SET
               name = COALESCE($2, name),
               summary = COALESCE($3, summary),
               content = COALESCE($4, content),
               metadata = COALESCE($5, metadata),
               tags = COALESCE($6, tags),
               status = COALESCE($7, status),
               visibility = COALESCE($8, visibility)
             WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(&item.slug)
        .bind(&item.name)
        .bind(&item.summary)
        .bind(&item.content)
        .bind(&item.metadata)
        .bind(&item.tags)
        .bind(&item.status)
        .bind(&item.visibility)
        .execute(&mut *tx)
        .await;

        match result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    updated += 1;
                } else {
                    errors.push(BulkError {
                        index: i,
                        slug: item.slug.clone(),
                        error: "Entity not found or deleted".into(),
                    });
                }
            }
            Err(e) => {
                errors.push(BulkError {
                    index: i,
                    slug: item.slug.clone(),
                    error: e.to_string(),
                });
            }
        }
    }

    tx.commit().await?;

    Ok(Json(BulkUpdateResult {
        total: body.updates.len() as i32,
        updated,
        errors,
    }))
}

/// POST /api/kb/bulk/relations — batch create relations
pub async fn bulk_create_relations(
    State(state): State<AppState>,
    Json(body): Json<BulkRelationsRequest>,
) -> Result<Json<BulkResult>> {
    if body.relations.is_empty() {
        return Err(AppError::bad_request("No relations provided"));
    }

    if body.relations.len() > 1000 {
        return Err(AppError::bad_request(
            "Maximum 1000 relations per batch request",
        ));
    }

    let mut tx = state.db.begin().await?;
    let mut created = 0i32;
    let mut errors: Vec<BulkError> = Vec::new();

    for (i, item) in body.relations.iter().enumerate() {
        // Resolve entity slugs
        let from_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(&item.from_slug)
        .fetch_optional(&mut *tx)
        .await?;

        let to_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM kb_entities WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(&item.to_slug)
        .fetch_optional(&mut *tx)
        .await?;

        let (Some(from_id), Some(to_id)) = (from_id, to_id) else {
            errors.push(BulkError {
                index: i,
                slug: format!("{} → {}", item.from_slug, item.to_slug),
                error: "One or both entities not found".into(),
            });
            continue;
        };

        let result = sqlx::query(
            "INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, weight, bidirectional, source_type)
             VALUES ($1, $2, $3, $4, $5, $6, 'import')
             ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING",
        )
        .bind(from_id)
        .bind(to_id)
        .bind(&item.relation_type)
        .bind(&item.label)
        .bind(item.weight.unwrap_or(1.0))
        .bind(item.bidirectional.unwrap_or(false))
        .execute(&mut *tx)
        .await;

        match result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    created += 1;
                }
            }
            Err(e) => {
                errors.push(BulkError {
                    index: i,
                    slug: format!("{} → {}", item.from_slug, item.to_slug),
                    error: e.to_string(),
                });
            }
        }
    }

    tx.commit().await?;

    Ok(Json(BulkResult {
        total: body.relations.len() as i32,
        created,
        skipped: body.relations.len() as i32 - created - errors.len() as i32,
        errors,
    }))
}

// --- Request/Response types ---

#[derive(Debug, serde::Deserialize)]
pub struct BulkCreateRequest {
    pub entities: Vec<BulkEntityItem>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkEntityItem {
    pub category_slug: String,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub source_type: Option<String>,
    pub source_ref: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkUpdateRequest {
    pub updates: Vec<BulkUpdateItem>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkUpdateItem {
    pub slug: String,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub visibility: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkRelationsRequest {
    pub relations: Vec<BulkRelationItem>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkRelationItem {
    pub from_slug: String,
    pub to_slug: String,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: Option<f64>,
    pub bidirectional: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
pub struct BulkResult {
    pub total: i32,
    pub created: i32,
    pub skipped: i32,
    pub errors: Vec<BulkError>,
}

#[derive(Debug, serde::Serialize)]
pub struct BulkUpdateResult {
    pub total: i32,
    pub updated: i32,
    pub errors: Vec<BulkError>,
}

#[derive(Debug, serde::Serialize)]
pub struct BulkError {
    pub index: usize,
    pub slug: String,
    pub error: String,
}
