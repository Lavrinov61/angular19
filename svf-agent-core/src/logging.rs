//! Logging setup — file + optional console output.
//!
//! File logs go to `{exe_dir}/agent.log` with daily rotation.
//! Console output is only attached when running with `--console`.

use std::path::PathBuf;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Resolve the directory containing the current executable.
/// Falls back to CWD if the exe path cannot be determined.
pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Initialize tracing with file logging and optional console output.
///
/// - `agent_name`: used for the default env-filter (e.g. `"svf_pos_agent"`)
/// - `console`: if true, also log to stderr (for `--console` mode)
pub fn init(agent_name: &str, console: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| format!("info,{agent_name}=debug").parse().unwrap());

    let log_dir = exe_dir();
    let file_appender = rolling::daily(&log_dir, "agent.log");

    let file_layer = fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false);

    if console {
        tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .with(fmt::layer().with_writer(std::io::stderr))
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .init();
    }
}
