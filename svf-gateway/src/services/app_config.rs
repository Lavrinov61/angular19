use crate::bridge::ExpressBridge;
use crate::proto::svf::platform::v1::config_service_server::ConfigService;
use crate::proto::svf::platform::v1::*;
use std::collections::HashMap;
use tonic::{Request, Response, Status};

pub struct AppConfigServiceImpl {
    bridge: ExpressBridge,
}

impl AppConfigServiceImpl {
    pub fn new(bridge: ExpressBridge) -> Self {
        Self { bridge }
    }
}

#[tonic::async_trait]
impl ConfigService for AppConfigServiceImpl {
    async fn get_app_config(
        &self,
        request: Request<GetAppConfigRequest>,
    ) -> Result<Response<GetAppConfigResponse>, Status> {
        let platform = normalize_platform(&request.into_inner().platform)?;
        let path = format!("/api/app-config?platform={platform}");
        let val: serde_json::Value = self.bridge.proxy_get(&path, None).await?;

        Ok(Response::new(parse_app_config(envelope_data(&val))))
    }
}

fn normalize_platform(platform: &str) -> Result<&'static str, Status> {
    match platform.trim() {
        "" | "android" => Ok("android"),
        "ios" => Ok("ios"),
        _ => Err(Status::invalid_argument("platform must be android or ios")),
    }
}

fn envelope_data(val: &serde_json::Value) -> &serde_json::Value {
    val.get("data").unwrap_or(val)
}

fn parse_app_config(data: &serde_json::Value) -> GetAppConfigResponse {
    GetAppConfigResponse {
        api_version: json_string(data, &["api_version", "apiVersion"]),
        app_version: json_string(data, &["app_version", "appVersion"]),
        android: data.get("android").map(parse_android_config),
        maintenance: data.get("maintenance").map(parse_maintenance),
        endpoints: data.get("endpoints").map(parse_endpoints),
        features: json_bool_map(data.get("features")),
        auth_providers: json_string_array(data.get("auth_providers").or(data.get("authProviders"))),
        certificate_pins: json_string_array(
            data.get("certificate_pins").or(data.get("certificatePins")),
        ),
        rate_limits: data
            .get("rate_limits")
            .or(data.get("rateLimits"))
            .map(parse_rate_limits),
        upload: data.get("upload").map(parse_upload_limits),
    }
}

fn parse_android_config(data: &serde_json::Value) -> AndroidConfig {
    AndroidConfig {
        min_version: json_string(data, &["min_version", "minVersion"]),
        recommended_version: json_string(data, &["recommended_version", "recommendedVersion"]),
        store_urls: data
            .get("store_urls")
            .or(data.get("storeUrls"))
            .map(parse_store_urls),
    }
}

fn parse_store_urls(data: &serde_json::Value) -> StoreUrls {
    StoreUrls {
        google_play: json_string(data, &["google_play", "googlePlay"]),
        rustore: json_string(data, &["rustore"]),
        app_gallery: json_string(data, &["app_gallery", "appGallery"]),
    }
}

fn parse_maintenance(data: &serde_json::Value) -> Maintenance {
    Maintenance {
        enabled: data["enabled"].as_bool().unwrap_or(false),
        message: json_string(data, &["message"]),
        estimated_end: json_string(data, &["estimated_end", "estimatedEnd"]),
    }
}

fn parse_endpoints(data: &serde_json::Value) -> Endpoints {
    Endpoints {
        api: json_string(data, &["api"]),
        websocket: json_string(data, &["websocket"]),
        websocket_path: json_string(data, &["websocket_path", "websocketPath"]),
        grpc: json_string(data, &["grpc"]),
    }
}

fn parse_rate_limits(data: &serde_json::Value) -> RateLimits {
    RateLimits {
        api_per_15min: json_i32(data, &["api_per_15min", "apiPer15min"]),
        auth_per_15min: json_i32(data, &["auth_per_15min", "authPer15min"]),
        upload_per_15min: json_i32(data, &["upload_per_15min", "uploadPer15min"]),
    }
}

fn parse_upload_limits(data: &serde_json::Value) -> UploadLimits {
    UploadLimits {
        max_file_size_bytes: json_i64(data, &["max_file_size_bytes", "maxFileSizeBytes"]),
        allowed_mime_types: json_string_array(
            data.get("allowed_mime_types")
                .or(data.get("allowedMimeTypes")),
        ),
    }
}

fn json_bool_map(value: Option<&serde_json::Value>) -> HashMap<String, bool> {
    value
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, value)| value.as_bool().map(|enabled| (key.clone(), enabled)))
                .collect()
        })
        .unwrap_or_default()
}

fn json_string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn json_string(val: &serde_json::Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

fn json_i32(val: &serde_json::Value, keys: &[&str]) -> i32 {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|v| v.as_i64()))
        .unwrap_or(0) as i32
}

fn json_i64(val: &serde_json::Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|v| v.as_i64()))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_express_app_config_envelope() {
        let response = parse_app_config(&json!({
            "api_version": "1.0",
            "app_version": "2.3.4",
            "android": {
                "min_version": "1.0.0",
                "recommended_version": "1.1.0",
                "store_urls": {
                    "google_play": "gp",
                    "rustore": "rs",
                    "app_gallery": "ag"
                }
            },
            "maintenance": {
                "enabled": true,
                "message": "maintenance",
                "estimated_end": "2026-05-01T00:00:00Z"
            },
            "endpoints": {
                "api": "https://svoefoto.ru/api",
                "websocket": "wss://fmagnus.org",
                "websocket_path": "/socket.io/",
                "grpc": "grpc.svoefoto.ru:443"
            },
            "features": {
                "chat": true,
                "ignored": "yes"
            },
            "auth_providers": ["yandex", "phone"],
            "certificate_pins": ["pin"],
            "rate_limits": {
                "api_per_15min": 600,
                "auth_per_15min": 15,
                "upload_per_15min": 100
            },
            "upload": {
                "max_file_size_bytes": 10485760,
                "allowed_mime_types": ["image/jpeg", "image/png"]
            }
        }));

        assert_eq!(response.api_version, "1.0");
        assert_eq!(response.endpoints.unwrap().grpc, "grpc.svoefoto.ru:443");
        assert_eq!(response.features.get("chat"), Some(&true));
        assert!(!response.features.contains_key("ignored"));
        assert_eq!(response.upload.unwrap().allowed_mime_types.len(), 2);
    }

    #[test]
    fn rejects_unknown_platform() {
        assert!(normalize_platform("android").is_ok());
        assert!(normalize_platform("").is_ok());
        assert_eq!(
            normalize_platform("web").unwrap_err().code(),
            tonic::Code::InvalidArgument
        );
    }
}
