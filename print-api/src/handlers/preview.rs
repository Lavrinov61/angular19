use std::{
    collections::HashMap,
    path::{Path as FsPath, PathBuf},
    time::Duration,
};

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use image::{Rgb, RgbImage, imageops};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::AppState;
use crate::conversion::detect::DocumentType;
use crate::conversion::{detect_file_type, extension_for_document_type, render_document_pages};
use crate::cups::jpeg;
use crate::cups::layout_sheet::{
    CropRect, LayoutRequest, SheetRenderImage, calculate_layout, render_layout_sheet,
};
use crate::cups::pipeline::{self, ProcessParams};
use crate::cups::ppd::{self, PrintableAreaMm};
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::models::printer::PrinterRow;
use crate::{config::Config, source_file};

const PREVIEW_TEMP_DIR: &str = "/tmp/cups-print-previews";
const MAX_PREVIEW_FILE_SIZE: u64 = 200 * 1024 * 1024;
const MAX_LAYOUT_PREVIEW_IMAGES: usize = 5_000;
const MAX_LAYOUT_PREVIEW_IMAGE_BYTES: u64 = 60 * 1024 * 1024;
const DOCUMENT_PREVIEW_MAX_PAGES: usize = 120;
const DOCUMENT_PREVIEW_MARGIN_PX: u32 = 32;
const DOCUMENT_PREVIEW_GAP_PX: u32 = 36;
const DOCUMENT_PREVIEW_BOOKLET_GAP_PX: u32 = 18;
const TARGET_DPI: u32 = 300;
// 120 dpi достаточно для экранного превью (страницы всё равно ужимаются до 420-680px
// по ширине) — это быстрее рендерится и совпадает с DPI coverage-анализа. На качество
// ПЕЧАТИ не влияет (печать рендерится отдельно при 300 dpi).
const DOCUMENT_PREVIEW_DPI: i32 = 120;
/// JPEG-качество склейки превью документа. Превью — экранный просмотр (не печать),
/// поэтому 72 вместо 90 даёт ~−40-45% веса блоба без заметной потери читабельности.
/// Критично для точек с медленным каналом: блоб со всеми страницами едет в браузер целиком.
const DOCUMENT_PREVIEW_JPEG_QUALITY: u8 = 72;
const PREVIEW_TTL_SECONDS: usize = 120;
const PREVIEW_PENDING_VALUE: &[u8] = b"pending";
const PREVIEW_ERROR_VALUE: &[u8] = b"error";

/// Validate file_url to prevent SSRF attacks.
/// Only allows HTTP(S) URLs from whitelisted domains; blocks private/internal IPs.
fn validate_file_url(url_str: &str) -> Result<()> {
    let parsed =
        url::Url::parse(url_str).map_err(|_| AppError::bad_request("Невалидный URL файла"))?;

    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return Err(AppError::bad_request("URL должен использовать HTTP/HTTPS"));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::bad_request("URL должен содержать хост"))?;

    // Block well-known internal hostnames
    let blocked_hosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "169.254.169.254",
        "[::1]",
    ];
    if blocked_hosts.iter().any(|h| host.eq_ignore_ascii_case(h)) {
        return Err(AppError::bad_request(
            "Доступ к внутренним адресам запрещён",
        ));
    }

    // Block private/loopback/link-local IP ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_private() || v4.is_loopback() || v4.is_link_local() {
                    return Err(AppError::bad_request("Доступ к приватным IP запрещён"));
                }
                if v4.octets()[0] == 169 && v4.octets()[1] == 254 {
                    return Err(AppError::bad_request("Доступ к link-local IP запрещён"));
                }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() {
                    return Err(AppError::bad_request("Доступ к loopback запрещён"));
                }
            }
        }
    }

    // Whitelist: only allow known domains (MinIO is accessed via svoefoto.ru/media proxy)
    // Configurable via PREVIEW_ALLOWED_DOMAINS env var (comma-separated)
    let allowed_domains_env =
        std::env::var("PREVIEW_ALLOWED_DOMAINS").unwrap_or_else(|_| "svoefoto.ru".to_string());
    let allowed_domains: Vec<&str> = allowed_domains_env.split(',').map(|s| s.trim()).collect();
    if !allowed_domains.iter().any(|d| host.ends_with(d)) {
        tracing::warn!("Preview request blocked: unknown host {}", host);
        return Err(AppError::bad_request(
            "URL файла должен быть с разрешённого домена",
        ));
    }

    Ok(())
}

#[derive(Clone, Deserialize)]
pub struct PreviewRequestDto {
    pub printer_id: Option<String>,
    pub file_url: String,
    pub paper_size: String,
    pub orientation: Option<String>,
    pub color_mode: Option<String>,
    pub quality: Option<String>,
    pub borderless: Option<bool>,
    pub media_type: Option<String>,
    pub fit_mode: Option<String>,
    pub rotation: Option<i16>,
    pub mirror: Option<bool>,
    pub crop_x: Option<f32>,
    pub crop_y: Option<f32>,
    pub crop_width: Option<f32>,
    pub crop_height: Option<f32>,
    pub photo_enhance: Option<bool>,
    pub brightness: Option<i16>,
    pub contrast: Option<i16>,
    pub saturation: Option<i16>,
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub cut_margin_mm: Option<f64>,
    pub cut_marks: Option<bool>,
    pub cut_mark_length_mm: Option<f64>,
    pub cut_mark_offset_mm: Option<f64>,
    pub custom_photo_width_mm: Option<f64>,
    pub custom_photo_height_mm: Option<f64>,
    pub document_template_slug: Option<String>,
    pub resolution_dpi: Option<i32>,
    pub icc_profile_id: Option<String>,
    pub rendering_intent: Option<String>,
    pub layout: Option<PreviewLayoutDto>,
    pub preview_width: Option<i32>,
    pub preview_height: Option<i32>,
    pub paper_source: Option<String>,
    pub dpi: Option<i32>,
    pub font_size_delta_pt: Option<i16>,
    pub booklet: Option<bool>,
    /// 1-based страница для постраничного (ленивого) превью документа. Когда задана —
    /// рендерится только эта страница (мгновенный показ первой), без склейки всего
    /// документа. None = весь документ (как раньше).
    pub page: Option<i32>,
}

#[derive(Clone, Deserialize)]
pub struct PreviewLayoutDto {
    pub rows: i32,
    pub cols: i32,
    pub cut_margin_mm: Option<f32>,
    pub cut_marks: Option<bool>,
    pub cut_mark_length_mm: Option<f32>,
    pub cut_mark_offset_mm: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct LayoutSheetPreviewImageDto {
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
pub struct LayoutSheetPreviewDto {
    pub printer_id: Option<String>,
    pub paper_size: Option<String>,
    pub images: Vec<LayoutSheetPreviewImageDto>,
    pub paper_width_mm: f64,
    pub paper_height_mm: f64,
    pub photo_width_mm: f64,
    pub photo_height_mm: f64,
    pub cut_margin_mm: Option<f64>,
    pub cut_marks: Option<bool>,
    pub template_mode: Option<String>,
    pub bottom_padding_mm: Option<f64>,
    pub photo_preset_id: Option<String>,
    pub mirror: Option<bool>,
    pub borderless: Option<bool>,
    pub paper_source: Option<String>,
}

/// POST /api/print/preview — render a preview through the same Rust print pipeline.
///
/// Returns a preview_id that can be polled via GET /api/print/preview/:id.
/// Raster files use the CUPS image pipeline; documents use LibreOffice/PDF/Ghostscript.
pub async fn request_preview(
    State(state): State<AppState>,
    _claims: Claims,
    Json(body): Json<PreviewRequestDto>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() || body.paper_size.is_empty() {
        return Err(AppError::bad_request("file_url и paper_size обязательны"));
    }

    validate_file_url(&body.file_url)?;

    let Some(ref redis_url) = state.config.redis_url else {
        return Err(AppError::service_unavailable("Redis не настроен"));
    };

    tokio::fs::create_dir_all(PREVIEW_TEMP_DIR)
        .await
        .map_err(|e| AppError::internal(format!("Preview temp dir error: {e}")))?;

    let preview_id = Uuid::new_v4().to_string();
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;

    let doc_type = detect_file_type(&body.file_url);
    if doc_type.is_document() {
        // Контентно-адресуемый id: одинаковый документ+параметры → один preview_id.
        let preview_id = document_preview_cache_key(&body);

        // Кэш-хит: превью уже готово или уже рендерится прямо сейчас — НЕ запускаем
        // Ghostscript повторно. Фронт опросит GET /preview/:id и получит/дождётся блоб.
        if let Some(existing) = peek_preview_bytes(redis_url, &preview_id).await? {
            if existing != PREVIEW_ERROR_VALUE {
                if existing != PREVIEW_PENDING_VALUE {
                    let _ = refresh_preview_ttl(redis_url, &preview_id).await;
                }
                return Ok(Json(json!({
                    "success": true,
                    "preview_id": preview_id,
                    "status": "pending"
                })));
            }
            // ERROR-сентинел: прошлый рендер упал — пробуем заново ниже.
        }

        store_preview_pending(redis_url, &preview_id).await?;
        let redis_url = redis_url.clone();
        let preview_id_for_task = preview_id.clone();
        let config = state.config.clone();
        let body_for_task = body.clone();

        tokio::spawn(async move {
            let http_client = match reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    tracing::error!(
                        preview_id = %preview_id_for_task,
                        error = %err,
                        "Document preview HTTP client build failed"
                    );
                    let _ = store_preview_error(&redis_url, &preview_id_for_task).await;
                    return;
                }
            };

            match render_document_preview(
                &config,
                &http_client,
                &body_for_task,
                doc_type,
                &preview_id_for_task,
            )
            .await
            {
                Ok(rendered) => {
                    if let Err(err) =
                        store_preview(&redis_url, &preview_id_for_task, rendered).await
                    {
                        tracing::error!(
                            preview_id = %preview_id_for_task,
                            error = %err,
                            "Document preview store failed"
                        );
                    }
                }
                Err(err) => {
                    tracing::error!(
                        preview_id = %preview_id_for_task,
                        error = %err,
                        "Document preview render failed"
                    );
                    let _ = store_preview_error(&redis_url, &preview_id_for_task).await;
                }
            }
        });

        return Ok(Json(json!({
            "success": true,
            "preview_id": preview_id,
            "status": "pending"
        })));
    }

    let downloaded_path = source_file::write_source_temp_file(
        &state.config,
        &http_client,
        &body.file_url,
        PREVIEW_TEMP_DIR,
        MAX_PREVIEW_FILE_SIZE,
        "файл preview",
    )
    .await
    .map_err(|e| AppError::bad_request(format!("Не удалось прочитать файл preview: {e}")))?;

    let printable_area_mm = resolve_printable_area(
        &state,
        body.printer_id.as_deref(),
        &body.paper_size,
        body.borderless.unwrap_or(false),
    )
    .await?;

    let params = build_process_params(&body, printable_area_mm);
    let target_dpi = body
        .resolution_dpi
        .filter(|dpi| *dpi > 0)
        .unwrap_or(TARGET_DPI as i32)
        .clamp(150, 1200) as u32;
    let dl_path = downloaded_path.clone();

    let processed_path = match tokio::task::spawn_blocking(move || {
        pipeline::process_image(&dl_path, &params, target_dpi)
    })
    .await
    {
        Ok(Ok(path)) => path,
        Ok(Err(e)) => {
            cleanup_temp(&downloaded_path);
            return Err(AppError::internal(format!("Preview render failed: {e}")));
        }
        Err(e) => {
            cleanup_temp(&downloaded_path);
            return Err(AppError::internal(format!(
                "Preview render task failed: {e}"
            )));
        }
    };

    let rendered = tokio::fs::read(&processed_path)
        .await
        .map_err(|e| AppError::internal(format!("Preview read failed: {e}")))?;

    cleanup_temp(&downloaded_path);
    cleanup_temp(&processed_path);

    // These options are intentionally accepted for API compatibility, but the
    // current Rust CUPS image pipeline does not consume them when building the
    // processed JPEG. They must not trigger alternate preview logic.
    let _ = (
        body.quality.as_deref(),
        body.media_type.as_deref(),
        body.icc_profile_id.as_deref(),
        body.rendering_intent.as_deref(),
        body.preview_width,
        body.preview_height,
        body.paper_source.as_deref(),
        body.dpi,
        body.font_size_delta_pt,
    );

    store_preview(redis_url, &preview_id, rendered).await?;

    Ok(Json(json!({
        "success": true,
        "preview_id": preview_id,
        "status": "ready"
    })))
}

/// POST /api/print/preview/layout-sheet — render the first physical layout sheet in Rust.
///
/// This uses the same `calculate_layout` + `render_layout_sheet` path as layout-batch printing.
pub async fn request_layout_sheet_preview(
    State(state): State<AppState>,
    _claims: Claims,
    Json(body): Json<LayoutSheetPreviewDto>,
) -> Result<impl IntoResponse> {
    if body.images.is_empty() {
        return Err(AppError::bad_request("images обязателен"));
    }
    if body.images.len() > MAX_LAYOUT_PREVIEW_IMAGES {
        return Err(AppError::bad_request(format!(
            "Слишком много изображений в preview: максимум {MAX_LAYOUT_PREVIEW_IMAGES}",
        )));
    }
    validate_mm(body.paper_width_mm, "paper_width_mm")?;
    validate_mm(body.paper_height_mm, "paper_height_mm")?;
    validate_mm(body.photo_width_mm, "photo_width_mm")?;
    validate_mm(body.photo_height_mm, "photo_height_mm")?;

    for image in &body.images {
        if image.file_url.is_empty() {
            return Err(AppError::bad_request(
                "file_url обязателен для каждого изображения",
            ));
        }
        validate_file_url(&image.file_url)?;
    }

    let template_mode = sanitize_template_mode(body.template_mode.as_deref())?;
    let borderless = body.borderless.unwrap_or(false);
    let printable_area_mm = if borderless {
        None
    } else {
        let paper_size = body
            .paper_size
            .as_deref()
            .ok_or_else(|| AppError::bad_request("paper_size обязателен для точного preview"))?;
        resolve_printable_area(&state, body.printer_id.as_deref(), paper_size, false).await?
    };
    let layout_req = LayoutRequest {
        photo_w_mm: body.photo_width_mm,
        photo_h_mm: body.photo_height_mm,
        paper_w_mm: body.paper_width_mm,
        paper_h_mm: body.paper_height_mm,
        cut_margin_mm: body.cut_margin_mm.unwrap_or(2.0).max(0.0),
        template_mode,
        bottom_padding_mm: body.bottom_padding_mm,
        photo_preset_id: body.photo_preset_id.clone(),
        printable_area_mm,
    };
    let layout = calculate_layout(&layout_req, Some(body.images.len()));
    let per_sheet = layout.photos_per_sheet.max(1) as usize;
    tracing::info!(
        images = body.images.len(),
        per_sheet,
        "Layout sheet preview render started"
    );
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;
    let mirror = body.mirror.unwrap_or(false);
    let _ = body.paper_source.as_deref();

    let mut sheet_images = Vec::with_capacity(per_sheet.min(body.images.len()));
    let mut image_cache = HashMap::<String, Vec<u8>>::new();
    for image in body.images.iter().take(per_sheet) {
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

    let paper_w_mm = body.paper_width_mm;
    let paper_h_mm = body.paper_height_mm;
    let cut_marks = body.cut_marks.unwrap_or(true);
    let rendered = tokio::task::spawn_blocking(move || {
        render_layout_sheet(&layout, paper_w_mm, paper_h_mm, &sheet_images, cut_marks)
    })
    .await
    .map_err(|e| AppError::internal(format!("Sheet preview task failed: {e}")))?
    .map_err(|e| AppError::internal(format!("Sheet preview failed: {e}")))?;
    tracing::info!(
        bytes = rendered.len(),
        unique_images = image_cache.len(),
        "Layout sheet preview render completed"
    );

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/jpeg")],
        rendered,
    ))
}

fn build_process_params(
    body: &PreviewRequestDto,
    printable_area_mm: Option<PrintableAreaMm>,
) -> ProcessParams {
    let layout_rows = body
        .layout_rows
        .or_else(|| body.layout.as_ref().map(|layout| layout.rows))
        .unwrap_or(1)
        .max(1);
    let layout_cols = body
        .layout_cols
        .or_else(|| body.layout.as_ref().map(|layout| layout.cols))
        .unwrap_or(1)
        .max(1);

    ProcessParams {
        paper_size: body.paper_size.clone(),
        orientation: sanitize_orientation(body.orientation.as_deref()).to_string(),
        fit_mode: sanitize_fit_mode(body.fit_mode.as_deref()).to_string(),
        color_mode: sanitize_color_mode(body.color_mode.as_deref()).to_string(),
        mirror: body.mirror.unwrap_or(false),
        rotation: body.rotation.unwrap_or(0),
        crop_x: body.crop_x.unwrap_or(0.0),
        crop_y: body.crop_y.unwrap_or(0.0),
        crop_width: body.crop_width.unwrap_or(0.0),
        crop_height: body.crop_height.unwrap_or(0.0),
        adjustments: pipeline::image_adjustments(
            body.photo_enhance,
            body.brightness,
            body.contrast,
            body.saturation,
        ),
        layout_rows,
        layout_cols,
        custom_photo_width_mm: body.custom_photo_width_mm,
        custom_photo_height_mm: body.custom_photo_height_mm,
        cut_marks: body
            .cut_marks
            .or_else(|| body.layout.as_ref().and_then(|layout| layout.cut_marks))
            .unwrap_or(false),
        cut_margin_mm: body
            .cut_margin_mm
            .or_else(|| {
                body.layout
                    .as_ref()
                    .and_then(|layout| layout.cut_margin_mm.map(f64::from))
            })
            .unwrap_or(1.0),
        cut_mark_length_mm: body
            .cut_mark_length_mm
            .or_else(|| {
                body.layout
                    .as_ref()
                    .and_then(|layout| layout.cut_mark_length_mm.map(f64::from))
            })
            .unwrap_or(5.0),
        cut_mark_offset_mm: body
            .cut_mark_offset_mm
            .or_else(|| {
                body.layout
                    .as_ref()
                    .and_then(|layout| layout.cut_mark_offset_mm.map(f64::from))
            })
            .unwrap_or(2.0),
        document_template_slug: body.document_template_slug.clone().unwrap_or_default(),
        printable_area_mm,
        // Preview renders at the nominal paper size; the borderless true-size
        // upscale only matters for the physical print (executor sets it).
        borderless_paper_mm: None,
    }
}

async fn render_document_preview(
    config: &Config,
    client: &reqwest::Client,
    body: &PreviewRequestDto,
    doc_type: DocumentType,
    preview_id: &str,
) -> Result<Vec<u8>> {
    let task_dir = FsPath::new(PREVIEW_TEMP_DIR).join(preview_id);
    tokio::fs::create_dir_all(&task_dir)
        .await
        .map_err(|e| AppError::internal(format!("Document preview temp dir error: {e}")))?;

    let result = async {
        let source_path =
            task_dir.join(format!("source.{}", extension_for_document_type(doc_type)));
        source_file::write_source_file(
            config,
            client,
            &body.file_url,
            &source_path,
            MAX_PREVIEW_FILE_SIZE,
            "документ",
        )
        .await?;

        let dpi = document_preview_dpi(body);
        let font_delta = normalize_preview_font_size_delta(body.font_size_delta_pt, doc_type)?;
        // Ленивое превью: если задана конкретная страница — рендерим только её.
        let only_page = body.page.filter(|p| *p >= 1);
        let rendered_pages = render_document_pages(
            &source_path,
            &task_dir,
            doc_type,
            dpi,
            font_delta,
            Some(DOCUMENT_PREVIEW_MAX_PAGES),
            only_page,
        )
        .await
        .map_err(|e| AppError::internal(format!("Document preview render failed: {e}")))?;
        let preview_width = body.preview_width;
        let color_mode = sanitize_color_mode(body.color_mode.as_deref()).to_string();
        let booklet = body.booklet.unwrap_or(false);

        tokio::task::spawn_blocking(move || {
            compose_document_preview_pages(&rendered_pages, preview_width, &color_mode, booklet)
        })
        .await
        .map_err(|e| AppError::internal(format!("Document preview compose task failed: {e}")))?
    }
    .await;

    if let Err(err) = tokio::fs::remove_dir_all(&task_dir).await {
        tracing::debug!(
            path = %task_dir.display(),
            error = %err,
            "Document preview temp cleanup skipped"
        );
    }

    result
}

fn compose_document_preview_pages(
    page_paths: &[PathBuf],
    preview_width: Option<i32>,
    color_mode: &str,
    booklet: bool,
) -> Result<Vec<u8>> {
    if page_paths.is_empty() {
        return Err(AppError::internal(
            "Document preview did not render any pages",
        ));
    }

    let requested_width = preview_width.unwrap_or(1400).clamp(700, 1800) as u32;
    let page_count = page_paths.len().min(DOCUMENT_PREVIEW_MAX_PAGES);
    let base_width = requested_width
        .saturating_sub(DOCUMENT_PREVIEW_MARGIN_PX.saturating_mul(2))
        .clamp(420, 1400);
    let page_target_width = if page_count > 80 {
        base_width.min(420)
    } else if page_count > 40 {
        base_width.min(520)
    } else if page_count > 20 {
        base_width.min(680)
    } else {
        base_width
    };
    let page_target_width = if booklet {
        base_width
            .saturating_sub(DOCUMENT_PREVIEW_BOOKLET_GAP_PX)
            .saturating_div(2)
            .clamp(260, 700)
    } else {
        page_target_width
    };

    let mut rendered_pages = Vec::with_capacity(page_count);
    for path in page_paths.iter().take(DOCUMENT_PREVIEW_MAX_PAGES) {
        let decoded = image::open(path)
            .map_err(|e| AppError::internal(format!("Document preview page decode failed: {e}")))?;
        let rgb = if color_mode == "bw" {
            decoded.grayscale().to_rgb8()
        } else {
            decoded.to_rgb8()
        };
        if rgb.width() == 0 || rgb.height() == 0 {
            continue;
        }

        let scale = page_target_width as f64 / rgb.width() as f64;
        let target_height = ((rgb.height() as f64) * scale).round().max(1.0) as u32;
        // Triangle (билинейный) вместо Lanczos3: для экранного превью разница незаметна,
        // но ресайз в несколько раз дешевле — ускоряет склейку (особенно многостраничную).
        let resized = imageops::resize(
            &rgb,
            page_target_width,
            target_height,
            imageops::FilterType::Triangle,
        );
        rendered_pages.push(resized);
    }

    if rendered_pages.is_empty() {
        return Err(AppError::internal(
            "Document preview did not render any readable pages",
        ));
    }

    if booklet {
        return compose_booklet_document_preview_pages(&rendered_pages, requested_width);
    }

    let frame_px: u32 = 2;
    let frame_width = page_target_width.saturating_add(frame_px.saturating_mul(2));
    let sheet_width = frame_width.saturating_add(DOCUMENT_PREVIEW_MARGIN_PX.saturating_mul(2));
    let content_height = rendered_pages.iter().fold(0_u32, |sum, page| {
        sum.saturating_add(page.height())
            .saturating_add(frame_px.saturating_mul(2))
    });
    let gap_count = (rendered_pages.len().saturating_sub(1)).min(u32::MAX as usize) as u32;
    let sheet_height = content_height
        .saturating_add(DOCUMENT_PREVIEW_GAP_PX.saturating_mul(gap_count))
        .saturating_add(DOCUMENT_PREVIEW_MARGIN_PX.saturating_mul(2));

    let mut sheet = RgbImage::from_pixel(sheet_width, sheet_height, Rgb([238, 238, 238]));
    let mut y = DOCUMENT_PREVIEW_MARGIN_PX;
    for page in rendered_pages {
        let mut frame = RgbImage::from_pixel(
            page.width().saturating_add(frame_px.saturating_mul(2)),
            page.height().saturating_add(frame_px.saturating_mul(2)),
            Rgb([255, 255, 255]),
        );
        imageops::overlay(&mut frame, &page, frame_px as i64, frame_px as i64);
        let x = sheet_width.saturating_sub(frame.width()) / 2;
        imageops::overlay(&mut sheet, &frame, x as i64, y as i64);
        y = y
            .saturating_add(frame.height())
            .saturating_add(DOCUMENT_PREVIEW_GAP_PX);
    }

    jpeg::encode_rgb_jpeg_bytes(&sheet, DOCUMENT_PREVIEW_JPEG_QUALITY, 96).map_err(AppError::internal)
}

fn compose_booklet_document_preview_pages(
    rendered_pages: &[RgbImage],
    requested_width: u32,
) -> Result<Vec<u8>> {
    let first_page = rendered_pages
        .first()
        .ok_or_else(|| AppError::internal("Document preview did not render any readable pages"))?;
    let single_width = first_page.width();
    let single_height = first_page.height();
    let frame_px: u32 = 2;
    let spread_width = single_width
        .saturating_mul(2)
        .saturating_add(DOCUMENT_PREVIEW_BOOKLET_GAP_PX);
    let frame_width = spread_width.saturating_add(frame_px.saturating_mul(2));
    let sheet_width = requested_width
        .max(frame_width.saturating_add(DOCUMENT_PREVIEW_MARGIN_PX.saturating_mul(2)));
    let total_pages = rendered_pages.len();
    let padded_pages = total_pages.div_ceil(4).max(1).saturating_mul(4);
    let side_count = padded_pages / 2;
    let frame_height = single_height.saturating_add(frame_px.saturating_mul(2));
    let sheet_height = DOCUMENT_PREVIEW_MARGIN_PX
        .saturating_mul(2)
        .saturating_add((side_count as u32).saturating_mul(frame_height))
        .saturating_add(
            ((side_count.saturating_sub(1)) as u32).saturating_mul(DOCUMENT_PREVIEW_GAP_PX),
        );

    let mut sheet = RgbImage::from_pixel(sheet_width, sheet_height, Rgb([238, 238, 238]));
    let mut y = DOCUMENT_PREVIEW_MARGIN_PX;

    for sheet_index in 0..(padded_pages / 4) {
        let left_front = padded_pages - (sheet_index * 2);
        let right_front = 1 + (sheet_index * 2);
        overlay_booklet_spread(
            &mut sheet,
            rendered_pages,
            left_front,
            right_front,
            single_width,
            single_height,
            y,
        );
        y = y
            .saturating_add(frame_height)
            .saturating_add(DOCUMENT_PREVIEW_GAP_PX);

        let left_back = 2 + (sheet_index * 2);
        let right_back = padded_pages - (sheet_index * 2) - 1;
        overlay_booklet_spread(
            &mut sheet,
            rendered_pages,
            left_back,
            right_back,
            single_width,
            single_height,
            y,
        );
        y = y
            .saturating_add(frame_height)
            .saturating_add(DOCUMENT_PREVIEW_GAP_PX);
    }

    jpeg::encode_rgb_jpeg_bytes(&sheet, DOCUMENT_PREVIEW_JPEG_QUALITY, 96).map_err(AppError::internal)
}

fn overlay_booklet_spread(
    sheet: &mut RgbImage,
    rendered_pages: &[RgbImage],
    left_page_number: usize,
    right_page_number: usize,
    single_width: u32,
    single_height: u32,
    y: u32,
) {
    let frame_px: u32 = 2;
    let spread_width = single_width
        .saturating_mul(2)
        .saturating_add(DOCUMENT_PREVIEW_BOOKLET_GAP_PX);
    let mut frame = RgbImage::from_pixel(
        spread_width.saturating_add(frame_px.saturating_mul(2)),
        single_height.saturating_add(frame_px.saturating_mul(2)),
        Rgb([255, 255, 255]),
    );
    overlay_booklet_page(
        &mut frame,
        rendered_pages,
        left_page_number,
        frame_px,
        frame_px,
        single_height,
    );
    overlay_booklet_page(
        &mut frame,
        rendered_pages,
        right_page_number,
        frame_px
            .saturating_add(single_width)
            .saturating_add(DOCUMENT_PREVIEW_BOOKLET_GAP_PX),
        frame_px,
        single_height,
    );

    let gutter_x = frame_px
        .saturating_add(single_width)
        .saturating_add(DOCUMENT_PREVIEW_BOOKLET_GAP_PX / 2)
        .saturating_sub(1);
    for yy in frame_px..frame_px.saturating_add(single_height) {
        if gutter_x < frame.width() && yy < frame.height() {
            frame.put_pixel(gutter_x, yy, Rgb([220, 220, 220]));
        }
    }

    let x = sheet.width().saturating_sub(frame.width()) / 2;
    imageops::overlay(sheet, &frame, x as i64, y as i64);
}

fn overlay_booklet_page(
    frame: &mut RgbImage,
    rendered_pages: &[RgbImage],
    page_number: usize,
    x: u32,
    y: u32,
    single_height: u32,
) {
    let Some(page) = page_number
        .checked_sub(1)
        .and_then(|index| rendered_pages.get(index))
    else {
        return;
    };

    let page_y = y.saturating_add(single_height.saturating_sub(page.height()) / 2);
    imageops::overlay(frame, page, x as i64, page_y as i64);
}

fn document_preview_dpi(body: &PreviewRequestDto) -> u32 {
    body.dpi
        .or(body.resolution_dpi)
        .filter(|dpi| *dpi > 0)
        .unwrap_or(DOCUMENT_PREVIEW_DPI)
        .clamp(96, 300) as u32
}

fn normalize_preview_font_size_delta(
    value: Option<i16>,
    doc_type: DocumentType,
) -> Result<Option<i16>> {
    let Some(delta) = value else {
        return Ok(None);
    };

    if delta == 0 {
        return Ok(None);
    }
    if delta > 0 {
        return Err(AppError::bad_request(
            "font_size_delta_pt должен быть отрицательным или 0",
        ));
    }
    if delta < -8 {
        return Err(AppError::bad_request(
            "font_size_delta_pt должен быть от -8 до 0",
        ));
    }
    if doc_type.is_word_font_adjustable() {
        Ok(Some(delta))
    } else {
        Ok(None)
    }
}

async fn store_preview(redis_url: &str, preview_id: &str, rendered: Vec<u8>) -> Result<()> {
    store_preview_bytes(redis_url, preview_id, &rendered).await
}

async fn store_preview_pending(redis_url: &str, preview_id: &str) -> Result<()> {
    store_preview_bytes(redis_url, preview_id, PREVIEW_PENDING_VALUE).await
}

async fn store_preview_error(redis_url: &str, preview_id: &str) -> Result<()> {
    store_preview_bytes(redis_url, preview_id, PREVIEW_ERROR_VALUE).await
}

async fn store_preview_bytes(redis_url: &str, preview_id: &str, data: &[u8]) -> Result<()> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = format!("print:preview:{preview_id}");
    let _: () = redis::cmd("SET")
        .arg(&key)
        .arg(data)
        .arg("EX")
        .arg(PREVIEW_TTL_SECONDS)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis SET failed: {e}")))?;

    Ok(())
}

/// Контентный ключ превью документа: тот же документ + те же влияющие на растр
/// параметры → один и тот же preview_id → готовый рендер переиспользуется, а не
/// гоняется Ghostscript заново при каждой правке настроек/переселекте (в логах был
/// шторм: один 33-стр. документ рендерился ~11 раз за 30с).
///
/// Включаем ТОЛЬКО поля, влияющие на растр страниц документа. paper_size, rotation,
/// fit_mode, orientation, borderless и т.п. меняют раскладку на ЛИСТЕ при печати, но
/// не картинку постраничного предпросмотра — их в ключ не берём, иначе кэш не попадает.
fn document_preview_cache_key(body: &PreviewRequestDto) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"docpreview-v1\0");
    hasher.update(body.file_url.as_bytes());
    hasher.update([0u8]);
    hasher.update(sanitize_color_mode(body.color_mode.as_deref()).as_bytes());
    hasher.update([0u8]);
    hasher.update(body.dpi.unwrap_or(0).to_le_bytes());
    hasher.update(body.resolution_dpi.unwrap_or(0).to_le_bytes());
    hasher.update(body.font_size_delta_pt.unwrap_or(0).to_le_bytes());
    hasher.update(body.preview_width.unwrap_or(0).to_le_bytes());
    hasher.update([body.booklet.unwrap_or(false) as u8]);
    hasher.update(body.page.unwrap_or(0).to_le_bytes());
    format!("doc-{:x}", hasher.finalize())
}

/// Текущее значение превью в Redis (None если ключа нет). Сравнивая с PENDING/ERROR
/// сентинелами, вызывающий решает: переиспользовать готовый блоб, дождаться рендера
/// или запустить новый.
async fn peek_preview_bytes(redis_url: &str, preview_id: &str) -> Result<Option<Vec<u8>>> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = format!("print:preview:{preview_id}");
    let value: Option<Vec<u8>> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis GET failed: {e}")))?;
    Ok(value)
}

/// Освежить TTL горячего превью при попадании в кэш, чтобы оно не протухло пока
/// оператор листает/правит настройки.
async fn refresh_preview_ttl(redis_url: &str, preview_id: &str) -> Result<()> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;
    let key = format!("print:preview:{preview_id}");
    let _: () = redis::cmd("EXPIRE")
        .arg(&key)
        .arg(PREVIEW_TTL_SECONDS)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis EXPIRE failed: {e}")))?;
    Ok(())
}

async fn resolve_printable_area(
    state: &AppState,
    printer_id: Option<&str>,
    paper_size: &str,
    borderless: bool,
) -> Result<Option<PrintableAreaMm>> {
    if borderless {
        return Ok(None);
    }

    let printer_id = printer_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
        .ok_or_else(|| {
            AppError::bad_request("printer_id обязателен для точного preview с полями")
        })?;
    let printer_uuid =
        Uuid::parse_str(printer_id).map_err(|_| AppError::bad_request("Invalid printer_id"))?;
    let printer = sqlx::query_as::<_, PrinterRow>(
        "SELECT * FROM printers WHERE id = $1 AND is_active = TRUE",
    )
    .bind(printer_uuid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {printer_uuid}")))?;
    let cups_printer = printer
        .cups_printer_name
        .as_deref()
        .ok_or_else(|| AppError::service_unavailable("Для принтера не настроена CUPS очередь"))?;

    ppd::printable_area_for_printer(cups_printer, paper_size, false)
        .map(Some)
        .map_err(|e| {
            AppError::service_unavailable(format!(
                "Не удалось получить точные поля из CUPS PPD: {e}"
            ))
        })
}

fn sanitize_orientation(value: Option<&str>) -> &str {
    match value {
        Some(mode @ ("portrait" | "landscape" | "auto")) => mode,
        _ => "auto",
    }
}

fn sanitize_fit_mode(value: Option<&str>) -> &str {
    match value {
        Some(mode @ ("fit" | "fill" | "stretch" | "actual")) => mode,
        _ => "fit",
    }
}

fn sanitize_color_mode(value: Option<&str>) -> &str {
    match value {
        Some("bw") => "bw",
        _ => "color",
    }
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

fn crop_from_dto(dto: &LayoutSheetPreviewImageDto) -> Option<CropRect> {
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
    let bytes = source_file::read_source_bytes(
        config,
        client,
        url,
        MAX_LAYOUT_PREVIEW_IMAGE_BYTES,
        "изображение",
    )
    .await?;
    cache.insert(url.to_string(), bytes.clone());
    Ok(bytes)
}

fn cleanup_temp(path: &FsPath) {
    if let Err(err) = std::fs::remove_file(path) {
        tracing::debug!(path = %path.display(), error = %err, "Preview temp cleanup skipped");
    }
}

/// GET /api/print/preview/:id — Get rendered preview image.
///
/// Returns the JPEG image directly if ready, or 202 Accepted if still rendering.
pub async fn get_preview(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<String>,
) -> std::result::Result<impl IntoResponse, AppError> {
    let Some(ref redis_url) = state.config.redis_url else {
        return Err(AppError::service_unavailable("Redis не настроен"));
    };

    let redis_client = redis::Client::open(redis_url.as_str())
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = format!("print:preview:{id}");
    let value: Option<Vec<u8>> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis GET failed: {e}")))?;

    match value {
        None => Err(AppError::not_found("Preview не найден или истёк")),
        Some(data) => {
            if data == PREVIEW_PENDING_VALUE {
                // Still waiting for agent to render
                Ok((
                    StatusCode::ACCEPTED,
                    [(header::CONTENT_TYPE, "application/json")],
                    serde_json::json!({"status": "pending"})
                        .to_string()
                        .into_bytes(),
                ))
            } else if data == PREVIEW_ERROR_VALUE {
                Err(AppError::bad_request("Не удалось подготовить предпросмотр"))
            } else {
                // Return JPEG image
                Ok((StatusCode::OK, [(header::CONTENT_TYPE, "image/jpeg")], data))
            }
        }
    }
}
