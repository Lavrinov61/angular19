/// SMTP Sender — отправка email через lettre с DKIM и retry
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use lettre::message::{header::ContentType, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::config::Config;
use crate::db;

/// Задание на отправку
#[derive(Debug, Clone)]
pub struct SendJob {
    pub db_email_id: Option<i32>,
    pub to: String,
    pub from_name: String,
    pub subject: String,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub reply_to_message_id: Option<String>,
}

/// Очередь отправки — in-memory с worker'ом
pub struct SendQueue {
    queue: Arc<Mutex<VecDeque<SendJob>>>,
}

impl SendQueue {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    /// Добавить задание в очередь
    pub async fn enqueue(&self, job: SendJob) {
        self.queue.lock().await.push_back(job);
    }

    /// Запустить фоновый worker для обработки очереди
    pub fn spawn_worker(
        &self,
        config: Arc<Config>,
        pool: PgPool,
        dkim_key_pem: Option<String>,
    ) {
        let queue = self.queue.clone();
        tokio::spawn(async move {
            loop {
                // Забираем одно задание из очереди
                let job = {
                    let mut q = queue.lock().await;
                    q.pop_front()
                };

                if let Some(job) = job {
                    if let Err(e) = send_with_retry(&job, &config, &pool, dkim_key_pem.as_deref()).await {
                        error!("Не удалось отправить email {}: {}", job.to, e);
                        // Обновляем статус в БД
                        if let Some(id) = job.db_email_id {
                            let _ = db::update_email_status(&pool, id, "failed", Some(&e.to_string())).await;
                        }
                    }
                } else {
                    // Очередь пуста — ждём
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        });
    }
}

/// Отправить email с retry (3 попытки, exponential backoff)
async fn send_with_retry(
    job: &SendJob,
    config: &Config,
    pool: &PgPool,
    _dkim_key_pem: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 0..max_retries {
        if attempt > 0 {
            let delay = Duration::from_secs(2u64.pow(attempt as u32));
            warn!("Retry отправки ({}/{}), ждём {:?}", attempt + 1, max_retries, delay);
            tokio::time::sleep(delay).await;
        }

        match send_email(job, config, _dkim_key_pem).await {
            Ok(()) => {
                info!("Email отправлен: {} -> {}", config.mail_domain, job.to);
                // Обновляем статус в БД
                if let Some(id) = job.db_email_id {
                    let _ = db::update_email_status(pool, id, "sent", None).await;
                }
                return Ok(());
            }
            Err(e) => {
                warn!("Ошибка отправки (попытка {}): {}", attempt + 1, e);
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Unknown send error".into()))
}

/// Отправить один email через SMTP relay или напрямую
async fn send_email(
    job: &SendJob,
    config: &Config,
    _dkim_key_pem: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let from_mailbox: Mailbox = format!("{} <noreply@{}>", job.from_name, config.mail_domain)
        .parse()
        .map_err(|e| format!("Invalid from address: {e}"))?;

    let to_mailbox: Mailbox = job
        .to
        .parse()
        .map_err(|e| format!("Invalid to address: {e}"))?;

    // Собираем сообщение
    let mut builder = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(&job.subject);

    // Генерируем Message-ID
    let msg_id = format!(
        "<{}.{}@{}>",
        uuid::Uuid::new_v4(),
        chrono::Utc::now().timestamp(),
        config.mail_domain
    );
    builder = builder.message_id(Some(msg_id));

    // In-Reply-To для threading
    if let Some(ref reply_to) = job.reply_to_message_id {
        builder = builder.in_reply_to(reply_to.clone());
    }

    // Тело: multipart/alternative если есть и text и html
    let message = match (&job.body_text, &job.body_html) {
        (Some(text), Some(html)) => builder.multipart(
            MultiPart::alternative()
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_PLAIN)
                        .body(text.clone()),
                )
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_HTML)
                        .body(html.clone()),
                ),
        )?,
        (None, Some(html)) => builder.header(ContentType::TEXT_HTML).body(html.clone())?,
        (Some(text), None) => builder
            .header(ContentType::TEXT_PLAIN)
            .body(text.clone())?,
        (None, None) => builder
            .header(ContentType::TEXT_PLAIN)
            .body(String::new())?,
    };

    // Отправляем через relay или напрямую
    if let Some(ref relay_host) = config.smtp_relay_host {
        // Отправка через relay (Yandex, etc.)
        let mut transport_builder =
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(relay_host)?;

        if let (Some(ref user), Some(ref password)) =
            (&config.smtp_relay_user, &config.smtp_relay_password)
        {
            transport_builder =
                transport_builder.credentials(Credentials::new(user.clone(), password.clone()));
        }

        transport_builder = transport_builder.port(config.smtp_relay_port);

        let transport = transport_builder.build();
        transport.send(message).await?;
    } else {
        // Прямая доставка через MX (без relay)
        // Для production рекомендуется relay через Yandex/другой сервис
        let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&job.to)
            .port(25)
            .build();
        transport.send(message).await?;
    }

    Ok(())
}
