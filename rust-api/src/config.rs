use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub jwt_secret: String,
    pub cors_origin: String,
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Self {
        // Load .env files — try multiple locations
        let candidates = [
            // rust-api/.env (local override)
            env::current_dir().ok().map(|p| p.join(".env")),
            // angular-app/backend/.env (shared secrets)
            env::current_dir().ok().map(|p| p.join("../backend/.env")),
            // Absolute fallback for production
            Some(PathBuf::from("/var/www/apimain/angular-app/backend/.env")),
        ];

        for candidate in candidates.iter().flatten() {
            if candidate.exists() {
                let _ = dotenvy::from_path(candidate);
            }
        }

        // DATABASE_URL takes precedence if set directly;
        // otherwise build from individual DB_* components
        let database_url = if let Ok(url) = env::var("DATABASE_URL") {
            url
        } else {
            let db_host = env::var("DB_HOST").expect("DB_HOST or DATABASE_URL required");
            let db_port = env::var("DB_PORT").unwrap_or_else(|_| "6432".into());
            let db_name = env::var("DB_NAME").unwrap_or_else(|_| "magnus_photo_db".into());
            let db_user = env::var("DB_USER").unwrap_or_else(|_| "magnus_user".into());
            let db_password = env::var("DB_PASSWORD").expect("DB_PASSWORD required");
            let db_ssl = env::var("DB_SSL").unwrap_or_else(|_| "true".into());

            let sslmode = if db_ssl == "true" { "require" } else { "disable" };
            format!(
                "postgres://{}:{}@{}:{}/{}?sslmode={}",
                db_user, db_password, db_host, db_port, db_name, sslmode
            )
        };

        Self {
            database_url,
            port: env::var("KB_API_PORT")
                .or_else(|_| env::var("KB_PORT"))
                .unwrap_or_else(|_| "3003".into())
                .parse()
                .expect("KB_API_PORT must be a number"),
            jwt_secret: env::var("JWT_SECRET").expect("JWT_SECRET required"),
            cors_origin: env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "https://svoefoto.ru".into()),
            log_level: env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,kb_api=debug".into()),
        }
    }
}
