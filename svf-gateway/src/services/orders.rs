use crate::bridge::ExpressBridge;
use crate::proto::svf::common::v1::{Money, Pagination};
use crate::proto::svf::orders::v1::order_service_server::OrderService;
use crate::proto::svf::orders::v1::*;
use tonic::{Request, Response, Status};

pub struct OrdersServiceImpl {
    bridge: ExpressBridge,
}

impl OrdersServiceImpl {
    pub fn new(bridge: ExpressBridge) -> Self {
        Self { bridge }
    }
}

#[tonic::async_trait]
impl OrderService for OrdersServiceImpl {
    async fn get_order(
        &self,
        request: Request<GetOrderRequest>,
    ) -> Result<Response<GetOrderResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let order_id = clean_order_id(&req.order_id)?;
        let path = if looks_like_print_order_id(order_id) {
            format!("/api/orders/photo-print/track/{order_id}")
        } else {
            format!("/api/orders/{order_id}")
        };
        let val: serde_json::Value = self.bridge.proxy_get(&path, jwt.as_deref()).await?;
        Ok(Response::new(GetOrderResponse {
            order: Some(parse_order(&val)),
        }))
    }

    async fn get_my_orders(
        &self,
        request: Request<GetMyOrdersRequest>,
    ) -> Result<Response<GetMyOrdersResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let (page, limit) = req
            .pagination
            .as_ref()
            .map(|p| (p.page, p.limit))
            .unwrap_or((1, 20));
        let page = page.max(1);
        let limit = limit.clamp(1, 50);
        let offset = (page - 1) * limit;
        let status_filter = req.status_filter;
        let path = format!("/api/orders/my-history?limit={limit}&offset={offset}");
        let val: serde_json::Value = self.bridge.proxy_get(&path, jwt.as_deref()).await?;

        let data = envelope_data(&val);
        let orders_value = data
            .as_array()
            .map(|_| data)
            .or_else(|| data.get("orders"))
            .or_else(|| val.get("orders"))
            .unwrap_or(data);

        let mut orders: Vec<Order> = orders_value
            .as_array()
            .map(|arr| arr.iter().map(parse_order).collect())
            .unwrap_or_default();

        if status_filter != OrderStatus::Unspecified as i32 {
            orders.retain(|order| order.status == status_filter);
        }

        let total = if status_filter != OrderStatus::Unspecified as i32 {
            orders.len() as i32
        } else {
            json_i64(data, &["total"])
                .or_else(|| json_i64(&val, &["total"]))
                .unwrap_or(orders.len() as i64) as i32
        };

        Ok(Response::new(GetMyOrdersResponse {
            orders,
            pagination: Some(Pagination { page, limit, total }),
        }))
    }
}

fn extract_jwt<T>(req: &Request<T>) -> Option<String> {
    req.metadata()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(String::from)
}

fn clean_order_id(order_id: &str) -> Result<&str, Status> {
    let order_id = order_id.trim();
    if order_id.is_empty() || order_id.contains('/') || order_id.contains('?') {
        return Err(Status::invalid_argument("order_id is required"));
    }
    Ok(order_id)
}

fn looks_like_print_order_id(order_id: &str) -> bool {
    order_id.starts_with("SF-")
}

fn envelope_data(val: &serde_json::Value) -> &serde_json::Value {
    val.get("data").unwrap_or(val)
}

fn parse_order(val: &serde_json::Value) -> Order {
    let data = envelope_data(val);
    let order = data.get("order").unwrap_or(data);
    let id = json_string(order, &["id", "order_id", "orderId"]).unwrap_or_default();
    let order_number = json_string(order, &["order_number", "orderNumber"])
        .or_else(|| {
            if id.is_empty() {
                None
            } else {
                Some(id.clone())
            }
        })
        .unwrap_or_default();

    Order {
        id,
        order_number,
        user_id: json_string(
            order,
            &[
                "user_id",
                "userId",
                "client_id",
                "clientId",
                "contact_id",
                "contactId",
            ],
        )
        .unwrap_or_default(),
        status: parse_order_status(&json_string(order, &["status"]).unwrap_or_default()),
        payment_status: parse_payment_status(
            &json_string(order, &["payment_status", "paymentStatus"]).unwrap_or_default(),
        ),
        total: json_money(
            order,
            &[
                "total",
                "total_price",
                "totalPrice",
                "total_amount",
                "totalAmount",
                "amount",
            ],
        ),
        paid_amount: json_money(
            order,
            &["paid_amount", "paidAmount", "amount_paid", "amountPaid"],
        ),
        items: json_array(order, &["items"])
            .map(|arr| arr.iter().map(parse_order_item).collect())
            .unwrap_or_default(),
        timeline: data
            .get("status_history")
            .or_else(|| data.get("statusHistory"))
            .or_else(|| order.get("timeline"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(parse_timeline_entry).collect())
            .unwrap_or_default(),
        notes: json_string(order, &["notes", "comments", "comment"]).unwrap_or_default(),
        studio_slug: json_string(order, &["studio_slug", "studioSlug", "mode"]).unwrap_or_default(),
        created_at: None,
        updated_at: None,
    }
}

fn parse_order_item(val: &serde_json::Value) -> OrderItem {
    OrderItem {
        id: json_string(val, &["id"]).unwrap_or_default(),
        service_name: json_string(
            val,
            &[
                "service_name",
                "serviceName",
                "name",
                "format",
                "fileName",
                "file_name",
            ],
        )
        .unwrap_or_default(),
        service_slug: json_string(
            val,
            &["service_slug", "serviceSlug", "slug", "format", "mode"],
        )
        .unwrap_or_default(),
        quantity: json_i64(val, &["quantity"]).unwrap_or(1) as i32,
        price: json_money(val, &["price", "unit_price", "unitPrice", "subtotal"]),
        options: json_string_map(val.get("options").or_else(|| val.get("metadata"))),
    }
}

fn parse_timeline_entry(val: &serde_json::Value) -> OrderTimelineEntry {
    OrderTimelineEntry {
        id: json_string(val, &["id"]).unwrap_or_default(),
        status: json_string(val, &["status"]).unwrap_or_default(),
        description: json_string(val, &["description", "message", "label"]).unwrap_or_default(),
        actor_name: json_string(val, &["actor_name", "actorName", "actor"]).unwrap_or_default(),
        created_at: None,
    }
}

fn parse_order_status(value: &str) -> i32 {
    match value {
        "pending" | "pending_payment" | "new" => OrderStatus::Pending as i32,
        "confirmed" | "paid" => OrderStatus::Confirmed as i32,
        "processing" | "in_progress" | "in-progress" => OrderStatus::InProgress as i32,
        "retouching" => OrderStatus::Retouching as i32,
        "approval" | "awaiting_approval" => OrderStatus::Approval as i32,
        "printing" => OrderStatus::Printing as i32,
        "ready" => OrderStatus::Ready as i32,
        "completed" | "done" => OrderStatus::Completed as i32,
        "cancelled" | "canceled" => OrderStatus::Cancelled as i32,
        "refunded" => OrderStatus::Refunded as i32,
        _ => OrderStatus::Unspecified as i32,
    }
}

fn parse_payment_status(value: &str) -> i32 {
    match value {
        "unpaid" | "pending" | "pending_payment" => PaymentStatus::Unpaid as i32,
        "partial" | "partially_paid" => PaymentStatus::PartiallyPaid as i32,
        "paid" | "succeeded" | "completed" => PaymentStatus::Paid as i32,
        "refund_pending" => PaymentStatus::RefundPending as i32,
        "refunded" | "refund_completed" => PaymentStatus::RefundCompleted as i32,
        _ => PaymentStatus::Unspecified as i32,
    }
}

fn json_array<'a>(val: &'a serde_json::Value, keys: &[&str]) -> Option<&'a Vec<serde_json::Value>> {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|v| v.as_array()))
}

fn json_string(val: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        val.get(*key).and_then(|v| match v {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            serde_json::Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
    })
}

fn json_i64(val: &serde_json::Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        val.get(*key).and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
        })
    })
}

fn json_money(val: &serde_json::Value, keys: &[&str]) -> Option<Money> {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(value_to_kopecks))
        .map(|amount_kopecks| Money {
            amount_kopecks,
            currency: "RUB".to_string(),
        })
}

fn value_to_kopecks(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(|rubles| rubles * 100)
            .or_else(|| n.as_f64().map(|rubles| (rubles * 100.0).round() as i64)),
        serde_json::Value::String(s) => decimal_rubles_to_kopecks(s),
        _ => None,
    }
}

fn decimal_rubles_to_kopecks(value: &str) -> Option<i64> {
    let normalized = value.trim().replace(',', ".");
    if normalized.is_empty() {
        return None;
    }

    let sign = if normalized.starts_with('-') { -1 } else { 1 };
    let unsigned = normalized.trim_start_matches('-');
    let mut parts = unsigned.splitn(2, '.');
    let rubles = parts.next()?.parse::<i64>().ok()?;
    let fraction = parts.next().unwrap_or("");
    let mut fraction_digits = fraction
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(2)
        .collect::<String>();
    while fraction_digits.len() < 2 {
        fraction_digits.push('0');
    }
    let kopecks = fraction_digits.parse::<i64>().ok()?;

    Some(sign * (rubles * 100 + kopecks))
}

fn json_string_map(value: Option<&serde_json::Value>) -> std::collections::HashMap<String, String> {
    value
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, value)| value_to_string(value).map(|v| (key.clone(), v)))
                .collect()
        })
        .unwrap_or_default()
}

fn value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_photo_print_tracking_order() {
        let order = parse_order(&json!({
            "success": true,
            "order": {
                "order_id": "SF-TEST-001",
                "status": "processing",
                "payment_status": "paid",
                "total_price": "1234.50",
                "delivery_method": "pickup",
                "items": [
                    {
                        "id": "item-1",
                        "name": "10x15",
                        "quantity": 2,
                        "subtotal": "50.00",
                        "metadata": { "paper": "glossy" }
                    }
                ]
            },
            "status_history": [
                { "id": "h1", "status": "paid", "description": "Paid" }
            ]
        }));

        assert_eq!(order.id, "SF-TEST-001");
        assert_eq!(order.status, OrderStatus::InProgress as i32);
        assert_eq!(order.payment_status, PaymentStatus::Paid as i32);
        assert_eq!(order.total.unwrap().amount_kopecks, 123450);
        assert_eq!(
            order.items[0].options.get("paper"),
            Some(&"glossy".to_string())
        );
        assert_eq!(order.timeline.len(), 1);
    }

    #[test]
    fn maps_backend_status_values() {
        assert_eq!(
            parse_order_status("pending_payment"),
            OrderStatus::Pending as i32
        );
        assert_eq!(parse_order_status("ready"), OrderStatus::Ready as i32);
        assert_eq!(
            parse_payment_status("partially_paid"),
            PaymentStatus::PartiallyPaid as i32
        );
        assert_eq!(decimal_rubles_to_kopecks("10.5"), Some(1050));
    }
}
