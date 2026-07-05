use std::io::Write;
use std::path::Path;

use image::codecs::jpeg::{JpegEncoder, PixelDensity};
use image::{DynamicImage, ExtendedColorType, RgbImage};

fn jpeg_density(dpi: u32) -> PixelDensity {
    PixelDensity::dpi(dpi.clamp(1, u16::MAX as u32) as u16)
}

pub(crate) fn encode_rgb_jpeg_bytes(
    image: &RgbImage,
    quality: u8,
    dpi: u32,
) -> Result<Vec<u8>, String> {
    let mut encoded = Vec::new();
    encode_jpeg(
        &mut encoded,
        image.as_raw(),
        image.width(),
        image.height(),
        ExtendedColorType::Rgb8,
        quality,
        dpi,
    )?;
    Ok(encoded)
}

pub(crate) fn save_dynamic_jpeg(
    path: &Path,
    image: &DynamicImage,
    quality: u8,
    dpi: u32,
) -> Result<(), String> {
    let file =
        std::fs::File::create(path).map_err(|e| format!("Failed to create output file: {e}"))?;
    encode_jpeg(
        file,
        image.as_bytes(),
        image.width(),
        image.height(),
        image.color().into(),
        quality,
        dpi,
    )
}

fn encode_jpeg<W: Write>(
    writer: W,
    bytes: &[u8],
    width: u32,
    height: u32,
    color: ExtendedColorType,
    quality: u8,
    dpi: u32,
) -> Result<(), String> {
    let mut encoder = JpegEncoder::new_with_quality(writer, quality);
    encoder.set_pixel_density(jpeg_density(dpi));
    encoder
        .encode(bytes, width, height, color)
        .map_err(|e| format!("JPEG encode error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn encodes_jpeg_with_300_dpi_density() {
        let image: RgbImage = ImageBuffer::from_pixel(1, 1, Rgb([255, 255, 255]));
        let bytes = encode_rgb_jpeg_bytes(&image, 95, 300).unwrap();
        let jfif = bytes
            .windows(5)
            .position(|window| window == b"JFIF\0")
            .expect("JFIF header");

        assert_eq!(bytes[jfif + 7], 1);
        assert_eq!(u16::from_be_bytes([bytes[jfif + 8], bytes[jfif + 9]]), 300);
        assert_eq!(
            u16::from_be_bytes([bytes[jfif + 10], bytes[jfif + 11]]),
            300
        );
    }
}
