use crate::auth::VerifiedUser;
use crate::bridge::ExpressBridge;
use crate::proto::svf::media::v1::media_service_server::MediaService;
use crate::proto::svf::media::v1::*;
use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::presigning::PresigningConfig;
use serde_json::Value;
use std::time::Duration;
use tonic::{Request, Response, Status};
use tracing::info;

pub struct MediaServiceImpl {
    bridge: ExpressBridge,
    s3: S3Client,
    bucket: String,
    public_url: String,
}

impl MediaServiceImpl {
    pub fn new(bridge: ExpressBridge, s3: S3Client, bucket: String, public_url: String) -> Self {
        Self {
            bridge,
            s3,
            bucket,
            public_url,
        }
    }
}

#[tonic::async_trait]
impl MediaService for MediaServiceImpl {
    async fn get_thumbnail(
        &self,
        request: Request<GetThumbnailRequest>,
    ) -> Result<Response<GetThumbnailResponse>, Status> {
        let req = request.into_inner();
        // Phase 1: passthrough — return original URL
        Ok(Response::new(GetThumbnailResponse {
            thumbnail_url: req.url,
        }))
    }

    async fn get_signed_upload_url(
        &self,
        request: Request<GetSignedUploadUrlRequest>,
    ) -> Result<Response<GetSignedUploadUrlResponse>, Status> {
        let user = request
            .extensions()
            .get::<VerifiedUser>()
            .ok_or_else(|| Status::unauthenticated("no verified user"))?
            .clone();

        let req = request.into_inner();

        if !is_allowed_content_type(&req.content_type) {
            return Err(Status::invalid_argument(format!(
                "content type not allowed: {}",
                req.content_type
            )));
        }

        const MAX_SIZE: i64 = 150 * 1024 * 1024;
        if req.size_bytes > MAX_SIZE {
            return Err(Status::invalid_argument(format!(
                "file too large: {} bytes (max {MAX_SIZE})",
                req.size_bytes
            )));
        }

        let s3_key = format!("uploads/{}/{}/{}", user.user_id, req.purpose, req.file_name);

        let presign_config = PresigningConfig::builder()
            .expires_in(Duration::from_secs(3600))
            .build()
            .map_err(|e| Status::internal(format!("presigning config error: {e}")))?;

        let presigned = self
            .s3
            .put_object()
            .bucket(&self.bucket)
            .key(&s3_key)
            .content_type(&req.content_type)
            .content_length(req.size_bytes)
            .presigned(presign_config)
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "S3 presign PUT failed");
                Status::internal("failed to generate upload URL")
            })?;

        info!(
            user_id = user.user_id,
            key = %s3_key,
            "Generated presigned upload URL"
        );

        Ok(Response::new(GetSignedUploadUrlResponse {
            upload_url: presigned.uri().to_string(),
            result_url: s3_key,
            expires_in_seconds: 3600,
        }))
    }

    async fn get_signed_read_url(
        &self,
        request: Request<GetSignedReadUrlRequest>,
    ) -> Result<Response<GetSignedReadUrlResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();

        if !req.key.is_empty() {
            let response = self
                .resolve_signed_keys(jwt.as_deref(), vec![req.key])
                .await?;
            let first = response
                .items
                .into_iter()
                .next()
                .ok_or_else(|| Status::internal("upstream response missing signed url"))?;
            return Ok(Response::new(GetSignedReadUrlResponse {
                key: first.key,
                original_url: first.original_url,
                signed_url: first.signed_url,
                expires_in_seconds: response.expires_in_seconds,
            }));
        }

        if !req.url.is_empty() {
            let response = self
                .resolve_signed_urls(jwt.as_deref(), vec![req.url])
                .await?;
            let first = response
                .items
                .into_iter()
                .next()
                .ok_or_else(|| Status::internal("upstream response missing signed url"))?;
            return Ok(Response::new(GetSignedReadUrlResponse {
                key: first.key,
                original_url: first.original_url,
                signed_url: first.signed_url,
                expires_in_seconds: response.expires_in_seconds,
            }));
        }

        Err(Status::invalid_argument("key or url is required"))
    }

    async fn batch_get_signed_read_urls(
        &self,
        request: Request<BatchGetSignedReadUrlsRequest>,
    ) -> Result<Response<BatchGetSignedReadUrlsResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();

        let mut items = Vec::new();
        let mut expires_in_seconds = 0;

        if !req.keys.is_empty() {
            let response = self.resolve_signed_keys(jwt.as_deref(), req.keys).await?;
            expires_in_seconds = response.expires_in_seconds;
            items.extend(response.items);
        }

        if !req.urls.is_empty() {
            let response = self.resolve_signed_urls(jwt.as_deref(), req.urls).await?;
            if expires_in_seconds == 0 {
                expires_in_seconds = response.expires_in_seconds;
            }
            items.extend(response.items);
        }

        if items.is_empty() {
            return Err(Status::invalid_argument(
                "at least one key or url is required",
            ));
        }

        Ok(Response::new(BatchGetSignedReadUrlsResponse {
            items,
            expires_in_seconds,
        }))
    }
}

fn is_allowed_content_type(ct: &str) -> bool {
    matches!(
        ct,
        "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/heic"
            | "image/heif"
            | "video/mp4"
            | "video/quicktime"
            | "application/pdf"
            | "application/zip"
    )
}

impl MediaServiceImpl {
    async fn resolve_signed_keys(
        &self,
        jwt: Option<&str>,
        keys: Vec<String>,
    ) -> Result<BatchGetSignedReadUrlsResponse, Status> {
        let val: Value = self
            .bridge
            .proxy_json(
                "POST",
                "/api/media/signed/batch",
                Some(&serde_json::json!({ "keys": keys })),
                jwt,
            )
            .await?;
        let data = envelope_data(&val);
        let items = data["urls"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(parse_signed_read_url_from_key_result)
                    .collect()
            })
            .unwrap_or_default();

        Ok(BatchGetSignedReadUrlsResponse {
            items,
            expires_in_seconds: json_i32(data, &["expiresIn", "expires_in"]),
        })
    }

    async fn resolve_signed_urls(
        &self,
        jwt: Option<&str>,
        urls: Vec<String>,
    ) -> Result<BatchGetSignedReadUrlsResponse, Status> {
        let val: Value = self
            .bridge
            .proxy_json(
                "POST",
                "/api/media/signed/resolve",
                Some(&serde_json::json!({ "urls": urls })),
                jwt,
            )
            .await?;
        let data = envelope_data(&val);
        let items = data["resolved"]
            .as_object()
            .map(|map| {
                map.iter()
                    .map(|(original_url, signed_url)| SignedReadUrl {
                        key: self.key_from_public_url(original_url).unwrap_or_default(),
                        original_url: original_url.clone(),
                        signed_url: signed_url.as_str().unwrap_or("").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(BatchGetSignedReadUrlsResponse {
            items,
            expires_in_seconds: json_i32(data, &["expiresIn", "expires_in"]),
        })
    }

    fn key_from_public_url(&self, url: &str) -> Option<String> {
        let prefix = format!("{}/", self.public_url.trim_end_matches('/'));
        url.strip_prefix(&prefix).map(ToString::to_string)
    }
}

fn extract_jwt<T>(req: &Request<T>) -> Option<String> {
    req.metadata()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(String::from)
}

fn envelope_data(val: &Value) -> &Value {
    val.get("data").unwrap_or(val)
}

fn json_i32(val: &Value, keys: &[&str]) -> i32 {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|v| v.as_i64()))
        .unwrap_or(0) as i32
}

fn parse_signed_read_url_from_key_result(val: &Value) -> SignedReadUrl {
    SignedReadUrl {
        key: val
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        original_url: String::new(),
        signed_url: val
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::Client;

    fn test_service(public_url: &str) -> MediaServiceImpl {
        let config = aws_sdk_s3::Config::builder()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("ru-1"))
            .credentials_provider(aws_sdk_s3::config::Credentials::new(
                "key", "secret", None, None, "test",
            ))
            .endpoint_url("http://127.0.0.1:9000")
            .force_path_style(true)
            .build();

        MediaServiceImpl::new(
            ExpressBridge::new(Client::new(), "http://127.0.0.1:3001".to_string()),
            S3Client::from_conf(config),
            "bucket".to_string(),
            public_url.to_string(),
        )
    }

    #[test]
    fn extracts_key_from_public_url() {
        let service = test_service("https://cdn.example.com/media");

        assert_eq!(
            service.key_from_public_url("https://cdn.example.com/media/chat/file.jpg"),
            Some("chat/file.jpg".to_string())
        );
        assert_eq!(
            service.key_from_public_url("https://other.example.com/chat/file.jpg"),
            None
        );
    }

    #[test]
    fn parses_signed_read_url_from_key_result() {
        let item = parse_signed_read_url_from_key_result(&serde_json::json!({
            "key": "chat/file.jpg",
            "url": "https://signed.example.com/file"
        }));

        assert_eq!(item.key, "chat/file.jpg");
        assert_eq!(item.signed_url, "https://signed.example.com/file");
        assert!(item.original_url.is_empty());
    }
}
