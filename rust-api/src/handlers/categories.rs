use axum::{
    extract::{Path, State},
    Json,
};

use crate::error::{AppError, Result};
use crate::models::category::{Category, CreateCategory, UpdateCategory};
use crate::AppState;

/// GET /api/kb/categories — full tree
pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<Category>>> {
    let categories = sqlx::query_as::<_, Category>(
        "SELECT * FROM kb_categories WHERE is_active = TRUE ORDER BY path, sort_order"
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(categories))
}

/// GET /api/kb/categories/:key (slug or UUID)
pub async fn get_by_slug(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<Category>> {
    let cat = if let Ok(id) = key.parse::<uuid::Uuid>() {
        sqlx::query_as::<_, Category>("SELECT * FROM kb_categories WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
    } else {
        sqlx::query_as::<_, Category>("SELECT * FROM kb_categories WHERE slug = $1")
            .bind(&key)
            .fetch_optional(&state.db)
            .await?
    };

    cat.map(Json).ok_or_else(|| AppError::not_found(format!("Category '{key}' not found")))
}

/// POST /api/kb/categories
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateCategory>,
) -> Result<Json<Category>> {
    let (parent_id, depth, path) = if let Some(ref parent_slug) = body.parent_slug {
        let parent = sqlx::query_as::<_, Category>(
            "SELECT * FROM kb_categories WHERE slug = $1"
        )
        .bind(parent_slug)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::bad_request(format!("Parent '{parent_slug}' not found")))?;

        (Some(parent.id), parent.depth + 1, format!("{}/{}", parent.path, body.slug))
    } else {
        (None, 0, body.slug.clone())
    };

    let cat = sqlx::query_as::<_, Category>(
        "INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *"
    )
    .bind(parent_id)
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.icon)
    .bind(body.sort_order.unwrap_or(0))
    .bind(depth)
    .bind(&path)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(cat))
}

/// PATCH /api/kb/categories/:key (UUID or slug)
pub async fn update(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<UpdateCategory>,
) -> Result<Json<Category>> {
    let id = if let Ok(uuid) = key.parse::<uuid::Uuid>() {
        uuid
    } else {
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM kb_categories WHERE slug = $1")
            .bind(&key)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Category '{key}' not found")))?
    };

    let cat = sqlx::query_as::<_, Category>(
        "UPDATE kb_categories SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           icon = COALESCE($4, icon),
           sort_order = COALESCE($5, sort_order),
           is_active = COALESCE($6, is_active)
         WHERE id = $1
         RETURNING *"
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.icon)
    .bind(body.sort_order)
    .bind(body.is_active)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Category not found"))?;

    Ok(Json(cat))
}
