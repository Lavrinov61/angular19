//! Agent trait — implement to create a new SVF field agent.
//!
//! Each agent binary implements [`Agent`] + [`AgentConfig`] and hands itself
//! to [`AgentRunner`](crate::runner::AgentRunner) which owns the full lifecycle.

use std::sync::Arc;
use std::time::Instant;

use crate::config::BaseConfig;
use crate::error::AgentError;
use crate::health::HealthStatus;
use crate::mqtt::MqttHandle;
use crate::offline::OfflineStore;
use crate::AgentType;

/// Core trait every SVF agent must implement.
///
/// Generic over `Config` (TOML-deserialised) and `State` (shared across tasks).
/// RPITIT is used for async methods (Rust 2024 edition).
pub trait Agent: Send + Sync + 'static {
    /// Agent-specific config (must embed [`BaseConfig`] via [`AgentConfig`]).
    type Config: AgentConfig;

    /// Shared state constructed once during startup and passed to all tasks.
    type State: Send + Sync + 'static;

    /// Which agent type this is (print, pos, monitor, guard, vision).
    fn agent_type(&self) -> AgentType;

    /// Windows service name (e.g. `"SvfGuardAgent"`).
    fn service_name(&self) -> &'static str;

    /// Tracing filter target (e.g. `"svf_guard_agent"`).
    fn log_name(&self) -> &'static str;

    /// MQTT client-id prefix (e.g. `"svf-guard"`).
    fn client_id_prefix(&self) -> &'static str;

    /// Validate and optionally mutate config after loading.
    /// Return `Err(AgentError::Config(..))` on invalid values.
    fn validate_config(&self, config: &Self::Config) -> Result<(), AgentError>;

    /// Build the shared state from loaded components.
    fn build_state(
        &self,
        config: Self::Config,
        mqtt_handle: MqttHandle,
        offline_store: OfflineStore,
        start_time: Instant,
    ) -> Result<Arc<Self::State>, AgentError>;

    /// MQTT topics to subscribe on (re-)connect.
    /// Each entry is a suffix appended to `svoefoto/{studio_id}/{agent_type}/`.
    /// Example: `vec!["commands/scan", "commands/update", "config"]`
    fn subscribe_topics(&self) -> Vec<&'static str>;

    /// Called for every incoming MQTT Publish packet.
    fn handle_message(
        state: Arc<Self::State>,
        topic: String,
        payload: Vec<u8>,
    ) -> impl std::future::Future<Output = ()> + Send;

    /// Spawn long-running background tasks (scanners, sync loops, etc.).
    /// Returns `(name, JoinHandle)` pairs for structured shutdown.
    fn spawn_tasks(
        &self,
        state: Arc<Self::State>,
    ) -> Vec<(&'static str, tokio::task::JoinHandle<()>)>;

    /// Optional health check — default is Healthy.
    fn health_check(&self, _state: &Self::State) -> HealthStatus {
        HealthStatus::Healthy
    }

    /// Optional graceful shutdown hook.
    fn on_shutdown(
        &self,
        _state: &Self::State,
    ) -> impl std::future::Future<Output = ()> + Send {
        async {}
    }
}

/// Config trait — bridges agent-specific config to the shared [`BaseConfig`].
pub trait AgentConfig: serde::de::DeserializeOwned + Clone + Send + Sync + 'static {
    /// Borrow the embedded base config.
    fn base(&self) -> &BaseConfig;

    /// Mutably borrow the embedded base config.
    fn base_mut(&mut self) -> &mut BaseConfig;
}
