//! Windows service management — status, start, stop, restart, health checks.
//!
//! Only whitelisted services can be managed.
//! The whitelist is configurable via `[monitor] allowed_services` in config.toml,
//! falling back to a built-in default list.

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// Default service whitelist — used when config does not specify `allowed_services`.
const DEFAULT_ALLOWED_SERVICES: &[&str] = &[
    "SvfPrintAgent",
    "SvfPosAgent",
    "SvfMonitorAgent",
    "SvfGuardAgent",
    "InpasSmartSale",
    "AtolWebServer",
];

#[derive(Debug, Deserialize)]
pub struct ServiceRequest {
    pub request_id: String,
    pub service_name: String,
    /// "status" | "start" | "stop" | "restart" | "health"
    pub action: String,
}

#[derive(Debug, Serialize)]
pub struct ServiceResult {
    pub request_id: String,
    pub service_name: String,
    pub action: String,
    pub success: bool,
    pub state: String,
    pub error: Option<String>,
}

/// Enhanced service health: status + PID alive + memory usage.
#[derive(Debug, Serialize)]
pub struct ServiceHealth {
    pub name: String,
    pub status: String,
    pub pid: Option<u32>,
    pub memory_mb: Option<u64>,
    pub healthy: bool,
}

/// Check if a service name is in the allowed list.
///
/// If `configured` is non-empty, use it; otherwise fall back to the built-in default.
pub fn is_service_allowed(service_name: &str, configured: &[String]) -> bool {
    if configured.is_empty() {
        DEFAULT_ALLOWED_SERVICES
            .iter()
            .any(|&s| s.eq_ignore_ascii_case(service_name))
    } else {
        configured
            .iter()
            .any(|s| s.eq_ignore_ascii_case(service_name))
    }
}

/// Enhanced service health check: sc query status + PID + memory.
pub async fn check_service_health(service_name: &str) -> ServiceHealth {
    let status = match query_service(service_name).await {
        Ok(s) => s,
        Err(_) => "UNKNOWN".into(),
    };
    let pid = get_service_pid(service_name).await;
    let memory_mb = match pid {
        Some(p) => get_process_memory_mb(p),
        None => None,
    };
    let healthy = status == "RUNNING" && pid.is_some();

    ServiceHealth {
        name: service_name.to_string(),
        status,
        pid,
        memory_mb,
        healthy,
    }
}

/// Execute a service management action.
///
/// `allowed_services` comes from config; if empty, uses the built-in default list.
pub async fn manage(req: ServiceRequest, allowed_services: &[String]) -> ServiceResult {
    // Validate service name against whitelist
    if !is_service_allowed(&req.service_name, allowed_services) {
        warn!(service = %req.service_name, "Service not in whitelist");
        return ServiceResult {
            request_id: req.request_id,
            service_name: req.service_name,
            action: req.action,
            success: false,
            state: String::new(),
            error: Some("Service not in whitelist".into()),
        };
    }

    let result = match req.action.as_str() {
        "status" => query_service(&req.service_name).await,
        "start" => sc_command("start", &req.service_name).await,
        "stop" => sc_command("stop", &req.service_name).await,
        "restart" => restart_service(&req.service_name).await,
        "health" => {
            let health = check_service_health(&req.service_name).await;
            let state = serde_json::to_string(&health).unwrap_or_else(|_| health.status.clone());
            return ServiceResult {
                request_id: req.request_id,
                service_name: req.service_name,
                action: req.action,
                success: health.healthy,
                state,
                error: None,
            };
        }
        other => {
            warn!(action = other, "Unknown service action");
            Err(format!("Unknown action: {other}"))
        }
    };

    match result {
        Ok(state) => ServiceResult {
            request_id: req.request_id,
            service_name: req.service_name,
            action: req.action,
            success: true,
            state,
            error: None,
        },
        Err(e) => ServiceResult {
            request_id: req.request_id,
            service_name: req.service_name,
            action: req.action,
            success: false,
            state: String::new(),
            error: Some(e),
        },
    }
}

/// Query the current state of a Windows service using `sc query`.
async fn query_service(name: &str) -> Result<String, String> {
    let output = run_sc(&["query", name]).await?;
    Ok(parse_sc_state(&output))
}

/// Run `sc start` or `sc stop`, then poll until the target state is reached.
async fn sc_command(action: &str, name: &str) -> Result<String, String> {
    let _output = run_sc(&[action, name]).await?;
    let target = match action {
        "start" => "RUNNING",
        "stop" => "STOPPED",
        _ => {
            let state_output = run_sc(&["query", name]).await.unwrap_or_default();
            return Ok(parse_sc_state(&state_output));
        }
    };
    Ok(wait_for_state(name, target, 30).await)
}

/// Wait for service to reach target state, polling every 2s, max `max_wait_secs`.
async fn wait_for_state(service_name: &str, target: &str, max_wait_secs: u64) -> String {
    let start = std::time::Instant::now();
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let status = query_service(service_name)
            .await
            .unwrap_or_else(|_| "UNKNOWN".into());
        if status == target || start.elapsed().as_secs() > max_wait_secs {
            return status;
        }
    }
}

/// Restart = stop + wait + start + wait.
async fn restart_service(name: &str) -> Result<String, String> {
    info!(service = name, "Restarting service");

    // Stop the service (ignore error if already stopped)
    let _ = run_sc(&["stop", name]).await;
    wait_for_state(name, "STOPPED", 30).await;

    // Start the service
    let _ = run_sc(&["start", name]).await?;
    let final_state = wait_for_state(name, "RUNNING", 30).await;
    Ok(final_state)
}

/// Run an `sc` command and capture its output.
async fn run_sc(args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let result = {
        tokio::process::Command::new("sc")
            .args(args)
            .output()
            .await
    };

    #[cfg(not(target_os = "windows"))]
    let result = {
        // Stub for Linux compilation: simulate sc output
        let full = format!("sc {}", args.join(" "));
        tokio::process::Command::new("sh")
            .args(["-c", &format!("echo 'STATE: 4  RUNNING (simulated: {full})'")])
            .output()
            .await
    };

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            if output.status.success() {
                Ok(stdout)
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!(
                    "sc exited with {}: {} {}",
                    output.status.code().unwrap_or(-1),
                    stdout.trim(),
                    stderr.trim()
                ))
            }
        }
        Err(e) => Err(format!("Failed to run sc: {e}")),
    }
}

/// Parse the STATE line from `sc query` output.
///
/// Example: `STATE : 4  RUNNING` → "RUNNING"
fn parse_sc_state(output: &str) -> String {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("STATE") {
            // Format: "STATE : N  STATE_NAME"
            if let Some(state_part) = trimmed.split_whitespace().last() {
                return state_part.to_string();
            }
        }
    }
    "UNKNOWN".into()
}

/// Parse the PID line from `sc queryex` output.
///
/// Example: `PID : 1234` → Some(1234)
fn parse_sc_pid(output: &str) -> Option<u32> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("PID") {
            if let Some(pid_str) = trimmed.split(':').nth(1) {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    if pid != 0 {
                        return Some(pid);
                    }
                }
            }
        }
    }
    None
}

/// Get the PID of a running Windows service via `sc queryex`.
async fn get_service_pid(service_name: &str) -> Option<u32> {
    #[cfg(target_os = "windows")]
    let result = {
        tokio::process::Command::new("sc")
            .args(["queryex", service_name])
            .output()
            .await
    };

    #[cfg(not(target_os = "windows"))]
    let result = {
        tokio::process::Command::new("sh")
            .args([
                "-c",
                &format!(
                    "echo 'STATE : 4  RUNNING\n        PID : 12345 (simulated: {service_name})'"
                ),
            ])
            .output()
            .await
    };

    match result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_sc_pid(&stdout)
        }
        _ => None,
    }
}

/// Get memory usage in MB for a given PID using sysinfo.
fn get_process_memory_mb(pid: u32) -> Option<u64> {
    use sysinfo::{Pid, System};

    let mut sys = System::new();
    let target = Pid::from_u32(pid);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
    sys.process(target).map(|p| p.memory() / (1024 * 1024))
}

// ---------------------------------------------------------------------------
// Watchdog — auto-restart stopped critical services with rate limiting
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::time::Instant;

/// Track restart attempts per service with hourly rate limiting.
pub struct RestartTracker {
    attempts: HashMap<String, Vec<Instant>>,
    max_per_hour: u32,
}

impl RestartTracker {
    pub fn new(max_per_hour: u32) -> Self {
        Self {
            attempts: HashMap::new(),
            max_per_hour,
        }
    }

    /// Returns `true` if the service has not exceeded `max_per_hour` restarts in the last hour.
    pub fn can_restart(&self, service: &str) -> bool {
        let now = Instant::now();
        let one_hour = std::time::Duration::from_secs(3600);
        match self.attempts.get(service) {
            Some(timestamps) => {
                let recent = timestamps
                    .iter()
                    .filter(|&&t| now.duration_since(t) < one_hour)
                    .count();
                (recent as u32) < self.max_per_hour
            }
            None => true,
        }
    }

    /// Record a restart attempt and prune entries older than 24 hours.
    pub fn record_restart(&mut self, service: &str) {
        let now = Instant::now();
        let twenty_four_hours = std::time::Duration::from_secs(86400);
        let entries = self.attempts.entry(service.to_string()).or_default();
        entries.push(now);
        entries.retain(|&t| now.duration_since(t) < twenty_four_hours);
    }

    /// Count restart attempts for a service in the last 24 hours.
    pub fn restart_count_24h(&self, service: &str) -> usize {
        let now = Instant::now();
        let twenty_four_hours = std::time::Duration::from_secs(86400);
        match self.attempts.get(service) {
            Some(timestamps) => timestamps
                .iter()
                .filter(|&&t| now.duration_since(t) < twenty_four_hours)
                .count(),
            None => 0,
        }
    }
}

/// Event emitted by the watchdog when it takes an action.
#[derive(Debug, Clone, Serialize)]
pub struct WatchdogEvent {
    pub service: String,
    pub action: String,
    pub result: String,
    pub restart_count_24h: usize,
}

/// Check critical services and auto-restart stopped ones.
///
/// Called periodically from the scanner loop. Returns a list of actions taken.
pub async fn watchdog_check(
    allowed_services: &[String],
    tracker: &mut RestartTracker,
) -> Vec<WatchdogEvent> {
    let mut events = Vec::new();

    for svc in allowed_services {
        let health = check_service_health(svc).await;
        if health.status == "STOPPED" {
            if tracker.can_restart(svc) {
                warn!(service = %svc, "Watchdog: service stopped, restarting");
                let result = match restart_service(svc).await {
                    Ok(state) => state,
                    Err(e) => format!("error: {e}"),
                };
                tracker.record_restart(svc);
                events.push(WatchdogEvent {
                    service: svc.clone(),
                    action: "restart".into(),
                    result,
                    restart_count_24h: tracker.restart_count_24h(svc),
                });
            } else {
                warn!(
                    service = %svc,
                    count_24h = tracker.restart_count_24h(svc),
                    "Watchdog: service stopped but restart limit reached"
                );
                events.push(WatchdogEvent {
                    service: svc.clone(),
                    action: "skipped_rate_limit".into(),
                    result: format!(
                        "rate limited ({} restarts in 24h)",
                        tracker.restart_count_24h(svc)
                    ),
                    restart_count_24h: tracker.restart_count_24h(svc),
                });
            }
        }
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_restart_tracker_rate_limit() {
        let mut tracker = RestartTracker::new(3);
        assert!(tracker.can_restart("TestSvc"));

        tracker.record_restart("TestSvc");
        tracker.record_restart("TestSvc");
        assert!(tracker.can_restart("TestSvc")); // 2 < 3

        tracker.record_restart("TestSvc");
        assert!(!tracker.can_restart("TestSvc")); // 3 >= 3
    }

    #[test]
    fn test_restart_tracker_independent_services() {
        let mut tracker = RestartTracker::new(1);
        tracker.record_restart("SvcA");
        assert!(!tracker.can_restart("SvcA"));
        assert!(tracker.can_restart("SvcB")); // different service, no restarts
    }

    #[test]
    fn test_restart_count_24h() {
        let mut tracker = RestartTracker::new(10);
        assert_eq!(tracker.restart_count_24h("TestSvc"), 0);

        tracker.record_restart("TestSvc");
        tracker.record_restart("TestSvc");
        assert_eq!(tracker.restart_count_24h("TestSvc"), 2);
    }

    #[test]
    fn test_restart_tracker_zero_limit() {
        let mut tracker = RestartTracker::new(0);
        // With max_per_hour=0, first check returns true (no entries, None branch)
        assert!(tracker.can_restart("TestSvc"));
        // After one restart, 1 >= 0 so it blocks
        tracker.record_restart("TestSvc");
        assert!(!tracker.can_restart("TestSvc"));
    }

    #[test]
    fn test_restart_tracker_unknown_service_count() {
        let tracker = RestartTracker::new(5);
        assert_eq!(tracker.restart_count_24h("NeverSeen"), 0);
    }

    #[test]
    fn test_parse_sc_state() {
        assert_eq!(
            parse_sc_state("  STATE : 4  RUNNING"),
            "RUNNING"
        );
        assert_eq!(
            parse_sc_state("  STATE : 1  STOPPED"),
            "STOPPED"
        );
        assert_eq!(parse_sc_state("garbage"), "UNKNOWN");
    }

    #[test]
    fn test_parse_sc_state_multiline() {
        let output = r#"
SERVICE_NAME: SvfPrintAgent
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
"#;
        assert_eq!(parse_sc_state(output), "RUNNING");
    }

    #[test]
    fn test_parse_sc_state_start_pending() {
        assert_eq!(parse_sc_state("  STATE : 2  START_PENDING"), "START_PENDING");
    }

    #[test]
    fn test_parse_sc_state_stop_pending() {
        assert_eq!(parse_sc_state("  STATE : 3  STOP_PENDING"), "STOP_PENDING");
    }

    #[test]
    fn test_parse_sc_state_empty() {
        assert_eq!(parse_sc_state(""), "UNKNOWN");
    }

    #[test]
    fn test_parse_sc_pid() {
        assert_eq!(
            parse_sc_pid("  PID : 1234"),
            Some(1234)
        );
        assert_eq!(parse_sc_pid("  PID : 0"), None);
        assert_eq!(parse_sc_pid("no pid here"), None);
    }

    #[test]
    fn test_parse_sc_pid_multiline() {
        let output = r#"
SERVICE_NAME: SvfPrintAgent
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
        PID                : 5678
        FLAGS              :
"#;
        assert_eq!(parse_sc_pid(output), Some(5678));
    }

    #[test]
    fn test_parse_sc_pid_large_value() {
        assert_eq!(parse_sc_pid("  PID : 99999"), Some(99999));
    }

    // --- is_service_allowed ---

    #[test]
    fn test_is_service_allowed_default_whitelist() {
        let empty: Vec<String> = vec![];
        assert!(is_service_allowed("SvfPrintAgent", &empty));
        assert!(is_service_allowed("SvfPosAgent", &empty));
        assert!(is_service_allowed("SvfMonitorAgent", &empty));
        assert!(is_service_allowed("SvfGuardAgent", &empty));
        assert!(is_service_allowed("InpasSmartSale", &empty));
        assert!(is_service_allowed("AtolWebServer", &empty));
        assert!(!is_service_allowed("EvilService", &empty));
    }

    #[test]
    fn test_is_service_allowed_case_insensitive() {
        let empty: Vec<String> = vec![];
        assert!(is_service_allowed("svfprintagent", &empty));
        assert!(is_service_allowed("SVFPRINTAGENT", &empty));
        assert!(is_service_allowed("SvFpRiNtAgEnT", &empty));
    }

    #[test]
    fn test_is_service_allowed_configured_overrides_default() {
        let configured = vec!["MyService".to_string(), "OtherService".to_string()];
        assert!(is_service_allowed("MyService", &configured));
        assert!(is_service_allowed("OtherService", &configured));
        // Default services should NOT match when configured is non-empty
        assert!(!is_service_allowed("SvfPrintAgent", &configured));
    }

    #[test]
    fn test_is_service_allowed_configured_case_insensitive() {
        let configured = vec!["MyService".to_string()];
        assert!(is_service_allowed("myservice", &configured));
        assert!(is_service_allowed("MYSERVICE", &configured));
    }

    // --- WatchdogEvent serialization ---

    #[test]
    fn test_watchdog_event_serialization() {
        let event = WatchdogEvent {
            service: "SvfPrintAgent".into(),
            action: "restart".into(),
            result: "RUNNING".into(),
            restart_count_24h: 2,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"service\":\"SvfPrintAgent\""));
        assert!(json.contains("\"restart_count_24h\":2"));
    }

    // --- ServiceResult serialization ---

    #[test]
    fn test_service_result_serialization() {
        let result = ServiceResult {
            request_id: "req-1".into(),
            service_name: "TestSvc".into(),
            action: "status".into(),
            success: true,
            state: "RUNNING".into(),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"state\":\"RUNNING\""));
    }

    // --- ServiceHealth serialization ---

    #[test]
    fn test_service_health_serialization() {
        let health = ServiceHealth {
            name: "SvfPrintAgent".into(),
            status: "RUNNING".into(),
            pid: Some(1234),
            memory_mb: Some(45),
            healthy: true,
        };
        let json = serde_json::to_string(&health).unwrap();
        assert!(json.contains("\"healthy\":true"));
        assert!(json.contains("\"pid\":1234"));
    }
}
