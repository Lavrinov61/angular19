//! Image processing pipeline for CUPS direct printing.
//!
//! Download from S3 URL -> crop -> rotate -> mirror -> scale to paper -> layout (N-up) -> save.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{
    DynamicImage, GenericImageView, ImageBuffer, ImageDecoder, ImageReader, Rgb, RgbImage,
    RgbaImage, imageops::FilterType, metadata::Orientation,
};
use tracing::{debug, info, warn};

use super::jpeg;
use super::ppd::PrintableAreaMm;

const DOCUMENT_SET_FOOTER_MM: f64 = 15.0;
// Подвал листа «Комплект на документы»: логотип + городской телефон + адреса.
// Полоса генерируется скриптом print-api/scripts/gen-document-set-footer.sh
// (логотип + svoefoto.ru + +7 (863) 322-65-75 + адреса студий).
const DOCUMENT_SET_FOOTER_BYTES: &[u8] =
    include_bytes!("../../../src/assets/images/document-set-footer.png");

/// Paper dimensions in millimeters.
pub(crate) fn paper_dimensions_mm(paper_id: &str) -> Option<(f64, f64)> {
    let dimensions = match paper_id.to_lowercase().as_str() {
        "10x15" => (100.0, 150.0),
        "13x18" => (130.0, 180.0),
        "15x20" => (150.0, 200.0),
        "15x21" => (150.0, 210.0),
        "20x30" => (200.0, 300.0),
        "10x10" => (100.0, 100.0),
        "a4" => (210.0, 297.0),
        "a5" => (148.0, 210.0),
        "a3" => (297.0, 420.0),
        "c6" | "c6_envelope" | "iso-c6-envelope" => (114.0, 162.0),
        "letter" => (215.9, 279.4),
        "legal" => (215.9, 355.6),
        _ => return None,
    };
    Some(dimensions)
}

fn mm_to_px(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round() as u32
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ImageAdjustmentParams {
    pub photo_enhance: bool,
    pub brightness: i16,
    pub contrast: i16,
    pub saturation: i16,
}

pub fn image_adjustments(
    photo_enhance: Option<bool>,
    brightness: Option<i16>,
    contrast: Option<i16>,
    saturation: Option<i16>,
) -> ImageAdjustmentParams {
    ImageAdjustmentParams {
        photo_enhance: photo_enhance.unwrap_or(false),
        brightness: brightness.unwrap_or(0).clamp(-40, 40),
        contrast: contrast.unwrap_or(0).clamp(-40, 40),
        saturation: saturation.unwrap_or(0).clamp(-60, 60),
    }
}

pub fn apply_image_adjustments(
    img: DynamicImage,
    adjustments: ImageAdjustmentParams,
) -> DynamicImage {
    let brightness = adjustments.brightness + if adjustments.photo_enhance { 4 } else { 0 };
    let contrast = adjustments.contrast + if adjustments.photo_enhance { 8 } else { 0 };
    let saturation = adjustments.saturation + if adjustments.photo_enhance { 12 } else { 0 };

    let img = if brightness != 0 {
        img.brighten(brightness as i32)
    } else {
        img
    };
    let img = if contrast != 0 {
        img.adjust_contrast(contrast as f32)
    } else {
        img
    };

    if saturation != 0 {
        adjust_saturation(img, saturation)
    } else {
        img
    }
}

fn adjust_saturation(img: DynamicImage, value: i16) -> DynamicImage {
    let factor = 1.0 + value as f32 / 100.0;
    let mut rgba: RgbaImage = img.to_rgba8();

    for pixel in rgba.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let r_f = r as f32;
        let g_f = g as f32;
        let b_f = b as f32;
        let luma = 0.299 * r_f + 0.587 * g_f + 0.114 * b_f;
        pixel.0 = [
            clamp_u8(luma + (r_f - luma) * factor),
            clamp_u8(luma + (g_f - luma) * factor),
            clamp_u8(luma + (b_f - luma) * factor),
            a,
        ];
    }

    DynamicImage::ImageRgba8(rgba)
}

fn clamp_u8(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

/// Download file from URL to temp directory with retry.
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    temp_dir: &str,
    max_size: u64,
) -> Result<PathBuf, String> {
    info!(url, "Downloading file for CUPS pipeline");

    let max_attempts = 3u32;
    let mut attempts = 0u32;
    let bytes = loop {
        attempts += 1;
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Some(len) = resp.content_length() {
                    if len > max_size {
                        return Err(format!("File too large: {len} bytes (max {max_size})"));
                    }
                }
                let b = resp
                    .bytes()
                    .await
                    .map_err(|e| format!("Download body error: {e}"))?;
                if b.len() as u64 > max_size {
                    return Err(format!(
                        "File too large: {} bytes (max {max_size})",
                        b.len()
                    ));
                }
                break b;
            }
            Ok(resp) => {
                if attempts >= max_attempts {
                    return Err(format!(
                        "HTTP {} after {} attempts",
                        resp.status(),
                        max_attempts
                    ));
                }
                tracing::warn!(attempt = attempts, status = %resp.status(), "Download failed, retrying");
                tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempts))).await;
            }
            Err(e) => {
                if attempts >= max_attempts {
                    return Err(format!(
                        "Download error after {} attempts: {}",
                        max_attempts, e
                    ));
                }
                tracing::warn!(attempt = attempts, error = %e, "Download error, retrying");
                tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempts))).await;
            }
        }
    };

    let ext = url.rsplit('.').next().unwrap_or("jpg");
    let ext = if ["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"]
        .contains(&ext.to_lowercase().as_str())
    {
        ext.to_lowercase()
    } else {
        "jpg".to_string()
    };

    let file_name = format!("cups_dl_{}.{ext}", uuid::Uuid::new_v4());
    let path = Path::new(temp_dir).join(file_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write temp file: {e}"))?;

    debug!(path = %path.display(), size = bytes.len(), "File downloaded for CUPS");
    Ok(path)
}

/// Image processing parameters extracted from the job.
pub struct ProcessParams {
    pub paper_size: String,
    pub orientation: String,
    pub fit_mode: String,
    pub color_mode: String,
    pub mirror: bool,
    pub rotation: i16,
    pub crop_x: f32,
    pub crop_y: f32,
    pub crop_width: f32,
    pub crop_height: f32,
    pub adjustments: ImageAdjustmentParams,
    pub layout_rows: i32,
    pub layout_cols: i32,
    pub custom_photo_width_mm: Option<f64>,
    pub custom_photo_height_mm: Option<f64>,
    pub cut_marks: bool,
    pub cut_margin_mm: f64,
    pub cut_mark_length_mm: f64,
    pub cut_mark_offset_mm: f64,
    pub document_template_slug: String,
    pub printable_area_mm: Option<PrintableAreaMm>,
    /// True borderless sheet size (mm) from the printer PPD. When set (borderless
    /// jobs), the image is rendered to this exact size so it fully covers the
    /// borderless page; falls back to [`paper_dimensions_mm`] when `None`.
    pub borderless_paper_mm: Option<(f64, f64)>,
}

/// Read EXIF orientation from a decoder and apply it to the decoded image.
///
/// `image::open` / `load_from_memory` decode raw pixels and IGNORE the EXIF
/// orientation flag. Phone photos are commonly stored in the sensor's native
/// (often landscape) orientation plus an EXIF flag telling viewers to rotate.
/// Browsers honor that flag, so the crop UI and our auto-orientation operate in
/// the *displayed* pixel space — if we print the raw pixels, the crop region and
/// page orientation come out wrong. Applying the flag here aligns the print/preview
/// pixel space with what the operator saw in the dialog.
fn finalize_oriented(
    mut decoder: impl ImageDecoder,
) -> Result<DynamicImage, String> {
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img =
        DynamicImage::from_decoder(decoder).map_err(|e| format!("Failed to decode image: {e}"))?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Open an image file applying its EXIF orientation (see [`finalize_oriented`]).
pub fn load_image_oriented(path: &Path) -> Result<DynamicImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image header: {e}"))?;
    let decoder = reader
        .into_decoder()
        .map_err(|e| format!("Failed to decode image: {e}"))?;
    finalize_oriented(decoder)
}

/// Decode an in-memory image applying its EXIF orientation (see [`finalize_oriented`]).
pub fn load_image_oriented_from_memory(bytes: &[u8]) -> Result<DynamicImage, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Image decode error: {e}"))?;
    let decoder = reader
        .into_decoder()
        .map_err(|e| format!("Image decode error: {e}"))?;
    finalize_oriented(decoder)
}

/// Process image for printing: crop -> rotate -> mirror -> scale -> layout -> save.
/// Must be called inside `spawn_blocking`.
pub fn process_image(
    input_path: &Path,
    params: &ProcessParams,
    target_dpi: u32,
) -> Result<PathBuf, String> {
    let img = load_image_oriented(input_path)?;
    let (img_w, img_h) = img.dimensions();
    debug!(
        width = img_w,
        height = img_h,
        "Image loaded for CUPS processing"
    );

    // Apply crop if specified
    let img = apply_crop(img, params);

    // Apply rotation
    let img = apply_rotation(img, params.rotation);

    // Apply mirror
    let img = if params.mirror {
        DynamicImage::from(image::imageops::flip_horizontal(&img))
    } else {
        img
    };

    let img = apply_image_adjustments(img, params.adjustments);

    let (img_w, img_h) = img.dimensions();

    // Paper dimensions. Borderless jobs render to the printer's true sheet size
    // (from the PPD) so the photo covers the full borderless page; non-borderless
    // jobs keep the nominal table size (margins are insets from the PPD instead).
    let (paper_w_mm, paper_h_mm) = params
        .borderless_paper_mm
        .or_else(|| paper_dimensions_mm(&params.paper_size))
        .ok_or_else(|| format!("Unsupported paper size: {}", params.paper_size))?;
    let (paper_w_mm, paper_h_mm) =
        orient_paper(paper_w_mm, paper_h_mm, img_w, img_h, &params.orientation);

    let has_layout = params.layout_rows > 1 || params.layout_cols > 1;

    let output = if has_layout {
        render_layout(&img, params, paper_w_mm, paper_h_mm, target_dpi)?
    } else {
        render_single(&img, params, paper_w_mm, paper_h_mm, target_dpi)?
    };

    // Apply grayscale if BW mode
    let output = if params.color_mode == "bw" {
        DynamicImage::ImageLuma8(image::imageops::grayscale(&output))
    } else {
        output
    };

    // Save processed image
    let output_path = input_path.with_extension("processed.jpg");
    jpeg::save_dynamic_jpeg(&output_path, &output, 95, target_dpi)?;

    debug!(path = %output_path.display(), "Image processed for CUPS");
    Ok(output_path)
}

fn apply_crop(img: DynamicImage, params: &ProcessParams) -> DynamicImage {
    if params.crop_width <= 0.0 || params.crop_height <= 0.0 {
        return img;
    }
    let (w, h) = img.dimensions();

    let crop_width = params.crop_width.clamp(0.0, 1.0);
    let crop_height = params.crop_height.clamp(0.0, 1.0);
    let crop_x = params.crop_x.clamp(0.0, 1.0 - crop_width);
    let crop_y = params.crop_y.clamp(0.0, 1.0 - crop_height);

    let cx = (crop_x * w as f32).round() as u32;
    let cy = (crop_y * h as f32).round() as u32;
    let cw = (crop_width * w as f32).round().max(1.0) as u32;
    let ch = (crop_height * h as f32).round().max(1.0) as u32;
    let cw = cw.min(w.saturating_sub(cx));
    let ch = ch.min(h.saturating_sub(cy));
    if cw == 0 || ch == 0 {
        return img;
    }
    img.crop_imm(cx, cy, cw, ch)
}

fn apply_rotation(img: DynamicImage, rotation: i16) -> DynamicImage {
    match rotation.rem_euclid(360) {
        90 => DynamicImage::from(image::imageops::rotate90(&img)),
        180 => DynamicImage::from(image::imageops::rotate180(&img)),
        270 => DynamicImage::from(image::imageops::rotate270(&img)),
        _ => img,
    }
}

fn orient_paper(
    paper_w_mm: f64,
    paper_h_mm: f64,
    img_w: u32,
    img_h: u32,
    orientation: &str,
) -> (f64, f64) {
    let is_landscape = match orientation {
        "landscape" => true,
        "portrait" => false,
        _ => img_w > img_h, // auto
    };

    if is_landscape && paper_w_mm < paper_h_mm {
        (paper_h_mm, paper_w_mm)
    } else if !is_landscape && paper_w_mm > paper_h_mm {
        (paper_h_mm, paper_w_mm)
    } else {
        (paper_w_mm, paper_h_mm)
    }
}

fn render_single(
    img: &DynamicImage,
    params: &ProcessParams,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
) -> Result<DynamicImage, String> {
    let page_w = mm_to_px(paper_w_mm, dpi);
    let page_h = mm_to_px(paper_h_mm, dpi);
    let Some(content) = content_rect_px(params, paper_w_mm, paper_h_mm, dpi, page_w, page_h) else {
        return Ok(scale_image(img, page_w, page_h, &params.fit_mode));
    };

    let rendered = scale_image(img, content.w, content.h, &params.fit_mode).to_rgb8();
    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
    image::imageops::overlay(&mut page, &rendered, content.x as i64, content.y as i64);
    Ok(DynamicImage::ImageRgb8(page))
}

fn render_layout(
    img: &DynamicImage,
    params: &ProcessParams,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
) -> Result<DynamicImage, String> {
    let rows = params.layout_rows.max(1) as u32;
    let cols = params.layout_cols.max(1) as u32;
    let cut_margin_mm = params.cut_margin_mm;

    let page_w = mm_to_px(paper_w_mm, dpi);
    let page_h = mm_to_px(paper_h_mm, dpi);
    let content = content_rect_px(params, paper_w_mm, paper_h_mm, dpi, page_w, page_h).unwrap_or(
        ContentRectPx {
            x: 0,
            y: 0,
            w: page_w,
            h: page_h,
        },
    );
    let margin_px = mm_to_px(cut_margin_mm, dpi);
    let is_document_set = params.document_template_slug.starts_with("document-set")
        || params.document_template_slug == "document_set";

    if let Some((cell_w, cell_h)) = custom_cell_px(params, dpi) {
        return render_precise_layout(
            img,
            params,
            rows,
            cols,
            page_w,
            page_h,
            content,
            cell_w,
            cell_h,
            is_document_set,
            dpi,
        );
    }

    let cell_w = content.w.saturating_sub(margin_px.saturating_mul(cols + 1)) / cols;
    let cell_h = content.h.saturating_sub(margin_px.saturating_mul(rows + 1)) / rows;
    if cell_w == 0 || cell_h == 0 {
        return Err("Printable area is too small for requested layout".to_string());
    }

    let cell_photo = scale_image(img, cell_w, cell_h, &params.fit_mode);
    let cell_rgb = cell_photo.to_rgb8();

    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));

    for row in 0..rows {
        for col in 0..cols {
            let x = content.x + margin_px + col * (cell_w + margin_px);
            let y = content.y + margin_px + row * (cell_h + margin_px);
            image::imageops::overlay(&mut page, &cell_rgb, x as i64, y as i64);
        }
    }

    if params.cut_marks {
        let mark_len = mm_to_px(params.cut_mark_length_mm.max(3.0), dpi);
        let mark_offset = mm_to_px(params.cut_mark_offset_mm.max(0.5), dpi);
        draw_cut_marks(
            &mut page,
            rows,
            cols,
            cell_w,
            cell_h,
            content.x + margin_px,
            content.y + margin_px,
            margin_px,
            mark_len,
            mark_offset,
        );
    }

    Ok(DynamicImage::ImageRgb8(page))
}

fn custom_cell_px(params: &ProcessParams, dpi: u32) -> Option<(u32, u32)> {
    let width = params.custom_photo_width_mm?;
    let height = params.custom_photo_height_mm?;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some((mm_to_px(width, dpi), mm_to_px(height, dpi)))
}

fn render_precise_layout(
    img: &DynamicImage,
    params: &ProcessParams,
    rows: u32,
    cols: u32,
    page_w: u32,
    page_h: u32,
    content: ContentRectPx,
    cell_w: u32,
    cell_h: u32,
    is_document_set: bool,
    dpi: u32,
) -> Result<DynamicImage, String> {
    let gap_px = mm_to_px(params.cut_margin_mm.max(0.0), dpi);
    let footer_h = if is_document_set {
        mm_to_px(DOCUMENT_SET_FOOTER_MM, dpi).min(content.h)
    } else {
        0
    };
    let content_h = content.h.saturating_sub(footer_h);
    let grid_w = cols
        .saturating_mul(cell_w)
        .saturating_add(cols.saturating_sub(1).saturating_mul(gap_px));
    let grid_h = rows
        .saturating_mul(cell_h)
        .saturating_add(rows.saturating_sub(1).saturating_mul(gap_px));
    if grid_w > content.w || grid_h > content_h {
        return Err("Printable area is too small for requested precise layout".to_string());
    }
    let start_x = content.x + content.w.saturating_sub(grid_w) / 2;
    let start_y = content.y + content_h.saturating_sub(grid_h) / 2;

    let cell_photo = scale_image(img, cell_w, cell_h, &params.fit_mode);
    let cell_rgb = cell_photo.to_rgb8();
    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));

    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for row in 0..rows {
        for col in 0..cols {
            let x = start_x + col * (cell_w + gap_px);
            let y = start_y + row * (cell_h + gap_px);
            image::imageops::overlay(&mut page, &cell_rgb, x as i64, y as i64);
            cells.push((x, y, cell_w, cell_h));
        }
    }

    if params.cut_marks {
        let mark_len = mm_to_px(params.cut_mark_length_mm.max(3.0), dpi);
        let mark_offset = mm_to_px(params.cut_mark_offset_mm.max(0.5), dpi);
        draw_precise_cut_marks(&mut page, &cells, mark_len, mark_offset);
    }

    if is_document_set {
        draw_document_set_footer(&mut page, footer_h, dpi);
    }

    Ok(DynamicImage::ImageRgb8(page))
}

fn scale_image(img: &DynamicImage, page_w: u32, page_h: u32, fit_mode: &str) -> DynamicImage {
    let (img_w, img_h) = img.dimensions();

    match fit_mode {
        "fill" => {
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.max(scale_y);
            let scaled_w = (img_w as f64 * scale).round() as u32;
            let scaled_h = (img_h as f64 * scale).round() as u32;
            let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Lanczos3);
            let crop_x = scaled_w.saturating_sub(page_w) / 2;
            let crop_y = scaled_h.saturating_sub(page_h) / 2;
            resized.crop_imm(crop_x, crop_y, page_w, page_h)
        }
        "stretch" => img.resize_exact(page_w, page_h, FilterType::Lanczos3),
        "actual" => {
            let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = (page_w.saturating_sub(img_w) / 2) as i64;
            let y = (page_h.saturating_sub(img_h) / 2) as i64;
            image::imageops::overlay(&mut page, &img.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }
        _ => {
            // "fit" (default)
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.min(scale_y);
            let draw_w = (img_w as f64 * scale).round() as u32;
            let draw_h = (img_h as f64 * scale).round() as u32;
            let resized = img.resize_exact(draw_w, draw_h, FilterType::Lanczos3);
            let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = ((page_w - draw_w) / 2) as i64;
            let y = ((page_h - draw_h) / 2) as i64;
            image::imageops::overlay(&mut page, &resized.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }
    }
}

fn draw_cut_marks(
    page: &mut RgbImage,
    rows: u32,
    cols: u32,
    cell_w: u32,
    cell_h: u32,
    start_x: u32,
    start_y: u32,
    margin: u32,
    mark_len: u32,
    mark_offset: u32,
) {
    let black = Rgb([0u8, 0, 0]);
    let (pw, ph) = (page.width(), page.height());

    for col in 0..=cols {
        let x = start_x + col * (cell_w + margin) - margin / 2;
        if x >= pw {
            continue;
        }
        for row in 0..=rows {
            let cell_top = start_y + row * (cell_h + margin);
            let y_start = cell_top.saturating_sub(margin / 2 + mark_offset + mark_len);
            let y_end = cell_top.saturating_sub(margin / 2 + mark_offset);
            draw_vline(page, x, y_start, y_end, black);

            if row < rows {
                let cell_bottom = cell_top + cell_h;
                let y_start = cell_bottom + margin / 2 + mark_offset;
                let y_end = y_start + mark_len;
                draw_vline(page, x, y_start, y_end.min(ph), black);
            }
        }
    }

    for row in 0..=rows {
        let y = start_y + row * (cell_h + margin) - margin / 2;
        if y >= ph {
            continue;
        }
        for col in 0..=cols {
            let cell_left = start_x + col * (cell_w + margin);
            let x_start = cell_left.saturating_sub(margin / 2 + mark_offset + mark_len);
            let x_end = cell_left.saturating_sub(margin / 2 + mark_offset);
            draw_hline(page, y, x_start, x_end, black);

            if col < cols {
                let cell_right = cell_left + cell_w;
                let x_start = cell_right + margin / 2 + mark_offset;
                let x_end = x_start + mark_len;
                draw_hline(page, y, x_start, x_end.min(pw), black);
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct ContentRectPx {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

fn content_rect_px(
    params: &ProcessParams,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
    page_w: u32,
    page_h: u32,
) -> Option<ContentRectPx> {
    let area = params.printable_area_mm.as_ref()?;
    let rotated =
        approx_eq(paper_w_mm, area.page_height_mm) && approx_eq(paper_h_mm, area.page_width_mm);

    let (left_mm, top_mm, printable_w_mm, printable_h_mm) = if rotated {
        (
            area.top_mm,
            area.right_mm,
            area.printable_height_mm,
            area.printable_width_mm,
        )
    } else {
        (
            area.left_mm,
            area.top_mm,
            area.printable_width_mm,
            area.printable_height_mm,
        )
    };

    let x = mm_to_px(left_mm.max(0.0), dpi).min(page_w.saturating_sub(1));
    let y = mm_to_px(top_mm.max(0.0), dpi).min(page_h.saturating_sub(1));
    let max_w = page_w.saturating_sub(x).max(1);
    let max_h = page_h.saturating_sub(y).max(1);
    let w = mm_to_px(printable_w_mm.max(1.0), dpi).min(max_w).max(1);
    let h = mm_to_px(printable_h_mm.max(1.0), dpi).min(max_h).max(1);

    Some(ContentRectPx { x, y, w, h })
}

fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() < 1.0
}

fn draw_precise_cut_marks(
    page: &mut RgbImage,
    cells: &[(u32, u32, u32, u32)],
    mark_len: u32,
    mark_offset: u32,
) {
    let black = Rgb([0u8, 0, 0]);
    for &(x, y, w, h) in cells {
        let left_outer = x.saturating_sub(mark_offset + mark_len);
        let left_inner = x.saturating_sub(mark_offset);
        let right_inner = x.saturating_add(w).saturating_add(mark_offset);
        let right_outer = right_inner.saturating_add(mark_len);
        let top_outer = y.saturating_sub(mark_offset + mark_len);
        let top_inner = y.saturating_sub(mark_offset);
        let bottom_inner = y.saturating_add(h).saturating_add(mark_offset);
        let bottom_outer = bottom_inner.saturating_add(mark_len);

        draw_hline(page, y, left_outer, left_inner, black);
        draw_hline(page, y, right_inner, right_outer, black);
        draw_hline(page, y.saturating_add(h), left_outer, left_inner, black);
        draw_hline(page, y.saturating_add(h), right_inner, right_outer, black);

        draw_vline(page, x, top_outer, top_inner, black);
        draw_vline(page, x, bottom_inner, bottom_outer, black);
        draw_vline(page, x.saturating_add(w), top_outer, top_inner, black);
        draw_vline(page, x.saturating_add(w), bottom_inner, bottom_outer, black);
    }
}

fn draw_document_set_footer(page: &mut RgbImage, footer_h: u32, dpi: u32) {
    if footer_h == 0 {
        return;
    }

    let footer_y = page.height().saturating_sub(footer_h);
    let accent = Rgb([245u8, 158, 11]);
    let line_h = mm_to_px(0.35, dpi).max(1);
    for y in footer_y..footer_y.saturating_add(line_h).min(page.height()) {
        draw_hline(page, y, 0, page.width(), accent);
    }

    let strip = match image::load_from_memory(DOCUMENT_SET_FOOTER_BYTES) {
        Ok(strip) => strip,
        Err(err) => {
            warn!("Cannot decode document-set footer strip: {err}");
            return;
        }
    };
    let strip_w = strip.width();
    let strip_h = strip.height();
    if strip_w == 0 || strip_h == 0 {
        return;
    }

    let side_margin = mm_to_px(5.0, dpi);
    let max_w = page.width().saturating_sub(side_margin * 2).max(1);
    let max_h = footer_h.saturating_sub(mm_to_px(2.0, dpi)).max(1);
    let scale = (max_w as f64 / strip_w as f64).min(max_h as f64 / strip_h as f64);
    let draw_w = ((strip_w as f64 * scale).round() as u32).max(1);
    let draw_h = ((strip_h as f64 * scale).round() as u32).max(1);
    let strip = strip
        .resize_exact(draw_w, draw_h, FilterType::Lanczos3)
        .to_rgba8();
    let x = page.width().saturating_sub(draw_w) / 2;
    let y = footer_y + footer_h.saturating_sub(draw_h) / 2;
    overlay_rgba(page, &strip, x, y);
}

fn overlay_rgba(page: &mut RgbImage, overlay: &RgbaImage, x0: u32, y0: u32) {
    for y in 0..overlay.height() {
        let dst_y = y0.saturating_add(y);
        if dst_y >= page.height() {
            break;
        }
        for x in 0..overlay.width() {
            let dst_x = x0.saturating_add(x);
            if dst_x >= page.width() {
                break;
            }
            let src = overlay.get_pixel(x, y);
            let alpha = src[3] as f32 / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            let dst = page.get_pixel(dst_x, dst_y);
            let blended = Rgb([
                (src[0] as f32 * alpha + dst[0] as f32 * (1.0 - alpha)).round() as u8,
                (src[1] as f32 * alpha + dst[1] as f32 * (1.0 - alpha)).round() as u8,
                (src[2] as f32 * alpha + dst[2] as f32 * (1.0 - alpha)).round() as u8,
            ]);
            page.put_pixel(dst_x, dst_y, blended);
        }
    }
}

fn draw_vline(img: &mut RgbImage, x: u32, y_start: u32, y_end: u32, color: Rgb<u8>) {
    if x >= img.width() {
        return;
    }
    for y in y_start..y_end.min(img.height()) {
        img.put_pixel(x, y, color);
    }
}

fn draw_hline(img: &mut RgbImage, y: u32, x_start: u32, x_end: u32, color: Rgb<u8>) {
    if y >= img.height() {
        return;
    }
    for x in x_start..x_end.min(img.width()) {
        img.put_pixel(x, y, color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_params(borderless_paper_mm: Option<(f64, f64)>) -> ProcessParams {
        ProcessParams {
            paper_size: "10x15".to_string(),
            orientation: "auto".to_string(),
            fit_mode: "fill".to_string(),
            color_mode: "color".to_string(),
            mirror: false,
            rotation: 0,
            crop_x: 0.0,
            crop_y: 0.0,
            crop_width: 0.0,
            crop_height: 0.0,
            adjustments: ImageAdjustmentParams::default(),
            layout_rows: 1,
            layout_cols: 1,
            custom_photo_width_mm: None,
            custom_photo_height_mm: None,
            cut_marks: false,
            cut_margin_mm: 1.0,
            cut_mark_length_mm: 5.0,
            cut_mark_offset_mm: 2.0,
            document_template_slug: String::new(),
            printable_area_mm: None,
            borderless_paper_mm,
        }
    }

    fn write_temp_portrait_jpeg() -> PathBuf {
        let img: RgbImage = ImageBuffer::from_pixel(400, 600, Rgb([10, 120, 200]));
        let path =
            std::env::temp_dir().join(format!("pipeline_test_{}.jpg", uuid::Uuid::new_v4()));
        DynamicImage::ImageRgb8(img)
            .save(&path)
            .expect("write temp jpeg");
        path
    }

    /// Borderless prints must render to the printer's true 4x6in sheet
    /// (101.6x152.4mm = 1200x1800px @300dpi), not the rounded 100x150 nominal,
    /// otherwise the borderless page keeps an uneven white border.
    #[test]
    fn borderless_renders_to_true_sheet_dimensions() {
        let src = write_temp_portrait_jpeg();
        let params = base_params(Some((101.6, 152.4)));
        let out = process_image(&src, &params, 300).expect("process borderless");
        let (w, h) = image::open(&out).expect("open output").dimensions();
        assert_eq!((w, h), (1200, 1800));
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&out);
    }

    /// Without an explicit borderless sheet size we keep the nominal table size.
    #[test]
    fn non_borderless_keeps_nominal_dimensions() {
        let src = write_temp_portrait_jpeg();
        let params = base_params(None);
        let out = process_image(&src, &params, 300).expect("process nominal");
        let (w, h) = image::open(&out).expect("open output").dimensions();
        assert_eq!((w, h), (1181, 1772));
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn c6_envelope_has_exact_physical_dimensions() {
        assert_eq!(paper_dimensions_mm("c6_envelope"), Some((114.0, 162.0)));
        assert_eq!(paper_dimensions_mm("C6"), Some((114.0, 162.0)));
    }
}
