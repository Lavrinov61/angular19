//! Network monitoring — interfaces, latency, bandwidth.

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::{Duration, Instant};
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip_address: String,
    pub mac_address: String,
    pub speed_mbps: u64,
    pub status: String, // "Up", "Down", "Disconnected"
}

#[derive(Debug, Clone, Serialize)]
pub struct LatencyReport {
    pub gateway_ms: Option<f64>,
    pub dns_ms: Option<f64>,
    pub mqtt_broker_ms: Option<f64>,
    pub internet_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkReport {
    pub interfaces: Vec<NetworkInterface>,
    pub latency: LatencyReport,
}

// --- PowerShell deserialization helpers ---

#[derive(Debug, Deserialize)]
struct PsAdapter {
    #[serde(alias = "Name")]
    name: Option<String>,
    #[serde(alias = "MacAddress")]
    mac_address: Option<String>,
    #[serde(alias = "LinkSpeed")]
    link_speed: Option<String>,
    #[serde(alias = "Status")]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PsIpAddress {
    #[serde(alias = "InterfaceAlias")]
    interface_alias: Option<String>,
    #[serde(alias = "IPAddress")]
    ip_address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PsPing {
    #[serde(alias = "ResponseTime")]
    response_time: Option<f64>,
}

// --- Implementation ---

/// Collect network interfaces via PowerShell Get-NetAdapter + Get-NetIPAddress.
pub fn collect_interfaces() -> Vec<NetworkInterface> {
    let adapters = run_ps_json::<Vec<PsAdapter>>(
        "Get-NetAdapter | Select-Object Name,MacAddress,LinkSpeed,Status | ConvertTo-Json -Compress",
    );
    let ips = run_ps_json::<Vec<PsIpAddress>>(
        "Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,IPAddress | ConvertTo-Json -Compress",
    );

    let adapters = match adapters {
        Some(a) => a,
        None => {
            warn!("Failed to query network adapters");
            return Vec::new();
        }
    };

    let ips = ips.unwrap_or_default();

    adapters
        .into_iter()
        .map(|a| {
            let name = a.name.unwrap_or_default();
            let ip_address = ips
                .iter()
                .find(|ip| ip.interface_alias.as_deref() == Some(&name))
                .and_then(|ip| ip.ip_address.clone())
                .unwrap_or_default();
            let speed_mbps = parse_link_speed(a.link_speed.as_deref().unwrap_or(""));

            NetworkInterface {
                name,
                ip_address,
                mac_address: a.mac_address.unwrap_or_default(),
                speed_mbps,
                status: a.status.unwrap_or_else(|| "Unknown".into()),
            }
        })
        .collect()
}

/// Measure TCP connect latency to host:port.
/// Pure Rust, no PowerShell needed.
pub fn measure_latency(host: &str, port: u16, timeout_ms: u64) -> Option<f64> {
    let addr_str = format!("{host}:{port}");
    let addr: SocketAddr = match addr_str.parse() {
        Ok(a) => a,
        Err(_) => {
            // Resolve hostname via DNS
            use std::net::ToSocketAddrs;
            match addr_str.to_socket_addrs() {
                Ok(mut addrs) => match addrs.next() {
                    Some(a) => a,
                    None => {
                        warn!("No addresses resolved for {addr_str}");
                        return None;
                    }
                },
                Err(e) => {
                    warn!("DNS resolution failed for {addr_str}: {e}");
                    return None;
                }
            }
        }
    };

    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    match TcpStream::connect_timeout(&addr, timeout) {
        Ok(_stream) => {
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            debug!("TCP connect to {addr_str}: {elapsed:.1}ms");
            Some(elapsed)
        }
        Err(e) => {
            warn!("TCP connect to {addr_str} failed: {e}");
            None
        }
    }
}

/// Ping a host via PowerShell Test-Connection (ICMP requires elevation).
pub fn ping_host(ip: &str) -> Option<f64> {
    let cmd = format!(
        "Test-Connection -ComputerName '{ip}' -Count 1 -TimeoutSeconds 3 | Select-Object ResponseTime | ConvertTo-Json -Compress"
    );

    let result = run_ps_json::<PsPing>(&cmd);
    match result {
        Some(p) => {
            debug!("Ping {ip}: {:?}ms", p.response_time);
            p.response_time
        }
        None => {
            warn!("Ping to {ip} failed");
            None
        }
    }
}

/// Collect latency to gateway, DNS, MQTT broker, and internet.
pub fn collect_latency(mqtt_host: &str) -> LatencyReport {
    // Gateway: default route next hop
    let gateway_ms = get_default_gateway()
        .and_then(|gw| {
            debug!("Default gateway: {gw}");
            ping_host(&gw)
        });

    // DNS: ping 8.8.8.8
    let dns_ms = ping_host("8.8.8.8");

    // MQTT broker: TCP connect to port 8883 (TLS)
    let mqtt_broker_ms = measure_latency(mqtt_host, 8883, 5000);

    // Internet: ping 1.1.1.1
    let internet_ms = ping_host("1.1.1.1");

    LatencyReport {
        gateway_ms,
        dns_ms,
        mqtt_broker_ms,
        internet_ms,
    }
}

/// Collect full network report: interfaces + latency.
pub fn collect_all(mqtt_host: &str) -> NetworkReport {
    debug!("Collecting network report (mqtt_host={mqtt_host})");
    NetworkReport {
        interfaces: collect_interfaces(),
        latency: collect_latency(mqtt_host),
    }
}

// --- Helpers ---

/// Get the default gateway IP from Windows routing table.
fn get_default_gateway() -> Option<String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1).NextHop",
        ])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let gw = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if gw.is_empty() {
                None
            } else {
                Some(gw)
            }
        }
        Ok(o) => {
            warn!(
                "Get-NetRoute failed: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            );
            None
        }
        Err(e) => {
            warn!("Failed to spawn powershell for gateway: {e}");
            None
        }
    }
}

/// Run a PowerShell command and parse JSON output.
/// Handles both single-object and array responses.
fn run_ps_json<T: serde::de::DeserializeOwned>(command: &str) -> Option<T> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", command])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let trimmed = stdout.trim();
            if trimmed.is_empty() {
                debug!("PowerShell returned empty output for: {command}");
                return None;
            }
            match serde_json::from_str(trimmed) {
                Ok(v) => Some(v),
                Err(e) => {
                    warn!("JSON parse error for PowerShell output: {e}");
                    debug!("Raw output: {trimmed}");
                    None
                }
            }
        }
        Ok(o) => {
            warn!(
                "PowerShell command failed: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            );
            None
        }
        Err(e) => {
            warn!("Failed to spawn powershell: {e}");
            None
        }
    }
}

/// Parse LinkSpeed string like "1 Gbps", "100 Mbps", "10 Gbps" → u64 Mbps.
fn parse_link_speed(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }

    // Split into number and unit parts
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 2 {
        return 0;
    }

    let value: f64 = match parts[0].parse() {
        Ok(v) => v,
        Err(_) => return 0,
    };

    match parts[1].to_lowercase().as_str() {
        "gbps" => (value * 1000.0) as u64,
        "mbps" => value as u64,
        "kbps" => (value / 1000.0) as u64,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_link_speed() {
        assert_eq!(parse_link_speed("1 Gbps"), 1000);
        assert_eq!(parse_link_speed("100 Mbps"), 100);
        assert_eq!(parse_link_speed("10 Gbps"), 10000);
        assert_eq!(parse_link_speed(""), 0);
        assert_eq!(parse_link_speed("garbage"), 0);
    }

    #[test]
    fn test_parse_link_speed_kbps() {
        assert_eq!(parse_link_speed("500 Kbps"), 0); // 500/1000 = 0 (u64)
        assert_eq!(parse_link_speed("10000 Kbps"), 10);
    }

    #[test]
    fn test_parse_link_speed_unknown_unit() {
        assert_eq!(parse_link_speed("100 Tbps"), 0);
        assert_eq!(parse_link_speed("100 bps"), 0);
    }

    #[test]
    fn test_parse_link_speed_fractional() {
        assert_eq!(parse_link_speed("2.5 Gbps"), 2500);
        assert_eq!(parse_link_speed("0.1 Gbps"), 100);
    }

    #[test]
    fn test_parse_link_speed_whitespace() {
        assert_eq!(parse_link_speed("  1 Gbps  "), 1000);
    }

    #[test]
    fn test_measure_latency_invalid_host() {
        // Should return None quickly for unreachable address
        let result = measure_latency("192.0.2.1", 1, 200);
        assert!(result.is_none());
    }

    #[test]
    fn test_latency_report_serialization() {
        let report = LatencyReport {
            gateway_ms: Some(1.5),
            dns_ms: Some(10.0),
            mqtt_broker_ms: None,
            internet_ms: Some(25.0),
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"gateway_ms\":1.5"));
        assert!(json.contains("\"mqtt_broker_ms\":null"));
    }

    #[test]
    fn test_network_interface_serialization() {
        let iface = NetworkInterface {
            name: "Ethernet".into(),
            ip_address: "192.168.1.100".into(),
            mac_address: "AA-BB-CC-DD-EE-FF".into(),
            speed_mbps: 1000,
            status: "Up".into(),
        };
        let json = serde_json::to_string(&iface).unwrap();
        assert!(json.contains("\"name\":\"Ethernet\""));
        assert!(json.contains("\"speed_mbps\":1000"));
    }

    #[test]
    fn test_network_report_serialization() {
        let report = NetworkReport {
            interfaces: vec![],
            latency: LatencyReport {
                gateway_ms: None,
                dns_ms: None,
                mqtt_broker_ms: None,
                internet_ms: None,
            },
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"interfaces\":[]"));
    }
}
