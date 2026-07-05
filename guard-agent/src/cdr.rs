//! CDR (Content Disarm & Reconstruct) — file integrity scanning.
//!
//! Watches configured directories, computes SHA-256 hashes, and detects
//! new/changed/deleted files between scan passes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use notify::{Event, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Sha256, Digest};
use tracing::{debug, info, warn};

/// CDR scanner — tracks file hashes across scans.
pub struct CdrScanner {
    known_files: HashMap<PathBuf, FileInfo>,
    watch_dirs: Vec<PathBuf>,
    max_size: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct FileInfo {
    hash: String,
    size: u64,
    modified: SystemTime,
}

/// Result of a single CDR scan pass.
#[derive(Debug, Clone, Serialize)]
pub struct CdrScanResult {
    pub scan_timestamp: String,
    pub directory: String,
    pub new_files: Vec<FileChange>,
    pub modified_files: Vec<FileChange>,
    pub deleted_files: Vec<String>,
    pub total_files_scanned: usize,
    pub scan_duration_ms: u64,
}

/// A changed file entry.
#[derive(Debug, Clone, Serialize)]
pub struct FileChange {
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub previous_hash: Option<String>,
}

impl CdrScanner {
    pub fn new(watch_dirs: Vec<PathBuf>, max_size: u64) -> Self {
        Self {
            known_files: HashMap::new(),
            watch_dirs,
            max_size,
        }
    }

    /// Run a full scan across all watch directories.
    /// Returns scan results for each directory that has changes.
    pub async fn scan(&mut self) -> Vec<CdrScanResult> {
        let mut results = Vec::new();

        for dir in self.watch_dirs.clone() {
            let start = std::time::Instant::now();
            let result = self.scan_directory(&dir).await;
            let elapsed = start.elapsed().as_millis() as u64;

            let has_changes = !result.new_files.is_empty()
                || !result.modified_files.is_empty()
                || !result.deleted_files.is_empty();

            let scan_result = CdrScanResult {
                scan_timestamp: chrono::Utc::now().to_rfc3339(),
                directory: dir.to_string_lossy().to_string(),
                new_files: result.new_files,
                modified_files: result.modified_files,
                deleted_files: result.deleted_files,
                total_files_scanned: result.total_scanned,
                scan_duration_ms: elapsed,
            };

            if has_changes {
                info!(
                    dir = %dir.display(),
                    new = scan_result.new_files.len(),
                    modified = scan_result.modified_files.len(),
                    deleted = scan_result.deleted_files.len(),
                    "CDR scan found changes"
                );
            }

            results.push(scan_result);
        }

        results
    }

    async fn scan_directory(&mut self, dir: &Path) -> ScanPass {
        let mut current_files: HashMap<PathBuf, FileInfo> = HashMap::new();
        let mut new_files = Vec::new();
        let mut modified_files = Vec::new();
        let mut total_scanned = 0usize;

        // Collect all files recursively
        if let Ok(entries) = collect_files_recursive(dir, self.max_size) {
            for entry_path in entries {
                match hash_file(&entry_path).await {
                    Ok((hash, size, modified)) => {
                        total_scanned += 1;
                        let info = FileInfo { hash: hash.clone(), size, modified };
                        let path_str = entry_path.to_string_lossy().to_string();

                        if let Some(prev) = self.known_files.get(&entry_path) {
                            if prev.hash != hash {
                                modified_files.push(FileChange {
                                    path: path_str,
                                    hash: hash.clone(),
                                    size,
                                    previous_hash: Some(prev.hash.clone()),
                                });
                            }
                        } else {
                            // First scan: don't report all existing files as "new"
                            if !self.known_files.is_empty() {
                                new_files.push(FileChange {
                                    path: path_str,
                                    hash: hash.clone(),
                                    size,
                                    previous_hash: None,
                                });
                            }
                        }

                        current_files.insert(entry_path, info);
                    }
                    Err(e) => {
                        warn!(path = %entry_path.display(), error = %e, "Failed to hash file");
                    }
                }
            }
        }

        // Detect deleted files (only after first scan)
        let deleted_files: Vec<String> = if !self.known_files.is_empty() {
            self.known_files.keys()
                .filter(|p| p.starts_with(dir) && !current_files.contains_key(*p))
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        } else {
            Vec::new()
        };

        // Remove deleted entries from known_files
        for deleted in &deleted_files {
            self.known_files.remove(&PathBuf::from(deleted));
        }

        // Update known_files with current state
        for (path, info) in current_files {
            self.known_files.insert(path, info);
        }

        ScanPass {
            new_files,
            modified_files,
            deleted_files,
            total_scanned,
        }
    }
}

struct ScanPass {
    new_files: Vec<FileChange>,
    modified_files: Vec<FileChange>,
    deleted_files: Vec<String>,
    total_scanned: usize,
}

/// Maximum directory recursion depth to prevent infinite traversal.
const MAX_RECURSION_DEPTH: u32 = 10;

/// Recursively collect file paths under `dir`, skipping files larger than `max_size`.
fn collect_files_recursive(dir: &Path, max_size: u64) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_recursive(dir, max_size, 0, &mut files)?;
    Ok(files)
}

fn collect_recursive(dir: &Path, max_size: u64, depth: u32, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if depth >= MAX_RECURSION_DEPTH {
        warn!(dir = %dir.display(), depth, "Max recursion depth reached, skipping");
        return Ok(());
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            warn!(dir = %dir.display(), error = %e, "Cannot read directory");
            return Ok(());
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            collect_recursive(&path, max_size, depth + 1, out)?;
        } else if path.is_file() {
            if let Ok(meta) = path.metadata() {
                if meta.len() <= max_size {
                    out.push(path);
                }
            }
        }
    }

    Ok(())
}

/// Compute SHA-256 hash of a file.
async fn hash_file(path: &Path) -> anyhow::Result<(String, u64, SystemTime)> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        let data = std::fs::read(&path)?;
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash = hex::encode(hasher.finalize());
        Ok((hash, meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
    }).await?
}

/// Check integrity of a single file (hash and log).
async fn check_file_integrity(path: &Path) -> anyhow::Result<()> {
    let (hash, size, _modified) = hash_file(path).await?;
    info!(
        path = %path.display(),
        hash,
        size,
        "CDR: file integrity check"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_max_recursion_depth_constant() {
        assert_eq!(MAX_RECURSION_DEPTH, 10);
    }

    #[test]
    fn test_collect_recursive_respects_max_depth() {
        let tmp = std::env::temp_dir().join("cdr_test_depth");
        let _ = fs::remove_dir_all(&tmp);

        // Create a directory chain deeper than MAX_RECURSION_DEPTH
        let mut deepest = tmp.clone();
        for i in 0..12 {
            deepest = deepest.join(format!("level_{i}"));
        }
        fs::create_dir_all(&deepest).unwrap();
        // Put a file at the very bottom
        fs::write(deepest.join("deep.txt"), b"deep content").unwrap();
        // Put a file at a reachable level (depth 0)
        fs::write(tmp.join("shallow.txt"), b"shallow").unwrap();

        let files = collect_files_recursive(&tmp, u64::MAX).unwrap();
        // shallow.txt should be found
        assert!(files.iter().any(|p| p.file_name().unwrap() == "shallow.txt"));
        // deep.txt at depth 12 should NOT be found (MAX_RECURSION_DEPTH=10)
        assert!(!files.iter().any(|p| p.file_name().unwrap() == "deep.txt"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_collect_recursive_skips_large_files() {
        let tmp = std::env::temp_dir().join("cdr_test_size");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // Small file (5 bytes) - should be included
        fs::write(tmp.join("small.txt"), b"hello").unwrap();
        // Large file (1000 bytes) - should be excluded with max_size=100
        fs::write(tmp.join("large.txt"), vec![0u8; 1000]).unwrap();

        let files = collect_files_recursive(&tmp, 100).unwrap();
        assert!(files.iter().any(|p| p.file_name().unwrap() == "small.txt"));
        assert!(!files.iter().any(|p| p.file_name().unwrap() == "large.txt"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_collect_recursive_skips_symlinks() {
        // Symlink creation requires elevated privileges on Windows,
        // so we test the logic path: is_symlink() check in collect_recursive
        let tmp = std::env::temp_dir().join("cdr_test_symlink");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        fs::write(tmp.join("real.txt"), b"data").unwrap();

        // Attempt to create a symlink (may fail on Windows without admin)
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(tmp.join("real.txt"), tmp.join("link.txt")).unwrap();
            let files = collect_files_recursive(&tmp, u64::MAX).unwrap();
            assert!(files.iter().any(|p| p.file_name().unwrap() == "real.txt"));
            assert!(!files.iter().any(|p| p.file_name().unwrap() == "link.txt"));
        }

        // On Windows, just verify that normal files are collected
        #[cfg(windows)]
        {
            let files = collect_files_recursive(&tmp, u64::MAX).unwrap();
            assert!(files.iter().any(|p| p.file_name().unwrap() == "real.txt"));
        }

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_collect_recursive_nonexistent_dir() {
        let result = collect_files_recursive(
            Path::new("C:\\nonexistent_cdr_test_dir_xyz"),
            u64::MAX,
        );
        // Should return Ok with empty vec (warns but doesn't error)
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_cdr_scanner_new() {
        let dirs = vec![PathBuf::from("C:\\test1"), PathBuf::from("C:\\test2")];
        let scanner = CdrScanner::new(dirs.clone(), 1024 * 1024);
        assert_eq!(scanner.watch_dirs.len(), 2);
        assert_eq!(scanner.max_size, 1024 * 1024);
        assert!(scanner.known_files.is_empty());
    }

    #[tokio::test]
    async fn test_hash_file_deterministic() {
        let tmp = std::env::temp_dir().join("cdr_test_hash.txt");
        fs::write(&tmp, b"test content for hashing").unwrap();

        let (hash1, size1, _) = hash_file(&tmp).await.unwrap();
        let (hash2, size2, _) = hash_file(&tmp).await.unwrap();

        assert_eq!(hash1, hash2, "Same file must produce same hash");
        assert_eq!(size1, size2);
        assert_eq!(size1, 24); // "test content for hashing" = 24 bytes

        let _ = fs::remove_file(&tmp);
    }
}

/// Real-time filesystem monitor using `notify` crate.
///
/// Watches directories for Create/Modify events and runs integrity checks
/// on changed files. This complements the polling-based `CdrScanner::scan()`
/// by providing instant detection of filesystem changes.
pub async fn run_realtime_monitor(
    watch_dirs: &[String],
    _state: Arc<crate::AgentState>,
) -> anyhow::Result<()> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Event>(100);

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let _ = tx.blocking_send(event);
        }
    })
    .map_err(|e| anyhow::anyhow!("Failed to create file watcher: {e}"))?;

    for dir in watch_dirs {
        watcher
            .watch(Path::new(dir), RecursiveMode::Recursive)
            .map_err(|e| anyhow::anyhow!("Failed to watch {dir}: {e}"))?;
        info!(dir, "CDR: watching directory");
    }

    // Keep watcher alive for the duration of the loop
    let _watcher = watcher;

    while let Some(event) = rx.recv().await {
        match event.kind {
            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                for path in &event.paths {
                    if path.is_symlink() {
                        warn!(path = %path.display(), "CDR: skipping symlink");
                        continue;
                    }
                    debug!(path = %path.display(), kind = ?event.kind, "CDR: file change detected");
                    if let Err(e) = check_file_integrity(path).await {
                        warn!(path = %path.display(), error = %e, "CDR: integrity check failed");
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}
