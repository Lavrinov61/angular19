//! ICC profile cache — cross-platform color management via lcms2.
//!
//! Stores downloaded .icc profiles locally and applies sRGB → target transforms.

use std::path::PathBuf;

use image::{DynamicImage, RgbImage};
use lcms2::*;
use tracing::{debug, info};

#[derive(Clone)]
pub struct IccCache {
    cache_dir: PathBuf,
}

impl IccCache {
    pub fn new(cache_dir: &str) -> anyhow::Result<Self> {
        let path = PathBuf::from(cache_dir);
        std::fs::create_dir_all(&path)?;
        Ok(Self { cache_dir: path })
    }

    fn profile_path(&self, file_key: &str) -> PathBuf {
        let safe_name = file_key.replace('/', "_");
        self.cache_dir.join(safe_name)
    }

    /// Download ICC profile from URL and cache locally.
    pub async fn download_and_store(
        &self,
        http_client: &reqwest::Client,
        file_url: &str,
        file_key: &str,
    ) -> anyhow::Result<PathBuf> {
        let path = self.profile_path(file_key);

        if path.exists() {
            debug!(path = %path.display(), "ICC profile already cached");
            return Ok(path);
        }

        info!(url = file_url, "Downloading ICC profile");
        let resp = http_client.get(file_url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("ICC download failed: HTTP {}", resp.status());
        }

        let bytes = resp.bytes().await?;
        if bytes.len() < 128 {
            anyhow::bail!(
                "ICC profile too small ({} bytes), likely corrupt",
                bytes.len()
            );
        }

        std::fs::write(&path, &bytes)?;
        info!(path = %path.display(), size = bytes.len(), "ICC profile cached");

        // Validate ICC profile color space (must be RGB for input)
        match Profile::new_icc(&bytes) {
            Ok(profile) => {
                let cs = profile.color_space();
                if cs != ColorSpaceSignature::RgbData {
                    tracing::warn!(
                        profile = file_key,
                        color_space = ?cs,
                        "ICC profile has non-RGB color space, may produce incorrect colors"
                    );
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                anyhow::bail!("Invalid ICC profile {file_key}: {e}");
            }
        }

        Ok(path)
    }

    pub fn is_cached(&self, file_key: &str) -> bool {
        self.profile_path(file_key).exists()
    }

    /// Apply ICC color transform: sRGB → target profile (perceptual intent).
    pub fn apply_transform(
        &self,
        img: &DynamicImage,
        profile_key: &str,
    ) -> anyhow::Result<DynamicImage> {
        let profile_path = self.profile_path(profile_key);
        if !profile_path.exists() {
            anyhow::bail!("ICC profile not cached: {profile_key}");
        }

        let profile_data = std::fs::read(&profile_path)?;

        let src_profile = Profile::new_srgb();
        let dst_profile = Profile::new_icc(&profile_data)
            .map_err(|e| anyhow::anyhow!("Failed to parse ICC profile: {e}"))?;

        let transform = Transform::new(
            &src_profile,
            PixelFormat::RGB_8,
            &dst_profile,
            PixelFormat::RGB_8,
            Intent::Perceptual,
        )
        .map_err(|e| anyhow::anyhow!("Failed to create ICC transform: {e}"))?;

        let rgb = img.to_rgb8();
        let (w, h) = (rgb.width(), rgb.height());
        let pixels: Vec<[u8; 3]> = rgb.pixels().map(|p| p.0).collect();

        let mut output = vec![[0u8; 3]; pixels.len()];
        transform.transform_pixels(&pixels, &mut output);

        let mut result = RgbImage::new(w, h);
        for (i, pixel) in output.iter().enumerate() {
            let x = (i as u32) % w;
            let y = (i as u32) / w;
            result.put_pixel(x, y, image::Rgb(*pixel));
        }

        debug!(profile = profile_key, "ICC transform applied ({w}x{h})");
        Ok(DynamicImage::ImageRgb8(result))
    }

    pub fn list_cached(&self) -> Vec<String> {
        std::fs::read_dir(&self.cache_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().is_some_and(|ext| ext == "icc"))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// ICC profile discovery — system-installed vendor profiles
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct IccProfileInfo {
    pub file_name: String,
    pub full_path: String,
    /// "glossy", "matte", "satin", "luster", "fine_art", "photo_quality", or "standard"
    pub media_type: String,
    pub is_vendor_profile: bool,
}

fn detect_media_type(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.contains("glossy") {
        "glossy".into()
    } else if lower.contains("matte") {
        "matte".into()
    } else if lower.contains("satin") || lower.contains("semigloss") {
        "satin".into()
    } else if lower.contains("luster") {
        "luster".into()
    } else if lower.contains("fine_art") || lower.contains("fine art") {
        "fine_art".into()
    } else if lower.contains("quality") {
        "photo_quality".into()
    } else {
        "standard".into()
    }
}

/// Discover vendor ICC profiles installed on the system.
/// Checks Windows color profile directory for printer-specific profiles.
pub fn discover_system_profiles(printer_name: &str) -> Vec<IccProfileInfo> {
    let color_dir = std::path::Path::new("C:\\Windows\\System32\\spool\\drivers\\color");

    if !color_dir.exists() {
        return vec![];
    }

    let printer_lower = printer_name.to_lowercase();
    let mut profiles = Vec::new();

    if let Ok(entries) = std::fs::read_dir(color_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "icc" || ext == "icm" {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default()
                        .to_lowercase();

                    // Match profiles to printer
                    let media_type = detect_media_type(&name);
                    let is_vendor = name.contains(&printer_lower)
                        || (printer_lower.contains("epson") && name.contains("epson"))
                        || (printer_lower.contains("canon") && name.contains("canon"));

                    if is_vendor {
                        profiles.push(IccProfileInfo {
                            file_name: path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into(),
                            full_path: path.to_string_lossy().into(),
                            media_type,
                            is_vendor_profile: true,
                        });
                    }
                }
            }
        }
    }
    profiles
}

/// List all ICC/ICM profiles in the Windows color directory.
pub fn list_all_system_profiles() -> Vec<IccProfileInfo> {
    let color_dir = std::path::Path::new("C:\\Windows\\System32\\spool\\drivers\\color");

    if !color_dir.exists() {
        return vec![];
    }

    let mut profiles = Vec::new();

    if let Ok(entries) = std::fs::read_dir(color_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "icc" || ext == "icm" {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default()
                        .to_lowercase();

                    let media_type = detect_media_type(&name);
                    let is_vendor = name.contains("epson") || name.contains("canon");

                    profiles.push(IccProfileInfo {
                        file_name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                        full_path: path.to_string_lossy().into(),
                        media_type,
                        is_vendor_profile: is_vendor,
                    });
                }
            }
        }
    }
    profiles
}
