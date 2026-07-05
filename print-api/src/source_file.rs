use std::path::{Path, PathBuf};

use crate::config::{Config, ConversionConfig};
use crate::error::{AppError, Result};

const MEDIA_PATH_PREFIX: &str = "/media/";
const PUBLIC_MEDIA_HOSTS: &[&str] = &["svoefoto.ru", "ws.svoefoto.ru"];

pub fn public_media_key(file_url: &str) -> Option<String> {
    let parsed = url::Url::parse(file_url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if !PUBLIC_MEDIA_HOSTS.iter().any(|allowed| host == *allowed) {
        return None;
    }

    let key = parsed.path().strip_prefix(MEDIA_PATH_PREFIX)?;
    if !is_valid_media_key(key) {
        return None;
    }

    Some(key.to_string())
}

pub async fn read_source_bytes(
    config: &Config,
    client: &reqwest::Client,
    file_url: &str,
    max_size: u64,
    kind: &str,
) -> Result<Vec<u8>> {
    read_source_bytes_for_conversion(config.conversion.as_ref(), client, file_url, max_size, kind)
        .await
}

pub async fn read_source_bytes_for_conversion(
    conversion: Option<&ConversionConfig>,
    client: &reqwest::Client,
    file_url: &str,
    max_size: u64,
    kind: &str,
) -> Result<Vec<u8>> {
    if let Some(conversion) = conversion
        && let Some(key) = public_media_key(file_url)
    {
        match read_s3_object_bytes(conversion, &key, max_size, kind).await {
            Ok(bytes) => return Ok(bytes),
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    key,
                    "Direct media source read failed, falling back to public URL"
                );
            }
        }
    }

    read_http_source_bytes(client, file_url, max_size, kind).await
}

pub async fn write_source_file(
    config: &Config,
    client: &reqwest::Client,
    file_url: &str,
    dest: &Path,
    max_size: u64,
    kind: &str,
) -> Result<()> {
    write_source_file_for_conversion(
        config.conversion.as_ref(),
        client,
        file_url,
        dest,
        max_size,
        kind,
    )
    .await
}

pub async fn write_source_file_for_conversion(
    conversion: Option<&ConversionConfig>,
    client: &reqwest::Client,
    file_url: &str,
    dest: &Path,
    max_size: u64,
    kind: &str,
) -> Result<()> {
    let bytes =
        read_source_bytes_for_conversion(conversion, client, file_url, max_size, kind).await?;
    tokio::fs::write(dest, &bytes)
        .await
        .map_err(|e| AppError::internal(format!("Source file write failed: {e}")))?;
    Ok(())
}

pub async fn write_source_temp_file(
    config: &Config,
    client: &reqwest::Client,
    file_url: &str,
    temp_dir: &str,
    max_size: u64,
    kind: &str,
) -> Result<PathBuf> {
    write_source_temp_file_for_conversion(
        config.conversion.as_ref(),
        client,
        file_url,
        temp_dir,
        max_size,
        kind,
    )
    .await
}

pub async fn write_source_temp_file_for_conversion(
    conversion: Option<&ConversionConfig>,
    client: &reqwest::Client,
    file_url: &str,
    temp_dir: &str,
    max_size: u64,
    kind: &str,
) -> Result<PathBuf> {
    let bytes =
        read_source_bytes_for_conversion(conversion, client, file_url, max_size, kind).await?;
    let ext = safe_source_extension(file_url, "bin");
    let path = Path::new(temp_dir).join(format!("source_{}.{}", uuid::Uuid::new_v4(), ext));
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::internal(format!("Source temp file write failed: {e}")))?;
    Ok(path)
}

fn is_valid_media_key(key: &str) -> bool {
    !key.is_empty() && !key.starts_with('/') && !key.contains("..") && !key.contains('\0')
}

fn safe_source_extension(file_url: &str, fallback: &str) -> String {
    let path = url::Url::parse(file_url)
        .ok()
        .map(|url| url.path().to_string())
        .unwrap_or_else(|| file_url.to_string());
    let Some(ext) = Path::new(&path)
        .extension()
        .and_then(|value| value.to_str())
    else {
        return fallback.to_string();
    };
    let ext = ext.to_ascii_lowercase();
    if ext.len() <= 10 && ext.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        ext
    } else {
        fallback.to_string()
    }
}

async fn read_s3_object_bytes(
    config: &ConversionConfig,
    key: &str,
    max_size: u64,
    kind: &str,
) -> Result<Vec<u8>> {
    let creds = aws_sdk_s3::config::Credentials::new(
        &config.s3_access_key,
        &config.s3_secret_key,
        None,
        None,
        "print-api-source-file",
    );

    let s3_config = aws_sdk_s3::Config::builder()
        .region(aws_sdk_s3::config::Region::new(config.s3_region.clone()))
        .endpoint_url(&config.s3_endpoint)
        .credentials_provider(creds)
        .force_path_style(true)
        .http_client(crate::s3_client::no_proxy_http_client())
        .request_checksum_calculation(aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired)
        .behavior_version_latest()
        .build();

    let client = aws_sdk_s3::Client::from_conf(s3_config);
    let object = client
        .get_object()
        .bucket(&config.s3_bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| {
            AppError::bad_request(format!("Не удалось прочитать {kind} из хранилища: {e}"))
        })?;

    if let Some(len) = object.content_length()
        && len > max_size as i64
    {
        return Err(AppError::bad_request(format!("{kind} слишком большой")));
    }

    let bytes = object
        .body
        .collect()
        .await
        .map_err(|e| AppError::internal(format!("Ошибка чтения {kind} из хранилища: {e}")))?
        .into_bytes();

    if bytes.len() as u64 > max_size {
        return Err(AppError::bad_request(format!("{kind} слишком большой")));
    }

    Ok(bytes.to_vec())
}

async fn read_http_source_bytes(
    client: &reqwest::Client,
    file_url: &str,
    max_size: u64,
    kind: &str,
) -> Result<Vec<u8>> {
    let response = client
        .get(file_url)
        .send()
        .await
        .map_err(|e| AppError::bad_request(format!("Не удалось скачать {kind}: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::bad_request(format!(
            "Не удалось скачать {kind}: HTTP {}",
            response.status(),
        )));
    }
    if let Some(len) = response.content_length()
        && len > max_size
    {
        return Err(AppError::bad_request(format!("{kind} слишком большой")));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::bad_request(format!("Ошибка чтения {kind}: {e}")))?;
    if bytes.len() as u64 > max_size {
        return Err(AppError::bad_request(format!("{kind} слишком большой")));
    }

    Ok(bytes.to_vec())
}
