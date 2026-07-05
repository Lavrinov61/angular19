use axum::{
    Json,
    extract::{Multipart, State},
};
use chrono::{Datelike, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::AppState;
use crate::config::ConversionConfig;
use crate::conversion::detect::{DocumentType, detect_file_type};
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;

const MAX_PRINT_UPLOAD_BYTES: usize = 200 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "pdf", "doc", "docx", "docm", "dot",
    "dotx", "dotm", "rtf", "odt", "ott", "xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm",
    "ods", "ots", "ppt", "pptx", "pptm", "pps", "ppsx", "ppsm", "pot", "potx", "potm", "odp",
    "otp", "txt", "log", "csv", "tsv",
];

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadedFileKind {
    Image,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FastPrintPipeline {
    Photo,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendedPrinterKind {
    Inkjet,
    Laser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrintAssetSource {
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum PrintPreparationStatus {
    Queued,
    Processing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FastPrintProfile {
    pub pipeline: FastPrintPipeline,
    pub max_format: &'static str,
    pub recommended_printer_kind: RecommendedPrinterKind,
    pub coverage_required: bool,
    pub coverage_required_on_laser: bool,
}

#[derive(Debug, Serialize)]
pub struct PrintAsset {
    pub id: String,
    pub source: PrintAssetSource,
    pub source_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub storage_url: String,
    pub storage_key: String,
    pub document_type: String,
    pub kind: UploadedFileKind,
    pub pipeline: FastPrintPipeline,
    pub max_format: &'static str,
}

#[derive(Debug, Serialize)]
pub struct PrintPreparation {
    pub asset_id: String,
    pub status: PrintPreparationStatus,
    pub detected_format: &'static str,
    pub page_count: Option<u32>,
    pub preview_url: Option<String>,
    pub coverage_percentages: Option<Vec<f64>>,
    pub coverage_required_on_laser: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadedPrintFile {
    pub asset_id: String,
    pub sha256: String,
    pub url: String,
    pub key: String,
    pub file_name: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub document_type: String,
    pub kind: UploadedFileKind,
    pub fast_profile: FastPrintProfile,
    pub asset: PrintAsset,
    pub preparation: PrintPreparation,
}

#[derive(Debug, Serialize)]
pub struct UploadPrintFileResponse {
    pub success: bool,
    pub file: UploadedPrintFile,
}

pub async fn upload(
    State(state): State<AppState>,
    _claims: Claims,
    mut multipart: Multipart,
) -> Result<Json<UploadPrintFileResponse>> {
    let config = state
        .config
        .conversion
        .clone()
        .ok_or_else(|| AppError::service_unavailable("Загрузка файлов печати не настроена"))?;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(format!("Некорректная multipart-загрузка: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let original_name = field
            .file_name()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("print-upload")
            .to_string();
        let extension = safe_extension(&original_name)?;
        let content_type = normalize_content_type(field.content_type(), &extension);
        let document_type = detect_file_type(&format!("source.{extension}"));
        let kind = if document_type.is_document() {
            UploadedFileKind::Document
        } else {
            UploadedFileKind::Image
        };

        validate_extension_and_content_type(&extension, &content_type, kind)?;

        let body = read_field_bytes(&mut field).await?;
        if body.is_empty() {
            return Err(AppError::bad_request("Файл пустой"));
        }
        let size_bytes = body.len() as u64;
        let sha256 = sha256_hex(&body);
        let asset_id = Uuid::new_v4().to_string();

        let s3_key = upload_key(&original_name, &extension);
        upload_to_s3_bytes(&config, body, &s3_key, &content_type).await?;

        let url = format!("{}/{}", config.s3_public_url.trim_end_matches('/'), s3_key);
        let fast_profile = fast_print_profile(kind);
        let document_type_name = document_type_name(document_type).to_string();
        let asset = print_asset_from_upload(PrintAssetFromUpload {
            asset_id: &asset_id,
            source_id: &s3_key,
            name: &original_name,
            mime_type: &content_type,
            size_bytes,
            sha256: &sha256,
            storage_url: &url,
            storage_key: &s3_key,
            document_type: &document_type_name,
            kind,
            fast_profile,
        });
        let preparation = ready_preparation(&asset_id, fast_profile);
        let file = UploadedPrintFile {
            asset_id,
            sha256,
            url,
            key: s3_key,
            file_name: original_name,
            content_type,
            size_bytes,
            document_type: document_type_name,
            kind,
            fast_profile,
            asset,
            preparation,
        };

        return Ok(Json(UploadPrintFileResponse {
            success: true,
            file,
        }));
    }

    Err(AppError::bad_request("Поле file не найдено"))
}

async fn read_field_bytes(field: &mut axum::extract::multipart::Field<'_>) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|e| AppError::bad_request(format!("Не удалось прочитать файл: {e}")))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PRINT_UPLOAD_BYTES {
            return Err(AppError::bad_request("Файл больше допустимых 200 МБ"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn upload_to_s3_bytes(
    config: &ConversionConfig,
    body: Vec<u8>,
    s3_key: &str,
    content_type: &str,
) -> Result<()> {
    let content_length = body.len() as i64;
    let creds = aws_sdk_s3::config::Credentials::new(
        &config.s3_access_key,
        &config.s3_secret_key,
        None,
        None,
        "print-api-upload",
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
    client
        .put_object()
        .bucket(&config.s3_bucket)
        .key(s3_key)
        .body(aws_sdk_s3::primitives::ByteStream::from(body))
        .content_length(content_length)
        .content_type(content_type)
        .cache_control("private, max-age=0, no-store")
        .send()
        .await
        .map_err(|e| {
            tracing::error!(
                error = ?e,
                s3_key,
                content_length,
                "S3 upload failed for print source file"
            );
            AppError::internal(format!("S3 upload failed: {e}"))
        })?;

    Ok(())
}

fn safe_extension(file_name: &str) -> Result<String> {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
        .ok_or_else(|| AppError::bad_request("У файла нет поддерживаемого расширения"))?;

    if !extension.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(AppError::bad_request(
            "Расширение файла содержит недопустимые символы",
        ));
    }
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::bad_request(
            "Этот тип файла нельзя отправить на печать",
        ));
    }

    Ok(extension)
}

fn validate_extension_and_content_type(
    extension: &str,
    content_type: &str,
    kind: UploadedFileKind,
) -> Result<()> {
    let allowed = match kind {
        UploadedFileKind::Image => {
            matches!(content_type, "application/octet-stream") || content_type.starts_with("image/")
        }
        UploadedFileKind::Document => document_content_type_matches(extension, content_type),
    };

    if allowed {
        Ok(())
    } else {
        Err(AppError::bad_request(
            "MIME-тип файла не соответствует расширению",
        ))
    }
}

fn document_content_type_matches(extension: &str, content_type: &str) -> bool {
    if content_type == "application/octet-stream" {
        return true;
    }

    match extension {
        "pdf" => matches!(content_type, "application/pdf" | "application/x-pdf"),
        "doc" | "dot" => matches!(
            content_type,
            "application/msword" | "application/wps-office.doc" | "application/x-msword"
        ),
        "docx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                | "application/zip"
        ),
        "docm" => matches!(
            content_type,
            "application/vnd.ms-word.document.macroenabled.12" | "application/zip"
        ),
        "dotx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.template"
                | "application/zip"
        ),
        "dotm" => matches!(
            content_type,
            "application/vnd.ms-word.template.macroenabled.12" | "application/zip"
        ),
        "rtf" => matches!(
            content_type,
            "application/rtf"
                | "text/rtf"
                | "application/x-rtf"
                | "text/richtext"
                | "application/msword"
        ),
        "odt" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.text" | "application/zip"
        ),
        "ott" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.text-template" | "application/zip"
        ),
        "xls" | "xlt" => matches!(
            content_type,
            "application/vnd.ms-excel" | "application/msexcel" | "application/x-msexcel"
        ),
        "xlsx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/zip"
        ),
        "xlsm" => matches!(
            content_type,
            "application/vnd.ms-excel.sheet.macroenabled.12" | "application/zip"
        ),
        "xlsb" => matches!(
            content_type,
            "application/vnd.ms-excel.sheet.binary.macroenabled.12"
        ),
        "xltx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.template"
                | "application/zip"
        ),
        "xltm" => matches!(
            content_type,
            "application/vnd.ms-excel.template.macroenabled.12" | "application/zip"
        ),
        "ods" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.spreadsheet" | "application/zip"
        ),
        "ots" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.spreadsheet-template" | "application/zip"
        ),
        "ppt" | "pps" | "pot" => matches!(
            content_type,
            "application/vnd.ms-powerpoint"
                | "application/mspowerpoint"
                | "application/powerpoint"
                | "application/x-mspowerpoint"
        ),
        "pptx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                | "application/zip"
        ),
        "pptm" => matches!(
            content_type,
            "application/vnd.ms-powerpoint.presentation.macroenabled.12" | "application/zip"
        ),
        "ppsx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.presentationml.slideshow"
                | "application/zip"
        ),
        "ppsm" => matches!(
            content_type,
            "application/vnd.ms-powerpoint.slideshow.macroenabled.12" | "application/zip"
        ),
        "potx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.presentationml.template"
                | "application/zip"
        ),
        "potm" => matches!(
            content_type,
            "application/vnd.ms-powerpoint.template.macroenabled.12" | "application/zip"
        ),
        "odp" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.presentation" | "application/zip"
        ),
        "otp" => matches!(
            content_type,
            "application/vnd.oasis.opendocument.presentation-template" | "application/zip"
        ),
        "txt" | "log" => matches!(content_type, "text/plain"),
        "csv" => matches!(
            content_type,
            "text/csv" | "text/plain" | "application/csv" | "application/vnd.ms-excel"
        ),
        "tsv" => matches!(content_type, "text/tab-separated-values" | "text/plain"),
        _ => false,
    }
}

fn normalize_content_type(content_type: Option<&str>, extension: &str) -> String {
    let normalized = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("application/octet-stream")
        .to_ascii_lowercase();

    if normalized == "application/octet-stream" {
        default_content_type(extension).to_string()
    } else {
        normalized
    }
}

fn default_content_type(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docm" => "application/vnd.ms-word.document.macroenabled.12",
        "dot" => "application/msword",
        "dotx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
        "dotm" => "application/vnd.ms-word.template.macroenabled.12",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsm" => "application/vnd.ms-excel.sheet.macroenabled.12",
        "xlsb" => "application/vnd.ms-excel.sheet.binary.macroenabled.12",
        "xlt" => "application/vnd.ms-excel",
        "xltx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
        "xltm" => "application/vnd.ms-excel.template.macroenabled.12",
        "rtf" => "application/rtf",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ott" => "application/vnd.oasis.opendocument.text-template",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "ots" => "application/vnd.oasis.opendocument.spreadsheet-template",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pptm" => "application/vnd.ms-powerpoint.presentation.macroenabled.12",
        "pps" => "application/vnd.ms-powerpoint",
        "ppsx" => "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
        "ppsm" => "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
        "pot" => "application/vnd.ms-powerpoint",
        "potx" => "application/vnd.openxmlformats-officedocument.presentationml.template",
        "potm" => "application/vnd.ms-powerpoint.template.macroenabled.12",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "otp" => "application/vnd.oasis.opendocument.presentation-template",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        _ => "application/octet-stream",
    }
}

fn upload_key(file_name: &str, extension: &str) -> String {
    let now = Utc::now();
    let safe_name = safe_file_name(file_name, extension);
    format!(
        "print-uploads/{}/{:02}/{}-{}",
        now.year(),
        now.month(),
        Uuid::new_v4(),
        safe_name
    )
}

fn safe_file_name(file_name: &str, extension: &str) -> String {
    let leaf = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("print-upload");
    let sanitized: String = leaf
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches(['.', '-', '_']).to_string();

    if trimmed.is_empty() || trimmed == extension {
        format!("print-upload.{extension}")
    } else if trimmed.len() > 96 {
        let prefix_len = 96usize.saturating_sub(extension.len() + 1);
        let prefix = trimmed.chars().take(prefix_len).collect::<String>();
        format!("{prefix}.{extension}")
    } else {
        trimmed
    }
}

fn document_type_name(document_type: DocumentType) -> &'static str {
    document_type.api_label()
}

struct PrintAssetFromUpload<'a> {
    asset_id: &'a str,
    source_id: &'a str,
    name: &'a str,
    mime_type: &'a str,
    size_bytes: u64,
    sha256: &'a str,
    storage_url: &'a str,
    storage_key: &'a str,
    document_type: &'a str,
    kind: UploadedFileKind,
    fast_profile: FastPrintProfile,
}

fn print_asset_from_upload(input: PrintAssetFromUpload<'_>) -> PrintAsset {
    PrintAsset {
        id: input.asset_id.to_string(),
        source: PrintAssetSource::Local,
        source_id: input.source_id.to_string(),
        name: input.name.to_string(),
        mime_type: input.mime_type.to_string(),
        size_bytes: input.size_bytes,
        sha256: input.sha256.to_string(),
        storage_url: input.storage_url.to_string(),
        storage_key: input.storage_key.to_string(),
        document_type: input.document_type.to_string(),
        kind: input.kind,
        pipeline: input.fast_profile.pipeline,
        max_format: input.fast_profile.max_format,
    }
}

fn ready_preparation(asset_id: &str, profile: FastPrintProfile) -> PrintPreparation {
    PrintPreparation {
        asset_id: asset_id.to_string(),
        status: PrintPreparationStatus::Ready,
        detected_format: profile.max_format,
        page_count: None,
        preview_url: None,
        coverage_percentages: None,
        coverage_required_on_laser: profile.coverage_required_on_laser,
        error: None,
    }
}

fn sha256_hex(body: &[u8]) -> String {
    hex::encode(Sha256::digest(body))
}

fn fast_print_profile(kind: UploadedFileKind) -> FastPrintProfile {
    match kind {
        UploadedFileKind::Image => FastPrintProfile {
            pipeline: FastPrintPipeline::Photo,
            max_format: "A4",
            recommended_printer_kind: RecommendedPrinterKind::Inkjet,
            coverage_required: false,
            coverage_required_on_laser: true,
        },
        UploadedFileKind::Document => FastPrintProfile {
            pipeline: FastPrintPipeline::Document,
            max_format: "A3",
            recommended_printer_kind: RecommendedPrinterKind::Laser,
            coverage_required: true,
            coverage_required_on_laser: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_profile_for_images_requires_coverage_on_laser_only() {
        let profile = fast_print_profile(UploadedFileKind::Image);

        assert_eq!(profile.pipeline, FastPrintPipeline::Photo);
        assert_eq!(profile.max_format, "A4");
        assert_eq!(
            profile.recommended_printer_kind,
            RecommendedPrinterKind::Inkjet
        );
        assert!(!profile.coverage_required);
        assert!(profile.coverage_required_on_laser);
    }

    #[test]
    fn fast_profile_for_documents_requires_laser_coverage() {
        let profile = fast_print_profile(UploadedFileKind::Document);

        assert_eq!(profile.pipeline, FastPrintPipeline::Document);
        assert_eq!(profile.max_format, "A3");
        assert_eq!(
            profile.recommended_printer_kind,
            RecommendedPrinterKind::Laser
        );
        assert!(profile.coverage_required);
        assert!(profile.coverage_required_on_laser);
    }

    #[test]
    fn document_type_name_supports_extended_office_formats() {
        assert_eq!(document_type_name(DocumentType::Rtf), "rtf");
        assert_eq!(document_type_name(DocumentType::Odt), "odt");
        assert_eq!(document_type_name(DocumentType::Pptx), "pptx");
        assert_eq!(document_type_name(DocumentType::Txt), "txt");
        assert_eq!(document_type_name(DocumentType::Csv), "csv");
    }

    #[test]
    fn validation_accepts_common_rtf_mime_types() {
        assert!(
            validate_extension_and_content_type(
                "rtf",
                "application/rtf",
                UploadedFileKind::Document,
            )
            .is_ok()
        );
        assert!(
            validate_extension_and_content_type(
                "rtf",
                "application/x-rtf",
                UploadedFileKind::Document,
            )
            .is_ok()
        );
        assert!(validate_extension_and_content_type(
            "rtf",
            "text/richtext",
            UploadedFileKind::Document,
        )
        .is_ok());
        assert!(
            validate_extension_and_content_type(
                "rtf",
                "application/msword",
                UploadedFileKind::Document,
            )
            .is_ok()
        );
    }

    #[test]
    fn validation_accepts_broad_office_and_text_mime_types() {
        for (extension, content_type) in [
            ("docm", "application/vnd.ms-word.document.macroenabled.12"),
            (
                "dotx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
            ),
            ("ott", "application/vnd.oasis.opendocument.text-template"),
            (
                "xlsb",
                "application/vnd.ms-excel.sheet.binary.macroenabled.12",
            ),
            ("xltm", "application/vnd.ms-excel.template.macroenabled.12"),
            (
                "ppsx",
                "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
            ),
            (
                "potm",
                "application/vnd.ms-powerpoint.template.macroenabled.12",
            ),
            (
                "otp",
                "application/vnd.oasis.opendocument.presentation-template",
            ),
            ("csv", "text/plain"),
            ("tsv", "text/tab-separated-values"),
        ] {
            assert!(
                validate_extension_and_content_type(
                    extension,
                    content_type,
                    UploadedFileKind::Document,
                )
                .is_ok(),
                "{extension} with {content_type} should be accepted"
            );
        }
    }

    #[test]
    fn normalized_octet_stream_uses_supported_default_mime() {
        for extension in [
            "docm", "dotm", "xlsm", "xlsb", "xltm", "pptm", "ppsm", "potm",
        ] {
            let content_type = normalize_content_type(Some("application/octet-stream"), extension);

            assert!(
                validate_extension_and_content_type(
                    extension,
                    &content_type,
                    UploadedFileKind::Document,
                )
                .is_ok(),
                "{extension} defaulted to unsupported MIME {content_type}"
            );
        }
    }

    #[test]
    fn sha256_hex_returns_stable_asset_hash() {
        assert_eq!(
            sha256_hex(b"print asset"),
            "6b6c615753cc2471d7f3e6935cb9f1574df917406b3e27d923872a8587cbe86b"
        );
    }

    #[test]
    fn ready_preparation_keeps_laser_coverage_policy() {
        let asset_id = Uuid::new_v4().to_string();
        let profile = fast_print_profile(UploadedFileKind::Image);
        let preparation = ready_preparation(&asset_id, profile);

        assert_eq!(preparation.asset_id, asset_id);
        assert_eq!(preparation.status, PrintPreparationStatus::Ready);
        assert_eq!(preparation.detected_format, "A4");
        assert!(preparation.coverage_required_on_laser);
        assert!(preparation.page_count.is_none());
    }
}
