use std::path::{Path, PathBuf};
use image::{DynamicImage, RgbImage};
use lcms2::*;
use tracing::{debug, info};

/// ICC profile cache — stores downloaded .icc files locally and applies transforms.
pub struct IccCache {
    cache_dir: PathBuf,
}

impl IccCache {
    pub fn new(cache_dir: &Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(cache_dir)?;
        Ok(Self { cache_dir: cache_dir.to_path_buf() })
    }

    /// Path where an ICC profile is stored locally.
    fn profile_path(&self, file_key: &str) -> PathBuf {
        // file_key is S3 key like "icc/uuid.icc" — flatten to filename
        let safe_name = file_key.replace('/', "_");
        self.cache_dir.join(safe_name)
    }

    /// Store ICC profile bytes from MQTT sync.
    pub fn store_profile(&self, file_key: &str, data: &[u8]) -> anyhow::Result<PathBuf> {
        let path = self.profile_path(file_key);
        std::fs::write(&path, data)?;
        info!(path = %path.display(), size = data.len(), "ICC profile stored");
        Ok(path)
    }

    /// Download ICC profile from URL and cache locally.
    pub async fn download_and_store(
        &self,
        http_client: &reqwest::Client,
        file_url: &str,
        file_key: &str,
    ) -> anyhow::Result<PathBuf> {
        let path = self.profile_path(file_key);

        // Skip if already cached
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
            anyhow::bail!("ICC profile too small ({} bytes), likely corrupt", bytes.len());
        }

        std::fs::write(&path, &bytes)?;
        info!(path = %path.display(), size = bytes.len(), "ICC profile downloaded and cached");
        Ok(path)
    }

    /// Check if profile is cached.
    pub fn is_cached(&self, file_key: &str) -> bool {
        self.profile_path(file_key).exists()
    }

    /// Remove a cached profile.
    pub fn remove_profile(&self, file_key: &str) {
        let path = self.profile_path(file_key);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }

    /// Apply ICC color transform to an image.
    /// Converts from sRGB (source) to the target ICC profile using perceptual intent.
    pub fn apply_transform(&self, img: &DynamicImage, profile_key: &str) -> anyhow::Result<DynamicImage> {
        let profile_path = self.profile_path(profile_key);
        if !profile_path.exists() {
            anyhow::bail!("ICC profile not cached: {}", profile_key);
        }

        let profile_data = std::fs::read(&profile_path)?;

        // Source: sRGB
        let src_profile = Profile::new_srgb();

        // Destination: loaded ICC profile
        let dst_profile = Profile::new_icc(&profile_data)
            .map_err(|e| anyhow::anyhow!("Failed to parse ICC profile: {e}"))?;

        // Create transform: sRGB → target, perceptual intent
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

        // Reconstruct image from transformed pixels
        let mut result = RgbImage::new(w, h);
        for (i, pixel) in output.iter().enumerate() {
            let x = (i as u32) % w;
            let y = (i as u32) / w;
            result.put_pixel(x, y, image::Rgb(*pixel));
        }

        debug!(profile = profile_key, "ICC transform applied ({w}x{h})");
        Ok(DynamicImage::ImageRgb8(result))
    }

    /// List all cached profiles.
    pub fn list_cached(&self) -> Vec<String> {
        std::fs::read_dir(&self.cache_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map_or(false, |ext| ext == "icc"))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile_path_flattening() {
        let cache = IccCache::new(Path::new("/tmp/test-icc")).unwrap();
        let path = cache.profile_path("icc/profiles/abc-123.icc");
        assert!(path.to_string_lossy().contains("icc_profiles_abc-123.icc"));
    }
}
