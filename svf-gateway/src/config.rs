use std::env;

/// Gateway configuration loaded from environment variables.
/// Shares backend/.env via systemd EnvironmentFile.
#[derive(Clone)]
pub struct Config {
    /// gRPC listen port (GATEWAY_PORT or 50051)
    pub port: u16,
    /// Current JWT signing secret
    pub jwt_secret: String,
    /// Previous JWT secret for key rotation (optional)
    pub jwt_secret_previous: Option<String>,
    /// Redis connection URL
    pub redis_url: String,
    /// Express API base URL for proxied RPCs
    pub express_url: String,
    /// Telephony/phone-auth base URL for mobile login RPCs.
    pub phone_auth_url: String,
    /// Shared internal secret that lets the gateway use the mobile phone-auth path.
    pub mobile_grpc_internal_secret: Option<String>,
    /// S3-compatible object storage
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key_id: String,
    pub s3_secret_access_key: String,
    pub s3_public_url: String,
    /// Unary request timeout enforced by tonic.
    pub grpc_request_timeout_secs: u64,
    /// Max decoded inbound protobuf message size for public mobile services.
    pub grpc_max_decoding_message_size_bytes: usize,
    /// Max encoded outbound protobuf message size for public mobile services.
    pub grpc_max_encoding_message_size_bytes: usize,
    /// Max concurrent HTTP/2 streams per client connection.
    pub grpc_max_concurrent_streams: u32,
    /// Tower concurrency limit per connection.
    pub grpc_concurrency_limit_per_connection: usize,
}

impl Config {
    /// Load configuration from environment. Panics on missing required vars.
    pub fn from_env() -> Self {
        let jwt_secret = required("JWT_SECRET");
        let express_url =
            env::var("EXPRESS_URL").unwrap_or_else(|_| "http://127.0.0.1:3001".to_string());

        Self {
            port: env::var("GATEWAY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50051),
            jwt_secret: jwt_secret.clone(),
            jwt_secret_previous: env::var("JWT_SECRET_PREVIOUS")
                .ok()
                .filter(|s| !s.is_empty()),
            redis_url: redis_url(),
            express_url: express_url.clone(),
            phone_auth_url: phone_auth_url(&express_url),
            mobile_grpc_internal_secret: mobile_grpc_internal_secret(&jwt_secret),
            s3_endpoint: required("S3_ENDPOINT"),
            s3_region: env::var("S3_REGION").unwrap_or_else(|_| "ru-1".to_string()),
            s3_bucket: required("S3_BUCKET"),
            s3_access_key_id: required_any("S3_ACCESS_KEY_ID", &["S3_ACCESS_KEY"]),
            s3_secret_access_key: required_any("S3_SECRET_ACCESS_KEY", &["S3_SECRET_KEY"]),
            s3_public_url: required("S3_PUBLIC_URL"),
            grpc_request_timeout_secs: optional_u64("GRPC_REQUEST_TIMEOUT_SECS", 30),
            grpc_max_decoding_message_size_bytes: optional_usize(
                "GRPC_MAX_DECODING_MESSAGE_SIZE_BYTES",
                4 * 1024 * 1024,
            ),
            grpc_max_encoding_message_size_bytes: optional_usize(
                "GRPC_MAX_ENCODING_MESSAGE_SIZE_BYTES",
                8 * 1024 * 1024,
            ),
            grpc_max_concurrent_streams: optional_u32("GRPC_MAX_CONCURRENT_STREAMS", 128),
            grpc_concurrency_limit_per_connection: optional_usize(
                "GRPC_CONCURRENCY_LIMIT_PER_CONNECTION",
                128,
            ),
        }
    }
}

fn phone_auth_url(express_url: &str) -> String {
    optional("PHONE_AUTH_URL")
        .or_else(|| optional("TELEPHONY_URL"))
        .unwrap_or_else(|| {
            if env_flag_enabled("SPLIT_ENABLED") {
                let port = optional("TELEPHONY_PORT").unwrap_or_else(|| "3009".to_string());
                format!("http://127.0.0.1:{port}")
            } else {
                express_url.to_string()
            }
        })
}

fn mobile_grpc_internal_secret(jwt_secret: &str) -> Option<String> {
    optional("MOBILE_GRPC_INTERNAL_SECRET")
        .or_else(|| optional("GRPC_INTERNAL_AUTH_SECRET"))
        .or_else(|| Some(jwt_secret.to_string()))
}

fn required(name: &str) -> String {
    optional(name).unwrap_or_else(|| panic!("{name} environment variable is required"))
}

fn required_any(primary: &str, fallbacks: &[&str]) -> String {
    let mut names = Vec::with_capacity(fallbacks.len() + 1);
    names.push(primary);

    if let Some(value) = std::iter::once(primary)
        .chain(fallbacks.iter().copied())
        .find_map(optional)
    {
        return value;
    }

    names.extend_from_slice(fallbacks);
    panic!("{} environment variable is required", names.join(" or "))
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn env_flag_enabled(name: &str) -> bool {
    matches!(
        optional(name)
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn optional_u64(name: &str, default: u64) -> u64 {
    optional(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn optional_u32(name: &str, default: u32) -> u32 {
    optional(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn optional_usize(name: &str, default: usize) -> usize {
    optional(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn redis_url() -> String {
    optional("REDIS_URL").unwrap_or_else(|| {
        let host = required("REDIS_HOST");
        let port = optional("REDIS_PORT").unwrap_or_else(|| "6379".to_string());
        build_redis_url(&host, &port, optional("REDIS_PASSWORD").as_deref())
    })
}

fn build_redis_url(host: &str, port: &str, password: Option<&str>) -> String {
    match password {
        Some(password) if !password.is_empty() => {
            format!("redis://:{}@{host}:{port}", encode_url_component(password))
        }
        _ => format!("redis://{host}:{port}"),
    }
}

fn encode_url_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_redis_url_from_host_and_port_without_password() {
        assert_eq!(
            build_redis_url("127.0.0.1", "6379", None),
            "redis://127.0.0.1:6379"
        );
    }

    #[test]
    fn builds_redis_url_from_host_port_and_password() {
        assert_eq!(
            build_redis_url("redis.internal", "6380", Some("secret")),
            "redis://:secret@redis.internal:6380"
        );
    }

    #[test]
    fn encodes_redis_password_url_component() {
        assert_eq!(
            build_redis_url("redis.internal", "6380", Some("p@ss/word")),
            "redis://:p%40ss%2Fword@redis.internal:6380"
        );
    }

    #[test]
    fn keeps_gateway_limits_parseable() {
        assert_eq!(optional_u64("__SVF_TEST_MISSING_U64", 30), 30);
        assert_eq!(optional_u32("__SVF_TEST_MISSING_U32", 128), 128);
        assert_eq!(optional_usize("__SVF_TEST_MISSING_USIZE", 4096), 4096);
    }
}
