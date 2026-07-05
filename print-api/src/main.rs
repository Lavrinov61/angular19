mod config;
pub mod conversion;
mod cups;
mod db;
mod error;
mod handlers;
mod middleware;
mod models;
mod mqtt;
mod s3_client;
mod scheduler;
mod source_file;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/svf.print.rs"));
}

pub mod infra_proto {
    include!(concat!(env!("OUT_DIR"), "/svf.infra.rs"));
}

use axum::{
    Router,
    extract::DefaultBodyLimit,
    middleware::from_fn_with_state,
    routing::{get, patch, post, put},
};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    pub mqtt_connected: Arc<RwLock<bool>>,
    pub mqtt_client: Arc<RwLock<Option<rumqttc::AsyncClient>>>,
}

const PRINT_UPLOAD_BODY_LIMIT_BYTES: usize = 210 * 1024 * 1024;

#[tokio::main]
async fn main() {
    let config = Config::from_env();

    tracing_subscriber::fmt()
        .with_env_filter(&config.log_level)
        .with_target(false)
        .init();

    let pool = db::create_pool(&config.database_url).await;
    tracing::info!("Connected to PostgreSQL");

    // Start MQTT bridge (if configured)
    let mqtt_connected = Arc::new(RwLock::new(false));
    let mqtt_client: Arc<RwLock<Option<rumqttc::AsyncClient>>> = Arc::new(RwLock::new(None));
    if let (Some(mqtt_config), Some(redis_url)) = (&config.mqtt, &config.redis_url) {
        let client = mqtt::start_bridge(
            mqtt_config,
            redis_url,
            pool.clone(),
            &config.database_url,
            config.clone(),
            config.telegram.clone(),
        )
        .await;

        if let Some(ref c) = client {
            *mqtt_connected.write().await = true;
            *mqtt_client.write().await = Some(c.clone());
        }
    } else {
        tracing::warn!(
            "MQTT/Redis not configured — running HTTP-only mode (set MQTT_PASSWORD + REDIS_HOST)"
        );
    }

    // Start document conversion worker (if S3 keys are configured)
    if let Some(ref conv_config) = config.conversion {
        let worker = Arc::new(conversion::ConversionWorker::new(
            pool.clone(),
            &config.database_url,
            config.redis_url.clone(),
            conv_config,
        ));
        conversion::ConversionWorker::spawn(worker);
        tracing::info!(
            "Document conversion worker started (max_concurrent={})",
            conv_config.max_concurrent
        );
    } else {
        tracing::info!("Document conversion disabled (S3_ACCESS_KEY not set)");
    }

    let state = AppState {
        db: pool,
        config: config.clone(),
        mqtt_connected,
        mqtt_client,
    };

    let cors = {
        use axum::http::{HeaderName, HeaderValue, Method, header};
        use tower_http::cors::AllowOrigin;

        let origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
            .map(|val| {
                val.split(',')
                    .filter_map(|s| s.trim().parse().ok())
                    .collect()
            })
            .unwrap_or_else(|_| {
                [
                    "https://svoefoto.ru",
                    "https://www.svoefoto.ru",
                    "https://crm.svoefoto.ru",
                    "http://localhost:4200",
                    "http://localhost:3001",
                ]
                .iter()
                .filter_map(|s| s.parse().ok())
                .collect()
            });

        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([
                header::CONTENT_TYPE,
                header::AUTHORIZATION,
                HeaderName::from_static("x-session-token"),
            ])
    };

    // ── Public (no auth) ──
    let public = Router::new().route("/api/print/health", get(handlers::health::health));

    // ── Authenticated routes (auth + pos:use) ──
    // Permission checks are done per-handler where catalog:manage is needed
    let api = Router::new()
        // Printers
        .route(
            "/api/print/printers",
            get(handlers::printers::list).post(handlers::printers::create),
        )
        .route("/api/print/printers/all", get(handlers::printers::list_all))
        .route(
            "/api/print/printers/status",
            get(handlers::printers::status),
        )
        .route(
            "/api/print/printers/{id}",
            put(handlers::printers::update).delete(handlers::printers::delete),
        )
        .route(
            "/api/print/printers/{id}/pause",
            post(handlers::printers::pause_queue),
        )
        .route(
            "/api/print/printers/{id}/resume",
            post(handlers::printers::resume_queue),
        )
        // Jobs
        .route(
            "/api/print/jobs",
            get(handlers::jobs::list).post(handlers::jobs::create),
        )
        .route(
            "/api/print/jobs/layout-batch",
            post(handlers::layout_batch::create),
        )
        .route("/api/print/jobs/{id}", get(handlers::jobs::get_one))
        .route("/api/print/jobs/{id}/cancel", post(handlers::jobs::cancel))
        .route("/api/print/jobs/{id}/retry", post(handlers::jobs::retry))
        .route(
            "/api/print/jobs/{id}/reassign",
            post(handlers::jobs::reassign),
        )
        .route(
            "/api/print/jobs/{id}/pause",
            post(handlers::jobs::pause_job),
        )
        .route(
            "/api/print/jobs/{id}/resume",
            post(handlers::jobs::resume_job),
        )
        .route("/api/print/jobs/{id}/hold", post(handlers::jobs::hold_job))
        .route(
            "/api/print/jobs/{id}/release",
            post(handlers::jobs::release_job),
        )
        .route(
            "/api/print/jobs/{id}/schedule",
            post(handlers::jobs::schedule_job),
        )
        .route(
            "/api/print/jobs/{id}/priority",
            put(handlers::jobs::set_priority),
        )
        // Conversion pages
        .route(
            "/api/print/jobs/{id}/pages",
            get(handlers::conversion::get_pages),
        )
        // Telemetry
        .route("/api/print/telemetry", get(handlers::telemetry::current))
        .route(
            "/api/print/telemetry/{printerId}/history",
            get(handlers::telemetry::history),
        )
        // Bridges
        .route(
            "/api/print/bridges",
            get(handlers::bridges::list).post(handlers::bridges::create),
        )
        .route(
            "/api/print/bridges/{id}",
            put(handlers::bridges::update).delete(handlers::bridges::delete),
        )
        // ICC Profiles
        .route(
            "/api/print/icc-profiles",
            get(handlers::icc_profiles::list).post(handlers::icc_profiles::create),
        )
        .route(
            "/api/print/icc-profiles/{id}",
            get(handlers::icc_profiles::get)
                .put(handlers::icc_profiles::update)
                .delete(handlers::icc_profiles::delete),
        )
        // Service Catalog
        .route(
            "/api/print/service-catalog",
            get(handlers::service_catalog::list).post(handlers::service_catalog::create),
        )
        .route(
            "/api/print/service-catalog/slug/{slug}",
            get(handlers::service_catalog::get_by_slug),
        )
        .route(
            "/api/print/service-catalog/{id}",
            put(handlers::service_catalog::update).delete(handlers::service_catalog::delete),
        )
        // Document Templates
        .route(
            "/api/print/document-templates",
            get(handlers::document_templates::list).post(handlers::document_templates::create),
        )
        .route(
            "/api/print/document-templates/slug/{slug}",
            get(handlers::document_templates::get_by_slug),
        )
        .route(
            "/api/print/document-templates/{id}",
            put(handlers::document_templates::update).delete(handlers::document_templates::delete),
        )
        // Design Templates
        .route(
            "/api/print/design-templates",
            get(handlers::design_templates::list).post(handlers::design_templates::create),
        )
        .route(
            "/api/print/design-templates/{id}",
            put(handlers::design_templates::update).delete(handlers::design_templates::delete),
        )
        // Consumables
        .route(
            "/api/print/consumables/stock",
            get(handlers::consumables::list_stock).post(handlers::consumables::create_stock),
        )
        .route(
            "/api/print/consumables/stock/{id}",
            put(handlers::consumables::update_stock),
        )
        .route(
            "/api/print/consumables/stock/{id}/refill",
            post(handlers::consumables::refill),
        )
        .route(
            "/api/print/consumables/transactions",
            get(handlers::consumables::list_transactions),
        )
        .route(
            "/api/print/consumables/alerts",
            get(handlers::consumables::alerts),
        )
        .route(
            "/api/print/consumables/forecast",
            get(handlers::consumables::forecast),
        )
        // Reprint
        .route(
            "/api/print/jobs/{id}/reprint",
            post(handlers::jobs::reprint),
        )
        // Preview (Phase 4.5)
        .route(
            "/api/print/preview",
            post(handlers::preview::request_preview),
        )
        .route(
            "/api/print/preview/layout-sheet",
            post(handlers::preview::request_layout_sheet_preview),
        )
        .route(
            "/api/print/preview/{id}",
            get(handlers::preview::get_preview),
        )
        // Uploads
        .route(
            "/api/print/uploads",
            post(handlers::uploads::upload)
                .layer(DefaultBodyLimit::max(PRINT_UPLOAD_BODY_LIMIT_BYTES)),
        )
        // Print Presets
        .route(
            "/api/print/presets",
            get(handlers::print_presets::list).post(handlers::print_presets::create),
        )
        .route(
            "/api/print/presets/{id}",
            put(handlers::print_presets::update).delete(handlers::print_presets::delete),
        )
        // Job Templates
        .route(
            "/api/print/job-templates",
            get(handlers::job_templates::list).post(handlers::job_templates::create),
        )
        .route(
            "/api/print/job-templates/{id}",
            put(handlers::job_templates::update).delete(handlers::job_templates::delete),
        )
        .route(
            "/api/print/job-templates/{id}/apply",
            post(handlers::job_templates::apply),
        )
        // Finishing
        .route(
            "/api/print/jobs/{id}/finishing",
            post(handlers::jobs::update_finishing),
        )
        .route(
            "/api/print/jobs/{id}/finishing_ops",
            patch(handlers::jobs::update_finishing_ops),
        )
        // Split
        .route(
            "/api/print/jobs/{id}/split",
            post(handlers::jobs::split_job),
        )
        // Coverage analysis
        .route(
            "/api/print/analyze-coverage",
            post(handlers::coverage::analyze),
        )
        // Page count — fast, universal source of truth for price (decoupled from coverage)
        .route(
            "/api/print/count-pages",
            post(handlers::count::count_pages_handler),
        )
        // Coverage analysis — async job with progress (counting→rendering→analyzing→ready)
        .route(
            "/api/print/analyze-coverage/start",
            post(handlers::coverage_job::start_coverage_job),
        )
        .route(
            "/api/print/analyze-coverage/status/{id}",
            get(handlers::coverage_job::get_coverage_job),
        )
        // Groups
        .route("/api/print/jobs/groups", post(handlers::jobs::create_group))
        .route(
            "/api/print/jobs/groups/{group_id}",
            get(handlers::jobs::get_group_jobs),
        )
        .route(
            "/api/print/jobs/{id}/group",
            put(handlers::jobs::add_to_group).delete(handlers::jobs::remove_from_group),
        )
        .route(
            "/api/print/jobs/{id}/transitions",
            get(handlers::jobs::get_transitions),
        )
        // Billing
        .route(
            "/api/print/billing/by-customer",
            get(handlers::billing::by_customer),
        )
        // Auth layers: pos:use on all, then require_auth
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_pos_use,
        ))
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    // ── Infrastructure Management API (auth required, infra:manage per-handler) ──
    let infra = Router::new()
        // Agents CRUD
        .route(
            "/api/infra/agents",
            get(handlers::infra_agents::list).post(handlers::infra_agents::create),
        )
        .route(
            "/api/infra/agents/{id}",
            get(handlers::infra_agents::get)
                .put(handlers::infra_agents::update)
                .delete(handlers::infra_agents::delete),
        )
        .route(
            "/api/infra/agents/{id}/restart",
            post(handlers::infra_agents::restart),
        )
        .route(
            "/api/infra/agents/{id}/config",
            post(handlers::infra_agents::push_config),
        )
        .route(
            "/api/infra/agents/{id}/update",
            post(handlers::infra_agents::trigger_update),
        )
        // Fleet
        .route(
            "/api/infra/fleet/overview",
            get(handlers::infra_fleet::overview),
        )
        .route(
            "/api/infra/fleet/health",
            get(handlers::infra_fleet::health),
        )
        .route(
            "/api/infra/fleet/versions",
            get(handlers::infra_fleet::versions),
        )
        // Releases & Updates
        .route(
            "/api/infra/releases",
            get(handlers::infra_fleet::list_releases).post(handlers::infra_fleet::create_release),
        )
        .route(
            "/api/infra/updates",
            get(handlers::infra_fleet::list_updates),
        )
        // Rollouts (staged rollout management)
        .route(
            "/api/infra/rollouts",
            get(handlers::infra_updates::list_rollouts),
        )
        .route(
            "/api/infra/rollouts/{id}",
            get(handlers::infra_updates::get_rollout),
        )
        .route(
            "/api/infra/rollouts/{id}/advance",
            post(handlers::infra_updates::advance_rollout),
        )
        .route(
            "/api/infra/rollouts/{id}/pause",
            post(handlers::infra_updates::pause_rollout),
        )
        .route(
            "/api/infra/rollouts/{id}/cancel",
            post(handlers::infra_updates::cancel_rollout),
        )
        .route(
            "/api/infra/releases/{id}/rollout",
            post(handlers::infra_updates::start_rollout),
        )
        .route(
            "/api/infra/releases/{id}/promote",
            post(handlers::infra_updates::promote_release),
        )
        // Fleet-wide update
        .route(
            "/api/infra/fleet/update",
            post(handlers::infra_updates::fleet_update),
        )
        // Rollback
        .route(
            "/api/infra/updates/{id}/rollback",
            post(handlers::infra_updates::rollback_update),
        )
        // Alerts
        .route("/api/infra/alerts", get(handlers::infra_alerts::list))
        .route(
            "/api/infra/alerts/{id}/acknowledge",
            post(handlers::infra_alerts::acknowledge),
        )
        .route(
            "/api/infra/alerts/{id}/resolve",
            post(handlers::infra_alerts::resolve),
        )
        // Alert Rules
        .route(
            "/api/infra/alert-rules",
            get(handlers::infra_alerts::list_rules).post(handlers::infra_alerts::create_rule),
        )
        .route(
            "/api/infra/alert-rules/{id}",
            put(handlers::infra_alerts::update_rule),
        )
        // System Telemetry
        .route(
            "/api/infra/system-telemetry/{agentId}",
            get(handlers::infra_alerts::current_telemetry),
        )
        .route(
            "/api/infra/system-telemetry/{agentId}/history",
            get(handlers::infra_alerts::telemetry_history),
        )
        // Locations
        .route(
            "/api/infra/locations",
            get(handlers::infra_fleet::list_locations),
        )
        .route(
            "/api/infra/locations/{id}",
            get(handlers::infra_fleet::get_location),
        )
        // Guard: Security Events & CDR Stats
        .route(
            "/api/infra/security-events",
            get(handlers::infra_alerts::security_events),
        )
        .route(
            "/api/infra/cdr-stats",
            get(handlers::infra_alerts::cdr_stats),
        )
        // Monitor commands (exec, sysinfo, service, logs, file)
        .route(
            "/api/infra/agents/{id}/monitor/{command}",
            post(handlers::monitor::send_command),
        )
        // Auth layer (same as print API)
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    // ── Print Analytics (auth required, any employee) ──
    let analytics = Router::new()
        .route(
            "/api/print/analytics/summary",
            get(handlers::analytics::summary),
        )
        .route(
            "/api/print/analytics/by-printer",
            get(handlers::analytics::by_printer),
        )
        .route(
            "/api/print/analytics/by-operator",
            get(handlers::analytics::by_operator),
        )
        .route(
            "/api/print/analytics/daily",
            get(handlers::analytics::daily),
        )
        .route(
            "/api/print/analytics/utilization",
            get(handlers::analytics::utilization),
        )
        .route(
            "/api/print/analytics/waste",
            get(handlers::analytics::waste_list),
        )
        .route(
            "/api/print/analytics/export-csv",
            get(handlers::analytics::export_csv),
        )
        .route(
            "/api/print/analytics/cost-forecast",
            get(handlers::analytics::cost_forecast),
        )
        .route("/api/print/waste", post(handlers::analytics::create_waste))
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    let app = Router::new()
        .merge(public)
        .merge(api)
        .merge(analytics)
        .merge(infra)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
    tracing::info!("Print API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await
        .expect("Failed to bind Print API server — check if port is already in use or insufficient permissions");
    axum::serve(listener, app)
        .await
        .expect("Print API server encountered fatal error during execution");
}
