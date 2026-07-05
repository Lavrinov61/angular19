use axum::{
    extract::{Path, State},
    Json,
};

use crate::error::{AppError, Result};
use crate::AppState;

/// Config entry from kb_config
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct ConfigEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub description: Option<String>,
    pub updated_by: Option<uuid::Uuid>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// GET /api/kb/config — list all configuration entries
pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<ConfigEntry>>> {
    let entries = sqlx::query_as::<_, ConfigEntry>(
        "SELECT * FROM kb_config ORDER BY key",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(entries))
}

/// GET /api/kb/config/:key — get a single config value
pub async fn get(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ConfigEntry>> {
    let entry = sqlx::query_as::<_, ConfigEntry>(
        "SELECT * FROM kb_config WHERE key = $1",
    )
    .bind(&key)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Config key '{key}' not found")))?;

    Ok(Json(entry))
}

/// PUT /api/kb/config/:key — set a config value
pub async fn set(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<SetConfigRequest>,
) -> Result<Json<ConfigEntry>> {
    let entry = sqlx::query_as::<_, ConfigEntry>(
        "INSERT INTO kb_config (key, value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           description = COALESCE(EXCLUDED.description, kb_config.description),
           updated_at = NOW()
         RETURNING *",
    )
    .bind(&key)
    .bind(&body.value)
    .bind(&body.description)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(entry))
}

/// DELETE /api/kb/config/:key — remove a config entry
pub async fn delete(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let rows = sqlx::query("DELETE FROM kb_config WHERE key = $1")
        .bind(&key)
        .execute(&state.db)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::not_found(format!("Config key '{key}' not found")));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, serde::Deserialize)]
pub struct SetConfigRequest {
    pub value: serde_json::Value,
    pub description: Option<String>,
}
