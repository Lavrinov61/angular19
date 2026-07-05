//! Auto-update engine: download artifact, verify SHA-256, install.

use sha2::{Sha256, Digest};
use std::path::{Path, PathBuf};
use std::io::Write;

/// Download an artifact from URL, verify SHA-256 hash, save to `dest_dir`.
/// Returns the path to the downloaded file.
pub async fn download_and_verify(
    http_client: &reqwest::Client,
    artifact_url: &str,
    expected_sha256: &str,
    expected_size: u64,
    dest_dir: &Path,
) -> anyhow::Result<PathBuf> {
    tracing::info!("Downloading update from: {artifact_url}");

    let response = http_client.get(artifact_url)
        .send()
        .await?
        .error_for_status()?;

    // Validate Content-Length before downloading the full body
    if let Some(content_length) = response.content_length() {
        if content_length != expected_size {
            anyhow::bail!(
                "Size mismatch: Content-Length header says {content_length}, expected {expected_size}"
            );
        }
    }

    let bytes = response.bytes().await?;

    if bytes.len() as u64 != expected_size {
        anyhow::bail!(
            "Size mismatch: expected {expected_size}, got {}",
            bytes.len()
        );
    }

    // Verify SHA-256
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual_hash = hex::encode(hasher.finalize());

    if actual_hash != expected_sha256 {
        anyhow::bail!(
            "SHA-256 mismatch: expected {expected_sha256}, got {actual_hash}"
        );
    }

    tracing::info!("SHA-256 verified: {actual_hash}");

    // Save to file
    std::fs::create_dir_all(dest_dir)?;
    let filename = artifact_url
        .rsplit('/')
        .next()
        .unwrap_or("update_artifact");
    let dest_path = dest_dir.join(filename);
    let mut file = std::fs::File::create(&dest_path)?;
    file.write_all(&bytes)?;

    tracing::info!("Artifact saved to: {}", dest_path.display());
    Ok(dest_path)
}

/// Install an MSI package silently (Windows only).
/// Returns the exit code of msiexec.
#[cfg(target_os = "windows")]
pub async fn install_msi(msi_path: &Path) -> anyhow::Result<i32> {
    use tokio::process::Command;

    tracing::info!("Installing MSI: {}", msi_path.display());

    let output = Command::new("msiexec")
        .args([
            "/i",
            &msi_path.to_string_lossy(),
            "/quiet",
            "/norestart",
            "/log",
            &format!("{}.log", msi_path.display()),
        ])
        .output()
        .await?;

    let code = output.status.code().unwrap_or(-1);
    if code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!("MSI install failed (code {code}): {stderr}");
    } else {
        tracing::info!("MSI install completed successfully");
    }

    Ok(code)
}

/// Placeholder for Linux update (replace binary + restart service).
#[cfg(not(target_os = "windows"))]
pub async fn install_msi(msi_path: &Path) -> anyhow::Result<i32> {
    tracing::warn!("MSI install not supported on this platform, artifact at: {}", msi_path.display());
    Ok(0)
}
