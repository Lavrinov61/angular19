/// HTTP API — Axum на порту :5054
/// Эндпоинты: send, health, dkim/generate, dkim/dns
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;

use crate::config::Config;
use crate::db;
use crate::dkim;
use crate::smtp_sender::{SendJob, SendQueue};

/// Shared state для Axum
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
    pub send_queue: SendQueue,
    pub dkim_key: Option<rsa::RsaPrivateKey>,
}

/// Создать Axum router
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/mail/send", post(send_email))
        .route("/api/mail/health", get(health))
        .route("/api/mail/dkim/generate", post(dkim_generate))
        .route("/api/mail/dkim/dns", get(dkim_dns))
        .with_state(state)
}

// --- Healthcheck ---

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "mail-api",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

// --- Send Email ---

#[derive(Debug, Deserialize)]
pub struct SendEmailRequest {
    pub to: String,
    pub subject: String,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub reply_to_id: Option<i32>,
    pub from_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SendEmailResponse {
    pub success: bool,
    pub email_id: Option<i32>,
    pub message: String,
}

async fn send_email(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SendEmailRequest>,
) -> Result<Json<SendEmailResponse>, (StatusCode, Json<SendEmailResponse>)> {
    // Валидация
    if req.to.is_empty() || !req.to.contains('@') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(SendEmailResponse {
                success: false,
                email_id: None,
                message: "Invalid 'to' address".to_string(),
            }),
        ));
    }

    if req.subject.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(SendEmailResponse {
                success: false,
                email_id: None,
                message: "Subject is required".to_string(),
            }),
        ));
    }

    let from_name = req.from_name.unwrap_or_else(|| "Своё Фото".to_string());
    let from_address = format!("{from_name} <noreply@{}>", state.config.mail_domain);

    // Определяем reply_to_message_id из БД
    let reply_to_message_id = if let Some(reply_id) = req.reply_to_id {
        match db::get_email_by_id(&state.pool, reply_id).await {
            Ok(Some(email)) => email.message_id,
            _ => None,
        }
    } else {
        None
    };

    // Генерируем message_id для нового письма
    let message_id = format!(
        "<{}.{}@{}>",
        uuid::Uuid::new_v4(),
        chrono::Utc::now().timestamp(),
        state.config.mail_domain
    );

    // Сохраняем в БД как outbound (status=draft, sender обновит на sent)
    let db_result = db::insert_outbound_email(
        &state.pool,
        &from_address,
        &req.to,
        &req.subject,
        req.body_html.as_deref(),
        req.body_text.as_deref(),
        &message_id,
        reply_to_message_id.as_deref(),
    )
    .await;

    let email_id = match db_result {
        Ok(r) => r.id,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(SendEmailResponse {
                    success: false,
                    email_id: None,
                    message: format!("DB error: {e}"),
                }),
            ));
        }
    };

    // Ставим в очередь отправки
    state
        .send_queue
        .enqueue(SendJob {
            db_email_id: Some(email_id),
            to: req.to.clone(),
            from_name,
            subject: req.subject.clone(),
            body_html: req.body_html,
            body_text: req.body_text,
            reply_to_message_id,
        })
        .await;

    info!("Email поставлен в очередь: id={}, to={}", email_id, req.to);

    Ok(Json(SendEmailResponse {
        success: true,
        email_id: Some(email_id),
        message: "Email queued for delivery".to_string(),
    }))
}

// --- DKIM Generate ---

#[derive(Debug, Serialize)]
struct DkimGenerateResponse {
    success: bool,
    message: String,
}

async fn dkim_generate(
    State(state): State<Arc<AppState>>,
) -> Result<Json<DkimGenerateResponse>, (StatusCode, Json<DkimGenerateResponse>)> {
    match dkim::load_or_generate_dkim_key(&state.config.dkim_private_key_path) {
        Ok(_) => Ok(Json(DkimGenerateResponse {
            success: true,
            message: format!(
                "DKIM key ready at {}",
                state.config.dkim_private_key_path
            ),
        })),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(DkimGenerateResponse {
                success: false,
                message: format!("Failed to generate DKIM key: {e}"),
            }),
        )),
    }
}

// --- DKIM DNS ---

#[derive(Debug, Serialize)]
struct DkimDnsResponse {
    success: bool,
    record: Option<dkim::DkimDnsRecord>,
    message: String,
}

async fn dkim_dns(
    State(state): State<Arc<AppState>>,
) -> Result<Json<DkimDnsResponse>, (StatusCode, Json<DkimDnsResponse>)> {
    let key = match &state.dkim_key {
        Some(k) => k,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(DkimDnsResponse {
                    success: false,
                    record: None,
                    message: "DKIM key not loaded".to_string(),
                }),
            ));
        }
    };

    match dkim::get_dkim_dns_record(key, &state.config.dkim_selector, &state.config.mail_domain) {
        Ok(record) => Ok(Json(DkimDnsResponse {
            success: true,
            record: Some(record),
            message: "Add this TXT record to your DNS".to_string(),
        })),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(DkimDnsResponse {
                success: false,
                record: None,
                message: format!("Error: {e}"),
            }),
        )),
    }
}
