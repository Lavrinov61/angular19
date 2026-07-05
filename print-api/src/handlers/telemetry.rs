use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::models::telemetry::*;

/// GET /api/print/telemetry — current printer status
pub async fn current(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<TelemetryQuery>,
) -> Result<Json<Value>> {
    let studio_id = q.studio_id.as_deref().or(claims.studio_id.as_deref());

    let telemetry = if let Some(sid) = studio_id {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query_as::<_, TelemetryRow>(
            "SELECT * FROM printer_current_status WHERE studio_id = $1",
        )
        .bind(studio_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, TelemetryRow>("SELECT * FROM printer_current_status")
            .fetch_all(&state.db)
            .await?
    };

    Ok(Json(json!({ "success": true, "telemetry": telemetry })))
}

/// GET /api/print/telemetry/:printerId/history
pub async fn history(
    State(state): State<AppState>,
    Path(printer_id): Path<Uuid>,
    Query(q): Query<TelemetryHistoryQuery>,
) -> Result<Json<Value>> {
    let limit = q.limit.unwrap_or(100).min(500);

    let history = sqlx::query_as::<_, TelemetryRow>(
        r#"SELECT pt.*, p.name AS printer_name, p.printer_type, p.cups_printer_name,
                  bd.name AS bridge_name, bd.is_online AS bridge_online, bd.agent_type
           FROM printer_telemetry pt
           JOIN printers p ON p.id = pt.printer_id
           LEFT JOIN bridge_devices bd ON bd.id = pt.bridge_device_id
           WHERE pt.printer_id = $1
           ORDER BY pt.collected_at DESC
           LIMIT $2"#,
    )
    .bind(printer_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "history": history })))
}
