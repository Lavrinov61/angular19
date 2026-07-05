use std::{collections::HashMap, time::Duration};

use axum::{Json, extract::State, http::HeaderMap};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::config::{Config, ConversionConfig};
use crate::conversion::detect::detect_file_type;
use crate::cups::layout_sheet::{
    CropRect, LayoutRequest, SheetRenderImage, calculate_layout, render_layout_sheet,
};
use crate::cups::pipeline;
use crate::cups::ppd;
use crate::error::{AppError, Result};
use crate::handlers::business_card::{
    BusinessCardLayoutBatchRequest, fetch_business_card_sheet_price,
    is_business_card_template_mode, validate_business_card_layout_batch_request,
    validate_business_card_printer_driver,
};
use crate::handlers::jobs::{default_quality_id, resolve_photo_print_order_id, validate_file_url};
use crate::middleware::auth::Claims;
use crate::models::job::PrintJobRow;
use crate::models::printer::PrinterRow;
use crate::source_file;

const MAX_BATCH_IMAGES: usize = 5_000;
const MAX_IMAGE_BYTES: u64 = 60 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct LayoutBatchImageDto {
    pub file_url: String,
    pub fit_mode: Option<String>,
    pub rotation: Option<i16>,
    pub crop_x: Option<f32>,
    pub crop_y: Option<f32>,
    pub crop_width: Option<f32>,
    pub crop_height: Option<f32>,
    pub photo_enhance: Option<bool>,
    pub brightness: Option<i16>,
    pub contrast: Option<i16>,
    pub saturation: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLayoutBatchDto {
    pub printer_id: String,
    pub images: Vec<LayoutBatchImageDto>,
    pub paper_size: Option<String>,
    pub paper_width_mm: f64,
    pub paper_height_mm: f64,
    pub photo_width_mm: f64,
    pub photo_height_mm: f64,
    pub cut_margin_mm: Option<f64>,
    pub cut_marks: Option<bool>,
    pub template_mode: Option<String>,
    pub bottom_padding_mm: Option<f64>,
    pub photo_preset_id: Option<String>,
    pub order_id: Option<String>,
    pub order_type: Option<String>,
    pub color_mode: Option<String>,
    pub quality: Option<String>,
    pub borderless: Option<bool>,
    pub media_type: Option<String>,
    pub paper_source: Option<String>,
    pub priority: Option<i32>,
    pub price_total: Option<f64>,
    pub mirror: Option<bool>,
}

/// POST /api/print/jobs/layout-batch — render physical sheets from multiple images.
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Json(body): Json<CreateLayoutBatchDto>,
) -> Result<Json<Value>> {
    if body.images.is_empty() {
        return Err(AppError::bad_request("images обязателен"));
    }
    if body.images.len() > MAX_BATCH_IMAGES {
        return Err(AppError::bad_request(format!(
            "Слишком много изображений в пакете: максимум {MAX_BATCH_IMAGES}",
        )));
    }
    validate_mm(body.paper_width_mm, "paper_width_mm")?;
    validate_mm(body.paper_height_mm, "paper_height_mm")?;
    validate_mm(body.photo_width_mm, "photo_width_mm")?;
    validate_mm(body.photo_height_mm, "photo_height_mm")?;

    let conversion = state
        .config
        .conversion
        .clone()
        .ok_or_else(|| AppError::service_unavailable("S3 для рендера листов не настроен"))?;

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;
    let printer_id = Uuid::parse_str(&body.printer_id)
        .map_err(|_| AppError::bad_request("Invalid printer_id"))?;

    let recent_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM print_jobs WHERE created_by = $1 AND created_at > NOW() - INTERVAL '1 minute'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if recent_count >= 50 {
        return Err(AppError::bad_request(
            "Слишком много заданий. Подождите минуту.",
        ));
    }

    let printer = sqlx::query_as::<_, PrinterRow>(
        "SELECT * FROM printers WHERE id = $1 AND is_active = TRUE",
    )
    .bind(printer_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {printer_id}")))?;

    for image in &body.images {
        if image.file_url.is_empty() {
            return Err(AppError::bad_request(
                "file_url обязателен для каждого изображения",
            ));
        }
        validate_file_url(&image.file_url)?;
        if detect_file_type(&image.file_url).is_document() {
            return Err(AppError::bad_request(
                "Пакетная раскладка поддерживает только растровые изображения",
            ));
        }
    }

    let caps = printer.capabilities.clone();
    let default_paper = caps["paper_sizes"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v["id"].as_str())
        .unwrap_or("A4")
        .to_string();
    let default_media = caps["media_types"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v["id"].as_str())
        .map(ToOwned::to_owned);
    let default_quality = default_quality_id(&caps, &printer.printer_type);
    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .ok()
        .flatten()
        .or(printer.studio_id);
    let trace_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned);
    let linked_order_id = resolve_photo_print_order_id(&state, body.order_id.as_deref()).await?;
    let paper_size = body.paper_size.as_deref().unwrap_or(&default_paper);
    let quality = body.quality.as_deref().unwrap_or(default_quality.as_str());
    let media_type = body.media_type.as_deref().or(default_media.as_deref());
    let paper_source = sanitize_paper_source(body.paper_source.as_deref());
    let color_mode = match body.color_mode.as_deref() {
        Some("bw") => "bw",
        _ => "color",
    };
    let borderless = body.borderless.unwrap_or(false);
    let printable_area_mm = if borderless {
        None
    } else {
        let cups_printer = printer.cups_printer_name.as_deref().ok_or_else(|| {
            AppError::service_unavailable("Для принтера не настроена CUPS очередь")
        })?;
        Some(
            ppd::printable_area_for_printer(cups_printer, paper_size, false).map_err(|e| {
                AppError::service_unavailable(format!(
                    "Не удалось получить точные поля из CUPS PPD: {e}"
                ))
            })?,
        )
    };

    let template_mode = sanitize_template_mode(body.template_mode.as_deref())?;
    let is_business_card = is_business_card_template_mode(template_mode.as_deref());
    let layout_req = LayoutRequest {
        photo_w_mm: body.photo_width_mm,
        photo_h_mm: body.photo_height_mm,
        paper_w_mm: body.paper_width_mm,
        paper_h_mm: body.paper_height_mm,
        cut_margin_mm: body.cut_margin_mm.unwrap_or(2.0).max(0.0),
        template_mode: template_mode.clone(),
        bottom_padding_mm: body.bottom_padding_mm,
        photo_preset_id: body.photo_preset_id.clone(),
        printable_area_mm,
    };

    let layout = calculate_layout(&layout_req, Some(body.images.len()));
    let per_sheet = layout.photos_per_sheet.max(1) as usize;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;
    let mirror = body.mirror.unwrap_or(false);
    let business_card_spec = if is_business_card {
        let spec = validate_business_card_layout_batch_request(BusinessCardLayoutBatchRequest {
            paper_size: body.paper_size.as_deref(),
            paper_width_mm: body.paper_width_mm,
            paper_height_mm: body.paper_height_mm,
            photo_width_mm: body.photo_width_mm,
            photo_height_mm: body.photo_height_mm,
            photo_preset_id: body.photo_preset_id.as_deref(),
            color_mode,
            borderless,
            media_type: body.media_type.as_deref(),
            paper_source: body.paper_source.as_deref(),
            cut_marks: body.cut_marks.unwrap_or(false),
            cut_margin_mm: body.cut_margin_mm,
        })?;
        validate_business_card_printer_driver(&printer, body.media_type.as_deref()).await?;
        Some(spec)
    } else {
        None
    };
    let priority = body.priority.unwrap_or(0).clamp(0, 10);
    let orientation = if body.paper_width_mm > body.paper_height_mm {
        "landscape"
    } else {
        "portrait"
    };
    let total_sheets = body.images.len().div_ceil(per_sheet).max(1);
    let business_card_sheet_price = if let Some(spec) = business_card_spec {
        Some(fetch_business_card_sheet_price(&state.db, &printer, studio_uuid, spec).await?)
    } else {
        None
    };
    let price_per_sheet = business_card_sheet_price
        .or_else(|| body.price_total.map(|price| price / total_sheets as f64));

    let mut jobs = Vec::with_capacity(total_sheets);
    let mut image_cache = HashMap::<String, Vec<u8>>::new();
    for (index, chunk) in body.images.chunks(per_sheet).enumerate() {
        let mut sheet_images = Vec::with_capacity(chunk.len());
        for image in chunk {
            let bytes =
                cached_image_bytes(&state.config, &http, &mut image_cache, &image.file_url).await?;
            sheet_images.push(SheetRenderImage {
                bytes,
                fit_mode: sanitize_fit_mode(image.fit_mode.as_deref()).to_string(),
                rotation: image.rotation.unwrap_or(0),
                crop: crop_from_dto(image),
                mirror,
                adjustments: pipeline::image_adjustments(
                    image.photo_enhance,
                    image.brightness,
                    image.contrast,
                    image.saturation,
                ),
            });
        }

        let sheet_layout = layout.clone();
        let paper_w_mm = body.paper_width_mm;
        let paper_h_mm = body.paper_height_mm;
        let cut_marks = body.cut_marks.unwrap_or(true);

        let rendered = tokio::task::spawn_blocking(move || {
            render_layout_sheet(
                &sheet_layout,
                paper_w_mm,
                paper_h_mm,
                &sheet_images,
                cut_marks,
            )
        })
        .await
        .map_err(|e| AppError::internal(format!("Sheet render task failed: {e}")))?
        .map_err(|e| AppError::internal(format!("Sheet render failed: {e}")))?;

        let key = format!("print-layout/{}/sheet-{:03}.jpg", Uuid::new_v4(), index + 1);
        let sheet_url = upload_to_s3_bytes(&conversion, rendered, &key).await?;
        let file_name = format!("layout-sheet-{:03}.jpg", index + 1);

        let job = sqlx::query_as::<_, PrintJobRow>(
            r#"INSERT INTO print_jobs (
                 printer_id, file_url, file_name,
                 copies, paper_size, color_mode, quality, duplex,
                 orientation, borderless, media_type, fit_mode,
                 order_id, order_type,
                 cut_marks,
                 created_by, studio_id, status, priority, price_total,
                 trace_id, paper_source
               ) VALUES (
                 $1, $2, $3,
                 1, $4, $5, $6, FALSE,
                 $7, $8, $9, 'fit',
                 $10, $11,
                 FALSE,
                 $12, $13, 'queued', $14, $15,
                 $16, $17
               ) RETURNING
                 *,
                 NULL::text AS printer_name,
                 NULL::text AS printer_type,
                 NULL::text AS creator_name"#,
        )
        .bind(printer_id)
        .bind(&sheet_url)
        .bind(&file_name)
        .bind(paper_size)
        .bind(color_mode)
        .bind(quality)
        .bind(orientation)
        .bind(borderless)
        .bind(media_type)
        .bind(&linked_order_id)
        .bind(&body.order_type)
        .bind(user_id)
        .bind(studio_uuid)
        .bind(priority)
        .bind(price_per_sheet)
        .bind(&trace_id)
        .bind(&paper_source)
        .fetch_one(&state.db)
        .await?;

        let notify_payload = json!({
            "id": job.id,
            "printer_id": printer_id,
            "studio_id": job.studio_id,
            "status": "queued",
        });
        sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
            .bind(notify_payload.to_string())
            .execute(&state.db)
            .await?;

        let mut job_value = serde_json::to_value(&job)?;
        job_value["printer_name"] = json!(printer.name);
        job_value["printer_type"] = json!(printer.printer_type);
        jobs.push(job_value);
    }

    Ok(Json(json!({
        "success": true,
        "jobs": jobs,
        "total_sheets": total_sheets,
        "layout": layout,
    })))
}

fn validate_mm(value: f64, field: &str) -> Result<()> {
    if !value.is_finite() || value <= 0.0 || value > 1000.0 {
        return Err(AppError::bad_request(format!("{field} должен быть > 0")));
    }
    Ok(())
}

fn sanitize_template_mode(value: Option<&str>) -> Result<Option<String>> {
    match value {
        None | Some("") | Some("none") => Ok(None),
        Some(mode @ ("polaroid" | "passport" | "collage" | "label" | "business-card")) => {
            Ok(Some(mode.to_string()))
        }
        Some(_) => Err(AppError::bad_request("Invalid template_mode")),
    }
}

fn sanitize_paper_source(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("auto").trim();
    if trimmed.is_empty() {
        "auto".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

fn sanitize_fit_mode(value: Option<&str>) -> &str {
    match value {
        Some(mode @ ("fit" | "fill" | "stretch" | "actual")) => mode,
        _ => "fit",
    }
}

fn crop_from_dto(dto: &LayoutBatchImageDto) -> Option<CropRect> {
    let (Some(x), Some(y), Some(width), Some(height)) =
        (dto.crop_x, dto.crop_y, dto.crop_width, dto.crop_height)
    else {
        return None;
    };
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(CropRect {
        x,
        y,
        width,
        height,
    })
}

async fn cached_image_bytes(
    config: &Config,
    client: &reqwest::Client,
    cache: &mut HashMap<String, Vec<u8>>,
    url: &str,
) -> Result<Vec<u8>> {
    if let Some(bytes) = cache.get(url) {
        return Ok(bytes.clone());
    }
    let bytes =
        source_file::read_source_bytes(config, client, url, MAX_IMAGE_BYTES, "изображение").await?;
    cache.insert(url.to_string(), bytes.clone());
    Ok(bytes)
}

async fn upload_to_s3_bytes(
    config: &ConversionConfig,
    body: Vec<u8>,
    s3_key: &str,
) -> Result<String> {
    let content_length = body.len() as i64;
    let creds = aws_sdk_s3::config::Credentials::new(
        &config.s3_access_key,
        &config.s3_secret_key,
        None,
        None,
        "print-api-layout-batch",
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
        .content_type("image/jpeg")
        .cache_control("public, max-age=31536000")
        .send()
        .await
        .map_err(|e| {
            tracing::error!(
                error = ?e,
                s3_key,
                content_length,
                "S3 upload failed for rendered layout sheet"
            );
            AppError::internal(format!("S3 upload failed: {e}"))
        })?;

    Ok(format!("{}/{}", config.s3_public_url, s3_key))
}
