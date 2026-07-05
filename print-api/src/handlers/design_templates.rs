use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::design_template::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/design-templates — active templates
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<DesignTemplateQuery>,
) -> Result<Json<Value>> {
    let templates = match (&q.service_id, &q.category) {
        (Some(sid), _) => {
            let service_uuid =
                Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid service_id"))?;
            sqlx::query_as::<_, DesignTemplateRow>(
                r#"SELECT dt.*, sc.name AS service_name
                   FROM design_templates dt
                   LEFT JOIN service_catalog sc ON sc.id = dt.service_id
                   WHERE dt.is_active AND dt.service_id = $1
                   ORDER BY dt.sort_order, dt.name"#,
            )
            .bind(service_uuid)
            .fetch_all(&state.db)
            .await?
        }
        (_, Some(cat)) => {
            sqlx::query_as::<_, DesignTemplateRow>(
                r#"SELECT dt.*, sc.name AS service_name
                   FROM design_templates dt
                   LEFT JOIN service_catalog sc ON sc.id = dt.service_id
                   WHERE dt.is_active AND dt.category = $1
                   ORDER BY dt.sort_order, dt.name"#,
            )
            .bind(cat)
            .fetch_all(&state.db)
            .await?
        }
        _ => {
            sqlx::query_as::<_, DesignTemplateRow>(
                r#"SELECT dt.*, sc.name AS service_name
                   FROM design_templates dt
                   LEFT JOIN service_catalog sc ON sc.id = dt.service_id
                   WHERE dt.is_active
                   ORDER BY dt.sort_order, dt.name"#,
            )
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(Json(json!({ "success": true, "templates": templates })))
}

/// POST /api/print/design-templates
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateDesignTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.name.is_empty() || body.category.is_empty() {
        return Err(AppError::bad_request("name и category обязательны"));
    }
    if body.width_mm <= 0.0 || body.height_mm <= 0.0 {
        return Err(AppError::bad_request(
            "width_mm и height_mm должны быть > 0",
        ));
    }

    let service_uuid = body
        .service_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid service_id"))?;

    let template = sqlx::query_as::<_, DesignTemplateRow>(
        r#"INSERT INTO design_templates (service_id, name, category, width_mm, height_mm,
             canvas_json, thumbnail_url, editable_fields, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           RETURNING *, NULL::text AS service_name"#,
    )
    .bind(service_uuid)
    .bind(&body.name)
    .bind(&body.category)
    .bind(body.width_mm)
    .bind(body.height_mm)
    .bind(&body.canvas_json)
    .bind(&body.thumbnail_url)
    .bind(body.editable_fields.as_ref().unwrap_or(&json!([])))
    .bind(body.sort_order.unwrap_or(0))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// PUT /api/print/design-templates/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDesignTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref sid_opt) = body.service_id {
        let uuid = sid_opt
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::bad_request("Invalid service_id"))?;
        sqlx::query(
            "UPDATE design_templates SET service_id = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(uuid)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.name {
        sqlx::query("UPDATE design_templates SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref v) = body.category {
        sqlx::query("UPDATE design_templates SET category = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.width_mm {
        sqlx::query("UPDATE design_templates SET width_mm = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.height_mm {
        sqlx::query("UPDATE design_templates SET height_mm = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref v) = body.canvas_json {
        sqlx::query(
            "UPDATE design_templates SET canvas_json = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v.as_deref())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.thumbnail_url {
        sqlx::query(
            "UPDATE design_templates SET thumbnail_url = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v.as_deref())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.editable_fields {
        sqlx::query("UPDATE design_templates SET editable_fields = $1::jsonb, updated_at = NOW() WHERE id = $2")
            .bind(v).bind(id).execute(&mut *tx).await?;
    }
    if let Some(v) = body.is_active {
        sqlx::query("UPDATE design_templates SET is_active = $1, updated_at = NOW() WHERE id = $2")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.sort_order {
        sqlx::query(
            "UPDATE design_templates SET sort_order = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let template = sqlx::query_as::<_, DesignTemplateRow>(
        r#"SELECT dt.*, sc.name AS service_name
           FROM design_templates dt
           LEFT JOIN service_catalog sc ON sc.id = dt.service_id
           WHERE dt.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Шаблон дизайна не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// DELETE /api/print/design-templates/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query(
        "UPDATE design_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "Шаблон дизайна не найден: {id}"
        )));
    }

    Ok(Json(json!({ "success": true })))
}
