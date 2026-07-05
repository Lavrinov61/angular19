use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::conversion::detect::{DocumentType, detect_file_type};
use crate::cups::ppd;
use crate::error::{AppError, Result};
use crate::handlers::business_card::{
    BusinessCardPrintJobRequest, fetch_business_card_sheet_price,
    is_business_card_document_template, validate_business_card_print_job_request,
    validate_business_card_printer_driver,
};
use crate::middleware::auth::Claims;
use crate::models::job::*;
use crate::models::printer::PrinterRow;

const USER_SUBMISSION_RATE_LIMIT_PER_MINUTE: i64 = 10;
const USER_JOB_RATE_LIMIT_PER_MINUTE: i64 = 100;
const TONER_REFERENCE_COVERAGE_PERCENT: f64 = 5.0;
const BLACK_TONER_YIELD_PAGES: f64 = 15_500.0;
const COLOR_TONER_YIELD_PAGES: f64 = 8_500.0;

/// Validate file_url to prevent SSRF attacks (reuses coverage.rs pattern).
pub(crate) fn validate_file_url(url_str: &str) -> Result<()> {
    let parsed =
        url::Url::parse(url_str).map_err(|_| AppError::bad_request("Невалидный URL файла"))?;

    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return Err(AppError::bad_request("URL должен использовать HTTP/HTTPS"));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::bad_request("URL должен содержать хост"))?;

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

    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                if v4.is_private() || v4.is_loopback() || v4.is_link_local() {
                    return Err(AppError::bad_request("Доступ к приватным IP запрещён"));
                }
            }
            std::net::IpAddr::V6(v6) => {
                if v6.is_loopback() {
                    return Err(AppError::bad_request("Доступ к loopback запрещён"));
                }
            }
        }
    }

    let allowed_domains_env =
        std::env::var("PREVIEW_ALLOWED_DOMAINS").unwrap_or_else(|_| "svoefoto.ru".to_string());
    let allowed_domains: Vec<&str> = allowed_domains_env.split(',').map(|s| s.trim()).collect();
    if !allowed_domains.iter().any(|d| host.ends_with(d)) {
        tracing::warn!("Job create blocked: unknown host {}", host);
        return Err(AppError::bad_request(
            "URL файла должен быть с разрешённого домена",
        ));
    }

    Ok(())
}

fn normalized_quality_token(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '-' | '_' | '/'))
        .collect()
}

pub(crate) fn default_quality_id(caps: &Value, printer_type: &str) -> String {
    let Some(modes) = caps["quality_modes"].as_array() else {
        return "normal".to_string();
    };

    if printer_type.eq_ignore_ascii_case("photo") {
        if let Some(photo_mode) = modes.iter().find(|mode| {
            let id = normalized_quality_token(mode["id"].as_str().unwrap_or_default());
            let name = normalized_quality_token(mode["name"].as_str().unwrap_or_default());
            id == "photo" || id == "best" || name.contains("фото") || name.contains("лучшее")
        }) {
            if let Some(id) = photo_mode["id"].as_str() {
                return id.to_string();
            }
        }
    }

    let standard_mode = modes.iter().find(|mode| {
        let id = normalized_quality_token(mode["id"].as_str().unwrap_or_default());
        let name = normalized_quality_token(mode["name"].as_str().unwrap_or_default());
        id == "standard"
            || id == "normal"
            || name.contains("standard")
            || name.contains("стандарт")
            || name.contains("обыч")
    });

    standard_mode
        .or_else(|| modes.first())
        .and_then(|mode| mode["id"].as_str())
        .unwrap_or("normal")
        .to_string()
}

/// Scan file for malware using ClamAV daemon. Returns Ok(()) if clean or unavailable.
async fn scan_file_for_malware(file_url: &str) -> Result<()> {
    // Only scan local files
    if !file_url.starts_with("/uploads/") && !file_url.starts_with("/var/") {
        return Ok(());
    }

    let file_path = if file_url.starts_with("/uploads/") {
        format!("/var/www/apimain/angular-app/{}", file_url)
    } else {
        file_url.to_string()
    };

    // Check file exists before scanning
    if !tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
        return Ok(());
    }

    let output = tokio::process::Command::new("clamdscan")
        .arg("--no-summary")
        .arg("--fdpass")
        .arg(&file_path)
        .output()
        .await;

    match output {
        Ok(result) => {
            if !result.status.success() {
                let stdout = String::from_utf8_lossy(&result.stdout);
                if stdout.contains("FOUND") {
                    return Err(AppError::bad_request(&format!(
                        "Файл заражён: {}",
                        stdout.trim()
                    )));
                }
                // exit code 2 = daemon error — skip
            }
            Ok(())
        }
        Err(_) => {
            // clamdscan not available — skip
            Ok(())
        }
    }
}

fn normalized_limited(value: Option<&str>, max_chars: usize) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(max_chars).collect())
}

fn request_trace_id(body_trace_id: Option<&str>, headers: &HeaderMap) -> Option<String> {
    normalized_limited(
        body_trace_id.or_else(|| headers.get("x-request-id").and_then(|v| v.to_str().ok())),
        128,
    )
}

fn submission_rate_limit_key(trace_id: Option<&str>, order_id: Option<&str>) -> Option<String> {
    normalized_limited(trace_id.or(order_id), 128)
}

fn linked_photo_print_order_id(order_id: Option<&str>, exists: bool) -> Option<String> {
    if !exists {
        return None;
    }

    order_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) async fn resolve_photo_print_order_id(
    state: &AppState,
    order_id: Option<&str>,
) -> Result<Option<String>> {
    let Some(order_id) = order_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return Ok(None);
    };

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
           SELECT 1 FROM photo_print_orders
            WHERE order_id = $1
         )",
    )
    .bind(&order_id)
    .fetch_one(&state.db)
    .await?;

    if exists {
        Ok(linked_photo_print_order_id(Some(&order_id), true))
    } else {
        tracing::warn!(
            order_id = %order_id,
            "Ignoring print job order_id that is not present in photo_print_orders"
        );
        Ok(linked_photo_print_order_id(Some(&order_id), false))
    }
}

/// Validates that a status transition is allowed by the state machine.
/// Returns true if the transition from `from` to `to` is valid.
pub fn is_valid_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        (
            "queued",
            "sending" | "paused" | "held" | "scheduled" | "cancelled" | "splitting"
        ) | (
            "sending",
            "applying_icc" | "rendering_layout" | "printing" | "failed" | "paused" | "cancelled"
        ) | ("applying_icc", "rendering_layout" | "sending" | "failed")
            | ("rendering_layout", "printing" | "sending" | "failed")
            | ("converting", "queued" | "failed" | "cancelled")
            | ("printing", "completed" | "failed" | "finishing")
            | ("failed", "queued")
            | ("cancelled", "queued")
            | ("paused", "queued" | "cancelled")
            | ("held", "queued" | "cancelled")
            | ("scheduled", "queued" | "cancelled")
            | ("splitting", "queued" | "failed")
            | ("finishing", "completed" | "failed")
    )
}

fn normalize_font_size_delta(value: Option<i16>, doc_type: DocumentType) -> Result<Option<i16>> {
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

fn normalize_rendering_intent(value: Option<&str>) -> Result<&str> {
    match value.unwrap_or("perceptual") {
        intent @ ("perceptual"
        | "relative_colorimetric"
        | "saturation"
        | "absolute_colorimetric") => Ok(intent),
        _ => Err(AppError::bad_request(
            "rendering_intent должен быть perceptual, relative_colorimetric, saturation или absolute_colorimetric",
        )),
    }
}

fn normalize_image_adjustment(value: Option<i16>, min: i16, max: i16) -> i16 {
    value.unwrap_or(0).clamp(min, max)
}

fn normalize_coverage_percent(value: Option<f64>) -> Result<Option<f64>> {
    let Some(coverage) = value else {
        return Ok(None);
    };

    if !coverage.is_finite() {
        return Err(AppError::bad_request("coverage_percent должен быть числом"));
    }

    if !(0.0..=100.0).contains(&coverage) {
        return Err(AppError::bad_request(
            "coverage_percent должен быть от 0 до 100",
        ));
    }

    Ok(Some(coverage))
}

fn selected_page_count(pages: Option<&[i32]>) -> usize {
    pages
        .map(|items| items.iter().filter(|page| **page > 0).count())
        .filter(|count| *count > 0)
        .unwrap_or(1)
}

fn paper_area_factor(paper_size: &str) -> f64 {
    if paper_size.eq_ignore_ascii_case("A3") {
        2.0
    } else {
        1.0
    }
}

fn is_bw_color_mode(color_mode: &str) -> bool {
    matches!(
        color_mode.to_ascii_lowercase().as_str(),
        "bw" | "black" | "gray" | "grayscale" | "mono" | "monochrome"
    )
}

fn round_coverage_value(value: f64, scale: f64) -> f64 {
    (value * scale).round() / scale
}

fn toner_percent_for_pages(
    sheet_count: f64,
    coverage_percent: f64,
    yield_pages: f64,
    area_factor: f64,
) -> f64 {
    sheet_count * area_factor * (coverage_percent / TONER_REFERENCE_COVERAGE_PERCENT) * 100.0
        / yield_pages
}

fn add_toner_estimate(toner_percent: &mut serde_json::Map<String, Value>, key: &str, amount: f64) {
    let rounded = round_coverage_value(amount, 10_000.0);
    if rounded > 0.0 {
        toner_percent.insert(key.to_string(), json!(rounded));
    }
}

fn estimate_coverage_consumable_usage(
    coverage_percent: Option<f64>,
    paper_size: &str,
    color_mode: &str,
    media_type: Option<&str>,
    copies: i32,
    pages: Option<&[i32]>,
) -> Result<Option<Value>> {
    let Some(coverage_percent) = normalize_coverage_percent(coverage_percent)? else {
        return Ok(None);
    };

    if coverage_percent <= 0.0 {
        return Ok(None);
    }

    let copies = copies.max(1);
    let page_count = selected_page_count(pages);
    let sheet_count = copies as f64 * page_count as f64;
    let area_factor = paper_area_factor(paper_size);
    let mut toner_percent = serde_json::Map::new();

    if is_bw_color_mode(color_mode) {
        add_toner_estimate(
            &mut toner_percent,
            "black",
            toner_percent_for_pages(
                sheet_count,
                coverage_percent,
                BLACK_TONER_YIELD_PAGES,
                area_factor,
            ),
        );
    } else {
        add_toner_estimate(
            &mut toner_percent,
            "black",
            toner_percent_for_pages(
                sheet_count,
                coverage_percent * 0.4,
                BLACK_TONER_YIELD_PAGES,
                area_factor,
            ),
        );
        for key in ["cyan", "magenta", "yellow"] {
            add_toner_estimate(
                &mut toner_percent,
                key,
                toner_percent_for_pages(
                    sheet_count,
                    coverage_percent * 0.2,
                    COLOR_TONER_YIELD_PAGES,
                    area_factor,
                ),
            );
        }
    }

    if toner_percent.is_empty() {
        return Ok(None);
    }

    Ok(Some(json!({
        "source": "coverage_estimate",
        "coverage_percent": round_coverage_value(coverage_percent, 100.0),
        "estimated_pages": page_count,
        "sheets_used": copies * page_count as i32,
        "sheet_equivalent": round_coverage_value(sheet_count * area_factor, 100.0),
        "paper_size": paper_size,
        "media_type": media_type,
        "color_mode": color_mode,
        "toner_percent": Value::Object(toner_percent),
    })))
}

/// POST /api/print/jobs — create print job
pub async fn create(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Json(body): Json<CreatePrintJobDto>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() {
        return Err(AppError::bad_request("file_url обязателен"));
    }

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    // Trace ID: prefer body, fallback to X-Request-Id header. A batch of normal
    // photo jobs shares one trace_id and counts as one operator submission.
    // Existing deployed clients may not send trace_id yet, so order_id is the
    // compatibility key for package-print jobs from one order/session.
    let trace_id = request_trace_id(body.trace_id.as_deref(), &headers);
    let submission_key = submission_rate_limit_key(trace_id.as_deref(), body.order_id.as_deref());

    let current_submission_seen = if let Some(submission_key) = submission_key.as_deref() {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
               SELECT 1 FROM print_jobs
                WHERE created_by = $1
                  AND COALESCE(NULLIF(trace_id, ''), NULLIF(order_id, '')) = $2
                  AND created_at > NOW() - INTERVAL '1 minute'
             )",
        )
        .bind(user_id)
        .bind(submission_key)
        .fetch_one(&state.db)
        .await?
    } else {
        false
    };

    let recent_submission_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT COALESCE(NULLIF(trace_id, ''), NULLIF(order_id, ''), id::text))
           FROM print_jobs
          WHERE created_by = $1
            AND created_at > NOW() - INTERVAL '1 minute'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    if recent_submission_count >= USER_SUBMISSION_RATE_LIMIT_PER_MINUTE && !current_submission_seen
    {
        return Err(AppError::bad_request(
            "Слишком много заданий. Подождите минуту.",
        ));
    }

    let recent_job_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
           FROM print_jobs
          WHERE created_by = $1
            AND created_at > NOW() - INTERVAL '1 minute'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    if recent_job_count >= USER_JOB_RATE_LIMIT_PER_MINUTE {
        return Err(AppError::bad_request(
            "Слишком много заданий в пакете. Разбейте пакет на части.",
        ));
    }

    // Detect document type from file URL
    let doc_type = detect_file_type(&body.file_url);

    if doc_type.is_document() {
        return create_conversion_job(
            &state,
            &claims,
            &body,
            user_id,
            doc_type,
            trace_id.as_deref(),
        )
        .await;
    }

    // ── Raster flow (existing) ──
    let printer_id = Uuid::parse_str(&body.printer_id)
        .map_err(|_| AppError::bad_request("Invalid printer_id"))?;

    // Fetch printer for defaults
    let printer = sqlx::query_as::<_, PrinterRow>(
        "SELECT * FROM printers WHERE id = $1 AND is_active = TRUE",
    )
    .bind(printer_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {printer_id}")))?;

    let copies = body.copies.unwrap_or(1);
    if !(1..=999).contains(&copies) {
        return Err(AppError::bad_request("copies должен быть от 1 до 999"));
    }

    // Parse capabilities for defaults
    let caps: serde_json::Value = printer.capabilities.clone();
    let default_paper = caps["paper_sizes"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v["id"].as_str())
        .unwrap_or("A4");
    let default_media = caps["media_types"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v["id"].as_str());
    let default_quality = default_quality_id(&caps, &printer.printer_type);

    let default_fit = if printer.printer_type == "photo" {
        "fill"
    } else {
        "fit"
    };

    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .ok()
        .flatten()
        .or(printer.studio_id); // fallback to printer's studio
    let receipt_uuid = body
        .receipt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid receipt_id"))?;
    let customer_uuid = body
        .customer_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid customer_id"))?;
    let icc_uuid = body
        .icc_profile_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid icc_profile_id"))?;

    let color_mode = match body.color_mode.as_deref() {
        Some("bw") => "bw",
        _ => "color",
    };
    let orientation = match body.orientation.as_deref() {
        Some("portrait") => "portrait",
        Some("landscape") => "landscape",
        _ => "auto",
    };
    let fit_mode = match body.fit_mode.as_deref() {
        Some(f @ ("fit" | "fill" | "stretch" | "actual")) => f,
        _ => default_fit,
    };
    let paper_size = body.paper_size.as_deref().unwrap_or(default_paper);
    let borderless = body.borderless.unwrap_or(false);
    let media_type = body.media_type.as_deref().or(default_media);

    if !borderless {
        let cups_printer = printer.cups_printer_name.as_deref().ok_or_else(|| {
            AppError::service_unavailable("Для принтера не настроена CUPS очередь")
        })?;
        ppd::printable_area_for_printer(cups_printer, paper_size, false).map_err(|e| {
            AppError::service_unavailable(format!(
                "Не удалось получить точные поля из CUPS PPD: {e}"
            ))
        })?;
    }

    // ── Finishing validation: check printer supports requested operations ──
    if let Some(ref ops) = body.finishing_ops {
        if !ops.is_empty() {
            let supported: Vec<String> = caps
                .get("finishing")
                .and_then(|f| f.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            for op in ops {
                if !supported.iter().any(|s| s == op) {
                    return Err(AppError::bad_request(format!(
                        "Принтер не поддерживает операцию: {op}"
                    )));
                }
            }
        }
    }

    let is_business_card =
        is_business_card_document_template(body.document_template_slug.as_deref());
    let business_card_spec = if is_business_card {
        let spec = validate_business_card_print_job_request(BusinessCardPrintJobRequest {
            paper_size: body.paper_size.as_deref(),
            color_mode,
            borderless: body.borderless.unwrap_or(false),
            duplex: body.duplex.unwrap_or(false),
            media_type: body.media_type.as_deref(),
            paper_source: body.paper_source.as_deref(),
            layout_rows: body.layout_rows,
            layout_cols: body.layout_cols,
            photo_width_mm: body.custom_photo_width_mm,
            photo_height_mm: body.custom_photo_height_mm,
            cut_marks: body.cut_marks.unwrap_or(false),
            cut_margin_mm: body.cut_margin_mm,
            cut_mark_length_mm: body.cut_mark_length_mm,
            cut_mark_offset_mm: body.cut_mark_offset_mm,
            finishing_ops: body.finishing_ops.as_deref(),
        })?;
        validate_business_card_printer_driver(&printer, body.media_type.as_deref()).await?;
        Some(spec)
    } else {
        None
    };

    let business_card_sheet_price = if let Some(spec) = business_card_spec {
        Some(fetch_business_card_sheet_price(&state.db, &printer, studio_uuid, spec).await?)
    } else {
        None
    };

    let final_price_total = if let Some(sheet_price) = business_card_sheet_price {
        Some(sheet_price * copies as f64)
    } else {
        body.price_total
    };

    let priority = body.priority.unwrap_or(0).clamp(0, 10);
    let rendering_intent = normalize_rendering_intent(body.rendering_intent.as_deref())?;

    let preset_uuid = body
        .preset_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid preset_id"))?;

    // S21: File validation (content-type + SSRF)
    validate_file_url(&body.file_url)?;
    scan_file_for_malware(&body.file_url).await?;

    // S20: Build banner_info JSON if banner_page requested
    let banner_info: Option<serde_json::Value> = if body.banner_page.unwrap_or(false) {
        Some(json!({
            "file_name": body.file_name,
            "printer_id": body.printer_id,
            "paper_size": body.paper_size,
            "copies": body.copies.unwrap_or(1),
            "color_mode": color_mode,
            "orientation": orientation,
            "created_at": chrono::Utc::now().to_rfc3339(),
        }))
    } else {
        None
    };

    // Validate secure_pin
    if let Some(ref pin) = body.secure_pin {
        if !pin.is_empty() && (!pin.chars().all(|c| c.is_ascii_digit()) || pin.len() > 8) {
            return Err(AppError::bad_request(
                "secure_pin must be digits only (max 8)",
            ));
        }
    }

    let coverage_consumable_usage = estimate_coverage_consumable_usage(
        body.coverage_percent,
        paper_size,
        color_mode,
        media_type,
        copies,
        body.pages.as_deref(),
    )?;
    let linked_order_id = resolve_photo_print_order_id(&state, body.order_id.as_deref()).await?;

    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"INSERT INTO print_jobs (
             printer_id, file_url, file_name,
             copies, paper_size, color_mode, quality, duplex,
             orientation, borderless, media_type, fit_mode,
             order_id, order_type, receipt_id,
             customer_id, service_slug, document_template_slug,
             icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
             layout_rows, layout_cols, cut_margin_mm,
             custom_photo_width_mm, custom_photo_height_mm, rotation,
             created_by, studio_id, status, priority, price_total,
             preset_id, trace_id, paper_source,
             watermark_text, watermark_opacity, watermark_position,
             banner_page, banner_info,
             mirror, crop_x, crop_y, crop_width, crop_height,
             nup, "collate", resolution_dpi, color_auto_detect, booklet,
             pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
             duplex_mode, scaling_percent, output_bin, toner_save,
             department_id, secure_pin, gray_mode, rendering_intent,
             photo_enhance, brightness, contrast, saturation,
             consumable_usage
           ) VALUES (
             $1, $2, $3,
             $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15,
             $16, $17, $18,
             $19, $20, $21, $22,
             $23, $24, $25,
             $26, $27, $28,
             $29, $30, 'queued', $31, $32,
             $33, $34, $35,
             $36, $37, $38,
             $39, $40,
             $41, $42, $43, $44, $45,
             $46, $47, $48, $49, $50,
             $51, $52, $53, $54, $55,
             $56, $57, $58, $59,
             $60, $61, $62, $63,
             $64, $65, $66, $67,
             $68
           ) RETURNING
             *,
             NULL::text AS printer_name,
             NULL::text AS printer_type,
             NULL::text AS creator_name"#,
    )
    .bind(printer_id)
    .bind(&body.file_url)
    .bind(&body.file_name)
    .bind(copies)
    .bind(paper_size)
    .bind(color_mode)
    .bind(body.quality.as_deref().unwrap_or(default_quality.as_str()))
    .bind(body.duplex.unwrap_or(false))
    .bind(orientation)
    .bind(borderless)
    .bind(media_type)
    .bind(fit_mode)
    .bind(&linked_order_id)
    .bind(&body.order_type)
    .bind(receipt_uuid)
    .bind(customer_uuid)
    .bind(&body.service_slug)
    .bind(&body.document_template_slug)
    .bind(icc_uuid)
    .bind(body.cut_marks.unwrap_or(false))
    .bind(body.cut_mark_length_mm)
    .bind(body.cut_mark_offset_mm)
    .bind(body.layout_rows)
    .bind(body.layout_cols)
    .bind(body.cut_margin_mm)
    .bind(body.custom_photo_width_mm)
    .bind(body.custom_photo_height_mm)
    .bind(body.rotation)
    .bind(user_id)
    .bind(studio_uuid)
    .bind(priority)
    .bind(final_price_total)
    .bind(preset_uuid)
    .bind(&trace_id)
    .bind(body.paper_source.as_deref().unwrap_or("auto"))
    .bind(&body.watermark_text) // $36
    .bind(body.watermark_opacity) // $37
    .bind(body.watermark_position.as_deref().unwrap_or("center")) // $38
    .bind(body.banner_page.unwrap_or(false)) // $39
    .bind(&banner_info) // $40
    .bind(body.mirror.unwrap_or(false)) // $41
    .bind(body.crop_x) // $42
    .bind(body.crop_y) // $43
    .bind(body.crop_width) // $44
    .bind(body.crop_height) // $45
    .bind(body.nup.unwrap_or(1)) // $46
    .bind(body.collate.unwrap_or(true)) // $47
    .bind(body.resolution_dpi.unwrap_or(0)) // $48
    .bind(body.color_auto_detect.unwrap_or(false)) // $49
    .bind(body.booklet.unwrap_or(false)) // $50
    .bind(body.pages_per_sheet.unwrap_or(0)) // $51
    .bind(body.binding.as_deref().unwrap_or("")) // $52
    .bind(body.staple_position.as_deref().unwrap_or("")) // $53
    .bind(body.hole_punch.as_deref().unwrap_or("")) // $54
    .bind(body.hole_punch_type.as_deref().unwrap_or("")) // $55
    .bind(body.duplex_mode.as_deref().unwrap_or("")) // $56
    .bind(body.scaling_percent.unwrap_or(0)) // $57
    .bind(body.output_bin.as_deref().unwrap_or("")) // $58
    .bind(body.toner_save.as_deref().unwrap_or("off")) // $59
    .bind(body.department_id.as_deref().unwrap_or("")) // $60
    .bind(body.secure_pin.as_deref().unwrap_or("")) // $61
    .bind(body.gray_mode.as_deref().unwrap_or("")) // $62
    .bind(rendering_intent) // $63
    .bind(body.photo_enhance.unwrap_or(false)) // $64
    .bind(normalize_image_adjustment(body.brightness, -40, 40)) // $65
    .bind(normalize_image_adjustment(body.contrast, -40, 40)) // $66
    .bind(normalize_image_adjustment(body.saturation, -60, 60)) // $67
    .bind(&coverage_consumable_usage) // $68
    .fetch_one(&state.db)
    .await?;

    // Override joined fields from the printer we already fetched
    let mut job_value = serde_json::to_value(&job)?;
    job_value["printer_name"] = json!(printer.name);
    job_value["printer_type"] = json!(printer.printer_type);

    Ok(Json(json!({ "success": true, "job": job_value })))
}

/// Create a parent conversion job + conversion_task for document files (PDF, DOCX, XLSX, etc.)
async fn create_conversion_job(
    state: &AppState,
    claims: &Claims,
    body: &CreatePrintJobDto,
    user_id: Uuid,
    doc_type: DocumentType,
    trace_id: Option<&str>,
) -> Result<Json<Value>> {
    let doc_type_str = doc_type.to_string().to_lowercase();

    // printer_id is optional for conversion jobs — parse if provided, else NULL
    let printer_uuid: Option<Uuid> = if body.printer_id.is_empty() || body.printer_id == "auto" {
        None
    } else {
        Some(
            Uuid::parse_str(&body.printer_id)
                .map_err(|_| AppError::bad_request("Invalid printer_id"))?,
        )
    };

    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .ok()
        .flatten();
    let receipt_uuid = body
        .receipt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid receipt_id"))?;
    let customer_uuid = body
        .customer_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid customer_id"))?;
    let icc_uuid = body
        .icc_profile_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid icc_profile_id"))?;

    let copies = body.copies.unwrap_or(1);
    if !(1..=999).contains(&copies) {
        return Err(AppError::bad_request("copies должен быть от 1 до 999"));
    }
    let dpi = body.dpi.unwrap_or(300);
    let priority = body.priority.unwrap_or(0).clamp(0, 10);
    let font_size_delta_pt = normalize_font_size_delta(body.font_size_delta_pt, doc_type)?;
    let rendering_intent = normalize_rendering_intent(body.rendering_intent.as_deref())?;
    let paper_size = body.paper_size.as_deref().unwrap_or("A4");
    let color_mode = body.color_mode.as_deref().unwrap_or("color");
    let media_type = body.media_type.as_deref();

    let preset_uuid = body
        .preset_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid preset_id"))?;

    let banner_info: Option<serde_json::Value> = if body.banner_page.unwrap_or(false) {
        Some(json!({
            "file_name": body.file_name,
            "printer_id": body.printer_id,
            "paper_size": paper_size,
            "copies": copies,
            "color_mode": color_mode,
            "orientation": body.orientation.as_deref().unwrap_or("auto"),
            "created_at": chrono::Utc::now().to_rfc3339(),
        }))
    } else {
        None
    };

    if let Some(ref pin) = body.secure_pin {
        if !pin.is_empty() && (!pin.chars().all(|c| c.is_ascii_digit()) || pin.len() > 8) {
            return Err(AppError::bad_request(
                "secure_pin must be digits only (max 8)",
            ));
        }
    }

    let coverage_consumable_usage = estimate_coverage_consumable_usage(
        body.coverage_percent,
        paper_size,
        color_mode,
        media_type,
        copies,
        body.pages.as_deref(),
    )?;
    let linked_order_id = resolve_photo_print_order_id(state, body.order_id.as_deref()).await?;

    // Insert parent print_job with status='converting'
    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"INSERT INTO print_jobs (
             printer_id, file_url, file_name,
             copies, paper_size, color_mode, quality, duplex,
             orientation, borderless, media_type, fit_mode,
             order_id, order_type, receipt_id,
             customer_id, service_slug, document_template_slug,
             icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
             layout_rows, layout_cols, cut_margin_mm,
             custom_photo_width_mm, custom_photo_height_mm, rotation,
             created_by, studio_id, status, priority, price_total,
             source_file_url, source_file_type, conversion_dpi, font_size_delta_pt,
             preset_id, trace_id, paper_source,
             watermark_text, watermark_opacity, watermark_position,
             banner_page, banner_info,
             mirror, crop_x, crop_y, crop_width, crop_height,
             nup, "collate", resolution_dpi, color_auto_detect, booklet,
             pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
             duplex_mode, scaling_percent, output_bin, toner_save,
             department_id, secure_pin, gray_mode, rendering_intent,
             consumable_usage
           ) VALUES (
             $1, $2, $3,
             $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15,
             $16, $17, $18,
             $19, $20, $21, $22,
             $23, $24, $25,
             $26, $27, $28,
             $29, $30, 'converting', $31, $32,
             $2, $33, $34, $35,
             $36, $37, $38,
             $39, $40, $41,
             $42, $43,
             $44, $45, $46, $47, $48,
             $49, $50, $51, $52, $53,
             $54, $55, $56, $57, $58,
             $59, $60, $61, $62,
             $63, $64, $65, $66,
             $67
           ) RETURNING
             *,
             NULL::text AS printer_name,
             NULL::text AS printer_type,
             NULL::text AS creator_name"#,
    )
    .bind(printer_uuid) // $1
    .bind(&body.file_url) // $2
    .bind(&body.file_name) // $3
    .bind(copies) // $4
    .bind(paper_size) // $5
    .bind(color_mode) // $6
    .bind(body.quality.as_deref().unwrap_or("normal")) // $7
    .bind(body.duplex.unwrap_or(false)) // $8
    .bind(body.orientation.as_deref().unwrap_or("auto")) // $9
    .bind(body.borderless.unwrap_or(false)) // $10
    .bind(media_type) // $11
    .bind(body.fit_mode.as_deref().unwrap_or("fit")) // $12
    .bind(&linked_order_id) // $13
    .bind(&body.order_type) // $14
    .bind(receipt_uuid) // $15
    .bind(customer_uuid) // $16
    .bind(&body.service_slug) // $17
    .bind(&body.document_template_slug) // $18
    .bind(icc_uuid) // $19
    .bind(body.cut_marks.unwrap_or(false)) // $20
    .bind(body.cut_mark_length_mm) // $21
    .bind(body.cut_mark_offset_mm) // $22
    .bind(body.layout_rows) // $23
    .bind(body.layout_cols) // $24
    .bind(body.cut_margin_mm) // $25
    .bind(body.custom_photo_width_mm) // $26
    .bind(body.custom_photo_height_mm) // $27
    .bind(body.rotation) // $28
    .bind(user_id) // $29
    .bind(studio_uuid) // $30
    .bind(priority) // $31
    .bind(body.price_total) // $32
    .bind(&doc_type_str) // $33
    .bind(dpi) // $34
    .bind(font_size_delta_pt) // $35
    .bind(preset_uuid) // $36
    .bind(trace_id) // $37
    .bind(body.paper_source.as_deref().unwrap_or("auto")) // $38
    .bind(&body.watermark_text) // $39
    .bind(body.watermark_opacity) // $40
    .bind(body.watermark_position.as_deref().unwrap_or("center")) // $41
    .bind(body.banner_page.unwrap_or(false)) // $42
    .bind(&banner_info) // $43
    .bind(body.mirror.unwrap_or(false)) // $44
    .bind(body.crop_x) // $45
    .bind(body.crop_y) // $46
    .bind(body.crop_width) // $47
    .bind(body.crop_height) // $48
    .bind(body.nup.unwrap_or(1)) // $49
    .bind(body.collate.unwrap_or(true)) // $50
    .bind(body.resolution_dpi.unwrap_or(0)) // $51
    .bind(body.color_auto_detect.unwrap_or(false)) // $52
    .bind(body.booklet.unwrap_or(false)) // $53
    .bind(body.pages_per_sheet.unwrap_or(0)) // $54
    .bind(body.binding.as_deref().unwrap_or("")) // $55
    .bind(body.staple_position.as_deref().unwrap_or("")) // $56
    .bind(body.hole_punch.as_deref().unwrap_or("")) // $57
    .bind(body.hole_punch_type.as_deref().unwrap_or("")) // $58
    .bind(body.duplex_mode.as_deref().unwrap_or("")) // $59
    .bind(body.scaling_percent.unwrap_or(0)) // $60
    .bind(body.output_bin.as_deref().unwrap_or("")) // $61
    .bind(body.toner_save.as_deref().unwrap_or("off")) // $62
    .bind(body.department_id.as_deref().unwrap_or("")) // $63
    .bind(body.secure_pin.as_deref().unwrap_or("")) // $64
    .bind(body.gray_mode.as_deref().unwrap_or("")) // $65
    .bind(rendering_intent) // $66
    .bind(&coverage_consumable_usage) // $67
    .fetch_one(&state.db)
    .await?;

    // Insert conversion_task
    sqlx::query(
        r#"INSERT INTO conversion_tasks (
             job_id, source_url, source_type, pages, dpi, status
           ) VALUES ($1, $2, $3, $4, $5, 'pending')"#,
    )
    .bind(job.id)
    .bind(&body.file_url)
    .bind(&doc_type_str)
    .bind(&body.pages)
    .bind(dpi)
    .execute(&state.db)
    .await?;

    let job_value = serde_json::to_value(&job)?;

    Ok(Json(json!({ "success": true, "job": job_value })))
}

/// GET /api/print/jobs — list queue with pagination & filters
pub async fn list(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<PrintQueueQuery>,
) -> Result<Json<Value>> {
    let studio_id = q.studio_id.as_deref().or(claims.studio_id.as_deref());

    let limit = q.limit.unwrap_or(50).min(500);
    let offset = q.offset.unwrap_or_else(|| {
        let page = q.page.unwrap_or(1).max(1);
        (page - 1) * limit
    });

    // Build WHERE dynamically
    let mut conditions: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    // Parse UUIDs up-front
    let printer_uuid = q
        .printer_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid printer_id"))?;

    let studio_uuid = studio_id
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let created_by_uuid = q
        .created_by
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid created_by"))?;

    // Detect whether search looks like a UUID
    let search_is_uuid = q
        .search
        .as_deref()
        .map(|s| Uuid::parse_str(s).is_ok())
        .unwrap_or(false);
    let search_pattern = q
        .search
        .as_deref()
        .filter(|_| !search_is_uuid)
        .map(|s| format!("%{s}%"));

    // printer_id
    if printer_uuid.is_some() {
        conditions.push(format!("pj.printer_id = ${param_idx}::uuid"));
        param_idx += 1;
    }
    // status
    if q.status.is_some() {
        conditions.push(format!("pj.status = ${param_idx}"));
        param_idx += 1;
    }
    // studio_id
    if studio_uuid.is_some() {
        conditions.push(format!("pj.studio_id = ${param_idx}::uuid"));
        param_idx += 1;
    }
    // created_by
    if created_by_uuid.is_some() {
        conditions.push(format!("pj.created_by = ${param_idx}::uuid"));
        param_idx += 1;
    }
    // date_from
    if q.date_from.is_some() {
        conditions.push(format!("pj.created_at >= ${param_idx}::timestamptz"));
        param_idx += 1;
    }
    // date_to
    if q.date_to.is_some() {
        conditions.push(format!(
            "pj.created_at < (${param_idx}::date + interval '1 day')"
        ));
        param_idx += 1;
    }
    // search (UUID exact match or file_name ILIKE)
    if q.search.is_some() {
        if search_is_uuid {
            conditions.push(format!("pj.id::text = ${param_idx}"));
        } else {
            conditions.push(format!("pj.file_name ILIKE ${param_idx}"));
        }
        param_idx += 1;
    }

    let _ = param_idx;
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let order_clause = match q.sort_by.as_deref().or(q.sort.as_deref()) {
        Some("created_at") | Some("created") => {
            let dir = if q.sort_order.as_deref() == Some("asc") {
                "ASC"
            } else {
                "DESC"
            };
            format!("ORDER BY pj.created_at {dir}")
        }
        Some("priority") => {
            let dir = if q.sort_order.as_deref() == Some("asc") {
                "ASC"
            } else {
                "DESC"
            };
            format!("ORDER BY pj.priority {dir}, pj.created_at ASC")
        }
        _ => "ORDER BY pj.priority DESC, pj.created_at ASC".to_string(),
    };

    let query_str = format!(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name,
                  COUNT(*) OVER() AS total_count
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           {where_clause}
           {order_clause}
           LIMIT {limit} OFFSET {offset}"#,
    );

    // Bind parameters in declaration order
    let mut query = sqlx::query_as::<_, PrintJobRow>(&query_str);
    if let Some(ref pid) = printer_uuid {
        query = query.bind(pid);
    }
    if let Some(ref s) = q.status {
        query = query.bind(s);
    }
    if let Some(ref sid) = studio_uuid {
        query = query.bind(sid);
    }
    if let Some(ref cid) = created_by_uuid {
        query = query.bind(cid);
    }
    if let Some(ref df) = q.date_from {
        query = query.bind(df);
    }
    if let Some(ref dt) = q.date_to {
        query = query.bind(dt);
    }
    if let Some(ref s) = q.search {
        if search_is_uuid {
            query = query.bind(s);
        } else {
            query = query.bind(search_pattern.as_ref().unwrap());
        }
    }

    let rows = query.fetch_all(&state.db).await?;

    let total = rows.first().and_then(|r| r.total_count).unwrap_or(0);
    let page = q.page.unwrap_or(1).max(1);
    let pages = if limit > 0 {
        (total as f64 / limit as f64).ceil() as i64
    } else {
        0
    };

    Ok(Json(json!({
        "success": true,
        "jobs": rows,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages
    })))
}

/// GET /api/print/jobs/:id — fetch one job including terminal statuses
pub async fn get_one(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let row = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.id = $1
             AND ($2::uuid IS NULL OR pj.studio_id = $2::uuid)"#,
    )
    .bind(id)
    .bind(studio_uuid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Задание печати не найдено: {id}")))?;

    Ok(Json(json!({
        "success": true,
        "job": row,
    })))
}

/// POST /api/print/jobs/:id/cancel
pub async fn cancel(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "cancelled") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> cancelled",
            status
        )));
    }

    sqlx::query("UPDATE print_jobs SET status = 'cancelled', completed_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    // Send cancel command to agent via MQTT
    if let Some(sid) = studio_id {
        let guard = state.mqtt_client.read().await;
        if let Some(ref client) = *guard {
            let topic = format!("svoefoto/{sid}/print/commands/cancel");
            let payload = json!({ "job_id": id.to_string() }).to_string();
            if let Err(e) = client
                .publish(
                    topic,
                    rumqttc::QoS::AtLeastOnce,
                    false,
                    payload.into_bytes(),
                )
                .await
            {
                tracing::warn!(job_id = %id, "MQTT cancel publish failed: {e}");
            }
        }
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/jobs/:id/retry
pub async fn retry(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    if !["failed", "cancelled"].contains(&job.status.as_str()) {
        return Err(AppError::conflict(
            "Можно повторить только неудавшееся или отменённое задание",
        ));
    }

    sqlx::query(
        "UPDATE print_jobs SET status = 'queued', error_message = NULL, completed_at = NULL WHERE id = $1"
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    let mut job_value = serde_json::to_value(&job)?;
    job_value["status"] = json!("queued");
    job_value["error_message"] = json!(null);

    Ok(Json(json!({ "success": true, "job": job_value })))
}

/// POST /api/print/jobs/:id/reprint — create new job from existing one
pub async fn reprint(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    // Verify original job exists
    let original = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;
    let studio_uuid = claims
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .ok()
        .flatten();

    // INSERT...SELECT copies all print settings from the original job
    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"INSERT INTO print_jobs (
             printer_id, file_url, file_name, copies, paper_size, color_mode, quality,
             duplex, orientation, borderless, media_type, fit_mode,
             order_id, order_type, receipt_id,
             customer_id, service_slug, document_template_slug,
             icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
             layout_rows, layout_cols, cut_margin_mm,
             custom_photo_width_mm, custom_photo_height_mm, rotation,
             original_job_id, created_by, studio_id, status, paper_source,
             mirror, crop_x, crop_y, crop_width, crop_height,
             photo_enhance, brightness, contrast, saturation,
             nup, "collate", resolution_dpi, color_auto_detect, booklet,
             pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
             duplex_mode, scaling_percent, output_bin, toner_save,
             department_id, secure_pin, gray_mode,
             watermark_text, watermark_opacity, watermark_position, banner_page,
             consumable_usage
           )
           SELECT
             printer_id, file_url, file_name, copies, paper_size, color_mode, quality,
             duplex, orientation, borderless, media_type, fit_mode,
             order_id, order_type, receipt_id,
             customer_id, service_slug, document_template_slug,
             icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
             layout_rows, layout_cols, cut_margin_mm,
             custom_photo_width_mm, custom_photo_height_mm, rotation,
             id, $2, $3, 'queued', paper_source,
             mirror, crop_x, crop_y, crop_width, crop_height,
             photo_enhance, brightness, contrast, saturation,
             nup, "collate", resolution_dpi, color_auto_detect, booklet,
             pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
             duplex_mode, scaling_percent, output_bin, toner_save,
             department_id, secure_pin, gray_mode,
             watermark_text, watermark_opacity, watermark_position, banner_page,
             consumable_usage
           FROM print_jobs WHERE id = $1
           RETURNING *,
             NULL::text AS printer_name,
             NULL::text AS printer_type,
             NULL::text AS creator_name"#,
    )
    .bind(id)
    .bind(user_id)
    .bind(studio_uuid)
    .fetch_one(&state.db)
    .await?;

    let mut job_value = serde_json::to_value(&job)?;
    job_value["printer_name"] = json!(original.printer_name);
    job_value["printer_type"] = json!(original.printer_type);

    Ok(Json(json!({ "success": true, "job": job_value })))
}

/// POST /api/print/jobs/:id/reassign — reassign job to another printer
pub async fn reassign(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<ReassignJobDto>,
) -> Result<Json<Value>> {
    // Fetch existing job with printer info
    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    // Only allow reassign for specific statuses
    if !["queued", "sending", "failed"].contains(&job.status.as_str()) {
        return Err(AppError::conflict(
            "Перенаправить можно только задание в статусе queued, sending или failed",
        ));
    }

    // Fetch target printer
    let target_printer = sqlx::query_as::<_, PrinterRow>(
        "SELECT * FROM printers WHERE id = $1 AND is_active = TRUE",
    )
    .bind(body.target_printer_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Целевой принтер не найден или неактивен"))?;

    // Validate printer type matches
    let source_type = job.printer_type.as_deref().unwrap_or("");
    if target_printer.printer_type != source_type {
        return Err(AppError::bad_request(format!(
            "Тип принтера не совпадает: источник={source_type}, цель={}",
            target_printer.printer_type
        )));
    }

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;
    let old_printer_id = job.printer_id;

    // Update job: reassign to target printer
    let updated = sqlx::query_as::<_, PrintJobRow>(
        r#"UPDATE print_jobs SET
             printer_id = $2,
             status = 'queued',
             error_message = NULL,
             reassigned_from = $3,
             reassign_reason = 'Manual reassign',
             reassigned_at = NOW(),
             reassigned_by = $4
           WHERE id = $1
           RETURNING *,
             NULL::text AS printer_name,
             NULL::text AS printer_type,
             NULL::text AS creator_name"#,
    )
    .bind(id)
    .bind(body.target_printer_id)
    .bind(old_printer_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    // ── Recalculate price based on new printer's presets ──
    let new_price = sqlx::query_scalar::<_, Option<bigdecimal::BigDecimal>>(
        "SELECT pp.price FROM print_presets pp WHERE pp.paper_size = $1 AND pp.printer_type = $2 AND pp.is_active = TRUE LIMIT 1"
    )
    .bind(&updated.paper_size)
    .bind(&target_printer.printer_type)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    if let Some(ref price) = new_price {
        sqlx::query("UPDATE print_jobs SET price_total = $2 * copies WHERE id = $1")
            .bind(id)
            .bind(price)
            .execute(&state.db)
            .await?;
    }

    // PG NOTIFY for print agent to pick up the job
    sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
        .bind(id.to_string())
        .execute(&state.db)
        .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "queued",
        "printer_id": body.target_printer_id,
        "reassigned_from": old_printer_id,
        "studio_id": updated.studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    let mut job_value = serde_json::to_value(&updated)?;
    job_value["printer_name"] = json!(target_printer.name);
    job_value["printer_type"] = json!(target_printer.printer_type);

    Ok(Json(json!({ "success": true, "job": job_value })))
}

/// POST /api/print/jobs/:id/pause — pause a queued/sending job
pub async fn pause_job(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "paused") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> paused",
            status
        )));
    }

    sqlx::query(
        "UPDATE print_jobs SET status = 'paused', held_by = $2, held_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "paused",
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/jobs/:id/resume — resume a paused/held job
pub async fn resume_job(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "queued") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> queued",
            status
        )));
    }

    sqlx::query(
        "UPDATE print_jobs SET status = 'queued', released_by = $2, released_at = NOW() WHERE id = $1"
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    // pg_notify for print agent to pick up
    sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
        .bind(json!({ "id": id, "studio_id": studio_id }).to_string())
        .execute(&state.db)
        .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "queued",
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/jobs/:id/hold — hold a queued/sending job (manual operator hold)
pub async fn hold_job(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "held") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> held",
            status
        )));
    }

    sqlx::query(
        "UPDATE print_jobs SET status = 'held', held_by = $2, held_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "held",
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/jobs/:id/release — release a held job back to queue
pub async fn release_job(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "queued") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> queued",
            status
        )));
    }

    sqlx::query(
        "UPDATE print_jobs SET status = 'queued', released_by = $2, released_at = NOW() WHERE id = $1"
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    // pg_notify for print agent to pick up
    sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
        .bind(json!({ "id": id, "studio_id": studio_id }).to_string())
        .execute(&state.db)
        .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "queued",
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

/// POST /api/print/jobs/:id/schedule — schedule a job for later printing
pub async fn schedule_job(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<crate::models::job::ScheduleJobDto>,
) -> Result<Json<Value>> {
    let row = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT status, studio_id FROM print_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    let (status, studio_id) = row;

    if !is_valid_transition(&status, "scheduled") {
        return Err(AppError::conflict(format!(
            "Невалидный переход статуса: {} -> scheduled",
            status
        )));
    }

    sqlx::query("UPDATE print_jobs SET status = 'scheduled', scheduled_at = $2 WHERE id = $1")
        .bind(id)
        .bind(body.scheduled_at)
        .execute(&state.db)
        .await?;

    // Redis PUBLISH for Socket.IO
    let redis_payload = serde_json::json!({
        "job_id": id,
        "status": "scheduled",
        "scheduled_at": body.scheduled_at,
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(
        json!({ "success": true, "scheduled_at": body.scheduled_at }),
    ))
}

/// PUT /api/print/jobs/:id/priority — set job priority
pub async fn set_priority(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<crate::models::job::SetPriorityDto>,
) -> Result<Json<Value>> {
    let priority = body.priority.clamp(0, 10);

    let updated = sqlx::query_scalar::<_, bool>(
        "UPDATE print_jobs SET priority = $2 WHERE id = $1 AND status IN ('queued', 'sending') RETURNING TRUE",
    )
    .bind(id)
    .bind(priority)
    .fetch_optional(&state.db)
    .await?;

    if updated.is_none() {
        return Err(AppError::not_found(
            "Задание не найдено или уже в обработке",
        ));
    }

    // Broadcast priority change via MQTT
    if let Ok(Some(studio_id)) =
        sqlx::query_scalar::<_, Uuid>("SELECT studio_id FROM print_jobs WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await
    {
        let guard = state.mqtt_client.read().await;
        if let Some(ref client) = *guard {
            let topic = format!("svoefoto/{}/print/commands/priority", studio_id);
            let payload = serde_json::to_vec(&json!({
                "job_id": id.to_string(),
                "priority": priority
            }))
            .unwrap_or_default();
            let _ = client
                .publish(&topic, rumqttc::QoS::AtLeastOnce, false, payload)
                .await;
        }
    }

    Ok(Json(json!({ "success": true, "priority": priority })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateFinishingDto {
    pub finishing_status: String,
    pub finishing_notes: Option<String>,
}

/// POST /api/print/jobs/:id/finishing — update finishing status
pub async fn update_finishing(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateFinishingDto>,
) -> Result<Json<Value>> {
    if !["in_progress", "done"].contains(&body.finishing_status.as_str()) {
        return Err(AppError::bad_request(
            "Invalid finishing_status: допустимо in_progress или done",
        ));
    }

    let result = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE print_jobs
           SET finishing_status = $2,
               finishing_notes = COALESCE($3, finishing_notes),
               status = CASE WHEN $2 = 'done' THEN 'completed' ELSE status END,
               completed_at = CASE WHEN $2 = 'done' THEN NOW() ELSE completed_at END,
               updated_at = NOW()
           WHERE id = $1 AND status IN ('finishing', 'printing', 'completed')
           RETURNING id"#,
    )
    .bind(id)
    .bind(&body.finishing_status)
    .bind(&body.finishing_notes)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::not_found(
            "Задание не найдено или не в статусе finishing/printing/completed",
        ));
    }

    // Fetch studio_id for Redis publish
    let studio_id =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT studio_id FROM print_jobs WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    // Redis PUBLISH for Socket.IO relay
    let redis_payload = serde_json::json!({
        "job_id": id,
        "finishing_status": body.finishing_status,
        "finishing_notes": body.finishing_notes,
        "studio_id": studio_id,
    });

    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let _ = redis::cmd("PUBLISH")
            .arg("print:finishing_update")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({ "success": true })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateFinishingOpsDto {
    pub finishing_ops: Vec<String>,
}

/// PATCH /api/print/jobs/:id/finishing_ops — update finishing operations list
pub async fn update_finishing_ops(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateFinishingOpsDto>,
) -> Result<Json<Value>> {
    // Validate finishing ops against printer capabilities
    if !body.finishing_ops.is_empty() {
        let printer_caps = sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT p.capabilities FROM print_jobs pj JOIN printers p ON p.id = pj.printer_id WHERE pj.id = $1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

        if let Some(caps) = printer_caps {
            let supported: Vec<String> = caps
                .get("finishing")
                .and_then(|f| f.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            for op in &body.finishing_ops {
                if !supported.iter().any(|s| s == op) {
                    return Err(AppError::bad_request(format!(
                        "Принтер не поддерживает операцию: {op}"
                    )));
                }
            }
        }
    }

    let result = sqlx::query(
        "UPDATE print_jobs SET finishing_ops = $2, updated_at = NOW() WHERE id = $1 RETURNING id",
    )
    .bind(id)
    .bind(&body.finishing_ops)
    .fetch_optional(&state.db)
    .await?;

    match result {
        Some(_) => Ok(Json(
            json!({"success": true, "finishing_ops": body.finishing_ops}),
        )),
        None => Err(AppError::not_found("Задание не найдено")),
    }
}

/// Distribute total copies across N printers (even distribution with remainder going to first printers).
fn distribute_copies(total: i32, n: usize) -> Vec<i32> {
    let base = total / n as i32;
    let rem = total % n as i32;
    (0..n)
        .map(|i| base + if (i as i32) < rem { 1 } else { 0 })
        .collect()
}

/// POST /api/print/jobs/:id/split — split a job across multiple printers
pub async fn split_job(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<crate::models::job::SplitJobDto>,
) -> Result<Json<Value>> {
    // Validate strategy
    if !["round_robin", "even"].contains(&body.strategy.as_str()) {
        return Err(AppError::bad_request(
            "strategy должен быть 'round_robin' или 'even'",
        ));
    }

    if body.printer_ids.len() < 2 {
        return Err(AppError::bad_request(
            "Необходимо минимум 2 принтера для разделения",
        ));
    }

    // Parse printer UUIDs
    let printer_uuids: Vec<Uuid> = body
        .printer_ids
        .iter()
        .map(|s| {
            Uuid::parse_str(s)
                .map_err(|_| AppError::bad_request(format!("Invalid printer_id: {s}")))
        })
        .collect::<Result<Vec<_>>>()?;

    // Fetch parent job
    let job = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*, p.name AS printer_name, p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Задание не найдено"))?;

    if job.status != "queued" {
        return Err(AppError::conflict(format!(
            "Разделение возможно только для заданий в статусе 'queued', текущий: '{}'",
            job.status
        )));
    }

    if job.copies < 2 {
        return Err(AppError::bad_request(
            "Разделение возможно только при copies > 1",
        ));
    }

    let n = printer_uuids.len();
    let distribution = distribute_copies(job.copies, n);

    // Transition parent to 'splitting'
    sqlx::query(
        r#"UPDATE print_jobs
           SET status = 'splitting',
               split_strategy = $2,
               total_copies_needed = $3
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&body.strategy)
    .bind(job.copies)
    .execute(&state.db)
    .await?;

    let user_id = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    // Create child jobs
    let mut child_ids: Vec<Uuid> = Vec::with_capacity(n);
    for (i, (printer_id, &copies)) in printer_uuids.iter().zip(distribution.iter()).enumerate() {
        let child_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO print_jobs (
                 printer_id, file_url, file_name,
                 copies, paper_size, color_mode, quality, duplex,
                 orientation, borderless, media_type, fit_mode,
                 order_id, order_type, receipt_id,
                 customer_id, service_slug, document_template_slug,
                 icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
                 layout_rows, layout_cols, cut_margin_mm,
                 custom_photo_width_mm, custom_photo_height_mm, rotation,
                 created_by, studio_id, status, priority,
                 parent_job_id, batch_sequence,
                 price_total, preset_id, trace_id, paper_source,
                 mirror, crop_x, crop_y, crop_width, crop_height,
                 photo_enhance, brightness, contrast, saturation
               ) VALUES (
                 $1, $2, $3,
                 $4, $5, $6, $7, $8,
                 $9, $10, $11, $12,
                 $13, $14, $15,
                 $16, $17, $18,
                 $19, $20, $21, $22,
                 $23, $24, $25,
                 $26, $27, $28,
                 $29, $30, 'queued', $31,
                 $32, $33,
                 $34, $35, $36, $37,
                 $38, $39, $40, $41, $42,
                 $43, $44, $45, $46
               ) RETURNING id"#,
        )
        .bind(printer_id)
        .bind(&job.file_url)
        .bind(&job.file_name)
        .bind(copies)
        .bind(&job.paper_size)
        .bind(&job.color_mode)
        .bind(&job.quality)
        .bind(job.duplex)
        .bind(&job.orientation)
        .bind(job.borderless)
        .bind(&job.media_type)
        .bind(&job.fit_mode)
        .bind(&job.order_id)
        .bind(&job.order_type)
        .bind(job.receipt_id)
        .bind(job.customer_id)
        .bind(&job.service_slug)
        .bind(&job.document_template_slug)
        .bind(job.icc_profile_id)
        .bind(job.cut_marks.unwrap_or(false))
        .bind(job.cut_mark_length_mm)
        .bind(job.cut_mark_offset_mm)
        .bind(job.layout_rows)
        .bind(job.layout_cols)
        .bind(job.cut_margin_mm)
        .bind(job.custom_photo_width_mm)
        .bind(job.custom_photo_height_mm)
        .bind(job.rotation)
        .bind(user_id)
        .bind(job.studio_id)
        .bind(job.priority)
        .bind(id) // parent_job_id
        .bind((i + 1) as i32) // batch_sequence
        .bind(&job.price_total)
        .bind(job.preset_id)
        .bind(&job.trace_id)
        .bind(&job.paper_source)
        .bind(job.mirror.unwrap_or(false))
        .bind(job.crop_x)
        .bind(job.crop_y)
        .bind(job.crop_width)
        .bind(job.crop_height)
        .bind(job.photo_enhance.unwrap_or(false))
        .bind(job.brightness.unwrap_or(0))
        .bind(job.contrast.unwrap_or(0))
        .bind(job.saturation.unwrap_or(0))
        .fetch_one(&state.db)
        .await?;

        child_ids.push(child_id);
    }

    // Update parent: child_count, status back to queued (now with children)
    sqlx::query("UPDATE print_jobs SET child_count = $2, status = 'queued' WHERE id = $1")
        .bind(id)
        .bind(n as i32)
        .execute(&state.db)
        .await?;

    // pg_notify for each child
    for child_id in &child_ids {
        let notify_payload = json!({
            "id": child_id,
            "printer_id": Uuid::nil(),
            "studio_id": job.studio_id,
            "status": "queued",
        });
        sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
            .bind(notify_payload.to_string())
            .execute(&state.db)
            .await?;
    }

    // Redis publish for CRM
    if let Some(ref redis_url) = state.config.redis_url
        && let Ok(client) = redis::Client::open(redis_url.as_str())
        && let Ok(mut conn) = client.get_multiplexed_async_connection().await
    {
        let payload = json!({
            "job_id": id,
            "status": "split",
            "child_count": n,
            "child_ids": child_ids,
            "studio_id": job.studio_id,
        });
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(Json(json!({
        "success": true,
        "parent_id": id,
        "child_count": n,
        "child_ids": child_ids,
        "distribution": distribution,
    })))
}

/// POST /api/print/jobs/groups — create a job group
pub async fn create_group(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Value>> {
    let name = body["name"].as_str().unwrap_or("Группа");
    let studio_id = body["studio_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    let group = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO print_job_groups (name, studio_id, status) VALUES ($1, $2, 'open') RETURNING id",
    )
    .bind(name)
    .bind(studio_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "group_id": group.to_string() }),
    ))
}

/// GET /api/print/jobs/groups/:id — list jobs in a group
pub async fn get_group_jobs(
    State(state): State<AppState>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let jobs = sqlx::query_as::<_, PrintJobRow>(
        "SELECT pj.*, p.name AS printer_name, p.printer_type,
                u.name AS creator_name
         FROM print_jobs pj
         LEFT JOIN printers p ON p.id = pj.printer_id
         LEFT JOIN users u ON u.id = pj.created_by
         WHERE pj.group_id = $1 ORDER BY pj.group_sequence",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await?;

    let count = jobs.len();
    Ok(Json(
        json!({ "success": true, "data": jobs, "count": count }),
    ))
}

/// PUT /api/print/jobs/:id/group — add job to a group
pub async fn add_to_group(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Value>> {
    let group_id = body["group_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::bad_request("group_id required"))?;

    let seq = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT COALESCE(MAX(group_sequence), 0) + 1 FROM print_jobs WHERE group_id = $1",
    )
    .bind(group_id)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE print_jobs SET group_id = $2, group_sequence = $3 WHERE id = $1")
        .bind(id)
        .bind(group_id)
        .bind(seq)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true })))
}

/// DELETE /api/print/jobs/:id/group — remove job from group
pub async fn remove_from_group(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    sqlx::query("UPDATE print_jobs SET group_id = NULL, group_sequence = NULL WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true })))
}

/// GET /api/print/jobs/:id/transitions — get state transition history
pub async fn get_transitions(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let transitions = sqlx::query_as::<_, crate::models::job::JobStateTransitionRow>(
        r#"SELECT id, job_id, from_status, to_status, actor_id, actor_type, reason, metadata, created_at
           FROM job_state_transitions
           WHERE job_id = $1
           ORDER BY created_at ASC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "success": true, "transitions": transitions })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_transitions() {
        assert!(is_valid_transition("queued", "sending"));
        assert!(is_valid_transition("queued", "paused"));
        assert!(is_valid_transition("queued", "held"));
        assert!(is_valid_transition("queued", "scheduled"));
        assert!(is_valid_transition("queued", "cancelled"));
        assert!(is_valid_transition("queued", "splitting"));
        assert!(is_valid_transition("sending", "printing"));
        assert!(is_valid_transition("sending", "failed"));
        assert!(is_valid_transition("sending", "paused"));
        assert!(is_valid_transition("printing", "completed"));
        assert!(is_valid_transition("printing", "finishing"));
        assert!(is_valid_transition("failed", "queued"));
        assert!(is_valid_transition("cancelled", "queued"));
        assert!(is_valid_transition("paused", "queued"));
        assert!(is_valid_transition("held", "queued"));
        assert!(is_valid_transition("scheduled", "queued"));
        assert!(is_valid_transition("finishing", "completed"));
        assert!(is_valid_transition("finishing", "failed"));
        assert!(is_valid_transition("splitting", "queued"));
        assert!(is_valid_transition("converting", "queued"));
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(!is_valid_transition("completed", "queued"));
        assert!(!is_valid_transition("printing", "paused"));
        assert!(!is_valid_transition("queued", "completed"));
        assert!(!is_valid_transition("paused", "printing"));
        assert!(!is_valid_transition("held", "printing"));
        assert!(!is_valid_transition("finishing", "paused"));
        assert!(!is_valid_transition("scheduled", "printing"));
    }

    #[test]
    fn test_distribute_copies_even() {
        assert_eq!(distribute_copies(10, 2), vec![5, 5]);
        assert_eq!(distribute_copies(10, 3), vec![4, 3, 3]);
        assert_eq!(distribute_copies(7, 3), vec![3, 2, 2]);
        assert_eq!(distribute_copies(3, 2), vec![2, 1]);
        assert_eq!(distribute_copies(100, 4), vec![25, 25, 25, 25]);
    }

    #[test]
    fn missing_photo_order_id_is_not_linked_to_print_job() {
        assert_eq!(
            linked_photo_print_order_id(Some("ddbe45e0-75e0-4ef6-895e-d0cea44899b8"), false),
            None
        );
    }

    #[test]
    fn existing_photo_order_id_is_trimmed_and_linked_to_print_job() {
        assert_eq!(
            linked_photo_print_order_id(Some(" SF-123 "), true),
            Some("SF-123".to_string())
        );
    }
}
