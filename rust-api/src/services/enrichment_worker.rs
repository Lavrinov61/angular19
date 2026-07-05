use sqlx::postgres::PgConnection;
use sqlx::{Connection, PgPool};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::services::embedding::EmbeddingService;
use crate::services::scraper::ScraperService;

const LEADER_LOCK_ID: i64 = 737002;
const RETRY_INTERVAL: Duration = Duration::from_secs(30);

/// Background enrichment worker.
///
/// Polls `kb_enrichment_tasks` for pending tasks and processes them.
/// Uses a **dedicated PG connection** (not from the pool) to hold a session-level
/// advisory lock, ensuring single-worker semantics across multiple instances.
///
/// Supported task types:
/// - `embed` — generate and store embedding via Voyage AI
/// - `detect_duplicates` — find duplicate entities
/// - `scrape_competitor` — scrape competitor website
pub struct EnrichmentWorker {
    db: PgPool,
    embedding: Option<EmbeddingService>,
    max_concurrent: usize,
    poll_interval: Duration,
    database_url: String,
}

impl EnrichmentWorker {
    pub fn new(db: PgPool, database_url: String) -> Self {
        Self {
            db,
            embedding: None,
            max_concurrent: 5,
            poll_interval: Duration::from_secs(30),
            database_url,
        }
    }

    pub fn with_embedding(mut self, service: EmbeddingService) -> Self {
        self.embedding = Some(service);
        self
    }

    pub fn with_concurrency(mut self, max: usize) -> Self {
        self.max_concurrent = max;
        self
    }

    pub fn with_poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }

    /// Start the background worker loop.
    ///
    /// Uses a dedicated PG connection to hold the advisory lock (like Express scheduler-leader.ts).
    /// The lock is held for the entire leader session and released only on disconnect or explicit stop.
    pub async fn run(self) {
        let semaphore = Arc::new(Semaphore::new(self.max_concurrent));
        let db = self.db.clone();
        let embedding = self.embedding.clone();

        tracing::info!(
            "Enrichment worker started (max_concurrent={}, poll_interval={}s)",
            self.max_concurrent,
            self.poll_interval.as_secs()
        );

        loop {
            // Try to become leader using a dedicated connection
            match self.run_as_leader(&db, &embedding, &semaphore).await {
                LeaderResult::LostConnection(err) => {
                    tracing::warn!("Lost leader connection: {err}. Retrying in {}s...", RETRY_INTERVAL.as_secs());
                }
                LeaderResult::NotAcquired => {
                    tracing::debug!("Not the enrichment leader, sleeping...");
                }
                LeaderResult::ConnectionFailed(err) => {
                    tracing::error!("Failed to connect for leader election: {err}");
                }
            }

            tokio::time::sleep(RETRY_INTERVAL).await;
        }
    }

    /// Attempt to acquire advisory lock on a dedicated connection and run as leader.
    /// Returns only when leadership is lost or not acquired.
    async fn run_as_leader(
        &self,
        db: &PgPool,
        embedding: &Option<EmbeddingService>,
        semaphore: &Arc<Semaphore>,
    ) -> LeaderResult {
        // Open a dedicated connection (NOT from the pool)
        let mut lock_conn = match PgConnection::connect(&self.database_url).await {
            Ok(conn) => conn,
            Err(e) => return LeaderResult::ConnectionFailed(e.to_string()),
        };

        // Try to acquire advisory lock on this dedicated connection
        let acquired: bool = match sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(LEADER_LOCK_ID)
            .fetch_one(&mut lock_conn)
            .await
        {
            Ok(v) => v,
            Err(e) => return LeaderResult::LostConnection(e.to_string()),
        };

        if !acquired {
            return LeaderResult::NotAcquired;
        }

        tracing::info!("Acquired enrichment leader lock — this instance processes enrichment tasks");

        // Main leader loop: process tasks using the pool, but hold the lock on lock_conn.
        // Each iteration pings the dedicated connection as a heartbeat.
        loop {
            // Heartbeat: ping the dedicated connection to keep advisory lock alive
            if let Err(e) = sqlx::query("SELECT 1").execute(&mut lock_conn).await {
                tracing::warn!("Leader heartbeat failed: {e}");
                return LeaderResult::LostConnection(e.to_string());
            }

            // Fetch pending tasks (from the pool, not the lock connection)
            let tasks: Vec<PendingTask> = match sqlx::query_as(
                "SELECT id, entity_id, task_type, payload, attempts, max_attempts
                 FROM kb_enrichment_tasks
                 WHERE status = 'pending'
                   AND scheduled_at <= NOW()
                   AND attempts < max_attempts
                   AND (retry_after IS NULL OR retry_after <= NOW())
                 ORDER BY priority ASC, scheduled_at ASC
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED",
            )
            .bind(self.max_concurrent as i64)
            .fetch_all(db)
            .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("Failed to fetch enrichment tasks: {e}");
                    tokio::time::sleep(self.poll_interval).await;
                    continue;
                }
            };

            if tasks.is_empty() {
                // Check for recurring tasks that need rescheduling
                reschedule_recurring_tasks(db).await;
                tokio::time::sleep(self.poll_interval).await;
                continue;
            }

            for task in tasks {
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let db = db.clone();
                let embedding = embedding.clone();

                tokio::spawn(async move {
                    process_task(&db, embedding.as_ref(), task).await;
                    drop(permit);
                });
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

enum LeaderResult {
    NotAcquired,
    LostConnection(String),
    ConnectionFailed(String),
}

async fn process_task(
    db: &PgPool,
    embedding: Option<&EmbeddingService>,
    task: PendingTask,
) {
    tracing::info!(
        "Processing enrichment task {} (type={}, entity={:?})",
        task.id,
        task.task_type,
        task.entity_id
    );

    // Mark as processing
    let _ = sqlx::query(
        "UPDATE kb_enrichment_tasks SET
           status = 'processing',
           started_at = NOW(),
           attempts = attempts + 1
         WHERE id = $1",
    )
    .bind(task.id)
    .execute(db)
    .await;

    let result = match task.task_type.as_str() {
        "embed" => process_embed(db, embedding, &task).await,
        "detect_duplicates" => process_detect_duplicates(db, &task).await,
        "scrape_competitor" => process_scrape_competitor(db, &task).await,
        _ => {
            Err(format!(
                "Task type '{}' not yet implemented in Rust worker",
                task.task_type
            ))
        }
    };

    match result {
        Ok(result_json) => {
            let _ = sqlx::query(
                "UPDATE kb_enrichment_tasks SET
                   status = 'completed',
                   completed_at = NOW(),
                   result = $2,
                   last_run_at = NOW()
                 WHERE id = $1",
            )
            .bind(task.id)
            .bind(result_json)
            .execute(db)
            .await;

            tracing::info!("Task {} completed successfully", task.id);
        }
        Err(error) => {
            let should_retry = task.attempts + 1 < task.max_attempts;
            let status = if should_retry { "pending" } else { "failed" };
            let retry_after = if should_retry {
                // Exponential backoff: 30s, 60s, 120s, ...
                let delay_secs = 30 * (1 << task.attempts);
                Some(
                    chrono::Utc::now()
                        + chrono::Duration::seconds(delay_secs.min(3600)),
                )
            } else {
                None
            };

            let _ = sqlx::query(
                "UPDATE kb_enrichment_tasks SET
                   status = $2,
                   error = $3,
                   retry_after = $4,
                   completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END
                 WHERE id = $1",
            )
            .bind(task.id)
            .bind(status)
            .bind(&error)
            .bind(retry_after)
            .execute(db)
            .await;

            if should_retry {
                tracing::warn!("Task {} failed, will retry: {}", task.id, error);
            } else {
                tracing::error!("Task {} permanently failed: {}", task.id, error);
            }
        }
    }
}

/// Process an embed task — generate vector embedding for an entity
async fn process_embed(
    db: &PgPool,
    embedding: Option<&EmbeddingService>,
    task: &PendingTask,
) -> std::result::Result<serde_json::Value, String> {
    let Some(service) = embedding else {
        return Err("Embedding service not configured (VOYAGE_API_KEY missing)".into());
    };

    let entity_id = task
        .entity_id
        .ok_or_else(|| "embed task requires entity_id".to_string())?;

    service
        .embed_entity(db, entity_id)
        .await
        .map_err(|e| format!("Embedding failed: {e}"))?;

    Ok(serde_json::json!({
        "embedded": true,
        "entity_id": entity_id,
        "model": "voyage-3",
        "dimensions": 1024
    }))
}

/// Detect duplicate entities based on name similarity
async fn process_detect_duplicates(
    db: &PgPool,
    task: &PendingTask,
) -> std::result::Result<serde_json::Value, String> {
    let entity_id = task
        .entity_id
        .ok_or_else(|| "detect_duplicates requires entity_id".to_string())?;

    let duplicates: Vec<DuplicateCandidate> = sqlx::query_as(
        "SELECT e2.id, e2.name, e2.entity_type, e2.slug,
                similarity(e1.name, e2.name) AS sim
         FROM kb_entities e1
         CROSS JOIN kb_entities e2
         WHERE e1.id = $1
           AND e2.id != e1.id
           AND e2.deleted_at IS NULL
           AND e2.entity_type = e1.entity_type
           AND similarity(e1.name, e2.name) > 0.5
         ORDER BY sim DESC
         LIMIT 10",
    )
    .bind(entity_id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Duplicate detection query failed: {e}"))?;

    Ok(serde_json::json!({
        "entity_id": entity_id,
        "duplicates_found": duplicates.len(),
        "candidates": duplicates,
    }))
}

/// Reschedule recurring tasks whose next_run_at has passed
async fn reschedule_recurring_tasks(db: &PgPool) {
    let count = sqlx::query(
        "UPDATE kb_enrichment_tasks SET
           status = 'pending',
           scheduled_at = NOW(),
           started_at = NULL,
           completed_at = NULL,
           result = NULL,
           error = NULL,
           attempts = 0
         WHERE cron_expression IS NOT NULL
           AND status IN ('completed', 'failed')
           AND next_run_at IS NOT NULL
           AND next_run_at <= NOW()",
    )
    .execute(db)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    if count > 0 {
        tracing::info!("Rescheduled {count} recurring enrichment tasks");
    }
}

#[derive(Debug, sqlx::FromRow)]
struct PendingTask {
    id: Uuid,
    entity_id: Option<Uuid>,
    task_type: String,
    payload: serde_json::Value,
    attempts: i32,
    max_attempts: i32,
}

/// Process scrape_competitor task — scrape a competitor website via ScraperService
async fn process_scrape_competitor(
    db: &PgPool,
    task: &PendingTask,
) -> std::result::Result<serde_json::Value, String> {
    let source_slug = task
        .payload
        .get("source_slug")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "scrape_competitor task requires 'source_slug' in payload".to_string())?;

    tracing::info!("Scraping competitor source: {source_slug}");

    let scraper = ScraperService::new(db.clone());
    let result = scraper.scrape_source(source_slug).await?;

    let mut structured_count = 0;

    // If config has competitor_slug, extract and save structured prices
    if let Some(competitor_slug) = task
        .payload
        .get("config")
        .and_then(|c| c.get("competitor_slug"))
        .and_then(|v| v.as_str())
    {
        // Save structured prices to kb_competitor_prices
        match scraper.save_structured_prices(competitor_slug, &result.data).await {
            Ok(count) => structured_count = count,
            Err(e) => tracing::warn!("Failed to save structured prices: {e}"),
        }

        // Also update metadata blob for backward compat
        let pricing = serde_json::json!({
            "scraped_items": result.data.iter().take(50).map(|item| {
                serde_json::json!({
                    "selector": item.selector,
                    "text": item.text,
                })
            }).collect::<Vec<_>>(),
            "scraped_at": chrono::Utc::now().to_rfc3339(),
        });

        scraper
            .update_competitor_prices(competitor_slug, &pricing)
            .await
            .unwrap_or_else(|e| tracing::warn!("Failed to update competitor metadata: {e}"));
    }

    Ok(serde_json::json!({
        "source": result.source,
        "pages_scraped": result.pages_scraped,
        "items_found": result.items_found,
        "structured_prices": structured_count,
    }))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct DuplicateCandidate {
    id: Uuid,
    name: String,
    entity_type: String,
    slug: String,
    sim: f32,
}
