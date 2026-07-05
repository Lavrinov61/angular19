mod agent;
mod canon_api;
mod commands;
mod discovery;
mod icc;
mod pipeline;
mod printing;
mod scan;
mod snmp;
mod telemetry;

#[cfg(target_os = "linux")]
mod cups_print;
#[cfg(target_os = "windows")]
mod printticket;
#[cfg(target_os = "windows")]
mod win_print;

pub mod print_proto {
    include!(concat!(env!("OUT_DIR"), "/svf.print.rs"));
}

pub mod infra_proto {
    include!(concat!(env!("OUT_DIR"), "/svf.infra.rs"));
}

/// Backward-compatible alias — all modules use `crate::AgentState`.
pub type AgentState = agent::PrintAgentState;

/// Print agent config extends BaseConfig with print-specific settings.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PrintAgentConfig {
    #[serde(flatten)]
    pub base: svf_agent_core::config::BaseConfig,
    #[serde(default)]
    pub printing: PrintingConfig,
    #[serde(default)]
    pub icc: IccConfig,
    #[serde(default)]
    pub telemetry: TelemetryConfig,
    #[serde(default)]
    pub canon: canon_api::CanonConfig,
    #[serde(default)]
    pub scan: scan::ScanConfig,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct PrintingConfig {
    /// Target DPI for image rendering (default: 300)
    #[serde(default = "default_dpi")]
    pub target_dpi: u32,

    /// JPEG output quality for print files (default: 95)
    #[serde(default = "default_jpeg_quality")]
    pub jpeg_quality: u8,

    /// Default printer name (if empty, use printer_id from PrintCommand)
    #[serde(default)]
    pub default_printer: String,
}

impl Default for PrintingConfig {
    fn default() -> Self {
        Self {
            target_dpi: default_dpi(),
            jpeg_quality: default_jpeg_quality(),
            default_printer: String::new(),
        }
    }
}

fn default_jpeg_quality() -> u8 {
    95
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct IccConfig {
    #[serde(default = "default_icc_cache_dir")]
    pub cache_dir: String,
}

impl Default for IccConfig {
    fn default() -> Self {
        Self {
            cache_dir: default_icc_cache_dir(),
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TelemetryConfig {
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    /// Canon printer IP for SNMP polling
    #[serde(default)]
    pub printer_ip: String,
    /// SNMP community string
    #[serde(default = "default_snmp_community")]
    pub snmp_community: String,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            poll_interval_secs: default_poll_interval(),
            printer_ip: String::new(),
            snmp_community: default_snmp_community(),
        }
    }
}

fn default_dpi() -> u32 {
    300
}
fn default_poll_interval() -> u64 {
    30
}
fn default_snmp_community() -> String {
    "public".into()
}

fn default_icc_cache_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("ProgramData")
            .map(|pd| format!("{pd}\\SvoePhoto\\icc"))
            .unwrap_or_else(|_| "C:\\ProgramData\\SvoePhoto\\icc".into())
    }
    #[cfg(not(target_os = "windows"))]
    {
        "/var/lib/svf-agent/icc".into()
    }
}

// ── Platform-specific entry points ──

#[cfg(not(windows))]
fn main() -> anyhow::Result<()> {
    svf_agent_core::runner::AgentRunner::new(agent::PrintAgent).run()
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let console = args.iter().any(|a| a == "--console");
    if console {
        svf_agent_core::runner::AgentRunner::new(agent::PrintAgent).run()
    } else {
        svf_agent_core::logging::init("svf_print_agent", false);
        windows_service_main()
    }
}

#[cfg(windows)]
fn windows_service_main() -> anyhow::Result<()> {
    use windows_service::service_dispatcher;
    service_dispatcher::start("SvfPrintAgent", ffi_service_main)?;
    Ok(())
}

#[cfg(windows)]
windows_service::define_windows_service!(ffi_service_main, service_main);

#[cfg(windows)]
fn service_main(_args: Vec<std::ffi::OsString>) {
    use std::sync::mpsc;
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};

    let (shutdown_tx, shutdown_rx) = mpsc::channel();

    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };

    let status_handle = match service_control_handler::register("SvfPrintAgent", event_handler) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("Failed to register service control handler: {e}");
            return;
        }
    };

    let set_stopped = |handle: &windows_service::service_control_handler::ServiceStatusHandle, code: u32| {
        let _ = handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(code),
            checkpoint: 0,
            wait_hint: std::time::Duration::default(),
            process_id: None,
        });
    };

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!("Failed to create tokio runtime: {e}");
            set_stopped(&status_handle, 1);
            return;
        }
    };

    let runner = svf_agent_core::runner::AgentRunner::new(agent::PrintAgent);
    let agent_handle = rt.spawn(async move {
        runner.run_agent().await
    });

    // Report Running after brief init
    let status_for_check = status_handle.clone();
    let _check_handle = rt.spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let _ = status_for_check.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: std::time::Duration::default(),
            process_id: None,
        });
    });

    // Set StartPending immediately
    let _ = status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::StartPending,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 1,
        wait_hint: std::time::Duration::from_secs(10),
        process_id: None,
    });

    // Wait for SCM stop signal or agent crash
    loop {
        if shutdown_rx.try_recv().is_ok() {
            tracing::info!("Service stop requested");
            break;
        }
        if agent_handle.is_finished() {
            let result = rt.block_on(agent_handle);
            match result {
                Ok(Ok(())) => tracing::info!("Agent exited cleanly"),
                Ok(Err(e)) => tracing::error!("Agent fatal error: {e:#}"),
                Err(e) => tracing::error!("Agent task panicked: {e}"),
            }
            set_stopped(&status_handle, 1);
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    set_stopped(&status_handle, 0);
}
