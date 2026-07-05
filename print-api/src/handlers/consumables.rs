use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::middleware::auth::{Claims, has_permission};
use crate::models::consumable::*;

fn require_catalog(claims: &Claims) -> Result<()> {
    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }
    Ok(())
}

/// GET /api/print/consumables/stock
pub async fn list_stock(
    State(state): State<AppState>,
    Query(q): Query<ConsumableStockQuery>,
) -> Result<Json<Value>> {
    let stocks = if let Some(ref sid) = q.station_id {
        let station_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid station_id"))?;
        sqlx::query_as::<_, ConsumableStockRow>(
            r#"SELECT cs.*, bd.name AS station_name
               FROM consumable_stock cs
               LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
               WHERE cs.station_id = $1
               ORDER BY cs.consumable_type"#,
        )
        .bind(station_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, ConsumableStockRow>(
            r#"SELECT cs.*, bd.name AS station_name
               FROM consumable_stock cs
               LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
               ORDER BY cs.station_id, cs.consumable_type"#,
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "stocks": stocks })))
}

/// POST /api/print/consumables/stock
pub async fn create_stock(
    State(state): State<AppState>,
    claims: Claims,
    Json(body): Json<CreateConsumableStockDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.consumable_type.is_empty() {
        return Err(AppError::bad_request("consumable_type обязателен"));
    }
    let station_uuid = Uuid::parse_str(&body.station_id)
        .map_err(|_| AppError::bad_request("Invalid station_id"))?;

    let stock = sqlx::query_as::<_, ConsumableStockRow>(
        r#"INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold, cost_per_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *, NULL::text AS station_name"#,
    )
    .bind(station_uuid)
    .bind(&body.consumable_type)
    .bind(body.current_amount.unwrap_or(0.0))
    .bind(body.max_capacity)
    .bind(body.unit.as_deref().unwrap_or("ml"))
    .bind(body.low_threshold)
    .bind(body.cost_per_unit)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "stock": stock })))
}

/// PUT /api/print/consumables/stock/:id
pub async fn update_stock(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateConsumableStockDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    let mut tx = state.db.begin().await?;

    if let Some(v) = body.current_amount {
        sqlx::query(
            "UPDATE consumable_stock SET current_amount = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.max_capacity {
        sqlx::query(
            "UPDATE consumable_stock SET max_capacity = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.low_threshold {
        sqlx::query(
            "UPDATE consumable_stock SET low_threshold = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(v) = body.cost_per_unit {
        sqlx::query(
            "UPDATE consumable_stock SET cost_per_unit = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(v)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let stock = sqlx::query_as::<_, ConsumableStockRow>(
        r#"SELECT cs.*, bd.name AS station_name
           FROM consumable_stock cs
           LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
           WHERE cs.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Запас не найден: {id}")))?;

    Ok(Json(json!({ "success": true, "stock": stock })))
}

/// POST /api/print/consumables/stock/:id/refill
pub async fn refill(
    State(state): State<AppState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<RefillConsumableDto>,
) -> Result<Json<Value>> {
    require_catalog(&claims)?;
    if body.amount <= 0.0 {
        return Err(AppError::bad_request("amount должен быть > 0"));
    }

    let user_uuid = Uuid::parse_str(&claims.user_id).map_err(|_| AppError::Unauthorized)?;

    let mut tx = state.db.begin().await?;

    // Update stock level
    let result = sqlx::query(
        "UPDATE consumable_stock SET current_amount = current_amount + $1, last_refilled_at = NOW(), updated_at = NOW() WHERE id = $2"
    )
    .bind(body.amount)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Запас не найден: {id}")));
    }

    // Record transaction
    sqlx::query(
        r#"INSERT INTO consumable_transactions (stock_id, transaction_type, amount, notes, created_by)
           VALUES ($1, 'refill', $2, $3, $4)"#,
    )
    .bind(id)
    .bind(body.amount)
    .bind(&body.notes)
    .bind(user_uuid)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let stock = sqlx::query_as::<_, ConsumableStockRow>(
        r#"SELECT cs.*, bd.name AS station_name
           FROM consumable_stock cs
           LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
           WHERE cs.id = $1"#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "stock": stock })))
}

/// GET /api/print/consumables/transactions
pub async fn list_transactions(
    State(state): State<AppState>,
    Query(q): Query<ConsumableTransactionQuery>,
) -> Result<Json<Value>> {
    let limit = q.limit.unwrap_or(100).min(500);

    let transactions = if let Some(ref sid) = q.stock_id {
        let stock_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid stock_id"))?;
        sqlx::query_as::<_, ConsumableTransactionRow>(
            r#"SELECT * FROM consumable_transactions
               WHERE stock_id = $1
               ORDER BY created_at DESC
               LIMIT $2"#,
        )
        .bind(stock_uuid)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, ConsumableTransactionRow>(
            r#"SELECT * FROM consumable_transactions
               ORDER BY created_at DESC
               LIMIT $1"#,
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(
        json!({ "success": true, "transactions": transactions }),
    ))
}

/// GET /api/print/consumables/alerts — low stock alerts
pub async fn alerts(State(state): State<AppState>) -> Result<Json<Value>> {
    let stocks = sqlx::query_as::<_, ConsumableStockRow>(
        r#"SELECT cs.*, bd.name AS station_name
           FROM consumable_stock cs
           LEFT JOIN bridge_devices bd ON bd.id = cs.station_id
           WHERE cs.low_threshold IS NOT NULL AND cs.current_amount <= cs.low_threshold
           ORDER BY cs.current_amount, cs.station_id"#,
    )
    .fetch_all(&state.db)
    .await?;

    let alerts: Vec<Value> = stocks
        .iter()
        .map(|s| {
            let percent = s
                .max_capacity
                .filter(|&max| max > 0.0)
                .map(|max| (s.current_amount / max * 100.0 * 10.0).round() / 10.0);
            json!({
                "id": s.id,
                "station_id": s.station_id,
                "station_name": s.station_name,
                "consumable_type": s.consumable_type,
                "current_amount": s.current_amount,
                "low_threshold": s.low_threshold,
                "max_capacity": s.max_capacity,
                "unit": s.unit,
                "percent_remaining": percent,
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "alerts": alerts })))
}

// ─── Forecast ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ForecastQuery {
    pub studio_id: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct TelemetryPoint {
    printer_id: Uuid,
    supplies: Option<serde_json::Value>,
    collected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct PrinterInfo {
    id: Uuid,
    name: String,
}

#[derive(Debug, Serialize)]
struct SupplyForecast {
    name: String,
    color: String,
    current_level: f64,
    daily_usage: f64,
    days_remaining: Option<i32>,
    estimated_empty_date: Option<String>,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct PrinterForecast {
    printer_id: Uuid,
    printer_name: String,
    supplies: Vec<SupplyForecast>,
}

/// GET /api/print/consumables/forecast — predict when supplies run out
pub async fn forecast(
    State(state): State<AppState>,
    claims: Claims,
    Query(q): Query<ForecastQuery>,
) -> Result<Json<Value>> {
    let studio_id = q.studio_id.as_deref().or(claims.studio_id.as_deref());

    // Get telemetry history for last 14 days
    let points = if let Some(sid) = studio_id {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query_as::<_, TelemetryPoint>(
            r#"SELECT pt.printer_id, pt.supplies, pt.collected_at
               FROM printer_telemetry pt
               JOIN printers p ON p.id = pt.printer_id
               WHERE pt.collected_at > NOW() - INTERVAL '14 days'
                 AND p.studio_id = $1
               ORDER BY pt.printer_id, pt.collected_at"#,
        )
        .bind(studio_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, TelemetryPoint>(
            r#"SELECT printer_id, supplies, collected_at
               FROM printer_telemetry
               WHERE collected_at > NOW() - INTERVAL '14 days'
               ORDER BY printer_id, collected_at"#,
        )
        .fetch_all(&state.db)
        .await?
    };

    // Get printer names
    let printers = if let Some(sid) = studio_id {
        let studio_uuid =
            Uuid::parse_str(sid).map_err(|_| AppError::bad_request("Invalid studio_id"))?;
        sqlx::query_as::<_, PrinterInfo>(
            "SELECT id, name FROM printers WHERE is_active = true AND studio_id = $1",
        )
        .bind(studio_uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, PrinterInfo>("SELECT id, name FROM printers WHERE is_active = true")
            .fetch_all(&state.db)
            .await?
    };

    let printer_names: std::collections::HashMap<Uuid, String> =
        printers.into_iter().map(|p| (p.id, p.name)).collect();

    // Group points by printer_id
    let mut by_printer: std::collections::HashMap<Uuid, Vec<&TelemetryPoint>> =
        std::collections::HashMap::new();
    for pt in &points {
        by_printer.entry(pt.printer_id).or_default().push(pt);
    }

    let mut forecasts: Vec<PrinterForecast> = Vec::new();

    for (printer_id, telemetry_points) in &by_printer {
        let printer_name = match printer_names.get(printer_id) {
            Some(n) => n.clone(),
            None => continue,
        };

        // Collect all supply names from the telemetry
        let mut supply_names: std::collections::HashSet<String> = std::collections::HashSet::new();
        for pt in telemetry_points {
            if let Some(ref supplies) = pt.supplies
                && let Some(obj) = supplies.as_object()
            {
                for key in obj.keys() {
                    supply_names.insert(key.clone());
                }
            }
        }

        let mut supply_forecasts: Vec<SupplyForecast> = Vec::new();

        for supply_name in &supply_names {
            // Collect daily minimum levels (smooth SNMP noise)
            let mut daily_min: std::collections::BTreeMap<String, f64> =
                std::collections::BTreeMap::new();

            for pt in telemetry_points {
                let level = pt
                    .supplies
                    .as_ref()
                    .and_then(|s| s.get(supply_name))
                    .and_then(|v| v.as_f64());
                let Some(level) = level else { continue };

                let day_key = pt.collected_at.format("%Y-%m-%d").to_string();
                let entry = daily_min.entry(day_key).or_insert(level);
                if level < *entry {
                    *entry = level;
                }
            }

            if daily_min.len() < 2 {
                continue;
            }

            // Linear regression: x = day index, y = level
            let values: Vec<f64> = daily_min.values().copied().collect();
            let n = values.len() as f64;
            let mut sum_x = 0.0;
            let mut sum_y = 0.0;
            let mut sum_xy = 0.0;
            let mut sum_xx = 0.0;
            for (i, &y) in values.iter().enumerate() {
                let x = i as f64;
                sum_x += x;
                sum_y += y;
                sum_xy += x * y;
                sum_xx += x * x;
            }
            let denom = n * sum_xx - sum_x * sum_x;
            if denom.abs() < 1e-10 {
                continue;
            }
            let slope = (n * sum_xy - sum_x * sum_y) / denom;

            let Some(current_level) = values.last().copied() else {
                tracing::warn!(supply = %supply_name, "Empty supply level data from SNMP — skipping prediction");
                continue;
            };
            let daily_usage = -slope; // positive means declining

            let (days_remaining, estimated_empty_date, status) = if slope < -0.1 {
                let days = (current_level / daily_usage).ceil() as i32;
                let days = days.max(0);
                let empty_date = chrono::Utc::now() + chrono::Duration::days(days as i64);
                let date_str = empty_date.format("%Y-%m-%d").to_string();
                let status = if days < 3 {
                    "critical"
                } else if days < 7 {
                    "warning"
                } else {
                    "ok"
                };
                (Some(days), Some(date_str), status)
            } else {
                // Stable or increasing — no depletion forecast
                (None, None, "ok")
            };

            let color = guess_supply_color(supply_name);

            supply_forecasts.push(SupplyForecast {
                name: pretty_supply_name(supply_name),
                color,
                current_level,
                daily_usage: (daily_usage * 10.0).round() / 10.0,
                days_remaining,
                estimated_empty_date,
                status,
            });
        }

        // Sort: critical first, then warning, then ok
        supply_forecasts.sort_by(|a, b| {
            let ord = |s: &str| match s {
                "critical" => 0,
                "warning" => 1,
                _ => 2,
            };
            ord(a.status).cmp(&ord(b.status)).then(
                a.days_remaining
                    .unwrap_or(999)
                    .cmp(&b.days_remaining.unwrap_or(999)),
            )
        });

        if !supply_forecasts.is_empty() {
            forecasts.push(PrinterForecast {
                printer_id: *printer_id,
                printer_name,
                supplies: supply_forecasts,
            });
        }
    }

    Ok(Json(json!({ "success": true, "forecasts": forecasts })))
}

fn pretty_supply_name(key: &str) -> String {
    match key {
        "ink_cyan" => "Cyan".into(),
        "ink_magenta" => "Magenta".into(),
        "ink_yellow" => "Yellow".into(),
        "ink_black" => "Black".into(),
        "ink_light_cyan" => "Lt Cyan".into(),
        "ink_light_magenta" => "Lt Magenta".into(),
        "toner_black" => "Тонер".into(),
        "toner_cyan" => "Cyan".into(),
        "toner_magenta" => "Magenta".into(),
        "toner_yellow" => "Yellow".into(),
        "drum" => "Барабан".into(),
        "waste_toner" => "Отработка".into(),
        _ => key.replace('_', " "),
    }
}

fn guess_supply_color(key: &str) -> String {
    if key.contains("cyan") {
        "#00bcd4".into()
    } else if key.contains("magenta") {
        "#e91e63".into()
    } else if key.contains("yellow") {
        "#ffeb3b".into()
    } else if key.contains("black") {
        "#424242".into()
    } else {
        "#9e9e9e".into()
    }
}
