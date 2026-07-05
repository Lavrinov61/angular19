use std::path::{Path, PathBuf};

use axum::{
    Json,
    extract::{Path as AxumPath, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::AppState;
use crate::conversion::detect::DocumentType;
use crate::conversion::{
    count_document_pages, detect_file_type, extension_for_document_type,
    inspect_office_font_stats, render_document_pages,
};
use crate::cups::ppd::PrintableAreaMm;
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::source_file;

use super::coverage::{
    COVERAGE_TEMP_DIR, CoverageRequest, CoverageStats, MAX_FILE_SIZE, analyze_image_path,
    build_coverage_result, document_coverage_dpi, normalize_coverage_font_size_delta,
    printable_area_for_coverage, validate_file_url,
};

/// TTL снимка coverage-задачи в Redis. Дольше превью (120с): анализ многостраничного
/// документа A1/A0 может идти десятки секунд, плюс окно опроса фронтом.
const COVERAGE_JOB_TTL_SECONDS: usize = 600;

/// Клиентское сообщение об ошибке в `failed`-снимке. Внутренний текст (gs stderr, пути
/// ФС, причина LibreOffice) НЕ светим наружу через GET /status/:id — он идёт только в
/// `tracing`. Фронт по `failed` всё равно держит page_count и фикс-тир.
const COVERAGE_JOB_GENERIC_ERROR: &str = "Не удалось проанализировать заливку документа";

/// Префикс ключа снимка задачи в Redis: `print:coverage:{coverage_id}`.
fn coverage_job_key(coverage_id: &str) -> String {
    format!("print:coverage:{coverage_id}")
}

/// Контентно-адресуемый id задачи анализа заливки.
///
/// Тир/цена зависят от формата бумаги и принтера (печатная область, A4 vs A3), поэтому
/// в ключ входят paper_format, paper_size, printer_id, color_mode и font_delta — одинаковый
/// документ с теми же параметрами → один coverage_id → один анализ переиспользуется
/// (зеркалит `document_preview_cache_key`).
pub(crate) fn coverage_job_cache_key(body: &CoverageRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"coverage-job-v1\0");
    hasher.update(body.file_url.as_bytes());
    hasher.update([0u8]);
    hasher.update(body.paper_format.as_deref().unwrap_or("").as_bytes());
    hasher.update([0u8]);
    hasher.update(body.paper_size.as_deref().unwrap_or("").as_bytes());
    hasher.update([0u8]);
    hasher.update(
        body.printer_id
            .map(|id| id.to_string())
            .unwrap_or_default()
            .as_bytes(),
    );
    hasher.update([0u8]);
    hasher.update(body.color_mode.as_deref().unwrap_or("").as_bytes());
    hasher.update([0u8]);
    hasher.update(body.font_size_delta_pt.unwrap_or(0).to_le_bytes());
    format!("cov-{:x}", hasher.finalize())
}

/// Записать снимок состояния задачи в Redis (`SET ... EX 600`). Один писатель —
/// фоновая задача; каждый шаг освежает TTL.
async fn coverage_job_store(redis_url: &str, coverage_id: &str, snapshot: &Value) -> Result<()> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = coverage_job_key(coverage_id);
    let _: () = redis::cmd("SET")
        .arg(&key)
        .arg(snapshot.to_string())
        .arg("EX")
        .arg(COVERAGE_JOB_TTL_SECONDS)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis SET failed: {e}")))?;

    Ok(())
}

/// Прочитать текущий снимок задачи (None если ключа нет/истёк).
async fn coverage_job_peek(redis_url: &str, coverage_id: &str) -> Result<Option<String>> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = coverage_job_key(coverage_id);
    let value: Option<String> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis GET failed: {e}")))?;
    Ok(value)
}

/// Атомарно занять задачу: `SET key snapshot NX EX ttl`. `true` — заняли (этот запрос
/// запускает рендер), `false` — ключ уже есть (другой одновременный запрос занял первым).
///
/// Закрывает гонку check-then-act в [`start_coverage_job`]: без неё два одинаковых
/// запроса, пришедшие в одно окно, оба видели пустой GET и оба рендерили один документ
/// (наблюдалось 2 рендера 27 страниц с разницей ~7 мс). `SET NX` атомарен — рендер один.
async fn coverage_job_claim(redis_url: &str, coverage_id: &str, snapshot: &Value) -> Result<bool> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = coverage_job_key(coverage_id);
    // `SET ... NX` → "OK" (Some) если записали, nil (None) если ключ уже существовал.
    let set: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(snapshot.to_string())
        .arg("NX")
        .arg("EX")
        .arg(COVERAGE_JOB_TTL_SECONDS)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis SET NX failed: {e}")))?;
    Ok(set.is_some())
}

/// Удалить снимок задачи (для перезапуска `failed`, чтобы claim ниже смог занять ключ).
async fn coverage_job_delete(redis_url: &str, coverage_id: &str) -> Result<()> {
    let redis_client = redis::Client::open(redis_url)
        .map_err(|e| AppError::internal(format!("Redis error: {e}")))?;
    let mut conn = redis_client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| AppError::internal(format!("Redis connection failed: {e}")))?;

    let key = coverage_job_key(coverage_id);
    let _: () = redis::cmd("DEL")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("Redis DEL failed: {e}")))?;
    Ok(())
}

/// Снимок состояния «считаем страницы» — старт уже ответил, рендер не начат.
fn snapshot_counting(page_count: Option<i32>, doc_type: DocumentType) -> Value {
    json!({
        "stage": "counting",
        "page_count": page_count,
        "document_type": document_type_label(doc_type),
        "rendered": 0,
        "analyzed": 0,
    })
}

fn snapshot_rendering(page_count: i32, doc_type: DocumentType) -> Value {
    json!({
        "stage": "rendering",
        "page_count": page_count,
        "document_type": document_type_label(doc_type),
        "rendered": 0,
        "analyzed": 0,
    })
}

fn snapshot_analyzing(page_count: i32, doc_type: DocumentType, analyzed: usize) -> Value {
    json!({
        "stage": "analyzing",
        "page_count": page_count,
        "document_type": document_type_label(doc_type),
        "rendered": page_count,
        "analyzed": analyzed,
    })
}

fn snapshot_ready(page_count: i32, doc_type: DocumentType, result: Value) -> Value {
    json!({
        "stage": "ready",
        "page_count": page_count,
        "document_type": document_type_label(doc_type),
        "rendered": page_count,
        "analyzed": page_count,
        "result": result,
    })
}

fn snapshot_failed(page_count: Option<i32>, doc_type: DocumentType, error: &str) -> Value {
    json!({
        "stage": "failed",
        "page_count": page_count,
        "document_type": document_type_label(doc_type),
        "error": error,
    })
}

fn document_type_label(doc_type: DocumentType) -> &'static str {
    match doc_type {
        DocumentType::Raster => "image",
        document => document.api_label(),
    }
}

/// POST /api/print/analyze-coverage/start — запустить фоновый анализ заливки документа.
///
/// Возвращается мгновенно: validate → coverage_id → кэш-пик (готовый/в процессе снимок
/// переиспользуется; `failed` → перезапуск, P2-3) → SET counting → `tokio::spawn`
/// фоновой задачи (уже скачанные bytes передаются внутрь, документ не качается дважды).
/// Изображения сюда не приходят (фронт ветвит на старый sync `analyze`) — на всякий
/// случай возвращаем 400.
pub async fn start_coverage_job(
    State(state): State<AppState>,
    _claims: Claims,
    Json(body): Json<CoverageRequest>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() {
        return Err(AppError::bad_request("file_url обязателен"));
    }

    validate_file_url(&body.file_url)?;

    let Some(ref redis_url) = state.config.redis_url else {
        return Err(AppError::service_unavailable("Redis не настроен"));
    };

    let doc_type = detect_file_type(&body.file_url);
    if !doc_type.is_document() {
        return Err(AppError::bad_request(
            "Фоновый анализ заливки доступен только для документов",
        ));
    }

    let coverage_id = coverage_job_cache_key(&body);

    // Кэш-хит: если снимок есть и это НЕ провал — переиспользуем (фронт опросит status).
    // `failed` → перезапускаем заново, чтобы не залипнуть на 10 минут на старой ошибке.
    if let Some(existing) = coverage_job_peek(redis_url, &coverage_id).await? {
        let is_failed = serde_json::from_str::<Value>(&existing)
            .ok()
            .and_then(|v| v.get("stage").and_then(|s| s.as_str()).map(|s| s == "failed"))
            .unwrap_or(false);
        if !is_failed {
            return Ok(Json(json!({
                "success": true,
                "coverage_id": coverage_id,
                "status": "pending",
            })));
        }
        // Сносим failed-снимок, чтобы атомарный claim ниже смог занять ключ заново.
        coverage_job_delete(redis_url, &coverage_id).await?;
    }

    // Атомарно занимаем задачу ДО скачивания. Проигравший в гонке (другой одновременный
    // запрос уже занял этот coverage_id) — выходим, фронт опросит status того же id.
    // Так один документ рендерится ОДИН раз, а не N раз при дублирующих запросах.
    if !coverage_job_claim(redis_url, &coverage_id, &snapshot_counting(None, doc_type)).await? {
        return Ok(Json(json!({
            "success": true,
            "coverage_id": coverage_id,
            "status": "pending",
        })));
    }

    // Победитель готовит вход для фоновой задачи. При ошибке — пишем failed-снимок, чтобы
    // занятый ключ не залип на "counting" (фронт опрашивал бы его до 10-мин cap).
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;
    // Скачиваем bytes здесь, чтобы фоновая задача не качала документ повторно (P1-1).
    let prepared = async {
        let bytes = source_file::read_source_bytes(
            &state.config,
            &http_client,
            &body.file_url,
            MAX_FILE_SIZE as u64,
            "файл",
        )
        .await?;
        // Печатная область — резолвим в HTTP (нужен доступ к state/БД); фоновая задача
        // получает готовый результат, чтобы не зависеть от пула вне запроса.
        let printable_area = printable_area_for_coverage(&state, &body).await?;
        Ok::<_, AppError>((bytes, printable_area))
    }
    .await;

    let (bytes, printable_area) = match prepared {
        Ok(value) => value,
        Err(e) => {
            let _ = coverage_job_store(
                redis_url,
                &coverage_id,
                &snapshot_failed(None, doc_type, COVERAGE_JOB_GENERIC_ERROR),
            )
            .await;
            return Err(e);
        }
    };

    let redis_url = redis_url.clone();
    let coverage_id_for_task = coverage_id.clone();
    let state_for_task = state.clone();

    tokio::spawn(async move {
        if let Err(err) = run_coverage_job(
            &state_for_task,
            &redis_url,
            &coverage_id_for_task,
            &body,
            doc_type,
            bytes,
            printable_area,
        )
        .await
        {
            // Полный текст ошибки (gs stderr, пути ФС, причина LibreOffice) — только в лог.
            tracing::error!(
                coverage_id = %coverage_id_for_task,
                error = %err,
                "Coverage job failed"
            );
            // Не теряем page_count, если он уже успел записаться — фронт удержит цену по
            // фикс-тиру. Здесь его нет под рукой, поэтому пишем минимальный failed-снимок
            // с generic-сообщением (internal-текст наружу не светим).
            let snapshot = snapshot_failed(None, doc_type, COVERAGE_JOB_GENERIC_ERROR);
            let _ = coverage_job_store(&redis_url, &coverage_id_for_task, &snapshot).await;
        }
    });

    Ok(Json(json!({
        "success": true,
        "coverage_id": coverage_id,
        "status": "pending",
    })))
}

/// Фоновая задача анализа заливки: count → rendering → analyzing (per-page X/N) → ready.
/// На каждом шаге освежает снимок в Redis; ошибка → failed (с page_count, если успели).
#[allow(clippy::too_many_arguments)]
async fn run_coverage_job(
    state: &AppState,
    redis_url: &str,
    coverage_id: &str,
    body: &CoverageRequest,
    doc_type: DocumentType,
    bytes: Vec<u8>,
    printable_area: Option<PrintableAreaMm>,
) -> Result<()> {
    let task_dir = Path::new(COVERAGE_TEMP_DIR).join(Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&task_dir)
        .await
        .map_err(|e| AppError::internal(format!("Coverage job temp dir error: {e}")))?;

    // page_count держим вне async-блока, чтобы failed-снимок мог его сохранить.
    let mut known_page_count: Option<i32> = None;
    let result = run_coverage_job_inner(
        state,
        redis_url,
        coverage_id,
        body,
        doc_type,
        &bytes,
        printable_area,
        &task_dir,
        &mut known_page_count,
    )
    .await;

    if let Err(err) = tokio::fs::remove_dir_all(&task_dir).await {
        tracing::debug!(
            path = %task_dir.display(),
            error = %err,
            "Coverage job temp cleanup skipped"
        );
    }

    if let Err(ref err) = result {
        // Полный текст ошибки — только в лог; наружу (GET /status/:id) идёт generic.
        // page_count сохраняем, если успели посчитать — фронт удержит цену по фикс-тиру.
        tracing::warn!(
            coverage_id = %coverage_id,
            error = %err,
            "Coverage job stage failed"
        );
        let snapshot = snapshot_failed(known_page_count, doc_type, COVERAGE_JOB_GENERIC_ERROR);
        let _ = coverage_job_store(redis_url, coverage_id, &snapshot).await;
    }

    result
}

#[allow(clippy::too_many_arguments)]
async fn run_coverage_job_inner(
    state: &AppState,
    redis_url: &str,
    coverage_id: &str,
    body: &CoverageRequest,
    doc_type: DocumentType,
    bytes: &[u8],
    printable_area: Option<PrintableAreaMm>,
    task_dir: &Path,
    known_page_count: &mut Option<i32>,
) -> Result<()> {
    let source_path = task_dir.join(format!("source.{}", extension_for_document_type(doc_type)));
    tokio::fs::write(&source_path, bytes)
        .await
        .map_err(|e| AppError::internal(format!("Coverage job source write error: {e}")))?;

    let font_delta = normalize_coverage_font_size_delta(body.font_size_delta_pt, doc_type)?;

    // 1) Подсчёт страниц (для total прогресса). Тот же font_delta, что и рендер ниже (P1-2),
    //    чтобы N count совпадало с числом отрендеренных страниц.
    let page_count = count_document_pages(&source_path, task_dir, doc_type, font_delta)
        .await
        .map_err(|e| AppError::internal(format!("Coverage job page count failed: {e}")))?;
    *known_page_count = Some(page_count);
    coverage_job_store(redis_url, coverage_id, &snapshot_counting(Some(page_count), doc_type))
        .await?;

    let font_stats = inspect_office_font_stats(&source_path, task_dir, doc_type)
        .await
        .map_err(|e| AppError::internal(format!("Document font inspect failed: {e}")))?;

    // 2) Рендер всех страниц одним gs-процессом (быстро) — показываем как стадию rendering.
    coverage_job_store(redis_url, coverage_id, &snapshot_rendering(page_count, doc_type)).await?;
    let dpi = document_coverage_dpi(body);
    let rendered_pages: Vec<PathBuf> =
        render_document_pages(&source_path, task_dir, doc_type, dpi, font_delta, None, None)
            .await
            .map_err(|e| AppError::internal(format!("Document coverage render failed: {e}")))?;

    // 3) Анализ заливки постранично — точный X/N прогресс после каждой страницы.
    coverage_job_store(
        redis_url,
        coverage_id,
        &snapshot_analyzing(page_count, doc_type, 0),
    )
    .await?;

    let mut page_stats: Vec<CoverageStats> = Vec::with_capacity(rendered_pages.len());
    for (idx, path) in rendered_pages.iter().enumerate() {
        let path = path.clone();
        let area = printable_area.clone();
        let stats = tokio::task::spawn_blocking(move || analyze_image_path(&path, area.as_ref()))
            .await
            .map_err(|e| AppError::internal(format!("Ошибка анализа страницы документа: {e}")))??;
        page_stats.push(stats);
        coverage_job_store(
            redis_url,
            coverage_id,
            &snapshot_analyzing(page_count, doc_type, idx + 1),
        )
        .await?;
    }

    // 4) Финальный результат — тот же единый билдер, что и sync analyze (нулевое
    //    расхождение тира/цены).
    let result =
        build_coverage_result(state, body, &page_stats, font_stats.as_ref(), doc_type).await?;

    coverage_job_store(
        redis_url,
        coverage_id,
        &snapshot_ready(page_count, doc_type, result),
    )
    .await?;

    Ok(())
}

/// GET /api/print/analyze-coverage/status/:id — снимок состояния задачи (200 JSON / 404).
pub async fn get_coverage_job(
    State(state): State<AppState>,
    _claims: Claims,
    AxumPath(id): AxumPath<String>,
) -> std::result::Result<impl IntoResponse, AppError> {
    let Some(ref redis_url) = state.config.redis_url else {
        return Err(AppError::service_unavailable("Redis не настроен"));
    };

    match coverage_job_peek(redis_url, &id).await? {
        Some(snapshot) => Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            snapshot.into_bytes(),
        )),
        None => Err(AppError::not_found("Задача анализа не найдена или истекла")),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        COVERAGE_JOB_GENERIC_ERROR, coverage_job_cache_key, snapshot_analyzing, snapshot_counting,
        snapshot_failed, snapshot_ready,
    };
    use crate::conversion::detect::DocumentType;
    use serde_json::json;
    use uuid::Uuid;

    fn request(file_url: &str, paper_format: Option<&str>) -> super::CoverageRequest {
        super::CoverageRequest {
            file_url: file_url.to_string(),
            paper_format: paper_format.map(str::to_string),
            printer_id: None,
            paper_size: None,
            borderless: None,
            dpi: None,
            font_size_delta_pt: None,
            color_mode: None,
        }
    }

    #[test]
    fn cache_key_is_content_addressed_and_paper_sensitive() {
        let a4 = coverage_job_cache_key(&request("https://svoefoto.ru/a.pdf", Some("a4")));
        let a4_again = coverage_job_cache_key(&request("https://svoefoto.ru/a.pdf", Some("a4")));
        let a3 = coverage_job_cache_key(&request("https://svoefoto.ru/a.pdf", Some("a3")));
        let other = coverage_job_cache_key(&request("https://svoefoto.ru/b.pdf", Some("a4")));

        assert_eq!(a4, a4_again, "same input → same id");
        assert_ne!(a4, a3, "paper format changes tier → different id");
        assert_ne!(a4, other, "different file → different id");
        assert!(a4.starts_with("cov-"), "id prefixed with cov-");
    }

    #[test]
    fn cache_key_changes_with_printer_and_color_and_font_delta() {
        let base = request("https://svoefoto.ru/a.pdf", Some("a4"));
        let base_key = coverage_job_cache_key(&base);

        let mut with_printer = request("https://svoefoto.ru/a.pdf", Some("a4"));
        with_printer.printer_id = Some(Uuid::nil());
        assert_ne!(base_key, coverage_job_cache_key(&with_printer));

        let mut with_color = request("https://svoefoto.ru/a.pdf", Some("a4"));
        with_color.color_mode = Some("bw".to_string());
        assert_ne!(base_key, coverage_job_cache_key(&with_color));

        let mut with_font = request("https://svoefoto.ru/a.pdf", Some("a4"));
        with_font.font_size_delta_pt = Some(-2);
        assert_ne!(base_key, coverage_job_cache_key(&with_font));
    }

    #[test]
    fn analyzing_snapshot_reports_exact_progress() {
        let snapshot = snapshot_analyzing(9, DocumentType::Pdf, 6);
        assert_eq!(snapshot["stage"], json!("analyzing"));
        assert_eq!(snapshot["page_count"], json!(9));
        assert_eq!(snapshot["rendered"], json!(9));
        assert_eq!(snapshot["analyzed"], json!(6));
        assert_eq!(snapshot["document_type"], json!("pdf"));
    }

    #[test]
    fn failed_snapshot_preserves_page_count() {
        let snapshot = snapshot_failed(Some(9), DocumentType::Pdf, "boom");
        assert_eq!(snapshot["stage"], json!("failed"));
        assert_eq!(snapshot["page_count"], json!(9));
        assert_eq!(snapshot["error"], json!("boom"));
    }

    /// Контракт: ошибка ДО подсчёта страниц → page_count = null (фронт покажет «считаю»
    /// или потребует ручной диапазон, но НЕ ×1).
    #[test]
    fn failed_snapshot_before_count_has_null_page_count() {
        let snapshot = snapshot_failed(None, DocumentType::Pdf, COVERAGE_JOB_GENERIC_ERROR);
        assert_eq!(snapshot["stage"], json!("failed"));
        assert_eq!(snapshot["page_count"], json!(null));
        assert!(
            snapshot["page_count"].is_null(),
            "page_count must be null before count"
        );
    }

    /// Безопасность (P2): наружу в `failed`-снимок идёт ТОЛЬКО generic-текст — никаких
    /// gs stderr, путей ФС или причин LibreOffice. Полный текст логируется отдельно.
    #[test]
    fn failed_snapshot_uses_generic_error_message() {
        let snapshot = snapshot_failed(Some(5), DocumentType::Docx, COVERAGE_JOB_GENERIC_ERROR);
        let err = snapshot["error"].as_str().expect("error is string");
        assert_eq!(err, COVERAGE_JOB_GENERIC_ERROR);
        // Не должно содержать признаков внутренней утечки.
        assert!(!err.contains("gs "), "must not leak ghostscript stderr");
        assert!(!err.contains("/tmp"), "must not leak filesystem paths");
        assert!(!err.contains("/var/lib"), "must not leak filesystem paths");
        assert!(!err.contains("stderr"), "must not leak stderr label");
        assert!(!err.contains("exit"), "must not leak process exit details");
    }

    /// Стартовое состояние сразу после старта (рендер не начат). page_count может быть
    /// ещё неизвестен (None до count) или уже посчитан (Some).
    #[test]
    fn counting_snapshot_carries_optional_page_count() {
        let unknown = snapshot_counting(None, DocumentType::Pdf);
        assert_eq!(unknown["stage"], json!("counting"));
        assert_eq!(unknown["page_count"], json!(null));
        assert_eq!(unknown["rendered"], json!(0));
        assert_eq!(unknown["analyzed"], json!(0));
        assert_eq!(unknown["document_type"], json!("pdf"));

        let known = snapshot_counting(Some(9), DocumentType::Pdf);
        assert_eq!(known["stage"], json!("counting"));
        assert_eq!(known["page_count"], json!(9));
        assert_eq!(known["rendered"], json!(0));
        assert_eq!(known["analyzed"], json!(0));
    }

    #[test]
    fn ready_snapshot_carries_result() {
        let snapshot = snapshot_ready(3, DocumentType::Docx, json!({"coverage_percent": 12.0}));
        assert_eq!(snapshot["stage"], json!("ready"));
        assert_eq!(snapshot["page_count"], json!(3));
        assert_eq!(snapshot["analyzed"], json!(3));
        assert_eq!(snapshot["result"]["coverage_percent"], json!(12.0));
        assert_eq!(snapshot["document_type"], json!("docx"));
    }
}
