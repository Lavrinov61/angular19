use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;

#[derive(Debug, Deserialize)]
pub struct BillingQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub studio_id: Option<String>,
}

#[derive(sqlx::FromRow, serde::Serialize)]
struct CustomerBilling {
    customer_id: Option<uuid::Uuid>,
    job_count: i64,
    total_copies: i64,
    total_price: Option<bigdecimal::BigDecimal>,
}

/// GET /api/print/billing/by-customer — billing summary grouped by customer
pub async fn by_customer(
    State(state): State<AppState>,
    _claims: Claims,
    Query(q): Query<BillingQuery>,
) -> Result<Json<Value>> {
    let studio_uuid = q
        .studio_id
        .as_deref()
        .map(uuid::Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let mut conditions: Vec<String> = vec!["pj.status = 'completed'".to_string()];
    let mut param_idx = 1u32;

    if q.from.is_some() {
        conditions.push(format!("pj.completed_at >= ${param_idx}::timestamptz"));
        param_idx += 1;
    }
    if q.to.is_some() {
        conditions.push(format!(
            "pj.completed_at < (${param_idx}::date + interval '1 day')"
        ));
        param_idx += 1;
    }
    if studio_uuid.is_some() {
        conditions.push(format!("pj.studio_id = ${param_idx}::uuid"));
        param_idx += 1;
    }

    let _ = param_idx;
    let where_clause = format!("WHERE {}", conditions.join(" AND "));

    let query_str = format!(
        r#"SELECT
             pj.customer_id,
             COUNT(*) AS job_count,
             COALESCE(SUM(pj.copies), 0) AS total_copies,
             SUM(pj.price_total) AS total_price
           FROM print_jobs pj
           {where_clause}
           GROUP BY pj.customer_id
           ORDER BY total_price DESC NULLS LAST"#,
    );

    let mut query = sqlx::query_as::<_, CustomerBilling>(&query_str);
    if let Some(ref from) = q.from {
        query = query.bind(from);
    }
    if let Some(ref to) = q.to {
        query = query.bind(to);
    }
    if let Some(ref sid) = studio_uuid {
        query = query.bind(sid);
    }

    let rows = query.fetch_all(&state.db).await?;

    Ok(Json(json!({
        "success": true,
        "billing": rows,
        "total_customers": rows.len(),
    })))
}
