mod config;
mod db;
mod error;
mod handlers;
mod middleware;
mod models;
mod services;

use axum::{
    middleware::from_fn_with_state,
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::PgPool;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use config::Config;
use services::embedding::EmbeddingService;
use services::enrichment_worker::EnrichmentWorker;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
}

#[tokio::main]
async fn main() {
    let config = Config::from_env();

    // Tracing
    tracing_subscriber::fmt()
        .with_env_filter(&config.log_level)
        .with_target(false)
        .init();

    // Database
    let pool = db::create_pool(&config.database_url).await;
    tracing::info!("Connected to PostgreSQL");

    let state = AppState {
        db: pool.clone(),
        config: config.clone(),
    };

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(Any) // Tightened in production via nginx
        .allow_methods(Any)
        .allow_headers(Any);

    // === Route Groups ===

    // Health — no auth (internal network only, blocked by nginx for external)
    let health_routes = Router::new()
        .route("/api/kb/health", get(handlers::health::health));

    // All KB data routes require authentication — this is an internal CRM API
    let read_routes = Router::new()
        // Search
        .route("/api/kb/search", post(handlers::search::search))
        .route("/api/kb/search/suggest", post(handlers::search::suggest))
        .route("/api/kb/search/semantic", post(handlers::search::semantic))
        .route("/api/kb/search/combined", post(handlers::search::combined))
        // Categories
        .route("/api/kb/categories", get(handlers::categories::list))
        .route(
            "/api/kb/categories/{key}",
            get(handlers::categories::get_by_slug),
        )
        // Entities
        .route("/api/kb/entities", get(handlers::entities::list))
        .route(
            "/api/kb/entities/{key}",
            get(handlers::entities::get_by_slug),
        )
        .route(
            "/api/kb/entities/{id}/versions",
            get(handlers::entities::versions),
        )
        .route(
            "/api/kb/entities/{id}/relations",
            get(handlers::relations::get_entity_relations),
        )
        // Graph
        .route("/api/kb/graph", get(handlers::graph::full_graph))
        .route(
            "/api/kb/graph/neighbors/{id}",
            get(handlers::graph::neighbors),
        )
        .route(
            "/api/kb/price-comparison",
            get(handlers::graph::price_comparison),
        )
        // Dashboard & metrics
        .route("/api/kb/dashboard", get(handlers::dashboard::dashboard))
        .route(
            "/api/kb/metrics/definitions",
            get(handlers::metrics::list_definitions),
        )
        .route(
            "/api/kb/metrics/series/{slug}",
            get(handlers::metrics::series),
        )
        // Sources
        .route("/api/kb/sources", get(handlers::sources::list))
        .route("/api/kb/sources/{key}", get(handlers::sources::get))
        .route(
            "/api/kb/sources/{key}/links",
            get(handlers::sources::links),
        )
        // Competitor prices
        .route("/api/kb/competitor-prices", get(handlers::competitor_prices::list_all))
        .route("/api/kb/competitor-prices/summary", get(handlers::competitor_prices::summary))
        .route("/api/kb/competitor-prices/positioning", get(handlers::competitor_prices::positioning))
        .route("/api/kb/competitor-prices/compare/{category}", get(handlers::competitor_prices::compare_by_category))
        .route("/api/kb/competitor-prices/history/{slug}", get(handlers::competitor_prices::history))
        .route("/api/kb/competitor-prices/trends/{category}", get(handlers::competitor_prices::trends))
        .route("/api/kb/competitor-prices/{slug}", get(handlers::competitor_prices::list_by_competitor))
        // Price alerts
        .route("/api/kb/price-alerts", get(handlers::competitor_prices::list_alerts))
        .route("/api/kb/price-alerts/unread-count", get(handlers::competitor_prices::unread_alert_count))
        // Scrape logs
        .route("/api/kb/scrape-logs", get(handlers::competitor_prices::scrape_logs))
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    // Write routes (require auth + RBAC)
    let write_routes = Router::new()
        // Categories
        .route(
            "/api/kb/categories",
            post(handlers::categories::create),
        )
        .route(
            "/api/kb/categories/{key}",
            patch(handlers::categories::update),
        )
        // Entities CRUD
        .route("/api/kb/entities", post(handlers::entities::create))
        .route(
            "/api/kb/entities/{key}",
            patch(handlers::entities::update).delete(handlers::entities::delete),
        )
        .route(
            "/api/kb/entities/{id}/verify",
            post(handlers::entities::verify),
        )
        // Relations
        .route("/api/kb/relations", post(handlers::relations::create))
        .route(
            "/api/kb/relations/{id}",
            delete(handlers::relations::delete),
        )
        // Metrics
        .route("/api/kb/metrics", post(handlers::metrics::record))
        // Sources
        .route("/api/kb/sources", post(handlers::sources::create))
        .route(
            "/api/kb/sources/{key}",
            patch(handlers::sources::update).delete(handlers::sources::deactivate),
        )
        .route(
            "/api/kb/sources/{key}/sync",
            post(handlers::sources::trigger_sync),
        )
        // Bulk operations
        .route(
            "/api/kb/bulk/entities",
            post(handlers::bulk::bulk_create_entities)
                .patch(handlers::bulk::bulk_update_entities),
        )
        .route(
            "/api/kb/bulk/relations",
            post(handlers::bulk::bulk_create_relations),
        )
        // Enrichment
        .route(
            "/api/kb/enrichment",
            get(handlers::enrichment::list).post(handlers::enrichment::create),
        )
        .route("/api/kb/enrichment/queue", get(handlers::enrichment::queue))
        .route("/api/kb/enrichment/stats", get(handlers::enrichment::stats))
        .route(
            "/api/kb/enrichment/batch",
            post(handlers::enrichment::batch_enqueue),
        )
        .route(
            "/api/kb/enrichment/{id}",
            get(handlers::enrichment::get)
                .patch(handlers::enrichment::update)
                .delete(handlers::enrichment::cancel),
        )
        .route(
            "/api/kb/enrichment/{id}/retry",
            post(handlers::enrichment::retry),
        )
        // Competitor prices (write)
        .route("/api/kb/competitor-prices/scrape/{source_slug}", post(handlers::competitor_prices::trigger_scrape))
        .route("/api/kb/competitor-prices/scrape-all", post(handlers::competitor_prices::trigger_scrape_all))
        .route("/api/kb/competitor-prices/import-markdown", post(handlers::competitor_prices::import_markdown))
        .route("/api/kb/competitor-prices/{id}/verify", patch(handlers::competitor_prices::verify_price))
        // Price alerts (write)
        .route("/api/kb/price-alerts/{id}/read", patch(handlers::competitor_prices::mark_alert_read))
        .route("/api/kb/price-alerts/read-all", post(handlers::competitor_prices::mark_all_alerts_read))
        // Export
        .route(
            "/api/kb/export/entities",
            get(handlers::export::export_entities),
        )
        .route(
            "/api/kb/export/relations",
            get(handlers::export::export_relations),
        )
        // Require auth for write operations
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    // Admin routes (require admin role)
    let admin_routes = Router::new()
        .route(
            "/api/kb/access",
            get(handlers::access::list).post(handlers::access::create),
        )
        .route(
            "/api/kb/access/role/{role}",
            get(handlers::access::by_role),
        )
        .route(
            "/api/kb/access/check",
            get(handlers::access::check_permissions),
        )
        .route(
            "/api/kb/access/{id}",
            patch(handlers::access::update).delete(handlers::access::delete),
        )
        .route(
            "/api/kb/config",
            get(handlers::config::list),
        )
        .route(
            "/api/kb/config/{key}",
            get(handlers::config::get)
                .put(handlers::config::set)
                .delete(handlers::config::delete),
        )
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::require_auth,
        ));

    // Compose all route groups
    let app = Router::new()
        .merge(health_routes)
        .merge(read_routes)
        .merge(write_routes)
        .merge(admin_routes)
        // Global middleware (applied to all routes)
        .layer(from_fn_with_state(
            state.clone(),
            middleware::rbac::resolve_permissions,
        ))
        .layer(from_fn_with_state(
            state.clone(),
            middleware::auth::optional_auth,
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    // === Background Workers ===

    // Start enrichment worker
    let worker_pool = state.db.clone();
    let worker_db_url = config.database_url.clone();
    tokio::spawn(async move {
        let mut worker = EnrichmentWorker::new(worker_pool.clone(), worker_db_url);

        // Configure embedding service if API key is available
        if let Ok(api_key) = std::env::var("VOYAGE_API_KEY") {
            let embedding = EmbeddingService::new(api_key);
            worker = worker.with_embedding(embedding);
            tracing::info!("Embedding service configured (Voyage AI voyage-3)");
        } else {
            tracing::warn!("VOYAGE_API_KEY not set — embedding tasks will fail");
        }

        worker.run().await;
    });

    // Rate limit cache cleanup (every 10 minutes)
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(600));
        loop {
            interval.tick().await;
            // Rate limiting cleanup would go here
            tracing::debug!("Rate limit cache maintenance tick");
        }
    });

    // === Start Server ===

    // Bind to localhost only — accessible via nginx reverse proxy, not directly from internet
    let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
    tracing::info!("KB API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
