//! MQTT connection with auto-reconnect, subscribe/publish helpers.

use rumqttc::{AsyncClient, EventLoop, MqttOptions, QoS, Event, Packet, Transport, TlsConfiguration};
use rustls::ClientConfig;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::config::MqttConfig;

/// Shared MQTT state for all agent tasks.
#[derive(Clone)]
pub struct MqttHandle {
    pub client: Arc<RwLock<Option<AsyncClient>>>,
    pub connected: Arc<RwLock<bool>>,
}

impl MqttHandle {
    pub async fn publish(&self, topic: &str, qos: QoS, retain: bool, payload: Vec<u8>) -> anyhow::Result<()> {
        let guard = self.client.read().await;
        let client = guard.as_ref().ok_or_else(|| anyhow::anyhow!("MQTT not connected"))?;
        client.publish(topic, qos, retain, payload).await?;
        Ok(())
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }
}

/// Build a TLS config using bundled Mozilla CA roots (webpki-roots).
/// This avoids loading the OS certificate store, which panics on
/// cross-compiled Windows binaries (rustls-native-certs → schannel).
fn bundled_tls_config() -> TlsConfiguration {
    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    TlsConfiguration::Rustls(Arc::new(tls_config))
}

/// Create MQTT client and event loop.
pub fn create_client(config: &MqttConfig, client_id: &str) -> (AsyncClient, EventLoop) {
    // For WebSocket, rumqttc expects a full URL: wss://host:port/path
    // Config host may be "svoefoto.ru/mqtt" — split into host and path.
    let broker_addr = if config.use_websocket {
        let scheme = if config.use_tls { "wss" } else { "ws" };
        let (host, path) = match config.host.find('/') {
            Some(i) => (&config.host[..i], &config.host[i..]),
            None => (config.host.as_str(), "/mqtt"),
        };
        format!("{scheme}://{host}:{}{path}", config.port)
    } else {
        config.host.clone()
    };

    let mut opts = MqttOptions::new(client_id, &broker_addr, config.port);
    opts.set_credentials(&config.username, &config.password);
    opts.set_keep_alive(Duration::from_secs(30));
    opts.set_clean_session(false);
    opts.set_inflight(50);

    if config.use_websocket && config.use_tls {
        opts.set_transport(Transport::wss_with_config(bundled_tls_config()));
    } else if config.use_websocket {
        opts.set_transport(Transport::ws());
    } else if config.use_tls {
        opts.set_transport(Transport::tls_with_config(bundled_tls_config()));
    }

    AsyncClient::new(opts, 100)
}

/// Subscribe to topics with reconnect handling.
pub async fn subscribe_topics(
    client: &AsyncClient,
    topics: &[(&str, QoS)],
) -> Result<(), rumqttc::ClientError> {
    for (topic, qos) in topics {
        client.subscribe(*topic, *qos).await?;
        tracing::debug!("Subscribed to: {topic}");
    }
    Ok(())
}

/// Run the MQTT event loop with reconnect and message dispatch.
///
/// `on_message` is called for each received Publish packet.
/// `on_connect` is called when connection is established (for re-subscribing).
pub async fn run_event_loop<F, C>(
    mut eventloop: EventLoop,
    handle: MqttHandle,
    on_message: F,
    on_connect: C,
) where
    F: Fn(String, Vec<u8>) + Send + Sync + 'static,
    C: Fn() + Send + Sync + 'static,
{
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(60);

    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                tracing::info!("MQTT connected");
                *handle.connected.write().await = true;
                backoff = Duration::from_secs(1); // reset on successful connect
                on_connect();
            }
            Ok(Event::Incoming(Packet::Publish(msg))) => {
                on_message(msg.topic.clone(), msg.payload.to_vec());
            }
            Ok(Event::Incoming(Packet::Disconnect)) => {
                tracing::warn!("MQTT broker sent Disconnect");
                *handle.connected.write().await = false;
            }
            Ok(_) => {}
            Err(e) => {
                *handle.connected.write().await = false;
                // Add jitter (0-1000ms) to avoid thundering herd on reconnect
                let jitter_ms = (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_millis() % 1000) as u64;
                let delay = backoff + Duration::from_millis(jitter_ms);
                tracing::warn!("MQTT error: {e}, reconnecting in {}ms", delay.as_millis());
                tokio::time::sleep(delay).await;
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}

/// Build MQTT topic prefix for this agent.
pub fn topic_prefix(studio_id: &str, agent_type: &str) -> String {
    format!("svoefoto/{studio_id}/{agent_type}")
}
