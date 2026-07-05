//! Minimal PDF wrapper for final rendered print sheets.
//!
//! CUPS image filters may reinterpret JPEG DPI and tile large rasters. A rendered layout sheet is
//! already a physical page, so wrapping the JPEG into an A4 PDF lets CUPS use the document path.

use std::{
    fs,
    path::{Path, PathBuf},
};

use image::GenericImageView;
use tracing::debug;

const MM_TO_PT: f64 = 72.0 / 25.4;

pub fn wrap_jpeg_as_single_page_pdf(
    input_path: &Path,
    page_width_mm: f64,
    page_height_mm: f64,
) -> Result<PathBuf, String> {
    let image_bytes =
        fs::read(input_path).map_err(|e| format!("Failed to read image for PDF wrapper: {e}"))?;
    let image = image::open(input_path)
        .map_err(|e| format!("Failed to inspect image for PDF wrapper: {e}"))?;
    let (image_width_px, image_height_px) = image.dimensions();
    if image_width_px == 0 || image_height_px == 0 {
        return Err("Cannot wrap empty image as PDF".to_string());
    }

    let image_is_landscape = image_width_px > image_height_px;
    let paper_is_landscape = page_width_mm > page_height_mm;
    let (page_width_mm, page_height_mm) = if image_is_landscape != paper_is_landscape {
        (page_height_mm, page_width_mm)
    } else {
        (page_width_mm, page_height_mm)
    };

    let page_width_pt = page_width_mm * MM_TO_PT;
    let page_height_pt = page_height_mm * MM_TO_PT;
    let pdf = build_single_page_image_pdf(
        &image_bytes,
        image_width_px,
        image_height_px,
        page_width_pt,
        page_height_pt,
    )?;

    let output_path = input_path.with_extension("pdf");
    fs::write(&output_path, pdf).map_err(|e| format!("Failed to write PDF wrapper: {e}"))?;

    debug!(
        path = %output_path.display(),
        source = %input_path.display(),
        image_width_px,
        image_height_px,
        page_width_mm,
        page_height_mm,
        "Wrapped rendered layout sheet JPEG as single-page PDF"
    );
    Ok(output_path)
}

fn build_single_page_image_pdf(
    image_bytes: &[u8],
    image_width_px: u32,
    image_height_px: u32,
    page_width_pt: f64,
    page_height_pt: f64,
) -> Result<Vec<u8>, String> {
    if image_bytes.is_empty() {
        return Err("Cannot embed empty JPEG in PDF".to_string());
    }
    if page_width_pt <= 0.0 || page_height_pt <= 0.0 {
        return Err("PDF page dimensions must be positive".to_string());
    }

    let mut pdf = Vec::with_capacity(image_bytes.len() + 2048);
    let mut offsets = vec![0usize; 6];

    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    push_object(
        &mut pdf,
        &mut offsets,
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>",
    );
    push_object(
        &mut pdf,
        &mut offsets,
        2,
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    );

    let page_object = format!(
        concat!(
            "<< /Type /Page /Parent 2 0 R ",
            "/MediaBox [0 0 {:.3} {:.3}] ",
            "/CropBox [0 0 {:.3} {:.3}] ",
            "/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> ",
            "/Contents 5 0 R >>"
        ),
        page_width_pt, page_height_pt, page_width_pt, page_height_pt
    );
    push_object(&mut pdf, &mut offsets, 3, page_object.as_bytes());

    offsets[4] = pdf.len();
    pdf.extend_from_slice(b"4 0 obj\n");
    pdf.extend_from_slice(
        format!(
            concat!(
                "<< /Type /XObject /Subtype /Image /Width {} ",
                "/Height {} /ColorSpace /DeviceRGB ",
                "/BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n"
            ),
            image_width_px,
            image_height_px,
            image_bytes.len()
        )
        .as_bytes(),
    );
    pdf.extend_from_slice(image_bytes);
    pdf.extend_from_slice(b"\nendstream\nendobj\n");

    let content = format!("q\n{page_width_pt:.3} 0 0 {page_height_pt:.3} 0 0 cm\n/Im0 Do\nQ\n");
    offsets[5] = pdf.len();
    pdf.extend_from_slice(b"5 0 obj\n");
    pdf.extend_from_slice(format!("<< /Length {} >>\nstream\n", content.len()).as_bytes());
    pdf.extend_from_slice(content.as_bytes());
    pdf.extend_from_slice(b"endstream\nendobj\n");

    let xref_offset = pdf.len();
    pdf.extend_from_slice(b"xref\n0 6\n0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n").as_bytes(),
    );

    Ok(pdf)
}

fn push_object(pdf: &mut Vec<u8>, offsets: &mut [usize], id: usize, body: &[u8]) {
    offsets[id] = pdf.len();
    pdf.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
    pdf.extend_from_slice(body);
    pdf.extend_from_slice(b"\nendobj\n");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    use crate::cups::jpeg;

    #[test]
    fn wraps_jpeg_as_a4_pdf_page() {
        let dir = tempfile::tempdir().unwrap();
        let input_path = dir.path().join("layout-sheet-001.jpg");
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(2480, 3508, Rgb([255, 255, 255])));
        jpeg::save_dynamic_jpeg(&input_path, &image, 95, 300).unwrap();

        let output_path = wrap_jpeg_as_single_page_pdf(&input_path, 210.0, 297.0).unwrap();
        let pdf = fs::read(output_path).unwrap();
        let text = String::from_utf8_lossy(&pdf);

        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/MediaBox [0 0 595.276 841.890]"));
        assert!(text.contains("/Filter /DCTDecode"));
        assert!(text.contains("/Im0 Do"));
    }
}
