use axum::{Json, extract::State};
use serde_json::{Value, json};

use crate::AppState;
use crate::error::Result;

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>> {
    let row = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await?;

    let mqtt = *state.mqtt_connected.read().await;

    Ok(Json(json!({
        "status": "ok",
        "service": "print-api",
        "version": env!("CARGO_PKG_VERSION"),
        "db": row == 1,
        "mqtt_bridge": mqtt,
    })))
}
