pub mod publisher;
pub mod subscriber;

use rumqttc::{AsyncClient, MqttOptions, QoS};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;

use crate::config::{Config, MqttConfig, TelegramConfig};
use crate::scheduler;

/// Shared state for MQTT bridge background tasks.
pub struct BridgeShared {
    pub client: AsyncClient,
    pub db: PgPool,
    pub redis: redis::aio::MultiplexedConnection,
    pub config: Config,
    pub telegram: Option<TelegramConfig>,
    pub http_client: reqwest::Client,
}

/// Initialize MQTT bridge and spawn background tasks.
/// Returns the MQTT client for use in health checks.
pub async fn start_bridge(
    mqtt_config: &MqttConfig,
    redis_url: &str,
    db: PgPool,
    database_url: &str,
    config: Config,
    telegram: Option<TelegramConfig>,
) -> Option<AsyncClient> {
    // MQTT connection
    let mut options = MqttOptions::new(&mqtt_config.client_id, &mqtt_config.host, mqtt_config.port);
    options.set_credentials(&mqtt_config.username, &mqtt_config.password);
    options.set_keep_alive(Duration::from_secs(30));
    options.set_clean_session(true);
    options.set_inflight(100);

    let (client, event_loop) = AsyncClient::new(options, 256);

    // Redis connections (one for bridge, one for scheduler)
    let redis_conn = match create_redis_connection(redis_url).await {
        Some(conn) => conn,
        None => return Some(client),
    };
    let redis_conn_for_scheduler = match create_redis_connection(redis_url).await {
        Some(conn) => conn,
        None => redis_conn.clone(),
    };

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("Failed to create HTTP client");

    let shared = Arc::new(BridgeShared {
        client: client.clone(),
        db: db.clone(),
        redis: redis_conn,
        config,
        telegram: telegram.clone(),
        http_client,
    });

    // Task 1: MQTT event loop — processes incoming messages, re-subscribes on connect
    let shared_events = Arc::clone(&shared);
    tokio::spawn(async move {
        subscriber::run_event_loop(shared_events, event_loop).await;
    });

    // Task 2: PG LISTEN → claim job → Protobuf → MQTT publish
    let shared_pg = Arc::clone(&shared);
    let db_url = database_url.to_owned();
    tokio::spawn(async move {
        publisher::run_pg_listener(shared_pg, &db_url).await;
    });

    // Task 3: Telemetry retention cleanup (every 6 hours)
    let db_cleanup = db.clone();
    tokio::spawn(async move {
        run_telemetry_cleanup(db_cleanup).await;
    });

    // Task 4: Heartbeat monitor + alert engine (every 30s)
    let scheduler_shared = Arc::new(scheduler::SchedulerShared {
        db,
        redis: redis_conn_for_scheduler,
        telegram: telegram.clone(),
        http_client: reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create scheduler HTTP client"),
    });
    scheduler::spawn_schedulers(scheduler_shared);

    tracing::info!("MQTT bridge started (4 background tasks)");
    Some(client)
}

async fn create_redis_connection(url: &str) -> Option<redis::aio::MultiplexedConnection> {
    let client = match redis::Client::open(url) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Invalid Redis URL: {e}");
            return None;
        }
    };

    match client.get_multiplexed_tokio_connection().await {
        Ok(conn) => {
            tracing::info!("Connected to Redis");
            Some(conn)
        }
        Err(e) => {
            tracing::error!("Failed to connect to Redis: {e}");
            None
        }
    }
}

/// Subscribe to all MQTT topics for print bridge.
pub async fn subscribe_topics(client: &AsyncClient) {
    let topics = [
        // Legacy (print agent — flat topics)
        "svoefoto/+/jobs/+/progress",
        "svoefoto/+/telemetry",
        "svoefoto/+/heartbeat",
        "svoefoto/+/status",
        "svoefoto/+/preview/+/result",
        // Infra v2 (multi-agent — agent_type in path)
        "svoefoto/+/+/heartbeat", // svoefoto/{studio_id}/{agent_type}/heartbeat
        "svoefoto/+/+/telemetry", // svoefoto/{studio_id}/{agent_type}/telemetry
        "svoefoto/+/+/alerts",    // svoefoto/{studio_id}/{agent_type}/alerts
        "svoefoto/+/+/commands/config_ack", // svoefoto/{studio_id}/{agent_type}/commands/config_ack
        "svoefoto/+/+/commands/update_status", // update progress from agents
        // Print-specific (new prefix with agent_type)
        "svoefoto/+/print/jobs/+/progress",
        // POS-specific (Phase 5)
        "svoefoto/+/pos/transactions/+/result",
        "svoefoto/+/pos/shift/result",
        "svoefoto/+/pos/sbp/qr_result",
        // POS telemetry is received through the infra wildcard
        // svoefoto/{studio_id}/{agent_type}/telemetry.
        // Monitor-specific
        "svoefoto/+/monitor/system",
        "svoefoto/+/monitor/watchdog",
        // Guard-specific (CDR scan results, security threats)
        "svoefoto/+/guard/events/scan",
        "svoefoto/+/guard/events/threat",
    ];

    for topic in &topics {
        if let Err(e) = client.subscribe(*topic, QoS::AtLeastOnce).await {
            tracing::error!("Failed to subscribe to {topic}: {e}");
        }
    }

    tracing::info!("MQTT subscribe requests queued for {} topics", topics.len());
}

async fn run_telemetry_cleanup(db: PgPool) {
    let retention_days: i64 = 90;
    let interval = Duration::from_secs(6 * 3600);

    // Initial delay — don't run immediately on startup
    tokio::time::sleep(Duration::from_secs(60)).await;

    loop {
        match sqlx::query_scalar::<_, i64>(
            "WITH deleted AS (
                DELETE FROM printer_telemetry
                WHERE collected_at < NOW() - ($1 || ' days')::interval
                RETURNING 1
            ) SELECT COUNT(*) FROM deleted",
        )
        .bind(retention_days.to_string())
        .fetch_one(&db)
        .await
        {
            Ok(count) if count > 0 => {
                tracing::info!(
                    "Telemetry cleanup: deleted {count} rows older than {retention_days} days"
                );
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!("Telemetry cleanup error: {e}");
            }
        }

        tokio::time::sleep(interval).await;
    }
}
