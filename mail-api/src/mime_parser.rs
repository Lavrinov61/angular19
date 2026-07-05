/// Парсинг MIME email — извлечение заголовков, тела, вложений, charset detection
use encoding_rs::{WINDOWS_1251, KOI8_R, ISO_8859_5};
use mail_parser::{MessageParser, MimeHeaders};

/// Распарсенное письмо
#[derive(Debug)]
#[allow(dead_code)]
pub struct ParsedEmail {
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: Option<String>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub date: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub attachments: Vec<ParsedAttachment>,
}

/// Вложение
#[derive(Debug)]
#[allow(dead_code)]
pub struct ParsedAttachment {
    pub filename: String,
    pub mime_type: String,
    pub content: Vec<u8>,
}

/// Спарсить сырой email (RFC 5322)
pub fn parse_email(raw: &[u8]) -> Option<ParsedEmail> {
    let message = MessageParser::default().parse(raw)?;

    let from = message
        .from()
        .and_then(|addrs| addrs.first())
        .map(|a| {
            if let Some(name) = a.name() {
                format!("{} <{}>", name, a.address().unwrap_or_default())
            } else {
                a.address().unwrap_or_default().to_string()
            }
        })
        .unwrap_or_default();

    let to = message
        .to()
        .map(|addrs| {
            addrs
                .iter()
                .filter_map(|a| a.address().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let cc = message
        .cc()
        .map(|addrs| {
            addrs
                .iter()
                .filter_map(|a| a.address().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let subject = message.subject().map(|s| s.to_string());
    let message_id = message.message_id().map(|s| format!("<{s}>"));
    let in_reply_to = message.in_reply_to().as_text().map(|s| s.to_string());
    let date = message.date().map(|d| d.to_rfc3339());

    // body_text с fallback charset detection
    let body_text = message
        .body_text(0)
        .map(|s| ensure_utf8(s.as_bytes()));

    // body_html с санитизацией
    let body_html = message
        .body_html(0)
        .map(|s| sanitize_html(&ensure_utf8(s.as_bytes())));

    // Вложения
    let mut attachments = Vec::new();
    for attachment in message.attachments() {
        let filename = attachment
            .attachment_name()
            .unwrap_or("unnamed")
            .to_string();
        let mime_type = attachment
            .content_type()
            .map(|ct| {
                if let Some(subtype) = ct.subtype() {
                    format!("{}/{}", ct.ctype(), subtype)
                } else {
                    ct.ctype().to_string()
                }
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let content = attachment.contents().to_vec();

        attachments.push(ParsedAttachment {
            filename,
            mime_type,
            content,
        });
    }

    Some(ParsedEmail {
        from,
        to,
        cc,
        subject,
        message_id,
        in_reply_to,
        date,
        body_text,
        body_html,
        attachments,
    })
}

/// Гарантировать UTF-8, пытаясь декодировать кириллические кодировки
fn ensure_utf8(bytes: &[u8]) -> String {
    // Если уже валидный UTF-8 — возвращаем
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }

    // Пробуем Windows-1251 (самая частая для русской почты)
    let (decoded, _, had_errors) = WINDOWS_1251.decode(bytes);
    if !had_errors {
        return decoded.into_owned();
    }

    // KOI8-R
    let (decoded, _, had_errors) = KOI8_R.decode(bytes);
    if !had_errors {
        return decoded.into_owned();
    }

    // ISO-8859-5
    let (decoded, _, _) = ISO_8859_5.decode(bytes);
    decoded.into_owned()
}

/// Базовая санитизация HTML — удаление опасных тегов и атрибутов
fn sanitize_html(html: &str) -> String {
    let mut result = html.to_string();

    // Удаляем <script>...</script>
    while let Some(start) = result.to_lowercase().find("<script") {
        if let Some(end) = result.to_lowercase()[start..].find("</script>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + end + "</script>".len()..]
            );
        } else {
            // Незакрытый script — убираем до конца
            result.truncate(start);
            break;
        }
    }

    // Удаляем <style>...</style>
    while let Some(start) = result.to_lowercase().find("<style") {
        if let Some(end) = result.to_lowercase()[start..].find("</style>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + end + "</style>".len()..]
            );
        } else {
            result.truncate(start);
            break;
        }
    }

    // Удаляем javascript: ссылки (простой подход)
    while let Some(pos) = result.to_lowercase().find("javascript:") {
        // Ищем ближайший символ начала значения перед javascript:
        let safe_start = result[..pos].rfind(|c: char| c == '"' || c == '\'').unwrap_or(pos);
        let safe_end = result[pos..].find(|c: char| c == '"' || c == '\'').map(|i| pos + i + 1).unwrap_or(result.len());
        result = format!("{}{}", &result[..safe_start], &result[safe_end..]);
    }

    result
}
