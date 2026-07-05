//! INPAS DualConnector HTTP client for the PAX/INPAS payment terminal.
//!
//! DualConnector listens on localhost:9015 and accepts XML POST requests at
//! the service root. The response status is field 39: value 1 means success.

use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;

use encoding_rs::{Encoding, UTF_8};
use reqwest::StatusCode;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use tracing::{error, info, warn};

use crate::InpasConfig;

const DUALCONNECTOR_SALE_OPERATION: &str = "1";
const DUALCONNECTOR_REFUND_OPERATION: &str = "3";
const DUALCONNECTOR_TEST_OPERATION: &str = "26";
const DUALCONNECTOR_SETTLEMENT_OPERATION: &str = "59";
const DUALCONNECTOR_SUCCESS_CODE: &str = "1";
const DUALCONNECTOR_DEFAULT_CURRENCY: &str = "643";
const DUALCONNECTOR_TEST_PAYLOAD: &str = "0102030405060708090a0b0c0d0e0f10";
const DUALCONNECTOR_SETTLEMENT_TIMEOUT_MS: u64 = 600_000;
const DUALCONNECTOR_SETTLEMENT_HTTP_TIMEOUT_SECS: u64 = 660;

pub struct InpasClient {
    http: reqwest::Client,
    base_url: String,
    terminal_id: Option<String>,
    currency_code: String,
}

// ── Public result types ──

pub struct PaymentResult {
    pub success: bool,
    pub approval_code: String,
    pub rrn: String,
    pub card_mask: String,
    pub error_message: String,
}

pub struct SbpQrResult {
    pub success: bool,
    pub qr_data: String,
    pub qr_image_base64: String,
    pub error_message: String,
}

pub struct SbpStatusResult {
    pub paid: bool,
    pub error_message: String,
}

pub struct BankSettlementResult {
    pub success: bool,
    pub response_code: String,
    pub report_text: String,
    pub error_message: String,
}

#[derive(Debug, Default)]
struct DualConnectorResponse {
    fields: HashMap<String, String>,
    error_code: Option<String>,
    error_description: Option<String>,
}

impl DualConnectorResponse {
    fn field(&self, id: &str) -> Option<&str> {
        self.fields.get(id).map(String::as_str)
    }
}

impl InpasClient {
    pub fn new(config: &InpasConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .expect("Failed to create INPAS HTTP client");

        let terminal_id = non_empty_string(&config.terminal_id);
        let currency_code = non_empty_string(&config.currency_code)
            .unwrap_or_else(|| DUALCONNECTOR_DEFAULT_CURRENCY.to_owned());

        Self {
            http,
            base_url: config.url.clone(),
            terminal_id,
            currency_code,
        }
    }

    /// Card payment via INPAS DualConnector operation 1.
    pub async fn pay(
        &self,
        amount_kopecks: i64,
        order_id: &str,
        _description: &str,
    ) -> PaymentResult {
        if amount_kopecks <= 0 {
            return payment_failure("Payment amount must be > 0");
        }

        let Some(terminal_id) = self.terminal_id.as_deref() else {
            return payment_failure("INPAS terminal_id is not configured");
        };

        info!(
            amount_kopecks,
            order_id, terminal_id, "INPAS DualConnector sale request"
        );

        let fields = build_sale_fields_with_currency(
            amount_kopecks,
            terminal_id,
            &self.currency_code,
            &current_dualconnector_timestamp(),
        );
        let xml = build_dualconnector_request(&fields);

        match self.post_dualconnector_xml(xml).await {
            Ok(body) => {
                let result = parse_payment_response(&body);
                if result.success {
                    info!(
                        auth_code = %result.approval_code,
                        rrn = %result.rrn,
                        "INPAS DualConnector payment success"
                    );
                } else {
                    warn!(
                        error = %result.error_message,
                        "INPAS DualConnector payment failed"
                    );
                }
                result
            }
            Err(e) => {
                error!(error = %e, "INPAS DualConnector sale request error");
                payment_failure(format!("Connection error: {e}"))
            }
        }
    }

    /// Card refund via INPAS DualConnector operation 3, linked to the original
    /// acquiring operation by field 14 (RRN).
    pub async fn refund(&self, amount_kopecks: i64, rrn: &str) -> PaymentResult {
        if amount_kopecks <= 0 {
            return payment_failure("Refund amount must be > 0");
        }

        let original_rrn = rrn.trim();
        if original_rrn.is_empty() {
            return payment_failure("Original RRN is required for refund");
        }

        let Some(terminal_id) = self.terminal_id.as_deref() else {
            return payment_failure("INPAS terminal_id is not configured");
        };

        info!(
            amount_kopecks,
            original_rrn, terminal_id, "INPAS DualConnector refund request"
        );

        let fields = build_refund_fields_with_currency(
            amount_kopecks,
            terminal_id,
            &self.currency_code,
            &current_dualconnector_timestamp(),
            original_rrn,
        );
        let xml = build_dualconnector_request(&fields);

        match self.post_dualconnector_xml(xml).await {
            Ok(body) => {
                let result = parse_payment_response(&body);
                if result.success {
                    info!(
                        auth_code = %result.approval_code,
                        rrn = %result.rrn,
                        "INPAS DualConnector refund success"
                    );
                } else {
                    warn!(
                        error = %result.error_message,
                        "INPAS DualConnector refund failed"
                    );
                }
                result
            }
            Err(e) => {
                error!(error = %e, "INPAS DualConnector refund request error");
                payment_failure(format!("Connection error: {e}"))
            }
        }
    }

    /// SBP QR generation is not exposed by the configured DualConnector XML profile.
    pub async fn generate_sbp_qr(&self, amount_kopecks: i64, order_id: &str) -> SbpQrResult {
        warn!(
            amount_kopecks,
            order_id, "INPAS DualConnector SBP QR requested but is not configured"
        );
        SbpQrResult {
            success: false,
            qr_data: String::new(),
            qr_image_base64: String::new(),
            error_message: "INPAS DualConnector SBP QR is not configured".to_owned(),
        }
    }

    /// SBP status polling is not exposed by the configured DualConnector XML profile.
    pub async fn check_sbp_status(&self, order_id: &str) -> SbpStatusResult {
        warn!(
            order_id,
            "INPAS DualConnector SBP status requested but is not configured"
        );
        SbpStatusResult {
            paid: false,
            error_message: "INPAS DualConnector SBP status is not configured".to_owned(),
        }
    }

    /// Bank end-of-day reconciliation via INPAS DualConnector operation 59.
    pub async fn settle(&self) -> BankSettlementResult {
        let Some(terminal_id) = self.terminal_id.as_deref() else {
            return bank_settlement_failure("INPAS terminal_id is not configured");
        };

        info!(
            terminal_id,
            operation = DUALCONNECTOR_SETTLEMENT_OPERATION,
            "INPAS DualConnector bank settlement request"
        );

        let fields = build_settlement_fields(terminal_id);
        let xml = build_dualconnector_request_with_timeout(
            &fields,
            Some(DUALCONNECTOR_SETTLEMENT_TIMEOUT_MS),
        );

        match self
            .post_dualconnector_xml_with_timeout(
                xml,
                Some(Duration::from_secs(
                    DUALCONNECTOR_SETTLEMENT_HTTP_TIMEOUT_SECS,
                )),
            )
            .await
        {
            Ok(body) => {
                let result = parse_bank_settlement_response(&body);
                if result.success {
                    info!("INPAS DualConnector bank settlement success");
                } else {
                    warn!(
                        error = %result.error_message,
                        "INPAS DualConnector bank settlement failed"
                    );
                }
                result
            }
            Err(e) => {
                error!(error = %e, "INPAS DualConnector bank settlement request error");
                bank_settlement_failure(format!("Connection error: {e}"))
            }
        }
    }

    /// Health check for DualConnector and the configured terminal.
    pub async fn is_online(&self) -> bool {
        if let Some(terminal_id) = self.terminal_id.as_deref() {
            let fields = build_test_connection_fields_with_currency(
                terminal_id,
                &self.currency_code,
                &current_dualconnector_timestamp(),
            );
            let xml = build_dualconnector_request(&fields);

            return match self.post_dualconnector_xml(xml).await {
                Ok(body) => parse_test_connection_response(&body),
                Err(e) => {
                    warn!(error = %e, "INPAS DualConnector health check failed");
                    false
                }
            };
        }

        match self.http.get(self.endpoint_url()).send().await {
            Ok(resp) => resp.status().is_success() || resp.status() == StatusCode::NOT_FOUND,
            Err(e) => {
                warn!(error = %e, "INPAS DualConnector service health check failed");
                false
            }
        }
    }

    async fn post_dualconnector_xml(&self, xml: String) -> Result<String, String> {
        self.post_dualconnector_xml_with_timeout(xml, None).await
    }

    async fn post_dualconnector_xml_with_timeout(
        &self,
        xml: String,
        timeout: Option<Duration>,
    ) -> Result<String, String> {
        let mut request = self
            .http
            .post(self.endpoint_url())
            .header(CONTENT_TYPE, "text/xml; charset=UTF-8")
            .header(ACCEPT, "text/xml")
            .body(xml.into_bytes());

        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }

        let resp = request.send().await.map_err(|e| e.to_string())?;

        let status = resp.status();
        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body_bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let body = decode_dualconnector_body(&body_bytes, content_type.as_deref());

        if !status.is_success() {
            return Err(format!("HTTP {status}: {}", truncate_for_error(&body)));
        }

        Ok(body)
    }

    fn endpoint_url(&self) -> String {
        format!("{}/", self.base_url.trim_end_matches('/'))
    }
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

#[cfg(test)]
fn build_sale_fields(amount_kopecks: i64, terminal_id: &str) -> Vec<(&'static str, String)> {
    build_sale_fields_with_currency(
        amount_kopecks,
        terminal_id,
        DUALCONNECTOR_DEFAULT_CURRENCY,
        "20260518000000",
    )
}

fn build_sale_fields_with_currency(
    amount_kopecks: i64,
    terminal_id: &str,
    currency_code: &str,
    timestamp: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("00", amount_kopecks.to_string()),
        ("04", currency_code.to_owned()),
        ("21", timestamp.to_owned()),
        ("25", DUALCONNECTOR_SALE_OPERATION.to_owned()),
        ("27", terminal_id.to_owned()),
    ]
}

fn build_refund_fields_with_currency(
    amount_kopecks: i64,
    terminal_id: &str,
    currency_code: &str,
    timestamp: &str,
    rrn: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("00", amount_kopecks.to_string()),
        ("04", currency_code.to_owned()),
        ("14", rrn.trim().to_owned()),
        ("21", timestamp.to_owned()),
        ("25", DUALCONNECTOR_REFUND_OPERATION.to_owned()),
        ("27", terminal_id.to_owned()),
    ]
}

fn build_test_connection_fields_with_currency(
    terminal_id: &str,
    currency_code: &str,
    timestamp: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("00", "100".to_owned()),
        ("04", currency_code.to_owned()),
        ("21", timestamp.to_owned()),
        ("25", DUALCONNECTOR_TEST_OPERATION.to_owned()),
        ("26", " ".to_owned()),
        ("27", terminal_id.to_owned()),
        ("90", DUALCONNECTOR_TEST_PAYLOAD.to_owned()),
    ]
}

fn build_settlement_fields(terminal_id: &str) -> Vec<(&'static str, String)> {
    vec![
        ("25", DUALCONNECTOR_SETTLEMENT_OPERATION.to_owned()),
        ("27", terminal_id.to_owned()),
    ]
}

fn build_dualconnector_request(fields: &[(&str, String)]) -> String {
    build_dualconnector_request_with_timeout(fields, None)
}

fn build_dualconnector_request_with_timeout(
    fields: &[(&str, String)],
    timeout_ms: Option<u64>,
) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<request>\n");
    for (id, value) in fields {
        xml.push_str("  <field id=\"");
        xml.push_str(&xml_escape(id));
        xml.push_str("\">");
        xml.push_str(&xml_escape(value));
        xml.push_str("</field>\n");
    }
    if let Some(timeout_ms) = timeout_ms {
        xml.push_str("  <timeout>");
        xml.push_str(&timeout_ms.to_string());
        xml.push_str("</timeout>\n");
    }
    xml.push_str("</request>\n");
    xml
}

fn parse_payment_response(xml: &str) -> PaymentResult {
    let response = match parse_dualconnector_response(xml) {
        Ok(response) => response,
        Err(e) => return payment_failure(format!("Parse error: {e}")),
    };

    let status_code = response.field("39").map(str::to_owned);
    let response_text = response.field("19").map(str::to_owned);
    let error_description = response.error_description.clone();
    let error_code = response.error_code.clone();

    let ok = status_code.as_deref() == Some(DUALCONNECTOR_SUCCESS_CODE);
    let error_message = if ok {
        String::new()
    } else {
        response_text
            .or(error_description)
            .or_else(|| error_code.map(|code| format!("Error {code}")))
            .or_else(|| status_code.map(|code| format!("Error {code}")))
            .unwrap_or_else(|| "Payment failed".to_owned())
    };

    PaymentResult {
        success: ok,
        approval_code: response.field("13").unwrap_or_default().to_owned(),
        rrn: response.field("14").unwrap_or_default().to_owned(),
        card_mask: mask_card_value(response.field("10").unwrap_or_default()),
        error_message,
    }
}

fn parse_test_connection_response(xml: &str) -> bool {
    parse_dualconnector_response(xml)
        .ok()
        .and_then(|response| response.field("39").map(str::to_owned))
        .as_deref()
        == Some(DUALCONNECTOR_SUCCESS_CODE)
}

fn parse_bank_settlement_response(xml: &str) -> BankSettlementResult {
    let response = match parse_dualconnector_response(xml) {
        Ok(response) => response,
        Err(e) => return bank_settlement_failure(format!("Parse error: {e}")),
    };

    let status_code = response.field("39").map(str::to_owned);
    let response_code = response
        .field("15")
        .map(str::to_owned)
        .or_else(|| status_code.clone())
        .unwrap_or_default();
    let response_text = response.field("19").map(str::to_owned);
    let report_text = clean_dualconnector_report(response.field("90").unwrap_or_default());
    let error_description = response.error_description.clone();
    let error_code = response.error_code.clone();

    let ok = status_code.as_deref() == Some(DUALCONNECTOR_SUCCESS_CODE);
    let error_message = if ok {
        String::new()
    } else {
        response_text
            .or(error_description)
            .or_else(|| error_code.map(|code| format!("Error {code}")))
            .or_else(|| status_code.map(|code| format!("Error {code}")))
            .unwrap_or_else(|| "Bank settlement failed".to_owned())
    };

    BankSettlementResult {
        success: ok,
        response_code,
        report_text,
        error_message,
    }
}

fn parse_dualconnector_response(xml: &str) -> Result<DualConnectorResponse, String> {
    let document = roxmltree::Document::parse(xml).map_err(|e| e.to_string())?;
    let mut response = DualConnectorResponse::default();

    for node in document
        .descendants()
        .filter(|node| node.has_tag_name("field"))
    {
        if let Some(id) = node.attribute("id") {
            response.fields.insert(
                id.trim().to_owned(),
                node.text().unwrap_or_default().trim().to_owned(),
            );
        }
    }

    response.error_code = first_text(&document, "errorcode");
    response.error_description = first_text(&document, "errordescription");

    Ok(response)
}

fn clean_dualconnector_report(value: &str) -> String {
    let mut text = value.trim();
    if let Some(stripped) = text.strip_prefix("0xDF^^") {
        text = stripped.trim_start();
    }

    let mut cleaned = text.replace("\r\n", "\n").replace('\r', "\n");
    while cleaned.contains("\n\n\n") {
        cleaned = cleaned.replace("\n\n\n", "\n\n");
    }

    cleaned.trim_matches('~').trim().to_owned()
}

fn first_text(document: &roxmltree::Document<'_>, tag_name: &str) -> Option<String> {
    document
        .descendants()
        .find(|node| node.has_tag_name(tag_name))
        .and_then(|node| non_empty_string(node.text().unwrap_or_default()))
}

fn mask_card_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.contains('*') || trimmed.len() <= 4 {
        return trimmed.to_owned();
    }

    let digits: String = trimmed.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() <= 4 || digits.len() != trimmed.len() {
        trimmed.to_owned()
    } else {
        format!("****{}", &digits[digits.len() - 4..])
    }
}

fn payment_failure(message: impl Into<String>) -> PaymentResult {
    PaymentResult {
        success: false,
        approval_code: String::new(),
        rrn: String::new(),
        card_mask: String::new(),
        error_message: message.into(),
    }
}

fn bank_settlement_failure(message: impl Into<String>) -> BankSettlementResult {
    BankSettlementResult {
        success: false,
        response_code: String::new(),
        report_text: String::new(),
        error_message: message.into(),
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn current_dualconnector_timestamp() -> String {
    chrono::Local::now().format("%Y%m%d%H%M%S").to_string()
}

fn truncate_for_error(body: &str) -> String {
    const MAX_LEN: usize = 200;
    let trimmed = body.trim();
    if trimmed.len() <= MAX_LEN {
        trimmed.to_owned()
    } else {
        format!("{}...", trimmed.chars().take(MAX_LEN).collect::<String>())
    }
}

fn decode_dualconnector_body(bytes: &[u8], content_type: Option<&str>) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    let (utf8_decoded, _, utf8_had_errors) = UTF_8.decode(bytes);
    if !utf8_had_errors {
        return decoded_cow_to_string(utf8_decoded);
    }

    let mut candidates = Vec::new();
    if let Some(charset) = content_type.and_then(content_type_charset) {
        candidates.push(charset);
    }
    if let Some(encoding) = xml_declared_encoding(bytes) {
        candidates.push(encoding);
    }
    candidates.extend([
        "utf-8",
        "windows-1251",
        "cp1251",
        "ibm866",
        "cp866",
        "koi8-r",
    ]);

    let mut best = None::<(i32, String)>;
    for label in candidates {
        let Some(decoded) = decode_with_encoding_label(bytes, label) else {
            continue;
        };
        let score = decoded_text_score(&decoded);
        match &best {
            Some((best_score, _)) if *best_score >= score => {}
            _ => best = Some((score, decoded)),
        }
    }

    best.map(|(_, text)| text)
        .unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned())
}

fn decode_with_encoding_label(bytes: &[u8], label: &str) -> Option<String> {
    let encoding = Encoding::for_label(label.trim().trim_matches(['"', '\'']).as_bytes())?;
    let (decoded, _, had_errors) = encoding.decode(bytes);
    if had_errors && encoding == UTF_8 {
        return Some(String::from_utf8_lossy(bytes).into_owned());
    }

    Some(decoded_cow_to_string(decoded))
}

fn decoded_cow_to_string(value: Cow<'_, str>) -> String {
    match value {
        Cow::Borrowed(text) => text.to_owned(),
        Cow::Owned(text) => text,
    }
}

fn decoded_text_score(text: &str) -> i32 {
    text.chars().fold(0, |score, ch| {
        if ch == '\u{FFFD}' {
            score - 120
        } else if ('А'..='я').contains(&ch) || ch == 'Ё' || ch == 'ё' {
            score + 4
        } else if ch.is_ascii_alphanumeric()
            || ch.is_ascii_whitespace()
            || matches!(
                ch,
                '<' | '>' | '/' | '=' | '"' | '\'' | '-' | '_' | ':' | ';'
            )
        {
            score + 1
        } else if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
            score - 20
        } else {
            score
        }
    })
}

fn content_type_charset(content_type: &str) -> Option<&str> {
    content_type.split(';').map(str::trim).find_map(|part| {
        let (key, value) = part.split_once('=')?;
        if key.trim().eq_ignore_ascii_case("charset") {
            Some(value.trim().trim_matches(['"', '\'']))
        } else {
            None
        }
    })
}

fn xml_declared_encoding(bytes: &[u8]) -> Option<&str> {
    let prefix_len = bytes.len().min(256);
    let prefix = std::str::from_utf8(&bytes[..prefix_len]).ok()?;
    let lower = prefix.to_ascii_lowercase();
    let encoding_pos = lower.find("encoding")?;
    let after_encoding = &prefix[encoding_pos + "encoding".len()..];
    let (_, after_equals) = after_encoding.split_once('=')?;
    let after_equals = after_equals.trim_start();
    let quote = after_equals.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value_start = quote.len_utf8();
    let value_end = after_equals[value_start..].find(quote)?;
    Some(&after_equals[value_start..value_start + value_end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::WINDOWS_1251;

    #[test]
    fn sale_request_uses_dualconnector_xml_fields() {
        let fields = build_sale_fields(15000, "11087928");
        let xml = build_dualconnector_request(&fields);

        assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(xml.contains("<request>"));
        assert!(xml.contains("<field id=\"00\">15000</field>"));
        assert!(xml.contains("<field id=\"04\">643</field>"));
        assert!(xml.contains("<field id=\"21\">20260518000000</field>"));
        assert!(xml.contains("<field id=\"25\">1</field>"));
        assert!(xml.contains("<field id=\"27\">11087928</field>"));
        assert!(!xml.contains("/api/v1/pay"));
    }

    #[test]
    fn refund_request_uses_dualconnector_rrn_and_refund_operation() {
        let fields = build_refund_fields_with_currency(
            45000,
            "11087928",
            DUALCONNECTOR_DEFAULT_CURRENCY,
            "20260526090700",
            "123456789012",
        );
        let xml = build_dualconnector_request(&fields);

        assert!(xml.contains("<field id=\"00\">45000</field>"));
        assert!(xml.contains("<field id=\"04\">643</field>"));
        assert!(xml.contains("<field id=\"14\">123456789012</field>"));
        assert!(xml.contains("<field id=\"21\">20260526090700</field>"));
        assert!(xml.contains("<field id=\"25\">3</field>"));
        assert!(xml.contains("<field id=\"27\">11087928</field>"));
    }

    #[test]
    fn xml_values_are_escaped() {
        let xml = build_dualconnector_request(&[("90", "A<&>\"'B".to_owned())]);

        assert!(xml.contains("<field id=\"90\">A&lt;&amp;&gt;&quot;&apos;B</field>"));
    }

    #[test]
    fn settlement_request_uses_dualconnector_operation_59_with_long_timeout() {
        let fields = build_settlement_fields("11087928");
        let xml = build_dualconnector_request_with_timeout(
            &fields,
            Some(DUALCONNECTOR_SETTLEMENT_TIMEOUT_MS),
        );

        assert!(xml.contains("<field id=\"25\">59</field>"));
        assert!(xml.contains("<field id=\"27\">11087928</field>"));
        assert!(xml.contains("<timeout>600000</timeout>"));
        assert!(!xml.contains("<field id=\"00\">"));
        assert!(!xml.contains("<field id=\"04\">"));
    }

    #[test]
    fn payment_response_success_uses_dualconnector_fields() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<response>
  <field id="25">1</field>
  <field id="39">1</field>
  <field id="13">A12345</field>
  <field id="14">999888777666</field>
  <field id="10">1234567890123456</field>
  <field id="19">ОДОБРЕНО</field>
</response>"#;

        let result = parse_payment_response(xml);

        assert!(result.success);
        assert_eq!(result.approval_code, "A12345");
        assert_eq!(result.rrn, "999888777666");
        assert_eq!(result.card_mask, "****3456");
        assert_eq!(result.error_message, "");
    }

    #[test]
    fn payment_response_failure_uses_text_field() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<response>
  <field id="39">0</field>
  <field id="19">DECLINED</field>
</response>"#;

        let result = parse_payment_response(xml);

        assert!(!result.success);
        assert_eq!(result.error_message, "DECLINED");
    }

    #[test]
    fn test_connection_response_detects_terminal_online() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<response>
  <field id="25">26</field>
  <field id="39">1</field>
  <field id="27">11087928</field>
</response>"#;

        assert!(parse_test_connection_response(xml));
    }

    #[test]
    fn bank_settlement_response_success_keeps_report_text() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<response>
  <field id="15">000</field>
  <field id="25">59</field>
  <field id="39">1</field>
  <field id="90">0xDF^^СВЕРКА ИТОГОВ&#xD;&#xA;&#xD;&#xA;ТЕРМИНАЛ: 10453236&#xD;&#xA;ОТЧЕТ ЗАВЕРШЕН~</field>
</response>"#;

        let result = parse_bank_settlement_response(xml);

        assert!(result.success);
        assert_eq!(result.response_code, "000");
        assert!(result.report_text.contains("СВЕРКА ИТОГОВ"));
        assert!(result.report_text.contains("ТЕРМИНАЛ: 10453236"));
        assert!(result.report_text.ends_with("ОТЧЕТ ЗАВЕРШЕН"));
    }

    #[test]
    fn bank_settlement_response_failure_uses_text_field() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<response>
  <field id="25">59</field>
  <field id="39">0</field>
  <field id="19">НЕТ СВЯЗИ С БАНКОМ</field>
</response>"#;

        let result = parse_bank_settlement_response(xml);

        assert!(!result.success);
        assert_eq!(result.error_message, "НЕТ СВЯЗИ С БАНКОМ");
    }

    #[test]
    fn dualconnector_body_decodes_windows_1251_xml_without_http_charset() {
        let prefix = r#"<?xml version="1.0" encoding="windows-1251"?><response><field id="39">0</field><field id="19">"#;
        let suffix = r#"</field></response>"#;
        let (message, _, had_errors) = WINDOWS_1251.encode("Отмена не подтверждена");
        assert!(!had_errors);

        let mut bytes = Vec::new();
        bytes.extend_from_slice(prefix.as_bytes());
        bytes.extend_from_slice(&message);
        bytes.extend_from_slice(suffix.as_bytes());

        let decoded = decode_dualconnector_body(&bytes, Some("text/xml"));
        assert!(decoded.contains("Отмена не подтверждена"));
        assert!(!decoded.contains('\u{FFFD}'));

        let result = parse_payment_response(&decoded);
        assert!(!result.success);
        assert_eq!(result.error_message, "Отмена не подтверждена");
    }

    #[test]
    fn dualconnector_body_keeps_valid_utf8_response() {
        let body = r#"<?xml version="1.0" encoding="UTF-8"?><response><field id="39">0</field><field id="19">Ошибка ФНС</field></response>"#;

        let decoded = decode_dualconnector_body(body.as_bytes(), Some("text/xml"));

        assert!(decoded.contains("Ошибка ФНС"));
        assert!(!decoded.contains("Рћ"));
    }

    #[test]
    fn card_value_is_never_exposed_as_full_pan() {
        assert_eq!(mask_card_value("****1234"), "****1234");
        assert_eq!(mask_card_value("1234567890123456"), "****3456");
        assert_eq!(mask_card_value("1234"), "1234");
    }
}
