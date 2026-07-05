use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tonic::Status;
use tonic::body::BoxBody;
use tonic::codegen::http::Request as HttpRequest;
use tracing::warn;

use super::rate_limit;

/// Verified user identity extracted from JWT, inserted into request extensions.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VerifiedUser {
    pub user_id: String,
    pub role: String,
    pub employee_id: Option<i32>,
}

/// JWT claims matching the Express backend's token structure.
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    role: Option<String>,
    #[serde(rename = "employeeId")]
    employee_id: Option<i32>,
    exp: usize,
    iat: Option<usize>,
}

/// RPCs that skip authentication (public endpoints).
const PUBLIC_RPCS: &[&str] = &[
    "/svf.platform.v1.ConfigService/GetAppConfig",
    "/svf.auth.v1.AuthService/SendOtp",
    "/svf.auth.v1.AuthService/VerifyOtp",
    "/svf.auth.v1.AuthService/RefreshToken",
    "/svf.auth.v1.AuthService/Verify2FA",
    "/grpc.health.v1.Health/Check",
    "/grpc.health.v1.Health/Watch",
    "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
    "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
];

/// gRPC auth interceptor. Validates JWT Bearer tokens with dual-key support
/// and checks Redis for token blacklist / user invalidation.
#[derive(Clone)]
pub struct AuthInterceptor {
    jwt_secret: String,
    jwt_secret_previous: Option<String>,
    redis: MultiplexedConnection,
}

impl AuthInterceptor {
    pub fn new(
        jwt_secret: String,
        jwt_secret_previous: Option<String>,
        redis: MultiplexedConnection,
    ) -> Self {
        Self {
            jwt_secret,
            jwt_secret_previous,
            redis,
        }
    }

    /// Authenticate a raw HTTP request before tonic turns it into a typed request.
    pub async fn authenticate_http_request(
        &self,
        req: &mut HttpRequest<BoxBody>,
    ) -> Result<(), Status> {
        let method = req.uri().path().to_string();

        if is_public_rpc(&method) {
            rate_limit::enforce(&self.redis, &method, req.headers(), None).await?;
            return Ok(());
        }

        let token = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(extract_bearer_token)
            .ok_or_else(|| Status::unauthenticated("missing or invalid authorization header"))?;

        let user = self.verify_token(token).await?;
        rate_limit::enforce(&self.redis, &method, req.headers(), Some(&user)).await?;
        req.extensions_mut().insert(user);

        Ok(())
    }

    async fn verify_token(&self, token: &str) -> Result<VerifiedUser, Status> {
        let claims =
            decode_backend_claims(token, &self.jwt_secret, self.jwt_secret_previous.as_deref())?;

        self.check_redis_blacklist(token, &claims).await?;

        let user_id = claims.user_id()?;

        Ok(VerifiedUser {
            user_id: user_id.to_string(),
            role: claims.role.unwrap_or_else(|| "client".to_string()),
            employee_id: claims.employee_id,
        })
    }

    #[allow(dead_code)]
    fn decode_token(&self, token: &str, secret: &str) -> Result<Claims, Status> {
        decode_token_with_secret(token, secret)
    }

    async fn check_redis_blacklist(&self, token: &str, claims: &Claims) -> Result<(), Status> {
        let mut conn = self.redis.clone();

        let blacklisted: bool = redis::cmd("EXISTS")
            .arg(token_blacklist_key(token))
            .query_async(&mut conn)
            .await
            .unwrap_or(false);

        if blacklisted {
            return Err(Status::unauthenticated("token revoked"));
        }

        let invalidated_at: Option<String> = redis::cmd("GET")
            .arg(user_blacklist_key(claims.user_id()?))
            .query_async(&mut conn)
            .await
            .unwrap_or(None);

        if let Some(inv_str) = invalidated_at {
            if let (Ok(inv_ts), Some(iat)) = (inv_str.parse::<usize>(), claims.iat) {
                if iat <= inv_ts {
                    return Err(Status::unauthenticated("token invalidated"));
                }
            }
        }

        Ok(())
    }
}

impl Claims {
    fn user_id(&self) -> Result<&str, Status> {
        self.user_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| Status::unauthenticated("missing userId in token"))
    }
}

fn is_public_rpc(method: &str) -> bool {
    PUBLIC_RPCS
        .iter()
        .any(|rpc| method == *rpc || method.ends_with(*rpc))
}

fn extract_bearer_token(header: &str) -> Option<&str> {
    header
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
}

fn decode_backend_claims(
    token: &str,
    jwt_secret: &str,
    jwt_secret_previous: Option<&str>,
) -> Result<Claims, Status> {
    let kid = decode_header(token)
        .ok()
        .and_then(|header| header.kid)
        .unwrap_or_default();

    if kid == "previous" {
        if let Some(previous) = jwt_secret_previous {
            return decode_token_with_secret(token, previous);
        }
    }

    match decode_token_with_secret(token, jwt_secret) {
        Ok(claims) => Ok(claims),
        Err(status) if should_retry_with_previous(&status) => jwt_secret_previous
            .ok_or(status)
            .and_then(|previous| decode_token_with_secret(token, previous)),
        Err(status) => Err(status),
    }
}

fn decode_token_with_secret(token: &str, secret: &str) -> Result<Claims, Status> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;

    decode::<Claims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|e| {
            warn!(error = %e, "JWT decode failed");
            jwt_error_to_status(e.kind())
        })
}

fn jwt_error_to_status(kind: &ErrorKind) -> Status {
    match kind {
        ErrorKind::ExpiredSignature => Status::unauthenticated("token expired"),
        ErrorKind::ImmatureSignature => Status::unauthenticated("token not active yet"),
        _ => Status::unauthenticated("invalid token"),
    }
}

fn should_retry_with_previous(status: &Status) -> bool {
    let message = status.message();
    message != "token expired" && message != "token not active yet"
}

fn token_blacklist_key(token: &str) -> String {
    format!("bl:{}", hash_token(token))
}

fn user_blacklist_key(user_id: &str) -> String {
    format!("bl:user:{user_id}")
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn decodes_backend_user_id_uuid_claim() {
        let user_id = "8d033d7a-c5d4-4589-986f-167944747c09";
        let token = test_token(
            "current-secret",
            "current",
            json!({
                "userId": user_id,
                "email": "client@example.com",
                "role": "client",
                "iat": now() - 1,
                "exp": now() + 60,
            }),
        );

        let claims = decode_backend_claims(&token, "current-secret", None).unwrap();

        assert_eq!(claims.user_id().unwrap(), user_id);
        assert_eq!(claims.role.as_deref(), Some("client"));
    }

    #[test]
    fn supports_previous_secret_when_signature_rotated() {
        let token = test_token(
            "previous-secret",
            "previous",
            json!({
                "userId": "user-1",
                "role": "client",
                "iat": now() - 1,
                "exp": now() + 60,
            }),
        );

        let claims =
            decode_backend_claims(&token, "current-secret", Some("previous-secret")).unwrap();

        assert_eq!(claims.user_id().unwrap(), "user-1");
    }

    #[test]
    fn builds_backend_compatible_blacklist_keys() {
        assert_eq!(
            token_blacklist_key("access-token"),
            "bl:3f16bed7089f4653e5ef21bfd2824d7f3aaaecc7a598e7e89c580e1606a9cc52"
        );
        assert_eq!(user_blacklist_key("user-1"), "bl:user:user-1");
    }

    #[test]
    fn treats_health_config_auth_and_reflection_as_public() {
        for method in PUBLIC_RPCS {
            assert!(is_public_rpc(method), "{method} should be public");
        }
    }

    fn test_token(secret: &str, kid: &str, claims: serde_json::Value) -> String {
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid.to_string());
        encode(
            &header,
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    fn now() -> usize {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as usize
    }
}
