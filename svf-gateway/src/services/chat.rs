use crate::bridge::ExpressBridge;
use crate::proto::svf::chat::v1::chat_service_server::ChatService;
use crate::proto::svf::chat::v1::*;
use crate::proto::svf::common::v1::{Money, Pagination};
use prost_types::Timestamp;
use serde_json::{Map, Value};
use tonic::{Request, Response, Status};

pub struct ChatServiceImpl {
    bridge: ExpressBridge,
}

impl ChatServiceImpl {
    pub fn new(bridge: ExpressBridge) -> Self {
        Self { bridge }
    }
}

#[tonic::async_trait]
impl ChatService for ChatServiceImpl {
    async fn get_current_session(
        &self,
        request: Request<GetCurrentSessionRequest>,
    ) -> Result<Response<GetCurrentSessionResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = if req.include_messages {
            "/api/chat/sessions/current".to_string()
        } else {
            "/api/chat/sessions/current?include_messages=false".to_string()
        };

        let val: Value = self.bridge.proxy_get(&path, jwt.as_deref()).await?;
        let data = envelope_data(&val);
        let session = data
            .get("conversation")
            .map(parse_chat_session)
            .ok_or_else(|| Status::internal("upstream response missing conversation"))?;

        let messages = json_array(data, &["messages"])
            .map(|arr| arr.iter().map(parse_incoming_message).collect())
            .unwrap_or_default();

        Ok(Response::new(GetCurrentSessionResponse {
            session: Some(session),
            messages,
        }))
    }

    async fn get_history(
        &self,
        request: Request<GetHistoryRequest>,
    ) -> Result<Response<GetHistoryResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let (page, limit) = req
            .pagination
            .as_ref()
            .map(|p| (p.page, p.limit))
            .unwrap_or((1, 50));

        let mut path = format!(
            "/api/chat/sessions/{}/messages?page={page}&limit={limit}",
            req.session_id
        );
        if !req.after_id.is_empty() {
            path.push_str(&format!("&after_id={}", req.after_id));
        }

        let val: Value = self.bridge.proxy_get(&path, jwt.as_deref()).await?;
        let data = envelope_data(&val);
        let messages: Vec<IncomingMessage> = json_array(data, &["messages"])
            .or_else(|| data.as_array())
            .map(|arr| arr.iter().map(parse_incoming_message).collect())
            .unwrap_or_default();

        Ok(Response::new(GetHistoryResponse {
            pagination: Some(Pagination {
                page,
                limit,
                total: data
                    .as_array()
                    .map(|arr| arr.len() as i32)
                    .or_else(|| json_i64(data, &["total"]).map(|value| value as i32))
                    .unwrap_or(messages.len() as i32),
            }),
            messages,
        }))
    }

    async fn send_message(
        &self,
        request: Request<SendMessageRequest>,
    ) -> Result<Response<SendMessageResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();

        let mut body = serde_json::json!({
            "content": req.content,
            "messageType": message_type_to_backend(req.message_type),
            "attachmentUrl": empty_as_null(&req.attachment_url),
            "clientMessageId": empty_as_null(&req.client_message_id),
            "replyToMessageId": empty_as_null(&req.reply_to_message_id),
        });

        if let Some(button) = req.button {
            body["isButtonClick"] = Value::Bool(true);
            body["buttonValue"] = Value::String(button.button_value);
            body["buttonData"] = serde_json::json!({
                "label": button.button_label,
            });
        }

        let path = format!("/api/chat/sessions/{}/messages", req.session_id);
        let val: Value = self
            .bridge
            .proxy_json("POST", &path, Some(&body), jwt.as_deref())
            .await?;
        let data = envelope_data(&val);

        Ok(Response::new(SendMessageResponse {
            message: data.get("message").map(parse_incoming_message),
            bot_response: data
                .get("botResponse")
                .or_else(|| data.get("bot_response"))
                .map(parse_incoming_message),
        }))
    }

    async fn mark_read(
        &self,
        request: Request<MarkReadRequest>,
    ) -> Result<Response<MarkReadResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = format!("/api/chat/sessions/{}/read", req.session_id);
        let val: Value = self
            .bridge
            .proxy_json("POST", &path, Some(&serde_json::json!({})), jwt.as_deref())
            .await?;
        let data = envelope_data(&val);

        Ok(Response::new(MarkReadResponse {
            read_count: json_i64(data, &["readCount", "read_count"]).unwrap_or(0) as i32,
        }))
    }

    async fn get_delivery_statuses(
        &self,
        request: Request<GetDeliveryStatusesRequest>,
    ) -> Result<Response<GetDeliveryStatusesResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = format!("/api/chat/sessions/{}/delivery-statuses", req.session_id);
        let val: Value = self
            .bridge
            .proxy_json(
                "POST",
                &path,
                Some(&serde_json::json!({
                    "clientMessageIds": req.client_message_ids,
                })),
                jwt.as_deref(),
            )
            .await?;
        let data = envelope_data(&val);
        let statuses = data
            .as_array()
            .map(|arr| arr.iter().map(parse_client_message_status).collect())
            .unwrap_or_default();

        Ok(Response::new(GetDeliveryStatusesResponse { statuses }))
    }

    async fn start_chat_upload(
        &self,
        request: Request<StartChatUploadRequest>,
    ) -> Result<Response<StartChatUploadResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = format!("/api/chat/sessions/{}/upload/presign", req.session_id);
        let body = build_start_chat_upload_body(&req);
        let val: Value = self
            .bridge
            .proxy_json("POST", &path, Some(&body), jwt.as_deref())
            .await?;
        let data = envelope_data(&val);
        let uploads = json_array(data, &["uploads"])
            .map(|arr| arr.iter().map(parse_chat_presigned_upload).collect())
            .unwrap_or_default();

        Ok(Response::new(StartChatUploadResponse { uploads }))
    }

    async fn complete_chat_upload(
        &self,
        request: Request<CompleteChatUploadRequest>,
    ) -> Result<Response<CompleteChatUploadResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = format!("/api/chat/sessions/{}/upload/complete", req.session_id);
        let body = build_complete_chat_upload_body(&req);
        let val: Value = self
            .bridge
            .proxy_json("POST", &path, Some(&body), jwt.as_deref())
            .await?;

        Ok(Response::new(parse_complete_chat_upload_response(
            envelope_data(&val),
        )))
    }

    async fn complete_chat_bundle_upload(
        &self,
        request: Request<CompleteChatBundleUploadRequest>,
    ) -> Result<Response<CompleteChatBundleUploadResponse>, Status> {
        let jwt = extract_jwt(&request);
        let req = request.into_inner();
        let path = format!(
            "/api/chat/sessions/{}/upload/complete-bundle",
            req.session_id
        );
        let body = build_complete_chat_bundle_upload_body(&req);
        let val: Value = self
            .bridge
            .proxy_json("POST", &path, Some(&body), jwt.as_deref())
            .await?;

        Ok(Response::new(parse_complete_chat_bundle_upload_response(
            envelope_data(&val),
        )))
    }
}

fn extract_jwt<T>(req: &Request<T>) -> Option<String> {
    req.metadata()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(String::from)
}

fn envelope_data(val: &Value) -> &Value {
    val.get("data").unwrap_or(val)
}

fn empty_as_null(value: &str) -> Value {
    if value.is_empty() {
        Value::Null
    } else {
        Value::String(value.to_string())
    }
}

fn build_start_chat_upload_body(req: &StartChatUploadRequest) -> Value {
    serde_json::json!({
        "files": req.files.iter().map(|file| {
            serde_json::json!({
                "fileName": file.file_name,
                "contentType": file.content_type,
                "fileSize": file.size_bytes,
            })
        }).collect::<Vec<_>>(),
    })
}

fn build_complete_chat_upload_body(req: &CompleteChatUploadRequest) -> Value {
    serde_json::json!({
        "files": build_completed_chat_upload_files(&req.files),
        "caption": empty_as_null(&req.caption),
        "suppressBot": req.suppress_bot,
    })
}

fn build_complete_chat_bundle_upload_body(req: &CompleteChatBundleUploadRequest) -> Value {
    serde_json::json!({
        "files": build_completed_chat_upload_files(&req.files),
        "orderConfig": build_bundle_order_config(req.order_config.as_ref()),
    })
}

fn build_completed_chat_upload_files(files: &[CompletedChatUploadFile]) -> Vec<Value> {
    files
        .iter()
        .map(|file| {
            serde_json::json!({
                "s3Key": file.s3_key,
                "fileName": file.file_name,
                "contentType": file.content_type,
                "fileSize": file.size_bytes,
            })
        })
        .collect()
}

fn build_bundle_order_config(order_config: Option<&BundleOrderConfig>) -> Value {
    let Some(order_config) = order_config else {
        return Value::Object(Map::new());
    };

    let mut object = Map::new();

    if !order_config.category_slug.is_empty() {
        object.insert(
            "categorySlug".to_string(),
            Value::String(order_config.category_slug.clone()),
        );
    }
    if !order_config.selected_doc.is_empty() {
        object.insert(
            "selectedDoc".to_string(),
            Value::String(order_config.selected_doc.clone()),
        );
    }
    if !order_config.selected_docs.is_empty() {
        object.insert(
            "selectedDocs".to_string(),
            Value::Array(
                order_config
                    .selected_docs
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if !order_config.customer_note.is_empty() {
        object.insert(
            "customerNote".to_string(),
            Value::String(order_config.customer_note.clone()),
        );
    }
    if !order_config.selected_options.is_empty() {
        object.insert(
            "selectedOptions".to_string(),
            Value::Array(
                order_config
                    .selected_options
                    .iter()
                    .map(|option| {
                        let mut item = Map::new();
                        item.insert(
                            "option_slug".to_string(),
                            Value::String(option.option_slug.clone()),
                        );
                        if option.quantity > 0 {
                            item.insert(
                                "quantity".to_string(),
                                Value::Number(serde_json::Number::from(option.quantity)),
                            );
                        }
                        Value::Object(item)
                    })
                    .collect(),
            ),
        );
    }
    if order_config.configurator_total > 0 {
        object.insert(
            "configuratorTotal".to_string(),
            Value::Number(serde_json::Number::from(order_config.configurator_total)),
        );
    }

    Value::Object(object)
}

fn message_type_to_backend(message_type: i32) -> &'static str {
    match MessageType::try_from(message_type).unwrap_or(MessageType::Text) {
        MessageType::Image => "image",
        MessageType::File => "file",
        MessageType::Interactive => "interactive",
        _ => "text",
    }
}

fn parse_chat_presigned_upload(val: &Value) -> ChatPresignedUpload {
    ChatPresignedUpload {
        s3_key: json_string(val, &["s3Key", "s3_key"]),
        upload_url: json_string(val, &["uploadUrl", "upload_url"]),
        content_type: json_string(val, &["contentType", "content_type"]),
    }
}

fn parse_complete_chat_upload_response(data: &Value) -> CompleteChatUploadResponse {
    let message = data.get("message").map(parse_incoming_message);
    let messages: Vec<IncomingMessage> = json_array(data, &["messages"])
        .map(|arr| arr.iter().map(parse_incoming_message).collect())
        .unwrap_or_default();
    let count = json_i64(data, &["count"]).unwrap_or_else(|| {
        if !messages.is_empty() {
            messages.len() as i64
        } else if message.is_some() {
            1
        } else {
            0
        }
    }) as i32;

    CompleteChatUploadResponse {
        message,
        messages,
        bot_response: data
            .get("botResponse")
            .or_else(|| data.get("bot_response"))
            .map(parse_incoming_message),
        count,
        attachment_url: json_string(data, &["attachmentUrl", "attachment_url"]),
    }
}

fn parse_complete_chat_bundle_upload_response(data: &Value) -> CompleteChatBundleUploadResponse {
    CompleteChatBundleUploadResponse {
        gallery_message: data
            .get("galleryMessage")
            .or_else(|| data.get("gallery_message"))
            .map(parse_incoming_message),
        bot_response: data
            .get("botResponse")
            .or_else(|| data.get("bot_response"))
            .map(parse_incoming_message),
        count: json_i64(data, &["count"]).unwrap_or(0) as i32,
        order_id: json_string(data, &["orderId", "order_id"]),
        order_total: data
            .get("orderTotal")
            .or_else(|| data.get("order_total"))
            .and_then(value_to_kopecks)
            .map(|amount_kopecks| Money {
                amount_kopecks,
                currency: "RUB".to_string(),
            }),
    }
}

fn parse_client_message_status(val: &Value) -> ClientMessageDeliveryStatus {
    ClientMessageDeliveryStatus {
        client_message_id: json_string(val, &["client_message_id", "clientMessageId"]),
        status: parse_delivery_status(&json_string(val, &["delivery_status", "deliveryStatus"])),
        delivered_at: parse_timestamp(val, &["delivered_at", "deliveredAt"]),
        read_at: parse_timestamp(val, &["read_at", "readAt"]),
    }
}

#[allow(deprecated)]
fn parse_chat_session(val: &Value) -> ChatSession {
    ChatSession {
        id: json_string(val, &["id"]),
        visitor_id: json_string(val, &["visitorId", "visitor_id"]),
        visitor_name: json_string(val, &["visitorName", "visitor_name"]),
        selected_service: json_string(val, &["selectedService", "selected_service"]),
        selected_price: json_i64(val, &["selectedPrice", "selected_price"]).unwrap_or(0) as i32,
        channel: json_string(val, &["channel"]),
        status: parse_session_status(&json_string(val, &["status"])),
        created_at: parse_timestamp(val, &["created_at", "createdAt"]),
        contact_id: json_string(val, &["contact_id", "contactId"]),
        unread_count: json_i64(val, &["unread_count", "unreadCount"]).unwrap_or(0) as i32,
        updated_at: parse_timestamp(val, &["updated_at", "updatedAt"]),
    }
}

fn parse_incoming_message(val: &Value) -> IncomingMessage {
    IncomingMessage {
        id: json_string(val, &["id"]),
        session_id: json_string(val, &["sessionId", "session_id", "conversation_id"]),
        sender_type: parse_sender_type(&json_string(val, &["senderType", "sender_type"])),
        sender_name: json_string(val, &["senderName", "sender_name"]),
        message_type: parse_message_type(&json_string(val, &["messageType", "message_type"])),
        content: json_string(val, &["content", "text"]),
        attachment_url: json_string(val, &["attachmentUrl", "attachment_url"]),
        interactive: parse_interactive_content(val),
        created_at: parse_timestamp(val, &["created_at", "createdAt"]),
        gallery_attachment_urls: parse_gallery_attachment_urls(val),
    }
}

fn parse_gallery_attachment_urls(val: &Value) -> Vec<String> {
    json_string_array(
        val.get("gallery_urls")
            .or_else(|| val.get("galleryUrls"))
            .or_else(|| {
                val.get("metadata")
                    .and_then(|metadata| metadata.get("gallery"))
            }),
    )
}

fn parse_interactive_content(val: &Value) -> Option<InteractiveContent> {
    let interactive = val.get("interactive").or_else(|| {
        val.get("metadata")
            .and_then(|metadata| metadata.get("interactive"))
    })?;

    let buttons = interactive["buttons"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|button| InteractiveButton {
                    label: json_string(button, &["label", "text"]),
                    value: json_string(button, &["value", "id"]),
                })
                .collect()
        })
        .unwrap_or_default();

    Some(InteractiveContent {
        r#type: json_string(interactive, &["type", "kind"]),
        buttons,
    })
}

fn parse_sender_type(value: &str) -> i32 {
    match value {
        "visitor" | "client" | "customer" => SenderType::Visitor as i32,
        "operator" | "employee" | "admin" => SenderType::Operator as i32,
        "bot" | "system" => SenderType::Bot as i32,
        _ => SenderType::Unspecified as i32,
    }
}

fn parse_message_type(value: &str) -> i32 {
    match value {
        "image" | "photo" => MessageType::Image as i32,
        "file" | "document" => MessageType::File as i32,
        "interactive" | "buttons" => MessageType::Interactive as i32,
        "text" | "" => MessageType::Text as i32,
        _ => MessageType::Unspecified as i32,
    }
}

fn parse_delivery_status(value: &str) -> i32 {
    match value {
        "sent" => DeliveryStatus::Sent as i32,
        "delivered" => DeliveryStatus::Delivered as i32,
        "read" => DeliveryStatus::Read as i32,
        "failed" => DeliveryStatus::Failed as i32,
        _ => DeliveryStatus::Unspecified as i32,
    }
}

fn parse_session_status(value: &str) -> i32 {
    match value {
        "open" => SessionStatus::Open as i32,
        "waiting" => SessionStatus::Waiting as i32,
        "active" => SessionStatus::Active as i32,
        "resolved" => SessionStatus::Resolved as i32,
        "closed" => SessionStatus::Closed as i32,
        _ => SessionStatus::Unspecified as i32,
    }
}

fn json_array<'a>(val: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(|value| value.as_array()))
}

fn json_string(val: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| val.get(*key).and_then(value_to_string))
        .unwrap_or_default()
}

fn json_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|arr| arr.iter().filter_map(value_to_string).collect())
        .unwrap_or_default()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(string) => Some(string.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        _ => None,
    }
}

fn json_i64(val: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        val.get(*key).and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|string| string.parse::<i64>().ok()))
        })
    })
}

fn value_to_kopecks(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().map(|rubles| rubles * 100).or_else(|| {
            number
                .as_f64()
                .map(|rubles| (rubles * 100.0).round() as i64)
        }),
        Value::String(string) => decimal_rubles_to_kopecks(string),
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
        .filter(|char| char.is_ascii_digit())
        .take(2)
        .collect::<String>();
    while fraction_digits.len() < 2 {
        fraction_digits.push('0');
    }
    let kopecks = fraction_digits.parse::<i64>().ok()?;

    Some(sign * (rubles * 100 + kopecks))
}

fn parse_timestamp(val: &Value, keys: &[&str]) -> Option<Timestamp> {
    let _ = keys
        .iter()
        .find_map(|key| val.get(*key).and_then(|value| value.as_str()))?;

    // Keep the field empty until gateway-wide timestamp parsing is added.
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_gallery_urls_from_message_metadata() {
        let message = parse_incoming_message(&json!({
            "id": "msg-1",
            "conversation_id": "session-1",
            "sender_type": "visitor",
            "message_type": "text",
            "content": "gallery",
            "metadata": {
                "gallery": ["https://cdn/1.jpg", "https://cdn/2.jpg"]
            }
        }));

        assert_eq!(message.id, "msg-1");
        assert_eq!(message.gallery_attachment_urls.len(), 2);
        assert_eq!(message.gallery_attachment_urls[0], "https://cdn/1.jpg");
    }

    #[test]
    fn omits_empty_bundle_order_config_fields() {
        let config = BundleOrderConfig {
            category_slug: "photo-docs".to_string(),
            selected_doc: String::new(),
            selected_docs: vec!["passport".to_string()],
            customer_note: String::new(),
            selected_options: vec![BundleOrderSelectedOption {
                option_slug: "glossy".to_string(),
                quantity: 0,
            }],
            configurator_total: 0,
        };

        let payload = build_bundle_order_config(Some(&config));

        assert_eq!(payload["categorySlug"], "photo-docs");
        assert_eq!(payload["selectedDocs"][0], "passport");
        assert_eq!(payload["selectedOptions"][0]["option_slug"], "glossy");
        assert!(payload.get("selectedDoc").is_none());
        assert!(payload["selectedOptions"][0].get("quantity").is_none());
        assert!(payload.get("configuratorTotal").is_none());
    }

    #[test]
    fn parses_complete_chat_bundle_upload_response() {
        let response = parse_complete_chat_bundle_upload_response(&json!({
            "galleryMessage": {
                "id": "gallery-1",
                "conversation_id": "session-1",
                "sender_type": "visitor",
                "message_type": "text",
                "content": "uploaded",
                "metadata": {
                    "gallery": ["https://cdn/1.jpg"]
                }
            },
            "botResponse": {
                "id": "bot-1",
                "conversation_id": "session-1",
                "sender_type": "bot",
                "message_type": "interactive",
                "content": "done"
            },
            "count": 3,
            "orderId": "chat-session-1-1",
            "orderTotal": 1490
        }));

        assert_eq!(response.count, 3);
        assert_eq!(response.order_id, "chat-session-1-1");
        assert_eq!(response.order_total.unwrap().amount_kopecks, 149000);
        assert_eq!(
            response
                .gallery_message
                .as_ref()
                .unwrap()
                .gallery_attachment_urls[0],
            "https://cdn/1.jpg"
        );
    }
}
