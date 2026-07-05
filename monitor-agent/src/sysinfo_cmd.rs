//! System information gathering using the `sysinfo` crate.

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, ProcessesToUpdate, System};

#[derive(Debug, Deserialize)]
pub struct SysInfoRequest {
    pub request_id: String,
}

#[derive(Debug, Serialize)]
pub struct SysInfoResult {
    pub request_id: String,
    pub hostname: String,
    pub os_version: String,
    pub cpu_count: usize,
    pub cpu_usage: f32,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub free_memory_mb: u64,
    pub disks: Vec<DiskInfo>,
    pub uptime_secs: u64,
    pub load_average: LoadAvg,
    pub top_processes: Vec<ProcessInfo>,
    pub self_metrics: Option<SelfMetrics>,
}

/// Self-monitoring metrics for the monitor-agent process itself.
#[derive(Debug, Clone, Serialize, Default)]
pub struct SelfMetrics {
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub uptime_secs: u64,
    pub thread_count: u32,
    pub health_status: String,
}

/// Collect resource metrics for the current monitor-agent process.
pub fn collect_self_metrics(start_time: std::time::Instant) -> SelfMetrics {
    let pid = std::process::id();
    let sysinfo_pid = sysinfo::Pid::from_u32(pid);

    let mut sys = System::new();
    // First refresh to seed CPU baseline.
    sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), true);
    std::thread::sleep(std::time::Duration::from_millis(200));
    // Second refresh to get meaningful CPU usage delta.
    sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), true);

    if let Some(proc) = sys.process(sysinfo_pid) {
        let cpu = proc.cpu_usage();
        let mem_mb = proc.memory() / (1024 * 1024);
        SelfMetrics {
            pid,
            cpu_percent: cpu,
            memory_mb: mem_mb,
            uptime_secs: start_time.elapsed().as_secs(),
            thread_count: 0, // sysinfo 0.33 does not expose per-process thread count
            health_status: determine_health(cpu, mem_mb),
        }
    } else {
        SelfMetrics {
            pid,
            health_status: "unknown".into(),
            uptime_secs: start_time.elapsed().as_secs(),
            ..Default::default()
        }
    }
}

fn determine_health(cpu: f32, mem_mb: u64) -> String {
    if cpu > 80.0 || mem_mb > 500 {
        "critical".into()
    } else if cpu > 50.0 || mem_mb > 300 {
        "degraded".into()
    } else {
        "healthy".into()
    }
}

/// Per-process resource usage snapshot.
#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total_gb: f64,
    pub free_gb: f64,
    pub fs_type: String,
}

#[derive(Debug, Serialize)]
pub struct LoadAvg {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

/// Gather current system information.
///
/// When `agent_start_time` is provided, self-monitoring metrics for the
/// monitor-agent process are included in the result.
pub fn gather(request_id: String) -> SysInfoResult {
    gather_with_self_metrics(request_id, None)
}

/// Gather system information, optionally including agent self-metrics.
pub fn gather_with_self_metrics(
    request_id: String,
    agent_start_time: Option<std::time::Instant>,
) -> SysInfoResult {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hostname = System::host_name().unwrap_or_else(|| "unknown".into());
    let os_version = format!(
        "{} {}",
        System::name().unwrap_or_default(),
        System::os_version().unwrap_or_default()
    );

    let cpu_count = sys.cpus().len();
    let cpu_usage = sys.global_cpu_usage();

    let total_memory_mb = sys.total_memory() / (1024 * 1024);
    let used_memory_mb = sys.used_memory() / (1024 * 1024);
    let free_memory_mb = sys.available_memory() / (1024 * 1024);

    let disk_list = Disks::new_with_refreshed_list();
    let disks: Vec<DiskInfo> = disk_list
        .iter()
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().into_owned(),
            mount_point: d.mount_point().to_string_lossy().into_owned(),
            total_gb: d.total_space() as f64 / (1024.0 * 1024.0 * 1024.0),
            free_gb: d.available_space() as f64 / (1024.0 * 1024.0 * 1024.0),
            fs_type: d.file_system().to_string_lossy().into_owned(),
        })
        .collect();

    let uptime_secs = System::uptime();

    let la = System::load_average();
    let load_average = LoadAvg {
        one: la.one,
        five: la.five,
        fifteen: la.fifteen,
    };

    // Top processes by CPU — need two refresh cycles for accurate CPU readings.
    std::thread::sleep(std::time::Duration::from_millis(500));
    sys.refresh_all();

    let top_processes = get_top_processes_from(&sys, 10);

    let self_metrics = agent_start_time.map(collect_self_metrics);

    SysInfoResult {
        request_id,
        hostname,
        os_version,
        cpu_count,
        cpu_usage,
        total_memory_mb,
        used_memory_mb,
        free_memory_mb,
        disks,
        uptime_secs,
        load_average,
        top_processes,
        self_metrics,
    }
}

/// Get top N processes by CPU usage from an already-refreshed `System`.
fn get_top_processes_from(sys: &System, count: usize) -> Vec<ProcessInfo> {
    let mut procs: Vec<ProcessInfo> = sys
        .processes()
        .values()
        .map(|p| ProcessInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu_percent: p.cpu_usage(),
            memory_mb: p.memory() / (1024 * 1024),
            status: format!("{:?}", p.status()),
        })
        .collect();

    procs.sort_by(|a, b| {
        b.cpu_percent
            .partial_cmp(&a.cpu_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    procs.truncate(count);
    procs
}

/// Get top N processes by CPU usage (standalone, allocates its own `System`).
pub fn get_top_processes(count: usize) -> Vec<ProcessInfo> {
    let mut sys = System::new_all();
    sys.refresh_all();
    std::thread::sleep(std::time::Duration::from_millis(500));
    sys.refresh_all();
    get_top_processes_from(&sys, count)
}

/// Check if a specific process is running by name (case-insensitive substring match).
pub fn is_process_alive(name: &str) -> bool {
    let sys = System::new_all();
    let needle = name.to_lowercase();
    sys.processes()
        .values()
        .any(|p| p.name().to_string_lossy().to_lowercase().contains(&needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- determine_health thresholds ---

    #[test]
    fn test_health_healthy() {
        assert_eq!(determine_health(10.0, 100), "healthy");
        assert_eq!(determine_health(0.0, 0), "healthy");
        assert_eq!(determine_health(50.0, 300), "healthy");
    }

    #[test]
    fn test_health_degraded() {
        assert_eq!(determine_health(51.0, 100), "degraded");
        assert_eq!(determine_health(10.0, 301), "degraded");
        assert_eq!(determine_health(80.0, 400), "degraded");
    }

    #[test]
    fn test_health_critical() {
        assert_eq!(determine_health(81.0, 100), "critical");
        assert_eq!(determine_health(10.0, 501), "critical");
        assert_eq!(determine_health(99.0, 999), "critical");
    }

    #[test]
    fn test_health_boundary_values() {
        // Exact boundaries
        assert_eq!(determine_health(50.0, 300), "healthy");
        assert_eq!(determine_health(50.1, 300), "degraded");
        assert_eq!(determine_health(50.0, 301), "degraded");
        assert_eq!(determine_health(80.0, 500), "degraded");
        assert_eq!(determine_health(80.1, 500), "critical");
        assert_eq!(determine_health(80.0, 501), "critical");
    }

    // --- SelfMetrics default ---

    #[test]
    fn test_self_metrics_default() {
        let m = SelfMetrics::default();
        assert_eq!(m.pid, 0);
        assert_eq!(m.cpu_percent, 0.0);
        assert_eq!(m.memory_mb, 0);
        assert_eq!(m.uptime_secs, 0);
        assert_eq!(m.thread_count, 0);
        assert_eq!(m.health_status, "");
    }

    // --- ProcessInfo sorting ---

    #[test]
    fn test_process_info_sort_by_cpu() {
        let mut procs = vec![
            ProcessInfo { pid: 1, name: "low".into(), cpu_percent: 5.0, memory_mb: 100, status: "Run".into() },
            ProcessInfo { pid: 2, name: "high".into(), cpu_percent: 90.0, memory_mb: 50, status: "Run".into() },
            ProcessInfo { pid: 3, name: "mid".into(), cpu_percent: 45.0, memory_mb: 200, status: "Run".into() },
        ];
        procs.sort_by(|a, b| {
            b.cpu_percent
                .partial_cmp(&a.cpu_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        assert_eq!(procs[0].name, "high");
        assert_eq!(procs[1].name, "mid");
        assert_eq!(procs[2].name, "low");
    }

    // --- get_top_processes_from truncation ---

    #[test]
    fn test_get_top_processes_truncation() {
        let sys = System::new();
        // Empty system — should return empty vec, not panic
        let result = get_top_processes_from(&sys, 5);
        assert!(result.len() <= 5);
    }

    // --- SysInfoResult serialization ---

    #[test]
    fn test_sysinfo_result_serializes() {
        let result = SysInfoResult {
            request_id: "test-1".into(),
            hostname: "TestPC".into(),
            os_version: "Windows 11".into(),
            cpu_count: 8,
            cpu_usage: 25.5,
            total_memory_mb: 16384,
            used_memory_mb: 8000,
            free_memory_mb: 8384,
            disks: vec![],
            uptime_secs: 3600,
            load_average: LoadAvg { one: 1.0, five: 0.5, fifteen: 0.3 },
            top_processes: vec![],
            self_metrics: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"hostname\":\"TestPC\""));
        assert!(json.contains("\"cpu_count\":8"));
    }

    #[test]
    fn test_disk_info_serializes() {
        let disk = DiskInfo {
            name: "C:".into(),
            mount_point: "C:\\".into(),
            total_gb: 500.0,
            free_gb: 200.0,
            fs_type: "NTFS".into(),
        };
        let json = serde_json::to_string(&disk).unwrap();
        assert!(json.contains("NTFS"));
        assert!(json.contains("C:"));
    }
}
