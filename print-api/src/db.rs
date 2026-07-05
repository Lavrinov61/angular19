use sqlx::postgres::{PgPool, PgPoolOptions};
use std::env;

pub async fn create_pool(database_url: &str) -> PgPool {
    // P1 tuning (2026-04-02): Increased from 10→25, 2→5
    let max_connections = env::var("DB_POOL_MAX")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(25);

    let min_connections = env::var("DB_POOL_MIN")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5);

    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(300))
        .connect(database_url)
        .await
        .expect("Failed to connect to PostgreSQL")
}
