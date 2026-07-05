use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::time::{Duration, timeout};
use uuid::Uuid;

/// Timeout for LibreOffice conversion (complex spreadsheets can be slow).
const SOFFICE_TIMEOUT: Duration = Duration::from_secs(120);
const DEFAULT_SOFFICE_MAX_CONCURRENT: usize = 2;

static SOFFICE_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| {
    Semaphore::new(
        std::env::var("SOFFICE_MAX_CONCURRENT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_SOFFICE_MAX_CONCURRENT),
    )
});

/// Convert a document (DOCX, XLSX, DOC, XLS) to PDF using LibreOffice headless.
///
/// Returns the path to the generated PDF file inside `output_dir`.
pub async fn convert_to_pdf(input: &Path, output_dir: &Path) -> Result<PathBuf, String> {
    convert_document(input, output_dir, "pdf", "PDF").await
}

/// Convert a legacy DOC file to DOCX so it can be preprocessed before PDF export.
///
/// Returns the path to the generated DOCX file inside `output_dir`.
pub async fn convert_to_docx(input: &Path, output_dir: &Path) -> Result<PathBuf, String> {
    convert_document(input, output_dir, "docx", "DOCX").await
}

async fn convert_document(
    input: &Path,
    output_dir: &Path,
    target_ext: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let soffice = find_soffice()?;
    let _permit = SOFFICE_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| format!("LibreOffice semaphore closed: {e}"))?;

    let input_str = input
        .to_str()
        .ok_or_else(|| "Input path contains invalid UTF-8".to_string())?;
    let output_str = output_dir
        .to_str()
        .ok_or_else(|| "Output dir path contains invalid UTF-8".to_string())?;
    let profile_root = std::env::temp_dir().join(format!(
        ".libreoffice-convert-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    tokio::fs::create_dir_all(&profile_root)
        .await
        .map_err(|e| format!("Cannot create LibreOffice profile dir: {e}"))?;
    let user_installation = format!("file://{}", profile_root.join("profile").display());

    tracing::info!(
        input = input_str,
        output_dir = output_str,
        target = target_ext,
        "Starting LibreOffice conversion"
    );

    let result = timeout(
        SOFFICE_TIMEOUT,
        Command::new(&soffice)
            .args([
                "--headless",
                "--nologo",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
                "--nofirststartwizard",
                "--convert-to",
                target_ext,
                "--outdir",
                output_str,
                input_str,
            ])
            // Each conversion gets its own profile. Shared profiles make parallel
            // preview/coverage conversions fail intermittently with exit status 1.
            .env("HOME", &profile_root)
            .env("UserInstallation", &user_installation)
            .output(),
    )
    .await;
    if let Err(err) = tokio::fs::remove_dir_all(&profile_root).await {
        tracing::debug!(
            path = %profile_root.display(),
            error = %err,
            "LibreOffice profile cleanup skipped"
        );
    }

    let output = match result {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Err(format!("Failed to execute soffice: {e}"));
        }
        Err(_) => {
            return Err(format!(
                "LibreOffice conversion timed out after {}s",
                SOFFICE_TIMEOUT.as_secs()
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "soffice failed (exit {}): stderr={stderr}, stdout={stdout}",
            output.status,
        ));
    }

    // LibreOffice names the output file as <input_stem>.pdf
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Cannot determine input file stem".to_string())?;

    let output_path = output_dir.join(format!("{stem}.{target_ext}"));

    if !output_path.exists() {
        // Sometimes LibreOffice produces slightly different names — scan the directory
        let found = find_converted_in_dir(output_dir, stem, target_ext)?;
        return Ok(found);
    }

    tracing::info!(
        output = %output_path.display(),
        target = label,
        "LibreOffice conversion complete"
    );

    Ok(output_path)
}

/// Locate the `soffice` binary on the system.
fn find_soffice() -> Result<PathBuf, String> {
    let candidates = [
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/usr/local/bin/soffice",
    ];

    for path in &candidates {
        let p = Path::new(path);
        if p.exists() {
            return Ok(p.to_path_buf());
        }
    }

    Err(
        "LibreOffice not found. Install with: apt install libreoffice-core libreoffice-writer libreoffice-calc"
            .to_string(),
    )
}

/// Fallback: scan `output_dir` for a converted file whose name starts with `stem`.
fn find_converted_in_dir(dir: &Path, stem: &str, target_ext: &str) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read output directory {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension()
            && ext.eq_ignore_ascii_case(target_ext)
            && let Some(name) = path.file_stem().and_then(|s| s.to_str())
            && name.starts_with(stem)
        {
            return Ok(path);
        }
    }

    Err(format!(
        "LibreOffice did not produce a {target_ext} for stem '{stem}' in {}",
        dir.display()
    ))
}
