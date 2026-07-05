use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use rusqlite::Connection;
use std::sync::Mutex;
use tracing::{debug, error, info};

use crate::AgentState;

/// SQLite-backed offline store for job queue and idempotency tracking
pub struct OfflineStore {
    conn: Mutex<Connection>,
}

impl OfflineStore {
    /// Open or create the SQLite database
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;

        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS pending_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                state INTEGER NOT NULL,
                error_message TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS processed_keys (
                idempotency_key TEXT PRIMARY KEY,
                processed_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS offline_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL UNIQUE,
                payload BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ")?;

        // Cleanup old processed keys (keep 7 days)
        conn.execute(
            "DELETE FROM processed_keys WHERE processed_at < datetime('now', '-7 days')",
            [],
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Check if a job was already processed (idempotency)
    pub fn was_processed(&self, key: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM processed_keys WHERE idempotency_key = ?1",
            [key],
            |_| Ok(()),
        ).is_ok()
    }

    /// Mark a job as processed (idempotency)
    pub fn mark_processed(&self, key: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO processed_keys (idempotency_key) VALUES (?1)",
            [key],
        )?;
        Ok(())
    }

    /// Queue a status update for later MQTT delivery
    pub fn queue_status(&self, job_id: &str, state: i32, error_msg: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pending_status (job_id, state, error_message) VALUES (?1, ?2, ?3)",
            rusqlite::params![job_id, state, error_msg],
        )?;
        debug!(job_id, "Queued status update for offline sync");
        Ok(())
    }

    /// Retrieve and remove pending status updates
    pub fn drain_pending_statuses(&self) -> Vec<PendingStatus> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = match conn.prepare(
            "SELECT id, job_id, state, error_message FROM pending_status ORDER BY id LIMIT 100"
        ) {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to query pending statuses: {e}");
                return vec![];
            }
        };

        let rows: Vec<PendingStatus> = stmt
            .query_map([], |row| {
                Ok(PendingStatus {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    state: row.get(2)?,
                    error_message: row.get(3)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if !rows.is_empty() {
            let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
            let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
            let sql = format!("DELETE FROM pending_status WHERE id IN ({})", placeholders.join(","));

            let params: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let _ = conn.execute(&sql, params.as_slice());
        }

        rows
    }

    /// Store a job command for offline execution
    pub fn queue_job(&self, job_id: &str, payload: &[u8]) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO offline_jobs (job_id, payload) VALUES (?1, ?2)",
            rusqlite::params![job_id, payload],
        )?;
        info!(job_id, "Job queued for offline execution");
        Ok(())
    }

    /// Drain offline jobs
    pub fn drain_offline_jobs(&self) -> Vec<OfflineJob> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = match conn.prepare(
            "SELECT id, job_id, payload FROM offline_jobs ORDER BY id LIMIT 10"
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows: Vec<OfflineJob> = stmt
            .query_map([], |row| {
                Ok(OfflineJob {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    payload: row.get(2)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if !rows.is_empty() {
            let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
            let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
            let sql = format!("DELETE FROM offline_jobs WHERE id IN ({})", placeholders.join(","));
            let params: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let _ = conn.execute(&sql, params.as_slice());
        }

        rows
    }
}

pub struct PendingStatus {
    pub id: i64,
    pub job_id: String,
    pub state: i32,
    pub error_message: String,
}

pub struct OfflineJob {
    pub id: i64,
    pub job_id: String,
    pub payload: Vec<u8>,
}

/// Background task: periodically sync pending statuses when MQTT is available
pub async fn run_sync(state: Arc<AgentState>) {
    // Wait for MQTT to connect first
    tokio::time::sleep(Duration::from_secs(10)).await;

    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;

        // Check if MQTT is connected
        let has_client = state.mqtt_client.read().await.is_some();
        if !has_client {
            continue;
        }

        // Drain pending status updates
        let pending = state.offline_store.drain_pending_statuses();
        if !pending.is_empty() {
            info!(count = pending.len(), "Syncing pending status updates");
            for ps in &pending {
                let job_state = crate::proto::JobState::try_from(ps.state)
                    .unwrap_or(crate::proto::JobState::Failed);
                crate::mqtt::report_status(&state, &ps.job_id, job_state, &ps.error_message, 0, None).await;
            }
        }
    }
}
