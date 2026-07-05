use reqwest::RequestBuilder;
use std::future::Future;
use tonic::body::BoxBody;
use tonic::codegen::http::header::HeaderValue;
use tonic::codegen::http::{HeaderMap, Request as HttpRequest, Response as HttpResponse};
use tracing::Span;
use uuid::Uuid;

const REQUEST_ID_HEADER: &str = "x-request-id";
const CORRELATION_ID_HEADER: &str = "x-correlation-id";
const TRACEPARENT_HEADER: &str = "traceparent";
const MAX_ID_LEN: usize = 128;
const MAX_TRACEPARENT_LEN: usize = 256;

tokio::task_local! {
    static CURRENT_REQUEST_CONTEXT: RequestContext;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestContext {
    pub request_id: String,
    pub correlation_id: String,
    pub traceparent: Option<String>,
    pub grpc_method: String,
}

impl RequestContext {
    pub fn from_http_request(req: &HttpRequest<BoxBody>) -> Self {
        let request_id = header_value(req.headers(), REQUEST_ID_HEADER, MAX_ID_LEN)
            .or_else(|| header_value(req.headers(), CORRELATION_ID_HEADER, MAX_ID_LEN))
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let correlation_id = header_value(req.headers(), CORRELATION_ID_HEADER, MAX_ID_LEN)
            .unwrap_or_else(|| request_id.clone());

        let traceparent = header_value(req.headers(), TRACEPARENT_HEADER, MAX_TRACEPARENT_LEN);

        Self {
            request_id,
            correlation_id,
            traceparent,
            grpc_method: req.uri().path().to_string(),
        }
    }

    pub fn current() -> Option<Self> {
        CURRENT_REQUEST_CONTEXT.try_with(Clone::clone).ok()
    }

    pub async fn scope<F>(self, future: F) -> F::Output
    where
        F: Future,
    {
        CURRENT_REQUEST_CONTEXT.scope(self, future).await
    }

    pub fn span(&self) -> Span {
        tracing::info_span!(
            "grpc_request",
            grpc_method = %self.grpc_method,
            request_id = %self.request_id,
            correlation_id = %self.correlation_id,
            traceparent = self.traceparent.as_deref().unwrap_or("")
        )
    }

    pub fn insert_response_headers(&self, response: &mut HttpResponse<BoxBody>) {
        insert_header(response.headers_mut(), REQUEST_ID_HEADER, &self.request_id);
        insert_header(
            response.headers_mut(),
            CORRELATION_ID_HEADER,
            &self.correlation_id,
        );
    }

    pub fn apply_reqwest_headers(&self, builder: RequestBuilder) -> RequestBuilder {
        let builder = builder
            .header("X-Request-Id", &self.request_id)
            .header("X-Correlation-Id", &self.correlation_id);

        if let Some(traceparent) = &self.traceparent {
            builder.header("traceparent", traceparent)
        } else {
            builder
        }
    }
}

fn header_value(headers: &HeaderMap, name: &'static str, max_len: usize) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| sanitize_header_value(value, max_len))
}

fn sanitize_header_value(value: &str, max_len: usize) -> Option<String> {
    let value = value.trim();

    if value.is_empty() || value.len() > max_len {
        return None;
    }

    if value
        .bytes()
        .all(|byte| matches!(byte, b'!'..=b'~') && byte != b',' && byte != b';')
    {
        Some(value.to_string())
    } else {
        None
    }
}

fn insert_header(headers: &mut HeaderMap, name: &'static str, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        headers.insert(name, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tonic::body::empty_body;
    use tonic::codegen::http::Request;

    #[test]
    fn uses_incoming_request_id_and_trace_context() {
        let request = Request::builder()
            .uri("/svf.platform.v1.ConfigService/GetAppConfig")
            .header("x-request-id", "req-123")
            .header("x-correlation-id", "corr-456")
            .header(
                "traceparent",
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            )
            .body(empty_body())
            .unwrap();

        let context = RequestContext::from_http_request(&request);

        assert_eq!(context.request_id, "req-123");
        assert_eq!(context.correlation_id, "corr-456");
        assert_eq!(
            context.traceparent.as_deref(),
            Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        );
        assert_eq!(
            context.grpc_method,
            "/svf.platform.v1.ConfigService/GetAppConfig"
        );
    }

    #[test]
    fn falls_back_to_generated_request_id() {
        let request = Request::builder()
            .uri("/grpc.health.v1.Health/Check")
            .body(empty_body())
            .unwrap();

        let context = RequestContext::from_http_request(&request);

        assert!(!context.request_id.is_empty());
        assert_eq!(context.correlation_id, context.request_id);
        assert_eq!(context.traceparent, None);
    }

    #[test]
    fn rejects_unsafe_header_values() {
        let request = Request::builder()
            .uri("/grpc.health.v1.Health/Check")
            .header("x-request-id", "bad,value")
            .header("x-correlation-id", "corr;bad")
            .body(empty_body())
            .unwrap();

        let context = RequestContext::from_http_request(&request);

        assert_ne!(context.request_id, "bad,value");
        assert_eq!(context.correlation_id, context.request_id);
    }

    #[test]
    fn inserts_response_headers() {
        let context = RequestContext {
            request_id: "req-123".to_string(),
            correlation_id: "corr-456".to_string(),
            traceparent: None,
            grpc_method: "/grpc.health.v1.Health/Check".to_string(),
        };
        let mut response = HttpResponse::new(empty_body());

        context.insert_response_headers(&mut response);

        assert_eq!(response.headers()["x-request-id"], "req-123");
        assert_eq!(response.headers()["x-correlation-id"], "corr-456");
    }

    #[test]
    fn applies_outbound_reqwest_headers() {
        let context = RequestContext {
            request_id: "req-123".to_string(),
            correlation_id: "corr-456".to_string(),
            traceparent: Some(
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_string(),
            ),
            grpc_method: "/svf.chat.v1.ChatService/GetCurrentSession".to_string(),
        };
        let request = context
            .apply_reqwest_headers(reqwest::Client::new().get("http://127.0.0.1/test"))
            .build()
            .unwrap();

        assert_eq!(request.headers()["x-request-id"], "req-123");
        assert_eq!(request.headers()["x-correlation-id"], "corr-456");
        assert_eq!(
            request.headers()["traceparent"],
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        );
    }
}
