use axum::Json;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::Claims;
use crate::models::analytics::{
    AnalyticsQuery, AnalyticsSummary, CreateWasteDto, OperatorAnalytics, PrinterAnalytics,
    UtilizationQuery,
};

/// GET /api/print/analytics/summary?from=&to=&studio_id=
pub async fn summary(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let row = sqlx::query_as::<_, SummaryRow>(
        r#"
        SELECT
            COUNT(*)::bigint AS total_jobs,
            COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
            COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
            COALESCE(SUM(copies)::bigint, 0) AS total_copies,
            COALESCE(SUM(price_total)::float8, 0) AS revenue,
            COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms > 0), 0)::float8 AS avg_duration_ms
        FROM print_jobs
        WHERE created_at >= $1::date
          AND created_at < ($2::date + interval '1 day')
          AND ($3::uuid IS NULL OR studio_id = $3::uuid)
        "#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_one(&state.db)
    .await?;

    // Waste sheets from print_waste_log
    let waste_sheets: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(sheets_wasted)::bigint, 0)
           FROM print_waste_log
           WHERE created_at >= $1::date
             AND created_at < ($2::date + interval '1 day')
             AND ($3::uuid IS NULL OR studio_id = $3::uuid)"#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_one(&state.db)
    .await?;

    let total = row.total_jobs.max(1) as f64;
    let summary = AnalyticsSummary {
        total_jobs: row.total_jobs,
        completed: row.completed,
        failed: row.failed,
        failure_rate: (row.failed as f64 / total * 100.0 * 10.0).round() / 10.0,
        total_copies: row.total_copies,
        revenue: row.revenue,
        avg_duration_ms: (row.avg_duration_ms * 10.0).round() / 10.0,
        waste_sheets,
    };

    Ok(Json(json!({ "success": true, "summary": summary })))
}

/// GET /api/print/analytics/by-printer?from=&to=&studio_id=
pub async fn by_printer(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let rows = sqlx::query_as::<_, PrinterRow>(
        r#"
        SELECT
            pj.printer_id::text AS printer_id,
            COALESCE(p.name, 'Unknown') AS printer_name,
            COUNT(*)::bigint AS total_jobs,
            COUNT(*) FILTER (WHERE pj.status = 'completed')::bigint AS completed,
            COUNT(*) FILTER (WHERE pj.status = 'failed')::bigint AS failed,
            COALESCE(SUM(pj.copies)::bigint, 0) AS copies,
            COALESCE(SUM(pj.price_total)::float8, 0) AS revenue
        FROM print_jobs pj
        LEFT JOIN printers p ON p.id = pj.printer_id
        WHERE pj.created_at >= $1::date
          AND pj.created_at < ($2::date + interval '1 day')
          AND ($3::uuid IS NULL OR pj.studio_id = $3::uuid)
        GROUP BY pj.printer_id, p.name
        ORDER BY total_jobs DESC
        "#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_all(&state.db)
    .await?;

    let printers: Vec<PrinterAnalytics> = rows
        .into_iter()
        .map(|r| PrinterAnalytics {
            printer_id: r.printer_id,
            printer_name: r.printer_name,
            total_jobs: r.total_jobs,
            completed: r.completed,
            failed: r.failed,
            copies: r.copies,
            revenue: r.revenue,
        })
        .collect();

    Ok(Json(json!({ "success": true, "printers": printers })))
}

/// GET /api/print/analytics/by-operator?from=&to=&studio_id=
pub async fn by_operator(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let rows = sqlx::query_as::<_, OperatorRow>(
        r#"
        SELECT
            pj.created_by::text AS operator_id,
            COALESCE(u.name, 'Unknown') AS operator_name,
            COUNT(*)::bigint AS total_jobs,
            COUNT(*) FILTER (WHERE pj.status = 'completed')::bigint AS completed,
            COUNT(*) FILTER (WHERE pj.status = 'failed')::bigint AS failed,
            COALESCE(SUM(pj.copies)::bigint, 0) AS copies,
            COALESCE(AVG(EXTRACT(EPOCH FROM (pj.completed_at - pj.created_at)) * 1000)
                FILTER (WHERE pj.status = 'completed'), 0)::float8 AS avg_speed_ms
        FROM print_jobs pj
        LEFT JOIN users u ON u.id = pj.created_by
        WHERE pj.created_at >= $1::date
          AND pj.created_at < ($2::date + interval '1 day')
          AND ($3::uuid IS NULL OR pj.studio_id = $3::uuid)
        GROUP BY pj.created_by, u.name
        ORDER BY total_jobs DESC
        "#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_all(&state.db)
    .await?;

    let operators: Vec<OperatorAnalytics> = rows
        .into_iter()
        .map(|r| OperatorAnalytics {
            operator_id: r.operator_id,
            operator_name: r.operator_name,
            total_jobs: r.total_jobs,
            completed: r.completed,
            failed: r.failed,
            copies: r.copies,
            avg_speed_ms: (r.avg_speed_ms * 10.0).round() / 10.0,
        })
        .collect();

    Ok(Json(json!({ "success": true, "operators": operators })))
}

/// GET /api/print/analytics/daily?from=&to=&studio_id=
pub async fn daily(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let rows = sqlx::query_as::<_, DailyRow>(
        r#"SELECT day, studio_id::text, total_jobs, completed_jobs, failed_jobs,
                  total_copies, total_sheets, revenue, avg_duration_ms,
                  waste_sheets, waste_cost
           FROM print_daily_summary
           WHERE day BETWEEN $1::date AND $2::date
             AND ($3::uuid IS NULL OR studio_id = $3::uuid)
           ORDER BY day"#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "daily": rows })))
}

/// GET /api/print/analytics/utilization?from=&to=&printer_id=
pub async fn utilization(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<UtilizationQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let rows = sqlx::query_as::<_, UtilizationRow>(
        r#"SELECT hour, printer_id::text, printer_name, jobs_count, pages_printed,
                  busy_minutes, idle_minutes, utilization_pct
           FROM printer_utilization_hourly
           WHERE hour BETWEEN $1::timestamptz AND ($2::date + interval '1 day')::timestamptz
             AND ($3::uuid IS NULL OR printer_id = $3::uuid)
           ORDER BY hour"#,
    )
    .bind(from)
    .bind(to)
    .bind(q.printer_id.as_deref())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "utilization": rows })))
}

/// GET /api/print/analytics/waste?from=&to=&studio_id=
pub async fn waste_list(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<serde_json::Value>> {
    let from = q.from.as_deref().unwrap_or("2000-01-01");
    let to = q.to.as_deref().unwrap_or("2099-12-31");

    let rows = sqlx::query_as::<_, WasteRow>(
        r#"SELECT id, waste_type, sheets_wasted, paper_size, media_type,
                  printer_id::text, studio_id::text, print_job_id::text,
                  reported_by::text, notes, cost_estimate, created_at
           FROM print_waste_log
           WHERE created_at >= $1::date
             AND created_at < ($2::date + interval '1 day')
             AND ($3::uuid IS NULL OR studio_id = $3::uuid)
           ORDER BY created_at DESC"#,
    )
    .bind(from)
    .bind(to)
    .bind(q.studio_id.as_deref())
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "waste": rows })))
}

/// POST /api/print/waste
pub async fn create_waste(
    claims: Claims,
    State(state): State<AppState>,
    Json(body): Json<CreateWasteDto>,
) -> Result<Json<serde_json::Value>> {
    let printer_id: Option<Uuid> = body.printer_id.as_deref().and_then(|s| s.parse().ok());
    let studio_id: Option<Uuid> = body.studio_id.as_deref().and_then(|s| s.parse().ok());
    let print_job_id: Option<Uuid> = body.print_job_id.as_deref().and_then(|s| s.parse().ok());
    let reported_by: Option<Uuid> = claims.user_id.parse().ok();

    let id: i64 = sqlx::query_scalar(
        r#"INSERT INTO print_waste_log
             (waste_type, sheets_wasted, paper_size, media_type, printer_id, studio_id, print_job_id, reported_by, notes, cost_estimate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id"#,
    )
    .bind(&body.waste_type)
    .bind(body.sheets_wasted)
    .bind(&body.paper_size)
    .bind(&body.media_type)
    .bind(printer_id)
    .bind(studio_id)
    .bind(print_job_id)
    .bind(reported_by)
    .bind(&body.notes)
    .bind(body.cost_estimate)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id })))
}

#[derive(Debug, Deserialize)]
pub struct CostForecastQuery {
    pub studio_id: Option<String>,
    pub days: Option<i32>,
}

/// GET /api/print/analytics/cost-forecast — 30/60/90-day consumable cost forecast
pub async fn cost_forecast(
    claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<CostForecastQuery>,
) -> Result<Json<serde_json::Value>> {
    let window_days = q.days.unwrap_or(30).clamp(7, 180);
    let studio_id = q.studio_id.as_deref().or(claims.studio_id.as_deref());
    let studio_uuid: Option<Uuid> = studio_id
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let rows = sqlx::query_as::<_, CostForecastRow>(
        r#"
        WITH usage_daily AS (
            SELECT
                ct.stock_id,
                (ct.created_at AT TIME ZONE 'Europe/Moscow')::date AS usage_day,
                SUM(ABS(ct.amount))::float8 AS daily_usage
            FROM consumable_transactions ct
            WHERE ct.transaction_type = 'usage'
              AND ct.created_at >= NOW() - ($2::int * INTERVAL '1 day')
            GROUP BY ct.stock_id, usage_day
        ),
        stock_usage AS (
            SELECT
                cs.id::text AS stock_id,
                cs.station_id::text AS station_id,
                COALESCE(NULLIF(bd.name, ''), bd.hostname, cs.station_id::text) AS station_name,
                cs.consumable_type,
                cs.unit,
                COALESCE(cs.cost_per_unit, 0)::float8 AS cost_per_unit,
                cs.current_amount::float8 AS current_amount,
                cs.max_capacity::float8 AS max_capacity,
                COALESCE(SUM(ud.daily_usage), 0)::float8 AS total_usage,
                (COALESCE(SUM(ud.daily_usage), 0)::float8 / $2::float8) AS avg_daily_usage
            FROM consumable_stock cs
            LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
            LEFT JOIN usage_daily ud ON ud.stock_id = cs.id
            WHERE ($1::uuid IS NULL OR bd.studio_id = $1::uuid)
            GROUP BY cs.id, cs.station_id, bd.name, bd.hostname, cs.consumable_type, cs.unit, cs.cost_per_unit, cs.current_amount, cs.max_capacity
        ),
        forecast AS (
            SELECT
                *,
                (avg_daily_usage * cost_per_unit * 30)::float8 AS monthly_cost,
                (avg_daily_usage * cost_per_unit * 60)::float8 AS cost_60d,
                (avg_daily_usage * cost_per_unit * 90)::float8 AS cost_90d,
                CASE
                    WHEN avg_daily_usage > 0 THEN (current_amount / avg_daily_usage)::float8
                    ELSE NULL::float8
                END AS days_remaining
            FROM stock_usage
        )
        SELECT
            stock_id,
            station_id,
            station_name,
            consumable_type,
            unit,
            cost_per_unit,
            current_amount,
            max_capacity,
            total_usage,
            avg_daily_usage,
            monthly_cost,
            cost_60d,
            cost_90d,
            days_remaining
        FROM forecast
        ORDER BY monthly_cost DESC, consumable_type ASC"#,
    )
    .bind(studio_uuid)
    .bind(window_days)
    .fetch_all(&state.db)
    .await?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "stock_id": r.stock_id,
                "station_id": r.station_id,
                "station_name": r.station_name,
                "consumable_type": r.consumable_type,
                "unit": r.unit,
                "cost_per_unit": round_money(r.cost_per_unit),
                "current_amount": round_quantity(r.current_amount),
                "max_capacity": r.max_capacity.map(round_quantity),
                "total_usage": round_quantity(r.total_usage),
                "avg_daily_usage": round_quantity(r.avg_daily_usage),
                "monthly_cost_30d": round_money(r.monthly_cost),
                "cost_60d": round_money(r.cost_60d),
                "quarterly_cost_90d": round_money(r.cost_90d),
                "days_remaining": r.days_remaining.map(round_quantity),
                "status": forecast_status(r.days_remaining),
            })
        })
        .collect();

    let total_monthly: f64 = rows.iter().map(|r| r.monthly_cost).sum();
    let total_60d: f64 = rows.iter().map(|r| r.cost_60d).sum();
    let total_quarterly: f64 = rows.iter().map(|r| r.cost_90d).sum();

    Ok(Json(json!({
        "success": true,
        "window_days": window_days,
        "forecast": items,
        "total_monthly": round_money(total_monthly),
        "total_60d": round_money(total_60d),
        "total_quarterly": round_money(total_quarterly),
    })))
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round_quantity(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn forecast_status(days_remaining: Option<f64>) -> &'static str {
    match days_remaining {
        Some(days) if days <= 7.0 => "critical",
        Some(days) if days <= 14.0 => "warning",
        Some(_) => "ok",
        None => "stable",
    }
}

// ─── CSV Export ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CsvExportQuery {
    pub date_from: String,
    pub date_to: String,
    pub studio_id: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct CsvRow {
    day: Option<chrono::NaiveDate>,
    printer_name: Option<String>,
    operator_name: Option<String>,
    status: String,
    copies: Option<i32>,
    paper_size: Option<String>,
    revenue: Option<f64>,
}

/// GET /api/print/analytics/export-csv?date_from=&date_to=&studio_id=
pub async fn export_csv(
    _claims: Claims,
    State(state): State<AppState>,
    Query(q): Query<CsvExportQuery>,
) -> Result<Response> {
    // Validate dates (simple length/format guard)
    if q.date_from.len() < 8 || q.date_to.len() < 8 {
        return Err(AppError::bad_request(
            "date_from и date_to обязательны (формат YYYY-MM-DD)",
        ));
    }

    let studio_uuid: Option<Uuid> = q
        .studio_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::bad_request("Invalid studio_id"))?;

    let rows = sqlx::query_as::<_, CsvRow>(
        r#"SELECT
             (pj.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
             p.name AS printer_name,
             COALESCE(u.display_name, u.name, 'N/A') AS operator_name,
             pj.status,
             pj.copies,
             pj.paper_size,
             COALESCE(pj.price_total, 0)::float8 AS revenue
           FROM print_jobs pj
           LEFT JOIN printers p ON p.id = pj.printer_id
           LEFT JOIN users u ON u.id = pj.created_by
           WHERE pj.created_at >= $1::date
             AND pj.created_at < ($2::date + interval '1 day')
             AND ($3::uuid IS NULL OR pj.studio_id = $3::uuid)
           ORDER BY pj.created_at DESC
           LIMIT 100000"#,
    )
    .bind(&q.date_from)
    .bind(&q.date_to)
    .bind(studio_uuid)
    .fetch_all(&state.db)
    .await?;

    // Build CSV with BOM for Excel compatibility
    let mut csv = String::from("\u{FEFF}");
    csv.push_str("Дата;Принтер;Оператор;Статус;Копий;Размер бумаги;Выручка\n");

    for r in &rows {
        let day = r
            .day
            .map(|d| d.format("%d.%m.%Y").to_string())
            .unwrap_or_default();
        let printer = r.printer_name.as_deref().unwrap_or("—");
        let operator = r.operator_name.as_deref().unwrap_or("N/A");
        let copies = r.copies.unwrap_or(0);
        let paper = r.paper_size.as_deref().unwrap_or("");
        let revenue = r.revenue.unwrap_or(0.0);
        csv.push_str(&format!(
            "{day};{printer};{operator};{};{copies};{paper};{revenue:.2}\n",
            r.status
        ));
    }

    let filename = format!("print-analytics-{}-{}.csv", q.date_from, q.date_to);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment; filename=\"export.csv\"")),
    );

    Ok((headers, csv).into_response())
}

// ─── Internal row types ─────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct SummaryRow {
    total_jobs: i64,
    completed: i64,
    failed: i64,
    total_copies: i64,
    revenue: f64,
    avg_duration_ms: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct PrinterRow {
    printer_id: String,
    printer_name: String,
    total_jobs: i64,
    completed: i64,
    failed: i64,
    copies: i64,
    revenue: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct OperatorRow {
    operator_id: String,
    operator_name: String,
    total_jobs: i64,
    completed: i64,
    failed: i64,
    copies: i64,
    avg_speed_ms: f64,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
struct DailyRow {
    day: chrono::NaiveDate,
    studio_id: Option<String>,
    total_jobs: i64,
    completed_jobs: i64,
    failed_jobs: i64,
    total_copies: i64,
    total_sheets: i64,
    revenue: f64,
    avg_duration_ms: f64,
    waste_sheets: i64,
    waste_cost: f64,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
struct UtilizationRow {
    hour: chrono::DateTime<chrono::Utc>,
    printer_id: Option<String>,
    printer_name: Option<String>,
    jobs_count: i64,
    pages_printed: i64,
    busy_minutes: f64,
    idle_minutes: f64,
    utilization_pct: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct CostForecastRow {
    stock_id: String,
    station_id: String,
    station_name: String,
    consumable_type: String,
    unit: String,
    cost_per_unit: f64,
    current_amount: f64,
    max_capacity: Option<f64>,
    total_usage: f64,
    avg_daily_usage: f64,
    monthly_cost: f64,
    cost_60d: f64,
    cost_90d: f64,
    days_remaining: Option<f64>,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
struct WasteRow {
    id: i64,
    waste_type: String,
    sheets_wasted: i32,
    paper_size: Option<String>,
    media_type: Option<String>,
    printer_id: Option<String>,
    studio_id: Option<String>,
    print_job_id: Option<String>,
    reported_by: Option<String>,
    notes: Option<String>,
    cost_estimate: Option<f64>,
    created_at: chrono::DateTime<chrono::Utc>,
}
