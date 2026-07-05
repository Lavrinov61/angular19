use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::job_template::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/job-templates — list active templates with optional filters
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListTemplatesQuery>,
) -> Result<Json<Value>> {
    let printer_type = q.printer_type.as_deref();
    let studio_uuid = q
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let templates = sqlx::query_as::<_, JobTemplateRow>(
        r#"SELECT * FROM job_templates
           WHERE is_active
             AND ($1::text IS NULL OR printer_type = $1)
             AND ($2::uuid IS NULL OR studio_id = $2 OR studio_id IS NULL)
             AND ($3::bool IS NULL OR is_global = $3)
           ORDER BY sort_order, name"#,
    )
    .bind(printer_type)
    .bind(studio_uuid)
    .bind(q.is_global)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "templates": templates })))
}

/// POST /api/print/job-templates — create a new template
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;

    if body.name.is_empty() || body.printer_type.is_empty() {
        return Err(AppError::bad_request("name и printer_type обязательны"));
    }

    let user_id = Uuid::parse_str(&claims.user_id).ok();
    let printer_uuid = body
        .printer_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid printer_id"))?;
    let studio_uuid = body
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let template = sqlx::query_as::<_, JobTemplateRow>(
        r#"INSERT INTO job_templates
             (name, description, settings, printer_type, printer_id, studio_id, is_global, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *"#,
    )
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.settings)
    .bind(&body.printer_type)
    .bind(printer_uuid)
    .bind(studio_uuid)
    .bind(body.is_global.unwrap_or(false))
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// PUT /api/print/job-templates/:id — update a template
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTemplateDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;

    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE job_templates SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref description) = body.description {
        sqlx::query("UPDATE job_templates SET description = $1, updated_at = NOW() WHERE id = $2")
            .bind(description)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref settings) = body.settings {
        sqlx::query("UPDATE job_templates SET settings = $1, updated_at = NOW() WHERE id = $2")
            .bind(settings)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref printer_type) = body.printer_type {
        sqlx::query("UPDATE job_templates SET printer_type = $1, updated_at = NOW() WHERE id = $2")
            .bind(printer_type)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(is_global) = body.is_global {
        sqlx::query("UPDATE job_templates SET is_global = $1, updated_at = NOW() WHERE id = $2")
            .bind(is_global)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let template = sqlx::query_as::<_, JobTemplateRow>("SELECT * FROM job_templates WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Шаблон не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "template": template })))
}

/// DELETE /api/print/job-templates/:id — soft delete
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;

    let result = sqlx::query(
        "UPDATE job_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Шаблон не найден: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/job-templates/:id/apply — create a print job from template settings
pub async fn apply(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<ApplyTemplateDto>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() {
        return Err(AppError::bad_request("file_url обязателен"));
    }

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    // Fetch template
    let template = sqlx::query_as::<_, JobTemplateRow>(
        "SELECT * FROM job_templates WHERE id = $1 AND is_active",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Шаблон не найден или неактивен"))?;

    let settings = &template.settings;
    let printer_id = template
        .printer_id
        .or_else(|| {
            settings["printer_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
        })
        .ok_or_else(|| AppError::bad_request("В шаблоне не указан printer_id"))?;

    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .ok()
        .flatten()
        .or(template.studio_id);

    let copies = body
        .copies
        .unwrap_or_else(|| settings["copies"].as_i64().unwrap_or(1) as i32);
    let priority = body.priority.unwrap_or(0).clamp(0, 10);

    // Create print job using template settings
    let job_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO print_jobs (
             printer_id, file_url, file_name,
             copies, paper_size, color_mode, quality, duplex,
             orientation, borderless, media_type, fit_mode,
             icc_profile_id,
             created_by, studio_id, status, priority
           ) VALUES (
             $1, $2, $3,
             $4,
             COALESCE($5, 'A4'),
             COALESCE($6, 'color'),
             COALESCE($7, 'normal'),
             COALESCE($8, FALSE),
             COALESCE($9, 'auto'),
             COALESCE($10, FALSE),
             $11,
             COALESCE($12, 'fit'),
             $13,
             $14, $15, 'queued', $16
           ) RETURNING id"#,
    )
    .bind(printer_id)
    .bind(&body.file_url)
    .bind(&body.file_name)
    .bind(copies)
    .bind(settings["paper_size"].as_str())
    .bind(settings["color_mode"].as_str())
    .bind(settings["quality"].as_str())
    .bind(settings["duplex"].as_bool())
    .bind(settings["orientation"].as_str())
    .bind(settings["borderless"].as_bool())
    .bind(settings["media_type"].as_str())
    .bind(settings["fit_mode"].as_str())
    .bind(
        settings["icc_profile_id"]
            .as_str()
            .and_then(|s| Uuid::parse_str(s).ok()),
    )
    .bind(user_id)
    .bind(studio_uuid)
    .bind(priority)
    .fetch_one(&state.db)
    .await?;

    // Update template usage stats
    sqlx::query(
        "UPDATE job_templates SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = $1"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    // Redis PUBLISH for Socket.IO relay
    let redis_payload = serde_json::json!({
        "job_id": job_id,
        "template_id": id,
        "template_name": template.name,
        "studio_id": studio_uuid,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:template_applied")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(
        json!({ "success": true, "job_id": job_id, "template_id": id }),
    ))
}
