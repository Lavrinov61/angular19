//! SQLite offline store for message persistence when MQTT is disconnected.
//! Uses WAL mode for concurrent read/write access.

use rusqlite::Connection;
use std::collections::HashSet;
use std::hash::{Hash, Hasher, DefaultHasher};
use std::path::Path;
use std::sync::Mutex;

pub struct OfflineStore {
    conn: Mutex<Connection>,
}

impl OfflineStore {
    /// Open or create the offline SQLite database.
    pub fn open(path: &str) -> anyhow::Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS pending_status (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 topic TEXT NOT NULL,
                 payload BLOB NOT NULL,
                 qos INTEGER DEFAULT 1,
                 created_at TEXT DEFAULT (datetime('now'))
             );

             CREATE TABLE IF NOT EXISTS processed_keys (
                 idempotency_key TEXT PRIMARY KEY,
                 processed_at TEXT DEFAULT (datetime('now'))
             );

             CREATE TABLE IF NOT EXISTS pending_commands (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 topic TEXT,
                 command_type TEXT NOT NULL,
                 payload BLOB NOT NULL,
                 created_at TEXT DEFAULT (datetime('now'))
             );"
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Check if a command with this idempotency key was already processed.
    pub fn was_processed(&self, key: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM processed_keys WHERE idempotency_key = ?1",
            [key],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Mark a command as processed (for idempotency).
    pub fn mark_processed(&self, key: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        conn.execute(
            "INSERT OR IGNORE INTO processed_keys (idempotency_key) VALUES (?1)",
            [key],
        )?;
        // Clean old entries (older than 7 days)
        conn.execute(
            "DELETE FROM processed_keys WHERE processed_at < datetime('now', '-7 days')",
            [],
        )?;
        Ok(())
    }

    /// Queue a message for later MQTT publish (when offline).
    pub fn queue_message(&self, topic: &str, payload: &[u8], qos: u8) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        conn.execute(
            "INSERT INTO pending_status (topic, payload, qos) VALUES (?1, ?2, ?3)",
            rusqlite::params![topic, payload, qos as i32],
        )?;
        Ok(())
    }

    /// Drain pending messages (up to `limit`), returning (id, topic, payload, qos).
    /// Skips messages older than 24 hours (TTL) and deduplicates by topic+payload.
    pub fn drain_pending(&self, limit: usize) -> anyhow::Result<Vec<PendingMessage>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, topic, payload, qos FROM pending_status \
             WHERE created_at > datetime('now', '-24 hours') \
             ORDER BY id LIMIT ?1"
        )?;
        let rows: Vec<PendingMessage> = stmt.query_map([limit as i64], |row| {
            Ok(PendingMessage {
                id: row.get(0)?,
                topic: row.get(1)?,
                payload: row.get(2)?,
                qos: row.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        // Dedup by topic+payload hash — keep only the first occurrence.
        // Only delete duplicates now; unique messages stay in DB until
        // the caller confirms successful send (prevents data loss).
        let mut seen = HashSet::new();
        let mut duplicate_ids = Vec::new();
        let mut unique_rows = Vec::new();

        for msg in rows {
            let mut hasher = DefaultHasher::new();
            msg.topic.hash(&mut hasher);
            msg.payload.hash(&mut hasher);
            let key = hasher.finish();

            if seen.insert(key) {
                unique_rows.push(msg);
            } else {
                duplicate_ids.push(msg.id);
            }
        }

        // Delete only duplicates from DB; unique rows remain until ack
        if !duplicate_ids.is_empty() {
            let placeholders: Vec<String> = duplicate_ids.iter().map(|_| "?".to_string()).collect();
            let sql = format!(
                "DELETE FROM pending_status WHERE id IN ({})",
                placeholders.join(",")
            );
            conn.execute(&sql, rusqlite::params_from_iter(duplicate_ids.iter()))?;
        }

        Ok(unique_rows)
    }

    /// Acknowledge successfully sent messages by deleting them from DB.
    /// Call this after drain_pending() messages have been published.
    pub fn ack_sent(&self, ids: &[i64]) -> anyhow::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "DELETE FROM pending_status WHERE id IN ({})",
            placeholders.join(",")
        );
        conn.execute(&sql, rusqlite::params_from_iter(ids.iter()))?;
        Ok(())
    }

    /// Delete expired messages older than `max_age_hours` hours. Returns count of deleted rows.
    pub fn prune_expired(&self, max_age_hours: i64) -> anyhow::Result<usize> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let deleted = conn.execute(
            "DELETE FROM pending_status WHERE created_at < datetime('now', ?1)",
            rusqlite::params![format!("-{max_age_hours} hours")],
        )?;
        Ok(deleted)
    }

    /// Count pending messages.
    pub fn pending_count(&self) -> anyhow::Result<i64> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pending_status",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Persist a print job's file path for crash recovery.
    pub fn persist_job_file(&self, job_id: &str, downloaded_path: &str, status: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO pending_commands (topic, command_type, payload) VALUES (?1, 'job_file', ?2)",
            rusqlite::params![job_id, format!("{}|{}", downloaded_path, status)],
        )?;
        Ok(())
    }

    /// Recover pending job files after crash. Returns Vec<(job_id, file_path, status)>.
    pub fn recover_pending_jobs(&self) -> anyhow::Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT topic, payload FROM pending_commands WHERE command_type = 'job_file'"
        )?;
        let jobs = stmt.query_map([], |row| {
            let job_id: String = row.get(0)?;
            let payload: String = row.get(1)?;
            let parts: Vec<&str> = payload.splitn(2, '|').collect();
            Ok((
                job_id,
                parts.first().unwrap_or(&"").to_string(),
                parts.get(1).unwrap_or(&"").to_string(),
            ))
        })?.filter_map(|r| r.ok()).collect();
        Ok(jobs)
    }

    /// Delete pending_status entries older than `max_age_days` days.
    pub fn cleanup_old_pending(&self, max_age_days: i64) -> anyhow::Result<usize> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let deleted = conn.execute(
            "DELETE FROM pending_status WHERE created_at < datetime('now', ?1)",
            rusqlite::params![format!("-{max_age_days} days")],
        )?;
        Ok(deleted)
    }

    /// Remove a persisted job file entry after successful completion.
    pub fn remove_job_file(&self, job_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Lock error: {e}"))?;
        conn.execute(
            "DELETE FROM pending_commands WHERE topic = ?1 AND command_type = 'job_file'",
            rusqlite::params![job_id],
        )?;
        Ok(())
    }
}

pub struct PendingMessage {
    pub id: i64,
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn test_store() -> OfflineStore {
        let tmp = NamedTempFile::new().unwrap();
        OfflineStore::open(tmp.path().to_str().unwrap()).unwrap()
    }

    #[test]
    fn test_processed_keys() {
        let store = test_store();
        assert!(!store.was_processed("key1").unwrap());
        store.mark_processed("key1").unwrap();
        assert!(store.was_processed("key1").unwrap());
    }

    #[test]
    fn test_queue_and_drain() {
        let store = test_store();
        store.queue_message("topic/a", b"payload1", 1).unwrap();
        store.queue_message("topic/b", b"payload2", 0).unwrap();
        assert_eq!(store.pending_count().unwrap(), 2);

        let msgs = store.drain_pending(10).unwrap();
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn test_persist_and_recover_job() {
        let store = test_store();
        store.persist_job_file("job1", "/tmp/file.jpg", "downloaded").unwrap();
        let jobs = store.recover_pending_jobs().unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].0, "job1");

        store.remove_job_file("job1").unwrap();
        assert!(store.recover_pending_jobs().unwrap().is_empty());
    }

    #[test]
    fn test_cleanup_old_pending() {
        let store = test_store();
        store.queue_message("old", b"data", 0).unwrap();
        assert_eq!(store.pending_count().unwrap(), 1);
        // Backdate the record so it appears old
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "UPDATE pending_status SET created_at = datetime('now', '-2 days')",
                [],
            ).unwrap();
        }
        let deleted = store.cleanup_old_pending(1).unwrap();
        assert_eq!(deleted, 1);
    }

    #[test]
    fn test_prune_expired() {
        let store = test_store();
        store.queue_message("topic", b"data", 0).unwrap();
        assert_eq!(store.pending_count().unwrap(), 1);
        // Backdate the record so it appears expired
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "UPDATE pending_status SET created_at = datetime('now', '-2 hours')",
                [],
            ).unwrap();
        }
        let pruned = store.prune_expired(1).unwrap();
        assert_eq!(pruned, 1);
    }
}
