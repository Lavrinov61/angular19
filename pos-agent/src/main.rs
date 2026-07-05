mod agent;
mod atol;
#[cfg(windows)]
mod atol_ffi;
mod commands;
mod inpas;
mod telemetry;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/svf.infra.rs"));
}

/// Type alias so commands.rs, telemetry.rs etc. can keep `use crate::AgentState`.
pub type AgentState = agent::PosAgentState;

// Re-export config types used by other modules
pub use agent::{AtolConfig, InpasConfig, PosAgentConfig, PosTelemetryConfig};

// ── Platform-specific entry points ──

#[cfg(not(windows))]
fn main() -> anyhow::Result<()> {
    svf_agent_core::runner::AgentRunner::new(agent::PosAgent).run()
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let console = args.iter().any(|a| a == "--console");
    if console {
        svf_agent_core::runner::AgentRunner::new(agent::PosAgent).run()
    } else {
        svf_agent_core::logging::init("svf_pos_agent", false);
        windows_service_main()
    }
}

#[cfg(windows)]
fn windows_service_main() -> anyhow::Result<()> {
    use windows_service::service_dispatcher;
    service_dispatcher::start("SvfPosAgent", ffi_service_main)?;
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

    let status_handle = match service_control_handler::register("SvfPosAgent", event_handler) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("Failed to register service control handler: {e}");
            return;
        }
    };

    let set_stopped = |handle: &windows_service::service_control_handler::ServiceStatusHandle,
                       code: u32| {
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

    let runner = svf_agent_core::runner::AgentRunner::new(agent::PosAgent);
    let agent_handle = rt.spawn(async move { runner.run_agent().await });

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
