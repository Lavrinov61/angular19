use crate::proto::svf::common::v1::ErrorDetail;
use crate::request_context::RequestContext;
use prost::Message;
use reqwest::Client;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tonic::{Code, Status};
use tracing::{Instrument, info_span, warn};

/// HTTP bridge to the Express API (:3001).
/// Phase 1: most gRPC RPCs proxy through here.
/// Phase 2+: native Rust implementations replace hot paths.
#[derive(Clone)]
pub struct ExpressBridge {
    client: Client,
    base_url: String,
    internal_auth_secret: Option<String>,
}

impl ExpressBridge {
    pub fn new(client: Client, base_url: String) -> Self {
        // Strip trailing slash for consistent URL building
        let base_url = base_url.trim_end_matches('/').to_string();
        Self {
            client,
            base_url,
            internal_auth_secret: None,
        }
    }

    pub fn with_internal_auth_secret(mut self, secret: Option<String>) -> Self {
        self.internal_auth_secret = secret.filter(|value| !value.is_empty());
        self
    }

    /// Proxy a unary gRPC call to Express as JSON POST/GET/PUT/DELETE.
    pub async fn proxy_json<Req, Resp>(
        &self,
        method: &str,
        path: &str,
        body: Option<&Req>,
        jwt: Option<&str>,
    ) -> Result<Resp, Status>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
        let span = info_span!("express_proxy", method, path);

        async {
            let mut req_builder = match method {
                "GET" => self.client.get(&url),
                "POST" => self.client.post(&url),
                "PUT" => self.client.put(&url),
                "PATCH" => self.client.patch(&url),
                "DELETE" => self.client.delete(&url),
                _ => return Err(Status::internal("unsupported HTTP method")),
            };

            if let Some(token) = jwt {
                req_builder = req_builder.header("Authorization", format!("Bearer {token}"));
            }

            if let Some(secret) = &self.internal_auth_secret {
                req_builder = req_builder.header("X-SVF-Mobile-GRPC-Secret", secret);
            }

            if let Some(context) = RequestContext::current() {
                req_builder = context.apply_reqwest_headers(req_builder);
            }

            if let Some(body) = body {
                req_builder = req_builder.json(body);
            }

            let response = req_builder.send().await.map_err(|e| {
                warn!(error = %e, "Express proxy request failed");
                Status::unavailable("upstream service unavailable")
            })?;

            let status = response.status();

            if !status.is_success() {
                let body_text = response.text().await.unwrap_or_default();
                warn!(
                    http_status = status.as_u16(),
                    body = %body_text,
                    "Express returned error"
                );
                return Err(express_status_to_grpc(status.as_u16(), &body_text));
            }

            response.json::<Resp>().await.map_err(|e| {
                warn!(error = %e, "Failed to deserialize Express response");
                Status::internal("failed to parse upstream response")
            })
        }
        .instrument(span)
        .await
    }

    /// Proxy a GET request without a body.
    pub async fn proxy_get<Resp>(&self, path: &str, jwt: Option<&str>) -> Result<Resp, Status>
    where
        Resp: DeserializeOwned,
    {
        self.proxy_json::<(), Resp>("GET", path, None, jwt).await
    }
}

/// Map HTTP status codes to gRPC status codes.
fn express_status_to_grpc(http_status: u16, body: &str) -> Status {
    let code = match http_status {
        400 | 422 => Code::InvalidArgument,
        401 => Code::Unauthenticated,
        403 => Code::PermissionDenied,
        404 => Code::NotFound,
        409 => Code::AlreadyExists,
        429 => Code::ResourceExhausted,
        500 => Code::Internal,
        502 | 503 | 504 => Code::Unavailable,
        _ => Code::Unknown,
    };
    let detail = error_detail_from_body(http_status, body);
    let message = if detail.message.is_empty() {
        format!("HTTP {http_status}")
    } else {
        detail.message.clone()
    };

    Status::with_details(code, message, detail.encode_to_vec().into())
}

fn error_detail_from_body(http_status: u16, body: &str) -> ErrorDetail {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| json_string(value, &["error", "message"]))
        .or_else(|| non_empty(body.trim()).map(ToString::to_string))
        .unwrap_or_else(|| format!("HTTP {http_status}"));

    ErrorDetail {
        code: parsed
            .as_ref()
            .and_then(|value| json_string(value, &["code"]))
            .unwrap_or_else(|| default_error_code(http_status).to_string()),
        message,
        fields: parsed
            .as_ref()
            .and_then(|value| value.get("fields").or_else(|| value.get("errors")))
            .and_then(|value| value.as_object())
            .map(|fields| {
                fields
                    .iter()
                    .filter_map(|(key, value)| {
                        value_to_string(value).map(|value| (key.clone(), value))
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn default_error_code(http_status: u16) -> &'static str {
    match http_status {
        400 | 422 => "VALIDATION_ERROR",
        401 => "UNAUTHENTICATED",
        403 => "FORBIDDEN",
        404 => "NOT_FOUND",
        409 => "ALREADY_EXISTS",
        429 => "RATE_LIMITED",
        500 => "INTERNAL_ERROR",
        502 | 503 | 504 => "UPSTREAM_UNAVAILABLE",
        _ => "UNKNOWN",
    }
}

fn json_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(value_to_string))
        .and_then(|value| non_empty(&value).map(ToString::to_string))
}

fn value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    if value.is_empty() { None } else { Some(value) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_app_error_body_to_grpc_detail() {
        let status = express_status_to_grpc(
            400,
            r#"{"success":false,"error":"phone required","code":"PHONE_INVALID"}"#,
        );
        let detail = ErrorDetail::decode(status.details()).unwrap();

        assert_eq!(status.code(), Code::InvalidArgument);
        assert_eq!(status.message(), "phone required");
        assert_eq!(detail.code, "PHONE_INVALID");
        assert_eq!(detail.message, "phone required");
    }

    #[test]
    fn maps_plain_error_body_to_default_detail() {
        let status = express_status_to_grpc(429, "too many requests");
        let detail = ErrorDetail::decode(status.details()).unwrap();

        assert_eq!(status.code(), Code::ResourceExhausted);
        assert_eq!(detail.code, "RATE_LIMITED");
        assert_eq!(detail.message, "too many requests");
    }

    #[test]
    fn carries_field_errors_when_present() {
        let detail = error_detail_from_body(
            422,
            r#"{"error":"invalid","fields":{"phone":"required","attempts":3}}"#,
        );

        assert_eq!(detail.fields.get("phone"), Some(&"required".to_string()));
        assert_eq!(detail.fields.get("attempts"), Some(&"3".to_string()));
    }
}
