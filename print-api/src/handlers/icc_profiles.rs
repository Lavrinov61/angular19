use axum::{
    Json,
    extract::{Path, Query, State},
};
use prost::Message;
use rumqttc::QoS;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::icc_profile::*;
use crate::proto;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/icc-profiles
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<IccProfileQuery>,
) -> Result<Json<Value>> {
    let profiles = if let Some(ref did) = q.device_id {
        let device_uuid =
            Uuid::parse_str(did).map_err(|_| AppError::bad_request("Invalid device_id"))?;
        sqlx::query_as::<_, IccProfileRow>(
            r#"SELECT ip.*, bd.name AS device_name
               FROM icc_profiles ip
               LEFT JOIN bridge_devices bd ON bd.id = ip.device_id
               WHERE ip.is_active AND ip.device_id = $1
               ORDER BY ip.is_default DESC, ip.profile_name"#,
        )
        .bind(device_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, IccProfileRow>(
            r#"SELECT ip.*, bd.name AS device_name
               FROM icc_profiles ip
               LEFT JOIN bridge_devices bd ON bd.id = ip.device_id
               WHERE ip.is_active
               ORDER BY ip.device_id, ip.is_default DESC, ip.profile_name"#,
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "profiles": profiles })))
}

/// GET /api/print/icc-profiles/:id
pub async fn get(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let profile = sqlx::query_as::<_, IccProfileRow>(
        r#"SELECT ip.*, bd.name AS device_name
           FROM icc_profiles ip
           LEFT JOIN bridge_devices bd ON bd.id = ip.device_id
           WHERE ip.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("ICC-профиль не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "profile": profile })))
}

/// POST /api/print/icc-profiles
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateIccProfileDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.media_type.is_empty() || body.profile_name.is_empty() || body.file_key.is_empty() {
        return Err(AppError::bad_request(
            "media_type, profile_name и file_key обязательны",
        ));
    }
    let device_uuid =
        Uuid::parse_str(&body.device_id).map_err(|_| AppError::bad_request("Invalid device_id"))?;

    let profile = sqlx::query_as::<_, IccProfileRow>(
        r#"INSERT INTO icc_profiles (device_id, media_type, profile_name, file_key, is_default)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *, NULL::text AS device_name"#,
    )
    .bind(device_uuid)
    .bind(&body.media_type)
    .bind(&body.profile_name)
    .bind(&body.file_key)
    .bind(body.is_default.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    // Phase 4.1: Sync ICC profile to agents via MQTT
    publish_icc_sync(&state, &profile).await;

    Ok(Json(json!({ "success": true, "profile": profile })))
}

/// PUT /api/print/icc-profiles/:id
pub async fn update(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateIccProfileDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(ref name) = body.profile_name {
        sqlx::query("UPDATE icc_profiles SET profile_name = $1, updated_at = NOW() WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref key) = body.file_key {
        sqlx::query("UPDATE icc_profiles SET file_key = $1, updated_at = NOW() WHERE id = $2")
            .bind(key)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref mt) = body.media_type {
        sqlx::query("UPDATE icc_profiles SET media_type = $1, updated_at = NOW() WHERE id = $2")
            .bind(mt)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(is_def) = body.is_default {
        sqlx::query("UPDATE icc_profiles SET is_default = $1, updated_at = NOW() WHERE id = $2")
            .bind(is_def)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(active) = body.is_active {
        sqlx::query("UPDATE icc_profiles SET is_active = $1, updated_at = NOW() WHERE id = $2")
            .bind(active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let profile = sqlx::query_as::<_, IccProfileRow>(
        r#"SELECT ip.*, bd.name AS device_name
           FROM icc_profiles ip
           LEFT JOIN bridge_devices bd ON bd.id = ip.device_id
           WHERE ip.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("ICC-профиль не найден: {id}")))?;

    // Phase 4.1: Sync updated ICC profile to agents
    if profile.is_active {
        publish_icc_sync(&state, &profile).await;
    }

    Ok(Json(json!({ "success": true, "profile": profile })))
}

/// Phase 4.1: Publish IccSyncRequest to MQTT for all studios that have this device.
async fn publish_icc_sync(state: &AppState, profile: &IccProfileRow) {
    let client_guard = state.mqtt_client.read().await;
    let Some(client) = client_guard.as_ref() else {
        return;
    };

    // Build full download URL from S3 base + file_key
    let file_url = format!("{}/{}", state.config.s3_base_url, profile.file_key);

    let sync_req = proto::IccSyncRequest {
        profile_id: profile.id.to_string(),
        profile_name: profile.profile_name.clone(),
        media_type: profile.media_type.clone(),
        file_url,
        is_default: profile.is_default,
    };
    let buf = sync_req.encode_to_vec();

    // Find which studio this device belongs to, and publish to that studio's topic
    let studio_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT studio_id FROM bridge_devices WHERE id = $1 AND is_active = TRUE",
    )
    .bind(profile.device_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for studio_id in &studio_ids {
        let topic = format!("svoefoto/{studio_id}/icc/sync");
        if let Err(e) = client
            .publish(&topic, QoS::AtLeastOnce, false, buf.clone())
            .await
        {
            tracing::warn!(studio_id = %studio_id, error = %e, "Failed to publish ICC sync");
        } else {
            tracing::info!(
                profile_id = %profile.id,
                studio_id = %studio_id,
                "ICC sync published to MQTT"
            );
        }
    }
}

/// DELETE /api/print/icc-profiles/:id (soft delete)
pub async fn delete(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let result = sqlx::query(
        "UPDATE icc_profiles SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("ICC-профиль не найден: {id}")));
    }

    Ok(Json(json!({ "success": true })))
}
