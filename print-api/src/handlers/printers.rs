use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::printer::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/printers — active printers (auto-filters by studio from JWT if no explicit studio_id)
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<PrinterListQuery>,
    claims: Claims,
) -> Result<Json<Value>> {
    // Use explicit query param, fallback to studio from active POS shift (JWT)
    let studio_filter = q.studio_id.as_deref().or(claims.studio_id.as_deref());

    // Show all active printers (CUPS printers don't need bridge agent online)
    let printers = if let Some(sid) = studio_filter {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query_as::<_, PrinterRow>(
            r#"SELECT p.* FROM printers p
               WHERE p.is_active = TRUE AND (p.studio_id = $1 OR p.studio_id IS NULL)
               ORDER BY p.printer_type, p.name"#,
        )
        .bind(studio_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, PrinterRow>(
            r#"SELECT p.* FROM printers p
               WHERE p.is_active = TRUE
               ORDER BY p.printer_type, p.name"#,
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "printers": printers })))
}

/// GET /api/print/printers/all — all printers with studio name (catalog:manage)
pub async fn list_all(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let printers = sqlx::query_as::<_, PrinterWithStudioRow>(
        r#"SELECT p.*, s.name AS studio_name
           FROM printers p
           LEFT JOIN studios s ON s.id = p.studio_id
           ORDER BY p.printer_type, p.name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "printers": printers })))
}

/// GET /api/print/printers/status — printer statuses from MQTT telemetry
/// Returns BridgePrinterStatus-compatible format for Angular frontend
pub async fn status(State(state): State<AppState>) -> Result<Json<Value>> {
    let rows = sqlx::query_as::<_, BridgePrinterStatusRow>(
        r#"SELECT
             pcs.printer_name,
             CASE WHEN pcs.collected_at > NOW() - INTERVAL '5 minutes' THEN pcs.is_online ELSE FALSE END AS online,
             CASE WHEN pcs.collected_at > NOW() - INTERVAL '5 minutes' THEN COALESCE(pcs.state, 'unknown') ELSE 'offline' END AS state,
             CASE WHEN pcs.collected_at > NOW() - INTERVAL '5 minutes' THEN COALESCE(pcs.state_reasons, ARRAY[]::text[]) ELSE ARRAY['offline']::text[] END AS state_reasons,
             COALESCE(jc.cnt, 0) AS jobs_count
           FROM printer_current_status pcs
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int4 AS cnt
             FROM print_jobs pj
             WHERE pj.printer_id = pcs.printer_id
               AND pj.status IN ('queued', 'converting', 'sending', 'processing', 'printing', 'splitting', 'finishing')
           ) jc ON TRUE
           ORDER BY pcs.printer_name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "printers": rows })))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct BridgePrinterStatusRow {
    printer_name: Option<String>,
    online: bool,
    state: String,
    state_reasons: Vec<String>,
    jobs_count: i32,
}

/// POST /api/print/printers — create printer (catalog:manage)
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreatePrinterDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.name.is_empty() {
        return Err(AppError::bad_request("name обязателен"));
    }
    if !["photo", "document", "mfp"].contains(&body.printer_type.as_str()) {
        return Err(AppError::bad_request(
            "printer_type должен быть photo/document/mfp",
        ));
    }
    let studio_uuid = body
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let icc_uuid = body
        .default_icc_profile_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid default_icc_profile_id"))?;

    let printer = sqlx::query_as::<_, PrinterRow>(
        r#"INSERT INTO printers (id, name, printer_type, cups_printer_name,
             default_icc_profile_id, studio_id, capabilities, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7)
           RETURNING *"#,
    )
    .bind(&body.name)
    .bind(&body.printer_type)
    .bind(&body.cups_printer_name)
    .bind(icc_uuid)
    .bind(studio_uuid)
    .bind(&body.capabilities)
    .bind(body.is_active.unwrap_or(true))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "printer": printer })))
}

/// PUT /api/print/printers/:id — update printer (catalog:manage)
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePrinterDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;

    let has_any = body.name.is_some()
        || body.printer_type.is_some()
        || body.cups_printer_name.is_some()
        || body.default_icc_profile_id.is_some()
        || body.capabilities.is_some()
        || body.is_active.is_some()
        || body.studio_id.is_some();

    if !has_any {
        return Err(AppError::bad_request("Нет полей для обновления"));
    }

    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE printers SET name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref pt) = body.printer_type {
        sqlx::query("UPDATE printers SET printer_type = $1 WHERE id = $2")
            .bind(pt)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref cpn_opt) = body.cups_printer_name {
        sqlx::query("UPDATE printers SET cups_printer_name = $1 WHERE id = $2")
            .bind(cpn_opt.as_deref())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref icc_opt) = body.default_icc_profile_id {
        let icc_uuid = icc_opt
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::bad_request("Invalid default_icc_profile_id"))?;
        sqlx::query("UPDATE printers SET default_icc_profile_id = $1 WHERE id = $2")
            .bind(icc_uuid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref caps) = body.capabilities {
        sqlx::query("UPDATE printers SET capabilities = $1::jsonb WHERE id = $2")
            .bind(caps)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE printers SET is_active = $1 WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref sid_opt) = body.studio_id {
        let studio_uuid = sid_opt
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query("UPDATE printers SET studio_id = $1 WHERE id = $2")
            .bind(studio_uuid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let printer = sqlx::query_as::<_, PrinterRow>("SELECT * FROM printers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "printer": printer })))
}

/// POST /api/print/printers/:id/pause — pause printer queue
pub async fn pause_queue(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<PauseQueueDto>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let printer = sqlx::query_as::<_, PrinterRow>("SELECT * FROM printers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {id}")))?;

    if printer.queue_paused.unwrap_or(false) {
        return Err(AppError::conflict("Очередь принтера уже приостановлена"));
    }

    sqlx::query(
        r#"UPDATE printers SET
             queue_paused = TRUE,
             queue_paused_at = NOW(),
             queue_paused_by = $2,
             queue_paused_reason = $3
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(user_id)
    .bind(&body.reason)
    .execute(&state.db)
    .await?;

    // Insert pause log
    sqlx::query(
        r#"INSERT INTO printer_pause_log (printer_id, action, performed_by, reason)
           VALUES ($1, 'pause', $2, $3)"#,
    )
    .bind(id)
    .bind(user_id)
    .bind(&body.reason)
    .execute(&state.db)
    .await
    .ok(); // non-critical

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "printer_id": id,
        "queue_paused": true,
        "reason": body.reason,
        "studio_id": printer.studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:printer_pause")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/printers/:id/resume — resume printer queue
pub async fn resume_queue(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let printer = sqlx::query_as::<_, PrinterRow>("SELECT * FROM printers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {id}")))?;

    if !printer.queue_paused.unwrap_or(false) {
        return Err(AppError::conflict("Очередь принтера не приостановлена"));
    }

    sqlx::query(
        r#"UPDATE printers SET
             queue_paused = FALSE,
             queue_paused_at = NULL,
             queue_paused_by = NULL,
             queue_paused_reason = NULL
           WHERE id = $1"#,
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    // Insert resume log
    sqlx::query(
        r#"INSERT INTO printer_pause_log (printer_id, action, performed_by)
           VALUES ($1, 'resume', $2)"#,
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await
    .ok(); // non-critical

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "printer_id": id,
        "queue_paused": false,
        "studio_id": printer.studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:printer_pause")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// DELETE /api/print/printers/:id (catalog:manage)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query("DELETE FROM printers WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Принтер не найден: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}
