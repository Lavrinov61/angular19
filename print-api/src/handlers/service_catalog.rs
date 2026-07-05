use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::service_catalog::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/service-catalog — active services
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ServiceCatalogQuery>,
) -> Result<Json<Value>> {
    let services = if let Some(ref cat) = q.category {
        sqlx::query_as::<_, ServiceCatalogRow>(
            "SELECT * FROM service_catalog WHERE is_active AND category = $1 ORDER BY sort_order, name"
        )
        .bind(cat)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, ServiceCatalogRow>(
            "SELECT * FROM service_catalog WHERE is_active ORDER BY sort_order, name",
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "services": services })))
}

/// GET /api/print/service-catalog/slug/:slug
pub async fn get_by_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    let service =
        sqlx::query_as::<_, ServiceCatalogRow>("SELECT * FROM service_catalog WHERE slug = $1")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Услуга не найдена: {slug}")))?;

    Ok(Json(json!({ "success": true, "service": service })))
}

/// POST /api/print/service-catalog
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateServiceCatalogDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.slug.is_empty() || body.name.is_empty() || body.category.is_empty() {
        return Err(AppError::bad_request("slug, name и category обязательны"));
    }

    let profile_uuid = body
        .default_print_profile_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid default_print_profile_id"))?;

    let service = sqlx::query_as::<_, ServiceCatalogRow>(
        r#"INSERT INTO service_catalog (slug, name, category, required_device_type, requires_template,
             requires_design_editor, base_price, price_per_unit, price_rules, default_print_profile_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
           RETURNING *"#,
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.category)
    .bind(&body.required_device_type)
    .bind(body.requires_template.unwrap_or(false))
    .bind(body.requires_design_editor.unwrap_or(false))
    .bind(body.base_price.unwrap_or(0.0))
    .bind(body.price_per_unit.unwrap_or(0.0))
    .bind(body.price_rules.as_ref().unwrap_or(&json!({})))
    .bind(profile_uuid)
    .bind(body.sort_order.unwrap_or(0))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "service": service })))
}

/// PUT /api/print/service-catalog/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateServiceCatalogDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE service_catalog SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref cat) = body.category {
        sqlx::query("UPDATE service_catalog SET category = $1, updated_at = NOW() WHERE id = $2")
            .bind(cat)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref rdt_opt) = body.required_device_type {
        sqlx::query("UPDATE service_catalog SET required_device_type = $1, updated_at = NOW() WHERE id = $2")
            .bind(rdt_opt.as_deref()).bind(id).execute(&mut *tx).await?;
    }
    if let Some(rt) = body.requires_template {
        sqlx::query(
            "UPDATE service_catalog SET requires_template = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(rt)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(rde) = body.requires_design_editor {
        sqlx::query("UPDATE service_catalog SET requires_design_editor = $1, updated_at = NOW() WHERE id = $2")
            .bind(rde).bind(id).execute(&mut *tx).await?;
    }
    if let Some(bp) = body.base_price {
        sqlx::query("UPDATE service_catalog SET base_price = $1, updated_at = NOW() WHERE id = $2")
            .bind(bp)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ppu) = body.price_per_unit {
        sqlx::query(
            "UPDATE service_catalog SET price_per_unit = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(ppu)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref pr) = body.price_rules {
        sqlx::query(
            "UPDATE service_catalog SET price_rules = $1::jsonb, updated_at = NOW() WHERE id = $2",
        )
        .bind(pr)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref pid_opt) = body.default_print_profile_id {
        let uuid = pid_opt
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::bad_request("Invalid default_print_profile_id"))?;
        sqlx::query("UPDATE service_catalog SET default_print_profile_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(uuid).bind(id).execute(&mut *tx).await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE service_catalog SET is_active = $1, updated_at = NOW() WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(so) = body.sort_order {
        sqlx::query("UPDATE service_catalog SET sort_order = $1, updated_at = NOW() WHERE id = $2")
            .bind(so)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let service =
        sqlx::query_as::<_, ServiceCatalogRow>("SELECT * FROM service_catalog WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Услуга не найдена: {id}")))?;

    Ok(Json(json!({ "success": true, "service": service })))
}

/// DELETE /api/print/service-catalog/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query(
        "UPDATE service_catalog SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Услуга не найдена: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}
