use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use axum::{Json, extract::State};
use bigdecimal::BigDecimal;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::conversion::detect::DocumentType;
use crate::conversion::{
    DocxFontStats, detect_file_type, extension_for_document_type, inspect_office_font_stats,
    render_document_pages,
};
use crate::cups::ppd::{PrintableAreaMm, printable_area_for_printer};
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::models::printer::PrinterRow;
use crate::source_file;

/// Validate file_url to prevent SSRF attacks (same pattern as preview.rs).
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
        tracing::warn!("Coverage request blocked: unknown host {}", host);
        return Err(AppError::bad_request(
            "URL файла должен быть с разрешённого домена",
        ));
    }

    Ok(())
}

fn rgb_to_cmyk(r: u8, g: u8, b: u8) -> (f32, f32, f32, f32) {
    let r_f = r as f32 / 255.0;
    let g_f = g as f32 / 255.0;
    let b_f = b as f32 / 255.0;
    let k = 1.0 - r_f.max(g_f).max(b_f);
    if k >= 1.0 {
        return (0.0, 0.0, 0.0, 100.0);
    }
    let c = ((1.0 - r_f - k) / (1.0 - k)) * 100.0;
    let m = ((1.0 - g_f - k) / (1.0 - k)) * 100.0;
    let y = ((1.0 - b_f - k) / (1.0 - k)) * 100.0;
    (c, m, y, k * 100.0)
}

// Scanned pages often carry paper as a flat gray tone. Suppress only a neutral
// border-derived paper color; chromatic fills still count as printed coverage.
const NEUTRAL_PAGE_BACKGROUND_MAX_CHROMA: i16 = 12;
const NEUTRAL_PAGE_BACKGROUND_MIN_LUMINANCE: f32 = 120.0;
const NEUTRAL_PAGE_BACKGROUND_MIN_SAMPLE_SHARE: usize = 30;
const NEUTRAL_PAGE_BACKGROUND_TOLERANCE: f32 = 24.0;

fn pixel_tone(r: u8, g: u8, b: u8) -> (i16, f32) {
    let max = r.max(g).max(b) as i16;
    let min = r.min(g).min(b) as i16;
    let chroma = max - min;
    let luminance = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;

    (chroma, luminance)
}

fn is_neutral_page_background_candidate(chroma: i16, luminance: f32) -> bool {
    chroma <= NEUTRAL_PAGE_BACKGROUND_MAX_CHROMA
        && luminance >= NEUTRAL_PAGE_BACKGROUND_MIN_LUMINANCE
}

fn estimate_neutral_page_background(rgb: &image::RgbImage, bounds: CoverageCropPx) -> Option<f32> {
    let width = bounds.right.saturating_sub(bounds.left);
    let height = bounds.bottom.saturating_sub(bounds.top);
    if width == 0 || height == 0 {
        return None;
    }

    let border_x = (width / 20).max(1);
    let border_y = (height / 20).max(1);
    let step = ((width.max(height) / 1200).max(1)) as usize;
    let mut border_samples: usize = 0;
    let mut neutral_samples: Vec<f32> = Vec::new();

    for y in (bounds.top..bounds.bottom).step_by(step) {
        for x in (bounds.left..bounds.right).step_by(step) {
            let in_border = x < bounds.left + border_x
                || x >= bounds.right.saturating_sub(border_x)
                || y < bounds.top + border_y
                || y >= bounds.bottom.saturating_sub(border_y);
            if !in_border {
                continue;
            }

            border_samples += 1;
            let [r, g, b] = rgb.get_pixel(x, y).0;
            let (chroma, luminance) = pixel_tone(r, g, b);
            if is_neutral_page_background_candidate(chroma, luminance) {
                neutral_samples.push(luminance);
            }
        }
    }

    if border_samples == 0
        || neutral_samples.len() * 100 < border_samples * NEUTRAL_PAGE_BACKGROUND_MIN_SAMPLE_SHARE
    {
        return None;
    }

    neutral_samples.sort_by(f32::total_cmp);
    neutral_samples.get(neutral_samples.len() / 2).copied()
}

fn is_neutral_page_background_pixel(
    chroma: i16,
    luminance: f32,
    background_luminance: Option<f32>,
) -> bool {
    let Some(background_luminance) = background_luminance else {
        return false;
    };

    chroma <= NEUTRAL_PAGE_BACKGROUND_MAX_CHROMA
        && (luminance - background_luminance).abs() <= NEUTRAL_PAGE_BACKGROUND_TOLERANCE
}

#[derive(Deserialize)]
pub struct CoverageRequest {
    pub file_url: String,
    pub paper_format: Option<String>,
    pub printer_id: Option<Uuid>,
    pub paper_size: Option<String>,
    pub borderless: Option<bool>,
    pub dpi: Option<i32>,
    pub font_size_delta_pt: Option<i16>,
    /// Override авто-детекта цвета для расчёта тира/цены: "color" | "bw" | "auto"/None.
    /// Нужно, чтобы оператор/клиент мог переключить ч/б↔цвет и цена пересчиталась
    /// (на заливке ≤15% это меняет тир: км-а4-печать-документа 10₽ ↔ км-а4-печать-до-15-цвет 12₽).
    pub color_mode: Option<String>,
}

/// Разбирает color_mode в явный override цвета: Some(true)=цвет, Some(false)=ч/б, None=авто.
fn parse_color_override(value: &Option<String>) -> Option<bool> {
    match value
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("color") | Some("colour") | Some("цвет") => Some(true),
        Some("bw") | Some("mono") | Some("чб") | Some("ч/б") => Some(false),
        _ => None,
    }
}

pub(crate) const MAX_FILE_SIZE: usize = 200 * 1024 * 1024; // 200 MB, aligned with normal print/preview downloads
pub(crate) const COVERAGE_TEMP_DIR: &str = "/tmp/cups-print-coverage";
const DOCUMENT_COVERAGE_DPI: i32 = 120;

#[derive(Clone, Copy)]
pub(crate) struct CoverageStats {
    coverage_percent: f32,
    c_avg: f32,
    m_avg: f32,
    y_avg: f32,
    k_avg: f32,
    pixel_count: u64,
}

struct CoverageTier {
    slug: String,
    tier: &'static str,
}

struct CoverageRecommendation {
    slug: String,
    tier: &'static str,
    price: BigDecimal,
    name: String,
}

struct DocumentCoverageAnalysis {
    page_stats: Vec<CoverageStats>,
    font_stats: Option<DocxFontStats>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CoverageCropPx {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

fn round_2(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

fn has_color_ink(stats: CoverageStats) -> bool {
    stats.c_avg + stats.m_avg + stats.y_avg > 0.05
}

fn coverage_tier(
    coverage_percent: f32,
    paper_format: Option<&str>,
    has_color: bool,
) -> CoverageTier {
    let is_a3 = paper_format.is_some_and(|f| f.eq_ignore_ascii_case("a3"));

    if is_a3 {
        if coverage_percent <= 15.0 {
            return CoverageTier {
                slug: "km-а3-печать-документа".to_string(),
                tier: "document",
            };
        }

        if coverage_percent <= 50.0 {
            return CoverageTier {
                slug: "km-а3-чб-фото-документ".to_string(),
                tier: "color_document",
            };
        }

        return CoverageTier {
            slug: "km-а3-фото-документ-цвет".to_string(),
            tier: "photo_document",
        };
    }

    if coverage_percent <= 15.0 && has_color {
        CoverageTier {
            slug: "km-а4-печать-до-15-цвет".to_string(),
            tier: "light_color_document",
        }
    } else if coverage_percent <= 15.0 {
        CoverageTier {
            slug: "km-а4-печать-документа".to_string(),
            tier: "document",
        }
    } else if coverage_percent <= 50.0 {
        CoverageTier {
            slug: "km-а4-печать-документа-цветная".to_string(),
            tier: "color_document",
        }
    } else if coverage_percent <= 75.0 {
        CoverageTier {
            slug: "km-а4-печать-до-75".to_string(),
            tier: "high_coverage_document",
        }
    } else {
        CoverageTier {
            slug: "km-а4-фото-документ".to_string(),
            tier: "photo_document",
        }
    }
}

async fn recommendation_for_coverage(
    state: &AppState,
    paper_format: Option<&str>,
    stats: CoverageStats,
    cache: &mut HashMap<String, (BigDecimal, String)>,
    color_override: Option<bool>,
) -> Result<CoverageRecommendation> {
    // Если оператор/клиент явно выбрал ч/б или цвет — используем его выбор, иначе авто-детект.
    let has_color = color_override.unwrap_or_else(|| has_color_ink(stats));
    let tier = coverage_tier(stats.coverage_percent, paper_format, has_color);
    let (price, name) = if let Some(cached) = cache.get(&tier.slug) {
        cached.clone()
    } else {
        let row: Option<(BigDecimal, String)> = sqlx::query_as(
            "SELECT base_price, name FROM service_options WHERE slug = $1 AND is_active = true",
        )
        .bind(&tier.slug)
        .fetch_optional(&state.db)
        .await?;

        let value = row.ok_or_else(|| {
            AppError::not_found(format!(
                "Активная цена печати не найдена в service_options: {}",
                tier.slug
            ))
        })?;
        cache.insert(tier.slug.clone(), value.clone());
        value
    };

    Ok(CoverageRecommendation {
        slug: tier.slug,
        tier: tier.tier,
        price,
        name,
    })
}

fn margin_mm_to_px(margin_mm: f64, page_mm: f64, pixels: u32) -> u32 {
    if !margin_mm.is_finite() || !page_mm.is_finite() || page_mm <= 0.0 || pixels == 0 {
        return 0;
    }

    ((margin_mm.max(0.0) / page_mm) * pixels as f64)
        .round()
        .clamp(0.0, pixels as f64) as u32
}

fn printable_crop_px(
    printable_area: &PrintableAreaMm,
    width: u32,
    height: u32,
) -> Option<CoverageCropPx> {
    if width == 0 || height == 0 {
        return None;
    }

    let left = margin_mm_to_px(printable_area.left_mm, printable_area.page_width_mm, width);
    let top = margin_mm_to_px(printable_area.top_mm, printable_area.page_height_mm, height);
    let right_margin =
        margin_mm_to_px(printable_area.right_mm, printable_area.page_width_mm, width);
    let bottom_margin = margin_mm_to_px(
        printable_area.bottom_mm,
        printable_area.page_height_mm,
        height,
    );
    let right = width.saturating_sub(right_margin);
    let bottom = height.saturating_sub(bottom_margin);

    if right <= left || bottom <= top {
        return None;
    }

    Some(CoverageCropPx {
        left,
        top,
        right,
        bottom,
    })
}

#[cfg(test)]
fn analyze_rgb_image(rgb: image::RgbImage) -> Result<CoverageStats> {
    analyze_rgb_image_area(rgb, None)
}

fn analyze_rgb_image_area(
    rgb: image::RgbImage,
    crop: Option<CoverageCropPx>,
) -> Result<CoverageStats> {
    let mut total: u64 = 0;
    let mut coverage_sum: f64 = 0.0;
    let mut c_sum: f64 = 0.0;
    let mut m_sum: f64 = 0.0;
    let mut y_sum: f64 = 0.0;
    let mut k_sum: f64 = 0.0;
    let bounds = crop.unwrap_or(CoverageCropPx {
        left: 0,
        top: 0,
        right: rgb.width(),
        bottom: rgb.height(),
    });

    if bounds.right <= bounds.left || bounds.bottom <= bounds.top {
        return Err(AppError::bad_request("Изображение пустое"));
    }

    let background_luminance = estimate_neutral_page_background(&rgb, bounds);

    for y in bounds.top..bounds.bottom {
        for x in bounds.left..bounds.right {
            let [r, g, b] = rgb.get_pixel(x, y).0;
            let (chroma, luminance) = pixel_tone(r, g, b);
            let (c, m, y_value, k) = rgb_to_cmyk(r, g, b);
            if is_neutral_page_background_pixel(chroma, luminance, background_luminance) {
                total += 1;
                continue;
            }
            coverage_sum += c.max(m).max(y_value).max(k) as f64;
            c_sum += c as f64;
            m_sum += m as f64;
            y_sum += y_value as f64;
            k_sum += k as f64;
            total += 1;
        }
    }

    if total == 0 {
        return Err(AppError::bad_request("Изображение пустое"));
    }

    let t = total as f64;
    let c_avg = (c_sum / t) as f32;
    let m_avg = (m_sum / t) as f32;
    let y_avg = (y_sum / t) as f32;
    let k_avg = (k_sum / t) as f32;
    let coverage_percent = (coverage_sum / t) as f32;

    Ok(CoverageStats {
        coverage_percent,
        c_avg,
        m_avg,
        y_avg,
        k_avg,
        pixel_count: total,
    })
}

fn analyze_dynamic_image(
    img: image::DynamicImage,
    printable_area: Option<&PrintableAreaMm>,
) -> Result<CoverageStats> {
    let rgb = img.to_rgb8();
    let crop = printable_area.and_then(|area| printable_crop_px(area, rgb.width(), rgb.height()));
    analyze_rgb_image_area(rgb, crop)
}

pub(crate) fn analyze_image_bytes(
    bytes: &[u8],
    printable_area: Option<&PrintableAreaMm>,
) -> Result<CoverageStats> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::bad_request(format!("Не удалось декодировать изображение: {e}")))?;
    analyze_dynamic_image(img, printable_area)
}

pub(crate) fn analyze_image_path(
    path: &Path,
    printable_area: Option<&PrintableAreaMm>,
) -> Result<CoverageStats> {
    let img = image::open(path).map_err(|e| {
        AppError::internal(format!(
            "Не удалось декодировать страницу документа {}: {e}",
            path.display()
        ))
    })?;
    analyze_dynamic_image(img, printable_area)
}

fn aggregate_coverage_stats(stats: &[CoverageStats]) -> Result<CoverageStats> {
    let total_pixels: u64 = stats.iter().map(|item| item.pixel_count).sum();
    if total_pixels == 0 {
        return Err(AppError::bad_request(
            "Документ не содержит страниц для анализа",
        ));
    }

    let weighted = |value: fn(&CoverageStats) -> f32| -> f32 {
        let sum = stats
            .iter()
            .map(|item| value(item) as f64 * item.pixel_count as f64)
            .sum::<f64>();
        (sum / total_pixels as f64) as f32
    };

    let c_avg = weighted(|item| item.c_avg);
    let m_avg = weighted(|item| item.m_avg);
    let y_avg = weighted(|item| item.y_avg);
    let k_avg = weighted(|item| item.k_avg);
    let coverage_percent = weighted(|item| item.coverage_percent);

    Ok(CoverageStats {
        coverage_percent,
        c_avg,
        m_avg,
        y_avg,
        k_avg,
        pixel_count: total_pixels,
    })
}

pub(crate) fn document_coverage_dpi(body: &CoverageRequest) -> u32 {
    body.dpi
        .filter(|dpi| *dpi > 0)
        .unwrap_or(DOCUMENT_COVERAGE_DPI)
        .clamp(72, 180) as u32
}

pub(crate) fn normalize_coverage_font_size_delta(
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

fn coverage_paper_size(body: &CoverageRequest) -> String {
    body.paper_size
        .as_deref()
        .or(body.paper_format.as_deref())
        .unwrap_or("a4")
        .to_string()
}

fn normalize_device_token(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|ch| !matches!(ch, ' ' | '_' | '-' | '/'))
        .collect()
}

fn coverage_device_matches(
    printer_type: &str,
    name: &str,
    cups_printer_name: Option<&str>,
) -> bool {
    let printer_type = normalize_device_token(printer_type);
    let device = normalize_device_token(&format!(
        "{} {}",
        name,
        cups_printer_name.unwrap_or_default()
    ));

    let inkjet_device = device.contains("inkjet")
        || device.contains("струй")
        || device.contains("epson")
        || device.contains("l805")
        || device.contains("l1800");
    if inkjet_device {
        return false;
    }

    printer_type.contains("laser")
        || device.contains("laser")
        || device.contains("лазер")
        || device.contains("c3226")
        || device.contains("mf655")
        || device.contains("iradv")
        || device.contains("imagerunner")
}

fn is_coverage_printer(printer: &PrinterRow) -> bool {
    coverage_device_matches(
        &printer.printer_type,
        &printer.name,
        printer.cups_printer_name.as_deref(),
    )
}

pub(crate) async fn printable_area_for_coverage(
    state: &AppState,
    body: &CoverageRequest,
) -> Result<Option<PrintableAreaMm>> {
    if body.borderless.unwrap_or(false) {
        return Ok(None);
    }

    let Some(printer_id) = body.printer_id else {
        return Ok(None);
    };

    let printer = sqlx::query_as::<_, PrinterRow>(
        "SELECT * FROM printers WHERE id = $1 AND is_active = TRUE",
    )
    .bind(printer_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::internal(format!("Ошибка загрузки принтера: {e}")))?
    .ok_or_else(|| AppError::not_found(format!("Принтер не найден: {printer_id}")))?;

    if !is_coverage_printer(&printer) {
        return Ok(None);
    }

    let cups_printer = printer
        .cups_printer_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::service_unavailable("Для принтера не настроена CUPS очередь"))?;
    let paper_size = coverage_paper_size(body);

    printable_area_for_printer(cups_printer, &paper_size, false)
        .map(Some)
        .map_err(|e| {
            AppError::service_unavailable(format!(
                "Не удалось получить точные поля из CUPS PPD: {e}"
            ))
        })
}

async fn analyze_document_pages(
    body: &CoverageRequest,
    doc_type: DocumentType,
    bytes: &[u8],
    printable_area: Option<PrintableAreaMm>,
) -> Result<DocumentCoverageAnalysis> {
    let task_dir = Path::new(COVERAGE_TEMP_DIR).join(Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&task_dir)
        .await
        .map_err(|e| AppError::internal(format!("Coverage temp dir error: {e}")))?;

    let result = async {
        let source_path =
            task_dir.join(format!("source.{}", extension_for_document_type(doc_type)));
        tokio::fs::write(&source_path, bytes)
            .await
            .map_err(|e| AppError::internal(format!("Coverage temp source write error: {e}")))?;

        let font_stats = inspect_office_font_stats(&source_path, &task_dir, doc_type)
            .await
            .map_err(|e| AppError::internal(format!("Document font inspect failed: {e}")))?;
        let dpi = document_coverage_dpi(body);
        let font_delta = normalize_coverage_font_size_delta(body.font_size_delta_pt, doc_type)?;
        let rendered_pages: Vec<PathBuf> = render_document_pages(
            &source_path,
            &task_dir,
            doc_type,
            dpi,
            font_delta,
            None,
            None,
        )
        .await
        .map_err(|e| AppError::internal(format!("Document coverage render failed: {e}")))?;

        let page_stats = tokio::task::spawn_blocking(move || -> Result<Vec<CoverageStats>> {
            rendered_pages
                .iter()
                .map(|path| analyze_image_path(path, printable_area.as_ref()))
                .collect()
        })
        .await
        .map_err(|e| AppError::internal(format!("Ошибка анализа страниц документа: {e}")))??;

        Ok(DocumentCoverageAnalysis {
            page_stats,
            font_stats,
        })
    }
    .await;

    if let Err(err) = tokio::fs::remove_dir_all(&task_dir).await {
        tracing::debug!(
            path = %task_dir.display(),
            error = %err,
            "Coverage temp cleanup skipped"
        );
    }

    result
}

fn font_stats_json(stats: &DocxFontStats) -> Value {
    json!({
        "sizes_pt": stats.sizes_pt,
        "min_pt": stats.min_pt,
        "max_pt": stats.max_pt,
        "primary_pt": stats.primary_pt,
        "explicit_size_count": stats.explicit_size_count,
    })
}

fn document_type_label(doc_type: DocumentType) -> &'static str {
    match doc_type {
        DocumentType::Raster => "image",
        document => document.api_label(),
    }
}

fn coverage_policy_json() -> Value {
    json!({
        "printer_scope": "laser_a4_a3",
        "paper_formats": ["a4", "a3"],
        "enabled_for": ["laser"],
        "enabled_file_types": ["document", "image"],
        "skipped_for": ["photo_print", "inkjet", "sublimation"],
    })
}

fn coverage_page_json(
    page_number: usize,
    stats: CoverageStats,
    recommendation: CoverageRecommendation,
) -> Value {
    json!({
        "page_number": page_number,
        "coverage_percent": round_2(stats.coverage_percent),
        "coverage_cmyk": {
            "c": round_2(stats.c_avg),
            "m": round_2(stats.m_avg),
            "y": round_2(stats.y_avg),
            "k": round_2(stats.k_avg),
        },
        "recommended_slug": recommendation.slug,
        "recommended_price": recommendation.price,
        "recommended_name": recommendation.name,
        "tier": recommendation.tier,
    })
}

/// POST /api/print/analyze-coverage — Analyze ink coverage of an image or document.
pub async fn analyze(
    State(state): State<AppState>,
    _claims: Claims,
    Json(body): Json<CoverageRequest>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() {
        return Err(AppError::bad_request("file_url обязателен"));
    }

    validate_file_url(&body.file_url)?;

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;
    let bytes = source_file::read_source_bytes(
        &state.config,
        &http_client,
        &body.file_url,
        MAX_FILE_SIZE as u64,
        "файл",
    )
    .await?;

    let doc_type = detect_file_type(&body.file_url);
    let printable_area = printable_area_for_coverage(&state, &body).await?;
    let (page_stats, font_stats) = if doc_type.is_document() {
        let analysis = analyze_document_pages(&body, doc_type, &bytes, printable_area).await?;
        (analysis.page_stats, analysis.font_stats)
    } else {
        let image_bytes = bytes.clone();
        (
            vec![
                tokio::task::spawn_blocking(move || {
                    analyze_image_bytes(&image_bytes, printable_area.as_ref())
                })
                .await
                .map_err(|e| AppError::internal(format!("Ошибка анализа: {e}")))??,
            ],
            None,
        )
    };

    let result =
        build_coverage_result(&state, &body, &page_stats, font_stats.as_ref(), doc_type).await?;

    Ok(Json(json!({
        "success": true,
        "result": result,
    })))
}

/// Единый источник финального coverage-результата (цена/тир/страницы): зовётся И
/// синхронным `analyze` (изображения), И фоновой задачей `run_coverage_job`
/// (документы). Один код-путь aggregate→рекомендация→постраничные рекомендации→
/// estimated→assemble — никакого расхождения тира/цены между sync и async.
///
/// Требует State (цены тиров берутся из `service_options`), поэтому async; чистая
/// сборка финального JSON вынесена в `assemble_coverage_result_json`.
pub(crate) async fn build_coverage_result(
    state: &AppState,
    body: &CoverageRequest,
    page_stats: &[CoverageStats],
    font_stats: Option<&DocxFontStats>,
    doc_type: DocumentType,
) -> Result<Value> {
    let aggregate = aggregate_coverage_stats(page_stats)?;
    let paper_format = body.paper_format.as_deref();
    let color_override = parse_color_override(&body.color_mode);
    let mut recommendation_cache = HashMap::new();
    let recommendation = recommendation_for_coverage(
        state,
        paper_format,
        aggregate,
        &mut recommendation_cache,
        color_override,
    )
    .await?;

    let mut pages = Vec::with_capacity(page_stats.len());
    for (idx, stats) in page_stats.iter().copied().enumerate() {
        let page_recommendation = recommendation_for_coverage(
            state,
            paper_format,
            stats,
            &mut recommendation_cache,
            color_override,
        )
        .await?;
        pages.push(coverage_page_json(idx + 1, stats, page_recommendation));
    }

    // Estimate toner usage based on coverage
    let estimated_toner_cost = {
        let base_cost_5percent = 1.0_f64; // rub per sheet at 5% coverage
        let multiplier = (aggregate.coverage_percent as f64) / 5.0;
        base_cost_5percent * multiplier
    };
    let paper_cost = 0.5_f64; // rub per sheet
    let estimated_total_cost = estimated_toner_cost + paper_cost;

    Ok(assemble_coverage_result_json(
        aggregate,
        recommendation,
        pages,
        page_stats.len(),
        doc_type,
        font_stats,
        (estimated_toner_cost * 100.0).round() / 100.0,
        paper_cost,
        (estimated_total_cost * 100.0).round() / 100.0,
    ))
}

/// Чистая сборка финального coverage-`result` (без State/IO) — все 14 полей контракта.
/// Покрыта golden-тестом: фикс. вход → фикс. `serde_json::Value`. Любое изменение
/// формы ответа должно осознанно менять golden, иначе фронт-цена «поедет».
#[allow(clippy::too_many_arguments)]
fn assemble_coverage_result_json(
    aggregate: CoverageStats,
    recommendation: CoverageRecommendation,
    pages: Vec<Value>,
    page_count: usize,
    doc_type: DocumentType,
    font_stats: Option<&DocxFontStats>,
    estimated_toner_cost: f64,
    estimated_paper_cost: f64,
    estimated_total_cost: f64,
) -> Value {
    json!({
        "coverage_percent": round_2(aggregate.coverage_percent),
        "coverage_cmyk": {
            "c": round_2(aggregate.c_avg),
            "m": round_2(aggregate.m_avg),
            "y": round_2(aggregate.y_avg),
            "k": round_2(aggregate.k_avg),
        },
        "recommended_slug": recommendation.slug,
        "recommended_price": recommendation.price,
        "recommended_name": recommendation.name,
        "tier": recommendation.tier,
        "page_count": page_count,
        "pages": pages,
        "document_type": document_type_label(doc_type),
        "coverage_policy": coverage_policy_json(),
        "font_stats": font_stats.map(font_stats_json),
        "estimated_toner_cost": estimated_toner_cost,
        "estimated_paper_cost": estimated_paper_cost,
        "estimated_total_cost": estimated_total_cost,
    })
}

#[cfg(test)]
mod tests {
    use image::{Rgb, RgbImage};
    use serde_json::json;

    use super::{
        CoverageRecommendation, CoverageStats, aggregate_coverage_stats, analyze_rgb_image,
        analyze_rgb_image_area, assemble_coverage_result_json, coverage_device_matches,
        coverage_page_json, coverage_policy_json, coverage_tier, printable_crop_px, round_2,
        validate_file_url,
    };
    use crate::conversion::DocxFontStats;
    use crate::conversion::detect::DocumentType;
    use crate::cups::ppd::PrintableAreaMm;

    #[test]
    fn a4_coverage_tiers_match_catalog_slugs() {
        let low = coverage_tier(15.0, Some("a4"), false);
        assert_eq!(low.slug, "km-а4-печать-документа");

        let light_color = coverage_tier(15.0, Some("a4"), true);
        assert_eq!(light_color.slug, "km-а4-печать-до-15-цвет");

        let medium = coverage_tier(50.0, Some("a4"), true);
        assert_eq!(medium.slug, "km-а4-печать-документа-цветная");

        let high = coverage_tier(75.0, Some("a4"), true);
        assert_eq!(high.slug, "km-а4-печать-до-75");

        let photo = coverage_tier(75.01, Some("a4"), true);
        assert_eq!(photo.slug, "km-а4-фото-документ");
    }

    #[test]
    fn a3_coverage_tiers_match_catalog_slugs() {
        let low = coverage_tier(15.0, Some("a3"), true);
        assert_eq!(low.slug, "km-а3-печать-документа");

        let medium = coverage_tier(50.0, Some("a3"), true);
        assert_eq!(medium.slug, "km-а3-чб-фото-документ");

        let photo = coverage_tier(50.01, Some("a3"), true);
        assert_eq!(photo.slug, "km-а3-фото-документ-цвет");
    }

    #[test]
    fn coverage_printer_detection_follows_laser_device() {
        assert!(coverage_device_matches(
            "photo",
            "Canon C3226i",
            Some("Canon-C3226i-Soborny"),
        ));
        assert!(coverage_device_matches(
            "laser_color",
            "Office Printer",
            None
        ));
        assert!(coverage_device_matches("photo", "HP LaserJet", None));
        assert!(!coverage_device_matches(
            "photo",
            "Epson L8050",
            Some("Epson-L8050-Soborny"),
        ));
    }

    #[test]
    fn coverage_policy_declares_laser_a4_a3_scope() {
        let policy = coverage_policy_json();

        assert_eq!(policy["printer_scope"], json!("laser_a4_a3"));
        assert_eq!(policy["paper_formats"], json!(["a4", "a3"]));
        assert_eq!(policy["enabled_for"], json!(["laser"]));
        assert_eq!(policy["enabled_file_types"], json!(["document", "image"]));
        assert_eq!(
            policy["skipped_for"],
            json!(["photo_print", "inkjet", "sublimation"])
        );
    }

    #[test]
    fn coverage_uses_toner_density_not_binary_visible_area() {
        let mut img = RgbImage::from_pixel(10, 10, Rgb([255, 255, 255]));
        for x in 0..8 {
            for y in 0..10 {
                img.put_pixel(x, y, Rgb([246, 216, 205]));
            }
        }

        let stats = analyze_rgb_image(img).expect("coverage stats");

        assert!((stats.coverage_percent - 13.33).abs() < 0.05);
    }

    #[test]
    fn coverage_ignores_near_white_page_background() {
        let img = RgbImage::from_pixel(10, 10, Rgb([248, 248, 248]));
        let stats = analyze_rgb_image(img).expect("coverage stats");

        assert_eq!(stats.coverage_percent, 0.0);
        assert_eq!(stats.k_avg, 0.0);
    }

    #[test]
    fn coverage_ignores_neutral_gray_scanned_page_background() {
        let img = RgbImage::from_pixel(10, 10, Rgb([184, 184, 184]));
        let stats = analyze_rgb_image(img).expect("coverage stats");

        assert_eq!(stats.coverage_percent, 0.0);
    }

    #[test]
    fn coverage_counts_dark_content_over_gray_scanned_page_background() {
        let mut img = RgbImage::from_pixel(100, 100, Rgb([184, 184, 184]));
        for x in 0..10 {
            for y in 0..100 {
                img.put_pixel(x, y, Rgb([48, 48, 48]));
            }
        }

        let stats = analyze_rgb_image(img).expect("coverage stats");

        assert!(stats.coverage_percent > 5.0);
        assert!(stats.coverage_percent < 15.0);
    }

    #[test]
    fn coverage_uses_printable_area_without_technical_margins() {
        let mut img = RgbImage::from_pixel(100, 100, Rgb([255, 255, 255]));
        for x in 10..90 {
            for y in 10..90 {
                img.put_pixel(x, y, Rgb([0, 0, 0]));
            }
        }

        let printable_area = PrintableAreaMm {
            page_width_mm: 100.0,
            page_height_mm: 100.0,
            left_mm: 10.0,
            top_mm: 10.0,
            right_mm: 10.0,
            bottom_mm: 10.0,
            printable_width_mm: 80.0,
            printable_height_mm: 80.0,
        };
        let crop = printable_crop_px(&printable_area, 100, 100).expect("printable crop");
        let full = analyze_rgb_image(img.clone()).expect("full coverage");
        let cropped = analyze_rgb_image_area(img, Some(crop)).expect("cropped coverage");

        assert!((full.coverage_percent - 64.0).abs() < 0.01);
        assert!((cropped.coverage_percent - 100.0).abs() < 0.01);
    }

    #[test]
    fn aggregate_uses_page_coverage_percent() {
        let low = analyze_rgb_image(RgbImage::from_pixel(10, 10, Rgb([255, 255, 255])))
            .expect("low coverage");
        let high =
            analyze_rgb_image(RgbImage::from_pixel(10, 10, Rgb([0, 0, 0]))).expect("high coverage");

        let stats = aggregate_coverage_stats(&[low, high]).expect("aggregate stats");

        assert!((stats.coverage_percent - 50.0).abs() < 0.01);
    }

    /// Golden-тест единого сборщика финального JSON: фиксированный вход → точный
    /// `serde_json::Value` со ВСЕМИ 14 полями контракта. Этот ответ напрямую кормит
    /// фронт-цену; любое изменение формы должно осознанно менять golden.
    #[test]
    fn assemble_coverage_result_json_emits_all_14_fields() {
        let aggregate = CoverageStats {
            coverage_percent: 12.345,
            c_avg: 1.111,
            m_avg: 2.222,
            y_avg: 3.333,
            k_avg: 4.444,
            pixel_count: 1000,
        };
        let recommendation = CoverageRecommendation {
            slug: "km-а4-печать-документа".to_string(),
            tier: "document",
            price: "10.00".parse().expect("price"),
            name: "Печать документа А4".to_string(),
        };
        let page_stats = CoverageStats {
            coverage_percent: 12.345,
            c_avg: 1.111,
            m_avg: 2.222,
            y_avg: 3.333,
            k_avg: 4.444,
            pixel_count: 1000,
        };
        let page_recommendation = CoverageRecommendation {
            slug: "km-а4-печать-документа".to_string(),
            tier: "document",
            price: "10.00".parse().expect("page price"),
            name: "Печать документа А4".to_string(),
        };
        let pages = vec![coverage_page_json(1, page_stats, page_recommendation)];
        let font_stats = DocxFontStats {
            sizes_pt: vec![11.0, 14.0],
            min_pt: 11.0,
            max_pt: 14.0,
            primary_pt: 11.0,
            explicit_size_count: 2,
        };

        let value = assemble_coverage_result_json(
            aggregate,
            recommendation,
            pages,
            1,
            DocumentType::Docx,
            Some(&font_stats),
            2.47,
            0.5,
            2.97,
        );

        // Числовые поля строим через `round_2` (как продакшн), потому что f32→JSON даёт
        // точный «хвост» (12.35f32 → 12.350000381469727); это и есть то, что реально едет
        // фронту. Цена сериализуется serde-BigDecimal как СТРОКА "10.00" — фиксируем явно.
        let expected = json!({
            "coverage_percent": round_2(12.345),
            "coverage_cmyk": {
                "c": round_2(1.111),
                "m": round_2(2.222),
                "y": round_2(3.333),
                "k": round_2(4.444),
            },
            "recommended_slug": "km-а4-печать-документа",
            "recommended_price": "10.00",
            "recommended_name": "Печать документа А4",
            "tier": "document",
            "page_count": 1,
            "pages": [{
                "page_number": 1,
                "coverage_percent": round_2(12.345),
                "coverage_cmyk": {
                    "c": round_2(1.111),
                    "m": round_2(2.222),
                    "y": round_2(3.333),
                    "k": round_2(4.444),
                },
                "recommended_slug": "km-а4-печать-документа",
                "recommended_price": "10.00",
                "recommended_name": "Печать документа А4",
                "tier": "document",
            }],
            "document_type": "docx",
            "coverage_policy": {
                "printer_scope": "laser_a4_a3",
                "paper_formats": ["a4", "a3"],
                "enabled_for": ["laser"],
                "enabled_file_types": ["document", "image"],
                "skipped_for": ["photo_print", "inkjet", "sublimation"],
            },
            "font_stats": {
                "sizes_pt": [11.0, 14.0],
                "min_pt": 11.0,
                "max_pt": 14.0,
                "primary_pt": 11.0,
                "explicit_size_count": 2,
            },
            "estimated_toner_cost": 2.47,
            "estimated_paper_cost": 0.5,
            "estimated_total_cost": 2.97,
        });

        assert_eq!(value, expected);
        // Явно подтверждаем полный состав 14 полей result.
        let obj = value.as_object().expect("result is object");
        assert_eq!(obj.len(), 14, "result must have exactly 14 fields");
    }

    /// SSRF-защита: validate_file_url отвергает внутренние/приватные адреса (тот же гейт
    /// защищает count-pages и coverage-job — оба зовут эту функцию первой).
    #[test]
    fn validate_file_url_rejects_internal_and_private_targets() {
        // localhost / loopback / метадата-сервис / 0.0.0.0
        assert!(validate_file_url("http://localhost/x").is_err());
        assert!(validate_file_url("http://127.0.0.1/x").is_err());
        assert!(validate_file_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_file_url("http://0.0.0.0/x").is_err());
        // Приватные IPv4-диапазоны
        assert!(validate_file_url("http://10.0.0.5/x").is_err());
        assert!(validate_file_url("http://192.168.50.43/x").is_err());
        assert!(validate_file_url("http://172.16.0.1/x").is_err());
        // Не-HTTP схема (чужой домен зависит от env PREVIEW_ALLOWED_DOMAINS — не проверяем
        // в юните, чтобы тест был детерминированным; покрыто SSRF-smoke на :3004).
        assert!(validate_file_url("file:///etc/passwd").is_err());
        assert!(validate_file_url("ftp://svoefoto.ru/x.pdf").is_err());
    }
}
