use super::interceptor::VerifiedUser;
use redis::aio::MultiplexedConnection;
use tonic::Status;
use tonic::codegen::http::HeaderMap;
use tracing::warn;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct RateLimitPolicy {
    pub name: &'static str,
    pub max_requests: i64,
    pub window_secs: i64,
}

pub async fn enforce(
    redis: &MultiplexedConnection,
    method: &str,
    headers: &HeaderMap,
    user: Option<&VerifiedUser>,
) -> Result<(), Status> {
    let Some(policy) = policy_for_rpc(method) else {
        return Ok(());
    };

    let identity = rate_limit_identity(headers, user);
    let window = current_window(policy.window_secs);
    let key = format!("grpc:rl:{}:{}:{window}", policy.name, identity);
    let mut conn = redis.clone();

    let count = match redis::cmd("INCR")
        .arg(&key)
        .query_async::<i64>(&mut conn)
        .await
    {
        Ok(count) => count,
        Err(error) => {
            warn!(
                error = %error,
                rate_limit = policy.name,
                "gRPC rate limit check failed"
            );
            return Ok(());
        }
    };

    if count == 1 {
        if let Err(error) = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(policy.window_secs + 5)
            .query_async::<()>(&mut conn)
            .await
        {
            warn!(
                error = %error,
                rate_limit = policy.name,
                "gRPC rate limit expiry update failed"
            );
        }
    }

    if count > policy.max_requests {
        warn!(
            rate_limit = policy.name,
            count,
            max_requests = policy.max_requests,
            window_secs = policy.window_secs,
            "gRPC rate limit exceeded"
        );
        return Err(Status::resource_exhausted("rate limit exceeded"));
    }

    Ok(())
}

pub fn policy_for_rpc(method: &str) -> Option<RateLimitPolicy> {
    match method {
        m if m.ends_with("/svf.auth.v1.AuthService/SendOtp") => Some(RateLimitPolicy {
            name: "auth_send_otp",
            max_requests: 5,
            window_secs: 600,
        }),
        m if m.ends_with("/svf.auth.v1.AuthService/VerifyOtp")
            || m.ends_with("/svf.auth.v1.AuthService/Verify2FA") =>
        {
            Some(RateLimitPolicy {
                name: "auth_verify",
                max_requests: 10,
                window_secs: 600,
            })
        }
        m if m.ends_with("/svf.auth.v1.AuthService/RefreshToken") => Some(RateLimitPolicy {
            name: "auth_refresh",
            max_requests: 60,
            window_secs: 900,
        }),
        m if m.ends_with("/svf.chat.v1.ChatService/SendMessage") => Some(RateLimitPolicy {
            name: "chat_send",
            max_requests: 30,
            window_secs: 60,
        }),
        m if m.ends_with("/svf.chat.v1.ChatService/MarkRead") => Some(RateLimitPolicy {
            name: "chat_mark_read",
            max_requests: 120,
            window_secs: 60,
        }),
        m if m.ends_with("/svf.chat.v1.ChatService/StartChatUpload")
            || m.ends_with("/svf.chat.v1.ChatService/CompleteChatUpload")
            || m.ends_with("/svf.chat.v1.ChatService/CompleteChatBundleUpload")
            || m.ends_with("/svf.media.v1.MediaService/GetSignedUploadUrl") =>
        {
            Some(RateLimitPolicy {
                name: "upload",
                max_requests: 30,
                window_secs: 900,
            })
        }
        m if m.ends_with("/svf.media.v1.MediaService/GetSignedReadUrl")
            || m.ends_with("/svf.media.v1.MediaService/BatchGetSignedReadUrls") =>
        {
            Some(RateLimitPolicy {
                name: "media_read",
                max_requests: 120,
                window_secs: 60,
            })
        }
        _ => None,
    }
}

fn rate_limit_identity(headers: &HeaderMap, user: Option<&VerifiedUser>) -> String {
    if let Some(user) = user {
        return format!("user:{}", sanitize_identity(&user.user_id));
    }

    header_value(headers, "x-forwarded-for")
        .and_then(|value| value.split(',').next().map(str::trim).map(str::to_string))
        .or_else(|| header_value(headers, "x-real-ip"))
        .filter(|value| !value.is_empty())
        .map(|value| format!("ip:{}", sanitize_identity(&value)))
        .unwrap_or_else(|| "anonymous".to_string())
}

fn header_value(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn sanitize_identity(value: &str) -> String {
    let sanitized = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | ':' | '-' | '_' | '@'))
        .take(96)
        .collect::<String>();

    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn current_window(window_secs: i64) -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    now / window_secs.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tonic::codegen::http::HeaderMap;

    #[test]
    fn maps_sensitive_methods_to_policies() {
        assert_eq!(
            policy_for_rpc("/svf.auth.v1.AuthService/SendOtp").map(|policy| policy.name),
            Some("auth_send_otp")
        );
        assert_eq!(
            policy_for_rpc("/svf.chat.v1.ChatService/CompleteChatUpload").map(|policy| policy.name),
            Some("upload")
        );
        assert_eq!(
            policy_for_rpc("/svf.media.v1.MediaService/BatchGetSignedReadUrls")
                .map(|policy| policy.name),
            Some("media_read")
        );
        assert!(policy_for_rpc("/svf.chat.v1.ChatService/GetHistory").is_none());
    }

    #[test]
    fn builds_identity_from_user_before_ip_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.7".parse().unwrap());
        let user = VerifiedUser {
            user_id: "user-1".to_string(),
            role: "client".to_string(),
            employee_id: None,
        };

        assert_eq!(
            rate_limit_identity(&headers, Some(&user)),
            "user:user-1".to_string()
        );
    }

    #[test]
    fn builds_identity_from_forwarded_ip() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "203.0.113.7, 198.51.100.8".parse().unwrap(),
        );

        assert_eq!(rate_limit_identity(&headers, None), "ip:203.0.113.7");
    }

    #[test]
    fn sanitizes_identity_values() {
        assert_eq!(sanitize_identity(" user/../1 "), "user..1");
        assert_eq!(sanitize_identity(""), "unknown");
    }
}
