//! CUPS and direct printer status via command-line tools.

use tokio::process::Command;
use tokio::time::{Duration, timeout};
use tracing::warn;

const IPPTOOL_TIMEOUT_SECS: u64 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CupsJobState {
    Active,
    Completed,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrinterDeviceState {
    Idle,
    Processing,
    Stopped,
    Unknown,
}

impl PrinterDeviceState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Processing => "processing",
            Self::Stopped => "stopped",
            Self::Unknown => "unknown",
        }
    }

    fn from_ipp(value: &str) -> Self {
        match value.trim() {
            "idle" => Self::Idle,
            "processing" => Self::Processing,
            "stopped" => Self::Stopped,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug)]
pub struct CupsPrinterStatus {
    pub is_online: bool,
    pub state: &'static str,
    pub state_reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectPrinterStatus {
    pub state: PrinterDeviceState,
    pub queued_job_count: Option<i32>,
    pub state_reasons: Vec<String>,
}

impl DirectPrinterStatus {
    pub fn is_busy(&self) -> bool {
        self.state == PrinterDeviceState::Processing || self.queued_job_count.unwrap_or(0) > 0
    }
}

/// Get printer status via `lpstat -p <name> -l`.
pub async fn get_printer_status(printer_name: &str) -> CupsPrinterStatus {
    let output = Command::new("lpstat")
        .args(["-p", printer_name, "-l"])
        .output()
        .await;

    let output = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            return CupsPrinterStatus {
                is_online: false,
                state: "unknown",
                state_reasons: vec![],
            };
        }
    };

    let is_online = !output.contains("disabled");
    let state = if output.contains("idle") {
        "idle"
    } else if output.contains("printing") {
        "processing"
    } else if output.contains("disabled") || output.contains("stopped") {
        "paused"
    } else {
        "unknown"
    };

    let state_reasons = output
        .lines()
        .find(|l| l.contains("Alerts:") || l.contains("Description:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty() && s != "none")
        .into_iter()
        .collect();

    CupsPrinterStatus {
        is_online,
        state,
        state_reasons,
    }
}

/// Query the physical printer directly via IPP when the CUPS device URI allows it.
pub async fn get_direct_printer_status(printer_name: &str) -> Option<DirectPrinterStatus> {
    let device_uri = get_cups_device_uri(printer_name).await?;
    let ipp_uri = ipp_uri_from_device_uri(&device_uri)?;
    let attributes = ipptool_printer_attributes(&ipp_uri).await?;

    Some(parse_ipptool_status(&attributes))
}

async fn get_cups_device_uri(printer_name: &str) -> Option<String> {
    let output = Command::new("lpstat")
        .args(["-v", printer_name])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let prefix = format!("device for {printer_name}:");
            stdout
                .lines()
                .find_map(|line| line.trim().strip_prefix(&prefix).map(str::trim))
                .filter(|uri| !uri.is_empty())
                .map(ToOwned::to_owned)
        }
        Ok(o) => {
            warn!(status = %o.status, printer = printer_name, "lpstat returned a non-zero status for device URI");
            None
        }
        Err(e) => {
            warn!(error = %e, printer = printer_name, "Failed to resolve CUPS device URI");
            None
        }
    }
}

fn ipp_uri_from_device_uri(device_uri: &str) -> Option<String> {
    let parsed = url::Url::parse(device_uri).ok()?;
    match parsed.scheme() {
        "ipp" | "ipps" => Some(device_uri.to_owned()),
        "socket" => {
            let host = parsed.host_str()?;
            let host = if host.contains(':') {
                format!("[{host}]")
            } else {
                host.to_owned()
            };
            Some(format!("ipp://{host}/ipp/print"))
        }
        _ => None,
    }
}

async fn ipptool_printer_attributes(ipp_uri: &str) -> Option<String> {
    let command = Command::new("ipptool")
        .args(["-T", "5", "-tv", ipp_uri, "get-printer-attributes.test"])
        .output();

    match timeout(Duration::from_secs(IPPTOOL_TIMEOUT_SECS), command).await {
        Ok(Ok(o)) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(Ok(o)) => {
            warn!(status = %o.status, ipp_uri, "ipptool returned a non-zero status");
            None
        }
        Ok(Err(e)) => {
            warn!(error = %e, ipp_uri, "Failed to execute ipptool");
            None
        }
        Err(_) => {
            warn!(
                timeout_secs = IPPTOOL_TIMEOUT_SECS,
                ipp_uri, "ipptool timed out"
            );
            None
        }
    }
}

fn parse_ipptool_status(output: &str) -> DirectPrinterStatus {
    let mut state = PrinterDeviceState::Unknown;
    let mut queued_job_count = None;
    let mut state_reasons = Vec::new();

    for line in output.lines() {
        if let Some(value) = ipptool_attribute_value(line, "printer-state") {
            state = PrinterDeviceState::from_ipp(value);
        } else if let Some(value) = ipptool_attribute_value(line, "queued-job-count") {
            queued_job_count = value.parse::<i32>().ok();
        } else if let Some(value) = ipptool_attribute_value(line, "printer-state-reasons") {
            state_reasons = value
                .split(',')
                .map(str::trim)
                .filter(|reason| !reason.is_empty() && *reason != "none")
                .map(ToOwned::to_owned)
                .collect();
        }
    }

    DirectPrinterStatus {
        state,
        queued_job_count,
        state_reasons,
    }
}

fn ipptool_attribute_value<'a>(line: &'a str, attribute: &str) -> Option<&'a str> {
    let rest = line.trim().strip_prefix(attribute)?.trim_start();
    if !rest.starts_with('(') {
        return None;
    }
    rest.split_once(" = ").map(|(_, value)| value.trim())
}

/// List all CUPS printers.
pub async fn list_printers() -> Vec<String> {
    let output = Command::new("lpstat").args(["-p"]).output().await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && parts[0] == "printer" {
                    Some(parts[1].to_string())
                } else {
                    None
                }
            })
            .collect(),
        _ => {
            warn!("Failed to list CUPS printers via lpstat");
            vec![]
        }
    }
}

/// Resolve a CUPS job state from `lpstat`.
///
/// CUPS reports jobs as `<printer-name>-<job-id>`, for example
/// `Canon-C3226i-Soborny-24`. We check the active queue first, then the recent
/// completed history. A missing job usually means CUPS already handed it off and
/// purged the visible queue entry.
pub async fn get_job_state(printer_name: &str, cups_job_id: i32) -> CupsJobState {
    if cups_job_id <= 0 {
        return CupsJobState::Unknown;
    }

    let job_key = format!("{printer_name}-{cups_job_id}");
    if let Some(active_jobs) = lpstat_lines(&["-W", "not-completed", "-o"]).await {
        if output_contains_job(&active_jobs, &job_key) {
            return CupsJobState::Active;
        }
    } else {
        return CupsJobState::Unknown;
    }

    if let Some(completed_jobs) = lpstat_lines(&["-W", "completed", "-o"]).await {
        if output_contains_job(&completed_jobs, &job_key) {
            return CupsJobState::Completed;
        }
    }

    CupsJobState::Missing
}

async fn lpstat_lines(args: &[&str]) -> Option<String> {
    let output = Command::new("lpstat").args(args).output().await;
    match output {
        Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(o) => {
            warn!(status = %o.status, args = ?args, "lpstat returned a non-zero status");
            None
        }
        Err(e) => {
            warn!(error = %e, args = ?args, "Failed to execute lpstat");
            None
        }
    }
}

fn output_contains_job(output: &str, job_key: &str) -> bool {
    output
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .any(|key| key == job_key)
}

#[cfg(test)]
mod tests {
    use super::{
        PrinterDeviceState, ipp_uri_from_device_uri, output_contains_job, parse_ipptool_status,
    };

    #[test]
    fn detects_exact_cups_job_key() {
        let output = "\
Canon-C3226i-Soborny-24 rostv 1537024 Sun May 3 17:09:04 2026
Canon-C3226i-Soborny-240 rostv 1537024 Sun May 3 17:10:04 2026
";

        assert!(output_contains_job(output, "Canon-C3226i-Soborny-24"));
        assert!(!output_contains_job(output, "Canon-C3226i-Soborny-2"));
    }

    #[test]
    fn builds_ipp_uri_for_socket_printer() {
        assert_eq!(
            ipp_uri_from_device_uri("socket://192.168.1.146:9100").as_deref(),
            Some("ipp://192.168.1.146/ipp/print")
        );
    }

    #[test]
    fn parses_ipptool_status() {
        let output = "\
printer-state (enum) = processing
printer-state-reasons (1setOf keyword) = toner-low-warning,other-error
queued-job-count (integer) = 1
";
        let status = parse_ipptool_status(output);

        assert_eq!(status.state, PrinterDeviceState::Processing);
        assert_eq!(status.queued_job_count, Some(1));
        assert_eq!(
            status.state_reasons,
            vec!["toner-low-warning", "other-error"]
        );
    }
}
