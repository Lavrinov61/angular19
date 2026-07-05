//! Disk I/O metrics collection via PowerShell WMI queries.
//!
//! All functions are synchronous (`std::process::Command`).
//! For async usage from commands.rs, wrap in `tokio::task::spawn_blocking`.

use serde::{Deserialize, Serialize};
use std::process::Command;
use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct DiskMetrics {
    pub drive: String,
    pub iops_read: f64,
    pub iops_write: f64,
    pub latency_ms_read: f64,
    pub latency_ms_write: f64,
    pub queue_depth: f64,
    pub throughput_mb_read: f64,
    pub throughput_mb_write: f64,
    pub utilization_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SmartHealth {
    pub drive: String,
    pub model: String,
    pub status: String,
    pub temperature_c: Option<i32>,
    pub power_on_hours: Option<u64>,
    pub size_gb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskReport {
    pub io: Vec<DiskMetrics>,
    pub smart: Vec<SmartHealth>,
}

// ---------------------------------------------------------------------------
// Raw JSON shapes returned by PowerShell
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawPerfDisk {
    name: Option<String>,
    disk_reads_per_sec: Option<f64>,
    disk_writes_per_sec: Option<f64>,
    avg_disk_sec_per_read: Option<f64>,
    avg_disk_sec_per_write: Option<f64>,
    current_disk_queue_length: Option<f64>,
    disk_read_bytes_per_sec: Option<f64>,
    disk_write_bytes_per_sec: Option<f64>,
    percent_idle_time: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawDiskDrive {
    model: Option<String>,
    status: Option<String>,
    size: Option<u64>,
    device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawPhysicalDisk {
    friendly_name: Option<String>,
    temperature: Option<i32>,
    #[serde(alias = "PowerOnHours")]
    power_on_hours: Option<u64>,
}

// ---------------------------------------------------------------------------
// PowerShell runner
// ---------------------------------------------------------------------------

/// Run a PowerShell script and return its stdout as a String.
fn run_ps_json(script: &str) -> Result<String, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|e| format!("failed to spawn powershell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "powershell exited with {}: {}",
            output.status, stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Deserialize PowerShell JSON that may be a single object or an array.
/// PowerShell emits a bare object when there is exactly one result.
fn parse_ps_array<T: serde::de::DeserializeOwned>(json: &str) -> Vec<T> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    // Try as array first.
    if let Ok(arr) = serde_json::from_str::<Vec<T>>(trimmed) {
        return arr;
    }

    // Fall back to single object.
    if let Ok(single) = serde_json::from_str::<T>(trimmed) {
        return vec![single];
    }

    warn!("disk_metrics: could not parse PowerShell JSON");
    debug!("raw JSON: {trimmed}");
    Vec::new()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const BYTES_PER_MB: f64 = 1024.0 * 1024.0;
const SECS_TO_MS: f64 = 1000.0;

/// Collect disk I/O metrics for all logical drives.
pub fn collect_disk_io() -> Vec<DiskMetrics> {
    let ps_script = r#"
        Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk |
        Where-Object { $_.Name -ne '_Total' -and $_.Name -match '^[A-Z]:$' } |
        Select-Object Name,
            DiskReadsPerSec, DiskWritesPerSec,
            AvgDiskSecPerRead, AvgDiskSecPerWrite,
            CurrentDiskQueueLength,
            DiskReadBytesPerSec, DiskWriteBytesPerSec,
            PercentIdleTime |
        ConvertTo-Json -Compress
    "#;

    let json = match run_ps_json(ps_script) {
        Ok(j) => j,
        Err(e) => {
            warn!("collect_disk_io failed: {e}");
            return Vec::new();
        }
    };

    let raw: Vec<RawPerfDisk> = parse_ps_array(&json);
    debug!("parsed {} logical disk perf entries", raw.len());

    raw.into_iter()
        .map(|r| {
            let idle = r.percent_idle_time.unwrap_or(100.0);
            DiskMetrics {
                drive: r.name.unwrap_or_default(),
                iops_read: r.disk_reads_per_sec.unwrap_or(0.0),
                iops_write: r.disk_writes_per_sec.unwrap_or(0.0),
                latency_ms_read: r.avg_disk_sec_per_read.unwrap_or(0.0) * SECS_TO_MS,
                latency_ms_write: r.avg_disk_sec_per_write.unwrap_or(0.0) * SECS_TO_MS,
                queue_depth: r.current_disk_queue_length.unwrap_or(0.0),
                throughput_mb_read: r.disk_read_bytes_per_sec.unwrap_or(0.0) / BYTES_PER_MB,
                throughput_mb_write: r.disk_write_bytes_per_sec.unwrap_or(0.0) / BYTES_PER_MB,
                utilization_percent: (100.0 - idle).max(0.0),
            }
        })
        .collect()
}

/// Collect SMART health for all physical drives.
///
/// Uses `Win32_DiskDrive` for model/status/size, and `Get-PhysicalDisk`
/// for temperature and power-on hours (available on Windows 10+).
pub fn collect_smart_health() -> Vec<SmartHealth> {
    // Step 1: basic drive info via Win32_DiskDrive
    let drives_script = r#"
        Get-CimInstance Win32_DiskDrive |
        Select-Object Model, Status, Size, DeviceID |
        ConvertTo-Json -Compress
    "#;

    let drives_json = match run_ps_json(drives_script) {
        Ok(j) => j,
        Err(e) => {
            warn!("collect_smart_health (Win32_DiskDrive) failed: {e}");
            return Vec::new();
        }
    };

    let raw_drives: Vec<RawDiskDrive> = parse_ps_array(&drives_json);
    debug!("parsed {} physical drives", raw_drives.len());

    // Step 2: temperature + power-on hours via Get-PhysicalDisk (may fail on older OS)
    let phys_script = r#"
        Get-PhysicalDisk |
        Select-Object FriendlyName, Temperature, PowerOnHours |
        ConvertTo-Json -Compress
    "#;

    let phys_disks: Vec<RawPhysicalDisk> = match run_ps_json(phys_script) {
        Ok(j) => parse_ps_array(&j),
        Err(e) => {
            debug!("Get-PhysicalDisk unavailable (expected on older OS): {e}");
            Vec::new()
        }
    };

    raw_drives
        .into_iter()
        .map(|d| {
            let model = d.model.clone().unwrap_or_default();
            let size_gb = d.size.unwrap_or(0) / (1024 * 1024 * 1024);

            // Try to match by model name substring for temperature/power-on hours
            let phys_match = phys_disks.iter().find(|p| {
                p.friendly_name
                    .as_deref()
                    .is_some_and(|name| model.contains(name) || name.contains(&model))
            });

            SmartHealth {
                drive: d.device_id.unwrap_or_default(),
                model,
                status: d.status.unwrap_or_else(|| "Unknown".into()),
                temperature_c: phys_match.and_then(|p| p.temperature),
                power_on_hours: phys_match.and_then(|p| p.power_on_hours),
                size_gb,
            }
        })
        .collect()
}

/// Collect all disk metrics (I/O + SMART).
pub fn collect_all() -> DiskReport {
    DiskReport {
        io: collect_disk_io(),
        smart: collect_smart_health(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ps_array_empty() {
        let result: Vec<RawPerfDisk> = parse_ps_array("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_ps_array_single_object() {
        let json = r#"{"Name":"C:","DiskReadsPerSec":10,"DiskWritesPerSec":5,"AvgDiskSecPerRead":0.001,"AvgDiskSecPerWrite":0.002,"CurrentDiskQueueLength":0,"DiskReadBytesPerSec":1048576,"DiskWriteBytesPerSec":524288,"PercentIdleTime":90}"#;
        let result: Vec<RawPerfDisk> = parse_ps_array(json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name.as_deref(), Some("C:"));
        assert_eq!(result[0].disk_reads_per_sec, Some(10.0));
    }

    #[test]
    fn test_parse_ps_array_multiple() {
        let json = r#"[{"Name":"C:","DiskReadsPerSec":10,"DiskWritesPerSec":5,"AvgDiskSecPerRead":0.001,"AvgDiskSecPerWrite":0.002,"CurrentDiskQueueLength":1,"DiskReadBytesPerSec":1048576,"DiskWriteBytesPerSec":0,"PercentIdleTime":85},{"Name":"D:","DiskReadsPerSec":2,"DiskWritesPerSec":1,"AvgDiskSecPerRead":0.005,"AvgDiskSecPerWrite":0.003,"CurrentDiskQueueLength":0,"DiskReadBytesPerSec":0,"DiskWriteBytesPerSec":0,"PercentIdleTime":99}]"#;
        let result: Vec<RawPerfDisk> = parse_ps_array(json);
        assert_eq!(result.len(), 2);
        assert_eq!(result[1].name.as_deref(), Some("D:"));
    }

    #[test]
    fn test_latency_conversion() {
        // AvgDiskSecPerRead = 0.003 seconds → should be 3.0 ms
        let secs = 0.003_f64;
        let ms = secs * SECS_TO_MS;
        assert!((ms - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_utilization_clamp() {
        // PercentIdleTime = 110 (quirky WMI data) → utilization clamped to 0
        let idle = 110.0_f64;
        let util = (100.0 - idle).max(0.0);
        assert_eq!(util, 0.0);
    }

    #[test]
    fn test_smart_drive_parsing() {
        let json = r#"{"Model":"Samsung SSD 970","Status":"OK","Size":512110190592,"DeviceID":"\\\\.\\PHYSICALDRIVE0"}"#;
        let result: Vec<RawDiskDrive> = parse_ps_array(json);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].model.as_deref(), Some("Samsung SSD 970"));
        assert_eq!(result[0].size, Some(512110190592));
    }

    #[test]
    fn test_parse_ps_array_invalid_json() {
        let result: Vec<RawPerfDisk> = parse_ps_array("not json at all");
        assert!(result.is_empty());
    }
}
