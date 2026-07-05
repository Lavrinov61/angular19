use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::document_template::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/document-templates — active templates
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<DocumentTemplateQuery>,
) -> Result<Json<Value>> {
    let mut conditions = vec!["is_active = TRUE".to_string()];
    let mut params: Vec<String> = Vec::new();

    if let Some(ref cat) = q.category {
        params.push(cat.clone());
        conditions.push(format!("category = ${}", params.len()));
    }
    if let Some(ref cc) = q.country_code {
        params.push(cc.clone());
        conditions.push(format!("country_code = ${}", params.len()));
    }

    let where_clause = conditions.join(" AND ");
    let sql =
        format!("SELECT * FROM document_templates WHERE {where_clause} ORDER BY sort_order, name");

    let mut query = sqlx::query_as::<_, DocumentTemplateRow>(&sql);
    for p in &params {
        query = query.bind(p);
    }

    let templates = query.fetch_all(&state.db).await?;
    Ok(Json(json!({ "success": true, "templates": templates })))
}

/// GET /api/print/document-templates/slug/:slug
pub async fn get_by_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    let template = sqlx::query_as::<_, DocumentTemplateRow>(
        "SELECT * FROM document_templates WHERE slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Шаблон не найден: {slug}")))?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// POST /api/print/document-templates
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateDocumentTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.slug.is_empty() || body.name.is_empty() || body.category.is_empty() {
        return Err(AppError::bad_request("slug, name и category обязательны"));
    }
    if body.photo_width_mm <= 0.0 || body.photo_height_mm <= 0.0 {
        return Err(AppError::bad_request(
            "photo_width_mm и photo_height_mm должны быть > 0",
        ));
    }

    let template = sqlx::query_as::<_, DocumentTemplateRow>(
        r#"INSERT INTO document_templates (
             slug, name, category, country_code,
             photo_width_mm, photo_height_mm,
             head_height_min_mm, head_height_max_mm, eye_line_from_bottom_mm,
             background_color, default_media_size,
             photos_per_sheet, layout_rows, layout_cols, cut_margin_mm,
             validation_rules, overlay_svg, sort_order
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18)
           RETURNING *"#,
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.category)
    .bind(body.country_code.as_deref().unwrap_or("RU"))
    .bind(body.photo_width_mm)
    .bind(body.photo_height_mm)
    .bind(body.head_height_min_mm)
    .bind(body.head_height_max_mm)
    .bind(body.eye_line_from_bottom_mm)
    .bind(body.background_color.as_deref().unwrap_or("#FFFFFF"))
    .bind(body.default_media_size.as_deref().unwrap_or("10x15"))
    .bind(body.photos_per_sheet.unwrap_or(1))
    .bind(body.layout_rows.unwrap_or(1))
    .bind(body.layout_cols.unwrap_or(1))
    .bind(body.cut_margin_mm.unwrap_or(0.0))
    .bind(body.validation_rules.as_ref().unwrap_or(&json!({})))
    .bind(&body.overlay_svg)
    .bind(body.sort_order.unwrap_or(0))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// PUT /api/print/document-templates/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDocumentTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref v) = body.name {
        sqlx::query("UPDATE document_templates SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref v) = body.category {
        sqlx::query(
            "UPDATE document_templates SET category = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.country_code {
        sqlx::query(
            "UPDATE document_templates SET country_code = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.photo_width_mm {
        sqlx::query(
            "UPDATE document_templates SET photo_width_mm = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.photo_height_mm {
        sqlx::query(
            "UPDATE document_templates SET photo_height_mm = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.head_height_min_mm {
        sqlx::query("UPDATE document_templates SET head_height_min_mm = $1, updated_at = NOW() WHERE id = $2")
            .bind(*v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(ref v) = body.head_height_max_mm {
        sqlx::query("UPDATE document_templates SET head_height_max_mm = $1, updated_at = NOW() WHERE id = $2")
            .bind(*v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(ref v) = body.eye_line_from_bottom_mm {
        sqlx::query("UPDATE document_templates SET eye_line_from_bottom_mm = $1, updated_at = NOW() WHERE id = $2")
            .bind(*v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(ref v) = body.background_color {
        sqlx::query(
            "UPDATE document_templates SET background_color = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.default_media_size {
        sqlx::query("UPDATE document_templates SET default_media_size = $1, updated_at = NOW() WHERE id = $2")
            .bind(v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(v) = body.photos_per_sheet {
        sqlx::query(
            "UPDATE document_templates SET photos_per_sheet = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.layout_rows {
        sqlx::query(
            "UPDATE document_templates SET layout_rows = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.layout_cols {
        sqlx::query(
            "UPDATE document_templates SET layout_cols = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.cut_margin_mm {
        sqlx::query(
            "UPDATE document_templates SET cut_margin_mm = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.validation_rules {
        sqlx::query("UPDATE document_templates SET validation_rules = $1::jsonb, updated_at = NOW() WHERE id = $2")
            .bind(v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(ref v) = body.overlay_svg {
        sqlx::query(
            "UPDATE document_templates SET overlay_svg = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v.as_deref())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.is_active {
        sqlx::query(
            "UPDATE document_templates SET is_active = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.sort_order {
        sqlx::query(
            "UPDATE document_templates SET sort_order = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let template =
        sqlx::query_as::<_, DocumentTemplateRow>("SELECT * FROM document_templates WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found(format!("Шаблон не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// DELETE /api/print/document-templates/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query(
        "UPDATE document_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Шаблон не найден: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}
