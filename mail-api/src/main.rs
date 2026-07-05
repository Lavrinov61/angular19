/// mail-api — SMTP receiver/sender + HTTP API для Своё Фото
/// Порт 5056 (HTTP API), порт MAIL_SMTP_PORT/25 (SMTP receiver)
mod attachment_store;
mod config;
mod db;
mod dkim;
mod http_api;
mod mime_parser;
mod smtp_sender;
mod smtp_server;

use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tokio::signal;
use tokio_rustls::TlsAcceptor;
use tracing::{error, info, warn};

use config::Config;
use http_api::AppState;
use smtp_sender::SendQueue;

#[tokio::main]
async fn main() {
    // Устанавливаем CryptoProvider для rustls
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Загружаем .env из директории backend (общие credentials)
    let _ = dotenvy::from_path("/var/www/apimain/angular-dev/backend/.env");
    let _ = dotenvy::dotenv(); // локальный .env если есть

    // Инициализация tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("mail-api v{} запускается", env!("CARGO_PKG_VERSION"));

    // Загружаем конфигурацию
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            error!("Ошибка конфигурации: {}", e);
            std::process::exit(1);
        }
    };

    info!("Домен(ы) приёма: {:?}, SMTP порт: {}, HTTP порт: {}",
        config.mail_domains, config.smtp_listen_port, config.mail_api_port);

    // Подключение к PostgreSQL
    let pool = match PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
    {
        Ok(pool) => {
            info!("PostgreSQL подключён");
            pool
        }
        Err(e) => {
            error!("Не удалось подключиться к PostgreSQL: {}", e);
            std::process::exit(1);
        }
    };

    // Загружаем DKIM ключ (опционально)
    let dkim_key = match dkim::load_or_generate_dkim_key(&config.dkim_private_key_path) {
        Ok(key) => {
            info!("DKIM ключ загружен");
            Some(key)
        }
        Err(e) => {
            warn!("DKIM ключ недоступен: {} — отправка без DKIM", e);
            None
        }
    };

    // Загружаем TLS для SMTP (Let's Encrypt)
    let tls_acceptor = match load_tls_config(&config) {
        Ok(acceptor) => {
            info!("TLS для SMTP загружен");
            Some(acceptor)
        }
        Err(e) => {
            warn!("TLS недоступен: {} — SMTP работает без STARTTLS", e);
            None
        }
    };

    // Очередь отправки
    let send_queue = SendQueue::new();
    let config = Arc::new(config);

    // Запускаем worker отправки
    send_queue.spawn_worker(config.clone(), pool.clone(), None);

    // Shared state
    let state = Arc::new(AppState {
        config: (*config).clone(),
        pool: pool.clone(),
        send_queue,
        dkim_key,
    });

    // Запускаем SMTP сервер
    let smtp_config = config.clone();
    let smtp_pool = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = smtp_server::run_smtp_server(smtp_config, smtp_pool, tls_acceptor).await {
            error!("SMTP сервер упал: {}", e);
        }
    });

    // Запускаем HTTP API
    let app = http_api::create_router(state);
    let http_addr = format!("0.0.0.0:{}", config.mail_api_port);
    info!("HTTP API слушает на {}", http_addr);

    let listener = TcpListener::bind(&http_addr).await.expect("Не удалось bind HTTP");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("HTTP сервер упал");

    info!("mail-api завершён");
}

/// Загрузить TLS конфигурацию из Let's Encrypt сертификатов
fn load_tls_config(config: &Config) -> Result<TlsAcceptor, Box<dyn std::error::Error>> {
    let cert_pem = std::fs::read(&config.tls_cert_path)?;
    let key_pem = std::fs::read(&config.tls_key_path)?;

    let certs = rustls_pemfile::certs(&mut &cert_pem[..])
        .collect::<Result<Vec<_>, _>>()?;
    let key = rustls_pemfile::private_key(&mut &key_pem[..])?
        .ok_or("No private key found in PEM file")?;

    let tls_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;

    Ok(TlsAcceptor::from(Arc::new(tls_config)))
}

/// Graceful shutdown: ждём SIGTERM или SIGINT
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Не удалось установить Ctrl+C handler");
    };

    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Не удалось установить SIGTERM handler")
            .recv()
            .await;
    };

    tokio::select! {
        _ = ctrl_c => info!("Получен SIGINT, завершаемся..."),
        _ = terminate => info!("Получен SIGTERM, завершаемся..."),
    }
}
