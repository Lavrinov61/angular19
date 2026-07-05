/// Конфигурация mail-api из переменных окружения

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub mail_domain: String,
    pub mail_domains: Vec<String>,
    pub mail_hostname: String,
    pub smtp_relay_host: Option<String>,
    pub smtp_relay_port: u16,
    pub smtp_relay_user: Option<String>,
    pub smtp_relay_password: Option<String>,
    pub dkim_private_key_path: String,
    pub dkim_selector: String,
    pub tls_cert_path: String,
    pub tls_key_path: String,
    pub mail_api_port: u16,
    pub smtp_listen_port: u16,
    pub max_message_size: usize,
    pub webhook_url: String,
    pub attachment_storage_dir: String,
    pub attachment_url_prefix: String,
}

impl Config {
    /// Загрузить конфигурацию из переменных окружения
    pub fn from_env() -> Result<Self, String> {
        let get_or = |key: &str, default: &str| -> String {
            std::env::var(key).unwrap_or_else(|_| default.to_string())
        };

        let get_opt = |key: &str| -> Option<String> {
            std::env::var(key).ok().filter(|v| !v.is_empty())
        };

        // Собираем DATABASE_URL из отдельных переменных если DATABASE_URL не задана
        let database_url = get_opt("DATABASE_URL").unwrap_or_else(|| {
            let host = get_or("DB_HOST", "127.0.0.1");
            let port = get_or("DB_PORT", "5432");
            let name = get_or("DB_NAME", "magnus_photo_db");
            let user = get_or("DB_USER", "magnus_user");
            let password = get_or("DB_PASSWORD", "");
            format!("postgresql://{user}:{password}@{host}:{port}/{name}")
        });

        let mail_domain = get_or("MAIL_DOMAIN", "svoefoto.ru");

        // Если MAIL_DOMAINS задан — берём его (через запятую, trim+lowercase, без пустых); иначе дефолт = [mail_domain] (поведение как раньше)
        let mail_domains: Vec<String> = match get_opt("MAIL_DOMAINS") {
            Some(raw) => raw
                .split(',')
                .map(|d| d.trim().to_lowercase())
                .filter(|d| !d.is_empty())
                .collect(),
            None => vec![mail_domain.to_lowercase()],
        };

        Ok(Self {
            database_url,
            mail_domain: mail_domain.clone(),
            mail_domains,
            mail_hostname: get_or("MAIL_HOSTNAME", "mail.svoefoto.ru"),
            smtp_relay_host: get_opt("SMTP_RELAY_HOST"),
            smtp_relay_port: get_or("SMTP_RELAY_PORT", "587")
                .parse()
                .map_err(|_| "Invalid SMTP_RELAY_PORT")?,
            smtp_relay_user: get_opt("SMTP_RELAY_USER"),
            smtp_relay_password: get_opt("SMTP_RELAY_PASSWORD"),
            dkim_private_key_path: get_or(
                "DKIM_PRIVATE_KEY_PATH",
                "/etc/mail-api/dkim-private.pem",
            ),
            dkim_selector: get_or("DKIM_SELECTOR", "mail"),
            tls_cert_path: get_or(
                "TLS_CERT_PATH",
                "/etc/letsencrypt/live/svoefoto.ru/fullchain.pem",
            ),
            tls_key_path: get_or(
                "TLS_KEY_PATH",
                "/etc/letsencrypt/live/svoefoto.ru/privkey.pem",
            ),
            mail_api_port: get_or("MAIL_API_PORT", "5056")
                .parse()
                .map_err(|_| "Invalid MAIL_API_PORT")?,
            smtp_listen_port: get_or("MAIL_SMTP_PORT", "25")
                .parse()
                .map_err(|_| "Invalid MAIL_SMTP_PORT")?,
            max_message_size: get_or("MAX_MESSAGE_SIZE", "26214400")
                .parse()
                .map_err(|_| "Invalid MAX_MESSAGE_SIZE")?,
            webhook_url: get_or(
                "WEBHOOK_URL",
                "http://localhost:3001/api/internal/email-webhook",
            ),
            attachment_storage_dir: get_or(
                "ATTACHMENT_STORAGE_DIR",
                "/var/www/apimain/angular-app/uploads/email-attachments",
            ),
            attachment_url_prefix: get_or("ATTACHMENT_URL_PREFIX", "/uploads/email-attachments"),
        })
    }
}
