//! AgentRunner — generic lifecycle manager for SVF agents.
//!
//! Handles config loading, MQTT connection, task spawning, and structured shutdown.
//!
//! # Usage
//!
//! ```rust,ignore
//! // In main.rs of your agent:
//! let runner = AgentRunner::new(MyAgent);
//!
//! // Console mode (--console flag):
//! runner.run();
//!
//! // Or call run_agent() directly from a Windows service_main:
//! runner.run_agent().await?;
//! ```
//!
//! Windows service dispatch (`define_windows_service!`, `service_dispatcher::start`)
//! must remain in each agent's `main.rs` because the SCM FFI entry point requires
//! a static function that cannot be generated from a generic struct.

use std::sync::Arc;
use std::time::Instant;

use rumqttc::QoS;
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::agent::{Agent, AgentConfig};
use crate::mqtt::{self, MqttHandle};
use crate::offline::OfflineStore;

/// Owns an [`Agent`] implementation and drives its full lifecycle.
pub struct AgentRunner<A: Agent> {
    agent: A,
}

impl<A: Agent> AgentRunner<A> {
    pub fn new(agent: A) -> Self {
        Self { agent }
    }

    /// Console-mode entry point: parse args, init logging, run on tokio.
    ///
    /// For Windows service mode, init logging yourself and call
    /// [`run_agent()`](Self::run_agent) from within `service_main`.
    pub fn run(self) -> anyhow::Result<()> {
        let args: Vec<String> = std::env::args().collect();
        let console = args.iter().any(|a| a == "--console");

        crate::logging::init(self.agent.log_name(), console);

        tokio::runtime::Runtime::new()?.block_on(self.run_agent())
    }

    /// Core agent lifecycle — public so Windows `service_main` can call it.
    ///
    /// Sequence: load config -> validate -> open offline store -> create MQTT ->
    /// build state -> spawn heartbeat -> spawn agent tasks -> MQTT event loop ->
    /// select! shutdown -> on_shutdown.
    pub async fn run_agent(self) -> anyhow::Result<()> {
        let start_time = Instant::now();

        // ── 1. Load and validate config ──
        let config_path = std::env::args().skip(1).find(|a| !a.starts_with('-'));
        let config: A::Config = crate::config::load_config(config_path.as_deref())?;

        self.agent
            .validate_config(&config)
            .map_err(|e| anyhow::anyhow!("{e}"))?;

        let base = config.base();
        info!(
            agent_id = %base.agent.agent_id,
            studio_id = %base.agent.studio_id,
            agent_type = %base.agent.agent_type,
            version = %base.agent.version,
            "Starting {} ({})",
            self.agent.service_name(),
            self.agent.agent_type(),
        );

        // ── 2. Open offline SQLite store ──
        let offline_store = OfflineStore::open(&base.offline.db_path)?;
        info!("Offline store ready");

        // ── 3. Create MQTT client ──
        let agent_id = &base.agent.agent_id;
        let prefix = self.agent.client_id_prefix();
        let client_id = format!("{prefix}-{}", &agent_id[..8.min(agent_id.len())]);
        let (client, eventloop) = mqtt::create_client(&base.mqtt, &client_id);

        let handle = MqttHandle {
            client: Arc::new(RwLock::new(Some(client.clone()))),
            connected: Arc::new(RwLock::new(false)),
        };

        // ── 4. Build agent state ──
        let state = self.agent.build_state(
            config.clone(),
            handle.clone(),
            offline_store,
            start_time,
        )?;

        // ── 5. Spawn heartbeat ──
        let hb_config = config.base().clone();
        let hb_handle = handle.clone();
        let heartbeat_task = tokio::spawn(async move {
            crate::heartbeat::run(&hb_config, hb_handle, start_time).await;
        });

        // ── 6. Spawn agent-specific tasks ──
        let agent_tasks = self.agent.spawn_tasks(Arc::clone(&state));
        let task_names: Vec<&str> = agent_tasks.iter().map(|(name, _)| *name).collect();
        info!(tasks = ?task_names, "Spawned agent tasks");

        // ── 7. MQTT event loop ──
        let topic_prefix = mqtt::topic_prefix(
            &config.base().agent.studio_id,
            &config.base().agent.agent_type,
        );

        let subscribe_suffixes = self.agent.subscribe_topics();
        let subscribe_prefix = topic_prefix.clone();
        let subscribe_client = client.clone();

        let msg_state = Arc::clone(&state);
        let msg_handle = handle.clone();

        let mqtt_task = tokio::spawn(async move {
            mqtt::run_event_loop(
                eventloop,
                msg_handle,
                // on_message: dispatch to Agent::handle_message
                move |topic, payload| {
                    let s = Arc::clone(&msg_state);
                    tokio::spawn(A::handle_message(s, topic, payload));
                },
                // on_connect: re-subscribe to topics
                move || {
                    let p = subscribe_prefix.clone();
                    let c = subscribe_client.clone();
                    let suffixes = subscribe_suffixes.clone();
                    tokio::spawn(async move {
                        let full_topics: Vec<(String, QoS)> = suffixes
                            .iter()
                            .map(|suffix| (format!("{p}/{suffix}"), QoS::AtLeastOnce))
                            .collect();
                        let topic_refs: Vec<(&str, QoS)> = full_topics
                            .iter()
                            .map(|(t, q)| (t.as_str(), *q))
                            .collect();
                        if let Err(e) = mqtt::subscribe_topics(&c, &topic_refs).await {
                            error!("Failed to subscribe: {e}");
                        }
                    });
                },
            )
            .await;
        });

        // ── 8. Wait for shutdown ──
        info!("All tasks started. Waiting for shutdown signal...");

        let mut task_handles = agent_tasks;

        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("Received shutdown signal (ctrl+c)");
            }
            result = mqtt_task => {
                error!(?result, "MQTT task exited unexpectedly");
            }
            result = heartbeat_task => {
                error!(?result, "Heartbeat task exited unexpectedly");
            }
            result = wait_any_task(&mut task_handles) => {
                error!(task = result, "Agent task exited unexpectedly");
            }
        }

        // ── 9. Graceful shutdown ──
        self.agent.on_shutdown(&state).await;
        info!("{} stopped", self.agent.service_name());
        Ok(())
    }
}

/// Wait for the first agent task to complete, return its name.
async fn wait_any_task<'a>(tasks: &'a mut Vec<(&'a str, tokio::task::JoinHandle<()>)>) -> &'a str {
    if tasks.is_empty() {
        std::future::pending::<()>().await;
        unreachable!()
    }

    loop {
        for (name, handle) in tasks.iter_mut() {
            if handle.is_finished() {
                return name;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}
