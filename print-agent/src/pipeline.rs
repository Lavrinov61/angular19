//! Print job processing pipeline — cross-platform image manipulation.
//!
//! Handles: download → orient → scale (fit mode) → ICC → grayscale → layout → save.
//! Ported from rust-agent/pipeline.rs — pure Rust image processing, no platform deps.

use std::io::BufReader;
use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, ImageBuffer, Rgb, RgbImage, imageops::FilterType};
use image::codecs::jpeg::JpegEncoder;
use tracing::{debug, info};

use crate::icc::IccCache;
use crate::print_proto;

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
        _ => (210.0, 297.0),
    }
}

fn mm_to_px(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round() as u32
}

// ── Download ──

/// Download file from URL to temp directory.
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    temp_dir: &str,
    max_size: u64,
) -> anyhow::Result<PathBuf> {
    info!(url, "Downloading file");

    let max_attempts = 3u32;
    let mut attempts = 0u32;
    let bytes = loop {
        attempts += 1;
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Some(len) = resp.content_length() {
                    if len > max_size {
                        anyhow::bail!("File too large: {len} bytes (max {max_size})");
                    }
                }
                let b = resp.bytes().await?;
                if b.len() as u64 > max_size {
                    anyhow::bail!("File too large: {} bytes (max {max_size})", b.len());
                }
                break b;
            }
            Ok(resp) => {
                if attempts >= max_attempts {
                    anyhow::bail!("HTTP {} after {} attempts", resp.status(), max_attempts);
                }
                tracing::warn!(attempt = attempts, status = %resp.status(), "Download failed, retrying");
                tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempts))).await;
            }
            Err(e) => {
                if attempts >= max_attempts {
                    anyhow::bail!("Download error after {} attempts: {}", max_attempts, e);
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

    let file_name = format!("dl_{}.{ext}", uuid::Uuid::new_v4());
    let path = Path::new(temp_dir).join(file_name);
    std::fs::write(&path, &bytes)?;

    debug!(path = %path.display(), size = bytes.len(), "File downloaded");
    Ok(path)
}

// ── EXIF orientation ──

/// Read EXIF orientation tag and apply rotation/flip to correct the image.
fn apply_exif_orientation(img: DynamicImage, input_path: &Path) -> DynamicImage {
    let file = match std::fs::File::open(input_path) {
        Ok(f) => f,
        Err(_) => return img,
    };
    let mut bufreader = BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut bufreader) {
        Ok(e) => e,
        Err(_) => {
            debug!("No EXIF data found, using image as-is");
            return img;
        }
    };

    let orientation = exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);

    if orientation == 1 {
        return img;
    }

    debug!(orientation, "Applying EXIF orientation correction");

    match orientation {
        2 => DynamicImage::from(image::imageops::flip_horizontal(&img)),
        3 => DynamicImage::from(image::imageops::rotate180(&img)),
        4 => DynamicImage::from(image::imageops::flip_vertical(&img)),
        5 => {
            let rotated = image::imageops::rotate90(&img);
            DynamicImage::from(image::imageops::flip_horizontal(&DynamicImage::from(rotated)))
        }
        6 => DynamicImage::from(image::imageops::rotate90(&img)),
        7 => {
            let rotated = image::imageops::rotate90(&img);
            DynamicImage::from(image::imageops::flip_vertical(&DynamicImage::from(rotated)))
        }
        8 => DynamicImage::from(image::imageops::rotate270(&img)),
        _ => img,
    }
}

// ── Image processing ──

/// Main image processing pipeline: load → EXIF orient → scale → ICC → grayscale → layout → save.
pub fn process_image(
    cmd: &print_proto::PrintCommand,
    input_path: &Path,
    target_dpi: u32,
    icc_cache: Option<&IccCache>,
    jpeg_quality: u8,
) -> anyhow::Result<PathBuf> {
    let img = image::open(input_path)?;
    let img = apply_exif_orientation(img, input_path);
    let (img_w, img_h) = img.dimensions();
    debug!(width = img_w, height = img_h, "Image loaded");

    let (paper_w_mm, paper_h_mm) = paper_dimensions_mm(&cmd.paper_size);
    let (paper_w_mm, paper_h_mm) =
        orient_paper(paper_w_mm, paper_h_mm, img_w, img_h, cmd.orientation);

    let has_layout = cmd.layout.as_ref().is_some_and(|l| l.rows > 1 || l.cols > 1);

    let output = if has_layout {
        render_layout(&img, cmd, paper_w_mm, paper_h_mm, target_dpi)?
    } else {
        render_single(&img, cmd, paper_w_mm, paper_h_mm, target_dpi)?
    };

    let output = apply_icc_if_available(output, &cmd.icc_profile_key, icc_cache);

    let output_path = input_path.with_extension("processed.jpg");
    let file = std::fs::File::create(&output_path)?;
    let mut encoder = JpegEncoder::new_with_quality(file, jpeg_quality);
    encoder.encode(output.as_bytes(), output.width(), output.height(), output.color().into())?;

    debug!(path = %output_path.display(), quality = jpeg_quality, "Image processed");
    Ok(output_path)
}

/// Render a preview at reduced DPI (for CRM display).
pub fn render_preview(
    cmd: &print_proto::PrintCommand,
    input_path: &Path,
    preview_dpi: u32,
    icc_cache: Option<&IccCache>,
) -> anyhow::Result<Vec<u8>> {
    let img = image::open(input_path)?;
    let img = apply_exif_orientation(img, input_path);
    let (img_w, img_h) = img.dimensions();

    let (paper_w_mm, paper_h_mm) = paper_dimensions_mm(&cmd.paper_size);
    let (paper_w_mm, paper_h_mm) =
        orient_paper(paper_w_mm, paper_h_mm, img_w, img_h, cmd.orientation);

    let has_layout = cmd.layout.as_ref().is_some_and(|l| l.rows > 1 || l.cols > 1);

    let output = if has_layout {
        render_layout(&img, cmd, paper_w_mm, paper_h_mm, preview_dpi)?
    } else {
        render_single(&img, cmd, paper_w_mm, paper_h_mm, preview_dpi)?
    };

    let output = apply_icc_if_available(output, &cmd.icc_profile_key, icc_cache);

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 80);
    encoder.encode(output.as_bytes(), output.width(), output.height(), output.color().into())?;

    debug!(size = buf.len(), dpi = preview_dpi, "Preview rendered");
    Ok(buf)
}

// ── Orientation ──

fn orient_paper(
    paper_w_mm: f64,
    paper_h_mm: f64,
    img_w: u32,
    img_h: u32,
    orientation: i32,
) -> (f64, f64) {
    let orientation =
        print_proto::Orientation::try_from(orientation).unwrap_or(print_proto::Orientation::Auto);
    let is_landscape = match orientation {
        print_proto::Orientation::Landscape => true,
        print_proto::Orientation::Portrait => false,
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

// ── ICC ──

fn apply_icc_if_available(
    img: DynamicImage,
    profile_key: &str,
    icc_cache: Option<&IccCache>,
) -> DynamicImage {
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

// ── Rendering ──

fn render_single(
    img: &DynamicImage,
    cmd: &print_proto::PrintCommand,
    paper_w_mm: f64,
    paper_h_mm: f64,
    dpi: u32,
) -> anyhow::Result<DynamicImage> {
    let page_w = mm_to_px(paper_w_mm, dpi);
    let page_h = mm_to_px(paper_h_mm, dpi);

    let fit_mode =
        print_proto::FitMode::try_from(cmd.fit_mode).unwrap_or(print_proto::FitMode::Fit);
    let scaled = scale_image(img, page_w, page_h, fit_mode);
    let result = apply_color_mode(scaled, cmd);
    Ok(result)
}

fn render_layout(
    img: &DynamicImage,
    cmd: &print_proto::PrintCommand,
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

    let cell_w = (page_w - margin_px * (cols + 1)) / cols;
    let cell_h = (page_h - margin_px * (rows + 1)) / rows;

    let fit_mode =
        print_proto::FitMode::try_from(cmd.fit_mode).unwrap_or(print_proto::FitMode::Fit);
    let cell_photo = scale_image(img, cell_w, cell_h, fit_mode);
    let cell_photo = apply_color_mode(cell_photo, cmd);
    let cell_rgb = cell_photo.to_rgb8();

    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));

    for row in 0..rows {
        for col in 0..cols {
            let x = margin_px + col * (cell_w + margin_px);
            let y = margin_px + row * (cell_h + margin_px);
            image::imageops::overlay(&mut page, &cell_rgb, x as i64, y as i64);
        }
    }

    if layout.cut_marks {
        let mark_len = mm_to_px(layout.cut_mark_length_mm.max(3.0) as f64, dpi);
        let mark_offset = mm_to_px(layout.cut_mark_offset_mm.max(0.5) as f64, dpi);
        draw_cut_marks(
            &mut page, rows, cols, cell_w, cell_h, margin_px, mark_len, mark_offset,
        );
    }

    Ok(DynamicImage::ImageRgb8(page))
}

// ── Fit modes ──

fn scale_image(
    img: &DynamicImage,
    page_w: u32,
    page_h: u32,
    mode: print_proto::FitMode,
) -> DynamicImage {
    let (img_w, img_h) = img.dimensions();

    match mode {
        print_proto::FitMode::Fit => {
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.min(scale_y);
            let draw_w = (img_w as f64 * scale).round() as u32;
            let draw_h = (img_h as f64 * scale).round() as u32;

            let resized = img.resize_exact(draw_w, draw_h, FilterType::Lanczos3);

            let mut page: RgbImage =
                ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = ((page_w - draw_w) / 2) as i64;
            let y = ((page_h - draw_h) / 2) as i64;
            image::imageops::overlay(&mut page, &resized.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }

        print_proto::FitMode::Fill => {
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.max(scale_y);
            let scaled_w = (img_w as f64 * scale).round() as u32;
            let scaled_h = (img_h as f64 * scale).round() as u32;

            let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Lanczos3);

            let crop_x = (scaled_w.saturating_sub(page_w)) / 2;
            let crop_y = (scaled_h.saturating_sub(page_h)) / 2;
            resized.crop_imm(crop_x, crop_y, page_w, page_h)
        }

        print_proto::FitMode::Stretch => img.resize_exact(page_w, page_h, FilterType::Lanczos3),

        print_proto::FitMode::Actual => {
            let mut page: RgbImage =
                ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = (page_w.saturating_sub(img_w) / 2) as i64;
            let y = (page_h.saturating_sub(img_h) / 2) as i64;
            image::imageops::overlay(&mut page, &img.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }

        _ => scale_image(img, page_w, page_h, print_proto::FitMode::Fit),
    }
}

fn apply_color_mode(img: DynamicImage, cmd: &print_proto::PrintCommand) -> DynamicImage {
    let color_mode =
        print_proto::ColorMode::try_from(cmd.color_mode).unwrap_or(print_proto::ColorMode::Color);
    if color_mode == print_proto::ColorMode::Bw {
        DynamicImage::ImageLuma8(image::imageops::grayscale(&img))
    } else {
        img
    }
}

// ── Cut marks ──

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

    for col in 0..=cols {
        let x = margin + col * (cell_w + margin) - margin / 2;
        if x >= pw {
            continue;
        }

        for row in 0..=rows {
            let cell_top = margin + row * (cell_h + margin);

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
        let y = margin + row * (cell_h + margin) - margin / 2;
        if y >= ph {
            continue;
        }

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
    if x >= w {
        return;
    }
    for y in y_start..y_end.min(h) {
        img.put_pixel(x, y, color);
    }
}

fn draw_hline(img: &mut RgbImage, y: u32, x_start: u32, x_end: u32, color: Rgb<u8>) {
    let w = img.width();
    let h = img.height();
    if y >= h {
        return;
    }
    for x in x_start..x_end.min(w) {
        img.put_pixel(x, y, color);
    }
}
