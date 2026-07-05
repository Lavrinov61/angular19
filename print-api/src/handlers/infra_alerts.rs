use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::agent::*;

fn require_infra(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "infra:manage") {
        return Err(AppError::forbidden("Недостаточно прав (infra:manage)"));
    }
    Ok(())
}

/// GET /api/infra/alerts
pub async fn list(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<AlertListQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let limit = q.limit.unwrap_or(50).min(200);
    let unresolved = q.unresolved.unwrap_or(true);

    let alerts = sqlx::query_as::<_, InfraAlertRow>(
        r#"SELECT ia.*, s.name AS studio_name, a.name AS agent_name
           FROM infra_alerts ia
           LEFT JOIN studios s ON s.id = ia.studio_id
           LEFT JOIN agents a ON a.id = ia.agent_id
           WHERE ($1::uuid IS NULL OR ia.studio_id = $1)
             AND ($2::text IS NULL OR ia.severity = $2)
             AND (NOT $3 OR ia.resolved_at IS NULL)
           ORDER BY ia.created_at DESC
           LIMIT $4"#,
    )
    .bind(q.studio_id.as_ref().and_then(|s| Uuid::parse_str(s).ok()))
    .bind(&q.severity)
    .bind(unresolved)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "alerts": alerts })))
}

/// POST /api/infra/alerts/:id/acknowledge
pub async fn acknowledge(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<i64>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let user_uuid = Uuid::parse_str(&claims.user_id).ok();

    let result = sqlx::query(
        r#"UPDATE infra_alerts
           SET is_acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW()
           WHERE id = $2 AND NOT is_acknowledged"#,
    )
    .bind(user_uuid)
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Алерт не найден или уже подтверждён"));
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/infra/alerts/:id/resolve
pub async fn resolve(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<i64>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let user_uuid = Uuid::parse_str(&claims.user_id).ok();

    let result = sqlx::query(
        r#"UPDATE infra_alerts
           SET resolved_at = NOW(), is_acknowledged = TRUE,
               acknowledged_by = COALESCE(acknowledged_by, $1),
               acknowledged_at = COALESCE(acknowledged_at, NOW())
           WHERE id = $2 AND resolved_at IS NULL"#,
    )
    .bind(user_uuid)
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Алерт не найден или уже закрыт"));
    }

    Ok(Json(json!({ "success": true })))
}

// ── Alert Rules ──

/// GET /api/infra/alert-rules
pub async fn list_rules(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rules = sqlx::query_as::<_, AlertRuleRow>(
        "SELECT * FROM alert_rules ORDER BY agent_type, alert_type",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "rules": rules })))
}

/// POST /api/infra/alert-rules
pub async fn create_rule(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateAlertRuleDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rule = sqlx::query_as::<_, AlertRuleRow>(
        r#"INSERT INTO alert_rules
             (agent_type, alert_type, severity, condition_config, notification_channels, cooldown_minutes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *"#,
    )
    .bind(&body.agent_type)
    .bind(&body.alert_type)
    .bind(&body.severity)
    .bind(&body.condition_config)
    .bind(body.notification_channels.as_ref().unwrap_or(&json!(["telegram"])))
    .bind(body.cooldown_minutes.unwrap_or(30))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "rule": rule })))
}

/// PUT /api/infra/alert-rules/:id
pub async fn update_rule(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAlertRuleDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let mut tx = state.db.begin().await?;

    if let Some(ref severity) = body.severity {
        sqlx::query("UPDATE alert_rules SET severity = $1 WHERE id = $2")
            .bind(severity)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref config) = body.condition_config {
        sqlx::query("UPDATE alert_rules SET condition_config = $1 WHERE id = $2")
            .bind(config)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref channels) = body.notification_channels {
        sqlx::query("UPDATE alert_rules SET notification_channels = $1 WHERE id = $2")
            .bind(channels)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(cooldown) = body.cooldown_minutes {
        sqlx::query("UPDATE alert_rules SET cooldown_minutes = $1 WHERE id = $2")
            .bind(cooldown)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE alert_rules SET is_active = $1 WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let rule = sqlx::query_as::<_, AlertRuleRow>("SELECT * FROM alert_rules WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("Правило не найдено"))?;

    Ok(Json(json!({ "success": true, "rule": rule })))
}

// ── System Telemetry ──

/// GET /api/infra/system-telemetry/:agentId
pub async fn current_telemetry(
    State(state): State<AppState>,
    claims: Claims,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let row = sqlx::query_as::<_, SystemTelemetryRow>(
        r#"SELECT * FROM system_telemetry
           WHERE agent_id = $1
           ORDER BY collected_at DESC
           LIMIT 1"#,
    )
    .bind(agent_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "telemetry": row })))
}

/// GET /api/infra/system-telemetry/:agentId/history
pub async fn telemetry_history(
    State(state): State<AppState>,
    claims: Claims,
    Path(agent_id): Path<Uuid>,
    Query(q): Query<TelemetryHistoryQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let hours = q.hours.unwrap_or(24);
    let limit = q.limit.unwrap_or(200).min(1000);

    let rows = sqlx::query_as::<_, SystemTelemetryRow>(
        r#"SELECT * FROM system_telemetry
           WHERE agent_id = $1 AND collected_at > NOW() - make_interval(hours => $2::int)
           ORDER BY collected_at DESC
           LIMIT $3"#,
    )
    .bind(agent_id)
    .bind(hours as i32)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "history": rows })))
}

// ── Guard: Security Events & CDR Stats ──

/// GET /api/infra/security-events?studio_id=&event_type=&limit=
pub async fn security_events(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<SecurityEventsQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let limit = q.limit.unwrap_or(50).min(500);

    let rows = sqlx::query_as::<_, SecurityEventRow>(
        r#"SELECT se.*, a.name AS agent_name
           FROM security_events se
           LEFT JOIN agents a ON a.id = se.agent_id
           WHERE ($1::uuid IS NULL OR se.studio_id = $1)
             AND ($2::text IS NULL OR se.event_type = $2)
           ORDER BY se.created_at DESC
           LIMIT $3"#,
    )
    .bind(q.studio_id.as_ref().and_then(|s| Uuid::parse_str(s).ok()))
    .bind(&q.event_type)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "events": rows })))
}

/// GET /api/infra/cdr-stats?studio_id=&from=&to=
pub async fn cdr_stats(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<CdrStatsQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rows = sqlx::query_as::<_, CdrStatsRow>(
        r#"SELECT cs.*, a.name AS agent_name
           FROM cdr_stats cs
           LEFT JOIN agents a ON a.id = cs.agent_id
           WHERE ($1::uuid IS NULL OR cs.studio_id = $1)
             AND ($2::date IS NULL OR cs.date >= $2)
             AND ($3::date IS NULL OR cs.date <= $3)
           ORDER BY cs.date DESC
           LIMIT 100"#,
    )
    .bind(q.studio_id.as_ref().and_then(|s| Uuid::parse_str(s).ok()))
    .bind(q.from)
    .bind(q.to)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "stats": rows })))
}
