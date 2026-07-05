use axum::{
    Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::models::job::PrintJobRow;

/// GET /api/print/jobs/{id}/pages -- get conversion progress and child jobs
pub async fn get_pages(
    State(state): State<AppState>,
    _claims: Claims,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    // Verify the parent job exists
    let parent_exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM print_jobs WHERE id = $1)")
            .bind(id)
            .fetch_one(&state.db)
            .await?;

    if !parent_exists {
        return Err(AppError::not_found("Задание не найдено"));
    }

    // Fetch conversion task status
    let conv = sqlx::query_as::<_, ConversionStatus>(
        r#"SELECT
             ct.status AS conv_status,
             ct.total_pages,
             ct.converted_pages,
             ct.error_message AS conv_error
           FROM conversion_tasks ct
           WHERE ct.job_id = $1
           LIMIT 1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    // Fetch child jobs (one per converted page)
    let children = sqlx::query_as::<_, PrintJobRow>(
        r#"SELECT pj.*,
                  p.name AS printer_name,
                  p.printer_type,
                  u.display_name AS creator_name
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.parent_job_id = $1
           ORDER BY pj.page_number"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let conversion = match conv {
        Some(c) => json!({
            "status": c.conv_status,
            "total_pages": c.total_pages,
            "converted_pages": c.converted_pages,
            "error": c.conv_error,
        }),
        None => json!(null),
    };

    Ok(Json(json!({
        "success": true,
        "conversion": conversion,
        "pages": children,
    })))
}

#[derive(Debug, sqlx::FromRow)]
struct ConversionStatus {
    conv_status: String,
    total_pages: Option<i32>,
    converted_pages: Option<i32>,
    conv_error: Option<String>,
}
