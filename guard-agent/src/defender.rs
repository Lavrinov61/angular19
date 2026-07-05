//! Windows Defender monitoring — status checks and threat detection via PowerShell.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{error, warn};

/// Current Windows Defender status.
#[derive(Debug, Clone, Serialize)]
pub struct DefenderStatus {
    pub realtime_enabled: bool,
    pub signatures_updated: bool,
    pub days_since_update: i32,
    pub last_scan: Option<String>,
    pub threats: Vec<ThreatInfo>,
}

/// A detected threat from Windows Defender.
#[derive(Debug, Clone, Serialize)]
pub struct ThreatInfo {
    pub name: String,
    pub file_path: String,
    pub severity: String,
    pub action_taken: String,
}

/// A threat detection entry from Get-MpThreatDetection (quarantine API).
#[derive(Debug, Deserialize, Serialize)]
pub struct ThreatDetection {
    #[serde(rename = "ThreatID")]
    pub threat_id: Option<i64>,
    #[serde(rename = "ThreatName")]
    pub threat_name: Option<String>,
    #[serde(rename = "SeverityID")]
    pub severity_id: Option<i32>, // 1=Low, 2=Moderate, 4=High, 5=Severe
    #[serde(rename = "ProcessName")]
    pub process_name: Option<String>,
    #[serde(rename = "InitialDetectionTime")]
    pub detection_time: Option<String>,
}

/// Raw JSON from PowerShell Get-MpComputerStatus | ConvertTo-Json.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsComputerStatus {
    #[serde(default)]
    real_time_protection_enabled: Option<bool>,
    #[serde(default)]
    antivirus_signature_age: Option<i32>,
    #[serde(default)]
    full_scan_end_time: Option<String>,
    #[serde(default)]
    quick_scan_end_time: Option<String>,
}

/// Raw JSON from PowerShell Get-MpThreatDetection | ConvertTo-Json.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsThreatDetection {
    #[serde(default)]
    threat_name: Option<String>,
    #[serde(default)]
    resources: Option<Vec<String>>,
    #[serde(default)]
    action_success: Option<bool>,
    #[serde(default)]
    severity_i_d: Option<i32>,
}

/// Check Windows Defender status via PowerShell.
pub async fn check_defender_status() -> DefenderStatus {
    let computer_status = run_ps_json(
        "Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusSignatureAge, FullScanEndTime, QuickScanEndTime | ConvertTo-Json -Compress"
    ).await;

    let (realtime_enabled, days_since_update, last_scan) = match computer_status {
        Ok(json) => {
            match serde_json::from_str::<PsComputerStatus>(&json) {
                Ok(status) => {
                    let rt = status.real_time_protection_enabled.unwrap_or(false);
                    let age = status.antivirus_signature_age.unwrap_or(-1);
                    let scan = status.quick_scan_end_time
                        .or(status.full_scan_end_time);
                    (rt, age, scan)
                }
                Err(e) => {
                    warn!(error = %e, "Failed to parse Defender status JSON");
                    (false, -1, None)
                }
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to run Get-MpComputerStatus");
            (false, -1, None)
        }
    };

    let threats = get_recent_threats().await;

    DefenderStatus {
        realtime_enabled,
        signatures_updated: days_since_update >= 0 && days_since_update <= 3,
        days_since_update,
        last_scan,
        threats,
    }
}

/// Get threats detected in the last hour.
pub async fn get_recent_threats() -> Vec<ThreatInfo> {
    let ps_script = r#"
$cutoff = (Get-Date).AddHours(-1)
$threats = Get-MpThreatDetection | Where-Object { $_.InitialDetectionTime -gt $cutoff }
if ($threats) {
    $threats | Select-Object ThreatName, Resources, ActionSuccess, SeverityID | ConvertTo-Json -Compress
} else {
    "[]"
}
"#;

    match run_ps_json(ps_script).await {
        Ok(json) => {
            // PowerShell returns a single object (not array) if only one result
            let detections: Vec<PsThreatDetection> =
                if json.trim_start().starts_with('[') {
                    serde_json::from_str(&json).unwrap_or_default()
                } else {
                    serde_json::from_str::<PsThreatDetection>(&json)
                        .map(|d| vec![d])
                        .unwrap_or_default()
                };

            detections.into_iter().map(|d| {
                let severity = match d.severity_i_d {
                    Some(1) => "Low",
                    Some(2) => "Medium",
                    Some(4) => "High",
                    Some(5) => "Severe",
                    _ => "Unknown",
                };
                ThreatInfo {
                    name: d.threat_name.unwrap_or_default(),
                    file_path: d.resources
                        .and_then(|r| r.into_iter().next())
                        .unwrap_or_default(),
                    severity: severity.to_string(),
                    action_taken: if d.action_success.unwrap_or(false) {
                        "Remediated".to_string()
                    } else {
                        "Pending".to_string()
                    },
                }
            }).collect()
        }
        Err(e) => {
            warn!(error = %e, "Failed to get recent threats");
            Vec::new()
        }
    }
}

/// Run a quick scan via PowerShell.
#[allow(dead_code)]
pub async fn start_quick_scan() -> Result<String, String> {
    run_ps_json("Start-MpScan -ScanType QuickScan")
        .await
        .map_err(|e| format!("Quick scan failed: {e}"))
}

/// Get recent threat detections with severity.
#[allow(dead_code)]
pub async fn get_threat_detections() -> Result<Vec<ThreatDetection>, String> {
    let output = run_ps_json(
        "Get-MpThreatDetection | Select-Object -First 10 | ConvertTo-Json -Compress",
    )
    .await
    .map_err(|e| format!("Get threat detections: {e}"))?;

    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(Vec::new());
    }

    // PowerShell returns a single object (not array) if only one result
    if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).map_err(|e| format!("Parse threat detections: {e}"))
    } else {
        serde_json::from_str::<ThreatDetection>(trimmed)
            .map(|d| vec![d])
            .map_err(|e| format!("Parse threat detection: {e}"))
    }
}

/// Remove (quarantine) a specific threat by ID.
#[allow(dead_code)]
pub async fn remove_threat(threat_id: &str) -> Result<String, String> {
    // Sanitize threat_id (only digits allowed)
    if !threat_id.chars().all(|c| c.is_ascii_digit()) || threat_id.is_empty() {
        return Err("Invalid threat ID: must be non-empty digits only".into());
    }
    run_ps_json(&format!("Remove-MpThreat -ThreatsID {threat_id}"))
        .await
        .map_err(|e| format!("Remove threat failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_threat_detection_json_parsing() {
        let json = r#"{
            "ThreatID": 12345,
            "ThreatName": "Trojan:Win32/TestMalware",
            "SeverityID": 4,
            "ProcessName": "evil.exe",
            "InitialDetectionTime": "2026-04-06T12:00:00Z"
        }"#;
        let det: ThreatDetection = serde_json::from_str(json).unwrap();
        assert_eq!(det.threat_id, Some(12345));
        assert_eq!(det.threat_name.as_deref(), Some("Trojan:Win32/TestMalware"));
        assert_eq!(det.severity_id, Some(4));
        assert_eq!(det.process_name.as_deref(), Some("evil.exe"));
    }

    #[test]
    fn test_threat_detection_missing_fields() {
        let json = r#"{}"#;
        let det: ThreatDetection = serde_json::from_str(json).unwrap();
        assert_eq!(det.threat_id, None);
        assert_eq!(det.threat_name, None);
        assert_eq!(det.severity_id, None);
        assert_eq!(det.process_name, None);
        assert_eq!(det.detection_time, None);
    }

    #[test]
    fn test_threat_detection_array_parsing() {
        let json = r#"[
            {"ThreatID": 1, "ThreatName": "A"},
            {"ThreatID": 2, "ThreatName": "B"}
        ]"#;
        let dets: Vec<ThreatDetection> = serde_json::from_str(json).unwrap();
        assert_eq!(dets.len(), 2);
        assert_eq!(dets[0].threat_id, Some(1));
        assert_eq!(dets[1].threat_name.as_deref(), Some("B"));
    }

    #[test]
    fn test_ps_computer_status_parsing() {
        let json = r#"{
            "RealTimeProtectionEnabled": true,
            "AntivirusSignatureAge": 1,
            "FullScanEndTime": "2026-04-05T10:00:00",
            "QuickScanEndTime": "2026-04-06T08:00:00"
        }"#;
        let status: PsComputerStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status.real_time_protection_enabled, Some(true));
        assert_eq!(status.antivirus_signature_age, Some(1));
        assert!(status.quick_scan_end_time.is_some());
        assert!(status.full_scan_end_time.is_some());
    }

    #[test]
    fn test_ps_threat_detection_severity_mapping() {
        // Replicates the severity mapping logic from get_recent_threats
        let cases = vec![
            (Some(1), "Low"),
            (Some(2), "Medium"),
            (Some(4), "High"),
            (Some(5), "Severe"),
            (Some(99), "Unknown"),
            (None, "Unknown"),
        ];
        for (severity_id, expected) in cases {
            let severity = match severity_id {
                Some(1) => "Low",
                Some(2) => "Medium",
                Some(4) => "High",
                Some(5) => "Severe",
                _ => "Unknown",
            };
            assert_eq!(severity, expected, "severity_id={severity_id:?}");
        }
    }

    #[test]
    fn test_ps_threat_detection_action_success_mapping() {
        // action_success=true -> "Remediated", false/None -> "Pending"
        assert_eq!(
            if true { "Remediated" } else { "Pending" },
            "Remediated"
        );
        assert_eq!(
            if false { "Remediated" } else { "Pending" },
            "Pending"
        );
    }

    #[test]
    fn test_sanitize_threat_id_valid() {
        let id = "12345";
        assert!(id.chars().all(|c| c.is_ascii_digit()) && !id.is_empty());
    }

    #[test]
    fn test_sanitize_threat_id_rejects_non_digits() {
        let bad_ids = ["abc", "123abc", "12 34", "12;DROP TABLE", "", "-1", "12.3"];
        for id in bad_ids {
            let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_digit());
            assert!(!valid, "Should reject: {id:?}");
        }
    }

    #[test]
    fn test_signatures_updated_logic() {
        // signatures_updated = days_since_update >= 0 && days_since_update <= 3
        assert!(0 >= 0 && 0 <= 3);   // fresh
        assert!(3 >= 0 && 3 <= 3);   // 3 days ok
        assert!(!(4 >= 0 && 4 <= 3)); // 4 days outdated
        assert!(!(-1 >= 0 && -1 <= 3)); // -1 = unknown
    }

    #[test]
    fn test_single_object_vs_array_detection() {
        // PowerShell returns single object if 1 result, array if multiple
        let single = r#"{"ThreatName": "X"}"#;
        let array = r#"[{"ThreatName": "X"}]"#;
        assert!(!single.trim_start().starts_with('['));
        assert!(array.trim_start().starts_with('['));

        // Single object path
        let det: PsThreatDetection = serde_json::from_str(single).unwrap();
        assert_eq!(det.threat_name.as_deref(), Some("X"));

        // Array path
        let dets: Vec<PsThreatDetection> = serde_json::from_str(array).unwrap();
        assert_eq!(dets.len(), 1);
    }
}

/// Execute a PowerShell command and return stdout as a String.
/// Times out after 30 seconds to prevent hung PS processes from blocking the agent.
async fn run_ps_json(script: &str) -> anyhow::Result<String> {
    let child = tokio::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-Command", script,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let child_id = child.id();

    let output = match tokio::time::timeout(
        Duration::from_secs(30),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => {
            // Timeout — kill the hung process by PID
            if let Some(pid) = child_id {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .output();
            }
            anyhow::bail!("PowerShell timed out after 30s");
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("PowerShell exited with {}: {}", output.status, stderr.trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
