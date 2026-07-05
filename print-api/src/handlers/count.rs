use std::path::Path;

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::conversion::{
    count_document_pages, detect_file_type, extension_for_document_type,
};
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::source_file;

use super::coverage::{
    COVERAGE_TEMP_DIR, MAX_FILE_SIZE, normalize_coverage_font_size_delta, validate_file_url,
};

#[derive(Deserialize)]
pub struct CountPagesRequest {
    pub file_url: String,
    /// Влияет на пагинацию Word-документов (отрицательная дельта ужимает шрифт →
    /// меньше страниц). Для PDF/изображений игнорируется.
    pub font_size_delta_pt: Option<i16>,
}

/// POST /api/print/count-pages — быстрый универсальный подсчёт страниц документа.
///
/// Источник истины «N страниц» для цены печати, БЕЗ привязки к принтеру/формату/гейту
/// заливки. PDF считается мгновенно; office-документ конвертируется в PDF через общий
/// кэш (single-flight). Изображение → 1 страница. Провал подсчёта (битый/зашифрованный
/// PDF, провал LibreOffice) → 422 с `{success:false, error}` — фронт покажет «не удалось
/// определить число страниц» и потребует ручной диапазон, НЕ молчаливое ×1.
pub async fn count_pages_handler(
    State(state): State<AppState>,
    _claims: Claims,
    Json(body): Json<CountPagesRequest>,
) -> Result<Json<Value>> {
    if body.file_url.is_empty() {
        return Err(AppError::bad_request("file_url обязателен"));
    }

    validate_file_url(&body.file_url)?;

    let doc_type = detect_file_type(&body.file_url);

    // Изображение — всегда одна страница, без скачивания/рендера.
    if !doc_type.is_document() {
        return Ok(Json(count_pages_json(1, "image")));
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::internal(format!("HTTP client build failed: {e}")))?;
    let bytes = source_file::read_source_bytes(
        &state.config,
        &http_client,
        &body.file_url,
        MAX_FILE_SIZE as u64,
        "файл",
    )
    .await?;

    let font_delta = normalize_coverage_font_size_delta(body.font_size_delta_pt, doc_type)?;

    let task_dir = Path::new(COVERAGE_TEMP_DIR).join(Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&task_dir)
        .await
        .map_err(|e| AppError::internal(format!("Count temp dir error: {e}")))?;

    let count_result = async {
        let source_path =
            task_dir.join(format!("source.{}", extension_for_document_type(doc_type)));
        tokio::fs::write(&source_path, &bytes)
            .await
            .map_err(|e| format!("Count temp source write error: {e}"))?;

        count_document_pages(&source_path, &task_dir, doc_type, font_delta).await
    }
    .await;

    if let Err(err) = tokio::fs::remove_dir_all(&task_dir).await {
        tracing::debug!(
            path = %task_dir.display(),
            error = %err,
            "Count temp cleanup skipped"
        );
    }

    match count_result {
        Ok(page_count) => Ok(Json(count_pages_json(page_count, document_type_label(doc_type)))),
        Err(err) => {
            // Полный текст (gs stderr, причина LibreOffice) — только в лог; наружу generic.
            tracing::warn!(
                file_url = %body.file_url,
                error = %err,
                "count-pages failed to determine page count"
            );
            // 422: файл получен, но число страниц определить не удалось (битый/зашифр.
            // PDF, провал LibreOffice). Фронт обязан потребовать ручной диапазон, НЕ ×1.
            Err(AppError::Client(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Не удалось определить число страниц документа".to_string(),
            ))
        }
    }
}

/// Чистая сборка успешного ответа count-pages (без State/IO) — для тестируемости логики.
fn count_pages_json(page_count: i32, document_type: &str) -> Value {
    json!({
        "success": true,
        "page_count": page_count,
        "document_type": document_type,
    })
}

/// API-метка типа документа для ответа count-pages (PDF → "pdf", DOCX → "docx" и т.п.).
fn document_type_label(doc_type: crate::conversion::detect::DocumentType) -> &'static str {
    doc_type.api_label()
}

#[cfg(test)]
mod tests {
    use super::{count_pages_json, document_type_label};
    use crate::conversion::detect::detect_file_type;
    use serde_json::json;

    #[test]
    fn image_url_resolves_to_single_page_response() {
        // Логика хендлера: image-ветка (detect → не документ) отдаёт page_count:1 без IO.
        let doc_type = detect_file_type("https://svoefoto.ru/media/photo.jpg");
        assert!(!doc_type.is_document(), "jpg must be non-document");

        let body = count_pages_json(1, "image");
        assert_eq!(body["success"], json!(true));
        assert_eq!(body["page_count"], json!(1));
        assert_eq!(body["document_type"], json!("image"));
    }

    #[test]
    fn document_count_response_carries_real_page_count_and_label() {
        let pdf = detect_file_type("https://svoefoto.ru/media/doc.pdf");
        assert!(pdf.is_document());
        let body = count_pages_json(9, document_type_label(pdf));
        assert_eq!(body["page_count"], json!(9));
        assert_eq!(body["document_type"], json!("pdf"));

        let docx = detect_file_type("https://svoefoto.ru/media/doc.docx");
        assert_eq!(document_type_label(docx), "docx");
    }

    #[test]
    fn count_response_has_exactly_three_fields() {
        let body = count_pages_json(3, "pdf");
        let obj = body.as_object().expect("object");
        assert_eq!(obj.len(), 3, "success + page_count + document_type");
    }
}
