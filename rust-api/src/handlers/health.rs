use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::AppState;
use crate::error::Result;

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>> {
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM kb_entities WHERE deleted_at IS NULL")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({
        "status": "ok",
        "service": "kb-api",
        "version": env!("CARGO_PKG_VERSION"),
        "entities_count": row.0
    })))
}
