/// Работа с PostgreSQL — сохранение и получение email
use chrono::{DateTime, Utc};
use sqlx::PgPool;

/// Структура для вставки нового email
#[allow(dead_code)]
pub struct InsertEmail {
    pub direction: String,
    pub from_address: String,
    pub to_address: String,
    pub cc_addresses: Vec<String>,
    pub subject: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub customer_phone: Option<String>,
    pub thread_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub message_id: Option<String>,
    pub has_attachments: bool,
    pub attachment_count: i32,
    pub raw_source_key: Option<String>,
}

/// Результат вставки
#[derive(Debug)]
#[allow(dead_code)]
pub struct InsertedEmail {
    pub id: i32,
    pub created_at: DateTime<Utc>,
}

/// Структура для вставки вложения письма
pub struct InsertEmailAttachment {
    pub email_id: i32,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_url: String,
}

/// Структура для чтения email из БД
#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct EmailRow {
    pub id: i32,
    pub direction: String,
    pub from_address: String,
    pub to_address: String,
    pub cc_addresses: Option<Vec<String>>,
    pub subject: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub customer_phone: Option<String>,
    pub thread_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub message_id: Option<String>,
    pub status: Option<String>,
    pub has_attachments: Option<bool>,
    pub attachment_count: Option<i32>,
    pub error_message: Option<String>,
    pub is_bounce: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Вставить входящее письмо в БД. Дедупликация по message_id (UNIQUE constraint)
pub async fn insert_email(pool: &PgPool, email: &InsertEmail) -> Result<InsertedEmail, sqlx::Error> {
    let row = sqlx::query_as::<_, (i32, DateTime<Utc>)>(
        r#"
        INSERT INTO email_messages (
            direction, from_address, to_address, cc_addresses, subject,
            body_text, body_html, customer_phone, thread_id, in_reply_to,
            message_id, status, has_attachments, attachment_count,
            created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'received', $12, $13, NOW(), NOW())
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id, created_at
        "#,
    )
    .bind(&email.direction)
    .bind(&email.from_address)
    .bind(&email.to_address)
    .bind(&email.cc_addresses)
    .bind(&email.subject)
    .bind(&email.body_text)
    .bind(&email.body_html)
    .bind(&email.customer_phone)
    .bind(&email.thread_id)
    .bind(&email.in_reply_to)
    .bind(&email.message_id)
    .bind(email.has_attachments)
    .bind(email.attachment_count)
    .fetch_one(pool)
    .await?;

    Ok(InsertedEmail {
        id: row.0,
        created_at: row.1,
    })
}

/// Вставить сохранённое вложение входящего письма
pub async fn insert_email_attachment(
    pool: &PgPool,
    attachment: &InsertEmailAttachment,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO email_attachments (
            email_id, filename, mime_type, size_bytes, content_disposition, storage_url
        ) VALUES ($1, $2, $3, $4, 'attachment', $5)
        "#,
    )
    .bind(attachment.email_id)
    .bind(&attachment.filename)
    .bind(&attachment.mime_type)
    .bind(attachment.size_bytes)
    .bind(&attachment.storage_url)
    .execute(pool)
    .await?;

    Ok(())
}

/// Вставить исходящее письмо (status = 'sent')
pub async fn insert_outbound_email(
    pool: &PgPool,
    from_address: &str,
    to_address: &str,
    subject: &str,
    body_html: Option<&str>,
    body_text: Option<&str>,
    message_id: &str,
    in_reply_to: Option<&str>,
) -> Result<InsertedEmail, sqlx::Error> {
    let row = sqlx::query_as::<_, (i32, DateTime<Utc>)>(
        r#"
        INSERT INTO email_messages (
            direction, from_address, to_address, subject,
            body_html, body_text, message_id, in_reply_to,
            status, created_at, updated_at
        ) VALUES ('outbound', $1, $2, $3, $4, $5, $6, $7, 'sent', NOW(), NOW())
        RETURNING id, created_at
        "#,
    )
    .bind(from_address)
    .bind(to_address)
    .bind(subject)
    .bind(body_html)
    .bind(body_text)
    .bind(message_id)
    .bind(in_reply_to)
    .fetch_one(pool)
    .await?;

    Ok(InsertedEmail {
        id: row.0,
        created_at: row.1,
    })
}

/// Обновить статус письма
pub async fn update_email_status(
    pool: &PgPool,
    email_id: i32,
    status: &str,
    error_message: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE email_messages SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3",
    )
    .bind(status)
    .bind(error_message)
    .bind(email_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Получить email по id
pub async fn get_email_by_id(pool: &PgPool, id: i32) -> Result<Option<EmailRow>, sqlx::Error> {
    sqlx::query_as::<_, EmailRow>("SELECT * FROM email_messages WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Получить последние email
pub async fn get_recent_emails(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<EmailRow>, sqlx::Error> {
    sqlx::query_as::<_, EmailRow>(
        "SELECT * FROM email_messages ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}
