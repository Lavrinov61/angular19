use axum::{
    Json,
    extract::{Path, Query, State},
};
use rand;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::bridge::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/bridges
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<BridgeListQuery>,
) -> Result<Json<Value>> {
    let bridges = if let Some(ref sid) = q.studio_id {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query_as::<_, BridgeDeviceRow>(
            r#"SELECT bd.*, s.name AS studio_name
               FROM bridge_devices bd
               LEFT JOIN studios s ON s.id = bd.studio_id
               WHERE bd.is_active AND bd.studio_id = $1
               ORDER BY bd.name"#,
        )
        .bind(studio_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, BridgeDeviceRow>(
            r#"SELECT bd.*, s.name AS studio_name
               FROM bridge_devices bd
               LEFT JOIN studios s ON s.id = bd.studio_id
               WHERE bd.is_active
               ORDER BY bd.studio_id, bd.name"#,
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "bridges": bridges })))
}

/// POST /api/print/bridges (catalog:manage)
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateBridgeDeviceDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.studio_id.is_empty() {
        return Err(AppError::bad_request("studio_id обязателен"));
    }
    if body.name.is_empty() {
        return Err(AppError::bad_request("name обязателен"));
    }
    if body.mqtt_username.is_empty() {
        return Err(AppError::bad_request("mqtt_username обязателен"));
    }
    if body.mqtt_password_hash.is_empty() {
        return Err(AppError::bad_request("mqtt_password_hash обязателен"));
    }

    let studio_uuid =
        Uuid::parse_str(&body.studio_id).map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    // Generate API key (32 random bytes hex-encoded)
    let api_key = hex::encode(rand::random::<[u8; 32]>());

    let device = sqlx::query_as::<_, BridgeDeviceRow>(
        r#"INSERT INTO bridge_devices (id, studio_id, api_key, name, mqtt_username, mqtt_password_hash, agent_type)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           RETURNING *, NULL::text AS studio_name"#,
    )
    .bind(studio_uuid)
    .bind(&api_key)
    .bind(&body.name)
    .bind(&body.mqtt_username)
    .bind(&body.mqtt_password_hash)
    .bind(body.agent_type.as_deref().unwrap_or("pos_bridge"))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "device": device })))
}

/// PUT /api/print/bridges/:id (catalog:manage)
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBridgeDeviceDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.name {
        sqlx::query("UPDATE bridge_devices SET name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref sid) = body.studio_id {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query("UPDATE bridge_devices SET studio_id = $1 WHERE id = $2")
            .bind(studio_uuid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref at) = body.agent_type {
        sqlx::query("UPDATE bridge_devices SET agent_type = $1 WHERE id = $2")
            .bind(at)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE bridge_devices SET is_active = $1 WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let device = sqlx::query_as::<_, BridgeDeviceRow>(
        r#"SELECT bd.*, s.name AS studio_name
           FROM bridge_devices bd
           LEFT JOIN studios s ON s.id = bd.studio_id
           WHERE bd.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Bridge device не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "device": device })))
}

/// DELETE /api/print/bridges/:id (catalog:manage)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result =
        sqlx::query("UPDATE bridge_devices SET is_active = FALSE WHERE id = $1 AND is_active")
            .bind(id)
            .execute(&state.db)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "Bridge device не найден: {id}"
        )));
    }

    Ok(Json(json!({ "success": true })))
}
