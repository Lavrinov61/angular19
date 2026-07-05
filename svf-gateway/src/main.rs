mod auth;
mod bridge;
mod config;
pub mod proto;
mod request_context;
mod services;

use crate::bridge::ExpressBridge;
use crate::config::Config;
use crate::proto::svf::auth::v1::auth_service_server::AuthServiceServer;
use crate::proto::svf::chat::v1::chat_service_server::ChatServiceServer;
use crate::proto::svf::media::v1::media_service_server::MediaServiceServer;
use crate::proto::svf::orders::v1::order_service_server::OrderServiceServer;
use crate::proto::svf::platform::v1::config_service_server::ConfigServiceServer;
use std::net::SocketAddr;
use std::time::Duration;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(true)
        .init();

    let cfg = Config::from_env();
    let addr: SocketAddr = format!("127.0.0.1:{}", cfg.port).parse()?;

    info!(%addr, "Starting svf-gateway");

    // Redis
    let redis_client = redis::Client::open(cfg.redis_url.as_str())?;
    let redis_conn = redis_client.get_multiplexed_tokio_connection().await?;
    info!("Redis connected");

    // HTTP client for Express bridge
    let http_client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(32)
        .build()?;
    let bridge = ExpressBridge::new(http_client.clone(), cfg.express_url.clone());
    let phone_auth_bridge = ExpressBridge::new(http_client, cfg.phone_auth_url.clone())
        .with_internal_auth_secret(cfg.mobile_grpc_internal_secret.clone());

    // S3 client
    let s3_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .endpoint_url(&cfg.s3_endpoint)
        .region(aws_config::Region::new(cfg.s3_region.clone()))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            &cfg.s3_access_key_id,
            &cfg.s3_secret_access_key,
            None,
            None,
            "env",
        ))
        .load()
        .await;
    let s3_client = aws_sdk_s3::Client::new(&s3_config);
    info!("S3 client initialized");

    // Auth interceptor
    let auth_interceptor = auth::AuthInterceptor::new(
        cfg.jwt_secret.clone(),
        cfg.jwt_secret_previous.clone(),
        redis_conn.clone(),
    );

    // Service implementations
    let config_svc = services::app_config::AppConfigServiceImpl::new(bridge.clone());
    let auth_svc =
        services::auth::AuthServiceImpl::new(bridge.clone(), phone_auth_bridge, redis_conn.clone());
    let chat_svc = services::chat::ChatServiceImpl::new(bridge.clone());
    let orders_svc = services::orders::OrdersServiceImpl::new(bridge.clone());
    let media_svc = services::media::MediaServiceImpl::new(
        bridge.clone(),
        s3_client,
        cfg.s3_bucket.clone(),
        cfg.s3_public_url.clone(),
    );

    // Health
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<ConfigServiceServer<services::app_config::AppConfigServiceImpl>>()
        .await;
    health_reporter
        .set_serving::<AuthServiceServer<services::auth::AuthServiceImpl>>()
        .await;
    health_reporter
        .set_serving::<ChatServiceServer<services::chat::ChatServiceImpl>>()
        .await;
    health_reporter
        .set_serving::<OrderServiceServer<services::orders::OrdersServiceImpl>>()
        .await;
    health_reporter
        .set_serving::<MediaServiceServer<services::media::MediaServiceImpl>>()
        .await;
    info!("Health service ready");

    // Reflection
    let reflection_service = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(proto::FILE_DESCRIPTOR_SET)
        .build_v1()?;

    let max_decoding_message_size = cfg.grpc_max_decoding_message_size_bytes;
    let max_encoding_message_size = cfg.grpc_max_encoding_message_size_bytes;
    info!(
        request_timeout_secs = cfg.grpc_request_timeout_secs,
        max_decoding_message_size,
        max_encoding_message_size,
        max_concurrent_streams = cfg.grpc_max_concurrent_streams,
        concurrency_limit_per_connection = cfg.grpc_concurrency_limit_per_connection,
        "gRPC limits configured"
    );

    // gRPC server
    let server = tonic::transport::Server::builder()
        .timeout(Duration::from_secs(cfg.grpc_request_timeout_secs))
        .max_concurrent_streams(Some(cfg.grpc_max_concurrent_streams))
        .concurrency_limit_per_connection(cfg.grpc_concurrency_limit_per_connection)
        .http2_keepalive_interval(Some(Duration::from_secs(30)))
        .http2_keepalive_timeout(Some(Duration::from_secs(10)))
        .tcp_keepalive(Some(Duration::from_secs(60)))
        .layer(auth::AuthLayer::new(auth_interceptor))
        .add_service(health_service)
        .add_service(reflection_service)
        .add_service(tonic_web::enable(
            ConfigServiceServer::new(config_svc)
                .max_decoding_message_size(max_decoding_message_size)
                .max_encoding_message_size(max_encoding_message_size),
        ))
        .add_service(tonic_web::enable(
            AuthServiceServer::new(auth_svc)
                .max_decoding_message_size(max_decoding_message_size)
                .max_encoding_message_size(max_encoding_message_size),
        ))
        .add_service(tonic_web::enable(
            ChatServiceServer::new(chat_svc)
                .max_decoding_message_size(max_decoding_message_size)
                .max_encoding_message_size(max_encoding_message_size),
        ))
        .add_service(tonic_web::enable(
            OrderServiceServer::new(orders_svc)
                .max_decoding_message_size(max_decoding_message_size)
                .max_encoding_message_size(max_encoding_message_size),
        ))
        .add_service(tonic_web::enable(
            MediaServiceServer::new(media_svc)
                .max_decoding_message_size(max_decoding_message_size)
                .max_encoding_message_size(max_encoding_message_size),
        ));

    info!(addr = %addr, "svf-gateway listening");

    server.serve_with_shutdown(addr, shutdown_signal()).await?;

    info!("svf-gateway shut down gracefully");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("failed to register SIGTERM handler");

    tokio::select! {
        _ = ctrl_c => info!("Received CTRL+C"),
        _ = sigterm.recv() => info!("Received SIGTERM"),
    }
}
