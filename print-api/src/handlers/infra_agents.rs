use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::config::EmqxConfig;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::agent::*;

fn require_infra(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "infra:manage") {
        return Err(AppError::forbidden("Недостаточно прав (infra:manage)"));
    }
    Ok(())
}

/// GET /api/infra/agents
pub async fn list(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<AgentListQuery>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let agents = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name
           FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.is_active
             AND ($1::uuid IS NULL OR a.studio_id = $1)
             AND ($2::text IS NULL OR a.agent_type = $2)
             AND ($3::bool IS NULL OR a.is_online = $3)
           ORDER BY s.name, a.agent_type"#,
    )
    .bind(q.studio_id.as_ref().and_then(|s| Uuid::parse_str(s).ok()))
    .bind(&q.agent_type)
    .bind(q.is_online)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "agents": agents })))
}

/// GET /api/infra/agents/:id
pub async fn get(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name
           FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Агент не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "agent": agent })))
}

/// POST /api/infra/agents — register new agent (generates MQTT credentials)
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateAgentDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let valid_types = ["print", "pos", "vision", "monitor", "guard"];
    if !valid_types.contains(&body.agent_type.as_str()) {
        return Err(AppError::bad_request(format!(
            "agent_type должен быть одним из: {}",
            valid_types.join(", ")
        )));
    }

    let studio_uuid = Uuid::parse_str(&body.studio_id)
        .map_err(|_| AppError::bad_request("Некорректный studio_id"))?;

    // Generate MQTT credentials
    let mqtt_username = format!(
        "svf_{}_{}",
        body.agent_type,
        hex::encode(rand::random::<[u8; 6]>())
    );
    let mqtt_password = hex::encode(rand::random::<[u8; 32]>());
    // Store SHA-256 hash (compatible with EMQX built-in password_based auth)
    let mqtt_password_hash = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(mqtt_password.as_bytes());
        hex::encode(hasher.finalize())
    };

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"INSERT INTO agents (studio_id, agent_type, name, hostname, mqtt_username, mqtt_password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *, NULL::text AS studio_name"#,
    )
    .bind(studio_uuid)
    .bind(&body.agent_type)
    .bind(&body.name)
    .bind(&body.hostname)
    .bind(&mqtt_username)
    .bind(&mqtt_password_hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e
            && db_err.constraint() == Some("agents_studio_id_agent_type_key") {
                return AppError::conflict(format!(
                    "Агент типа '{}' уже существует для этой точки",
                    body.agent_type
                ));
            }
        AppError::from(e)
    })?;

    // EMQX sync: create MQTT user + ACL (non-blocking, log on error)
    emqx_create_user_and_acl(
        &state.config.emqx,
        &mqtt_username,
        &mqtt_password,
        &studio_uuid,
        &body.agent_type,
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "agent": agent,
        "mqtt_credentials": {
            "username": mqtt_username,
            "password": mqtt_password,
        }
    })))
}

/// PUT /api/infra/agents/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAgentDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE agents SET name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref hostname) = body.hostname {
        sqlx::query("UPDATE agents SET hostname = $1 WHERE id = $2")
            .bind(hostname)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref target) = body.target_version {
        sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
            .bind(target)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE agents SET is_active = $1 WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref config) = body.desired_config {
        sqlx::query("UPDATE agents SET desired_config = $1, config_version = config_version + 1 WHERE id = $2")
            .bind(config).bind(id).execute(&mut *tx).await?;
    }

    tx.commit().await?;

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name
           FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Агент не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "agent": agent })))
}

/// DELETE /api/infra/agents/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    // Fetch mqtt_username before soft-deleting
    let mqtt_username: Option<String> =
        sqlx::query_scalar("SELECT mqtt_username FROM agents WHERE id = $1 AND is_active")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let result = sqlx::query(
        "UPDATE agents SET is_active = FALSE, is_online = FALSE WHERE id = $1 AND is_active",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Агент не найден: {id}")));
    }

    // EMQX sync: remove MQTT user (non-blocking)
    if let Some(username) = mqtt_username {
        emqx_delete_user(&state.config.emqx, &username).await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/infra/agents/:id/restart — send restart command via MQTT
pub async fn restart(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, s.name AS studio_name
           FROM agents a
           LEFT JOIN studios s ON s.id = a.studio_id
           WHERE a.id = $1 AND a.is_active"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Агент не найден: {id}")))?;

    if !agent.is_online {
        return Err(AppError::bad_request(
            "Агент оффлайн, перезапуск невозможен",
        ));
    }

    let topic = format!(
        "svoefoto/{}/{}/commands/restart",
        agent.studio_id, agent.agent_type
    );

    let client_guard = state.mqtt_client.read().await;
    if let Some(ref client) = *client_guard {
        let payload = serde_json::to_vec(&json!({
            "reason": format!("Restart initiated by {}", claims.email),
            "delay_seconds": 0,
            "timestamp_ms": chrono::Utc::now().timestamp_millis(),
        }))?;

        client
            .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
            .await
            .map_err(|e| AppError::internal(format!("MQTT publish error: {e}")))?;
    } else {
        return Err(AppError::service_unavailable("MQTT не подключён"));
    }

    Ok(Json(
        json!({ "success": true, "message": "Команда перезапуска отправлена" }),
    ))
}

/// POST /api/infra/agents/:id/config — push config via MQTT retained
pub async fn push_config(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<PushConfigDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, NULL::text AS studio_name
           FROM agents a
           WHERE a.id = $1 AND a.is_active"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Агент не найден: {id}")))?;

    // Update desired_config + increment version
    let new_version = agent.config_version + 1;
    sqlx::query("UPDATE agents SET desired_config = $1, config_version = $2 WHERE id = $3")
        .bind(&body.config)
        .bind(new_version)
        .bind(id)
        .execute(&state.db)
        .await?;

    // Publish retained config to MQTT
    let topic = format!("svoefoto/{}/{}/config", agent.studio_id, agent.agent_type);

    let client_guard = state.mqtt_client.read().await;
    if let Some(ref client) = *client_guard {
        let payload = serde_json::to_vec(&json!({
            "config_version": new_version,
            "config": body.config,
            "restart_required": body.restart_required.unwrap_or(false),
            "timestamp_ms": chrono::Utc::now().timestamp_millis(),
        }))?;

        client
            .publish(topic, rumqttc::QoS::AtLeastOnce, true, payload)
            .await
            .map_err(|e| AppError::internal(format!("MQTT publish error: {e}")))?;
    } else {
        tracing::warn!("MQTT not connected, config saved to DB only");
    }

    Ok(Json(
        json!({ "success": true, "config_version": new_version }),
    ))
}

/// POST /api/infra/agents/:id/update — trigger update for specific agent
pub async fn trigger_update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<TriggerUpdateDto>,
) -> Result<Json<Value>> {
    require_infra(&claims)?;

    let agent = sqlx::query_as::<_, AgentRow>(
        r#"SELECT a.*, NULL::text AS studio_name
           FROM agents a
           WHERE a.id = $1 AND a.is_active"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Агент не найден: {id}")))?;

    let release_uuid = Uuid::parse_str(&body.release_id)
        .map_err(|_| AppError::bad_request("Некорректный release_id"))?;

    let release =
        sqlx::query_as::<_, AgentReleaseRow>("SELECT * FROM agent_releases WHERE id = $1")
            .bind(release_uuid)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("Релиз не найден"))?;

    if release.agent_type != agent.agent_type {
        return Err(AppError::bad_request(
            "Тип релиза не совпадает с типом агента",
        ));
    }

    // Create update command
    let user_uuid = Uuid::parse_str(&claims.user_id).ok();
    let cmd = sqlx::query_as::<_, UpdateCommandRow>(
        r#"INSERT INTO agent_update_commands (agent_id, release_id, previous_version, initiated_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *"#,
    )
    .bind(id)
    .bind(release_uuid)
    .bind(&agent.current_version)
    .bind(user_uuid)
    .fetch_one(&state.db)
    .await?;

    // Set target_version on agent
    sqlx::query("UPDATE agents SET target_version = $1 WHERE id = $2")
        .bind(&release.version)
        .bind(id)
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
            "force": body.force.unwrap_or(false),
        }))?;

        client
            .publish(topic, rumqttc::QoS::AtLeastOnce, false, payload)
            .await
            .map_err(|e| AppError::internal(format!("MQTT publish error: {e}")))?;
    }

    Ok(Json(json!({ "success": true, "update_command": cmd })))
}

#[derive(Debug, serde::Deserialize)]
pub struct TriggerUpdateDto {
    pub release_id: String,
    pub force: Option<bool>,
}

// ── EMQX REST API helpers ──────────────────────────────────────

/// Create MQTT user + ACL rules in EMQX. Logs errors but never fails the caller.
async fn emqx_create_user_and_acl(
    emqx: &EmqxConfig,
    mqtt_username: &str,
    mqtt_password: &str,
    studio_id: &Uuid,
    agent_type: &str,
) {
    let client = reqwest::Client::new();

    // 1. Create authentication user
    let user_url = format!(
        "{}/api/v5/authentication/password_based:built_in_database/users",
        emqx.api_url
    );
    match client
        .post(&user_url)
        .basic_auth(&emqx.api_key, Some(&emqx.api_secret))
        .json(&json!({
            "user_id": mqtt_username,
            "password": mqtt_password,
        }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(mqtt_username, "EMQX: user created");
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(mqtt_username, %status, body, "EMQX: failed to create user");
        }
        Err(e) => {
            tracing::error!(mqtt_username, error = %e, "EMQX: user create request failed");
        }
    }

    // 2. Create ACL rules
    let acl_url = format!(
        "{}/api/v5/authorization/built_in_database/rules/users",
        emqx.api_url
    );
    let topic_pattern = format!("svoefoto/{studio_id}/{agent_type}/#");
    match client
        .post(&acl_url)
        .basic_auth(&emqx.api_key, Some(&emqx.api_secret))
        .json(&json!({
            "username": mqtt_username,
            "rules": [{
                "action": "all",
                "topic": topic_pattern,
                "permission": "allow",
            }],
        }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(mqtt_username, topic_pattern, "EMQX: ACL rules created");
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(mqtt_username, %status, body, "EMQX: failed to create ACL rules");
        }
        Err(e) => {
            tracing::error!(mqtt_username, error = %e, "EMQX: ACL create request failed");
        }
    }
}

/// Delete MQTT user from EMQX. Logs errors but never fails the caller.
async fn emqx_delete_user(emqx: &EmqxConfig, mqtt_username: &str) {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v5/authentication/password_based:built_in_database/users/{}",
        emqx.api_url, mqtt_username
    );

    match client
        .delete(&url)
        .basic_auth(&emqx.api_key, Some(&emqx.api_secret))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 404 => {
            tracing::info!(mqtt_username, "EMQX: user deleted");
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(mqtt_username, %status, body, "EMQX: failed to delete user");
        }
        Err(e) => {
            tracing::error!(mqtt_username, error = %e, "EMQX: user delete request failed");
        }
    }
}
