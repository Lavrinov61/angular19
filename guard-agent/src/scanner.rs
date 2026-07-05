//! Security scan orchestrator — periodic Defender checks and CDR scans.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use rumqttc::QoS;
use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::sync::Semaphore;
use tracing::{debug, error, info, warn};

use svf_agent_core::mqtt;

use crate::AgentState;
use crate::defender;

/// Maximum number of concurrent scan operations (Defender + CDR).
const MAX_CONCURRENT_SCANS: usize = 2;

/// Semaphore to limit parallel scan operations.
static SCAN_SEMAPHORE: std::sync::LazyLock<Semaphore> =
    std::sync::LazyLock::new(|| Semaphore::new(MAX_CONCURRENT_SCANS));

/// Accumulated scan metrics updated after each CDR scan cycle.
static LAST_SCAN_DURATION_MS: AtomicU64 = AtomicU64::new(0);
static FILES_SCANNED: AtomicU64 = AtomicU64::new(0);
static THREATS_FOUND: AtomicU32 = AtomicU32::new(0);

/// Read the last scan duration for health checks.
pub fn last_scan_duration_ms() -> u64 {
    LAST_SCAN_DURATION_MS.load(Ordering::Relaxed)
}

/// Read the active threat count for health checks.
pub fn threats_found() -> u32 {
    THREATS_FOUND.load(Ordering::Relaxed)
}

/// Health status of the guard-agent.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GuardHealth {
    Healthy,
    Scanning,
    Degraded,
    Critical,
}

impl std::fmt::Display for GuardHealth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Healthy => f.write_str("healthy"),
            Self::Scanning => f.write_str("scanning"),
            Self::Degraded => f.write_str("degraded"),
            Self::Critical => f.write_str("critical"),
        }
    }
}

/// Self-monitoring health report for the guard-agent process.
#[derive(Debug, Clone, Serialize)]
pub struct GuardHealthReport {
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub last_scan_duration_ms: u64,
    pub files_scanned: u64,
    pub threats_found: u32,
    pub health_status: GuardHealth,
}

/// Collect health metrics for the current guard-agent process.
fn collect_health_report() -> GuardHealthReport {
    let pid = std::process::id();
    let sysinfo_pid = Pid::from_u32(pid);

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), true);
    std::thread::sleep(Duration::from_millis(200));
    sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), true);

    let (cpu_percent, memory_mb) = if let Some(proc) = sys.process(sysinfo_pid) {
        (proc.cpu_usage(), proc.memory() / (1024 * 1024))
    } else {
        (0.0, 0)
    };

    let last_scan_ms = LAST_SCAN_DURATION_MS.load(Ordering::Relaxed);
    let files = FILES_SCANNED.load(Ordering::Relaxed);
    let threats = THREATS_FOUND.load(Ordering::Relaxed);

    let health_status = if threats > 0 {
        GuardHealth::Critical
    } else if last_scan_ms > 60_000 {
        GuardHealth::Degraded
    } else if last_scan_ms > 0 {
        GuardHealth::Scanning
    } else {
        GuardHealth::Healthy
    };

    GuardHealthReport {
        pid,
        cpu_percent,
        memory_mb,
        last_scan_duration_ms: last_scan_ms,
        files_scanned: files,
        threats_found: threats,
        health_status,
    }
}

/// Guard heartbeat published on each Defender check.
#[derive(Debug, Serialize)]
pub struct GuardHeartbeat {
    pub agent_id: String,
    pub studio_id: String,
    pub timestamp: String,
    pub defender: defender::DefenderStatus,
    pub uptime_secs: u64,
    pub guard_health: GuardHealthReport,
}

/// Security threat event published when Defender detects threats.
#[derive(Debug, Serialize)]
pub struct SecurityThreatEvent {
    pub agent_id: String,
    pub studio_id: String,
    pub timestamp: String,
    pub threats: Vec<defender::ThreatInfo>,
}

/// Extensions of files to exclude from CDR scan reports (temp/cache/lock files).
const EXCLUDED_EXTENSIONS: &[&str] = &[
    "log", "tmp", "temp", "cache", "bak",
    "db-shm", "db-wal", "db-journal",
    "lock", "pid",
];

/// Check if a file should be skipped in CDR scan results.
fn should_skip_file(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if EXCLUDED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
            return true;
        }
    }
    // Skip hidden files (starts with .)
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_should_skip_excluded_extensions() {
        let excluded = vec![
            "file.log", "data.tmp", "data.temp", "app.cache", "old.bak",
            "db.db-shm", "db.db-wal", "db.db-journal", "app.lock", "process.pid",
        ];
        for name in excluded {
            let path = PathBuf::from(name);
            assert!(should_skip_file(&path), "Should skip: {name}");
        }
    }

    #[test]
    fn test_should_not_skip_normal_files() {
        let normal = vec![
            "document.pdf", "image.png", "script.rs", "config.toml",
            "data.json", "notes.txt", "report.xlsx",
        ];
        for name in normal {
            let path = PathBuf::from(name);
            assert!(!should_skip_file(&path), "Should NOT skip: {name}");
        }
    }

    #[test]
    fn test_should_skip_hidden_files() {
        let hidden = vec![".gitignore", ".env", ".hidden_file", ".DS_Store"];
        for name in hidden {
            let path = PathBuf::from(name);
            assert!(should_skip_file(&path), "Should skip hidden: {name}");
        }
    }

    #[test]
    fn test_should_skip_case_insensitive_extensions() {
        // Extensions are lowercased before comparison
        let cases = vec!["FILE.LOG", "data.TMP", "old.BAK", "app.Lock"];
        for name in cases {
            let path = PathBuf::from(name);
            assert!(should_skip_file(&path), "Should skip (case): {name}");
        }
    }

    #[test]
    fn test_should_skip_no_extension() {
        // File with no extension and not hidden - should NOT skip
        let path = PathBuf::from("Makefile");
        assert!(!should_skip_file(&path));
    }

    #[test]
    fn test_guard_health_display() {
        assert_eq!(GuardHealth::Healthy.to_string(), "healthy");
        assert_eq!(GuardHealth::Scanning.to_string(), "scanning");
        assert_eq!(GuardHealth::Degraded.to_string(), "degraded");
        assert_eq!(GuardHealth::Critical.to_string(), "critical");
    }

    #[test]
    fn test_guard_health_determination_logic() {
        // Replicate the health determination logic from collect_health_report
        let cases: Vec<(u32, u64, GuardHealth)> = vec![
            (1, 0, GuardHealth::Critical),      // threats > 0 → Critical
            (5, 30_000, GuardHealth::Critical),  // threats > 0 even with normal scan
            (0, 120_000, GuardHealth::Degraded), // scan > 60s → Degraded
            (0, 60_001, GuardHealth::Degraded),  // scan just over 60s
            (0, 30_000, GuardHealth::Scanning),  // scan > 0 → Scanning
            (0, 1, GuardHealth::Scanning),       // scan = 1ms
            (0, 0, GuardHealth::Healthy),        // no scan, no threats
        ];
        for (threats, scan_ms, expected) in cases {
            let health = if threats > 0 {
                GuardHealth::Critical
            } else if scan_ms > 60_000 {
                GuardHealth::Degraded
            } else if scan_ms > 0 {
                GuardHealth::Scanning
            } else {
                GuardHealth::Healthy
            };
            assert_eq!(
                health.to_string(),
                expected.to_string(),
                "threats={threats}, scan_ms={scan_ms}"
            );
        }
    }

    #[test]
    fn test_excluded_extensions_list_completeness() {
        // Verify all 10 excluded extensions are present
        assert_eq!(EXCLUDED_EXTENSIONS.len(), 10);
        assert!(EXCLUDED_EXTENSIONS.contains(&"log"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"tmp"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"temp"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"cache"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"bak"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"db-shm"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"db-wal"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"db-journal"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"lock"));
        assert!(EXCLUDED_EXTENSIONS.contains(&"pid"));
    }

    #[test]
    fn test_should_skip_with_directory_path() {
        // Full path, extension on the final component
        let path = PathBuf::from("C:\\ProgramData\\app\\data.log");
        assert!(should_skip_file(&path));

        let path = PathBuf::from("C:\\ProgramData\\app\\data.pdf");
        assert!(!should_skip_file(&path));
    }

    #[test]
    fn test_guard_health_serialize() {
        let health = GuardHealth::Critical;
        let json = serde_json::to_string(&health).unwrap();
        assert_eq!(json, r#""critical""#);

        let health = GuardHealth::Healthy;
        let json = serde_json::to_string(&health).unwrap();
        assert_eq!(json, r#""healthy""#);
    }
}

/// Run the periodic security scan loop.
pub async fn run(state: Arc<AgentState>) {
    let defender_interval = Duration::from_secs(
        state.config.guard.defender_check_interval_secs,
    );
    let scan_interval = Duration::from_secs(
        state.config.guard.scan_interval_secs,
    );

    let mut defender_ticker = tokio::time::interval(defender_interval);
    let mut scan_ticker = tokio::time::interval(scan_interval);

    // Skip the first immediate tick for CDR — let initial baseline build on first defender check
    scan_ticker.tick().await;

    // Run initial CDR baseline scan (populates known_files without reporting changes)
    {
        let mut scanner = state.cdr_scanner.write().await;
        let results = scanner.scan().await;
        info!(dirs_scanned = results.len(), "CDR baseline scan complete");
    }

    loop {
        tokio::select! {
            _ = defender_ticker.tick() => {
                check_defender_and_publish(&state).await;
            }
            _ = scan_ticker.tick() => {
                run_cdr_scan_and_publish(&state).await;
            }
        }
    }
}

/// Check Defender status, publish heartbeat, and alert on threats.
async fn check_defender_and_publish(state: &AgentState) {
    let _permit = match SCAN_SEMAPHORE.acquire().await {
        Ok(p) => p,
        Err(_) => {
            error!("Scan semaphore closed unexpectedly");
            return;
        }
    };
    let scan_start = Instant::now();
    let status = defender::check_defender_status().await;
    let defender_duration_ms = scan_start.elapsed().as_millis() as u64;

    // Update threat counter
    THREATS_FOUND.store(status.threats.len() as u32, Ordering::Relaxed);

    // If threats found, publish threat event
    if !status.threats.is_empty() {
        let event = SecurityThreatEvent {
            agent_id: state.config.base.agent.agent_id.clone(),
            studio_id: state.config.base.agent.studio_id.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            threats: status.threats.clone(),
        };

        let prefix = guard_prefix(state);
        let topic = format!("{prefix}/events/threat");
        publish_json(state, &topic, &event).await;

        // Auto-alert for High/Severe threats
        for threat in &status.threats {
            if threat.severity == "High" || threat.severity == "Severe" {
                error!(
                    threat = %threat.name,
                    severity = %threat.severity,
                    path = %threat.file_path,
                    "HIGH SEVERITY THREAT detected"
                );
                let alert = serde_json::json!({
                    "type": "threat_alert",
                    "severity": threat.severity,
                    "threat_name": threat.name,
                    "file_path": threat.file_path,
                    "action_taken": threat.action_taken,
                    "agent_id": state.config.base.agent.agent_id,
                    "studio_id": state.config.base.agent.studio_id,
                    "timestamp_ms": chrono::Utc::now().timestamp_millis(),
                });
                let alert_topic = format!("{prefix}/guard/alerts");
                publish_json(state, &alert_topic, &alert).await;
            }
        }
    }

    // Warn if realtime protection is off
    if !status.realtime_enabled {
        warn!("Windows Defender realtime protection is DISABLED");
    }
    if !status.signatures_updated {
        warn!(days = status.days_since_update, "Defender signatures outdated");
    }

    // Collect self-monitoring metrics
    let health = collect_health_report();
    info!(
        pid = health.pid,
        cpu = health.cpu_percent,
        mem_mb = health.memory_mb,
        scan_ms = defender_duration_ms,
        status = %health.health_status,
        "Guard health report"
    );

    // Publish heartbeat
    let heartbeat = GuardHeartbeat {
        agent_id: state.config.base.agent.agent_id.clone(),
        studio_id: state.config.base.agent.studio_id.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        defender: status,
        uptime_secs: state.start_time.elapsed().as_secs(),
        guard_health: health,
    };

    let prefix = guard_prefix(state);
    let topic = format!("{prefix}/heartbeat");
    publish_json(state, &topic, &heartbeat).await;
}

/// Run CDR scan and publish results for directories with changes.
async fn run_cdr_scan_and_publish(state: &AgentState) {
    let _permit = match SCAN_SEMAPHORE.acquire().await {
        Ok(p) => p,
        Err(_) => {
            error!("Scan semaphore closed unexpectedly");
            return;
        }
    };
    let scan_start = Instant::now();
    let results = {
        let mut scanner = state.cdr_scanner.write().await;
        scanner.scan().await
    };
    let scan_duration_ms = scan_start.elapsed().as_millis() as u64;
    LAST_SCAN_DURATION_MS.store(scan_duration_ms, Ordering::Relaxed);

    // Count total files across all scan results
    let total_files: u64 = results.iter().map(|r| {
        (r.new_files.len() + r.modified_files.len() + r.deleted_files.len()) as u64
    }).sum();
    FILES_SCANNED.store(total_files, Ordering::Relaxed);

    debug!(duration_ms = scan_duration_ms, files = total_files, "CDR scan complete");

    let prefix = guard_prefix(state);

    for mut result in results {
        // Filter out excluded files (temp, cache, hidden) from scan results
        let before_new = result.new_files.len();
        let before_mod = result.modified_files.len();
        result.new_files.retain(|f| !should_skip_file(Path::new(&f.path)));
        result.modified_files.retain(|f| !should_skip_file(Path::new(&f.path)));
        result.deleted_files.retain(|f| !should_skip_file(Path::new(f)));

        let filtered = (before_new - result.new_files.len())
            + (before_mod - result.modified_files.len());
        if filtered > 0 {
            debug!(filtered, "Excluded temp/cache files from CDR report");
        }

        let has_changes = !result.new_files.is_empty()
            || !result.modified_files.is_empty()
            || !result.deleted_files.is_empty();

        if has_changes {
            let topic = format!("{prefix}/events/scan");
            publish_json(state, &topic, &result).await;
        }
    }
}

/// Force an immediate CDR scan (triggered by MQTT command).
pub async fn force_scan(state: &AgentState) {
    info!("Force CDR scan requested");
    run_cdr_scan_and_publish(state).await;
}

fn guard_prefix(state: &AgentState) -> String {
    mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    )
}

async fn publish_json<T: Serialize>(state: &AgentState, topic: &str, payload: &T) {
    let json = match serde_json::to_vec(payload) {
        Ok(j) => j,
        Err(e) => {
            error!(error = %e, "Failed to serialize payload");
            return;
        }
    };

    if state.mqtt_handle.is_connected().await {
        if let Err(e) = state
            .mqtt_handle
            .publish(topic, QoS::AtLeastOnce, false, json.clone())
            .await
        {
            warn!(error = %e, "MQTT publish failed, queueing offline");
            if let Err(e) = state.offline_store.queue_message(topic, &json, 1) {
                error!(error = %e, "Failed to queue message to offline store");
            }
        }
    } else {
        if let Err(e) = state.offline_store.queue_message(topic, &json, 1) {
            error!(error = %e, "Failed to queue message to offline store");
        }
    }
}
