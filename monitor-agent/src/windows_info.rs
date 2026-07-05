//! Windows-specific system information collection.
//!
//! Gathers data about Windows Update, Defender, Event Log, and Firewall
//! by invoking PowerShell cmdlets. Each collector has a timeout guard
//! and returns safe defaults on failure.

use serde::Serialize;
use std::process::Command;
use std::time::Duration;
use tracing::{debug, warn};

/// Timeout for most PowerShell commands (3 seconds).
const PS_TIMEOUT: Duration = Duration::from_secs(3);

/// Timeout for Windows Update COM query (can be very slow).
const UPDATE_TIMEOUT: Duration = Duration::from_secs(10);

// ── Data types ──

#[derive(Debug, Clone, Serialize)]
pub struct WindowsUpdateInfo {
    pub pending_updates: u32,
    pub pending_security: u32,
    pub last_installed: String,
    pub reboot_required: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DefenderInfo {
    pub real_time_protection: bool,
    pub antivirus_enabled: bool,
    pub signature_version: String,
    pub signature_age_days: u32,
    pub last_scan_time: String,
    pub last_scan_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventLogSummary {
    pub errors_24h: u32,
    pub warnings_24h: u32,
    pub critical_24h: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FirewallInfo {
    pub domain_enabled: bool,
    pub private_enabled: bool,
    pub public_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowsReport {
    pub updates: WindowsUpdateInfo,
    pub defender: DefenderInfo,
    pub event_log: EventLogSummary,
    pub firewall: FirewallInfo,
    pub os_version: String,
    pub hostname: String,
    pub uptime_hours: u64,
}

// ── Default implementations ──

impl Default for WindowsUpdateInfo {
    fn default() -> Self {
        Self {
            pending_updates: 0,
            pending_security: 0,
            last_installed: "unknown".into(),
            reboot_required: false,
        }
    }
}

impl Default for DefenderInfo {
    fn default() -> Self {
        Self {
            real_time_protection: false,
            antivirus_enabled: false,
            signature_version: "unknown".into(),
            signature_age_days: u32::MAX,
            last_scan_time: "unknown".into(),
            last_scan_type: "unknown".into(),
        }
    }
}

impl Default for EventLogSummary {
    fn default() -> Self {
        Self {
            errors_24h: 0,
            warnings_24h: 0,
            critical_24h: 0,
        }
    }
}

impl Default for FirewallInfo {
    fn default() -> Self {
        Self {
            domain_enabled: false,
            private_enabled: false,
            public_enabled: false,
        }
    }
}

// ── PowerShell runner ──

/// Run a PowerShell command with the given timeout.
/// Returns stdout as String, or None on any failure.
fn run_ps(script: &str, timeout: Duration) -> Option<String> {
    use base64::Engine;

    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&utf16);

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // CREATE_NO_WINDOW — prevent console flashing
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let child = cmd.spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "Failed to spawn PowerShell");
            return None;
        }
    };

    // Wait with timeout
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    debug!(exit_code = ?status.code(), stderr = %stderr, "PowerShell exited with error");
                }
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return if stdout.is_empty() { None } else { Some(stdout) };
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    warn!("PowerShell command timed out after {:?}, killing", timeout);
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                warn!(error = %e, "Failed to check PowerShell status");
                let _ = child.kill();
                return None;
            }
        }
    }
}

// ── Collectors ──

/// Collect Windows Update information via COM object.
/// This can be VERY slow (up to 10s) — uses extended timeout.
pub fn collect_update_info() -> WindowsUpdateInfo {
    debug!("Collecting Windows Update info");

    let script = r#"
$result = @{ pending = 0; security = 0; last = 'never'; reboot = $false }
try {
    $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
    $updates = $searcher.Search("IsInstalled=0")
    $result.pending = $updates.Updates.Count
    $result.security = @($updates.Updates | Where-Object {
        $dominated = $false
        foreach ($cat in $_.Categories) { if ($cat.Name -eq 'Security Updates') { $dominated = $true } }
        $dominated
    }).Count
} catch {}
try {
    $hotfix = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
    if ($hotfix) { $result.last = $hotfix.InstalledOn.ToString('yyyy-MM-dd') }
} catch {}
$result.reboot = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$result | ConvertTo-Json -Compress
"#;

    let Some(json) = run_ps(script, UPDATE_TIMEOUT) else {
        warn!("Failed to collect Windows Update info, using defaults");
        return WindowsUpdateInfo::default();
    };

    parse_update_info(&json).unwrap_or_else(|| {
        warn!(raw = %json, "Failed to parse Windows Update JSON");
        WindowsUpdateInfo::default()
    })
}

fn parse_update_info(json: &str) -> Option<WindowsUpdateInfo> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(WindowsUpdateInfo {
        pending_updates: v.get("pending")?.as_u64()? as u32,
        pending_security: v.get("security")?.as_u64()? as u32,
        last_installed: v.get("last")?.as_str()?.to_string(),
        reboot_required: v.get("reboot")?.as_bool()?,
    })
}

/// Collect Windows Defender status via Get-MpComputerStatus.
pub fn collect_defender_info() -> DefenderInfo {
    debug!("Collecting Defender info");

    let script = r#"
try {
    $s = Get-MpComputerStatus
    @{
        rtp = $s.RealTimeProtectionEnabled
        av = $s.AntivirusEnabled
        sigVer = $s.AntivirusSignatureVersion
        sigAge = $s.AntivirusSignatureAge
        lastQuick = if ($s.QuickScanEndTime) { $s.QuickScanEndTime.ToString('yyyy-MM-dd HH:mm') } else { 'never' }
        lastFull = if ($s.FullScanEndTime) { $s.FullScanEndTime.ToString('yyyy-MM-dd HH:mm') } else { 'never' }
    } | ConvertTo-Json -Compress
} catch {
    '{"error":"not_available"}'
}
"#;

    let Some(json) = run_ps(script, PS_TIMEOUT) else {
        warn!("Failed to collect Defender info, using defaults");
        return DefenderInfo::default();
    };

    parse_defender_info(&json).unwrap_or_else(|| {
        warn!(raw = %json, "Failed to parse Defender JSON");
        DefenderInfo::default()
    })
}

fn parse_defender_info(json: &str) -> Option<DefenderInfo> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;

    if v.get("error").is_some() {
        return None;
    }

    // Determine last scan type and time
    let last_quick = v.get("lastQuick")?.as_str().unwrap_or("never");
    let last_full = v.get("lastFull")?.as_str().unwrap_or("never");
    let (last_scan_time, last_scan_type) = if last_full != "never" && last_full >= last_quick {
        (last_full.to_string(), "Full".to_string())
    } else if last_quick != "never" {
        (last_quick.to_string(), "Quick".to_string())
    } else {
        ("never".to_string(), "unknown".to_string())
    };

    Some(DefenderInfo {
        real_time_protection: v.get("rtp")?.as_bool().unwrap_or(false),
        antivirus_enabled: v.get("av")?.as_bool().unwrap_or(false),
        signature_version: v.get("sigVer")?.as_str().unwrap_or("unknown").to_string(),
        signature_age_days: v.get("sigAge")?.as_u64().unwrap_or(u32::MAX as u64) as u32,
        last_scan_time,
        last_scan_type,
    })
}

/// Collect Event Log summary (errors, warnings, critical) for last 24 hours.
pub fn collect_event_log_summary() -> EventLogSummary {
    debug!("Collecting Event Log summary");

    let script = r#"
try {
    $start = (Get-Date).AddHours(-24)
    $events = Get-WinEvent -FilterHashtable @{LogName='Application','System'; Level=1,2,3; StartTime=$start} -ErrorAction SilentlyContinue
    $grouped = $events | Group-Object Level -NoElement
    $result = @{ critical = 0; errors = 0; warnings = 0 }
    foreach ($g in $grouped) {
        switch ($g.Name) {
            '1' { $result.critical = $g.Count }
            '2' { $result.errors = $g.Count }
            '3' { $result.warnings = $g.Count }
        }
    }
    $result | ConvertTo-Json -Compress
} catch {
    '{"critical":0,"errors":0,"warnings":0}'
}
"#;

    let Some(json) = run_ps(script, PS_TIMEOUT) else {
        warn!("Failed to collect Event Log summary, using defaults");
        return EventLogSummary::default();
    };

    parse_event_log(&json).unwrap_or_else(|| {
        warn!(raw = %json, "Failed to parse Event Log JSON");
        EventLogSummary::default()
    })
}

fn parse_event_log(json: &str) -> Option<EventLogSummary> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(EventLogSummary {
        critical_24h: v.get("critical")?.as_u64()? as u32,
        errors_24h: v.get("errors")?.as_u64()? as u32,
        warnings_24h: v.get("warnings")?.as_u64()? as u32,
    })
}

/// Collect Windows Firewall profile status.
pub fn collect_firewall_info() -> FirewallInfo {
    debug!("Collecting Firewall info");

    let script = r#"
try {
    $profiles = Get-NetFirewallProfile | Select-Object Name, Enabled
    $result = @{ domain = $false; private = $false; public = $false }
    foreach ($p in $profiles) {
        switch ($p.Name) {
            'Domain'  { $result.domain = $p.Enabled }
            'Private' { $result.private = $p.Enabled }
            'Public'  { $result.public = $p.Enabled }
        }
    }
    $result | ConvertTo-Json -Compress
} catch {
    '{"domain":false,"private":false,"public":false}'
}
"#;

    let Some(json) = run_ps(script, PS_TIMEOUT) else {
        warn!("Failed to collect Firewall info, using defaults");
        return FirewallInfo::default();
    };

    parse_firewall_info(&json).unwrap_or_else(|| {
        warn!(raw = %json, "Failed to parse Firewall JSON");
        FirewallInfo::default()
    })
}

fn parse_firewall_info(json: &str) -> Option<FirewallInfo> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(FirewallInfo {
        domain_enabled: v.get("domain")?.as_bool().unwrap_or(false),
        private_enabled: v.get("private")?.as_bool().unwrap_or(false),
        public_enabled: v.get("public")?.as_bool().unwrap_or(false),
    })
}

/// Collect all Windows-specific info into a single report.
///
/// Each sub-collector runs independently — a failure in one does not
/// block the others. Hostname, uptime, and OS version come from sysinfo
/// crate (already a dependency) for reliability.
pub fn collect_all() -> WindowsReport {
    debug!("Collecting full Windows report (parallel)");

    // Spawn 4 threads for parallel PS collection (~19s → ~10s)
    let (updates, defender, event_log, firewall) = std::thread::scope(|s| {
        let h1 = s.spawn(collect_update_info);
        let h2 = s.spawn(collect_defender_info);
        let h3 = s.spawn(collect_event_log_summary);
        let h4 = s.spawn(collect_firewall_info);
        (
            h1.join().unwrap_or_default(),
            h2.join().unwrap_or_default(),
            h3.join().unwrap_or_default(),
            h4.join().unwrap_or_default(),
        )
    });

    let hostname = sysinfo::System::host_name().unwrap_or_else(|| "unknown".into());
    let os_version = format!(
        "{} {}",
        sysinfo::System::name().unwrap_or_default(),
        sysinfo::System::os_version().unwrap_or_default(),
    );
    let uptime_hours = sysinfo::System::uptime() / 3600;

    WindowsReport {
        updates,
        defender,
        event_log,
        firewall,
        os_version,
        hostname,
        uptime_hours,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_update_info() {
        let json = r#"{"pending":3,"security":1,"last":"2026-04-01","reboot":true}"#;
        let info = parse_update_info(json).unwrap();
        assert_eq!(info.pending_updates, 3);
        assert_eq!(info.pending_security, 1);
        assert_eq!(info.last_installed, "2026-04-01");
        assert!(info.reboot_required);
    }

    #[test]
    fn test_parse_update_info_invalid() {
        assert!(parse_update_info("not json").is_none());
        assert!(parse_update_info("{}").is_none());
    }

    #[test]
    fn test_parse_defender_info() {
        let json = r#"{"rtp":true,"av":true,"sigVer":"1.405.123.0","sigAge":2,"lastQuick":"2026-04-05 14:30","lastFull":"2026-04-03 02:00"}"#;
        let info = parse_defender_info(json).unwrap();
        assert!(info.real_time_protection);
        assert!(info.antivirus_enabled);
        assert_eq!(info.signature_version, "1.405.123.0");
        assert_eq!(info.signature_age_days, 2);
        assert_eq!(info.last_scan_time, "2026-04-05 14:30");
        assert_eq!(info.last_scan_type, "Quick");
    }

    #[test]
    fn test_parse_defender_not_available() {
        let json = r#"{"error":"not_available"}"#;
        assert!(parse_defender_info(json).is_none());
    }

    #[test]
    fn test_parse_defender_full_scan_newer() {
        let json = r#"{"rtp":true,"av":true,"sigVer":"1.0","sigAge":0,"lastQuick":"2026-04-01 10:00","lastFull":"2026-04-05 02:00"}"#;
        let info = parse_defender_info(json).unwrap();
        assert_eq!(info.last_scan_type, "Full");
        assert_eq!(info.last_scan_time, "2026-04-05 02:00");
    }

    #[test]
    fn test_parse_event_log() {
        let json = r#"{"critical":1,"errors":15,"warnings":42}"#;
        let summary = parse_event_log(json).unwrap();
        assert_eq!(summary.critical_24h, 1);
        assert_eq!(summary.errors_24h, 15);
        assert_eq!(summary.warnings_24h, 42);
    }

    #[test]
    fn test_parse_firewall_info() {
        let json = r#"{"domain":true,"private":true,"public":false}"#;
        let info = parse_firewall_info(json).unwrap();
        assert!(info.domain_enabled);
        assert!(info.private_enabled);
        assert!(!info.public_enabled);
    }

    #[test]
    fn test_defaults() {
        let updates = WindowsUpdateInfo::default();
        assert_eq!(updates.pending_updates, 0);
        assert_eq!(updates.last_installed, "unknown");

        let defender = DefenderInfo::default();
        assert!(!defender.real_time_protection);
        assert_eq!(defender.signature_age_days, u32::MAX);

        let event_log = EventLogSummary::default();
        assert_eq!(event_log.errors_24h, 0);

        let firewall = FirewallInfo::default();
        assert!(!firewall.domain_enabled);
    }
}
