pub mod detect;
mod docx_font;
mod ghostscript;
mod libreoffice;

use detect::DocumentType;
pub use detect::detect_file_type;
pub(crate) use docx_font::DocxFontStats;

use crate::config::ConversionConfig;
use crate::source_file;
use ghostscript::GsOptions;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use std::time::{Duration, SystemTime};
use tokio::sync::Semaphore;
use uuid::Uuid;

/// Maximum concurrent conversion pipelines.
const MAX_CONCURRENT: usize = 2;
const MAX_SOURCE_FILE_SIZE: u64 = 200 * 1024 * 1024;

/// ConversionWorker listens on PG NOTIFY `conversion_tasks_new`,
/// claims pending tasks, and orchestrates: download -> convert -> upload -> child jobs.
pub struct ConversionWorker {
    db: PgPool,
    db_url: String,
    redis_url: Option<String>,
    s3_endpoint: String,
    s3_region: String,
    s3_bucket: String,
    s3_access_key: String,
    s3_secret_key: String,
    s3_public_url: String,
    temp_dir: PathBuf,
    semaphore: Arc<Semaphore>,
}

/// Metadata about the parent print job needed to spawn children.
#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct ParentJobSettings {
    printer_id: Option<Uuid>,
    copies: i32,
    paper_size: String,
    color_mode: String,
    quality: String,
    duplex: bool,
    orientation: String,
    borderless: bool,
    media_type: Option<String>,
    fit_mode: String,
    order_id: Option<String>,
    order_type: Option<String>,
    receipt_id: Option<Uuid>,
    created_by: Uuid,
    studio_id: Option<Uuid>,
    customer_id: Option<Uuid>,
    service_slug: Option<String>,
    document_template_slug: Option<String>,
    icc_profile_id: Option<Uuid>,
    cut_marks: Option<bool>,
    cut_mark_length_mm: Option<f64>,
    cut_mark_offset_mm: Option<f64>,
    layout_rows: Option<i32>,
    layout_cols: Option<i32>,
    cut_margin_mm: Option<f64>,
    custom_photo_width_mm: Option<f64>,
    custom_photo_height_mm: Option<f64>,
    rotation: Option<i16>,
    priority: i32,
    conversion_dpi: Option<i32>,
    font_size_delta_pt: Option<i16>,
    consumable_usage: Option<Value>,
}

/// A claimed conversion task row.
#[derive(sqlx::FromRow)]
struct ConversionTask {
    id: Uuid,
    job_id: Uuid,
    source_url: String,
    source_type: String,
    pages: Option<Vec<i32>>,
    dpi: i32,
}

impl ConversionWorker {
    /// Create a new worker from `ConversionConfig`.
    pub fn new(
        db: PgPool,
        db_url: &str,
        redis_url: Option<String>,
        config: &ConversionConfig,
    ) -> Self {
        Self {
            db,
            db_url: db_url.to_string(),
            redis_url,
            s3_endpoint: config.s3_endpoint.clone(),
            s3_region: config.s3_region.clone(),
            s3_bucket: config.s3_bucket.clone(),
            s3_access_key: config.s3_access_key.clone(),
            s3_secret_key: config.s3_secret_key.clone(),
            s3_public_url: config.s3_public_url.clone(),
            temp_dir: PathBuf::from(&config.temp_dir),
            semaphore: Arc::new(Semaphore::new(config.max_concurrent)),
        }
    }

    /// Create a new worker from environment variables (legacy constructor).
    pub fn from_env(db: PgPool, db_url: String, redis_url: Option<String>) -> Self {
        let s3_endpoint =
            std::env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        let s3_region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());
        let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "svoefoto-photos".into());
        let s3_access_key = std::env::var("S3_ACCESS_KEY").unwrap_or_default();
        let s3_secret_key = std::env::var("S3_SECRET_KEY").unwrap_or_default();
        let s3_public_url = std::env::var("S3_PUBLIC_URL")
            .unwrap_or_else(|_| format!("{}/{}", s3_endpoint, s3_bucket));

        let temp_dir = choose_temp_dir();

        Self {
            db,
            db_url,
            redis_url,
            s3_endpoint,
            s3_region,
            s3_bucket,
            s3_access_key,
            s3_secret_key,
            s3_public_url,
            temp_dir,
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT)),
        }
    }

    /// Convenience: wrap in Arc and spawn the worker loop on the Tokio runtime.
    pub fn spawn(worker: Arc<Self>) {
        tokio::spawn(worker.run());
    }

    /// Run the worker loop forever. Reconnects on PG errors.
    pub async fn run(self: Arc<Self>) {
        loop {
            match self.run_inner().await {
                Ok(()) => {
                    tracing::info!("Conversion worker PG listener exited cleanly");
                    return;
                }
                Err(e) => {
                    tracing::error!("Conversion worker error: {e}, reconnecting in 5s...");
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    }

    async fn run_inner(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // On startup, sweep any orphaned pending tasks
        self.sweep_pending().await;

        let mut listener = PgListener::connect(&self.db_url).await?;
        listener.listen("conversion_tasks_new").await?;
        tracing::info!("Conversion worker: PG LISTEN 'conversion_tasks_new' active");

        loop {
            let _notification = listener.recv().await?;
            // Each notification triggers a claim attempt; semaphore limits concurrency.
            let worker = Arc::new(self.clone_refs());
            let permit = self.semaphore.clone().acquire_owned().await?;

            tokio::spawn(async move {
                if let Err(e) = worker.claim_and_process().await {
                    tracing::error!("Conversion task processing error: {e}");
                }
                drop(permit);
            });
        }
    }

    /// On startup, claim any pending tasks that were left behind (e.g. after restart).
    async fn sweep_pending(&self) {
        let pending_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM conversion_tasks WHERE status = 'pending'")
                .fetch_one(&self.db)
                .await
                .unwrap_or(0);

        if pending_count > 0 {
            tracing::info!(
                count = pending_count,
                "Conversion worker: sweeping orphaned pending tasks"
            );
            for _ in 0..pending_count {
                let worker = Arc::new(self.clone_refs());
                let sem = self.semaphore.clone();
                tokio::spawn(async move {
                    let _permit = sem.acquire().await;
                    if let Err(e) = worker.claim_and_process().await {
                        tracing::error!("Sweep task error: {e}");
                    }
                });
            }
        }
    }

    /// Atomically claim one pending task with FOR UPDATE SKIP LOCKED, then process it.
    async fn claim_and_process(&self) -> Result<(), String> {
        let task = sqlx::query_as::<_, ConversionTask>(
            r#"WITH next AS (
                 SELECT id FROM conversion_tasks
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
               )
               UPDATE conversion_tasks ct
               SET status = 'downloading', started_at = NOW()
               FROM next
               WHERE ct.id = next.id
               RETURNING ct.id, ct.job_id, ct.source_url, ct.source_type,
                         ct.pages, ct.dpi"#,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("DB claim error: {e}"))?;

        let Some(task) = task else {
            return Ok(()); // nothing to claim
        };

        tracing::info!(
            task_id = %task.id,
            job_id = %task.job_id,
            source_type = %task.source_type,
            "Claimed conversion task"
        );

        // Create temp directory for this task
        let task_dir = self.temp_dir.join(task.id.to_string());
        tokio::fs::create_dir_all(&task_dir)
            .await
            .map_err(|e| format!("Cannot create temp dir: {e}"))?;

        // Always clean up temp files, even on error
        let result = self.process_task(&task, &task_dir).await;

        // Cleanup temp directory
        if let Err(e) = tokio::fs::remove_dir_all(&task_dir).await {
            tracing::warn!(task_id = %task.id, "Failed to clean temp dir: {e}");
        }

        if let Err(ref e) = result {
            self.fail_task(task.id, task.job_id, e).await;
        }

        result
    }

    /// The full pipeline: read source -> (optionally LibreOffice) -> ghostscript -> upload -> child jobs.
    async fn process_task(&self, task: &ConversionTask, task_dir: &Path) -> Result<(), String> {
        let doc_type = detect_file_type(&task.source_url);
        if !doc_type.is_document() {
            return Err("File is not a document (raster image) — conversion not needed".into());
        }

        // Step 1: Read source file
        let source_ext = extension_for_type(&task.source_type);
        let downloaded_path = task_dir.join(format!("source.{source_ext}"));
        self.download_file(&task.source_url, &downloaded_path)
            .await?;

        tracing::info!(
            task_id = %task.id,
            path = %downloaded_path.display(),
            "Read source file"
        );

        let parent_settings = self.load_parent_settings(task.job_id).await?;

        // Step 2: Convert to PDF if needed (DOCX/XLSX/DOC/XLS)
        let pdf_path = if doc_type.needs_libreoffice() {
            self.update_task_status(task.id, "converting_to_pdf").await;
            // Reuse the shared office→PDF cache: when this document was already
            // converted for the preview/coverage of the same content, DOCX→PDF is
            // not run again. A document is converted at most once across
            // preview + coverage + print.
            let pdf = office_to_pdf_cached(
                &downloaded_path,
                task_dir,
                doc_type,
                parent_settings.font_size_delta_pt,
            )
            .await?;
            tracing::info!(task_id = %task.id, "Document converted to PDF (cached)");
            pdf
        } else {
            // Already a PDF
            downloaded_path.clone()
        };

        // Step 3: Render PDF pages to JPEG via Ghostscript
        self.update_task_status(task.id, "rendering").await;

        let render_dir = task_dir.join("pages");
        tokio::fs::create_dir_all(&render_dir)
            .await
            .map_err(|e| format!("Cannot create render dir: {e}"))?;

        let dpi = if task.dpi > 0 { task.dpi as u32 } else { 300 };

        let rendered = ghostscript::render_pages(GsOptions {
            input_pdf: pdf_path.clone(),
            output_dir: render_dir,
            pages: task.pages.clone(),
            max_pages: None,
            dpi,
            jpeg_quality: 95,
        })
        .await?;

        let total_pages = rendered.len() as i32;
        tracing::info!(
            task_id = %task.id,
            total_pages,
            "Rendered {total_pages} pages to JPEG"
        );

        // Update total_pages in DB
        let _ = sqlx::query("UPDATE conversion_tasks SET total_pages = $2 WHERE id = $1")
            .bind(task.id)
            .bind(total_pages)
            .execute(&self.db)
            .await;

        // Step 4: Print the document as ONE multi-page PDF job (not per-page JPEG).
        // The JPEG pages rendered above are used only to determine total_pages
        // (and to keep the existing coverage/preview behaviour); they are NOT
        // printed. Printing a single PDF lets CUPS apply duplex across pages and
        // sends the printer ONE queue entry instead of N.
        self.update_task_status(task.id, "uploading").await;

        // The rendered JPEGs are not used for printing — free them now.
        for page in &rendered {
            let _ = tokio::fs::remove_file(&page.file_path).await;
        }

        // If the operator selected a page subset, extract exactly those pages into
        // a new PDF (vector text preserved); otherwise print the whole document.
        let print_pdf_path = match task.pages.as_ref().filter(|pages| !pages.is_empty()) {
            Some(pages) => ghostscript::extract_pdf_subset(&pdf_path, pages, task_dir).await?,
            None => pdf_path.clone(),
        };

        let s3_key = format!("print-conversions/{}/{}/document.pdf", task.job_id, task.id);
        let s3_url = self
            .upload_to_s3(&print_pdf_path, &s3_key, "application/pdf")
            .await?;

        self.create_document_print_child(task.job_id, &parent_settings, &s3_url, &task.source_url)
            .await?;

        let _ = sqlx::query("UPDATE conversion_tasks SET converted_pages = $2 WHERE id = $1")
            .bind(task.id)
            .bind(total_pages)
            .execute(&self.db)
            .await;

        tracing::info!(
            task_id = %task.id,
            job_id = %task.job_id,
            total_pages,
            s3_key = %s3_key,
            "Uploaded single document PDF and created one print job"
        );

        // Step 5: Mark task and parent job as completed
        self.complete_task(task.id, task.job_id).await?;

        // Publish Redis event for CRM UI
        self.publish_redis_update(task.job_id, "completed", None, parent_settings.studio_id)
            .await;

        tracing::info!(
            task_id = %task.id,
            job_id = %task.job_id,
            total_pages,
            "Conversion pipeline completed"
        );

        Ok(())
    }

    // ── Helpers ──────────────────────────────────────────────

    /// Read a source file into a local path.
    async fn download_file(&self, url: &str, dest: &Path) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;

        let conversion = self.source_conversion_config();
        source_file::write_source_file_for_conversion(
            Some(&conversion),
            &client,
            url,
            dest,
            MAX_SOURCE_FILE_SIZE,
            "документ",
        )
        .await
        .map_err(|e| format!("Source file read failed for {url}: {e}"))?;

        Ok(())
    }

    fn source_conversion_config(&self) -> ConversionConfig {
        ConversionConfig {
            s3_endpoint: self.s3_endpoint.clone(),
            s3_region: self.s3_region.clone(),
            s3_bucket: self.s3_bucket.clone(),
            s3_access_key: self.s3_access_key.clone(),
            s3_secret_key: self.s3_secret_key.clone(),
            s3_public_url: self.s3_public_url.clone(),
            temp_dir: self.temp_dir.to_string_lossy().into_owned(),
            max_concurrent: MAX_CONCURRENT,
        }
    }

    /// Upload a local file to S3 (Yandex Cloud Object Storage, S3-compatible).
    /// Uses a simple PUT with AWS v4 signature via aws-sdk-s3.
    async fn upload_to_s3(
        &self,
        local_path: &Path,
        s3_key: &str,
        content_type: &str,
    ) -> Result<String, String> {
        let body = tokio::fs::read(local_path)
            .await
            .map_err(|e| format!("Read file for upload: {e}"))?;
        let content_length = body.len() as i64;

        let creds = aws_sdk_s3::config::Credentials::new(
            &self.s3_access_key,
            &self.s3_secret_key,
            None,
            None,
            "print-api-conversion",
        );

        let config = aws_sdk_s3::Config::builder()
            .region(aws_sdk_s3::config::Region::new(self.s3_region.clone()))
            .endpoint_url(&self.s3_endpoint)
            .credentials_provider(creds)
            .force_path_style(true)
            .http_client(crate::s3_client::no_proxy_http_client())
            .request_checksum_calculation(
                aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired,
            )
            .behavior_version_latest()
            .build();

        let client = aws_sdk_s3::Client::from_conf(config);

        client
            .put_object()
            .bucket(&self.s3_bucket)
            .key(s3_key)
            .body(aws_sdk_s3::primitives::ByteStream::from(body))
            .content_length(content_length)
            .content_type(content_type)
            .cache_control("public, max-age=31536000")
            .send()
            .await
            .map_err(|e| {
                tracing::error!(
                    error = ?e,
                    s3_key,
                    content_length,
                    "S3 upload failed for converted print page"
                );
                format!("S3 upload failed for {s3_key}: {e}")
            })?;

        let public_url = format!("{}/{}", self.s3_public_url, s3_key);
        Ok(public_url)
    }

    /// Load the parent job's print settings so children inherit them.
    async fn load_parent_settings(&self, job_id: Uuid) -> Result<ParentJobSettings, String> {
        sqlx::query_as::<_, ParentJobSettings>(
            r#"SELECT
                 printer_id, copies, paper_size, color_mode, quality,
                 duplex, orientation, borderless, media_type, fit_mode,
                 order_id, order_type, receipt_id, created_by, studio_id,
                 customer_id, service_slug, document_template_slug,
                 icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
                 layout_rows, layout_cols, cut_margin_mm,
                 custom_photo_width_mm, custom_photo_height_mm, rotation,
                 priority, conversion_dpi, font_size_delta_pt,
                 consumable_usage
               FROM print_jobs WHERE id = $1"#,
        )
        .bind(job_id)
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("DB error loading parent job: {e}"))?
        .ok_or_else(|| format!("Parent job {job_id} not found"))
    }

    /// Create the single print job for a fully-converted document.
    ///
    /// Unlike the former per-page child jobs, this creates ONE job whose
    /// `file_url` is the complete multi-page PDF. Every print setting is inherited
    /// from the parent (duplex, printer, copies, colour, paper size, …) via the
    /// `SELECT ... FROM print_jobs WHERE id = parent`, so CUPS prints the whole
    /// document in one queue entry with duplex applied across pages.
    ///
    /// `consumable_usage` is the FULL parent estimate (not divided per page), so
    /// toner accounting on completion matches the whole document exactly.
    async fn create_document_print_child(
        &self,
        parent_job_id: Uuid,
        parent: &ParentJobSettings,
        file_url: &str,
        source_url: &str,
    ) -> Result<Uuid, String> {
        let file_name = document_pdf_file_name(source_url);

        let child_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO print_jobs (
                 printer_id, file_url, file_name,
                 copies, paper_size, color_mode, quality,
                 duplex, orientation, borderless, media_type, fit_mode,
                 status, order_id, order_type, receipt_id,
                 created_by, studio_id, customer_id,
                 service_slug, document_template_slug,
                 icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
                 layout_rows, layout_cols, cut_margin_mm,
                 custom_photo_width_mm, custom_photo_height_mm, rotation,
                 priority, parent_job_id, page_number,
                 conversion_dpi, font_size_delta_pt,
                 preset_id, trace_id, paper_source,
                 watermark_text, watermark_opacity, watermark_position,
                 banner_page, banner_info,
                 mirror, crop_x, crop_y, crop_width, crop_height,
                 nup, "collate", resolution_dpi, color_auto_detect, booklet,
                 pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
                 duplex_mode, scaling_percent, output_bin, toner_save,
                 department_id, secure_pin, gray_mode, rendering_intent,
                 consumable_usage
               )
               SELECT
                 printer_id, $2, $3,
                 copies, paper_size, color_mode, quality,
                 duplex, orientation, borderless, media_type, fit_mode,
                 'queued', order_id, order_type, receipt_id,
                 created_by, studio_id, customer_id,
                 service_slug, document_template_slug,
                 icc_profile_id, cut_marks, cut_mark_length_mm, cut_mark_offset_mm,
                 layout_rows, layout_cols, cut_margin_mm,
                 custom_photo_width_mm, custom_photo_height_mm, rotation,
                 priority, id, $4,
                 conversion_dpi, font_size_delta_pt,
                 preset_id, trace_id, paper_source,
                 watermark_text, watermark_opacity, watermark_position,
                 banner_page, banner_info,
                 mirror, crop_x, crop_y, crop_width, crop_height,
                 nup, "collate", resolution_dpi, color_auto_detect, booklet,
                 pages_per_sheet, binding, staple_position, hole_punch, hole_punch_type,
                 duplex_mode, scaling_percent, output_bin, toner_save,
                 department_id, secure_pin, gray_mode, rendering_intent,
                 $5
               FROM print_jobs
               WHERE id = $1
               RETURNING id"#,
        )
        .bind(parent_job_id) // $1
        .bind(file_url) // $2
        .bind(&file_name) // $3
        .bind(Option::<i32>::None) // $4 page_number — NULL: whole document, not a page
        .bind(&parent.consumable_usage) // $5 full parent estimate (not per-page)
        .fetch_one(&self.db)
        .await
        .map_err(|e| format!("DB error creating document print job: {e}"))?;

        Ok(child_id)
    }

    /// Mark the conversion task and parent job as completed.
    async fn complete_task(&self, task_id: Uuid, job_id: Uuid) -> Result<(), String> {
        sqlx::query(
            "UPDATE conversion_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1",
        )
        .bind(task_id)
        .execute(&self.db)
        .await
        .map_err(|e| format!("DB error completing task: {e}"))?;

        sqlx::query(
            "UPDATE print_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1",
        )
        .bind(job_id)
        .execute(&self.db)
        .await
        .map_err(|e| format!("DB error completing parent job: {e}"))?;

        Ok(())
    }

    /// Mark the task and parent job as failed.
    async fn fail_task(&self, task_id: Uuid, job_id: Uuid, error: &str) {
        tracing::error!(task_id = %task_id, job_id = %job_id, error, "Conversion task failed");

        let _ = sqlx::query(
            "UPDATE conversion_tasks SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
        )
        .bind(task_id)
        .bind(error)
        .execute(&self.db)
        .await;

        let _ = sqlx::query(
            "UPDATE print_jobs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
        )
        .bind(job_id)
        .bind(error)
        .execute(&self.db)
        .await;

        // Fetch studio_id for Redis notification
        let studio_id: Option<Uuid> =
            sqlx::query_scalar("SELECT studio_id FROM print_jobs WHERE id = $1")
                .bind(job_id)
                .fetch_optional(&self.db)
                .await
                .ok()
                .flatten();

        self.publish_redis_update(job_id, "failed", Some(error), studio_id)
            .await;
    }

    /// Update conversion_tasks.status.
    async fn update_task_status(&self, task_id: Uuid, status: &str) {
        let _ = sqlx::query("UPDATE conversion_tasks SET status = $2 WHERE id = $1")
            .bind(task_id)
            .bind(status)
            .execute(&self.db)
            .await;
    }

    /// Publish a `print:job_update` event to Redis for the CRM Socket.IO relay.
    async fn publish_redis_update(
        &self,
        job_id: Uuid,
        status: &str,
        error: Option<&str>,
        studio_id: Option<Uuid>,
    ) {
        let Some(ref redis_url) = self.redis_url else {
            return;
        };

        let client = match redis::Client::open(redis_url.as_str()) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Redis client error (conversion): {e}");
                return;
            }
        };

        let mut conn = match client.get_multiplexed_tokio_connection().await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Redis connect error (conversion): {e}");
                return;
            }
        };

        let payload = serde_json::json!({
            "job_id": job_id,
            "status": status,
            "error": error,
            "studio_id": studio_id,
            "source": "conversion_worker",
        });

        if let Err(e) = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(payload.to_string())
            .query_async::<()>(&mut conn)
            .await
        {
            tracing::warn!("Redis publish (conversion update) failed: {e}");
        }
    }

    /// Create a lightweight reference clone (shares Arc'd semaphore, clones cheap strings).
    fn clone_refs(&self) -> Self {
        Self {
            db: self.db.clone(),
            db_url: self.db_url.clone(),
            redis_url: self.redis_url.clone(),
            s3_endpoint: self.s3_endpoint.clone(),
            s3_region: self.s3_region.clone(),
            s3_bucket: self.s3_bucket.clone(),
            s3_access_key: self.s3_access_key.clone(),
            s3_secret_key: self.s3_secret_key.clone(),
            s3_public_url: self.s3_public_url.clone(),
            temp_dir: self.temp_dir.clone(),
            semaphore: self.semaphore.clone(),
        }
    }
}

/// Choose temp directory: prefer /var/lib/print-conversions if it exists and is writable.
/// Falls back to /tmp/print-conversions. Panics if neither is writable.
fn choose_temp_dir() -> PathBuf {
    let preferred = PathBuf::from("/var/lib/print-conversions");
    if is_dir_writable(&preferred) {
        tracing::info!(dir = %preferred.display(), "Conversion temp dir: preferred");
        return preferred;
    }

    let fallback = PathBuf::from("/tmp/print-conversions");
    let _ = std::fs::create_dir_all(&fallback);
    if is_dir_writable(&fallback) {
        tracing::info!(dir = %fallback.display(), "Conversion temp dir: fallback");
        return fallback;
    }

    panic!(
        "No writable temp dir for conversions. Tried {} and {}",
        preferred.display(),
        fallback.display()
    );
}

/// Check that `dir` exists and is writable by creating and removing a probe file.
fn is_dir_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(".print_api_write_probe");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Map source_type string to a file extension.
fn extension_for_type(source_type: &str) -> &str {
    if detect::detect_file_type(&format!("source.{source_type}")).is_document() {
        source_type
    } else {
        "bin"
    }
}

pub(crate) fn extension_for_document_type(doc_type: DocumentType) -> &'static str {
    doc_type.source_extension()
}

/// Derive a friendly `*.pdf` file name (used as the CUPS job title) from the
/// document's source URL. The printed artifact is always a PDF, so the title
/// reflects the original document name with a `.pdf` extension. Falls back to
/// `document.pdf` when no usable name can be extracted.
fn document_pdf_file_name(source_url: &str) -> String {
    let path = source_url.split(['?', '#']).next().unwrap_or(source_url);
    let base = path.rsplit('/').next().unwrap_or("");
    let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base).trim();
    if stem.is_empty() {
        "document.pdf".to_string()
    } else {
        format!("{stem}.pdf")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        OFFICE_PDF_CACHE_TTL, document_pdf_file_name, office_pdf_flight_contains,
        office_pdf_flight_done, office_pdf_flight_lock, prune_office_pdf_cache,
        publish_pdf_to_cache,
    };
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};

    #[tokio::test]
    async fn publish_pdf_to_cache_copies_atomically_without_leftover_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.pdf");
        std::fs::write(&src, b"%PDF-1.4 test").unwrap();
        let dst = dir.path().join("abc123.pdf");

        publish_pdf_to_cache(&src, &dst).await.unwrap();

        assert_eq!(std::fs::read(&dst).unwrap(), b"%PDF-1.4 test");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind");
    }

    #[tokio::test]
    async fn prune_removes_only_stale_pdfs() {
        let dir = tempfile::tempdir().unwrap();
        let fresh = dir.path().join("fresh.pdf");
        let stale = dir.path().join("stale.pdf");
        let inflight = dir.path().join("inflight.pdf.tmp-xyz");
        std::fs::write(&fresh, b"f").unwrap();
        std::fs::write(&stale, b"s").unwrap();
        std::fs::write(&inflight, b"t").unwrap();

        let old = SystemTime::now() - OFFICE_PDF_CACHE_TTL - Duration::from_secs(60);
        std::fs::File::open(&stale).unwrap().set_modified(old).unwrap();

        prune_office_pdf_cache(dir.path()).await;

        assert!(fresh.exists(), "fresh PDF must survive");
        assert!(!stale.exists(), "stale PDF must be pruned");
        assert!(inflight.exists(), "in-flight .tmp must not be pruned");
    }

    #[test]
    fn flight_lock_dedups_per_key_and_cleans_up() {
        let a1 = office_pdf_flight_lock("flightKeyA");
        let a2 = office_pdf_flight_lock("flightKeyA");
        let b1 = office_pdf_flight_lock("flightKeyB");
        assert!(Arc::ptr_eq(&a1, &a2), "same key must share one lock");
        assert!(!Arc::ptr_eq(&a1, &b1), "different keys must differ");
        assert!(office_pdf_flight_contains("flightKeyA"));

        // Releasing one of two holders keeps the entry alive.
        office_pdf_flight_done("flightKeyA", a1);
        assert!(
            office_pdf_flight_contains("flightKeyA"),
            "entry persists while a holder remains"
        );
        let a3 = office_pdf_flight_lock("flightKeyA");
        assert!(Arc::ptr_eq(&a2, &a3), "re-lock returns the live entry");

        // Releasing the last holders removes the entry (no leak).
        office_pdf_flight_done("flightKeyA", a2);
        office_pdf_flight_done("flightKeyA", a3);
        office_pdf_flight_done("flightKeyB", b1);
        assert!(
            !office_pdf_flight_contains("flightKeyA"),
            "entry removed after last holder"
        );
        assert!(!office_pdf_flight_contains("flightKeyB"));
    }

    #[test]
    fn derives_pdf_title_from_document_url() {
        assert_eq!(
            document_pdf_file_name("https://svoefoto.ru/media/uploads/protocol.docx"),
            "protocol.pdf"
        );
        assert_eq!(
            document_pdf_file_name("https://svoefoto.ru/media/uploads/scan.pdf"),
            "scan.pdf"
        );
    }

    #[test]
    fn strips_query_string_and_falls_back() {
        assert_eq!(
            document_pdf_file_name("https://svoefoto.ru/media/a/report.doc?X-Amz-Sig=abc"),
            "report.pdf"
        );
        assert_eq!(document_pdf_file_name("https://svoefoto.ru/media/a/"), "document.pdf");
        assert_eq!(document_pdf_file_name(""), "document.pdf");
    }
}

/// Быстрый подсчёт страниц документа без полного рендера/анализа заливки.
///
/// Источник истины «N страниц» для цены: PDF считается мгновенно (`gs pdfpagecount`),
/// office-документ сначала конвертируется в PDF через тот же общий кэш
/// (`office_to_pdf_cached`, single-flight + sha256), что и превью/печать/coverage —
/// поэтому документ конвертируется не более одного раза на всю цепочку. `font_delta`
/// влияет на пагинацию Word-документов (меняет перенос строк → число страниц),
/// поэтому передаём его в конверсию и в ключ кэша.
///
/// Растровые изображения сюда НЕ передаются (вызывающий возвращает 1 страницу до
/// вызова) — `doc_type` всегда документ.
pub(crate) async fn count_document_pages(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
    font_size_delta_pt: Option<i16>,
) -> Result<i32, String> {
    let pdf_path = if doc_type.needs_libreoffice() {
        office_to_pdf_cached(input_path, task_dir, doc_type, font_size_delta_pt).await?
    } else {
        input_path.to_path_buf()
    };

    ghostscript::count_pages(&pdf_path).await
}

pub(crate) async fn render_document_pages(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
    dpi: u32,
    font_size_delta_pt: Option<i16>,
    max_pages: Option<usize>,
    // When set, render ONLY this 1-based page (lazy/paged preview — the operator's
    // first page appears without rendering the whole document). `None` = render all
    // (capped by `max_pages`).
    only_page: Option<i32>,
) -> Result<Vec<PathBuf>, String> {
    let pdf_path = if doc_type.needs_libreoffice() {
        office_to_pdf_cached(input_path, task_dir, doc_type, font_size_delta_pt).await?
    } else {
        input_path.to_path_buf()
    };

    let render_dir = task_dir.join("preview-pages");
    tokio::fs::create_dir_all(&render_dir)
        .await
        .map_err(|e| format!("Cannot create preview render dir: {e}"))?;

    let rendered = ghostscript::render_pages(GsOptions {
        input_pdf: pdf_path,
        output_dir: render_dir,
        pages: only_page.map(|p| vec![p]),
        max_pages: if only_page.is_some() { None } else { max_pages },
        dpi,
        jpeg_quality: 92,
    })
    .await?;

    let pages: Vec<PathBuf> = rendered.into_iter().map(|page| page.file_path).collect();
    if pages.is_empty() {
        return Err("Document preview did not render any pages".to_string());
    }

    Ok(pages)
}

/// Time a converted office PDF stays in the shared cache before it is pruned.
const OFFICE_PDF_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);

/// Convert an office document (DOCX/XLSX/DOC/XLS) to PDF, reusing a cached PDF
/// when the same source content was already converted.
///
/// LibreOffice is the serialized bottleneck (see `libreoffice::SOFFICE_SEMAPHORE`),
/// and the coverage and preview handlers convert the *same* documents repeatedly
/// (on open, parameter changes, re-selection). Caching the converted PDF turns
/// those N conversions into one. The key is `sha256(source bytes) + font delta`,
/// so different content never collides and an edited document (different bytes)
/// is converted afresh. Page rendering and coverage analysis still run on every
/// call from the cached PDF — only the DOCX→PDF step is reused, so coverage/price
/// results are unchanged.
async fn office_to_pdf_cached(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
    font_size_delta_pt: Option<i16>,
) -> Result<PathBuf, String> {
    let bytes = tokio::fs::read(input_path)
        .await
        .map_err(|e| format!("Cannot read document for cache key: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hasher.update(font_size_delta_pt.unwrap_or(0).to_le_bytes());
    let key = format!("{:x}", hasher.finalize());
    drop(bytes);

    let cache_path = office_pdf_cache_dir().map(|dir| dir.join(format!("{key}.pdf")));

    // Fast path: cache hit without taking the per-key lock.
    if let Some(cached) = office_pdf_cache_hit(cache_path.as_deref()).await {
        tracing::info!(cache_key = %key, "Office→PDF cache hit");
        return Ok(cached);
    }

    // Single-flight: a concurrent preview + coverage of the SAME document would
    // otherwise both run LibreOffice (the serialized bottleneck). Serialize on the
    // content key so the document is converted once; the waiter then hits cache.
    let flight = office_pdf_flight_lock(&key);
    let guard = flight.lock().await;

    let outcome = if let Some(cached) = office_pdf_cache_hit(cache_path.as_deref()).await {
        tracing::info!(cache_key = %key, "Office→PDF cache hit (after single-flight wait)");
        Ok(cached)
    } else {
        office_convert_and_cache(
            input_path,
            task_dir,
            doc_type,
            font_size_delta_pt,
            cache_path,
            &key,
        )
        .await
    };

    drop(guard);
    office_pdf_flight_done(&key, flight);
    outcome
}

/// Returns the cached PDF path if present, refreshing its mtime so an actively
/// reused document is kept alive (not pruned out from under a concurrent reader).
async fn office_pdf_cache_hit(cache_path: Option<&Path>) -> Option<PathBuf> {
    let cached = cache_path?;
    if !tokio::fs::try_exists(cached).await.unwrap_or(false) {
        return None;
    }
    if let Ok(file) = std::fs::File::open(cached) {
        let _ = file.set_modified(SystemTime::now());
    }
    Some(cached.to_path_buf())
}

/// Convert the office document to PDF and publish it into the shared cache.
async fn office_convert_and_cache(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
    font_size_delta_pt: Option<i16>,
    cache_path: Option<PathBuf>,
    key: &str,
) -> Result<PathBuf, String> {
    let conversion_input =
        prepare_office_document_for_conversion(input_path, task_dir, doc_type, font_size_delta_pt)
            .await?;
    let pdf_path = libreoffice::convert_to_pdf(&conversion_input, task_dir).await?;

    if let Some(cached) = cache_path {
        match publish_pdf_to_cache(&pdf_path, &cached).await {
            Ok(()) => {
                // Prune in the background so cache housekeeping never blocks the
                // conversion response.
                if let Some(parent) = cached.parent() {
                    let parent = parent.to_path_buf();
                    tokio::spawn(async move { prune_office_pdf_cache(&parent).await });
                }
                tracing::info!(cache_key = %key, "Office→PDF converted and cached");
                return Ok(cached);
            }
            // Best-effort: on any cache failure keep the freshly-converted file.
            Err(e) => tracing::warn!(cache_key = %key, error = %e, "Office→PDF cache store skipped"),
        }
    }
    Ok(pdf_path)
}

/// Per-content-key conversion locks backing the single-flight in
/// `office_to_pdf_cached`. Entries are removed once the last waiter is done, so
/// the map stays bounded.
static OFFICE_PDF_FLIGHT: LazyLock<StdMutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

fn office_pdf_flight_lock(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = OFFICE_PDF_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn office_pdf_flight_done(key: &str, flight: Arc<tokio::sync::Mutex<()>>) {
    drop(flight);
    let mut map = OFFICE_PDF_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    // Only the map itself still references the lock → no other waiter; drop it.
    if let Some(existing) = map.get(key)
        && Arc::strong_count(existing) == 1
    {
        map.remove(key);
    }
}

#[cfg(test)]
fn office_pdf_flight_contains(key: &str) -> bool {
    OFFICE_PDF_FLIGHT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains_key(key)
}

/// Shared, persistent cache dir for converted office PDFs. Returns `None` if no
/// writable location is available (caller then falls back to no caching).
fn office_pdf_cache_dir() -> Option<PathBuf> {
    for base in ["/var/lib/print-conversions", "/tmp"] {
        let dir = Path::new(base).join("office-pdf-cache");
        if std::fs::create_dir_all(&dir).is_ok() && is_dir_writable(&dir) {
            return Some(dir);
        }
    }
    None
}

/// Atomically copy a freshly-converted PDF into the cache (temp file + rename),
/// so a concurrent reader never observes a partially-written file.
async fn publish_pdf_to_cache(src: &Path, dst: &Path) -> Result<(), String> {
    let tmp = dst.with_extension(format!("pdf.tmp-{}", Uuid::new_v4()));
    tokio::fs::copy(src, &tmp)
        .await
        .map_err(|e| format!("copy to cache tmp failed: {e}"))?;
    match tokio::fs::rename(&tmp, dst).await {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(format!("cache rename failed: {e}"))
        }
    }
}

/// Best-effort removal of cached PDFs older than `OFFICE_PDF_CACHE_TTL`, to keep
/// the cache directory bounded.
async fn prune_office_pdf_cache(dir: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let now = SystemTime::now();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("pdf") {
            continue;
        }
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        let too_old = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|age| age > OFFICE_PDF_CACHE_TTL)
            .unwrap_or(false);
        if too_old {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
}

pub(crate) async fn prepare_office_document_for_conversion(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
    font_size_delta_pt: Option<i16>,
) -> Result<PathBuf, String> {
    let delta = font_size_delta_pt.unwrap_or(0);
    if delta >= 0 {
        return Ok(input_path.to_path_buf());
    }

    match doc_type {
        DocumentType::Docx => {
            let adjusted_path = task_dir.join("source-font-adjusted.docx");
            docx_font::apply_font_size_delta(input_path, &adjusted_path, delta)?;
            tracing::info!(
                input = %input_path.display(),
                output = %adjusted_path.display(),
                delta_pt = delta,
                "Applied DOCX font size delta before PDF conversion"
            );
            Ok(adjusted_path)
        }
        DocumentType::Doc => {
            let docx_path = libreoffice::convert_to_docx(input_path, task_dir).await?;
            let adjusted_path = task_dir.join("source-font-adjusted.docx");
            docx_font::apply_font_size_delta(&docx_path, &adjusted_path, delta)?;
            tracing::info!(
                input = %input_path.display(),
                intermediate = %docx_path.display(),
                output = %adjusted_path.display(),
                delta_pt = delta,
                "Converted DOC to DOCX and applied font size delta before PDF conversion"
            );
            Ok(adjusted_path)
        }
        _ => {
            tracing::warn!(
                source_type = %doc_type,
                delta_pt = delta,
                "Ignoring font size delta for non-Word document"
            );
            Ok(input_path.to_path_buf())
        }
    }
}

pub(crate) async fn inspect_office_font_stats(
    input_path: &Path,
    task_dir: &Path,
    doc_type: DocumentType,
) -> Result<Option<DocxFontStats>, String> {
    match doc_type {
        DocumentType::Docx => docx_font::inspect_font_sizes(input_path),
        DocumentType::Doc => {
            let docx_path = libreoffice::convert_to_docx(input_path, task_dir).await?;
            docx_font::inspect_font_sizes(&docx_path)
        }
        _ => Ok(None),
    }
}
