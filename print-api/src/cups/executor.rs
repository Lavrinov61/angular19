//! CUPS job executor — orchestrates: download -> process image -> submit to CUPS -> update DB.

use crate::config::Config;
use crate::source_file;
use sqlx::PgPool;
use tokio::time::{Duration, Instant, sleep};
use tracing::{error, info, warn};
use uuid::Uuid;

use super::pdf;
use super::pipeline::{self, ProcessParams};
use super::ppd;
use super::status::{self, CupsJobState, DirectPrinterStatus, PrinterDeviceState};
use super::submit;

const MAX_FILE_SIZE: u64 = 200 * 1024 * 1024; // 200 MB
const TARGET_DPI: u32 = 300;
const TEMP_DIR: &str = "/tmp/cups-print-jobs";
const CUPS_JOB_POLL_INTERVAL_SECS: u64 = 1;
const CUPS_JOB_MIN_VISIBLE_SECS: u64 = 2;
const CUPS_JOB_TIMEOUT_SECS: u64 = 60 * 60;
const PRINTER_DEVICE_POLL_INTERVAL_SECS: u64 = 1;
const PRINTER_DEVICE_IDLE_TIMEOUT_SECS: u64 = 10 * 60;

/// Execute a CUPS print job end-to-end:
/// 1. Download file from S3 URL
/// 2. Process image (crop, rotate, mirror, scale, layout)
/// 3. Submit to CUPS via `lp`
/// 4. Update DB status
/// 5. Notify CRM via Redis
pub async fn execute_cups_job(
    db: PgPool,
    redis: redis::aio::MultiplexedConnection,
    config: Config,
    job_id: Uuid,
    studio_id: Uuid,
    file_url: String,
    file_name: Option<String>,
    cups_printer_name: String,
    copies: i32,
    paper_size: String,
    color_mode: String,
    quality: String,
    duplex: bool,
    booklet: Option<bool>,
    pages_per_sheet: Option<i32>,
    duplex_mode: Option<String>,
    orientation: String,
    borderless: bool,
    media_type: Option<String>,
    paper_source: Option<String>,
    fit_mode: String,
    document_template_slug: Option<String>,
    mirror: Option<bool>,
    rotation: Option<i16>,
    crop_x: Option<f32>,
    crop_y: Option<f32>,
    crop_width: Option<f32>,
    crop_height: Option<f32>,
    layout_rows: Option<i32>,
    layout_cols: Option<i32>,
    custom_photo_width_mm: Option<f64>,
    custom_photo_height_mm: Option<f64>,
    cut_marks: Option<bool>,
    cut_margin_mm: Option<f64>,
    cut_mark_length_mm: Option<f64>,
    cut_mark_offset_mm: Option<f64>,
    photo_enhance: Option<bool>,
    brightness: Option<i16>,
    contrast: Option<i16>,
    saturation: Option<i16>,
    resolution_dpi: Option<i32>,
) {
    info!(job_id = %job_id, printer = %cups_printer_name, "Starting CUPS job execution");

    // Ensure temp dir exists
    if let Err(e) = std::fs::create_dir_all(TEMP_DIR) {
        fail_job(
            &db,
            &redis,
            job_id,
            studio_id,
            &format!("Cannot create temp dir: {e}"),
        )
        .await;
        return;
    }

    // Update status to 'processing'
    update_job_status(&db, job_id, "processing").await;
    publish_redis_update(&redis, job_id, "processing", None, studio_id).await;

    // Step 1: read source file
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let downloaded_path = match source_file::write_source_temp_file(
        &config,
        &http_client,
        &file_url,
        TEMP_DIR,
        MAX_FILE_SIZE,
        "файл печати",
    )
    .await
    {
        Ok(p) => p,
        Err(e) => {
            fail_job(
                &db,
                &redis,
                job_id,
                studio_id,
                &format!("Source file read failed: {e}"),
            )
            .await;
            return;
        }
    };

    let is_rendered_layout_sheet = file_name
        .as_deref()
        .is_some_and(|name| name.starts_with("layout-sheet-"));
    let is_converted_document_page = is_converted_document_page(&file_url, file_name.as_deref());
    let is_document_print_pdf = is_document_print_pdf(&file_url, file_name.as_deref());
    let printable_area_mm = if !borderless && !is_rendered_layout_sheet && !is_document_print_pdf {
        match ppd::printable_area_for_printer(&cups_printer_name, &paper_size, false) {
            Ok(area) => Some(area),
            Err(e) => {
                fail_job(
                    &db,
                    &redis,
                    job_id,
                    studio_id,
                    &format!("Cannot resolve exact printable area from CUPS PPD: {e}"),
                )
                .await;
                cleanup_temp(&downloaded_path);
                return;
            }
        }
    } else {
        None
    };

    // For borderless prints, render to the printer's TRUE sheet dimensions taken
    // from the PPD (e.g. 4x6in = 101.6x152.4mm) instead of the rounded "10x15"
    // nominal (100x150). The nominal render left a ~1.6/2.4mm strip the borderless
    // page could not cover, so the Epson borderless overscan enlarged a thin white
    // border (uneven top/bottom from feed tolerance) instead of the photo.
    // Best-effort: if the PPD lacks a borderless token (e.g. generic IPP printers)
    // fall back to the nominal paper size in the pipeline.
    let borderless_paper_mm = if borderless && !is_rendered_layout_sheet && !is_document_print_pdf {
        match ppd::printable_area_for_printer(&cups_printer_name, &paper_size, true) {
            Ok(area) => Some((area.page_width_mm, area.page_height_mm)),
            Err(e) => {
                warn!(
                    job_id = %job_id,
                    error = %e,
                    "Borderless PPD paper dimension lookup failed; using nominal paper size"
                );
                None
            }
        }
    } else {
        None
    };

    let target_dpi = resolution_dpi
        .filter(|dpi| *dpi > 0)
        .unwrap_or(TARGET_DPI as i32)
        .clamp(150, 1200) as u32;

    // Step 2: Process image (blocking — spawn_blocking).
    // Rendered layout sheets and converted document pages are final physical sheets.
    // Wrap them as PDFs so CUPS uses the document path instead of reinterpreting JPEG DPI.
    let mut cleanup_paths: Vec<std::path::PathBuf> = Vec::new();
    let print_path = if is_document_print_pdf {
        // Fully-converted document: the source is already a single multi-page PDF.
        // Print it as-is (no raster pipeline, no per-page wrap) so `submit_job`
        // sees `is_pdf=true` (by the `.pdf` extension) and CUPS applies duplex
        // across pages, producing ONE queue entry instead of N.
        info!(
            job_id = %job_id,
            path = %downloaded_path.display(),
            "Document PDF print: submitting source PDF directly (duplex via submit_job)"
        );
        downloaded_path.clone()
    } else if is_rendered_layout_sheet {
        info!(
            job_id = %job_id,
            path = %downloaded_path.display(),
            target_dpi,
            "Preparing rendered layout sheet as single-page PDF"
        );

        let dl_path = downloaded_path.clone();
        let paper = paper_size.clone();
        let pdf_result =
            tokio::task::spawn_blocking(move || wrap_final_sheet_as_pdf(&dl_path, &paper)).await;

        match pdf_result {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                fail_job(
                    &db,
                    &redis,
                    job_id,
                    studio_id,
                    &format!("Layout sheet PDF wrapper failed: {e}"),
                )
                .await;
                cleanup_temp(&downloaded_path);
                return;
            }
            Err(e) => {
                fail_job(
                    &db,
                    &redis,
                    job_id,
                    studio_id,
                    &format!("Layout sheet PDF wrapper task panicked: {e}"),
                )
                .await;
                cleanup_temp(&downloaded_path);
                return;
            }
        }
    } else {
        let params = ProcessParams {
            paper_size: paper_size.clone(),
            orientation,
            fit_mode,
            color_mode: color_mode.clone(),
            mirror: mirror.unwrap_or(false),
            rotation: rotation.unwrap_or(0),
            crop_x: crop_x.unwrap_or(0.0),
            crop_y: crop_y.unwrap_or(0.0),
            crop_width: crop_width.unwrap_or(0.0),
            crop_height: crop_height.unwrap_or(0.0),
            adjustments: pipeline::image_adjustments(
                photo_enhance,
                brightness,
                contrast,
                saturation,
            ),
            layout_rows: layout_rows.unwrap_or(1),
            layout_cols: layout_cols.unwrap_or(1),
            custom_photo_width_mm,
            custom_photo_height_mm,
            cut_marks: cut_marks.unwrap_or(false),
            cut_margin_mm: cut_margin_mm.unwrap_or(1.0),
            cut_mark_length_mm: cut_mark_length_mm.unwrap_or(5.0),
            cut_mark_offset_mm: cut_mark_offset_mm.unwrap_or(2.0),
            document_template_slug: document_template_slug.unwrap_or_default(),
            printable_area_mm,
            borderless_paper_mm,
        };

        let dl_path = downloaded_path.clone();
        let processed_result = tokio::task::spawn_blocking(move || {
            pipeline::process_image(&dl_path, &params, target_dpi)
        })
        .await;

        let processed_path = match processed_result {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                fail_job(
                    &db,
                    &redis,
                    job_id,
                    studio_id,
                    &format!("Image processing failed: {e}"),
                )
                .await;
                cleanup_temp(&downloaded_path);
                return;
            }
            Err(e) => {
                fail_job(
                    &db,
                    &redis,
                    job_id,
                    studio_id,
                    &format!("Processing task panicked: {e}"),
                )
                .await;
                cleanup_temp(&downloaded_path);
                return;
            }
        };

        if is_converted_document_page {
            info!(
                job_id = %job_id,
                path = %processed_path.display(),
                paper_size = %paper_size,
                "Preparing converted document page as single-page PDF"
            );

            let processed_for_pdf = processed_path.clone();
            let paper = paper_size.clone();
            let pdf_result = tokio::task::spawn_blocking(move || {
                wrap_final_sheet_as_pdf(&processed_for_pdf, &paper)
            })
            .await;

            match pdf_result {
                Ok(Ok(p)) => {
                    cleanup_paths.push(processed_path);
                    p
                }
                Ok(Err(e)) => {
                    fail_job(
                        &db,
                        &redis,
                        job_id,
                        studio_id,
                        &format!("Converted document page PDF wrapper failed: {e}"),
                    )
                    .await;
                    cleanup_temp(&downloaded_path);
                    cleanup_temp(&processed_path);
                    return;
                }
                Err(e) => {
                    fail_job(
                        &db,
                        &redis,
                        job_id,
                        studio_id,
                        &format!("Converted document page PDF wrapper task panicked: {e}"),
                    )
                    .await;
                    cleanup_temp(&downloaded_path);
                    cleanup_temp(&processed_path);
                    return;
                }
            }
        } else {
            processed_path
        }
    };

    // Step 3: Submit to CUPS
    let job_id_str = job_id.to_string();
    let fname = file_name.unwrap_or_default();
    let mtype = media_type.unwrap_or_default();
    let psource = paper_source.unwrap_or_default();
    let booklet_enabled = booklet.unwrap_or(false);
    let pages_per_sheet_value = pages_per_sheet.unwrap_or(0);
    let duplex_mode_value = duplex_mode.unwrap_or_default();

    match submit::submit_job(
        &cups_printer_name,
        &print_path,
        copies,
        &paper_size,
        borderless,
        &mtype,
        &psource,
        target_dpi,
        &quality,
        &color_mode,
        duplex,
        booklet_enabled,
        pages_per_sheet_value,
        &duplex_mode_value,
        is_document_print_pdf,
        &fname,
        &job_id_str,
    )
    .await
    {
        Ok(cups_job_id) => {
            info!(job_id = %job_id, cups_job_id, "CUPS job submitted successfully");

            update_job_status(&db, job_id, "printing").await;
            publish_redis_update(&redis, job_id, "printing", None, studio_id).await;

            match wait_for_cups_job_completion(&cups_printer_name, cups_job_id).await {
                CupsWaitOutcome::Completed => {
                    update_job_status(&db, job_id, "finishing").await;
                    publish_redis_update(&redis, job_id, "finishing", None, studio_id).await;

                    match wait_for_printer_device_idle(&cups_printer_name).await {
                        PrinterDeviceWaitOutcome::Idle(printer_status) => {
                            info!(
                                job_id = %job_id,
                                cups_job_id,
                                printer = %cups_printer_name,
                                printer_state = printer_status.state.as_str(),
                                queued_job_count = ?printer_status.queued_job_count,
                                state_reasons = ?printer_status.state_reasons,
                                "CUPS job is no longer active and printer reports idle"
                            );

                            complete_job(&db, &redis, job_id, studio_id).await;
                        }
                        PrinterDeviceWaitOutcome::Stopped(printer_status) => {
                            warn!(
                                job_id = %job_id,
                                cups_job_id,
                                printer = %cups_printer_name,
                                printer_state = printer_status.state.as_str(),
                                queued_job_count = ?printer_status.queued_job_count,
                                state_reasons = ?printer_status.state_reasons,
                                "Printer reports stopped after CUPS handoff"
                            );
                            fail_job(
                                &db,
                                &redis,
                                job_id,
                                studio_id,
                                &format!(
                                    "Принтер остановлен: {}",
                                    printer_status_message(&printer_status)
                                ),
                            )
                            .await;
                        }
                        PrinterDeviceWaitOutcome::TimedOut(printer_status) => {
                            warn!(
                                job_id = %job_id,
                                cups_job_id,
                                printer = %cups_printer_name,
                                timeout_secs = PRINTER_DEVICE_IDLE_TIMEOUT_SECS,
                                printer_state = printer_status.state.as_str(),
                                queued_job_count = ?printer_status.queued_job_count,
                                state_reasons = ?printer_status.state_reasons,
                                "Printer did not report idle after CUPS handoff; keeping DB status as finishing"
                            );
                        }
                        PrinterDeviceWaitOutcome::Unavailable => {
                            let cups_status = status::get_printer_status(&cups_printer_name).await;
                            info!(
                                job_id = %job_id,
                                cups_job_id,
                                printer = %cups_printer_name,
                                cups_printer_online = cups_status.is_online,
                                cups_printer_state = cups_status.state,
                                cups_state_reasons = ?cups_status.state_reasons,
                                "Direct printer status unavailable after CUPS handoff; completing by CUPS queue state"
                            );

                            complete_job(&db, &redis, job_id, studio_id).await;
                        }
                    }
                }
                CupsWaitOutcome::TimedOut => {
                    warn!(
                        job_id = %job_id,
                        cups_job_id,
                        printer = %cups_printer_name,
                        timeout_secs = CUPS_JOB_TIMEOUT_SECS,
                        "CUPS job is still active; keeping DB status as printing"
                    );
                }
                CupsWaitOutcome::Unknown => {
                    warn!(
                        job_id = %job_id,
                        cups_job_id,
                        printer = %cups_printer_name,
                        "Cannot verify CUPS job state; keeping DB status as printing"
                    );
                }
            }
        }
        Err(e) => {
            fail_job(
                &db,
                &redis,
                job_id,
                studio_id,
                &format!("CUPS submit failed: {e}"),
            )
            .await;
        }
    }

    // Cleanup temp files
    cleanup_temp(&downloaded_path);
    if print_path != downloaded_path {
        cleanup_temp(&print_path);
    }
    for path in cleanup_paths {
        cleanup_temp(&path);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CupsWaitOutcome {
    Completed,
    TimedOut,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PrinterDeviceWaitOutcome {
    Idle(DirectPrinterStatus),
    Stopped(DirectPrinterStatus),
    TimedOut(DirectPrinterStatus),
    Unavailable,
}

async fn wait_for_cups_job_completion(printer_name: &str, cups_job_id: i32) -> CupsWaitOutcome {
    if cups_job_id <= 0 {
        return CupsWaitOutcome::Unknown;
    }

    let deadline = Instant::now() + Duration::from_secs(CUPS_JOB_TIMEOUT_SECS);
    let min_visible_until = Instant::now() + Duration::from_secs(CUPS_JOB_MIN_VISIBLE_SECS);
    let poll_interval = Duration::from_secs(CUPS_JOB_POLL_INTERVAL_SECS);

    loop {
        if Instant::now() < min_visible_until {
            sleep(poll_interval).await;
            continue;
        }

        match status::get_job_state(printer_name, cups_job_id).await {
            CupsJobState::Active => {
                if Instant::now() >= deadline {
                    return CupsWaitOutcome::TimedOut;
                }
                sleep(poll_interval).await;
            }
            CupsJobState::Completed | CupsJobState::Missing => return CupsWaitOutcome::Completed,
            CupsJobState::Unknown => return CupsWaitOutcome::Unknown,
        }
    }
}

async fn wait_for_printer_device_idle(printer_name: &str) -> PrinterDeviceWaitOutcome {
    let deadline = Instant::now() + Duration::from_secs(PRINTER_DEVICE_IDLE_TIMEOUT_SECS);
    let poll_interval = Duration::from_secs(PRINTER_DEVICE_POLL_INTERVAL_SECS);

    loop {
        let Some(printer_status) = status::get_direct_printer_status(printer_name).await else {
            return PrinterDeviceWaitOutcome::Unavailable;
        };

        if printer_status.state == PrinterDeviceState::Stopped {
            return PrinterDeviceWaitOutcome::Stopped(printer_status);
        }

        if printer_status.state == PrinterDeviceState::Unknown {
            return PrinterDeviceWaitOutcome::Unavailable;
        }

        if !printer_status.is_busy() {
            return PrinterDeviceWaitOutcome::Idle(printer_status);
        }

        if Instant::now() >= deadline {
            return PrinterDeviceWaitOutcome::TimedOut(printer_status);
        }

        sleep(poll_interval).await;
    }
}

fn printer_status_message(printer_status: &DirectPrinterStatus) -> String {
    if printer_status.state_reasons.is_empty() {
        return printer_status.state.as_str().to_owned();
    }
    printer_status.state_reasons.join(", ")
}

async fn fail_job(
    db: &PgPool,
    redis: &redis::aio::MultiplexedConnection,
    job_id: Uuid,
    studio_id: Uuid,
    error_msg: &str,
) {
    error!(job_id = %job_id, error = error_msg, "CUPS job failed");

    if let Err(e) = sqlx::query(
        "UPDATE print_jobs SET status = 'failed', error_message = $2, completed_at = NOW() \
         WHERE id = $1",
    )
    .bind(job_id)
    .bind(error_msg)
    .execute(db)
    .await
    {
        error!(job_id = %job_id, error = %e, "Failed to mark CUPS job failed");
    }

    publish_redis_update(redis, job_id, "failed", Some(error_msg), studio_id).await;
}

async fn complete_job(
    db: &PgPool,
    redis: &redis::aio::MultiplexedConnection,
    job_id: Uuid,
    studio_id: Uuid,
) {
    if let Err(e) = sqlx::query(
        "UPDATE print_jobs SET status = 'completed', completed_at = NOW(), \
         error_message = NULL WHERE id = $1",
    )
    .bind(job_id)
    .execute(db)
    .await
    {
        error!(job_id = %job_id, error = %e, "Failed to mark CUPS job completed");
    }

    publish_redis_update(redis, job_id, "completed", None, studio_id).await;
}

async fn update_job_status(db: &PgPool, job_id: Uuid, status: &str) {
    if let Err(e) = sqlx::query("UPDATE print_jobs SET status = $2 WHERE id = $1")
        .bind(job_id)
        .bind(status)
        .execute(db)
        .await
    {
        warn!(job_id = %job_id, status, error = %e, "Failed to update CUPS job status");
    }
}

async fn publish_redis_update(
    redis: &redis::aio::MultiplexedConnection,
    job_id: Uuid,
    status: &str,
    error: Option<&str>,
    studio_id: Uuid,
) {
    let payload = serde_json::json!({
        "job_id": job_id,
        "status": status,
        "error": error,
        "studio_id": studio_id,
    });

    let mut conn = redis.clone();
    if let Err(e) = redis::cmd("PUBLISH")
        .arg("print:job_update")
        .arg(payload.to_string())
        .query_async::<()>(&mut conn)
        .await
    {
        tracing::warn!("Redis publish (print:job_update) failed: {e}");
    }
}

fn cleanup_temp(path: &std::path::Path) {
    if path.exists() {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::warn!(path = %path.display(), "Failed to cleanup temp file: {e}");
        }
    }
}

fn is_converted_document_page(file_url: &str, file_name: Option<&str>) -> bool {
    if !file_url.contains("print-conversions/") {
        return false;
    }

    let Some(file_name) = file_name else {
        return false;
    };
    let file_name = file_name.to_ascii_lowercase();
    let Some(page_number) = file_name
        .strip_prefix("page_")
        .and_then(|name| name.strip_suffix(".jpg"))
    else {
        return false;
    };

    page_number.len() == 4 && page_number.chars().all(|ch| ch.is_ascii_digit())
}

/// A fully-converted document printed as a single multi-page PDF (one job, one
/// CUPS queue entry, duplex applied across pages). The conversion worker uploads
/// it under `print-conversions/.../document.pdf`. Such a job must bypass the
/// raster image pipeline and be handed to `lp` as-is so CUPS applies duplex.
fn is_document_print_pdf(file_url: &str, file_name: Option<&str>) -> bool {
    if !file_url.contains("print-conversions/") {
        return false;
    }
    let url_is_pdf = file_url
        .split(['?', '#'])
        .next()
        .unwrap_or(file_url)
        .to_ascii_lowercase()
        .ends_with(".pdf");
    let name_is_pdf = file_name
        .map(|name| name.to_ascii_lowercase().ends_with(".pdf"))
        .unwrap_or(false);
    url_is_pdf || name_is_pdf
}

fn wrap_final_sheet_as_pdf(
    input_path: &std::path::Path,
    paper_size: &str,
) -> Result<std::path::PathBuf, String> {
    let Some((paper_width_mm, paper_height_mm)) = pipeline::paper_dimensions_mm(paper_size) else {
        return Err(format!("Unsupported final sheet paper size: {paper_size}"));
    };
    pdf::wrap_jpeg_as_single_page_pdf(input_path, paper_width_mm, paper_height_mm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    use crate::cups::jpeg;

    #[test]
    fn detects_rendered_conversion_pages_only_from_conversion_storage() {
        assert!(is_converted_document_page(
            "https://svoefoto.ru/media/print-conversions/job/task/page_0001.jpg",
            Some("page_0001.jpg"),
        ));
        assert!(!is_converted_document_page(
            "https://svoefoto.ru/media/print-uploads/job/page_0001.jpg",
            Some("page_0001.jpg"),
        ));
        assert!(!is_converted_document_page(
            "https://svoefoto.ru/media/print-conversions/job/task/page_0001.jpg",
            Some("scan.jpg"),
        ));
    }

    #[test]
    fn detects_document_print_pdf_only_from_conversion_storage() {
        // The single converted document PDF — bypasses the raster pipeline.
        assert!(is_document_print_pdf(
            "https://svoefoto.ru/media/print-conversions/job/task/document.pdf",
            Some("protocol.pdf"),
        ));
        // Detection works from the URL even if the title is not a *.pdf name.
        assert!(is_document_print_pdf(
            "https://svoefoto.ru/media/print-conversions/job/task/document.pdf",
            None,
        ));
        // Per-page JPEG children of the old path must NOT match.
        assert!(!is_document_print_pdf(
            "https://svoefoto.ru/media/print-conversions/job/task/page_0001.jpg",
            Some("page_0001.jpg"),
        ));
        // A regular photo PDF outside conversion storage must NOT match.
        assert!(!is_document_print_pdf(
            "https://svoefoto.ru/media/photos/job/poster.pdf",
            Some("poster.pdf"),
        ));
    }

    #[test]
    fn document_pdf_and_converted_page_detectors_are_mutually_exclusive() {
        let pdf_url = "https://svoefoto.ru/media/print-conversions/j/t/document.pdf";
        let jpg_url = "https://svoefoto.ru/media/print-conversions/j/t/page_0001.jpg";
        assert!(is_document_print_pdf(pdf_url, Some("doc.pdf")));
        assert!(!is_converted_document_page(pdf_url, Some("document.pdf")));
        assert!(is_converted_document_page(jpg_url, Some("page_0001.jpg")));
        assert!(!is_document_print_pdf(jpg_url, Some("page_0001.jpg")));
    }

    #[test]
    fn wraps_converted_document_sheet_as_a4_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let input_path = dir.path().join("page_0001.processed.jpg");
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(2480, 3508, Rgb([255, 255, 255])));
        jpeg::save_dynamic_jpeg(&input_path, &image, 95, 300).unwrap();

        let output_path = wrap_final_sheet_as_pdf(&input_path, "A4").unwrap();
        let pdf = std::fs::read(output_path).unwrap();
        let text = String::from_utf8_lossy(&pdf);

        assert!(text.contains("/MediaBox [0 0 595.276 841.890]"));
        assert!(text.contains("/Im0 Do"));
    }
}
