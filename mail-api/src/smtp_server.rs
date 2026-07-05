/// SMTP Receiver — принимаем входящие письма на порту 25
/// Поддержка EHLO, STARTTLS, MAIL FROM, RCPT TO, DATA, QUIT
/// Rate limiting, таймаут, relay protection
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::PgPool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_rustls::TlsAcceptor;
use tracing::{debug, error, info, warn};

use crate::attachment_store;
use crate::config::Config;
use crate::db;
use crate::mime_parser;

/// Максимум одновременных соединений
const MAX_CONNECTIONS: usize = 100;
/// Максимум писем в час с одного IP
const MAX_EMAILS_PER_HOUR: u32 = 50;
/// Таймаут на команду
const COMMAND_TIMEOUT: Duration = Duration::from_secs(300);

/// Счётчик rate limiting
struct RateLimiter {
    /// IP -> (количество, время первого письма)
    counts: HashMap<IpAddr, (u32, Instant)>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            counts: HashMap::new(),
        }
    }

    fn check_and_increment(&mut self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let entry = self.counts.entry(ip).or_insert((0, now));

        // Сбросить если прошёл час
        if now.duration_since(entry.1) > Duration::from_secs(3600) {
            *entry = (0, now);
        }

        if entry.0 >= MAX_EMAILS_PER_HOUR {
            return false;
        }

        entry.0 += 1;
        true
    }
}

/// Запустить SMTP сервер
pub async fn run_smtp_server(
    config: Arc<Config>,
    pool: PgPool,
    tls_acceptor: Option<TlsAcceptor>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = format!("0.0.0.0:{}", config.smtp_listen_port);
    let listener = TcpListener::bind(&addr).await?;
    info!("SMTP сервер слушает на {}", addr);

    let rate_limiter = Arc::new(Mutex::new(RateLimiter::new()));
    let connection_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let current = connection_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        if current >= MAX_CONNECTIONS {
            connection_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            warn!("Превышен лимит соединений ({}), отклоняем {}", MAX_CONNECTIONS, peer_addr);
            continue;
        }

        let config = config.clone();
        let pool = pool.clone();
        let tls_acceptor = tls_acceptor.clone();
        let rate_limiter = rate_limiter.clone();
        let connection_count = connection_count.clone();

        tokio::spawn(async move {
            if let Err(e) = handle_connection(
                stream,
                peer_addr.ip(),
                config,
                pool,
                tls_acceptor,
                rate_limiter,
            )
            .await
            {
                debug!("Ошибка SMTP сессии с {}: {}", peer_addr, e);
            }
            connection_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        });
    }
}

/// Состояние SMTP-сессии
struct SmtpSession {
    mail_from: Option<String>,
    rcpt_to: Vec<String>,
    ehlo_done: bool,
    tls_active: bool,
}

/// Обработать одно SMTP-соединение (plain text, с возможным STARTTLS upgrade)
async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer_ip: IpAddr,
    config: Arc<Config>,
    pool: PgPool,
    tls_acceptor: Option<TlsAcceptor>,
    rate_limiter: Arc<Mutex<RateLimiter>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);

    // Баннер
    let banner = format!("220 {} ESMTP mail-api\r\n", config.mail_hostname);
    writer.write_all(banner.as_bytes()).await?;

    let mut session = SmtpSession {
        mail_from: None,
        rcpt_to: Vec::new(),
        ehlo_done: false,
        tls_active: false,
    };

    loop {
        let mut line = String::new();
        let read_result = tokio::time::timeout(COMMAND_TIMEOUT, reader.read_line(&mut line)).await;

        match read_result {
            Err(_) => {
                writer
                    .write_all(b"421 Timeout, closing connection\r\n")
                    .await?;
                return Ok(());
            }
            Ok(Err(e)) => return Err(e.into()),
            Ok(Ok(0)) => return Ok(()), // Соединение закрыто
            Ok(Ok(_)) => {}
        }

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let (cmd, arg) = if let Some(pos) = line.find(' ') {
            (
                line[..pos].to_uppercase(),
                line[pos + 1..].trim().to_string(),
            )
        } else {
            (line.to_uppercase(), String::new())
        };

        debug!("SMTP [{peer_ip}] < {cmd} {arg}");

        match cmd.as_str() {
            "EHLO" | "HELO" => {
                session.ehlo_done = true;
                let mut response = format!("250-{}\r\n", config.mail_hostname);
                if tls_acceptor.is_some() && !session.tls_active {
                    response.push_str("250-STARTTLS\r\n");
                }
                response.push_str(&format!("250-SIZE {}\r\n", config.max_message_size));
                response.push_str("250 8BITMIME\r\n");
                writer.write_all(response.as_bytes()).await?;
            }

            "STARTTLS" => {
                if let Some(ref acceptor) = tls_acceptor {
                    writer
                        .write_all(b"220 Ready to start TLS\r\n")
                        .await?;

                    // Собираем stream обратно для TLS upgrade
                    // Нужно работать через unified stream
                    // В текущей реализации STARTTLS upgrade передаём в отдельную функцию
                    let plain_stream = reader.into_inner().unsplit(writer);
                    let tls_stream = acceptor.accept(plain_stream).await?;
                    session.tls_active = true;

                    // Продолжаем сессию через TLS
                    return handle_tls_session(
                        tls_stream,
                        peer_ip,
                        config,
                        pool,
                        rate_limiter,
                        session,
                    )
                    .await;
                } else {
                    writer
                        .write_all(b"454 TLS not available\r\n")
                        .await?;
                }
            }

            "MAIL" => {
                if !session.ehlo_done {
                    writer
                        .write_all(b"503 Send EHLO first\r\n")
                        .await?;
                    continue;
                }
                // MAIL FROM:<addr>
                if let Some(addr) = extract_address(&arg) {
                    session.mail_from = Some(addr);
                    session.rcpt_to.clear();
                    writer.write_all(b"250 OK\r\n").await?;
                } else {
                    writer
                        .write_all(b"501 Syntax error in MAIL FROM\r\n")
                        .await?;
                }
            }

            "RCPT" => {
                if session.mail_from.is_none() {
                    writer
                        .write_all(b"503 Need MAIL FROM first\r\n")
                        .await?;
                    continue;
                }
                // RCPT TO:<addr> — принимаем только домены из config.mail_domains
                if let Some(addr) = extract_address(&arg) {
                    if rcpt_domain_allowed(&addr, &config.mail_domains) {
                        session.rcpt_to.push(addr);
                        writer.write_all(b"250 OK\r\n").await?;
                    } else {
                        writer
                            .write_all(b"550 Relay denied\r\n")
                            .await?;
                    }
                } else {
                    writer
                        .write_all(b"501 Syntax error in RCPT TO\r\n")
                        .await?;
                }
            }

            "DATA" => {
                if session.rcpt_to.is_empty() {
                    writer
                        .write_all(b"503 Need RCPT TO first\r\n")
                        .await?;
                    continue;
                }

                // Rate limiting
                {
                    let mut rl = rate_limiter.lock().await;
                    if !rl.check_and_increment(peer_ip) {
                        writer
                            .write_all(b"452 Too many messages, try again later\r\n")
                            .await?;
                        continue;
                    }
                }

                writer
                    .write_all(b"354 Start mail input; end with <CRLF>.<CRLF>\r\n")
                    .await?;

                // Читаем тело до \r\n.\r\n
                let mut data = Vec::new();
                loop {
                    let mut data_line = String::new();
                    let read_result =
                        tokio::time::timeout(COMMAND_TIMEOUT, reader.read_line(&mut data_line))
                            .await;

                    match read_result {
                        Err(_) => {
                            writer
                                .write_all(b"421 Timeout during DATA\r\n")
                                .await?;
                            return Ok(());
                        }
                        Ok(Err(e)) => return Err(e.into()),
                        Ok(Ok(0)) => return Ok(()),
                        Ok(Ok(_)) => {}
                    }

                    // Конец данных
                    if data_line.trim() == "." {
                        break;
                    }

                    // Dot-stuffing: строка начинающаяся с ".." — убираем первую точку
                    if data_line.starts_with("..") {
                        data.extend_from_slice(data_line[1..].as_bytes());
                    } else {
                        data.extend_from_slice(data_line.as_bytes());
                    }

                    // Проверка размера
                    if data.len() > config.max_message_size {
                        writer
                            .write_all(b"552 Message too large\r\n")
                            .await?;
                        // Дочитываем до конца DATA
                        loop {
                            let mut skip = String::new();
                            if reader.read_line(&mut skip).await.unwrap_or(0) == 0 {
                                break;
                            }
                            if skip.trim() == "." {
                                break;
                            }
                        }
                        continue;
                    }
                }

                // Обработать полученное письмо
                let mail_from = session.mail_from.clone().unwrap_or_default();
                let rcpt_to = session.rcpt_to.clone();
                match process_inbound_email(&data, &mail_from, &rcpt_to, &config, &pool).await {
                    Ok(email_id) => {
                        info!(
                            "Письмо принято: {} -> {:?}, id={}",
                            mail_from, rcpt_to, email_id
                        );
                        writer
                            .write_all(format!("250 OK queued as {email_id}\r\n").as_bytes())
                            .await?;
                    }
                    Err(e) => {
                        error!("Ошибка обработки письма: {}", e);
                        writer
                            .write_all(b"451 Temporary failure, try again\r\n")
                            .await?;
                    }
                }

                // Сброс сессии для следующего письма
                session.mail_from = None;
                session.rcpt_to.clear();
            }

            "RSET" => {
                session.mail_from = None;
                session.rcpt_to.clear();
                writer.write_all(b"250 OK\r\n").await?;
            }

            "NOOP" => {
                writer.write_all(b"250 OK\r\n").await?;
            }

            "QUIT" => {
                writer.write_all(b"221 Bye\r\n").await?;
                return Ok(());
            }

            _ => {
                writer
                    .write_all(b"502 Command not implemented\r\n")
                    .await?;
            }
        }
    }
}

/// Продолжение SMTP-сессии после TLS upgrade
async fn handle_tls_session(
    tls_stream: tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
    peer_ip: IpAddr,
    config: Arc<Config>,
    pool: PgPool,
    rate_limiter: Arc<Mutex<RateLimiter>>,
    mut session: SmtpSession,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (reader, mut writer) = tokio::io::split(tls_stream);
    let mut reader = BufReader::new(reader);

    // После STARTTLS клиент должен заново отправить EHLO
    session.ehlo_done = false;
    session.mail_from = None;
    session.rcpt_to.clear();

    loop {
        let mut line = String::new();
        let read_result = tokio::time::timeout(COMMAND_TIMEOUT, reader.read_line(&mut line)).await;

        match read_result {
            Err(_) => {
                writer
                    .write_all(b"421 Timeout, closing connection\r\n")
                    .await?;
                return Ok(());
            }
            Ok(Err(e)) => return Err(e.into()),
            Ok(Ok(0)) => return Ok(()),
            Ok(Ok(_)) => {}
        }

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let (cmd, arg) = if let Some(pos) = line.find(' ') {
            (
                line[..pos].to_uppercase(),
                line[pos + 1..].trim().to_string(),
            )
        } else {
            (line.to_uppercase(), String::new())
        };

        debug!("SMTP/TLS [{peer_ip}] < {cmd} {arg}");

        match cmd.as_str() {
            "EHLO" | "HELO" => {
                session.ehlo_done = true;
                let response = format!(
                    "250-{}\r\n250-SIZE {}\r\n250 8BITMIME\r\n",
                    config.mail_hostname, config.max_message_size
                );
                writer.write_all(response.as_bytes()).await?;
            }

            "MAIL" => {
                if !session.ehlo_done {
                    writer.write_all(b"503 Send EHLO first\r\n").await?;
                    continue;
                }
                if let Some(addr) = extract_address(&arg) {
                    session.mail_from = Some(addr);
                    session.rcpt_to.clear();
                    writer.write_all(b"250 OK\r\n").await?;
                } else {
                    writer
                        .write_all(b"501 Syntax error in MAIL FROM\r\n")
                        .await?;
                }
            }

            "RCPT" => {
                if session.mail_from.is_none() {
                    writer.write_all(b"503 Need MAIL FROM first\r\n").await?;
                    continue;
                }
                if let Some(addr) = extract_address(&arg) {
                    if rcpt_domain_allowed(&addr, &config.mail_domains) {
                        session.rcpt_to.push(addr);
                        writer.write_all(b"250 OK\r\n").await?;
                    } else {
                        writer
                            .write_all(b"550 Relay denied\r\n")
                            .await?;
                    }
                } else {
                    writer
                        .write_all(b"501 Syntax error in RCPT TO\r\n")
                        .await?;
                }
            }

            "DATA" => {
                if session.rcpt_to.is_empty() {
                    writer.write_all(b"503 Need RCPT TO first\r\n").await?;
                    continue;
                }

                {
                    let mut rl = rate_limiter.lock().await;
                    if !rl.check_and_increment(peer_ip) {
                        writer
                            .write_all(b"452 Too many messages\r\n")
                            .await?;
                        continue;
                    }
                }

                writer
                    .write_all(b"354 Start mail input; end with <CRLF>.<CRLF>\r\n")
                    .await?;

                let mut data = Vec::new();
                loop {
                    let mut data_line = String::new();
                    let read_result =
                        tokio::time::timeout(COMMAND_TIMEOUT, reader.read_line(&mut data_line))
                            .await;

                    match read_result {
                        Err(_) => {
                            writer.write_all(b"421 Timeout during DATA\r\n").await?;
                            return Ok(());
                        }
                        Ok(Err(e)) => return Err(e.into()),
                        Ok(Ok(0)) => return Ok(()),
                        Ok(Ok(_)) => {}
                    }

                    if data_line.trim() == "." {
                        break;
                    }
                    if data_line.starts_with("..") {
                        data.extend_from_slice(data_line[1..].as_bytes());
                    } else {
                        data.extend_from_slice(data_line.as_bytes());
                    }

                    if data.len() > config.max_message_size {
                        writer.write_all(b"552 Message too large\r\n").await?;
                        loop {
                            let mut skip = String::new();
                            if reader.read_line(&mut skip).await.unwrap_or(0) == 0 {
                                break;
                            }
                            if skip.trim() == "." {
                                break;
                            }
                        }
                        continue;
                    }
                }

                let mail_from = session.mail_from.clone().unwrap_or_default();
                let rcpt_to = session.rcpt_to.clone();
                match process_inbound_email(&data, &mail_from, &rcpt_to, &config, &pool).await {
                    Ok(email_id) => {
                        info!("Письмо принято (TLS): {} -> {:?}, id={}", mail_from, rcpt_to, email_id);
                        writer
                            .write_all(format!("250 OK queued as {email_id}\r\n").as_bytes())
                            .await?;
                    }
                    Err(e) => {
                        error!("Ошибка обработки письма: {}", e);
                        writer.write_all(b"451 Temporary failure\r\n").await?;
                    }
                }

                session.mail_from = None;
                session.rcpt_to.clear();
            }

            "RSET" => {
                session.mail_from = None;
                session.rcpt_to.clear();
                writer.write_all(b"250 OK\r\n").await?;
            }

            "NOOP" => {
                writer.write_all(b"250 OK\r\n").await?;
            }

            "QUIT" => {
                writer.write_all(b"221 Bye\r\n").await?;
                return Ok(());
            }

            _ => {
                writer.write_all(b"502 Command not implemented\r\n").await?;
            }
        }
    }
}

/// Принимаем ли RCPT TO для этого адреса: домен (часть после последнего '@') ∈ список разрешённых
fn rcpt_domain_allowed(addr: &str, domains: &[String]) -> bool {
    match addr.to_lowercase().rsplit_once('@') {
        Some((_, domain)) => domains.iter().any(|d| d == domain),
        None => false,
    }
}

/// Извлечь email адрес из "FROM:<user@example.com>" или "TO:<user@example.com>"
fn extract_address(arg: &str) -> Option<String> {
    // Формат: FROM:<addr> или TO:<addr>
    let arg = arg.trim();
    if let Some(start) = arg.find('<') {
        if let Some(end) = arg.find('>') {
            let addr = arg[start + 1..end].trim().to_lowercase();
            if addr.contains('@') {
                return Some(addr);
            }
        }
    }
    None
}

/// Обработать входящее письмо: парсинг → БД → webhook
async fn process_inbound_email(
    raw_data: &[u8],
    envelope_from: &str,
    envelope_to: &[String],
    config: &Config,
    pool: &PgPool,
) -> Result<i32, Box<dyn std::error::Error + Send + Sync>> {
    // Парсим MIME
    let parsed = mime_parser::parse_email(raw_data)
        .ok_or("Не удалось распарсить MIME")?;

    let to_address = if !parsed.to.is_empty() {
        parsed.to.join(", ")
    } else {
        envelope_to.join(", ")
    };

    let from_address = if parsed.from.is_empty() {
        envelope_from.to_string()
    } else {
        parsed.from.clone()
    };

    let insert = db::InsertEmail {
        direction: "inbound".to_string(),
        from_address: from_address.clone(),
        to_address: to_address.clone(),
        cc_addresses: parsed.cc.clone(),
        subject: parsed.subject.clone(),
        body_text: parsed.body_text.clone(),
        body_html: parsed.body_html.clone(),
        customer_phone: None,
        thread_id: parsed.in_reply_to.clone(),
        in_reply_to: parsed.in_reply_to.clone(),
        message_id: parsed.message_id.clone(),
        has_attachments: !parsed.attachments.is_empty(),
        attachment_count: parsed.attachments.len() as i32,
        raw_source_key: None,
    };

    let result = db::insert_email(pool, &insert).await?;

    if !parsed.attachments.is_empty() {
        match attachment_store::store_attachments(
            Path::new(&config.attachment_storage_dir),
            &config.attachment_url_prefix,
            result.id,
            &parsed.attachments,
        )
        .await
        {
            Ok(stored_attachments) => {
                let mut saved_count = 0usize;
                for stored in stored_attachments {
                    let insert_attachment = db::InsertEmailAttachment {
                        email_id: result.id,
                        filename: stored.filename,
                        mime_type: stored.mime_type,
                        size_bytes: stored.size_bytes,
                        storage_url: stored.storage_url,
                    };

                    match db::insert_email_attachment(pool, &insert_attachment).await {
                        Ok(()) => saved_count += 1,
                        Err(e) => error!(
                            "Не удалось записать вложение письма {} в БД: {}",
                            result.id, e
                        ),
                    }
                }

                if saved_count == parsed.attachments.len() {
                    info!("Сохранены вложения письма {}: {}", result.id, saved_count);
                } else {
                    warn!(
                        "Часть вложений письма {} не сохранена: {}/{}",
                        result.id,
                        saved_count,
                        parsed.attachments.len()
                    );
                }
            }
            Err(e) => error!("Не удалось сохранить вложения письма {}: {}", result.id, e),
        }
    }

    // Отправляем webhook на backend
    let webhook_url = &config.webhook_url;
    let client = reqwest::Client::new();
    let webhook_body = serde_json::json!({
        "event": "email.received",
        "email_id": result.id,
        "from": from_address,
        "to": to_address,
        "subject": parsed.subject.unwrap_or_default(),
    });

    // Fire-and-forget webhook (не блокируем SMTP)
    let url = webhook_url.clone();
    tokio::spawn(async move {
        if let Err(e) = client
            .post(&url)
            .json(&webhook_body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            warn!("Webhook ошибка: {}", e);
        }
    });

    Ok(result.id)
}
