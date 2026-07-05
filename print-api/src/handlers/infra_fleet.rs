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

/// GET /api/infra/fleet/overview
pub async fn overview(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let fleet = sqlx::query_as::<_, FleetStatusRow>(
        "SELECT * FROM agent_fleet_status ORDER BY agent_type, current_version",
    )
    .fetch_all(&state.db)
    .await?;

    let totals = sqlx::query_as::<_, TotalsRow>(
        r#"SELECT
             COUNT(*) AS total_agents,
             COUNT(*) FILTER (WHERE is_online) AS online_agents,
             COUNT(DISTINCT studio_id) AS total_locations
           FROM agents WHERE is_active"#,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "fleet": fleet,
        "totals": {
            "total_agents": totals.total_agents,
            "online_agents": totals.online_agents,
            "total_locations": totals.total_locations,
        }
    })))
}

#[derive(Debug, sqlx::FromRow)]
struct TotalsRow {
    total_agents: Option<i64>,
    online_agents: Option<i64>,
    total_locations: Option<i64>,
}

/// GET /api/infra/fleet/health
pub async fn health(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let critical_alerts = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM infra_alerts
           WHERE resolved_at IS NULL AND severity = 'critical'"#,
    )
    .fetch_one(&state.db)
    .await?;

    let stale_agents = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM agents
           WHERE is_active AND is_online
             AND last_heartbeat_at < NOW() - INTERVAL '3 minutes'"#,
    )
    .fetch_one(&state.db)
    .await?;

    let offline_agents = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM agents
           WHERE is_active AND NOT is_online"#,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "health": {
            "critical_alerts": critical_alerts,
            "stale_agents": stale_agents,
            "offline_agents": offline_agents,
            "status": if critical_alerts > 0 { "critical" }
                      else if stale_agents > 0 { "degraded" }
                      else { "healthy" },
        }
    })))
}

/// GET /api/infra/fleet/versions
pub async fn versions(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let versions = sqlx::query_as::<_, FleetStatusRow>(
        "SELECT * FROM agent_fleet_status ORDER BY agent_type, current_version DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "versions": versions })))
}

// ── Releases ──

/// GET /api/infra/releases
pub async fn list_releases(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<ReleaseListQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let releases = sqlx::query_as::<_, AgentReleaseRow>(
        r#"SELECT * FROM agent_releases
           WHERE ($1::text IS NULL OR agent_type = $1)
             AND ($2::text IS NULL OR platform = $2)
             AND ($3::bool IS NULL OR is_stable = $3)
           ORDER BY released_at DESC
           LIMIT 100"#,
    )
    .bind(&q.agent_type)
    .bind(&q.platform)
    .bind(q.is_stable)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "releases": releases })))
}

/// POST /api/infra/releases
pub async fn create_release(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateReleaseDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let user_uuid = Uuid::parse_str(&claims.user_id).ok();

    let release = sqlx::query_as::<_, AgentReleaseRow>(
        r#"INSERT INTO agent_releases
             (agent_type, version, platform, artifact_url, artifact_hash_sha256,
              artifact_size_bytes, release_notes, is_stable, min_os_version, released_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *"#,
    )
    .bind(&body.agent_type)
    .bind(&body.version)
    .bind(&body.platform)
    .bind(&body.artifact_url)
    .bind(&body.artifact_hash_sha256)
    .bind(body.artifact_size_bytes)
    .bind(&body.release_notes)
    .bind(body.is_stable.unwrap_or(false))
    .bind(&body.min_os_version)
    .bind(user_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e
            && db_err.constraint() == Some("agent_releases_agent_type_version_platform_key")
        {
            return AppError::conflict("Такой релиз уже существует");
        }
        AppError::from(e)
    })?;

    Ok(Json(json!({ "success": true, "release": release })))
}

/// GET /api/infra/updates
pub async fn list_updates(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let updates = sqlx::query_as::<_, UpdateCommandRow>(
        "SELECT * FROM agent_update_commands ORDER BY initiated_at DESC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "updates": updates })))
}

// ── Locations ──

/// GET /api/infra/locations
pub async fn list_locations(State(state): State<AppState>, claims: Claims) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let locations = sqlx::query_as::<_, LocationRow>(
        r#"SELECT
             s.id, s.name, s.address, s.timezone, s.region, s.city, s.is_infra_enabled,
             COUNT(a.id) AS agent_count,
             COUNT(a.id) FILTER (WHERE a.is_online) AS online_count,
             (SELECT COUNT(*) FROM infra_alerts ia WHERE ia.studio_id = s.id AND ia.resolved_at IS NULL) AS alert_count
           FROM studios s
           LEFT JOIN agents a ON a.studio_id = s.id AND a.is_active
           GROUP BY s.id
           ORDER BY s.name"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "locations": locations })))
}

/// GET /api/infra/locations/:id
pub async fn get_location(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let location = sqlx::query_as::<_, LocationRow>(
        r#"SELECT
             s.id, s.name, s.address, s.timezone, s.region, s.city, s.is_infra_enabled,
             COUNT(a.id) AS agent_count,
             COUNT(a.id) FILTER (WHERE a.is_online) AS online_count,
             0::bigint AS alert_count
           FROM studios s
           LEFT JOIN agents a ON a.studio_id = s.id AND a.is_active
           WHERE s.id = $1
           GROUP BY s.id"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Точка не найдена"))?;

    let agents = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name
           FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.studio_id = $1 AND a.is_active
           ORDER BY a.agent_type"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let alerts = sqlx::query_as::<_, InfraAlertRow>(
        r#"SELECT ia.*, s.name AS studio_name, a.name AS agent_name
           FROM infra_alerts ia
           LEFT JOIN studios s ON s.id = ia.studio_id
           LEFT JOIN agents a ON a.id = ia.agent_id
           WHERE ia.studio_id = $1 AND ia.resolved_at IS NULL
           ORDER BY ia.created_at DESC
           LIMIT 20"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "location": location,
        "agents": agents,
        "alerts": alerts,
    })))
}
