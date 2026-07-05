use std::path::{Path, PathBuf};
use tokio::process::Command;

const GS_BINARY: &str = "/usr/bin/gs";

/// Options for Ghostscript PDF-to-JPEG rendering.
pub struct GsOptions {
    pub input_pdf: PathBuf,
    pub output_dir: PathBuf,
    /// Specific pages to render (1-indexed). `None` = all pages.
    pub pages: Option<Vec<i32>>,
    /// Maximum number of pages to render when `pages` is `None`.
    pub max_pages: Option<usize>,
    /// DPI for rendering (typically 300 or 600).
    pub dpi: u32,
    /// JPEG quality 1–100 (95 recommended).
    pub jpeg_quality: u8,
}

/// A single rendered page on disk.
pub struct RenderedPage {
    /// Absolute path to the rendered JPEG file.
    pub file_path: PathBuf,
}

/// Get total page count from a PDF using Ghostscript.
pub async fn count_pages(pdf_path: &Path) -> Result<i32, String> {
    check_gs_exists()?;

    let pdf_str = pdf_path
        .to_str()
        .ok_or_else(|| "PDF path contains invalid UTF-8".to_string())?;

    let ps_script = format!("({pdf_str}) (r) file runpdfbegin pdfpagecount = quit");

    let output = Command::new(GS_BINARY)
        .args(["-q", "-dNODISPLAY", "-dNOSAFER", "-c", &ps_script])
        .output()
        .await
        .map_err(|e| format!("Failed to run gs for page count: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "gs page count failed (exit {}): {stderr}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let count: i32 = stdout
        .trim()
        .parse()
        .map_err(|e| format!("Cannot parse page count from gs output '{stdout}': {e}"))?;

    if count < 1 {
        return Err(format!("PDF reports {count} pages — expected at least 1"));
    }

    Ok(count)
}

/// Render specific pages (or all) from a PDF to JPEG files.
///
/// For a contiguous full render (`pages == None`) the whole range is produced in
/// ONE gs process (`-dFirstPage=1 -dLastPage=N -sOutputFile=page_%04d.jpg`) instead
/// of spawning one gs per page — for a multi-page document this removes N-1 process
/// spawns and is markedly faster (the preview/coverage path renders 30+ page docs).
/// On any failure it falls back to the per-page path, which keeps page-level
/// isolation (a single bad page can't sink the whole render).
///
/// Output files are named `page_NNNN.jpg` inside `opts.output_dir`.
pub async fn render_pages(opts: GsOptions) -> Result<Vec<RenderedPage>, String> {
    check_gs_exists()?;

    let total_pages = count_pages(&opts.input_pdf).await?;

    let pages_to_render: Vec<i32> = match opts.pages {
        Some(ref list) => {
            // Validate requested pages are within range
            for &p in list {
                if p < 1 || p > total_pages {
                    return Err(format!(
                        "Requested page {p} is out of range (PDF has {total_pages} pages)"
                    ));
                }
            }
            list.clone()
        }
        None => {
            let last_page = opts
                .max_pages
                .map(|limit| total_pages.min(limit.max(1) as i32))
                .unwrap_or(total_pages);
            (1..=last_page).collect()
        }
    };

    if pages_to_render.is_empty() {
        return Err("No pages selected to render".to_string());
    }

    // Fast path: a contiguous 1..=N render (the preview/coverage case) runs as a
    // single gs process. With FirstPage=1 the `%04d` output index equals the source
    // page number, so file names match the per-page path exactly.
    if opts.pages.is_none() {
        let last_page = *pages_to_render.last().expect("non-empty checked above");
        match render_contiguous_single_gs(&opts, last_page).await {
            Ok(rendered) => {
                tracing::info!(
                    pages = rendered.len(),
                    dpi = opts.dpi,
                    quality = opts.jpeg_quality,
                    mode = "single",
                    "Ghostscript rendered PDF pages to JPEG"
                );
                return Ok(rendered);
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Single-process gs render failed; falling back to per-page"
                );
            }
        }
    }

    let rendered = render_pages_individually(&pages_to_render, &opts).await?;
    tracing::info!(
        pages = rendered.len(),
        dpi = opts.dpi,
        quality = opts.jpeg_quality,
        mode = "per-page",
        "Ghostscript rendered PDF pages to JPEG"
    );
    Ok(rendered)
}

/// Render pages `1..=last_page` in a single gs invocation.
async fn render_contiguous_single_gs(
    opts: &GsOptions,
    last_page: i32,
) -> Result<Vec<RenderedPage>, String> {
    let input_str = opts
        .input_pdf
        .to_str()
        .ok_or_else(|| "PDF path contains invalid UTF-8".to_string())?;
    // gs substitutes %d with the page number; FirstPage=1 makes it 0001..NNNN,
    // matching the names the per-page path produces.
    let output_pattern = opts.output_dir.join("page_%04d.jpg");
    let output_str = output_pattern
        .to_str()
        .ok_or_else(|| "Output path contains invalid UTF-8".to_string())?;

    let dpi = opts.dpi.to_string();
    let quality = opts.jpeg_quality.to_string();

    let output = Command::new(GS_BINARY)
        .args([
            "-sDEVICE=jpeg",
            &format!("-dJPEGQ={quality}"),
            &format!("-r{dpi}"),
            "-dBATCH",
            "-dNOPAUSE",
            "-dSAFER",
            "-dFirstPage=1",
            &format!("-dLastPage={last_page}"),
            &format!("-sOutputFile={output_str}"),
            input_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run gs (single pass): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "gs single-pass render failed (exit {}): {stderr}",
            output.status
        ));
    }

    let mut rendered: Vec<RenderedPage> = Vec::with_capacity(last_page as usize);
    for page in 1..=last_page {
        let output_file = opts.output_dir.join(format!("page_{page:04}.jpg"));
        if !output_file.exists() {
            return Err(format!(
                "gs single pass: expected page file not found: {}",
                output_file.display()
            ));
        }
        rendered.push(RenderedPage {
            file_path: output_file,
        });
    }

    Ok(rendered)
}

/// Render each page in its own gs process (page-level fault isolation; also used
/// for non-contiguous page lists where a single FirstPage/LastPage range can't apply).
async fn render_pages_individually(
    pages_to_render: &[i32],
    opts: &GsOptions,
) -> Result<Vec<RenderedPage>, String> {
    let input_str = opts
        .input_pdf
        .to_str()
        .ok_or_else(|| "PDF path contains invalid UTF-8".to_string())?;

    let mut rendered: Vec<RenderedPage> = Vec::with_capacity(pages_to_render.len());

    for page in pages_to_render {
        let output_file = opts.output_dir.join(format!("page_{page:04}.jpg"));
        let output_str = output_file
            .to_str()
            .ok_or_else(|| "Output path contains invalid UTF-8".to_string())?;

        let dpi = opts.dpi.to_string();
        let quality = opts.jpeg_quality.to_string();
        let first_page = page.to_string();
        let last_page = page.to_string();

        let output = Command::new(GS_BINARY)
            .args([
                "-sDEVICE=jpeg",
                &format!("-dJPEGQ={quality}"),
                &format!("-r{dpi}"),
                "-dBATCH",
                "-dNOPAUSE",
                "-dSAFER",
                &format!("-dFirstPage={first_page}"),
                &format!("-dLastPage={last_page}"),
                &format!("-sOutputFile={output_str}"),
                input_str,
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to run gs for page {page}: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "gs render failed for page {page} (exit {}): {stderr}",
                output.status,
            ));
        }

        // Verify the file was actually created
        if !output_file.exists() {
            return Err(format!(
                "gs reported success but output file not found: {output_str}"
            ));
        }

        rendered.push(RenderedPage {
            file_path: output_file,
        });
    }

    Ok(rendered)
}

/// Extract a subset of pages from a PDF into a single new PDF.
///
/// Used when the operator selected a page subset for a document print job: the
/// printed PDF must contain exactly those pages, not the whole document. Uses
/// `gs -sDEVICE=pdfwrite -sPageList=...` so text stays vector (not rasterized),
/// preserving document print quality. Ghostscript emits the selected pages in
/// document order (it does not reorder by the list), which matches how a printed
/// document is expected to come out.
pub async fn extract_pdf_subset(
    input_pdf: &Path,
    pages: &[i32],
    output_dir: &Path,
) -> Result<PathBuf, String> {
    check_gs_exists()?;

    // `gs -sPageList` requires a strictly increasing list with no duplicates
    // (otherwise it exits with "Bad PageList: Must be increasing order").
    // Normalise to ascending unique page numbers — a printed document comes out
    // in document order regardless of the order the operator clicked them.
    let mut ordered: Vec<i32> = pages.to_vec();
    ordered.sort_unstable();
    ordered.dedup();
    if ordered.is_empty() {
        return Err("Page subset is empty".to_string());
    }

    let total_pages = count_pages(input_pdf).await?;
    for &p in &ordered {
        if p < 1 || p > total_pages {
            return Err(format!(
                "Requested page {p} is out of range (PDF has {total_pages} pages)"
            ));
        }
    }

    let input_str = input_pdf
        .to_str()
        .ok_or_else(|| "PDF path contains invalid UTF-8".to_string())?;
    let output_file = output_dir.join("print_subset.pdf");
    let output_str = output_file
        .to_str()
        .ok_or_else(|| "Output path contains invalid UTF-8".to_string())?;

    let page_list = ordered
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let output = Command::new(GS_BINARY)
        .args([
            "-sDEVICE=pdfwrite",
            "-dBATCH",
            "-dNOPAUSE",
            "-dSAFER",
            &format!("-sPageList={page_list}"),
            &format!("-sOutputFile={output_str}"),
            input_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run gs pdfwrite for page subset: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "gs pdfwrite page subset failed (exit {}): {stderr}",
            output.status
        ));
    }

    if !output_file.exists() {
        return Err(format!(
            "gs pdfwrite reported success but subset file not found: {output_str}"
        ));
    }

    tracing::info!(
        requested_pages = pages.len(),
        "Ghostscript extracted page subset into a single PDF"
    );

    Ok(output_file)
}

/// Check that the `gs` binary exists and is executable.
fn check_gs_exists() -> Result<(), String> {
    if !Path::new(GS_BINARY).exists() {
        return Err(format!(
            "Ghostscript not found at {GS_BINARY}. Install with: apt install ghostscript"
        ));
    }
    Ok(())
}
