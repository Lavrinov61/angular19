use std::fs;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{ImageReader, Pixel, Rgb, RgbImage};
use serde::{Deserialize, Serialize};

const MM_PER_INCH: f64 = 25.4;
const UPSCALE_WARN_FACTOR: f64 = 1.5;

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("failed to open image: {0}")]
    ImageOpen(String),
    #[error("failed to decode image: {0}")]
    ImageDecode(String),
    #[error("failed to save image: {0}")]
    ImageSave(String),
    #[error("invalid crop input: {0}")]
    InvalidCrop(String),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum ToolRequest {
    Health,
    DetectCropLines { image_path: String },
    CropDocument(CropDocumentInput),
}

#[derive(Debug, Serialize)]
pub struct ToolResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResponse {
    pub fn ok<T: Serialize>(value: T) -> Self {
        Self {
            success: true,
            result: Some(serde_json::to_value(value).unwrap_or(serde_json::Value::Null)),
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            result: None,
            error: Some(message),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropPreset {
    pub photo_wmm: f64,
    pub photo_hmm: f64,
    pub top_margin_mm: f64,
    pub head_height_mm: f64,
    pub dpi: u32,
    pub jpeg_quality: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropDocumentInput {
    pub image_path: String,
    pub output_path: PathBuf,
    pub document_type: String,
    pub crown_y: f64,
    pub chin_y: f64,
    pub center_x: f64,
    #[serde(default)]
    pub rotation_deg: f64,
    pub preset: CropPreset,
}

#[derive(Debug, Clone, Copy)]
pub struct CropLines {
    pub crown_y: f64,
    pub chin_y: f64,
    pub center_x: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropExtend {
    pub top: u32,
    pub bottom: u32,
    pub left: u32,
    pub right: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropWarning {
    pub code: String,
    pub value_px: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_mm: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropPlan {
    pub extract: CropRect,
    pub extend: CropExtend,
    pub target: TargetSize,
    pub density: u32,
    pub jpeg_quality: u8,
    pub warnings: Vec<CropWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropDocumentOutput {
    pub plan: CropPlan,
    pub output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectCropLinesOutput {
    pub image_width: u32,
    pub image_height: u32,
    pub crown_y: Option<u32>,
    pub chin_y: Option<u32>,
    pub center_x: Option<u32>,
    pub tilt: Option<f64>,
    pub face_detected: bool,
    pub verdict: String,
}

pub fn crop_document_to_path(input: CropDocumentInput) -> Result<CropDocumentOutput, ToolError> {
    if input.document_type.trim().is_empty() {
        return Err(ToolError::InvalidCrop(
            "documentType must not be empty".to_string(),
        ));
    }
    if input.rotation_deg < -10.0 || input.rotation_deg > 10.0 || !input.rotation_deg.is_finite() {
        return Err(ToolError::InvalidCrop(
            "rotationDeg must be finite and within [-10, 10]".to_string(),
        ));
    }

    let mut image = load_rgb_image(Path::new(&input.image_path))?;
    let mut size = ImageSize {
        width: image.width(),
        height: image.height(),
    };
    let mut lines = CropLines {
        crown_y: input.crown_y,
        chin_y: input.chin_y,
        center_x: input.center_x,
    };

    validate_crop_lines(lines, size)?;

    if input.rotation_deg.abs() > f64::EPSILON {
        image = rotate_expand_white(&image, input.rotation_deg);
        lines = rotate_crop_lines(lines, size, input.rotation_deg);
        size = ImageSize {
            width: image.width(),
            height: image.height(),
        };
        validate_crop_lines(lines, size)?;
    }

    let plan = compute_crop_plan(lines, &input.preset, size)?;
    let cropped = render_crop(&image, &plan);
    let resized = imageops::resize(
        &cropped,
        plan.target.width,
        plan.target.height,
        FilterType::Lanczos3,
    );

    let mut encoded = Vec::new();
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut encoded, input.preset.jpeg_quality);
        encoder
            .encode_image(&resized)
            .map_err(|err| ToolError::ImageSave(err.to_string()))?;
    }
    patch_jpeg_density(&mut encoded, input.preset.dpi);
    fs::write(&input.output_path, encoded).map_err(|err| ToolError::ImageSave(err.to_string()))?;

    Ok(CropDocumentOutput {
        plan,
        output_path: input.output_path.to_string_lossy().to_string(),
    })
}

pub fn detect_crop_lines(path: &Path) -> Result<DetectCropLinesOutput, ToolError> {
    let image = load_rgb_image(path)?;
    let (width, height) = image.dimensions();
    let Some(mask) = ForegroundMask::from_image(&image) else {
        return Ok(DetectCropLinesOutput {
            image_width: width,
            image_height: height,
            crown_y: None,
            chin_y: None,
            center_x: None,
            tilt: Some(0.0),
            face_detected: false,
            verdict: "no_face".to_string(),
        });
    };

    let Some(crown_y) = mask.find_crown_y() else {
        return Ok(DetectCropLinesOutput {
            image_width: width,
            image_height: height,
            crown_y: None,
            chin_y: None,
            center_x: None,
            tilt: Some(0.0),
            face_detected: false,
            verdict: "no_face".to_string(),
        });
    };

    let foreground_center_x = mask.estimate_center_x(crown_y);
    let center_x =
        estimate_skin_center_x(&image, crown_y, foreground_center_x).unwrap_or(foreground_center_x);
    let chin_y = estimate_chin_y(&image, &mask, crown_y, center_x);
    let face_detected = chin_y.is_some();

    Ok(DetectCropLinesOutput {
        image_width: width,
        image_height: height,
        crown_y: Some(crown_y),
        chin_y,
        center_x: Some(center_x),
        tilt: Some(0.0),
        face_detected,
        verdict: if face_detected { "ok" } else { "no_face" }.to_string(),
    })
}

pub fn compute_crop_plan(
    lines: CropLines,
    preset: &CropPreset,
    image: ImageSize,
) -> Result<CropPlan, ToolError> {
    let px_per_mm = (lines.chin_y - lines.crown_y) / preset.head_height_mm;
    if !px_per_mm.is_finite() || px_per_mm <= 0.0 {
        return Err(ToolError::InvalidCrop("invalid face height".to_string()));
    }

    let crop_w = preset.photo_wmm * px_per_mm;
    let crop_h = preset.photo_hmm * px_per_mm;
    let crop_w_round = round_u32(crop_w)?;
    let crop_h_round = round_u32(crop_h)?;
    let ideal_top = lines.crown_y - preset.top_margin_mm * px_per_mm;
    let ideal_left = lines.center_x - crop_w / 2.0;

    let extend_top = round_u32((-ideal_top).max(0.0))?;
    let extend_left = round_u32((-ideal_left).max(0.0))?;
    let extend_bottom = round_u32((ideal_top + crop_h - image.height as f64).max(0.0))?;
    let extend_right = round_u32((ideal_left + crop_w - image.width as f64).max(0.0))?;

    let extract_left = clamp_i64(ideal_left.round() as i64, 0, image.width as i64) as u32;
    let extract_top = clamp_i64(ideal_top.round() as i64, 0, image.height as i64) as u32;
    let extract_width = clamp_i64(
        crop_w_round as i64 - extend_left as i64 - extend_right as i64,
        1,
        image.width.saturating_sub(extract_left) as i64,
    ) as u32;
    let extract_height = clamp_i64(
        crop_h_round as i64 - extend_top as i64 - extend_bottom as i64,
        1,
        image.height.saturating_sub(extract_top) as i64,
    ) as u32;

    let target_width = round_u32((preset.photo_wmm / MM_PER_INCH) * preset.dpi as f64)?;
    let target_height = round_u32((preset.photo_hmm / MM_PER_INCH) * preset.dpi as f64)?;

    let mut warnings = Vec::new();
    push_extend_warning(&mut warnings, "extend_top", extend_top, px_per_mm);
    push_extend_warning(&mut warnings, "extend_bottom", extend_bottom, px_per_mm);
    push_extend_warning(&mut warnings, "extend_left", extend_left, px_per_mm);
    push_extend_warning(&mut warnings, "extend_right", extend_right, px_per_mm);
    if target_height as f64 > UPSCALE_WARN_FACTOR * crop_h_round as f64 {
        warnings.push(CropWarning {
            code: "low_resolution".to_string(),
            value_px: crop_h_round,
            value_mm: None,
        });
    }

    Ok(CropPlan {
        extract: CropRect {
            left: extract_left,
            top: extract_top,
            width: extract_width,
            height: extract_height,
        },
        extend: CropExtend {
            top: extend_top,
            bottom: extend_bottom,
            left: extend_left,
            right: extend_right,
        },
        target: TargetSize {
            width: target_width,
            height: target_height,
        },
        density: preset.dpi,
        jpeg_quality: preset.jpeg_quality,
        warnings,
    })
}

fn load_rgb_image(path: &Path) -> Result<RgbImage, ToolError> {
    ImageReader::open(path)
        .map_err(|err| ToolError::ImageOpen(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| ToolError::ImageDecode(err.to_string()))?
        .decode()
        .map_err(|err| ToolError::ImageDecode(err.to_string()))
        .map(|img| img.to_rgb8())
}

fn validate_crop_lines(lines: CropLines, image: ImageSize) -> Result<(), ToolError> {
    if !lines.crown_y.is_finite() || !lines.chin_y.is_finite() || !lines.center_x.is_finite() {
        return Err(ToolError::InvalidCrop(
            "crownY/chinY/centerX must be finite".to_string(),
        ));
    }
    if lines.crown_y < 0.0
        || lines.crown_y > image.height as f64
        || lines.chin_y < 0.0
        || lines.chin_y > image.height as f64
        || lines.center_x < 0.0
        || lines.center_x > image.width as f64
    {
        return Err(ToolError::InvalidCrop(
            "crop coordinates are out of image bounds".to_string(),
        ));
    }
    if lines.chin_y - lines.crown_y < 10.0 {
        return Err(ToolError::InvalidCrop(
            "face height is too small".to_string(),
        ));
    }
    Ok(())
}

fn render_crop(image: &RgbImage, plan: &CropPlan) -> RgbImage {
    let output_w = plan.extract.width + plan.extend.left + plan.extend.right;
    let output_h = plan.extract.height + plan.extend.top + plan.extend.bottom;
    let mut output = RgbImage::from_pixel(output_w, output_h, Rgb([255, 255, 255]));
    let extracted = imageops::crop_imm(
        image,
        plan.extract.left,
        plan.extract.top,
        plan.extract.width,
        plan.extract.height,
    )
    .to_image();
    imageops::overlay(
        &mut output,
        &extracted,
        plan.extend.left.into(),
        plan.extend.top.into(),
    );
    output
}

fn rotate_expand_white(image: &RgbImage, degrees: f64) -> RgbImage {
    let angle = degrees.to_radians();
    let cos = angle.cos();
    let sin = angle.sin();
    let width = image.width() as f64;
    let height = image.height() as f64;
    let cx = width / 2.0;
    let cy = height / 2.0;
    let corners = [
        rotate_point(0.0, 0.0, cx, cy, cos, sin),
        rotate_point(width, 0.0, cx, cy, cos, sin),
        rotate_point(0.0, height, cx, cy, cos, sin),
        rotate_point(width, height, cx, cy, cos, sin),
    ];
    let min_x = corners
        .iter()
        .map(|point| point.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = corners
        .iter()
        .map(|point| point.1)
        .fold(f64::INFINITY, f64::min);
    let max_x = corners
        .iter()
        .map(|point| point.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = corners
        .iter()
        .map(|point| point.1)
        .fold(f64::NEG_INFINITY, f64::max);
    let out_w = (max_x - min_x).ceil().max(1.0) as u32;
    let out_h = (max_y - min_y).ceil().max(1.0) as u32;
    let mut output = RgbImage::from_pixel(out_w, out_h, Rgb([255, 255, 255]));

    for y in 0..out_h {
        for x in 0..out_w {
            let world_x = x as f64 + min_x;
            let world_y = y as f64 + min_y;
            let dx = world_x - cx;
            let dy = world_y - cy;
            let src_x = cx + dx * cos + dy * sin;
            let src_y = cy - dx * sin + dy * cos;
            if src_x >= 0.0 && src_y >= 0.0 && src_x < width && src_y < height {
                let pixel = sample_bilinear(image, src_x, src_y);
                output.put_pixel(x, y, pixel);
            }
        }
    }
    output
}

fn rotate_crop_lines(lines: CropLines, image: ImageSize, degrees: f64) -> CropLines {
    let angle = degrees.to_radians();
    let cos = angle.cos();
    let sin = angle.sin();
    let width = image.width as f64;
    let height = image.height as f64;
    let cx = width / 2.0;
    let cy = height / 2.0;
    let corners = [
        rotate_point(0.0, 0.0, cx, cy, cos, sin),
        rotate_point(width, 0.0, cx, cy, cos, sin),
        rotate_point(0.0, height, cx, cy, cos, sin),
        rotate_point(width, height, cx, cy, cos, sin),
    ];
    let min_x = corners
        .iter()
        .map(|point| point.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = corners
        .iter()
        .map(|point| point.1)
        .fold(f64::INFINITY, f64::min);
    let crown = rotate_point(lines.center_x, lines.crown_y, cx, cy, cos, sin);
    let chin = rotate_point(lines.center_x, lines.chin_y, cx, cy, cos, sin);
    CropLines {
        crown_y: (crown.1 - min_y).min(chin.1 - min_y).round(),
        chin_y: (crown.1 - min_y).max(chin.1 - min_y).round(),
        center_x: ((crown.0 - min_x) + (chin.0 - min_x)) / 2.0,
    }
}

fn rotate_point(x: f64, y: f64, cx: f64, cy: f64, cos: f64, sin: f64) -> (f64, f64) {
    let dx = x - cx;
    let dy = y - cy;
    (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
}

fn sample_bilinear(image: &RgbImage, x: f64, y: f64) -> Rgb<u8> {
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(image.width().saturating_sub(1));
    let y1 = (y0 + 1).min(image.height().saturating_sub(1));
    let tx = x - x0 as f64;
    let ty = y - y0 as f64;
    let p00 = image.get_pixel(x0, y0).channels();
    let p10 = image.get_pixel(x1, y0).channels();
    let p01 = image.get_pixel(x0, y1).channels();
    let p11 = image.get_pixel(x1, y1).channels();
    let mut out = [0u8; 3];
    for i in 0..3 {
        let top = p00[i] as f64 * (1.0 - tx) + p10[i] as f64 * tx;
        let bottom = p01[i] as f64 * (1.0 - tx) + p11[i] as f64 * tx;
        out[i] = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
    }
    Rgb(out)
}

fn patch_jpeg_density(bytes: &mut Vec<u8>, dpi: u32) {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return;
    }
    let dpi = dpi.min(u16::MAX as u32) as u16;
    let mut pos = 2;
    while pos + 4 < bytes.len() {
        if bytes[pos] != 0xFF {
            break;
        }
        let marker = bytes[pos + 1];
        if marker == 0xE0 {
            let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
            if pos + 2 + len <= bytes.len() && len >= 16 && &bytes[pos + 4..pos + 9] == b"JFIF\0" {
                bytes[pos + 11] = 1;
                bytes[pos + 12..pos + 14].copy_from_slice(&dpi.to_be_bytes());
                bytes[pos + 14..pos + 16].copy_from_slice(&dpi.to_be_bytes());
                return;
            }
        }
        if marker == 0xDA || marker == 0xD9 {
            break;
        }
        let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
        if len < 2 {
            break;
        }
        pos += 2 + len;
    }

    let mut app0 = vec![
        0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01, 0x02, 0x01,
    ];
    app0.extend_from_slice(&dpi.to_be_bytes());
    app0.extend_from_slice(&dpi.to_be_bytes());
    app0.extend_from_slice(&[0x00, 0x00]);
    bytes.splice(2..2, app0);
}

struct ForegroundMask {
    width: u32,
    height: u32,
    x0: u32,
    x1: u32,
    data: Vec<bool>,
}

impl ForegroundMask {
    fn from_image(image: &RgbImage) -> Option<Self> {
        let (width, height) = image.dimensions();
        if width < 40 || height < 40 {
            return None;
        }
        let bg = estimate_background(image);
        let bg_luma = luma(bg);
        let x0 = width / 5;
        let x1 = width - width / 5;
        let mut data = Vec::with_capacity(((x1 - x0) * height) as usize);
        for y in 0..height {
            for x in x0..x1 {
                let pixel = *image.get_pixel(x, y);
                let px_luma = luma(pixel);
                let sat = saturation(pixel);
                let dist = color_distance(pixel, bg);
                data.push(px_luma < bg_luma - 45.0 && (sat > 0.06 || dist > 55.0));
            }
        }
        Some(Self {
            width,
            height,
            x0,
            x1,
            data,
        })
    }

    fn find_crown_y(&self) -> Option<u32> {
        let search_h = (self.height as f64 * 0.78).round() as u32;
        let min_run = 6u32;
        for y in 0..search_h.saturating_sub(min_run) {
            let mut run_ok = true;
            for yy in y..y + min_run {
                if self.row_fraction(yy) < 0.018 {
                    run_ok = false;
                    break;
                }
            }
            if run_ok {
                return Some(y);
            }
        }
        None
    }

    fn estimate_center_x(&self, crown_y: u32) -> u32 {
        let band_h = (self.height / 4).max(80);
        let y_end = (crown_y + band_h).min(self.height);
        let mut min_x = self.width;
        let mut max_x = 0;
        for y in crown_y..y_end {
            if let Some((row_min, row_max)) = self.row_bounds(y) {
                min_x = min_x.min(row_min);
                max_x = max_x.max(row_max);
            }
        }
        if min_x <= max_x {
            (min_x + max_x) / 2
        } else {
            self.width / 2
        }
    }

    fn row_fraction(&self, y: u32) -> f64 {
        let row_w = (self.x1 - self.x0) as usize;
        let start = y as usize * row_w;
        let end = start + row_w;
        if end > self.data.len() || row_w == 0 {
            return 0.0;
        }
        self.data[start..end].iter().filter(|v| **v).count() as f64 / row_w as f64
    }

    fn row_bounds(&self, y: u32) -> Option<(u32, u32)> {
        let row_w = (self.x1 - self.x0) as usize;
        let start = y as usize * row_w;
        let end = start + row_w;
        if end > self.data.len() {
            return None;
        }
        let mut min_x = None;
        let mut max_x = None;
        for (idx, is_fg) in self.data[start..end].iter().enumerate() {
            if *is_fg {
                let x = self.x0 + idx as u32;
                min_x = Some(min_x.map_or(x, |v: u32| v.min(x)));
                max_x = Some(max_x.map_or(x, |v: u32| v.max(x)));
            }
        }
        min_x.zip(max_x)
    }

    fn centered_row_count(&self, y: u32, x0: u32, x1: u32) -> u32 {
        let row_w = (self.x1 - self.x0) as usize;
        let start = y as usize * row_w;
        let end = start + row_w;
        if end > self.data.len() || x1 <= x0 {
            return 0;
        }
        let start_x = x0.max(self.x0);
        let end_x = x1.min(self.x1.saturating_sub(1));
        if end_x <= start_x {
            return 0;
        }
        let from = start + (start_x - self.x0) as usize;
        let to = start + (end_x - self.x0) as usize + 1;
        self.data[from..to].iter().filter(|value| **value).count() as u32
    }
}

fn estimate_chin_y(
    image: &RgbImage,
    mask: &ForegroundMask,
    crown_y: u32,
    center_x: u32,
) -> Option<u32> {
    let (width, height) = image.dimensions();
    let half_w = (width as f64 * 0.16).round() as u32;
    let x0 = center_x.saturating_sub(half_w);
    let x1 = (center_x + half_w).min(width.saturating_sub(1));
    let y0 = crown_y;
    let y1 = (crown_y + (height as f64 * 0.58).round() as u32).min(height.saturating_sub(1));
    if x1 <= x0 || y1 <= y0 {
        return None;
    }

    let mut widths: Vec<(u32, u32)> = Vec::new();
    for y in y0..=y1 {
        let mut count = 0u32;
        for x in x0..=x1 {
            if is_skin_like(*image.get_pixel(x, y)) {
                count += 1;
            }
        }
        widths.push((y, count));
    }

    let peak_search_y1 = (crown_y + (height as f64 * 0.38).round() as u32).min(y1);
    let peak = widths
        .iter()
        .copied()
        .filter(|(y, count)| *y > crown_y + 60 && *y <= peak_search_y1 && *count > 0)
        .max_by_key(|(_, count)| *count)?;
    let min_skin_peak = (((x1 - x0) as f64 * 0.04).round() as u32).max(6);
    let narrow_skin_peak = peak.1 <= min_skin_peak * 2;
    let weak_skin_chin_limit = (crown_y + (height as f64 * 0.46).round() as u32)
        .min(height.saturating_sub(1));
    if peak.1 < min_skin_peak {
        let fallback = estimate_chin_from_foreground(mask, crown_y, center_x);
        return fallback.map(|y| y.min(weak_skin_chin_limit));
    }

    let threshold_ratio = if narrow_skin_peak { 0.90 } else { 0.82 };
    let threshold = ((peak.1 as f64 * threshold_ratio).round() as u32).max(3);
    let min_y = peak.0 + ((peak.0.saturating_sub(crown_y)) as f64 * 0.28).round() as u32;
    for window in widths.windows(5) {
        if window[0].0 < min_y {
            continue;
        }
        if window.iter().all(|(_, count)| *count <= threshold) {
            let y = if narrow_skin_peak {
                window[0].0.min(weak_skin_chin_limit)
            } else {
                window[0].0
            };
            return Some(y);
        }
    }

    let fallback = estimate_chin_from_foreground(mask, crown_y, center_x);
    if narrow_skin_peak {
        fallback.map(|y| y.min(weak_skin_chin_limit))
    } else {
        fallback
    }
}

fn estimate_skin_center_x(image: &RgbImage, crown_y: u32, fallback_center_x: u32) -> Option<u32> {
    let (width, height) = image.dimensions();
    let half_w = (width as f64 * 0.20).round() as u32;
    let x0 = fallback_center_x.saturating_sub(half_w);
    let x1 = (fallback_center_x + half_w).min(width.saturating_sub(1));
    let y0 = crown_y.saturating_add(40);
    let y1 = (crown_y + (height as f64 * 0.42).round() as u32).min(height.saturating_sub(1));
    if x1 <= x0 || y1 <= y0 {
        return None;
    }

    let mut sum_x: u64 = 0;
    let mut count: u64 = 0;
    for y in y0..=y1 {
        for x in x0..=x1 {
            if is_skin_like(*image.get_pixel(x, y)) {
                sum_x += x as u64;
                count += 1;
            }
        }
    }
    if count < 100 {
        None
    } else {
        Some((sum_x / count) as u32)
    }
}

fn estimate_chin_from_foreground(
    mask: &ForegroundMask,
    crown_y: u32,
    center_x: u32,
) -> Option<u32> {
    let scan_end = (crown_y + (mask.height as f64 * 0.48).round() as u32)
        .min(mask.height.saturating_sub(1));
    let peak_end = (crown_y + (mask.height as f64 * 0.32).round() as u32).min(scan_end);
    let half_w = (mask.width as f64 * 0.12).round() as u32;
    let x0 = center_x.saturating_sub(half_w).max(mask.x0);
    let x1 = (center_x + half_w).min(mask.x1.saturating_sub(1));
    if x1 <= x0 || scan_end <= crown_y {
        return None;
    }

    let rows: Vec<(u32, u32)> = (crown_y..=scan_end)
        .map(|y| (y, mask.centered_row_count(y, x0, x1)))
        .collect();
    let peak = rows
        .iter()
        .copied()
        .filter(|(y, count)| *y >= crown_y + 30 && *y <= peak_end && *count > 0)
        .max_by_key(|(_, count)| *count)?;
    if peak.1 < 4 {
        return None;
    }

    let threshold = ((peak.1 as f64 * 0.42).round() as u32).max(3);
    let min_y = peak.0 + ((peak.0.saturating_sub(crown_y)) as f64 * 0.35).round() as u32;
    for window in rows.windows(7) {
        if window[0].0 < min_y {
            continue;
        }
        if window.iter().all(|(_, count)| *count <= threshold) {
            return Some(window[0].0);
        }
    }

    let estimated = crown_y + ((peak.1 as f64 * 2.75).round() as u32);
    Some(estimated.min(scan_end))
}

fn estimate_background(image: &RgbImage) -> Rgb<u8> {
    let (width, height) = image.dimensions();
    let mut rs = Vec::new();
    let mut gs = Vec::new();
    let mut bs = Vec::new();
    let step_x = (width / 24).max(1);
    let step_y = (height / 24).max(1);
    for y in (0..height).step_by(step_y as usize) {
        for x in (0..width).step_by(step_x as usize) {
            let in_top = y < height / 5;
            let in_side = x < width / 10 || x > width - width / 10;
            if in_top || in_side {
                let p = image.get_pixel(x, y).0;
                rs.push(p[0]);
                gs.push(p[1]);
                bs.push(p[2]);
            }
        }
    }
    Rgb([median_u8(&mut rs), median_u8(&mut gs), median_u8(&mut bs)])
}

fn is_skin_like(pixel: Rgb<u8>) -> bool {
    let [r, g, b] = pixel.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let cb = 128.0 - 0.168736 * r as f64 - 0.331264 * g as f64 + 0.5 * b as f64;
    let cr = 128.0 + 0.5 * r as f64 - 0.418688 * g as f64 - 0.081312 * b as f64;
    r > 75
        && g > 35
        && b > 20
        && max - min > 14
        && (r as i16 - g as i16).abs() > 7
        && r > g
        && r > b
        && (77.0..=138.0).contains(&cb)
        && (130.0..=182.0).contains(&cr)
}

fn luma(pixel: Rgb<u8>) -> f64 {
    let [r, g, b] = pixel.0;
    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64
}

fn saturation(pixel: Rgb<u8>) -> f64 {
    let [r, g, b] = pixel.0;
    let max = r.max(g).max(b) as f64;
    let min = r.min(g).min(b) as f64;
    if max <= 0.0 { 0.0 } else { (max - min) / max }
}

fn color_distance(a: Rgb<u8>, b: Rgb<u8>) -> f64 {
    let [ar, ag, ab] = a.0;
    let [br, bg, bb] = b.0;
    let dr = ar as f64 - br as f64;
    let dg = ag as f64 - bg as f64;
    let db = ab as f64 - bb as f64;
    (dr * dr + dg * dg + db * db).sqrt()
}

fn median_u8(values: &mut [u8]) -> u8 {
    if values.is_empty() {
        return 255;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

fn push_extend_warning(warnings: &mut Vec<CropWarning>, code: &str, value_px: u32, px_per_mm: f64) {
    if value_px == 0 {
        return;
    }
    warnings.push(CropWarning {
        code: code.to_string(),
        value_px,
        value_mm: Some(round1(value_px as f64 / px_per_mm)),
    });
}

fn round_u32(value: f64) -> Result<u32, ToolError> {
    if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 {
        return Err(ToolError::InvalidCrop("invalid geometry".to_string()));
    }
    Ok(value.round() as u32)
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn passport() -> CropPreset {
        CropPreset {
            photo_wmm: 35.0,
            photo_hmm: 45.0,
            top_margin_mm: 5.0,
            head_height_mm: 32.0,
            dpi: 800,
            jpeg_quality: 92,
        }
    }

    fn visa_schengen() -> CropPreset {
        CropPreset {
            photo_wmm: 35.0,
            photo_hmm: 45.0,
            top_margin_mm: 3.0,
            head_height_mm: 32.0,
            dpi: 800,
            jpeg_quality: 92,
        }
    }

    fn photo_3x4() -> CropPreset {
        CropPreset {
            photo_wmm: 30.0,
            photo_hmm: 40.0,
            top_margin_mm: 3.0,
            head_height_mm: 26.0,
            dpi: 800,
            jpeg_quality: 92,
        }
    }

    #[test]
    fn crop_plan_matches_passport_geometry() {
        let plan = compute_crop_plan(
            CropLines {
                crown_y: 200.0,
                chin_y: 520.0,
                center_x: 400.0,
            },
            &passport(),
            ImageSize {
                width: 800,
                height: 900,
            },
        )
        .expect("plan");

        assert_eq!(plan.extract.left, 225);
        assert_eq!(plan.extract.top, 150);
        assert_eq!(plan.extract.width, 350);
        assert_eq!(plan.extract.height, 450);
        assert_eq!(plan.target.width, 1102);
        assert_eq!(plan.target.height, 1417);
    }

    #[test]
    fn detects_document_lines_on_light_studio_background() {
        let mut image = RgbImage::from_pixel(420, 620, Rgb([246, 246, 246]));
        draw_filled_ellipse(&mut image, 210, 145, 78, 92, Rgb([45, 38, 36]));
        draw_filled_ellipse(&mut image, 210, 245, 60, 95, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 170, 335, 250, 455, Rgb([55, 42, 40]));
        let path = temp_jpeg_path("detect-lines");
        image.save(&path).expect("save synthetic");

        let result = detect_crop_lines(&path).expect("detect");

        assert!(result.face_detected);
        assert!(result.crown_y.unwrap().abs_diff(53) <= 8);
        assert!(result.center_x.unwrap().abs_diff(210) <= 12);
        assert!(result.chin_y.unwrap() > 265);
        assert!(result.chin_y.unwrap() < 355);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn detects_chin_from_face_not_dark_shoulders_when_skin_band_is_narrow() {
        let mut image = RgbImage::from_pixel(420, 620, Rgb([246, 246, 246]));
        draw_filled_ellipse(&mut image, 210, 145, 78, 92, Rgb([45, 38, 36]));
        draw_filled_ellipse(&mut image, 210, 245, 5, 94, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 125, 335, 295, 455, Rgb([55, 42, 40]));
        let path = temp_jpeg_path("detect-lines-narrow-skin");
        image.save(&path).expect("save synthetic");

        let result = detect_crop_lines(&path).expect("detect");

        assert!(result.face_detected);
        assert!(result.crown_y.unwrap().abs_diff(53) <= 12);
        assert!(result.center_x.unwrap().abs_diff(210) <= 12);
        assert!(
            result.chin_y.unwrap() < 360,
            "chin should track lower face, not shoulder width: {:?}",
            result.chin_y
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn detects_chin_from_face_not_bare_shoulders() {
        let mut image = RgbImage::from_pixel(420, 620, Rgb([246, 246, 246]));
        draw_filled_ellipse(&mut image, 210, 145, 78, 92, Rgb([45, 38, 36]));
        draw_filled_ellipse(&mut image, 210, 245, 60, 95, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 185, 325, 235, 420, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 85, 365, 335, 470, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 155, 430, 265, 500, Rgb([55, 42, 40]));
        let path = temp_jpeg_path("detect-lines-bare-shoulders");
        image.save(&path).expect("save synthetic");

        let result = detect_crop_lines(&path).expect("detect");

        assert!(result.face_detected);
        assert!(result.crown_y.unwrap().abs_diff(53) <= 12);
        assert!(
            result.chin_y.unwrap() < 355,
            "chin should track face, not bare shoulders: {:?}",
            result.chin_y
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn detects_chin_from_face_on_landscape_portrait_with_shoulders() {
        let mut image = RgbImage::from_pixel(576, 384, Rgb([246, 246, 246]));
        draw_filled_ellipse(&mut image, 288, 112, 62, 36, Rgb([45, 38, 36]));
        draw_filled_ellipse(&mut image, 288, 164, 45, 58, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 268, 215, 308, 270, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 205, 260, 371, 335, Rgb([205, 158, 132]));
        draw_filled_rect(&mut image, 230, 330, 346, 383, Rgb([55, 42, 40]));
        let path = temp_jpeg_path("detect-lines-landscape-shoulders");
        image.save(&path).expect("save synthetic");

        let result = detect_crop_lines(&path).expect("detect");

        assert!(result.face_detected);
        assert!(result.crown_y.unwrap().abs_diff(76) <= 12);
        assert!(
            result.chin_y.unwrap() < 235,
            "chin should track face in landscape portrait, not shoulders: {:?}",
            result.chin_y
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn crop_document_accepts_schengen_visa_preset() {
        let (input_path, output_path) = synthetic_crop_paths("schengen-crop");
        save_plain_source(&input_path);

        let result = crop_document_to_path(CropDocumentInput {
            image_path: input_path.to_string_lossy().to_string(),
            output_path: output_path.clone(),
            document_type: "visa_schengen".to_string(),
            crown_y: 200.0,
            chin_y: 520.0,
            center_x: 400.0,
            rotation_deg: 0.0,
            preset: visa_schengen(),
        })
        .expect("schengen crop");

        assert_eq!(result.plan.extract.left, 225);
        assert_eq!(result.plan.extract.top, 170);
        assert_eq!(result.plan.extract.width, 350);
        assert_eq!(result.plan.extract.height, 450);
        assert_eq!(result.plan.target.width, 1102);
        assert_eq!(result.plan.target.height, 1417);
        assert!(output_path.exists());

        let _ = fs::remove_file(input_path);
        let _ = fs::remove_file(output_path);
    }

    #[test]
    fn crop_document_accepts_photo_3x4_preset() {
        let (input_path, output_path) = synthetic_crop_paths("photo-3x4-crop");
        save_plain_source(&input_path);

        let result = crop_document_to_path(CropDocumentInput {
            image_path: input_path.to_string_lossy().to_string(),
            output_path: output_path.clone(),
            document_type: "photo_3x4".to_string(),
            crown_y: 200.0,
            chin_y: 460.0,
            center_x: 400.0,
            rotation_deg: 0.0,
            preset: photo_3x4(),
        })
        .expect("photo 3x4 crop");

        assert_eq!(result.plan.extract.left, 250);
        assert_eq!(result.plan.extract.top, 170);
        assert_eq!(result.plan.extract.width, 300);
        assert_eq!(result.plan.extract.height, 400);
        assert_eq!(result.plan.target.width, 945);
        assert_eq!(result.plan.target.height, 1260);
        assert!(output_path.exists());

        let _ = fs::remove_file(input_path);
        let _ = fs::remove_file(output_path);
    }

    fn draw_filled_rect(image: &mut RgbImage, x0: u32, y0: u32, x1: u32, y1: u32, color: Rgb<u8>) {
        for y in y0..=y1 {
            for x in x0..=x1 {
                image.put_pixel(x, y, color);
            }
        }
    }

    fn draw_filled_ellipse(
        image: &mut RgbImage,
        cx: i32,
        cy: i32,
        rx: i32,
        ry: i32,
        color: Rgb<u8>,
    ) {
        for y in (cy - ry).max(0)..=(cy + ry).min(image.height() as i32 - 1) {
            for x in (cx - rx).max(0)..=(cx + rx).min(image.width() as i32 - 1) {
                let dx = (x - cx) as f64 / rx as f64;
                let dy = (y - cy) as f64 / ry as f64;
                if dx * dx + dy * dy <= 1.0 {
                    image.put_pixel(x as u32, y as u32, color);
                }
            }
        }
    }

    fn temp_jpeg_path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("{name}-{stamp}.jpg"))
    }

    fn synthetic_crop_paths(name: &str) -> (PathBuf, PathBuf) {
        let input = temp_jpeg_path(&format!("{name}-input"));
        let output = temp_jpeg_path(&format!("{name}-output"));
        (input, output)
    }

    fn save_plain_source(path: &Path) {
        let image = RgbImage::from_pixel(800, 900, Rgb([242, 242, 242]));
        image.save(path).expect("save crop source");
    }
}
