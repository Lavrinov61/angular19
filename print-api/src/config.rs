use std::env;
use std::path::PathBuf;
use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub jwt_secret: String,
    pub log_level: String,
    pub mqtt: Option<MqttConfig>,
    pub redis_url: Option<String>,
    pub telegram: Option<TelegramConfig>,
    pub s3_base_url: String,
    pub conversion: Option<ConversionConfig>,
    pub emqx: EmqxConfig,
}

#[derive(Clone, Debug)]
pub struct ConversionConfig {
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_public_url: String,
    pub temp_dir: String,
    pub max_concurrent: usize,
}

#[derive(Clone, Debug)]
pub struct TelegramConfig {
    pub bot_token: String,
    pub alert_chat_id: String,
}

#[derive(Clone, Debug)]
pub struct EmqxConfig {
    pub api_url: String,
    pub api_key: String,
    pub api_secret: String,
}

#[derive(Clone, Debug)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub client_id: String,
}

impl Config {
    pub fn from_env() -> Self {
        let candidates = [
            env::current_dir().ok().map(|p| p.join(".env")),
            env::current_dir().ok().map(|p| p.join("../backend/.env")),
            Some(PathBuf::from("/var/www/apimain/angular-app/backend/.env")),
        ];

        for candidate in candidates.iter().flatten() {
            if candidate.exists() {
                let _ = dotenvy::from_path(candidate);
            }
        }

        let database_url = if let Ok(url) = env::var("DATABASE_URL") {
            url
        } else {
            let db_host = env::var("DB_HOST").expect("DB_HOST or DATABASE_URL required");
            let db_port = env::var("DB_PORT").unwrap_or_else(|_| "6432".into());
            let db_name = env::var("DB_NAME").unwrap_or_else(|_| "magnus_photo_db".into());
            let db_user = env::var("DB_USER").unwrap_or_else(|_| "magnus_user".into());
            let db_password = env::var("DB_PASSWORD").expect("DB_PASSWORD required");
            let db_ssl = env::var("DB_SSL").unwrap_or_else(|_| "true".into());
            let sslmode = if db_ssl == "true" {
                "require"
            } else {
                "disable"
            };
            format!(
                "postgres://{}:{}@{}:{}/{}?sslmode={}",
                db_user, db_password, db_host, db_port, db_name, sslmode
            )
        };

        let mqtt = Self::build_mqtt_config();
        let redis_url = Self::build_redis_url();
        let telegram = Self::build_telegram_config();
        let conversion = Self::build_conversion_config();
        let emqx = Self::build_emqx_config();

        Self {
            database_url,
            port: env::var("PRINT_API_PORT")
                .unwrap_or_else(|_| "3004".into())
                .parse()
                .expect("PRINT_API_PORT must be a number"),
            jwt_secret: env::var("JWT_SECRET").expect("JWT_SECRET required"),
            log_level: env::var("RUST_LOG").unwrap_or_else(|_| "info,print_api=debug".into()),
            mqtt,
            redis_url,
            telegram,
            s3_base_url: env::var("S3_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:9000/svoefoto-photos".into()),
            conversion,
            emqx,
        }
    }

    fn build_mqtt_config() -> Option<MqttConfig> {
        let password = env::var("MQTT_PASSWORD")
            .or_else(|_| env::var("MQTT_SVF_SERVER_PASSWORD"))
            .ok()?;

        Some(MqttConfig {
            host: env::var("MQTT_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: env::var("MQTT_PORT")
                .unwrap_or_else(|_| "1883".into())
                .parse()
                .unwrap_or(1883),
            username: env::var("MQTT_USERNAME").unwrap_or_else(|_| "svf_server".into()),
            password,
            client_id: env::var("MQTT_CLIENT_ID").unwrap_or_else(|_| "print-api-bridge".into()),
        })
    }

    fn build_telegram_config() -> Option<TelegramConfig> {
        let bot_token = env::var("TELEGRAM_BOT_TOKEN").ok()?;
        let chat_id = env::var("TELEGRAM_ALERT_CHAT_ID")
            .or_else(|_| env::var("TELEGRAM_GROUP_CHAT_ID"))
            .ok()?;
        Some(TelegramConfig {
            bot_token,
            alert_chat_id: chat_id,
        })
    }

    fn build_redis_url() -> Option<String> {
        let host = env::var("REDIS_HOST").ok()?.trim().to_string();
        if host.is_empty() {
            return None;
        }

        let port = env::var("REDIS_PORT")
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .unwrap_or(6379);

        let mut url = Url::parse("redis://localhost/").ok()?;
        url.set_host(Some(&host)).ok()?;
        url.set_port(Some(port)).ok()?;

        if let Some(password) = env::var("REDIS_PASSWORD")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            url.set_password(Some(&password)).ok()?;
        }

        Some(url.to_string())
    }

    fn build_emqx_config() -> EmqxConfig {
        EmqxConfig {
            api_url: env::var("EMQX_API_URL").unwrap_or_else(|_| "http://127.0.0.1:18083".into()),
            api_key: env::var("EMQX_API_KEY").unwrap_or_else(|_| {
                tracing::warn!("EMQX_API_KEY not set, using default 'admin'");
                "admin".into()
            }),
            api_secret: env::var("EMQX_API_SECRET").unwrap_or_else(|_| {
                tracing::warn!("EMQX_API_SECRET not set, using default credentials");
                "public".into()
            }),
        }
    }

    fn build_conversion_config() -> Option<ConversionConfig> {
        // S3 keys are required — if not set, conversion is disabled
        let s3_access_key = env::var("S3_ACCESS_KEY").ok()?;
        let s3_secret_key = env::var("S3_SECRET_KEY").ok()?;

        let temp_dir = env::var("CONVERSION_TEMP_DIR").unwrap_or_else(|_| {
            let preferred = "/var/lib/print-conversions";
            if std::path::Path::new(preferred).exists() {
                preferred.to_string()
            } else {
                "/tmp/print-conversions".to_string()
            }
        });

        Some(ConversionConfig {
            s3_endpoint: env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".into()),
            s3_region: env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into()),
            s3_bucket: env::var("S3_BUCKET").unwrap_or_else(|_| "svoefoto-photos".into()),
            s3_access_key,
            s3_secret_key,
            s3_public_url: env::var("S3_PUBLIC_URL")
                .unwrap_or_else(|_| "https://svoefoto.ru/media".into()),
            temp_dir,
            max_concurrent: env::var("CONVERSION_MAX_CONCURRENT")
                .unwrap_or_else(|_| "2".into())
                .parse()
                .unwrap_or(2),
        })
    }
}
