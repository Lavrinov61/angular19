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

// ── Rollout Plans ──

/// POST /api/infra/releases/:id/rollout — start staged rollout for a release
pub async fn start_rollout(
    State(state): State<AppState>,
    claims: Claims,
    Path(release_id): Path<Uuid>,
    Json(body): Json<StartRolloutDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let release =
        sqlx::query_as::<_, AgentReleaseRow>("SELECT * FROM agent_releases WHERE id = $1")
            .bind(release_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("Релиз не найден"))?;

    // Count eligible agents (online, active, matching type, different version)
    let total_agents: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM agents
           WHERE is_active AND agent_type = $1
             AND (current_version IS NULL OR current_version != $2)"#,
    )
    .bind(&release.agent_type)
    .bind(&release.version)
    .fetch_one(&state.db)
    .await?;

    if total_agents == 0 {
        return Err(AppError::bad_request("Нет агентов для обновления"));
    }

    let user_uuid = Uuid::parse_str(&claims.user_id).ok();
    let strategy = body.strategy.as_deref().unwrap_or("canary");

    let rollout = sqlx::query_as::<_, RolloutPlanRow>(
        r#"INSERT INTO rollout_plans
             (release_id, strategy, target_agent_type, target_platform,
              total_agents, canary_count, canary_wait_minutes,
              batch_percent, batch_wait_minutes, initiated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *"#,
    )
    .bind(release_id)
    .bind(strategy)
    .bind(&release.agent_type)
    .bind(&release.platform)
    .bind(total_agents as i32)
    .bind(body.canary_count.unwrap_or(1))
    .bind(body.canary_wait_minutes.unwrap_or(15))
    .bind(body.batch_percent.unwrap_or(10))
    .bind(body.batch_wait_minutes.unwrap_or(30))
    .bind(user_uuid)
    .fetch_one(&state.db)
    .await?;

    // Immediately start canary phase
    let rollout = advance_rollout_phase(&state, rollout).await?;

    Ok(Json(json!({ "success": true, "rollout": rollout })))
}

/// GET /api/infra/rollouts — list rollout plans
pub async fn list_rollouts(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<RolloutListQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rollouts = sqlx::query_as::<_, RolloutPlanRow>(
        r#"SELECT * FROM rollout_plans
           WHERE ($1::text IS NULL OR status = $1)
           ORDER BY created_at DESC
           LIMIT 50"#,
    )
    .bind(&q.status)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "rollouts": rollouts })))
}

/// GET /api/infra/rollouts/:id — get rollout plan with update commands
pub async fn get_rollout(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rollout = sqlx::query_as::<_, RolloutPlanRow>("SELECT * FROM rollout_plans WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("Rollout не найден"))?;

    let updates = sqlx::query_as::<_, UpdateCommandRow>(
        r#"SELECT auc.* FROM agent_update_commands auc
           WHERE auc.rollout_id = $1
           ORDER BY auc.initiated_at"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "rollout": rollout,
        "updates": updates,
    })))
}

/// POST /api/infra/rollouts/:id/advance — manually advance to next phase
pub async fn advance_rollout(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let rollout = sqlx::query_as::<_, RolloutPlanRow>(
        "SELECT * FROM rollout_plans WHERE id = $1 AND status = 'in_progress'",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Активный rollout не найден"))?;

    let rollout = advance_rollout_phase(&state, rollout).await?;

    Ok(Json(json!({ "success": true, "rollout": rollout })))
}

/// POST /api/infra/rollouts/:id/pause — pause rollout (stop advancing)
pub async fn pause_rollout(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    sqlx::query(
        "UPDATE rollout_plans SET status = 'paused' WHERE id = $1 AND status = 'in_progress'",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true })))
}

/// POST /api/infra/rollouts/:id/cancel — cancel rollout
pub async fn cancel_rollout(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    sqlx::query(
        "UPDATE rollout_plans SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status IN ('pending','in_progress','paused')"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true })))
}

// ── Batch Update ──

/// POST /api/infra/fleet/update — update all agents of a type to a release
pub async fn fleet_update(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<FleetUpdateDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let release_uuid = Uuid::parse_str(&body.release_id)
        .map_err(|_| AppError::bad_request("Некорректный release_id"))?;

    let release =
        sqlx::query_as::<_, AgentReleaseRow>("SELECT * FROM agent_releases WHERE id = $1")
            .bind(release_uuid)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("Релиз не найден"))?;

    // Find all eligible agents
    let agents = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.is_active AND a.agent_type = $1
             AND (a.current_version IS NULL OR a.current_version != $2)
             AND a.is_online"#,
    )
    .bind(&release.agent_type)
    .bind(&release.version)
    .fetch_all(&state.db)
    .await?;

    if agents.is_empty() {
        return Err(AppError::bad_request("Нет онлайн-агентов для обновления"));
    }

    let user_uuid = Uuid::parse_str(&claims.user_id).ok();
    let force = body.force.unwrap_or(false);
    let mut created_commands: Vec<UpdateCommandRow> = Vec::new();

    for agent in &agents {
        let cmd = sqlx::query_as::<_, UpdateCommandRow>(
            r#"INSERT INTO agent_update_commands (agent_id, release_id, previous_version, initiated_by)
               VALUES ($1, $2, $3, $4)
               RETURNING *"#,
        )
        .bind(agent.id)
        .bind(release_uuid)
        .bind(&agent.current_version)
        .bind(user_uuid)
        .fetch_one(&state.db)
        .await?;

        // Set target_version on agent
        sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
            .bind(&release.version)
            .bind(agent.id)
            .execute(&state.db)
            .await?;

        // Send MQTT update command
        let topic = format!(
            "svoefoto/{}/{}/commands/update",
            agent.studio_id, agent.agent_type
        );
        let client_guard = state.mqtt_client.read().await;
        if let Some(ref client) = *client_guard {
            let payload = serde_json::to_vec(&json!({
                "command_id": cmd.id.to_string(),
                "target_version": release.version,
                "artifact_url": release.artifact_url,
                "artifact_hash_sha256": release.artifact_hash_sha256,
                "artifact_size_bytes": release.artifact_size_bytes,
                "force": force,
            }))?;

            let _ = client
                .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
                .await;
        }

        created_commands.push(cmd);
    }

    Ok(Json(json!({
        "success": true,
        "agents_updated": created_commands.len(),
        "update_commands": created_commands,
    })))
}

// ── Rollback ──

/// POST /api/infra/updates/:id/rollback — rollback an update command
pub async fn rollback_update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let cmd =
        sqlx::query_as::<_, UpdateCommandRow>("SELECT * FROM agent_update_commands WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("Команда обновления не найдена"))?;

    if cmd.status != "completed" && cmd.status != "failed" {
        return Err(AppError::bad_request(format!(
            "Откат возможен только из статусов completed/failed, текущий: {}",
            cmd.status
        )));
    }

    let Some(ref prev_version) = cmd.previous_version else {
        return Err(AppError::bad_request("Нет информации о предыдущей версии"));
    };

    // Find the release for the previous version
    let agent = sqlx::query_as::<_, AgentRow>(
        "SELECT a.*, NULL::text AS studio_name FROM agents a WHERE a.id = $1",
    )
    .bind(cmd.agent_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Агент не найден"))?;

    let prev_release = sqlx::query_as::<_, AgentReleaseRow>(
        "SELECT * FROM agent_releases WHERE agent_type = $1 AND version = $2 LIMIT 1",
    )
    .bind(&agent.agent_type)
    .bind(prev_version)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::bad_request(format!(
            "Релиз v{prev_version} не найден. Для отката нужен зарегистрированный релиз"
        ))
    })?;

    // Create a new update command for the rollback
    let user_uuid = Uuid::parse_str(&claims.user_id).ok();
    let rollback_cmd = sqlx::query_as::<_, UpdateCommandRow>(
        r#"INSERT INTO agent_update_commands
             (agent_id, release_id, previous_version, rollback_url, initiated_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *"#,
    )
    .bind(cmd.agent_id)
    .bind(prev_release.id)
    .bind(&agent.current_version)
    .bind(&prev_release.artifact_url)
    .bind(user_uuid)
    .fetch_one(&state.db)
    .await?;

    // Mark the original command as rolled_back
    sqlx::query("UPDATE agent_update_commands SET status = 'rolled_back' WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    // Set target_version to previous
    sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
        .bind(prev_version)
        .bind(cmd.agent_id)
        .execute(&state.db)
        .await?;

    // Send MQTT update command for rollback
    let topic = format!(
        "svoefoto/{}/{}/commands/update",
        agent.studio_id, agent.agent_type
    );
    let client_guard = state.mqtt_client.read().await;
    if let Some(ref client) = *client_guard {
        let payload = serde_json::to_vec(&json!({
            "command_id": rollback_cmd.id.to_string(),
            "target_version": prev_release.version,
            "artifact_url": prev_release.artifact_url,
            "artifact_hash_sha256": prev_release.artifact_hash_sha256,
            "artifact_size_bytes": prev_release.artifact_size_bytes,
            "force": true,
        }))?;

        let _ = client
            .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
            .await;
    }

    Ok(Json(json!({
        "success": true,
        "rollback_command": rollback_cmd,
        "original_command_status": "rolled_back",
    })))
}

// ── Promote release ──

/// POST /api/infra/releases/:id/promote — mark release as stable
pub async fn promote_release(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let result = sqlx::query(
        "UPDATE agent_releases SET is_stable = TRUE, promoted_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Релиз не найден"));
    }

    Ok(Json(json!({ "success": true })))
}

// ── Scheduled update trigger (called by scheduler) ──

/// Check for scheduled updates that are due and trigger them.
#[allow(dead_code)]
pub async fn trigger_scheduled_updates(
    state: &AppState,
) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pending = sqlx::query_as::<_, UpdateCommandRow>(
        r#"SELECT * FROM agent_update_commands
           WHERE status = 'pending'
             AND scheduled_at IS NOT NULL
             AND scheduled_at <= NOW()
           ORDER BY scheduled_at
           LIMIT 20"#,
    )
    .fetch_all(&state.db)
    .await?;

    if pending.is_empty() {
        return Ok(());
    }

    for cmd in &pending {
        let release =
            sqlx::query_as::<_, AgentReleaseRow>("SELECT * FROM agent_releases WHERE id = $1")
                .bind(cmd.release_id)
                .fetch_optional(&state.db)
                .await?;

        let Some(release) = release else { continue };

        let agent = sqlx::query_as::<_, AgentRow>(
            "SELECT a.*, NULL::text AS studio_name FROM agents a WHERE a.id = $1 AND a.is_active AND a.is_online"
        )
        .bind(cmd.agent_id)
        .fetch_optional(&state.db)
        .await?;

        let Some(agent) = agent else {
            // Agent offline — leave pending for next cycle
            continue;
        };

        let topic = format!(
            "svoefoto/{}/{}/commands/update",
            agent.studio_id, agent.agent_type
        );
        let client_guard = state.mqtt_client.read().await;
        if let Some(ref client) = *client_guard {
            let payload = serde_json::to_vec(&json!({
                "command_id": cmd.id.to_string(),
                "target_version": release.version,
                "artifact_url": release.artifact_url,
                "artifact_hash_sha256": release.artifact_hash_sha256,
                "artifact_size_bytes": release.artifact_size_bytes,
                "force": false,
            }))?;

            let _ = client
                .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
                .await;
        }

        // Update target_version
        sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
            .bind(&release.version)
            .bind(cmd.agent_id)
            .execute(&state.db)
            .await?;

        tracing::info!(cmd_id = %cmd.id, agent_id = %cmd.agent_id, "Scheduled update triggered");
    }

    Ok(())
}

// ── Internal: advance rollout phase ──

async fn advance_rollout_phase(
    state: &AppState,
    rollout: RolloutPlanRow,
) -> Result<RolloutPlanRow> {
    let release =
        sqlx::query_as::<_, AgentReleaseRow>("SELECT * FROM agent_releases WHERE id = $1")
            .bind(rollout.release_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("Релиз не найден"))?;

    // Determine how many agents to update in this phase
    let remaining = rollout.total_agents - rollout.completed_agents - rollout.failed_agents;
    let batch_size = match rollout.current_phase.as_str() {
        "canary" => rollout.canary_count.min(remaining),
        "batch" => {
            let pct =
                (rollout.total_agents as f64 * rollout.batch_percent as f64 / 100.0).ceil() as i32;
            pct.max(1).min(remaining)
        }
        "fleet" => remaining,
        _ => return Err(AppError::bad_request("Rollout уже завершён")),
    };

    if batch_size <= 0 {
        // All done — mark completed
        let updated = sqlx::query_as::<_, RolloutPlanRow>(
            r#"UPDATE rollout_plans SET
                 status = 'completed', current_phase = 'done', completed_at = NOW()
               WHERE id = $1 RETURNING *"#,
        )
        .bind(rollout.id)
        .fetch_one(&state.db)
        .await?;
        return Ok(updated);
    }

    // Find agents to update in this batch (prefer online agents, not already being updated)
    let agents = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.is_active AND a.agent_type = $1
             AND (a.current_version IS NULL OR a.current_version != $2)
             AND a.id NOT IN (
               SELECT agent_id FROM agent_update_commands
               WHERE rollout_id = $3 AND status NOT IN ('failed','rolled_back')
             )
           ORDER BY a.is_online DESC, a.last_heartbeat_at DESC NULLS LAST
           LIMIT $4"#,
    )
    .bind(&rollout.target_agent_type)
    .bind(&release.version)
    .bind(rollout.id)
    .bind(batch_size)
    .fetch_all(&state.db)
    .await?;

    if agents.is_empty() {
        let updated = sqlx::query_as::<_, RolloutPlanRow>(
            r#"UPDATE rollout_plans SET
                 status = 'completed', current_phase = 'done', completed_at = NOW()
               WHERE id = $1 RETURNING *"#,
        )
        .bind(rollout.id)
        .fetch_one(&state.db)
        .await?;
        return Ok(updated);
    }

    // Determine wait time and next phase
    let wait_minutes = match rollout.current_phase.as_str() {
        "canary" => rollout.canary_wait_minutes,
        "batch" => rollout.batch_wait_minutes,
        _ => 0,
    };
    let next_phase = match rollout.current_phase.as_str() {
        "canary" => "batch",
        "batch" => "fleet",
        _ => "done",
    };

    // Create update commands and send MQTT
    for agent in &agents {
        let cmd = sqlx::query_as::<_, UpdateCommandRow>(
            r#"INSERT INTO agent_update_commands
                 (agent_id, release_id, previous_version, rollout_id, initiated_by)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *"#,
        )
        .bind(agent.id)
        .bind(rollout.release_id)
        .bind(&agent.current_version)
        .bind(rollout.id)
        .bind(rollout.initiated_by)
        .fetch_one(&state.db)
        .await?;

        sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
            .bind(&release.version)
            .bind(agent.id)
            .execute(&state.db)
            .await?;

        if agent.is_online {
            let topic = format!(
                "svoefoto/{}/{}/commands/update",
                agent.studio_id, agent.agent_type
            );
            let client_guard = state.mqtt_client.read().await;
            if let Some(ref client) = *client_guard {
                let payload = serde_json::to_vec(&json!({
                    "command_id": cmd.id.to_string(),
                    "target_version": release.version,
                    "artifact_url": release.artifact_url,
                    "artifact_hash_sha256": release.artifact_hash_sha256,
                    "artifact_size_bytes": release.artifact_size_bytes,
                    "force": false,
                }))?;
                let _ = client
                    .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
                    .await;
            }
        }
    }

    // Update rollout state
    let next_phase_at = if wait_minutes > 0 {
        Some(chrono::Utc::now() + chrono::Duration::minutes(wait_minutes as i64))
    } else {
        None
    };

    let updated = sqlx::query_as::<_, RolloutPlanRow>(
        r#"UPDATE rollout_plans SET
             status = 'in_progress',
             current_phase = $2,
             phase_started_at = NOW(),
             next_phase_at = $3
           WHERE id = $1 RETURNING *"#,
    )
    .bind(rollout.id)
    .bind(next_phase)
    .bind(next_phase_at)
    .fetch_one(&state.db)
    .await?;

    Ok(updated)
}
