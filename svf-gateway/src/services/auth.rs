use crate::auth::VerifiedUser;
use crate::bridge::ExpressBridge;
use crate::proto::svf::auth::v1::auth_service_server::AuthService;
use crate::proto::svf::auth::v1::*;
use tonic::{Request, Response, Status};
use tracing::info;

pub struct AuthServiceImpl {
    bridge: ExpressBridge,
    phone_auth_bridge: ExpressBridge,
    redis: redis::aio::MultiplexedConnection,
}

impl AuthServiceImpl {
    pub fn new(
        bridge: ExpressBridge,
        phone_auth_bridge: ExpressBridge,
        redis: redis::aio::MultiplexedConnection,
    ) -> Self {
        Self {
            bridge,
            phone_auth_bridge,
            redis,
        }
    }
}

#[tonic::async_trait]
impl AuthService for AuthServiceImpl {
    async fn send_otp(
        &self,
        request: Request<SendOtpRequest>,
    ) -> Result<Response<SendOtpResponse>, Status> {
        let req = request.into_inner();
        let val: serde_json::Value = self
            .phone_auth_bridge
            .proxy_json(
                "POST",
                "/api/auth/phone-code",
                Some(&serde_json::json!({
                    "phone": req.phone,
                    "fingerprintVisitorId": req.device_id,
                })),
                None,
            )
            .await?;
        let data = envelope_data(&val);
        Ok(Response::new(SendOtpResponse {
            success: val["success"].as_bool().unwrap_or(false),
            retry_after_seconds: data["expiresIn"].as_i64().unwrap_or(0) as i32,
            message: data["provider"]
                .as_str()
                .or(val["message"].as_str())
                .unwrap_or("")
                .to_string(),
        }))
    }

    async fn verify_otp(
        &self,
        request: Request<VerifyOtpRequest>,
    ) -> Result<Response<VerifyOtpResponse>, Status> {
        let req = request.into_inner();
        let body = verify_otp_request_body(req);
        let val: serde_json::Value = self
            .phone_auth_bridge
            .proxy_json("POST", "/api/auth/phone-verify", Some(&body), None)
            .await?;
        Ok(Response::new(parse_verify_otp_response(envelope_data(
            &val,
        ))?))
    }

    async fn refresh_token(
        &self,
        request: Request<RefreshTokenRequest>,
    ) -> Result<Response<RefreshTokenResponse>, Status> {
        let req = request.into_inner();
        let val: serde_json::Value = self
            .bridge
            .proxy_json(
                "POST",
                "/api/auth/refresh",
                Some(&serde_json::json!({ "refreshToken": req.refresh_token })),
                None,
            )
            .await?;
        Ok(Response::new(RefreshTokenResponse {
            tokens: Some(parse_auth_tokens(envelope_data(&val))),
        }))
    }

    async fn logout(
        &self,
        request: Request<LogoutRequest>,
    ) -> Result<Response<LogoutResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let val: serde_json::Value = self
            .bridge
            .proxy_json(
                "POST",
                "/api/auth/logout",
                Some(&serde_json::json!({ "refreshToken": req.refresh_token })),
                jwt.as_deref(),
            )
            .await?;
        Ok(Response::new(LogoutResponse {
            success: val["success"].as_bool().unwrap_or(true),
        }))
    }

    async fn get_me(
        &self,
        request: Request<GetMeRequest>,
    ) -> Result<Response<GetMeResponse>, Status> {
        let user = request
            .extensions()
            .get::<VerifiedUser>()
            .ok_or_else(|| Status::unauthenticated("no verified user"))?
            .clone();

        let cache_key = format!("user:profile:{}", user.user_id);
        let mut conn = self.redis.clone();

        // Try Redis cache
        let cached: Option<String> = redis::cmd("GET")
            .arg(&cache_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(None);

        if let Some(json_str) = cached {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                return Ok(Response::new(GetMeResponse {
                    user: Some(parse_user_profile(envelope_data(&val))),
                }));
            }
        }

        // Cache miss — proxy to Express
        let jwt = extract_jwt(&request);
        let val: serde_json::Value = self
            .bridge
            .proxy_get("/api/auth/me", jwt.as_deref())
            .await?;

        // Cache 5 min
        let data = envelope_data(&val);
        if let Ok(json_str) = serde_json::to_string(data) {
            let _ = redis::cmd("SETEX")
                .arg(&cache_key)
                .arg(300)
                .arg(&json_str)
                .query_async::<()>(&mut conn)
                .await;
        }

        info!(user_id = %user.user_id, "GetMe cache miss");
        Ok(Response::new(GetMeResponse {
            user: Some(parse_user_profile(data)),
        }))
    }

    async fn verify2_fa(
        &self,
        request: Request<Verify2FaRequest>,
    ) -> Result<Response<Verify2FaResponse>, Status> {
        let req = request.into_inner();
        let val: serde_json::Value = self
            .bridge
            .proxy_json(
                "POST",
                "/api/auth/verify-2fa",
                Some(&serde_json::json!({
                    "tempToken": req.temp_token,
                    "code": req.code,
                })),
                None,
            )
            .await?;
        Ok(Response::new(Verify2FaResponse {
            tokens: Some(parse_auth_tokens(envelope_data(&val))),
        }))
    }
}

fn extract_jwt<T>(req: &Request<T>) -> Option<String> {
    req.metadata()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(String::from)
}

fn envelope_data(val: &serde_json::Value) -> &serde_json::Value {
    val.get("data").unwrap_or(val)
}

fn verify_otp_request_body(req: VerifyOtpRequest) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    body.insert("phone".to_string(), serde_json::Value::String(req.phone));
    body.insert("code".to_string(), serde_json::Value::String(req.code));
    body.insert(
        "fingerprintVisitorId".to_string(),
        serde_json::Value::String(req.device_id),
    );

    if let Some(profile) = req.profile {
        let mut profile_body = serde_json::Map::new();
        profile_body.insert(
            "displayName".to_string(),
            serde_json::Value::String(profile.display_name),
        );
        if !profile.date_of_birth.is_empty() {
            profile_body.insert(
                "dateOfBirth".to_string(),
                serde_json::Value::String(profile.date_of_birth),
            );
        }
        body.insert(
            "profile".to_string(),
            serde_json::Value::Object(profile_body),
        );
    }

    serde_json::Value::Object(body)
}

fn parse_verify_otp_response(data: &serde_json::Value) -> Result<VerifyOtpResponse, Status> {
    let requires_profile =
        json_bool(data, &["requiresProfile", "requires_profile"]).unwrap_or(false);
    let tokens = if requires_profile {
        None
    } else if has_auth_token_payload(data) {
        Some(parse_auth_tokens(data))
    } else {
        return Err(Status::internal(
            "phone verify response missing auth tokens",
        ));
    };

    Ok(VerifyOtpResponse {
        tokens,
        requires_profile,
        is_new_user: json_bool(data, &["isNewUser", "is_new_user"]).unwrap_or(false),
        phone: json_str(data, &["phone"]).unwrap_or_default(),
    })
}

fn has_auth_token_payload(val: &serde_json::Value) -> bool {
    json_str(val, &["accessToken", "access_token"]).is_some()
        && json_str(val, &["refreshToken", "refresh_token"]).is_some()
}

fn parse_auth_tokens(val: &serde_json::Value) -> AuthTokens {
    AuthTokens {
        access_token: json_str(val, &["accessToken", "access_token"]).unwrap_or_default(),
        refresh_token: json_str(val, &["refreshToken", "refresh_token"]).unwrap_or_default(),
        user: val.get("user").map(parse_user_profile),
        requires_two_factor: json_bool(val, &["requiresTwoFactor", "requires_two_factor"])
            .unwrap_or(false),
        temp_token: json_str(val, &["tempToken", "temp_token"]).unwrap_or_default(),
    }
}

fn json_bool(val: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|value| value.as_bool()))
}

fn json_str(val: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|value| value.as_str()))
        .map(ToString::to_string)
        .filter(|value| !value.is_empty())
}

fn parse_user_profile(val: &serde_json::Value) -> UserProfile {
    UserProfile {
        id: val["id"].to_string().trim_matches('"').to_string(),
        email: val["email"].as_str().unwrap_or("").to_string(),
        display_name: val["displayName"]
            .as_str()
            .or(val["display_name"].as_str())
            .or(val["name"].as_str())
            .unwrap_or("")
            .to_string(),
        phone: val["phone"].as_str().unwrap_or("").to_string(),
        role: val["role"].as_str().unwrap_or("client").to_string(),
        photo_url: val["photoUrl"]
            .as_str()
            .or(val["photo_url"].as_str())
            .or(val["avatarUrl"].as_str())
            .unwrap_or("")
            .to_string(),
        email_verified: val["emailVerified"]
            .as_bool()
            .or(val["email_verified"].as_bool())
            .unwrap_or(false),
        two_factor_enabled: val["twoFactorEnabled"]
            .as_bool()
            .or(val["two_factor_enabled"].as_bool())
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_requires_profile_verify_response_without_empty_tokens() {
        let response = parse_verify_otp_response(&serde_json::json!({
            "requiresProfile": true,
            "isNewUser": true,
            "phone": "79001234567",
        }))
        .expect("requires-profile response maps");

        assert!(response.tokens.is_none());
        assert!(response.requires_profile);
        assert!(response.is_new_user);
        assert_eq!(response.phone, "79001234567");
    }

    #[test]
    fn maps_token_verify_response() {
        let response = parse_verify_otp_response(&serde_json::json!({
            "accessToken": "access-token",
            "refreshToken": "refresh-token",
            "isNewUser": false,
            "user": {
                "id": "user-1",
                "displayName": "Mobile User",
                "phone": "79001234567",
                "role": "client"
            }
        }))
        .expect("token response maps");

        let tokens = response.tokens.expect("tokens are present");
        assert!(!response.requires_profile);
        assert_eq!(tokens.access_token, "access-token");
        assert_eq!(tokens.refresh_token, "refresh-token");
        assert_eq!(
            tokens.user.expect("user is present").display_name,
            "Mobile User"
        );
    }

    #[test]
    fn rejects_verify_response_without_tokens_or_profile_requirement() {
        let status = parse_verify_otp_response(&serde_json::json!({
            "isNewUser": false
        }))
        .expect_err("missing token response is invalid");

        assert_eq!(status.code(), tonic::Code::Internal);
    }

    #[test]
    fn verify_request_body_includes_profile_when_present() {
        let body = verify_otp_request_body(VerifyOtpRequest {
            phone: "79001234567".to_string(),
            code: "1234".to_string(),
            device_id: "android-installation-id".to_string(),
            device_name: "Pixel".to_string(),
            profile: Some(PhoneAuthProfile {
                display_name: "Mobile User".to_string(),
                date_of_birth: "1990-05-20".to_string(),
            }),
        });

        assert_eq!(
            body,
            serde_json::json!({
                "phone": "79001234567",
                "code": "1234",
                "fingerprintVisitorId": "android-installation-id",
                "profile": {
                    "displayName": "Mobile User",
                    "dateOfBirth": "1990-05-20"
                }
            })
        );
    }
}
