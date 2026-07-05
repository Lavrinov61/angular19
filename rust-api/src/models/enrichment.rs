use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EnrichmentTask {
    pub id: Uuid,
    pub entity_id: Option<Uuid>,
    pub task_type: String,
    pub status: String,
    pub priority: i32,
    pub payload: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub retry_after: Option<DateTime<Utc>>,
    pub scheduled_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cron_expression: Option<String>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Enrichment task with resolved entity info (from view)
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EnrichmentTaskExpanded {
    pub id: Uuid,
    pub entity_id: Option<Uuid>,
    pub task_type: String,
    pub status: String,
    pub priority: i32,
    pub payload: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub retry_after: Option<DateTime<Utc>>,
    pub scheduled_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cron_expression: Option<String>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub entity_name: Option<String>,
    pub entity_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEnrichmentTask {
    pub entity_slug: Option<String>,
    pub task_type: String,
    pub priority: Option<i32>,
    pub payload: Option<serde_json::Value>,
    pub max_attempts: Option<i32>,
    pub cron_expression: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEnrichmentTask {
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub max_attempts: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ListEnrichmentQuery {
    pub status: Option<String>,
    pub task_type: Option<String>,
    pub entity_id: Option<Uuid>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Batch enrichment request (enqueue multiple tasks at once)
#[derive(Debug, Deserialize)]
pub struct BatchEnrichmentRequest {
    pub task_type: String,
    pub entity_type: Option<String>,
    pub category_slug: Option<String>,
    pub priority: Option<i32>,
}
