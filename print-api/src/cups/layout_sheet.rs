use image::{DynamicImage, GenericImageView, ImageBuffer, Rgb, RgbImage, imageops::FilterType};
use serde::Serialize;

use super::jpeg;
use super::pipeline::{
    ImageAdjustmentParams, apply_image_adjustments, load_image_oriented_from_memory,
};
use super::ppd::PrintableAreaMm;

const RENDER_DPI: u32 = 300;
const BUSINESS_CARD_BLEED_MM: f64 = 1.5;
const POLAROID_PHOTO_SIZE_MM: f64 = 79.0;
const POLAROID_BORDER_TOP_MM: f64 = 5.0;
const POLAROID_BORDER_SIDE_MM: f64 = 4.5;

#[derive(Clone, Debug)]
pub struct LayoutRequest {
    pub photo_w_mm: f64,
    pub photo_h_mm: f64,
    pub paper_w_mm: f64,
    pub paper_h_mm: f64,
    pub cut_margin_mm: f64,
    pub template_mode: Option<String>,
    pub bottom_padding_mm: Option<f64>,
    pub photo_preset_id: Option<String>,
    pub printable_area_mm: Option<PrintableAreaMm>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CalculatedLayout {
    pub rows: i32,
    pub cols: i32,
    pub photos_per_sheet: i32,
    pub waste_percent: i32,
    pub photo_cell_w_mm: f64,
    pub photo_cell_h_mm: f64,
    pub cut_margin_mm: f64,
    pub sheets_needed: Option<i32>,
    pub template_mode: Option<String>,
    pub photo_area_h_mm: Option<f64>,
    pub bottom_padding_mm: Option<f64>,
    pub content_x_mm: f64,
    pub content_y_mm: f64,
    pub content_w_mm: f64,
    pub content_h_mm: f64,
}

#[derive(Clone, Debug)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug)]
pub struct SheetRenderImage {
    pub bytes: Vec<u8>,
    pub fit_mode: String,
    pub rotation: i16,
    pub crop: Option<CropRect>,
    pub mirror: bool,
    pub adjustments: ImageAdjustmentParams,
}

pub fn calculate_layout(req: &LayoutRequest, total_photos: Option<usize>) -> CalculatedLayout {
    let content = content_area_mm(req);

    if req.photo_w_mm <= 0.0 || req.photo_h_mm <= 0.0 {
        return CalculatedLayout {
            rows: 1,
            cols: 1,
            photos_per_sheet: 1,
            waste_percent: 0,
            photo_cell_w_mm: content.w,
            photo_cell_h_mm: content.h,
            cut_margin_mm: 0.0,
            sheets_needed: total_photos.map(|count| count.max(1) as i32),
            template_mode: req.template_mode.clone(),
            photo_area_h_mm: None,
            bottom_padding_mm: None,
            content_x_mm: content.x,
            content_y_mm: content.y,
            content_w_mm: content.w,
            content_h_mm: content.h,
        };
    }

    if req.template_mode.as_deref() == Some("collage") {
        if let Some((cols, rows)) = collage_grid(req.photo_preset_id.as_deref()) {
            let count = cols * rows;
            let used_area = count as f64 * req.photo_w_mm * req.photo_h_mm;
            let total_area = content.w * content.h;
            return CalculatedLayout {
                rows,
                cols,
                photos_per_sheet: count,
                waste_percent: waste_percent(used_area, total_area),
                photo_cell_w_mm: req.photo_w_mm,
                photo_cell_h_mm: req.photo_h_mm,
                cut_margin_mm: 1.0,
                sheets_needed: total_photos.map(|total| div_ceil_i32(total, count as usize)),
                template_mode: Some("collage".to_string()),
                photo_area_h_mm: None,
                bottom_padding_mm: None,
                content_x_mm: content.x,
                content_y_mm: content.y,
                content_w_mm: content.w,
                content_h_mm: content.h,
            };
        }
    }

    if req.template_mode.as_deref() == Some("passport") {
        if let Some((cols, rows)) = passport_grid(req.photo_preset_id.as_deref()) {
            let count = cols * rows;
            let used_area = count as f64 * req.photo_w_mm * req.photo_h_mm;
            let total_area = content.w * content.h;
            return CalculatedLayout {
                rows,
                cols,
                photos_per_sheet: count,
                waste_percent: waste_percent(used_area, total_area),
                photo_cell_w_mm: req.photo_w_mm,
                photo_cell_h_mm: req.photo_h_mm,
                cut_margin_mm: req.cut_margin_mm.max(0.0),
                sheets_needed: total_photos.map(|total| div_ceil_i32(total, count as usize)),
                template_mode: Some("passport".to_string()),
                photo_area_h_mm: None,
                bottom_padding_mm: None,
                content_x_mm: content.x,
                content_y_mm: content.y,
                content_w_mm: content.w,
                content_h_mm: content.h,
            };
        }
    }

    if req.template_mode.as_deref() == Some("business-card") {
        if let Some((cols, rows)) = business_card_grid(req.photo_preset_id.as_deref()) {
            let count = cols * rows;
            let used_area = count as f64 * req.photo_w_mm * req.photo_h_mm;
            let total_area = content.w * content.h;
            return CalculatedLayout {
                rows,
                cols,
                photos_per_sheet: count,
                waste_percent: waste_percent(used_area, total_area),
                photo_cell_w_mm: req.photo_w_mm,
                photo_cell_h_mm: req.photo_h_mm,
                cut_margin_mm: req.cut_margin_mm.max(0.0),
                sheets_needed: total_photos.map(|total| div_ceil_i32(total, count as usize)),
                template_mode: Some("business-card".to_string()),
                photo_area_h_mm: None,
                bottom_padding_mm: None,
                content_x_mm: content.x,
                content_y_mm: content.y,
                content_w_mm: content.w,
                content_h_mm: content.h,
            };
        }
    }

    let is_polaroid = req.template_mode.as_deref() == Some("polaroid");
    let bottom_padding = if is_polaroid {
        req.bottom_padding_mm.unwrap_or(0.0).max(0.0)
    } else {
        0.0
    };
    let effective_h = req.photo_h_mm + bottom_padding;

    let portrait = try_layout(
        req.photo_w_mm,
        effective_h,
        content.w,
        content.h,
        req.cut_margin_mm,
        content,
    );
    let landscape = try_layout(
        effective_h,
        req.photo_w_mm,
        content.w,
        content.h,
        req.cut_margin_mm,
        content,
    );

    let mut best = if portrait.photos_per_sheet >= landscape.photos_per_sheet {
        portrait
    } else {
        landscape
    };

    if is_polaroid {
        best.template_mode = Some("polaroid".to_string());
        best.photo_area_h_mm = Some(req.photo_h_mm);
        best.bottom_padding_mm = Some(bottom_padding);
    } else {
        best.template_mode = req.template_mode.clone();
    }

    best.sheets_needed =
        total_photos.map(|total| div_ceil_i32(total, best.photos_per_sheet as usize));
    best
}

pub fn render_layout_sheet(
    layout: &CalculatedLayout,
    paper_w_mm: f64,
    paper_h_mm: f64,
    images: &[SheetRenderImage],
    cut_marks: bool,
) -> Result<Vec<u8>, String> {
    let page_w = mm_to_px(paper_w_mm, RENDER_DPI);
    let page_h = mm_to_px(paper_h_mm, RENDER_DPI);
    let gap_px = mm_to_px(layout.cut_margin_mm.max(0.0), RENDER_DPI);
    let cell_w = mm_to_px(layout.photo_cell_w_mm, RENDER_DPI).max(1);
    let cell_h = mm_to_px(layout.photo_cell_h_mm, RENDER_DPI).max(1);
    let content_x = mm_to_px_zero(layout.content_x_mm.max(0.0), RENDER_DPI).min(page_w);
    let content_y = mm_to_px_zero(layout.content_y_mm.max(0.0), RENDER_DPI).min(page_h);
    let content_w = mm_to_px(layout.content_w_mm.max(1.0), RENDER_DPI)
        .min(page_w.saturating_sub(content_x))
        .max(1);
    let content_h = mm_to_px(layout.content_h_mm.max(1.0), RENDER_DPI)
        .min(page_h.saturating_sub(content_y))
        .max(1);
    let rows = layout.rows.max(1) as u32;
    let cols = layout.cols.max(1) as u32;

    let grid_w = cols
        .saturating_mul(cell_w)
        .saturating_add(cols.saturating_sub(1).saturating_mul(gap_px));
    let grid_h = rows
        .saturating_mul(cell_h)
        .saturating_add(rows.saturating_sub(1).saturating_mul(gap_px));
    if grid_w > content_w || grid_h > content_h {
        return Err("Printable area is too small for requested layout sheet".to_string());
    }
    let polaroid = layout.template_mode.as_deref() == Some("polaroid");
    let start_x = if polaroid {
        content_x
    } else {
        content_x + content_w.saturating_sub(grid_w) / 2
    };
    let start_y = if polaroid {
        content_y
    } else {
        content_y + content_h.saturating_sub(grid_h) / 2
    };
    let photo_area_h = layout
        .photo_area_h_mm
        .map(|mm| mm_to_px(mm, RENDER_DPI).min(cell_h))
        .unwrap_or(cell_h);

    let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    let business_card = layout.template_mode.as_deref() == Some("business-card");
    let business_bleed_px = if business_card && gap_px > 0 {
        mm_to_px_zero(BUSINESS_CARD_BLEED_MM, RENDER_DPI).min(gap_px / 2)
    } else {
        0
    };

    for row in 0..rows {
        for col in 0..cols {
            let idx = (row * cols + col) as usize;
            let x = start_x + col * (cell_w + gap_px);
            let y = start_y + row * (cell_h + gap_px);
            cells.push((x, y, cell_w, cell_h));

            let Some(item) = images.get(idx) else {
                continue;
            };

            let img = decode_and_prepare(item)?;
            if polaroid {
                let border_side_px = mm_to_px_zero(POLAROID_BORDER_SIDE_MM, RENDER_DPI)
                    .min(cell_w.saturating_sub(1));
                let border_top_px =
                    mm_to_px_zero(POLAROID_BORDER_TOP_MM, RENDER_DPI).min(cell_h.saturating_sub(1));
                let photo_size_px = mm_to_px(POLAROID_PHOTO_SIZE_MM, RENDER_DPI)
                    .min(cell_w.saturating_sub(border_side_px).max(1))
                    .min(cell_h.saturating_sub(border_top_px).max(1))
                    .min(photo_area_h.max(1));
                let rendered =
                    scale_image(&img, photo_size_px, photo_size_px, item.fit_mode.as_str())
                        .to_rgb8();
                overlay_clipped(
                    &mut page,
                    &rendered,
                    x as i64 + border_side_px as i64,
                    y as i64 + border_top_px as i64,
                );
                continue;
            }

            let target_h = cell_h;
            let (draw_x, draw_y, draw_w, draw_h, fit_mode) = if business_card {
                (
                    x as i64 - business_bleed_px as i64,
                    y as i64 - business_bleed_px as i64,
                    cell_w.saturating_add(business_bleed_px.saturating_mul(2)),
                    target_h.saturating_add(business_bleed_px.saturating_mul(2)),
                    "fill",
                )
            } else {
                (x as i64, y as i64, cell_w, target_h, item.fit_mode.as_str())
            };
            let rendered = scale_image(&img, draw_w, draw_h, fit_mode).to_rgb8();
            overlay_clipped(&mut page, &rendered, draw_x, draw_y);
        }
    }

    if cut_marks {
        if polaroid {
            draw_polaroid_cut_lines(&mut page, &cells);
        } else {
            let mark_len = mm_to_px(5.0, RENDER_DPI);
            let mark_offset = mm_to_px(1.0, RENDER_DPI);
            draw_precise_cut_marks(&mut page, &cells, mark_len, mark_offset);
        }
    }

    jpeg::encode_rgb_jpeg_bytes(&page, 95, RENDER_DPI)
}

fn try_layout(
    photo_w_mm: f64,
    photo_h_mm: f64,
    paper_w_mm: f64,
    paper_h_mm: f64,
    margin_mm: f64,
    content: ContentAreaMm,
) -> CalculatedLayout {
    let cols = ((paper_w_mm + margin_mm) / (photo_w_mm + margin_mm))
        .floor()
        .max(1.0) as i32;
    let rows = ((paper_h_mm + margin_mm) / (photo_h_mm + margin_mm))
        .floor()
        .max(1.0) as i32;
    let count = rows * cols;
    let used_area = count as f64 * photo_w_mm * photo_h_mm;
    let total_area = paper_w_mm * paper_h_mm;

    CalculatedLayout {
        rows,
        cols,
        photos_per_sheet: count,
        waste_percent: waste_percent(used_area, total_area),
        photo_cell_w_mm: photo_w_mm,
        photo_cell_h_mm: photo_h_mm,
        cut_margin_mm: margin_mm,
        sheets_needed: None,
        template_mode: None,
        photo_area_h_mm: None,
        bottom_padding_mm: None,
        content_x_mm: content.x,
        content_y_mm: content.y,
        content_w_mm: content.w,
        content_h_mm: content.h,
    }
}

#[derive(Clone, Copy, Debug)]
struct ContentAreaMm {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn content_area_mm(req: &LayoutRequest) -> ContentAreaMm {
    let Some(area) = req.printable_area_mm.as_ref() else {
        return ContentAreaMm {
            x: 0.0,
            y: 0.0,
            w: req.paper_w_mm,
            h: req.paper_h_mm,
        };
    };

    let rotated = approx_eq(req.paper_w_mm, area.page_height_mm)
        && approx_eq(req.paper_h_mm, area.page_width_mm);
    if rotated {
        ContentAreaMm {
            x: area.top_mm,
            y: area.right_mm,
            w: area.printable_height_mm,
            h: area.printable_width_mm,
        }
    } else {
        ContentAreaMm {
            x: area.left_mm,
            y: area.top_mm,
            w: area.printable_width_mm,
            h: area.printable_height_mm,
        }
    }
}

fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() < 1.0
}

fn collage_grid(preset_id: Option<&str>) -> Option<(i32, i32)> {
    match preset_id {
        Some("2-on-a4") => Some((1, 2)),
        Some("4-on-a4") => Some((2, 2)),
        Some("2-on-10x15") => Some((1, 2)),
        _ => None,
    }
}

fn passport_grid(preset_id: Option<&str>) -> Option<(i32, i32)> {
    match preset_id {
        Some("3x4") => Some((2, 3)),
        Some("35x45") => Some((2, 2)),
        Some("25x35") => Some((3, 3)),
        _ => None,
    }
}

fn business_card_grid(preset_id: Option<&str>) -> Option<(i32, i32)> {
    match preset_id {
        Some("business-card") | Some("business-card-eu") => Some((2, 5)),
        _ => None,
    }
}

fn waste_percent(used_area: f64, total_area: f64) -> i32 {
    if total_area <= 0.0 {
        return 0;
    }
    ((1.0 - used_area / total_area) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i32
}

fn div_ceil_i32(total: usize, per_sheet: usize) -> i32 {
    let per_sheet = per_sheet.max(1);
    total.div_ceil(per_sheet) as i32
}

fn mm_to_px(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round().max(1.0) as u32
}

fn mm_to_px_zero(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round().max(0.0) as u32
}

fn decode_and_prepare(item: &SheetRenderImage) -> Result<DynamicImage, String> {
    let img = load_image_oriented_from_memory(&item.bytes)?;
    let img = apply_crop(img, item.crop.as_ref());
    let img = apply_rotation(img, item.rotation);
    let img = if item.mirror {
        DynamicImage::from(image::imageops::flip_horizontal(&img))
    } else {
        img
    };
    Ok(apply_image_adjustments(img, item.adjustments))
}

fn apply_crop(img: DynamicImage, crop: Option<&CropRect>) -> DynamicImage {
    let Some(crop) = crop else {
        return img;
    };
    if crop.width <= 0.0 || crop.height <= 0.0 {
        return img;
    }

    let (w, h) = img.dimensions();
    let crop_w = crop.width.clamp(0.0, 1.0);
    let crop_h = crop.height.clamp(0.0, 1.0);
    let crop_x = crop.x.clamp(0.0, 1.0 - crop_w);
    let crop_y = crop.y.clamp(0.0, 1.0 - crop_h);

    let x = (crop_x * w as f32).round() as u32;
    let y = (crop_y * h as f32).round() as u32;
    let cw = (crop_w * w as f32).round().max(1.0) as u32;
    let ch = (crop_h * h as f32).round().max(1.0) as u32;
    let cw = cw.min(w.saturating_sub(x));
    let ch = ch.min(h.saturating_sub(y));

    if cw == 0 || ch == 0 {
        return img;
    }
    img.crop_imm(x, y, cw, ch)
}

fn apply_rotation(img: DynamicImage, rotation: i16) -> DynamicImage {
    match rotation.rem_euclid(360) {
        90 => DynamicImage::from(image::imageops::rotate90(&img)),
        180 => DynamicImage::from(image::imageops::rotate180(&img)),
        270 => DynamicImage::from(image::imageops::rotate270(&img)),
        _ => img,
    }
}

fn scale_image(img: &DynamicImage, page_w: u32, page_h: u32, fit_mode: &str) -> DynamicImage {
    let (img_w, img_h) = img.dimensions();

    match fit_mode {
        "fill" => {
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.max(scale_y);
            let scaled_w = (img_w as f64 * scale).round().max(1.0) as u32;
            let scaled_h = (img_h as f64 * scale).round().max(1.0) as u32;
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
            let scale_x = page_w as f64 / img_w as f64;
            let scale_y = page_h as f64 / img_h as f64;
            let scale = scale_x.min(scale_y);
            let draw_w = (img_w as f64 * scale).round().max(1.0) as u32;
            let draw_h = (img_h as f64 * scale).round().max(1.0) as u32;
            let resized = img.resize_exact(draw_w, draw_h, FilterType::Lanczos3);
            let mut page: RgbImage = ImageBuffer::from_pixel(page_w, page_h, Rgb([255, 255, 255]));
            let x = ((page_w - draw_w) / 2) as i64;
            let y = ((page_h - draw_h) / 2) as i64;
            image::imageops::overlay(&mut page, &resized.to_rgb8(), x, y);
            DynamicImage::ImageRgb8(page)
        }
    }
}

fn overlay_clipped(page: &mut RgbImage, img: &RgbImage, x: i64, y: i64) {
    let page_w = page.width() as i64;
    let page_h = page.height() as i64;
    let img_w = img.width() as i64;
    let img_h = img.height() as i64;

    let dest_x = x.max(0);
    let dest_y = y.max(0);
    let src_x = (0 - x).max(0);
    let src_y = (0 - y).max(0);
    let end_x = (x + img_w).min(page_w);
    let end_y = (y + img_h).min(page_h);
    let copy_w = end_x - dest_x;
    let copy_h = end_y - dest_y;
    if copy_w <= 0 || copy_h <= 0 {
        return;
    }

    let view = image::imageops::crop_imm(
        img,
        src_x as u32,
        src_y as u32,
        copy_w as u32,
        copy_h as u32,
    )
    .to_image();
    image::imageops::overlay(page, &view, dest_x, dest_y);
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

fn draw_polaroid_cut_lines(page: &mut RgbImage, cells: &[(u32, u32, u32, u32)]) {
    let guide = Rgb([200u8, 200, 200]);
    for &(x, y, w, h) in cells {
        draw_vline(page, x.saturating_add(w), 0, page.height(), guide);
        draw_hline(page, y.saturating_add(h), 0, page.width(), guide);
    }
}

fn draw_hline(page: &mut RgbImage, y: u32, x_start: u32, x_end: u32, color: Rgb<u8>) {
    if y >= page.height() {
        return;
    }
    let start = x_start.min(page.width());
    let end = x_end.min(page.width());
    if start >= end {
        return;
    }
    for x in start..end {
        page.put_pixel(x, y, color);
    }
}

fn draw_vline(page: &mut RgbImage, x: u32, y_start: u32, y_end: u32, color: Rgb<u8>) {
    if x >= page.width() {
        return;
    }
    let start = y_start.min(page.height());
    let end = y_end.min(page.height());
    if start >= end {
        return;
    }
    for y in start..end {
        page.put_pixel(x, y, color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passport_request(preset_id: &str, photo_w_mm: f64, photo_h_mm: f64) -> LayoutRequest {
        LayoutRequest {
            photo_w_mm,
            photo_h_mm,
            paper_w_mm: 100.0,
            paper_h_mm: 150.0,
            cut_margin_mm: 1.0,
            template_mode: Some("passport".to_string()),
            bottom_padding_mm: None,
            photo_preset_id: Some(preset_id.to_string()),
            printable_area_mm: None,
        }
    }

    #[test]
    fn passport_3x4_uses_six_per_10x15_sheet() {
        let layout = calculate_layout(&passport_request("3x4", 30.0, 40.0), Some(18));

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 3);
        assert_eq!(layout.photos_per_sheet, 6);
        assert_eq!(layout.sheets_needed, Some(3));
    }

    #[test]
    fn passport_35x45_uses_four_per_10x15_sheet() {
        let layout = calculate_layout(&passport_request("35x45", 35.0, 45.0), Some(18));

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 2);
        assert_eq!(layout.photos_per_sheet, 4);
        assert_eq!(layout.sheets_needed, Some(5));
    }

    #[test]
    fn business_card_90x50_uses_ten_per_a4_sheet() {
        let layout = calculate_layout(
            &LayoutRequest {
                photo_w_mm: 90.0,
                photo_h_mm: 50.0,
                paper_w_mm: 210.0,
                paper_h_mm: 297.0,
                cut_margin_mm: 3.0,
                template_mode: Some("business-card".to_string()),
                bottom_padding_mm: None,
                photo_preset_id: Some("business-card".to_string()),
                printable_area_mm: None,
            },
            Some(18),
        );

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 5);
        assert_eq!(layout.photos_per_sheet, 10);
        assert_eq!(layout.cut_margin_mm, 3.0);
        assert_eq!(layout.sheets_needed, Some(2));
        assert_eq!(layout.template_mode.as_deref(), Some("business-card"));
    }

    #[test]
    fn business_card_eu_85x55_uses_ten_per_a4_sheet() {
        let layout = calculate_layout(
            &LayoutRequest {
                photo_w_mm: 85.0,
                photo_h_mm: 55.0,
                paper_w_mm: 210.0,
                paper_h_mm: 297.0,
                cut_margin_mm: 3.0,
                template_mode: Some("business-card".to_string()),
                bottom_padding_mm: None,
                photo_preset_id: Some("business-card-eu".to_string()),
                printable_area_mm: None,
            },
            Some(18),
        );

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 5);
        assert_eq!(layout.photos_per_sheet, 10);
        assert_eq!(layout.sheets_needed, Some(2));
    }

    #[test]
    fn generic_layout_uses_printable_area_for_capacity() {
        let layout = calculate_layout(
            &LayoutRequest {
                photo_w_mm: 50.0,
                photo_h_mm: 50.0,
                paper_w_mm: 210.0,
                paper_h_mm: 297.0,
                cut_margin_mm: 0.0,
                template_mode: None,
                bottom_padding_mm: None,
                photo_preset_id: None,
                printable_area_mm: Some(PrintableAreaMm {
                    page_width_mm: 210.0,
                    page_height_mm: 297.0,
                    left_mm: 10.0,
                    top_mm: 20.0,
                    right_mm: 100.0,
                    bottom_mm: 177.0,
                    printable_width_mm: 100.0,
                    printable_height_mm: 100.0,
                }),
            },
            Some(5),
        );

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 2);
        assert_eq!(layout.photos_per_sheet, 4);
        assert_eq!(layout.content_x_mm, 10.0);
        assert_eq!(layout.content_y_mm, 20.0);
        assert_eq!(layout.sheets_needed, Some(2));
    }

    #[test]
    fn business_card_layout_keeps_canon_printable_area() {
        let layout = calculate_layout(
            &LayoutRequest {
                photo_w_mm: 85.0,
                photo_h_mm: 55.0,
                paper_w_mm: 210.0,
                paper_h_mm: 297.0,
                cut_margin_mm: 3.0,
                template_mode: Some("business-card".to_string()),
                bottom_padding_mm: None,
                photo_preset_id: Some("business-card-eu".to_string()),
                printable_area_mm: Some(PrintableAreaMm {
                    page_width_mm: 210.0,
                    page_height_mm: 297.0,
                    left_mm: 5.0,
                    top_mm: 5.0,
                    right_mm: 5.0,
                    bottom_mm: 5.0,
                    printable_width_mm: 200.0,
                    printable_height_mm: 287.0,
                }),
            },
            Some(10),
        );

        assert_eq!(layout.cols, 2);
        assert_eq!(layout.rows, 5);
        assert_eq!(layout.photos_per_sheet, 10);
        assert_eq!(layout.content_x_mm, 5.0);
        assert_eq!(layout.content_y_mm, 5.0);
        assert_eq!(layout.content_w_mm, 200.0);
        assert_eq!(layout.content_h_mm, 287.0);
    }

    #[test]
    fn business_card_render_bleeds_artwork_past_trim_box() {
        let layout = calculate_layout(
            &LayoutRequest {
                photo_w_mm: 90.0,
                photo_h_mm: 50.0,
                paper_w_mm: 210.0,
                paper_h_mm: 297.0,
                cut_margin_mm: 3.0,
                template_mode: Some("business-card".to_string()),
                bottom_padding_mm: None,
                photo_preset_id: Some("business-card".to_string()),
                printable_area_mm: None,
            },
            Some(1),
        );
        let source: RgbImage = ImageBuffer::from_pixel(100, 100, Rgb([220, 20, 60]));
        let bytes = jpeg::encode_rgb_jpeg_bytes(&source, 95, RENDER_DPI).unwrap();
        let sheet = render_layout_sheet(
            &layout,
            210.0,
            297.0,
            &[SheetRenderImage {
                bytes,
                fit_mode: "fit".to_string(),
                rotation: 0,
                crop: None,
                mirror: false,
                adjustments: ImageAdjustmentParams::default(),
            }],
            false,
        )
        .unwrap();
        let page = image::load_from_memory(&sheet).unwrap().to_rgb8();

        let page_w = mm_to_px(210.0, RENDER_DPI);
        let page_h = mm_to_px(297.0, RENDER_DPI);
        let gap_px = mm_to_px(layout.cut_margin_mm, RENDER_DPI);
        let cell_w = mm_to_px(layout.photo_cell_w_mm, RENDER_DPI);
        let cell_h = mm_to_px(layout.photo_cell_h_mm, RENDER_DPI);
        let grid_w = (layout.cols as u32).saturating_mul(cell_w).saturating_add(
            (layout.cols as u32)
                .saturating_sub(1)
                .saturating_mul(gap_px),
        );
        let grid_h = (layout.rows as u32).saturating_mul(cell_h).saturating_add(
            (layout.rows as u32)
                .saturating_sub(1)
                .saturating_mul(gap_px),
        );
        let start_x = page_w.saturating_sub(grid_w) / 2;
        let start_y = page_h.saturating_sub(grid_h) / 2;
        let sample_y = start_y + cell_h / 2;

        let inside_left_edge = page.get_pixel(start_x + 1, sample_y);
        let outside_trim = page.get_pixel(start_x - mm_to_px_zero(1.0, RENDER_DPI), sample_y);
        assert_red(inside_left_edge);
        assert_red(outside_trim);
    }

    #[test]
    fn polaroid_render_places_photo_in_top_left_template_frame() {
        let layout = calculate_layout(&polaroid_request(), Some(1));
        assert_eq!(layout.template_mode.as_deref(), Some("polaroid"));
        assert_eq!(layout.cols, 1);
        assert_eq!(layout.rows, 1);
        assert_eq!(layout.photo_cell_w_mm, 88.0);
        assert_eq!(layout.photo_cell_h_mm, 107.0);

        let sheet =
            render_layout_sheet(&layout, 100.0, 150.0, &[red_sheet_image()], false).unwrap();
        let page = image::load_from_memory(&sheet).unwrap().to_rgb8();

        let inside_photo = page.get_pixel(
            mm_to_px_zero(6.0, RENDER_DPI),
            mm_to_px_zero(6.0, RENDER_DPI),
        );
        let bottom_frame = page.get_pixel(
            mm_to_px_zero(10.0, RENDER_DPI),
            mm_to_px_zero(95.0, RENDER_DPI),
        );

        assert_red(inside_photo);
        assert_white(bottom_frame);
    }

    #[test]
    fn polaroid_cut_marks_are_full_two_cut_lines() {
        let layout = calculate_layout(&polaroid_request(), Some(1));
        let sheet = render_layout_sheet(&layout, 100.0, 150.0, &[red_sheet_image()], true).unwrap();
        let page = image::load_from_memory(&sheet).unwrap().to_rgb8();

        let vertical_cut = page.get_pixel(
            mm_to_px_zero(88.0, RENDER_DPI),
            mm_to_px_zero(120.0, RENDER_DPI),
        );
        let horizontal_cut = page.get_pixel(
            mm_to_px_zero(95.0, RENDER_DPI),
            mm_to_px_zero(107.0, RENDER_DPI),
        );

        assert_not_white(vertical_cut);
        assert_not_white(horizontal_cut);
    }

    fn polaroid_request() -> LayoutRequest {
        LayoutRequest {
            photo_w_mm: 88.0,
            photo_h_mm: 79.0,
            paper_w_mm: 100.0,
            paper_h_mm: 150.0,
            cut_margin_mm: 0.0,
            template_mode: Some("polaroid".to_string()),
            bottom_padding_mm: Some(28.0),
            photo_preset_id: Some("polaroid".to_string()),
            printable_area_mm: None,
        }
    }

    fn red_sheet_image() -> SheetRenderImage {
        let source: RgbImage = ImageBuffer::from_pixel(100, 100, Rgb([220, 20, 60]));
        SheetRenderImage {
            bytes: jpeg::encode_rgb_jpeg_bytes(&source, 95, RENDER_DPI).unwrap(),
            fit_mode: "fill".to_string(),
            rotation: 0,
            crop: None,
            mirror: false,
            adjustments: ImageAdjustmentParams::default(),
        }
    }

    fn assert_red(pixel: &Rgb<u8>) {
        assert!(
            pixel[0] > 150 && pixel[1] < 120 && pixel[2] < 120,
            "expected red bleed pixel, got {pixel:?}"
        );
    }

    fn assert_white(pixel: &Rgb<u8>) {
        assert!(
            pixel[0] > 230 && pixel[1] > 230 && pixel[2] > 230,
            "expected white frame pixel, got {pixel:?}"
        );
    }

    fn assert_not_white(pixel: &Rgb<u8>) {
        assert!(
            pixel[0] < 245 || pixel[1] < 245 || pixel[2] < 245,
            "expected visible cut line pixel, got {pixel:?}"
        );
    }
}
