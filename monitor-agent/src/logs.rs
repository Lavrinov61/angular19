//! Log reading — Windows Event Log via wevtutil and plain text files.
//!
//! Whitelisted paths only. Output limited to 64KB per response.

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::AgentState;

const MAX_LOG_OUTPUT: usize = 65536; // 64 KB

#[derive(Debug, Deserialize)]
pub struct LogsRequest {
    pub request_id: String,
    /// "eventlog" for Windows Event Log, "file" for plain text file
    pub source: String,
    /// For eventlog: provider name (e.g., "SvfPosAgent")
    /// For file: absolute file path
    pub target: String,
    /// Number of entries/lines to read (default 50)
    #[serde(default = "default_count")]
    pub count: u32,
}

fn default_count() -> u32 {
    50
}

#[derive(Debug, Serialize)]
pub struct LogsResult {
    pub request_id: String,
    pub source: String,
    pub target: String,
    pub success: bool,
    pub data: String,
    pub lines_count: usize,
    pub truncated: bool,
    pub error: Option<String>,
}

/// Read logs from the specified source.
pub async fn read_logs(state: &AgentState, req: LogsRequest) -> LogsResult {
    match req.source.as_str() {
        "eventlog" => read_event_log(req).await,
        "file" => read_file_log(state, req).await,
        other => LogsResult {
            request_id: req.request_id,
            source: other.to_string(),
            target: req.target,
            success: false,
            data: String::new(),
            lines_count: 0,
            truncated: false,
            error: Some(format!("Unknown source type: {other}. Use 'eventlog' or 'file'")),
        },
    }
}

/// Read Windows Event Log using wevtutil.
async fn read_event_log(req: LogsRequest) -> LogsResult {
    // Sanitize provider name — alphanumeric + dots/hyphens/underscores only
    if !req
        .target
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return LogsResult {
            request_id: req.request_id,
            source: req.source,
            target: req.target,
            success: false,
            data: String::new(),
            lines_count: 0,
            truncated: false,
            error: Some("Invalid provider name — only alphanumeric, dots, hyphens, underscores allowed".into()),
        };
    }

    let query = format!(
        "*[System[Provider[@Name='{}']]]",
        req.target
    );

    #[cfg(target_os = "windows")]
    let result = {
        tokio::process::Command::new("wevtutil")
            .args([
                "qe",
                "Application",
                "/q:",
                &query,
                &format!("/c:{}", req.count),
                "/rd:true",
                "/f:text",
            ])
            .output()
            .await
    };

    #[cfg(not(target_os = "windows"))]
    let result = {
        // Stub for Linux: simulate event log output
        let _ = &query; // used on Windows
        let msg = format!(
            "[stub] Would query Windows Event Log: Application, provider={}, count={}",
            req.target, req.count
        );
        tokio::process::Command::new("sh")
            .args(["-c", &format!("echo '{msg}'")])
            .output()
            .await
    };

    match result {
        Ok(output) => {
            let data = String::from_utf8_lossy(&output.stdout).into_owned();
            let truncated = data.len() > MAX_LOG_OUTPUT;
            let data = if truncated {
                truncate_string(data, MAX_LOG_OUTPUT)
            } else {
                data
            };
            let lines_count = data.lines().count();

            if output.status.success() {
                LogsResult {
                    request_id: req.request_id,
                    source: req.source,
                    target: req.target,
                    success: true,
                    data,
                    lines_count,
                    truncated,
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                LogsResult {
                    request_id: req.request_id,
                    source: req.source,
                    target: req.target,
                    success: false,
                    data,
                    lines_count,
                    truncated: false,
                    error: Some(format!("wevtutil error: {}", stderr.trim())),
                }
            }
        }
        Err(e) => LogsResult {
            request_id: req.request_id,
            source: req.source,
            target: req.target,
            success: false,
            data: String::new(),
            lines_count: 0,
            truncated: false,
            error: Some(format!("Failed to run wevtutil: {e}")),
        },
    }
}

/// Read a plain text log file (whitelisted paths only).
async fn read_file_log(state: &AgentState, req: LogsRequest) -> LogsResult {
    // Validate path against whitelist
    if !is_path_whitelisted(&req.target, &state.config.monitor.whitelisted_paths) {
        warn!(path = %req.target, "Log file path not in whitelist");
        return LogsResult {
            request_id: req.request_id,
            source: req.source,
            target: req.target,
            success: false,
            data: String::new(),
            lines_count: 0,
            truncated: false,
            error: Some("Path not in whitelisted directories".into()),
        };
    }

    match tokio::fs::read_to_string(&req.target).await {
        Ok(content) => {
            // Take last N lines
            let lines: Vec<&str> = content.lines().collect();
            let start = lines.len().saturating_sub(req.count as usize);
            let tail: String = lines[start..].join("\n");

            let truncated = tail.len() > MAX_LOG_OUTPUT;
            let data = if truncated {
                truncate_string(tail, MAX_LOG_OUTPUT)
            } else {
                tail
            };
            let lines_count = data.lines().count();

            LogsResult {
                request_id: req.request_id,
                source: req.source,
                target: req.target,
                success: true,
                data,
                lines_count,
                truncated,
                error: None,
            }
        }
        Err(e) => LogsResult {
            request_id: req.request_id,
            source: req.source,
            target: req.target,
            success: false,
            data: String::new(),
            lines_count: 0,
            truncated: false,
            error: Some(format!("Failed to read file: {e}")),
        },
    }
}

/// Check if a path starts with one of the whitelisted prefixes.
fn is_path_whitelisted(path: &str, whitelist: &[String]) -> bool {
    // Normalize path separators for comparison
    let normalized = path.replace('/', "\\");
    whitelist
        .iter()
        .any(|prefix| normalized.starts_with(&prefix.replace('/', "\\")))
}

/// Truncate a string to max bytes, preserving UTF-8 boundary.
fn truncate_string(s: String, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = s[..end].to_string();
    truncated.push_str("\n... [output truncated]");
    truncated
}
