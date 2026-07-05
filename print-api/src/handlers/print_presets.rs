use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::print_preset::*;

const PRINT_PRESET_COLUMNS: &str = r#"
    id,
    name,
    icon,
    printer_type,
    sublimation,
    paper_size,
    media_type,
    quality,
    fit_mode,
    borderless,
    color_mode,
    duplex,
    mirror,
    price::float8 AS price,
    sort_order,
    is_active,
    created_by,
    studio_id,
    created_at,
    updated_at,
    slug,
    rendering_intent,
    face_requirements
"#;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/presets — active presets with optional filters
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<PresetQuery>,
) -> Result<Json<Value>> {
    let printer_type = q.printer_type.as_deref();
    let studio_id = q
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let sql = format!(
        r#"SELECT {PRINT_PRESET_COLUMNS}
           FROM print_presets
           WHERE is_active
             AND ($1::text IS NULL OR printer_type = $1)
             AND ($2::uuid IS NULL OR studio_id = $2 OR studio_id IS NULL)
           ORDER BY sort_order, name"#,
    );

    let presets = sqlx::query_as::<_, PrintPresetRow>(&sql)
        .bind(printer_type)
        .bind(studio_id)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "presets": presets })))
}

/// POST /api/print/presets
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreatePresetDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.name.is_empty() || body.printer_type.is_empty() || body.paper_size.is_empty() {
        return Err(AppError::bad_request(
            "name, printer_type и paper_size обязательны",
        ));
    }

    let studio_uuid = body
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let sql = format!(
        r#"INSERT INTO print_presets
             (name, icon, printer_type, sublimation, paper_size, media_type,
              quality, fit_mode, borderless, color_mode, duplex, mirror,
              price, sort_order, created_by, studio_id,
              slug, rendering_intent, face_requirements)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19)
           RETURNING {PRINT_PRESET_COLUMNS}"#,
    );

    let preset = sqlx::query_as::<_, PrintPresetRow>(&sql)
        .bind(&body.name)
        .bind(body.icon.as_deref().unwrap_or("print"))
        .bind(&body.printer_type)
        .bind(body.sublimation.unwrap_or(false))
        .bind(&body.paper_size)
        .bind(body.media_type.as_deref())
        .bind(body.quality.as_deref().unwrap_or("normal"))
        .bind(body.fit_mode.as_deref().unwrap_or("fit"))
        .bind(body.borderless.unwrap_or(false))
        .bind(body.color_mode.as_deref().unwrap_or("color"))
        .bind(body.duplex.unwrap_or(false))
        .bind(body.mirror.unwrap_or(false))
        .bind(body.price.unwrap_or(0.0))
        .bind(body.sort_order.unwrap_or(0))
        .bind(Uuid::parse_str(&claims.user_id).ok())
        .bind(studio_uuid)
        .bind(&body.slug)
        .bind(&body.rendering_intent)
        .bind(&body.face_requirements)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "preset": preset })))
}

/// PUT /api/print/presets/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePresetDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE print_presets SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref icon) = body.icon {
        sqlx::query("UPDATE print_presets SET icon = $1, updated_at = NOW() WHERE id = $2")
            .bind(icon)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref printer_type) = body.printer_type {
        sqlx::query("UPDATE print_presets SET printer_type = $1, updated_at = NOW() WHERE id = $2")
            .bind(printer_type)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(sublimation) = body.sublimation {
        sqlx::query("UPDATE print_presets SET sublimation = $1, updated_at = NOW() WHERE id = $2")
            .bind(sublimation)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref paper_size) = body.paper_size {
        sqlx::query("UPDATE print_presets SET paper_size = $1, updated_at = NOW() WHERE id = $2")
            .bind(paper_size)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref media_type_opt) = body.media_type {
        sqlx::query("UPDATE print_presets SET media_type = $1, updated_at = NOW() WHERE id = $2")
            .bind(media_type_opt.as_deref())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref quality) = body.quality {
        sqlx::query("UPDATE print_presets SET quality = $1, updated_at = NOW() WHERE id = $2")
            .bind(quality)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref fit_mode) = body.fit_mode {
        sqlx::query("UPDATE print_presets SET fit_mode = $1, updated_at = NOW() WHERE id = $2")
            .bind(fit_mode)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(borderless) = body.borderless {
        sqlx::query("UPDATE print_presets SET borderless = $1, updated_at = NOW() WHERE id = $2")
            .bind(borderless)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref color_mode) = body.color_mode {
        sqlx::query("UPDATE print_presets SET color_mode = $1, updated_at = NOW() WHERE id = $2")
            .bind(color_mode)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(duplex) = body.duplex {
        sqlx::query("UPDATE print_presets SET duplex = $1, updated_at = NOW() WHERE id = $2")
            .bind(duplex)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(mirror) = body.mirror {
        sqlx::query("UPDATE print_presets SET mirror = $1, updated_at = NOW() WHERE id = $2")
            .bind(mirror)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(price) = body.price {
        sqlx::query("UPDATE print_presets SET price = $1, updated_at = NOW() WHERE id = $2")
            .bind(price)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(sort_order) = body.sort_order {
        sqlx::query("UPDATE print_presets SET sort_order = $1, updated_at = NOW() WHERE id = $2")
            .bind(sort_order)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(is_active) = body.is_active {
        sqlx::query("UPDATE print_presets SET is_active = $1, updated_at = NOW() WHERE id = $2")
            .bind(is_active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref studio_opt) = body.studio_id {
        let uuid = studio_opt
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query("UPDATE print_presets SET studio_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(uuid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref slug) = body.slug {
        sqlx::query("UPDATE print_presets SET slug = $1, updated_at = NOW() WHERE id = $2")
            .bind(slug)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref rendering_intent) = body.rendering_intent {
        sqlx::query(
            "UPDATE print_presets SET rendering_intent = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(rendering_intent)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref face_requirements) = body.face_requirements {
        sqlx::query(
            "UPDATE print_presets SET face_requirements = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(face_requirements)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let sql = format!("SELECT {PRINT_PRESET_COLUMNS} FROM print_presets WHERE id = $1");
    let preset = sqlx::query_as::<_, PrintPresetRow>(&sql)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Пресет не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "preset": preset })))
}

/// DELETE /api/print/presets/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query(
        "UPDATE print_presets SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Пресет не найден: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}
