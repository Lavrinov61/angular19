use std::path::{Path, PathBuf};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgb, RgbImage, imageops::FilterType};
use tracing::{debug, info};

use crate::icc::IccCache;
use crate::proto;

// ── Paper sizes (mm) ──

fn paper_dimensions_mm(paper_id: &str) -> (f64, f64) {
    match paper_id.to_lowercase().as_str() {
        "10x15" => (100.0, 150.0),
        "13x18" => (130.0, 180.0),
        "15x21" => (150.0, 210.0),
        "20x30" => (200.0, 300.0),
        "10x10" => (100.0, 100.0),
        "a4" => (210.0, 297.0),
        "a5" => (148.0, 210.0),
        "a3" => (297.0, 420.0),
        _ => (210.0, 297.0), // default A4
    }
}

/// Convert mm to pixels at given DPI
fn mm_to_px(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round() as u32
}

// ── Download ──

/// Download file from URL to temp directory
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    temp_dir: &Path,
    max_size: u64,
) -> anyhow::Result<PathBuf> {
    info!(url, "Downloading file");

    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        anyhow::bail!("HTTP {}", response.status());
    }

    if let Some(len) = response.content_length() {
        if len > max_size {
            anyhow::bail!("File too large: {len} bytes (max {max_size})");
        }
    }

    let bytes = response.bytes().await?;
    if bytes.len() as u64 > max_size {
        anyhow::bail!("File too large: {} bytes (max {max_size})", bytes.len());
    }

    let ext = url.rsplit('.').next().unwrap_or("jpg");
    let ext = if ["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"].contains(&ext.to_lowercase().as_str()) {
        ext.to_lowercase()
    } else {
        "jpg".to_string()
    };

    let file_name = format!("dl_{}.{ext}", uuid::Uuid::new_v4());
    let path = temp_dir.join(file_name);
    std::fs::write(&path, &bytes)?;

    debug!(path = %path.display(), size = bytes.len(), "File downloaded");
    Ok(path)
}

// ── Image processing ──

/// Main image processing: load → orient → scale (fit mode) → ICC → grayscale → layout → save
pub fn process_image(
    cmd: &proto::PrintCommand,
    input_path: &Path,
    target_dpi: u32,
    icc_cache: Option<&IccCache>,
) -> anyhow::Result<PathBuf> {
    let img = image::open(input_path)?;
    let (img_w, img_h) = img.dimensions();
    debug!(width = img_w, height = img_h, "Image loaded");

    let (paper_w_mm, paper_h_mm) = paper_dimensions_mm(&cmd.paper_size);
    let (paper_w_mm, paper_h_mm) = orient_paper(paper_w_mm, paper_h_mm, img_w, img_h, cmd.orientation);

    // Check if multi-up layout is needed
    let has_layout = cmd.layout.as_ref().is_some_and(|l| l.rows > 1 || l.cols > 1);

    let output = if has_layout {
        render_layout(&img, cmd, paper_w_mm, paper_h_mm, target_dpi)?
    } else {
        render_single(&img, cmd, paper_w_mm, paper_h_mm, target_dpi)?
    };

    // 4.1: Apply ICC color transform (after rendering, before save)
    let output = apply_icc_if_available(output, &cmd.icc_profile_key, icc_cache);

    // Save processed image
    let output_path = input_path.with_extension("processed.jpg");
    output.save_with_format(&output_path, image::ImageFormat::Jpeg)?;

    debug!(path = %output_path.display(), "Image processed");
    Ok(output_path)
}

/// 4.5: Render a preview at reduced DPI (for CRM display).
pub fn render_preview(
    cmd: &proto::PrintCommand,
    input_path: &Path,
    preview_dpi: u32,
    icc_cache: Option<&IccCache>,
) -> anyhow::Result<Vec<u8>> {
    let img = image::open(input_path)?;
    let (img_w, img_h) = img.dimensions();

    let (paper_w_mm, paper_h_mm) = paper_dimensions_mm(&cmd.paper_size);
    let (paper_w_mm, paper_h_mm) = orient_paper(paper_w_mm, paper_h_mm, img_w, img_h, cmd.orientation);

    let has_layout = cmd.layout.as_ref().is_some_and(|l| l.rows > 1 || l.cols > 1);

    let output = if has_layout {
        render_layout(&img, cmd, paper_w_mm, paper_h_mm, preview_dpi)?
    } else {
        render_single(&img, cmd, paper_w_mm, paper_h_mm, preview_dpi)?
    };

    let output = apply_icc_if_available(output, &cmd.icc_profile_key, icc_cache);

    // Encode as JPEG to bytes
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    output.write_to(&mut cursor, image::ImageFormat::Jpeg)?;

    debug!(size = buf.len(), dpi = preview_dpi, "Preview rendered");
    Ok(buf)
}

/// Auto-orient: swap paper dimensions if image orientation mismatches.
fn orient_paper(paper_w_mm: f64, paper_h_mm: f64, img_w: u32, img_h: u32, orientation: i32) -> (f64, f64) {
    let orientation = proto::Orientation::try_from(orientation).unwrap_or(proto::Orientation::Auto);
    let is_landscape = match orientation {
        proto::Orientation::Landscape => true,
        proto::Orientation::Portrait => false,
        _ => img_w > img_h,
    };

    if is_landscape && paper_w_mm < paper_h_mm {
        (paper_h_mm, paper_w_mm)
    } else if !is_landscape && paper_w_mm > paper_h_mm {
        (paper_h_mm, paper_w_mm)
    } else {
        (paper_w_mm, paper_h_mm)
    }
}

/// Apply ICC color transform if profile key is provided and cache is available.
fn apply_icc_if_available(img: DynamicImage, profile_key: &str, icc_cache: Option<&IccCache>) -> DynamicImage {
    if profile_key.is_empty() {
        return img;
    }

    let Some(cache) = icc_cache else {
        return img;
    };

    if !cache.is_cached(profile_key) {
        tracing::warn!(profile = profile_key, "ICC profile not cached, skipping transform");
        return img;
    }

    match cache.apply_transform(&img, profile_key) {
        Ok(transformed) => {
            info!(profile = profile_key, "ICC color transform applied");
            transformed
        }
        Err(e) => {
            tracing::error!(profile = profile_key, error = %e, "ICC transform failed, using original");
            img
        }
    }
}

/// Render a single photo on the page
fn render_single(
    img: &DynamicImage,
    cmd: &proto::PrintCommand,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
) -> anyhow::Result<DynamicImage> {
    let page_w = mm_to_px(paper_w_mm, dpi);
    let page_h = mm_to_px(paper_h_mm, dpi);

    let fit_mode = proto::FitMode::try_from(cmd.fit_mode).unwrap_or(proto::FitMode::Fit);
    let scaled = scale_image(img, page_w, page_h, fit_mode);

    let result = apply_color_mode(scaled, cmd);
    Ok(result)
}

/// Render multi-up layout (e.g., 4 passport photos on 10x15)
fn render_layout(
    img: &DynamicImage,
    cmd: &proto::PrintCommand,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
) -> anyhow::Result<DynamicImage> {
    let layout = cmd.layout.as_ref().unwrap();
    let rows = layout.rows.max(1) as u32;
    let cols = layout.cols.max(1) as u32;
    let cut_margin_mm = layout.cut_margin_mm as f64;

    let page_w = mm_to_px(paper_w_mm, dpi);
    let page_h = mm_to_px(paper_h_mm, dpi);
    let margin_px = mm_to_px(cut_margin_mm, dpi);

    // Cell dimensions (excluding margins)
    let cell_w = (page_w - margin_px * (cols + 1)) / cols;
    let cell_h = (page_h - margin_px * (rows + 1)) / rows;

    // Scale photo to fit each cell
    let fit_mode = proto::FitMode::try_from(cmd.fit_mode).unwrap_or(proto::FitMode::Fill);
    let cell_photo = scale_image(img, cell_w, cell_h, fit_mode);
    let cell_photo = apply_color_mode(cell_photo, cmd);
    let cell_rgb = cell_photo.to_rgb8();

    // Create white page
    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));

    // Place photos in grid
    for row in 0..rows {
        for col in 0..cols {
            let x = margin_px + col * (cell_w + margin_px);
            let y = margin_px + row * (cell_h + margin_px);
            image::imageops::overlay(&mut page, &cell_rgb, x as i64, y as i64);
        }
    }

    // Draw cut marks if requested
    if layout.cut_marks {
        let mark_len = mm_to_px(layout.cut_mark_length_mm.max(3.0) as f64, dpi);
        let mark_offset = mm_to_px(layout.cut_mark_offset_mm.max(0.5) as f64, dpi);
        draw_cut_marks(&mut page, rows, cols, cell_w, cell_h, margin_px, mark_len, mark_offset);
    }

    Ok(DynamicImage::ImageRgb8(page))
}

// ── Fit modes (ported from SvfPrintHelper.exe Program.cs) ──

/// Scale image according to fit mode
fn scale_image(img: &DynamicImage, page_w: u32, page_h: u32, mode: proto::FitMode) -> DynamicImage {
    let (img_w, img_h) = img.dimensions();

    match mode {
        proto::FitMode::Fit => {
            // Inscribe with aspect ratio (CSS background-size: contain)
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.min(scale_y);
            let draw_w = (img_w as f64 * scale).round() as u32;
            let draw_h = (img_h as f64 * scale).round() as u32;

            let resized = img.resize_exact(draw_w, draw_h, FilterType::Lanczos3);

            // Center on white page
            let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = ((page_w - draw_w) / 2) as i64;
            let y = ((page_h - draw_h) / 2) as i64;
            image::imageops::overlay(&mut page, &resized.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }

        proto::FitMode::Fill => {
            // Cover with crop (CSS background-size: cover)
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.max(scale_y);
            let scaled_w = (img_w as f64 * scale).round() as u32;
            let scaled_h = (img_h as f64 * scale).round() as u32;

            let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Lanczos3);

            // Crop center
            let crop_x = (scaled_w.saturating_sub(page_w)) / 2;
            let crop_y = (scaled_h.saturating_sub(page_h)) / 2;
            resized.crop_imm(crop_x, crop_y, page_w, page_h)
        }

        proto::FitMode::Stretch => {
            // No aspect ratio preservation — stretch to fill
            img.resize_exact(page_w, page_h, FilterType::Lanczos3)
        }

        proto::FitMode::Actual => {
            // 1:1 pixels — center on page, no scaling
            let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = (page_w.saturating_sub(img_w) / 2) as i64;
            let y = (page_h.saturating_sub(img_h) / 2) as i64;
            image::imageops::overlay(&mut page, &img.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }

        _ => {
            // Default: fit
            scale_image(img, page_w, page_h, proto::FitMode::Fit)
        }
    }
}

/// Apply color mode: convert to grayscale if BW requested
fn apply_color_mode(img: DynamicImage, cmd: &proto::PrintCommand) -> DynamicImage {
    let color_mode = proto::ColorMode::try_from(cmd.color_mode).unwrap_or(proto::ColorMode::Color);
    if color_mode == proto::ColorMode::Bw {
        // ITU-R BT.601 luminosity (same as SvfPrintHelper.exe ColorMatrix)
        DynamicImage::ImageLuma8(image::imageops::grayscale(&img))
    } else {
        img
    }
}

// ── Cut marks ──

/// Draw cut marks at cell boundaries for trimming guide
fn draw_cut_marks(
    page: &mut RgbImage,
    rows: u32,
    cols: u32,
    cell_w: u32,
    cell_h: u32,
    margin: u32,
    mark_len: u32,
    mark_offset: u32,
) {
    let black = Rgb([0u8, 0, 0]);
    let (pw, ph) = (page.width(), page.height());

    // Vertical cut lines (between columns and at edges)
    for col in 0..=cols {
        let x = margin + col * (cell_w + margin) - margin / 2;
        if x >= pw { continue; }

        for row in 0..=rows {
            let cell_top = margin + row * (cell_h + margin);

            // Mark above cell
            let y_start = cell_top.saturating_sub(margin / 2 + mark_offset + mark_len);
            let y_end = cell_top.saturating_sub(margin / 2 + mark_offset);
            draw_vline(page, x, y_start, y_end, black);

            // Mark below cell
            if row < rows {
                let cell_bottom = cell_top + cell_h;
                let y_start = cell_bottom + margin / 2 + mark_offset;
                let y_end = y_start + mark_len;
                draw_vline(page, x, y_start, y_end.min(ph), black);
            }
        }
    }

    // Horizontal cut lines (between rows and at edges)
    for row in 0..=rows {
        let y = margin + row * (cell_h + margin) - margin / 2;
        if y >= ph { continue; }

        for col in 0..=cols {
            let cell_left = margin + col * (cell_w + margin);

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

fn draw_vline(img: &mut RgbImage, x: u32, y_start: u32, y_end: u32, color: Rgb<u8>) {
    let w = img.width();
    let h = img.height();
    if x >= w { return; }
    for y in y_start..y_end.min(h) {
        img.put_pixel(x, y, color);
    }
}

fn draw_hline(img: &mut RgbImage, y: u32, x_start: u32, x_end: u32, color: Rgb<u8>) {
    let w = img.width();
    let h = img.height();
    if y >= h { return; }
    for x in x_start..x_end.min(w) {
        img.put_pixel(x, y, color);
    }
}
