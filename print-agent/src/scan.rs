//! Scan file watcher: monitors a directory for new scans from Canon,
//! uploads to S3/MinIO, publishes MQTT notification.
//!
//! Canon iR C3226i can scan to an SMB share. This module watches that
//! shared directory for new files, waits for them to be fully written,
//! uploads to S3, moves to processed dir, and notifies via MQTT.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use rumqttc::QoS;
use tracing::{debug, error, info, warn};

use svf_agent_core::mqtt;

// ── Config ──

/// Scan watcher configuration (deserialized from config.toml `[scan]` section).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ScanConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Directory to watch for incoming scan files (SMB share mount point).
    #[serde(default = "default_watch_dir")]
    pub watch_dir: String,
    /// Directory to move processed files into.
    #[serde(default = "default_processed_dir")]
    pub processed_dir: String,
    /// How many seconds the file size must remain stable before processing.
    #[serde(default = "default_file_stable_secs")]
    pub file_stable_secs: u64,
    /// Base URL for S3/MinIO upload (PUT <upload_url>/<s3_key>).
    #[serde(default)]
    pub upload_url: String,
    /// Allowed file extensions (empty = allow all).
    #[serde(default = "default_allowed_extensions")]
    pub allowed_extensions: Vec<String>,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            watch_dir: default_watch_dir(),
            processed_dir: default_processed_dir(),
            file_stable_secs: default_file_stable_secs(),
            upload_url: String::new(),
            allowed_extensions: default_allowed_extensions(),
        }
    }
}

fn default_watch_dir() -> String {
    r"C:\ProgramData\SvoePhoto\scans\incoming".into()
}

fn default_processed_dir() -> String {
    r"C:\ProgramData\SvoePhoto\scans\processed".into()
}

fn default_file_stable_secs() -> u64 {
    3
}

fn default_allowed_extensions() -> Vec<String> {
    vec![
        "pdf".into(),
        "jpg".into(),
        "jpeg".into(),
        "png".into(),
        "tiff".into(),
        "tif".into(),
    ]
}

// ── Data types ──

/// MQTT notification payload for a processed scan file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ScanNotification {
    pub file_name: String,
    pub file_size: u64,
    pub s3_key: String,
    pub mime_type: String,
    /// ISO 8601 timestamp.
    pub scanned_at: String,
}

// ── Background task ──

/// Background task: watch scan directory for new files, upload, and notify.
///
/// Uses polling-based approach for maximum compatibility with network shares
/// (SMB mounts don't reliably trigger OS file-change notifications).
pub async fn run(state: Arc<crate::AgentState>) {
    let config = &state.config.scan;
    if !config.enabled {
        debug!("Scan file watcher disabled");
        return;
    }

    if config.upload_url.is_empty() {
        warn!("Scan upload URL not configured, disabling scan watcher");
        return;
    }

    // Create directories if they don't exist
    if let Err(e) = std::fs::create_dir_all(&config.watch_dir) {
        error!(dir = %config.watch_dir, "Failed to create watch directory: {e}");
        return;
    }
    if let Err(e) = std::fs::create_dir_all(&config.processed_dir) {
        error!(dir = %config.processed_dir, "Failed to create processed directory: {e}");
        return;
    }

    info!(
        watch_dir = %config.watch_dir,
        processed_dir = %config.processed_dir,
        "Scan file watcher started"
    );

    // Initial delay for MQTT to connect
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Polling interval: check every 2 seconds
    let mut ticker = tokio::time::interval(Duration::from_secs(2));

    let in_flight: Arc<tokio::sync::Mutex<std::collections::HashSet<PathBuf>>> =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new()));
    // Track failed files with retry count to avoid infinite retry loop
    let failed_files: Arc<tokio::sync::Mutex<std::collections::HashMap<PathBuf, (u32, std::time::Instant)>>> =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    const MAX_RETRIES: u32 = 5;
    const RETRY_BACKOFF_SECS: u64 = 60; // Wait 60s between retries

    loop {
        ticker.tick().await;

        let files = match list_incoming_files(config) {
            Ok(f) => f,
            Err(e) => {
                debug!("Failed to list incoming files: {e}");
                continue;
            }
        };

        for path in files {
            // Skip files currently being processed
            {
                let set = in_flight.lock().await;
                if set.contains(&path) {
                    continue;
                }
            }
            // Skip files that failed too many times or are in backoff
            {
                let fails = failed_files.lock().await;
                if let Some((count, last_attempt)) = fails.get(&path) {
                    if *count >= MAX_RETRIES {
                        continue; // Permanently failed — needs manual intervention
                    }
                    if last_attempt.elapsed() < Duration::from_secs(RETRY_BACKOFF_SECS * (*count as u64)) {
                        continue; // Still in backoff period
                    }
                }
            }

            in_flight.lock().await.insert(path.clone());
            let state = Arc::clone(&state);
            let in_flight_clone = Arc::clone(&in_flight);
            let failed_clone = Arc::clone(&failed_files);
            let path_clone = path.clone();
            tokio::spawn(async move {
                let result = process_scan_file(&path_clone, &state).await;
                in_flight_clone.lock().await.remove(&path_clone);
                match result {
                    Ok(()) => {
                        // Success — remove from failed tracker
                        failed_clone.lock().await.remove(&path_clone);
                    }
                    Err(e) => {
                        let mut fails = failed_clone.lock().await;
                        let entry = fails.entry(path_clone.clone()).or_insert((0, std::time::Instant::now()));
                        entry.0 += 1;
                        entry.1 = std::time::Instant::now();
                        if entry.0 >= MAX_RETRIES {
                            error!(path = %path_clone.display(), retries = entry.0, "Scan file permanently failed after {MAX_RETRIES} attempts: {e}");
                        } else {
                            warn!(path = %path_clone.display(), retry = entry.0, "Scan file failed, will retry: {e}");
                        }
                    }
                }
            });
        }
    }
}

/// List files in the watch directory that match allowed extensions.
fn list_incoming_files(config: &ScanConfig) -> Result<Vec<PathBuf>> {
    let entries = std::fs::read_dir(&config.watch_dir)
        .context("Failed to read watch directory")?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Check extension filter
        if !config.allowed_extensions.is_empty() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();

            if !config.allowed_extensions.iter().any(|a| a.to_lowercase() == ext) {
                continue;
            }
        }

        files.push(path);
    }

    Ok(files)
}

// ── File processing ──

/// Process a single scan file: wait stable, upload, move, notify.
async fn process_scan_file(path: &Path, state: &crate::AgentState) -> Result<()> {
    let file_name = path
        .file_name()
        .context("File has no name")?
        .to_string_lossy()
        .to_string();

    debug!(file = %file_name, "Processing scan file");

    // 1. Wait for file to be fully written (size must stabilize)
    wait_for_stable(path, state.config.scan.file_stable_secs).await?;

    // 2. Read file metadata
    let metadata = tokio::fs::metadata(path)
        .await
        .context("Failed to read file metadata")?;
    let file_size = metadata.len();

    if file_size == 0 {
        bail!("File is empty, skipping: {}", path.display());
    }

    // 3. Determine MIME type from extension
    let mime = detect_mime(path);

    // 4. Upload to S3/MinIO
    let date_prefix = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let s3_key = format!("scans/{date_prefix}/{file_name}");
    upload_file(path, &s3_key, mime, state)
        .await
        .context("S3 upload failed")?;

    // 5. Move to processed directory
    let dest = PathBuf::from(&state.config.scan.processed_dir).join(&file_name);
    // If destination exists, add timestamp suffix to avoid overwrite
    let dest = if dest.exists() {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let ext = path.extension().unwrap_or_default().to_string_lossy();
        let ts = chrono::Utc::now().format("%H%M%S").to_string();
        PathBuf::from(&state.config.scan.processed_dir).join(format!("{stem}_{ts}.{ext}"))
    } else {
        dest
    };

    if let Err(e) = tokio::fs::rename(path, &dest).await {
        // rename fails across filesystems/drives — fallback to copy+delete
        warn!("rename failed ({e}), falling back to copy+delete");
        tokio::fs::copy(path, &dest)
            .await
            .context("Failed to copy file to processed dir")?;
        let _ = tokio::fs::remove_file(path).await;
    }

    // 6. Publish MQTT notification
    let notification = ScanNotification {
        file_name: file_name.clone(),
        file_size,
        s3_key: s3_key.clone(),
        mime_type: mime.to_string(),
        scanned_at: chrono::Utc::now().to_rfc3339(),
    };

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );
    let topic = format!("{prefix}/scan/new");

    match serde_json::to_vec(&notification) {
        Ok(payload) => {
            if let Err(e) = state
                .mqtt_handle
                .publish(&topic, QoS::AtLeastOnce, false, payload)
                .await
            {
                warn!(file = %file_name, "Failed to publish scan notification: {e}");
            }
        }
        Err(e) => warn!("Failed to serialize scan notification: {e}"),
    }

    info!(
        file = %file_name,
        size = file_size,
        s3_key = %s3_key,
        "Scan file uploaded and notified"
    );

    Ok(())
}

/// Wait until the file size remains stable for N seconds.
///
/// This handles the case where Canon is still writing the file to the SMB share.
async fn wait_for_stable(path: &Path, stable_secs: u64) -> Result<()> {
    let check_interval = Duration::from_millis(500);
    let required_checks = (stable_secs * 2) as u32; // 500ms interval
    let max_wait = Duration::from_secs(stable_secs * 20); // safety timeout

    let mut last_size = 0u64;
    let mut stable_count = 0u32;
    let start = tokio::time::Instant::now();

    loop {
        if start.elapsed() > max_wait {
            bail!(
                "File did not stabilize within {} seconds: {}",
                max_wait.as_secs(),
                path.display()
            );
        }

        tokio::time::sleep(check_interval).await;

        match tokio::fs::metadata(path).await {
            Ok(m) => {
                let current_size = m.len();
                if current_size == last_size && current_size > 0 {
                    stable_count += 1;
                    if stable_count >= required_checks {
                        return Ok(());
                    }
                } else {
                    last_size = current_size;
                    stable_count = 0;
                }
            }
            Err(_) => bail!("File disappeared while waiting: {}", path.display()),
        }
    }
}

/// Detect MIME type from file extension.
fn detect_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("pdf") => "application/pdf",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("tiff" | "tif") => "image/tiff",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// Upload file bytes to S3/MinIO via HTTP PUT.
async fn upload_file(
    path: &Path,
    s3_key: &str,
    mime: &str,
    state: &crate::AgentState,
) -> Result<()> {
    let url = format!(
        "{}/{}",
        state.config.scan.upload_url.trim_end_matches('/'),
        s3_key
    );

    let bytes = tokio::fs::read(path)
        .await
        .context("Failed to read file for upload")?;

    debug!(
        url = %url,
        size = bytes.len(),
        mime,
        "Uploading scan file to S3"
    );

    let resp = state
        .http_client
        .put(&url)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .context("S3 PUT request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("S3 upload failed: {status} — {body}");
    }

    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_detect_mime() {
        assert_eq!(detect_mime(Path::new("scan.pdf")), "application/pdf");
        assert_eq!(detect_mime(Path::new("photo.jpg")), "image/jpeg");
        assert_eq!(detect_mime(Path::new("photo.JPEG")), "image/jpeg");
        assert_eq!(detect_mime(Path::new("image.png")), "image/png");
        assert_eq!(detect_mime(Path::new("doc.tiff")), "image/tiff");
        assert_eq!(detect_mime(Path::new("doc.tif")), "image/tiff");
        assert_eq!(detect_mime(Path::new("file.xyz")), "application/octet-stream");
        assert_eq!(detect_mime(Path::new("noext")), "application/octet-stream");
    }

    #[test]
    fn test_scan_notification_serialization() {
        let notif = ScanNotification {
            file_name: "test.pdf".into(),
            file_size: 1024,
            s3_key: "scans/2026-04-05/test.pdf".into(),
            mime_type: "application/pdf".into(),
            scanned_at: "2026-04-05T12:00:00Z".into(),
        };

        let json = serde_json::to_string(&notif).unwrap();
        assert!(json.contains("test.pdf"));
        assert!(json.contains("1024"));
        assert!(json.contains("scans/2026-04-05/test.pdf"));
    }

    #[test]
    fn test_scan_config_defaults() {
        let config = ScanConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.file_stable_secs, 3);
        assert!(!config.allowed_extensions.is_empty());
        assert!(config.allowed_extensions.contains(&"pdf".to_string()));
        assert!(config.allowed_extensions.contains(&"jpg".to_string()));
    }

    #[test]
    fn test_list_incoming_files_with_extension_filter() {
        let dir = tempfile::tempdir().unwrap();
        let config = ScanConfig {
            enabled: true,
            watch_dir: dir.path().to_string_lossy().to_string(),
            processed_dir: String::new(),
            file_stable_secs: 1,
            upload_url: String::new(),
            allowed_extensions: vec!["pdf".into(), "jpg".into()],
        };

        // Create test files
        std::fs::File::create(dir.path().join("scan.pdf"))
            .unwrap()
            .write_all(b"pdf")
            .unwrap();
        std::fs::File::create(dir.path().join("photo.jpg"))
            .unwrap()
            .write_all(b"jpg")
            .unwrap();
        std::fs::File::create(dir.path().join("data.txt"))
            .unwrap()
            .write_all(b"txt")
            .unwrap();

        let files = list_incoming_files(&config).unwrap();
        assert_eq!(files.len(), 2);

        let names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"scan.pdf".to_string()));
        assert!(names.contains(&"photo.jpg".to_string()));
        assert!(!names.contains(&"data.txt".to_string()));
    }

    #[tokio::test]
    async fn test_in_flight_dedup() {
        use std::collections::HashSet;
        use std::path::PathBuf;

        let set: Arc<tokio::sync::Mutex<HashSet<PathBuf>>> =
            Arc::new(tokio::sync::Mutex::new(HashSet::new()));
        let path = PathBuf::from("test.pdf");

        set.lock().await.insert(path.clone());
        assert!(set.lock().await.contains(&path));

        set.lock().await.remove(&path);
        assert!(!set.lock().await.contains(&path));
    }

    #[test]
    fn test_list_incoming_files_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let config = ScanConfig {
            enabled: true,
            watch_dir: dir.path().to_string_lossy().to_string(),
            processed_dir: String::new(),
            file_stable_secs: 1,
            upload_url: String::new(),
            allowed_extensions: vec![],
        };

        let files = list_incoming_files(&config).unwrap();
        assert!(files.is_empty());
    }
}
