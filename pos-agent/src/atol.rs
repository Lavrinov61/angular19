//! АТОЛ fiscal client — DLL backend (fptr10.dll) with HTTP fallback.
//!
//! DLL mode: direct FFI calls via process_json (preferred, no WebServer dependency).
//! HTTP mode: HTTP POST to localhost:16732 (АТОЛ WebServer v10), used as fallback.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::AtolConfig;

#[cfg(windows)]
use crate::atol_ffi::{
    self, FptrLib, LIBFPTR_DT_SHIFT_STATE, LIBFPTR_PARAM_DATA_TYPE, LIBFPTR_PARAM_JSON_DATA,
    LIBFPTR_PARAM_SETTING_ID, LIBFPTR_PARAM_SETTING_VALUE, LIBFPTR_PARAM_SHIFT_STATE,
};
#[cfg(windows)]
use std::sync::Mutex;

// ── Public types (same API as before) ──

pub struct FiscalItem {
    pub name: String,
    pub price_kopecks: i64,
    pub quantity: i32,
    pub vat_rate: String,
    pub payment_method: String,
    pub payment_object: String,
    pub measurement_unit: String,
}

pub struct FiscalPayment {
    pub payment_method: String,
    pub amount_kopecks: i64,
    pub transaction_id: String,
    pub approval_code: String,
    pub rrn: String,
    pub card_mask: String,
    pub card_info: String,
}

pub struct ReceiptCopyPrintRequest {
    pub receipt_number: String,
    pub created_at: String,
    pub lines: Vec<ReceiptCopyLine>,
    pub payments: Vec<ReceiptCopyPayment>,
    pub total_kopecks: i64,
    pub cashier: String,
}

pub struct ReceiptCopyLine {
    pub name: String,
    pub quantity: f64,
    pub amount_kopecks: i64,
}

pub struct ReceiptCopyPayment {
    pub payment_method: String,
    pub amount_kopecks: i64,
    pub approval_code: String,
    pub rrn: String,
    pub card_mask: String,
}

pub struct FiscalRequest {
    pub receipt_id: String,
    pub receipt_type: String,
    pub items: Vec<FiscalItem>,
    pub payment_method: String,
    pub payments: Vec<FiscalPayment>,
    pub total_kopecks: i64,
    pub cashier: String,
    pub cashier_inn: Option<String>,
    pub customer_email: Option<String>,
    pub taxation_type: Option<String>,
    pub receipt_print_options: FiscalReceiptPrintOptions,
    pub bank_slip_options: BankSlipPrintOptions,
    pub correction: Option<FiscalCorrection>,
}

#[derive(Clone, Debug)]
pub struct FiscalCorrection {
    pub correction_type: String,
    pub correction_base_date: String,
    pub correction_base_number: String,
    pub correction_base_name: String,
}

#[derive(Clone, Debug)]
pub struct FiscalReceiptPrintOptions {
    pub print_receipt: bool,
    pub receipt_copies: u32,
    pub header_lines: Vec<String>,
    pub footer_lines: Vec<String>,
    pub show_cashier: bool,
    pub show_receipt_number: bool,
    pub show_order_number: bool,
    pub show_customer: bool,
}

impl Default for FiscalReceiptPrintOptions {
    fn default() -> Self {
        Self {
            print_receipt: true,
            receipt_copies: 1,
            header_lines: Vec::new(),
            footer_lines: Vec::new(),
            show_cashier: true,
            show_receipt_number: true,
            show_order_number: true,
            show_customer: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BankSlipPrintOptions {
    pub print_bank_slip_on_atol: bool,
    pub bank_slip_copies: u32,
    pub print_merchant_copy: bool,
    pub print_customer_copy: bool,
    pub include_rrn: bool,
    pub include_approval_code: bool,
    pub include_card_mask: bool,
    pub include_sbp_id: bool,
    pub footer_lines: Vec<String>,
}

impl Default for BankSlipPrintOptions {
    fn default() -> Self {
        Self {
            print_bank_slip_on_atol: true,
            bank_slip_copies: 1,
            print_merchant_copy: true,
            print_customer_copy: true,
            include_rrn: true,
            include_approval_code: true,
            include_card_mask: true,
            include_sbp_id: true,
            footer_lines: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ShiftPrintOptions {
    pub print_open_report: bool,
    pub print_close_report: bool,
}

impl Default for ShiftPrintOptions {
    fn default() -> Self {
        Self {
            print_open_report: true,
            print_close_report: true,
        }
    }
}

pub struct FiscalResult {
    pub success: bool,
    pub fiscal_number: String,
    pub fiscal_sign: String,
    pub receipt_url: String,
    pub error_code: Option<i32>,
    pub error_message: String,
}

pub struct ShiftResult {
    pub success: bool,
    pub error_message: String,
}

fn fiscal_shift_status_from_raw(raw: i32) -> &'static str {
    match raw {
        0 => "closed",
        1 => "open",
        2 => "expired",
        _ => "unknown",
    }
}

const ATOL_PAPER_WIDTH_SETTING_ID: i32 = 285;
const ATOL_PAPER_WIDTH_80_VALUE: i32 = 1;
const ATOL_PAPER_WIDTH_57_VALUE: i32 = 2;
const DEFAULT_MEASUREMENT_UNIT: &str = "piece";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AtolPaperWidthSetting {
    parameter_id: i32,
    value: i32,
    width_mm: u32,
}

fn paper_width_setting(width_mm: u32) -> Option<AtolPaperWidthSetting> {
    match width_mm {
        57 | 58 => Some(AtolPaperWidthSetting {
            parameter_id: ATOL_PAPER_WIDTH_SETTING_ID,
            value: ATOL_PAPER_WIDTH_57_VALUE,
            width_mm,
        }),
        80 => Some(AtolPaperWidthSetting {
            parameter_id: ATOL_PAPER_WIDTH_SETTING_ID,
            value: ATOL_PAPER_WIDTH_80_VALUE,
            width_mm,
        }),
        _ => None,
    }
}

// ── DLL device wrapper (behind Mutex, not thread-safe) ──

#[cfg(windows)]
struct AtolDevice {
    lib: FptrLib,
    handle: *mut std::ffi::c_void,
}

#[cfg(windows)]
unsafe impl Send for AtolDevice {}

#[cfg(windows)]
impl AtolDevice {
    fn new(
        dll_path: &str,
        com_port: &str,
        baud_rate: u32,
        paper_width: Option<AtolPaperWidthSetting>,
    ) -> Result<Self, atol_ffi::FptrError> {
        let lib = FptrLib::load(dll_path)?;
        let mut handle = lib.create()?;

        let init_result = (|| {
            lib.set_single_setting(
                handle,
                atol_ffi::LIBFPTR_SETTING_MODEL,
                atol_ffi::LIBFPTR_MODEL_AUTO,
            );
            lib.set_single_setting(
                handle,
                atol_ffi::LIBFPTR_SETTING_PORT,
                atol_ffi::LIBFPTR_PORT_COM,
            );
            lib.set_single_setting(handle, atol_ffi::LIBFPTR_SETTING_COM_FILE, com_port);
            lib.set_single_setting(
                handle,
                atol_ffi::LIBFPTR_SETTING_BAUDRATE,
                &baud_rate.to_string(),
            );
            lib.apply_single_settings(handle)?;

            info!(
                com_port,
                baud_rate, "ATOL DLL settings applied, opening device"
            );
            lib.open(handle)?;
            info!("ATOL device opened via DLL");
            if let Some(setting) = paper_width {
                if let Err(err) = apply_paper_width_setting(&lib, handle, setting) {
                    warn!(
                        error = %err,
                        paper_width_mm = setting.width_mm,
                        setting_id = setting.parameter_id,
                        setting_value = setting.value,
                        "ATOL paper width setting update failed; continuing with current device setting"
                    );
                }
            }
            Ok(())
        })();

        if let Err(err) = init_result {
            if !handle.is_null() {
                if lib.is_opened(handle) {
                    lib.close(handle);
                }
                lib.destroy(&mut handle);
            }
            return Err(err);
        }

        Ok(Self { lib, handle })
    }

    fn is_opened(&self) -> bool {
        self.lib.is_opened(self.handle)
    }

    fn shift_status(&self) -> Result<String, atol_ffi::FptrError> {
        self.lib
            .set_param_int(self.handle, LIBFPTR_PARAM_DATA_TYPE, LIBFPTR_DT_SHIFT_STATE);
        self.lib.query_data(self.handle)?;
        Ok(fiscal_shift_status_from_raw(
            self.lib
                .get_param_int(self.handle, LIBFPTR_PARAM_SHIFT_STATE),
        )
        .to_string())
    }

    /// Send a JSON command via process_json and return the response JSON.
    fn process_json(&self, json: &str) -> Result<String, atol_ffi::FptrError> {
        self.lib
            .set_param_string(self.handle, LIBFPTR_PARAM_JSON_DATA, json);
        self.lib.process_json(self.handle)?;
        Ok(self
            .lib
            .get_param_string(self.handle, LIBFPTR_PARAM_JSON_DATA))
    }
}

#[cfg(windows)]
fn apply_paper_width_setting(
    lib: &FptrLib,
    handle: *mut std::ffi::c_void,
    setting: AtolPaperWidthSetting,
) -> Result<(), atol_ffi::FptrError> {
    lib.set_param_int(handle, LIBFPTR_PARAM_SETTING_ID, setting.parameter_id);
    lib.read_device_setting(handle)?;
    let current_value = lib.get_param_int(handle, LIBFPTR_PARAM_SETTING_VALUE);

    if current_value == setting.value {
        info!(
            paper_width_mm = setting.width_mm,
            setting_id = setting.parameter_id,
            setting_value = setting.value,
            "ATOL paper width setting already applied"
        );
        return Ok(());
    }

    lib.set_param_int(handle, LIBFPTR_PARAM_SETTING_ID, setting.parameter_id);
    lib.set_param_int(handle, LIBFPTR_PARAM_SETTING_VALUE, setting.value);
    lib.write_device_setting(handle)?;
    info!(
        paper_width_mm = setting.width_mm,
        setting_id = setting.parameter_id,
        previous_setting_value = current_value,
        setting_value = setting.value,
        "ATOL paper width setting applied"
    );
    Ok(())
}

#[cfg(windows)]
impl Drop for AtolDevice {
    fn drop(&mut self) {
        info!("Closing ATOL device");
        self.lib.close(self.handle);
        self.lib.destroy(&mut self.handle);
    }
}

// ── HTTP backend types (unchanged from original) ──

#[derive(Serialize)]
struct AtolHttpRequest {
    uuid: String,
    request: Vec<AtolOperation>,
}

#[derive(Serialize)]
struct AtolHttpRawRequest {
    uuid: String,
    request: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct AtolOperation {
    #[serde(rename = "type")]
    op_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "taxationType")]
    taxation_type: Option<String>,
    #[serde(rename = "correctionType", skip_serializing_if = "Option::is_none")]
    correction_type: Option<String>,
    #[serde(rename = "correctionBaseDate", skip_serializing_if = "Option::is_none")]
    correction_base_date: Option<String>,
    #[serde(
        rename = "correctionBaseNumber",
        skip_serializing_if = "Option::is_none"
    )]
    correction_base_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    electronically: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operator: Option<AtolOperator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "preItems")]
    pre_items: Option<Vec<AtolDocumentTextItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "postItems")]
    post_items: Option<Vec<AtolDocumentTextItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<AtolHttpItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payments: Option<Vec<AtolPayment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "clientInfo")]
    client_info: Option<AtolClientInfo>,
}

#[derive(Serialize)]
struct AtolOperator {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vatin: Option<String>,
}

#[derive(Clone, Serialize)]
struct AtolDocumentTextItem {
    #[serde(rename = "type")]
    item_type: String,
    text: String,
    alignment: String,
}

#[derive(Serialize)]
struct AtolHttpItem {
    #[serde(rename = "type")]
    item_type: String,
    name: String,
    price: f64,
    quantity: i32,
    amount: f64,
    tax: AtolTax,
    #[serde(rename = "paymentMethod")]
    payment_method: String,
    #[serde(rename = "paymentObject")]
    payment_object: String,
    #[serde(rename = "measurementUnit")]
    measurement_unit: String,
}

#[derive(Serialize)]
struct AtolTax {
    #[serde(rename = "type")]
    tax_type: String,
}

#[derive(Serialize)]
struct AtolPayment {
    #[serde(rename = "type")]
    payment_type: String,
    sum: f64,
}

#[derive(Serialize)]
struct AtolClientInfo {
    #[serde(rename = "emailOrPhone")]
    email_or_phone: String,
}

#[derive(Deserialize)]
struct AtolHttpResponse {
    results: Option<Vec<AtolHttpResult>>,
}

#[derive(Deserialize)]
struct AtolHttpResult {
    status: Option<String>,
    payload: Option<AtolPayload>,
    error: Option<AtolHttpError>,
}

#[derive(Deserialize)]
struct AtolPayload {
    #[serde(rename = "fiscalDocumentNumber")]
    fiscal_document_number: Option<i64>,
    #[serde(rename = "fiscalDocumentSign")]
    fiscal_document_sign: Option<i64>,
    #[serde(rename = "ofdUrl")]
    ofd_url: Option<String>,
}

#[derive(Deserialize)]
struct AtolHttpError {
    code: Option<i32>,
    description: Option<String>,
}

// ── DLL JSON request/response types ──

#[derive(Serialize)]
struct DllFiscalRequest {
    #[serde(rename = "type")]
    op_type: String,
    #[serde(rename = "taxationType", skip_serializing_if = "Option::is_none")]
    taxation_type: Option<String>,
    #[serde(rename = "correctionType", skip_serializing_if = "Option::is_none")]
    correction_type: Option<String>,
    #[serde(rename = "correctionBaseDate", skip_serializing_if = "Option::is_none")]
    correction_base_date: Option<String>,
    #[serde(
        rename = "correctionBaseNumber",
        skip_serializing_if = "Option::is_none"
    )]
    correction_base_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    electronically: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operator: Option<DllOperator>,
    #[serde(rename = "preItems", skip_serializing_if = "Option::is_none")]
    pre_items: Option<Vec<AtolDocumentTextItem>>,
    #[serde(rename = "postItems", skip_serializing_if = "Option::is_none")]
    post_items: Option<Vec<AtolDocumentTextItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<DllItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payments: Option<Vec<DllPayment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<f64>,
    #[serde(rename = "clientInfo", skip_serializing_if = "Option::is_none")]
    client_info: Option<DllClientInfo>,
}

#[derive(Serialize)]
struct DllOperator {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vatin: Option<String>,
}

#[derive(Serialize)]
struct DllItem {
    #[serde(rename = "type")]
    item_type: String,
    name: String,
    price: f64,
    quantity: f64,
    amount: f64,
    tax: DllTax,
    #[serde(rename = "paymentMethod")]
    payment_method: String,
    #[serde(rename = "paymentObject")]
    payment_object: String,
    #[serde(rename = "measurementUnit")]
    measurement_unit: String,
}

#[derive(Serialize)]
struct DllTax {
    #[serde(rename = "type")]
    tax_type: String,
}

#[derive(Serialize)]
struct DllPayment {
    #[serde(rename = "type")]
    payment_type: String,
    sum: f64,
}

#[derive(Serialize)]
struct DllClientInfo {
    #[serde(rename = "emailOrPhone")]
    email_or_phone: String,
}

#[derive(Deserialize)]
struct DllResponse {
    #[serde(rename = "fiscalDocumentNumber")]
    fiscal_document_number: Option<i64>,
    #[serde(rename = "fiscalDocumentSign")]
    fiscal_document_sign: Option<i64>,
    #[serde(rename = "ofdUrl")]
    ofd_url: Option<String>,
    error: Option<DllResponseError>,
}

#[derive(Deserialize)]
struct DllResponseError {
    code: Option<i32>,
    description: Option<String>,
}

// ── Backend enum ──

enum AtolBackend {
    #[cfg(windows)]
    Dll(Mutex<AtolDevice>),
    Http {
        http: reqwest::Client,
        base_url: String,
    },
}

// ── AtolClient — public API ──

pub struct AtolClient {
    backend: AtolBackend,
    default_taxation_type: String,
}

impl AtolClient {
    pub fn new(config: &AtolConfig) -> Self {
        // Try DLL mode first if configured
        #[cfg(windows)]
        if let Some(ref dll_path) = config.dll_path {
            let com_port = config.com_port.as_deref().unwrap_or("COM7");
            let baud_rate = config.baud_rate.unwrap_or(115200);
            let paper_width = paper_width_setting(config.paper_width_mm);

            match AtolDevice::new(dll_path, com_port, baud_rate, paper_width) {
                Ok(device) => {
                    info!("ATOL client initialized in DLL mode");
                    return Self {
                        backend: AtolBackend::Dll(Mutex::new(device)),
                        default_taxation_type: config.taxation_type.clone(),
                    };
                }
                Err(e) => {
                    warn!(error = %e, "DLL init failed, falling back to HTTP");
                }
            }
        }

        // HTTP fallback
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .expect("Failed to create ATOL HTTP client");

        info!(url = %config.url, "ATOL client initialized in HTTP mode");

        Self {
            backend: AtolBackend::Http {
                http,
                base_url: config.url.clone(),
            },
            default_taxation_type: config.taxation_type.clone(),
        }
    }

    /// Print fiscal receipt (sale or refund).
    pub async fn fiscal(&self, request: FiscalRequest) -> FiscalResult {
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => self.fiscal_dll(device, request),
            AtolBackend::Http { http, base_url } => self.fiscal_http(http, base_url, request).await,
        }
    }

    /// Print a non-fiscal customer copy of an existing POS receipt.
    pub async fn print_receipt_copy(&self, request: ReceiptCopyPrintRequest) -> ShiftResult {
        info!(
            receipt_number = %request.receipt_number,
            total = request.total_kopecks as f64 / 100.0,
            "ATOL print receipt copy"
        );
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => self.receipt_copy_dll(device, &request),
            AtolBackend::Http { http, base_url } => {
                self.receipt_copy_http(http, base_url, &request).await
            }
        }
    }

    /// Open fiscal shift.
    pub async fn open_shift(
        &self,
        cashier: &str,
        cashier_inn: Option<&str>,
        print_options: ShiftPrintOptions,
    ) -> ShiftResult {
        info!(cashier, "ATOL open shift");
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => {
                self.shift_dll(device, "openShift", cashier, cashier_inn, print_options)
            }
            AtolBackend::Http { http, base_url } => {
                self.shift_http(
                    http,
                    base_url,
                    "openShift",
                    cashier,
                    cashier_inn,
                    print_options,
                )
                .await
            }
        }
    }

    /// Close fiscal shift (Z-report).
    pub async fn close_shift(
        &self,
        cashier: &str,
        cashier_inn: Option<&str>,
        print_options: ShiftPrintOptions,
    ) -> ShiftResult {
        info!(cashier, "ATOL close shift (Z-report)");
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => {
                self.shift_dll(device, "closeShift", cashier, cashier_inn, print_options)
            }
            AtolBackend::Http { http, base_url } => {
                self.shift_http(
                    http,
                    base_url,
                    "closeShift",
                    cashier,
                    cashier_inn,
                    print_options,
                )
                .await
            }
        }
    }

    /// Open cash drawer.
    pub async fn open_cash_drawer(&self) -> ShiftResult {
        info!("ATOL open cash drawer");
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => self.cash_drawer_dll(device),
            AtolBackend::Http { http, base_url } => self.cash_drawer_http(http, base_url).await,
        }
    }

    /// Health check.
    pub async fn is_online(&self) -> bool {
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => {
                let dev = device.lock().unwrap();
                dev.is_opened()
            }
            AtolBackend::Http { http, base_url } => {
                let url = format!("{base_url}/api/v2/status");
                matches!(http.get(&url).send().await, Ok(resp) if resp.status().is_success())
            }
        }
    }

    /// Fiscal shift status from the fiscal registrar itself.
    pub async fn shift_status(&self) -> Option<String> {
        match &self.backend {
            #[cfg(windows)]
            AtolBackend::Dll(device) => {
                let dev = device.lock().unwrap();
                match dev.shift_status() {
                    Ok(status) => Some(status),
                    Err(e) => {
                        warn!(error = %e, "ATOL DLL shift status query failed");
                        None
                    }
                }
            }
            AtolBackend::Http { .. } => None,
        }
    }

    // ── DLL implementation ──

    #[cfg(windows)]
    fn fiscal_dll(&self, device: &Mutex<AtolDevice>, request: FiscalRequest) -> FiscalResult {
        let total_rub = request.total_kopecks as f64 / 100.0;

        info!(
            receipt_type = %request.receipt_type,
            total = total_rub,
            items = request.items.len(),
            cashier = %request.cashier,
            "ATOL DLL fiscal request"
        );

        let op_type = receipt_operation_type(&request.receipt_type);
        let correction = fiscal_correction_fields(&request);

        let taxation_type = request
            .taxation_type
            .as_deref()
            .unwrap_or(&self.default_taxation_type);

        let payment_rows = fiscal_payment_rows(
            &request.payments,
            &request.payment_method,
            request.total_kopecks,
        );

        let items: Vec<DllItem> = request
            .items
            .iter()
            .map(|item| {
                let price_rub = item.price_kopecks as f64 / 100.0;
                DllItem {
                    item_type: "position".into(),
                    name: item.name.clone(),
                    price: price_rub,
                    quantity: item.quantity as f64,
                    amount: price_rub * item.quantity as f64,
                    tax: DllTax {
                        tax_type: item.vat_rate.clone(),
                    },
                    payment_method: if item.payment_method.is_empty() {
                        "fullPayment".into()
                    } else {
                        item.payment_method.clone()
                    },
                    payment_object: if item.payment_object.is_empty() {
                        "commodity".into()
                    } else {
                        item.payment_object.clone()
                    },
                    measurement_unit: fiscal_measurement_unit(&item.measurement_unit),
                }
            })
            .collect();

        let mut dll_request = DllFiscalRequest {
            op_type: op_type.into(),
            taxation_type: Some(taxation_type.into()),
            correction_type: correction
                .as_ref()
                .map(|metadata| metadata.correction_type.clone()),
            correction_base_date: correction
                .as_ref()
                .map(|metadata| metadata.correction_base_date.clone()),
            correction_base_number: correction
                .as_ref()
                .and_then(|metadata| metadata.correction_base_number.clone()),
            electronically: receipt_electronically(&request),
            operator: Some(DllOperator {
                name: request.cashier.clone(),
                vatin: clean_optional_string(request.cashier_inn.as_deref()),
            }),
            pre_items: document_text_items(&request.receipt_print_options.header_lines, "center"),
            post_items: document_text_items(&request.receipt_print_options.footer_lines, "center"),
            items: Some(items),
            payments: Some(
                payment_rows
                    .into_iter()
                    .map(|(payment_type, sum)| DllPayment { payment_type, sum })
                    .collect(),
            ),
            total: Some(total_rub),
            client_info: None,
        };

        if let Some(ref email) = request.customer_email {
            if !email.is_empty() {
                dll_request.client_info = Some(DllClientInfo {
                    email_or_phone: email.clone(),
                });
            }
        }

        let json = match serde_json::to_string(&dll_request) {
            Ok(j) => j,
            Err(e) => {
                return FiscalResult {
                    success: false,
                    fiscal_number: String::new(),
                    fiscal_sign: String::new(),
                    receipt_url: String::new(),
                    error_code: None,
                    error_message: format!("JSON serialize error: {e}"),
                };
            }
        };

        let dev = device.lock().unwrap();
        let result = match dev.process_json(&json) {
            Ok(response_json) => {
                let response_str = self.get_dll_response(&dev, &response_json);
                drop(dev);
                response_str
            }
            Err(e) => {
                let code = dev.lib.error_code(dev.handle);
                let desc = dev.lib.error_description(dev.handle);
                drop(dev);
                error!(code, desc = %desc, "ATOL DLL fiscal failed");
                FiscalResult {
                    success: false,
                    fiscal_number: String::new(),
                    fiscal_sign: String::new(),
                    receipt_url: String::new(),
                    error_code: Some(code),
                    error_message: format!("DLL error: {e}"),
                }
            }
        };

        if result.success {
            self.print_bank_slips_dll(device, &request);
        }

        result
    }

    #[cfg(windows)]
    fn get_dll_response(&self, _dev: &AtolDevice, response_json: &str) -> FiscalResult {
        match serde_json::from_str::<DllResponse>(response_json) {
            Ok(resp) => {
                if let Some(err) = &resp.error {
                    if err.code.unwrap_or(0) != 0 {
                        warn!(
                            code = err.code.unwrap_or(-1),
                            msg = err.description.as_deref().unwrap_or(""),
                            "ATOL DLL fiscal error in response"
                        );
                        return FiscalResult {
                            success: false,
                            fiscal_number: String::new(),
                            fiscal_sign: String::new(),
                            receipt_url: String::new(),
                            error_code: err.code,
                            error_message: err
                                .description
                                .clone()
                                .unwrap_or("Unknown error".into()),
                        };
                    }
                }

                info!(
                    fiscal_number = resp.fiscal_document_number.unwrap_or(0),
                    "ATOL DLL fiscal success"
                );
                FiscalResult {
                    success: true,
                    fiscal_number: resp
                        .fiscal_document_number
                        .map(|n| n.to_string())
                        .unwrap_or_default(),
                    fiscal_sign: resp
                        .fiscal_document_sign
                        .map(|n| n.to_string())
                        .unwrap_or_default(),
                    receipt_url: resp.ofd_url.unwrap_or_default(),
                    error_code: None,
                    error_message: String::new(),
                }
            }
            Err(e) => {
                warn!(error = %e, raw = response_json, "ATOL DLL response parse error");
                FiscalResult {
                    success: false,
                    fiscal_number: String::new(),
                    fiscal_sign: String::new(),
                    receipt_url: String::new(),
                    error_code: None,
                    error_message: format!("DLL response parse error: {e}"),
                }
            }
        }
    }

    #[cfg(windows)]
    fn shift_dll(
        &self,
        device: &Mutex<AtolDevice>,
        op_type: &str,
        cashier: &str,
        cashier_inn: Option<&str>,
        print_options: ShiftPrintOptions,
    ) -> ShiftResult {
        let electronically = match op_type {
            "openShift" => !print_options.print_open_report,
            "closeShift" => !print_options.print_close_report,
            _ => false,
        };
        let json = serde_json::json!({
            "type": op_type,
            "operator": shift_operator_json(cashier, cashier_inn),
            "electronically": electronically
        })
        .to_string();

        let dev = device.lock().unwrap();
        match dev.process_json(&json) {
            Ok(_) => ShiftResult {
                success: true,
                error_message: String::new(),
            },
            Err(e) => {
                warn!(error = %e, op_type, "ATOL DLL shift operation failed");
                ShiftResult {
                    success: false,
                    error_message: format!("DLL error: {e}"),
                }
            }
        }
    }

    #[cfg(windows)]
    fn cash_drawer_dll(&self, device: &Mutex<AtolDevice>) -> ShiftResult {
        let json = serde_json::json!({
            "type": "openCashDrawer"
        })
        .to_string();

        let dev = device.lock().unwrap();
        match dev.process_json(&json) {
            Ok(_) => ShiftResult {
                success: true,
                error_message: String::new(),
            },
            Err(e) => {
                warn!(error = %e, "ATOL DLL cash drawer operation failed");
                ShiftResult {
                    success: false,
                    error_message: format!("DLL error: {e}"),
                }
            }
        }
    }

    #[cfg(windows)]
    fn receipt_copy_dll(
        &self,
        device: &Mutex<AtolDevice>,
        request: &ReceiptCopyPrintRequest,
    ) -> ShiftResult {
        let json = build_receipt_copy_document(request).to_string();
        let dev = device.lock().unwrap();
        match dev.process_json(&json) {
            Ok(_) => ShiftResult {
                success: true,
                error_message: String::new(),
            },
            Err(e) => {
                let code = dev.lib.error_code(dev.handle);
                let desc = dev.lib.error_description(dev.handle);
                warn!(
                    code,
                    desc = %desc,
                    error = %e,
                    receipt_number = %request.receipt_number,
                    "ATOL DLL receipt copy print failed"
                );
                ShiftResult {
                    success: false,
                    error_message: format!("DLL error: {e}"),
                }
            }
        }
    }

    // ── HTTP implementation (original code) ──

    async fn fiscal_http(
        &self,
        http: &reqwest::Client,
        base_url: &str,
        request: FiscalRequest,
    ) -> FiscalResult {
        let url = format!("{base_url}/api/v2/requests");
        let total_rub = request.total_kopecks as f64 / 100.0;

        info!(
            receipt_type = %request.receipt_type,
            total = total_rub,
            items = request.items.len(),
            cashier = %request.cashier,
            "ATOL HTTP fiscal request"
        );

        let op_type = receipt_operation_type(&request.receipt_type);
        let correction = fiscal_correction_fields(&request);

        let taxation_type = request
            .taxation_type
            .as_deref()
            .unwrap_or(&self.default_taxation_type);

        let payment_rows = fiscal_payment_rows(
            &request.payments,
            &request.payment_method,
            request.total_kopecks,
        );

        let items: Vec<AtolHttpItem> = request
            .items
            .iter()
            .map(|item| {
                let price_rub = item.price_kopecks as f64 / 100.0;
                AtolHttpItem {
                    item_type: "position".into(),
                    name: item.name.clone(),
                    price: price_rub,
                    quantity: item.quantity,
                    amount: price_rub * item.quantity as f64,
                    tax: AtolTax {
                        tax_type: item.vat_rate.clone(),
                    },
                    payment_method: if item.payment_method.is_empty() {
                        "fullPayment".into()
                    } else {
                        item.payment_method.clone()
                    },
                    payment_object: if item.payment_object.is_empty() {
                        "commodity".into()
                    } else {
                        item.payment_object.clone()
                    },
                    measurement_unit: fiscal_measurement_unit(&item.measurement_unit),
                }
            })
            .collect();

        let mut operation = AtolOperation {
            op_type: op_type.into(),
            taxation_type: Some(taxation_type.into()),
            correction_type: correction
                .as_ref()
                .map(|metadata| metadata.correction_type.clone()),
            correction_base_date: correction
                .as_ref()
                .map(|metadata| metadata.correction_base_date.clone()),
            correction_base_number: correction
                .as_ref()
                .and_then(|metadata| metadata.correction_base_number.clone()),
            electronically: receipt_electronically(&request),
            operator: Some(AtolOperator {
                name: request.cashier.clone(),
                vatin: clean_optional_string(request.cashier_inn.as_deref()),
            }),
            pre_items: document_text_items(&request.receipt_print_options.header_lines, "center"),
            post_items: document_text_items(&request.receipt_print_options.footer_lines, "center"),
            items: Some(items),
            payments: Some(
                payment_rows
                    .into_iter()
                    .map(|(payment_type, sum)| AtolPayment { payment_type, sum })
                    .collect(),
            ),
            total: Some(total_rub),
            client_info: None,
        };

        if let Some(ref email) = request.customer_email {
            if !email.is_empty() {
                operation.client_info = Some(AtolClientInfo {
                    email_or_phone: email.clone(),
                });
            }
        }

        let atol_request = AtolHttpRequest {
            uuid: Uuid::new_v4().to_string(),
            request: vec![operation],
        };

        let result = match http.post(&url).json(&atol_request).send().await {
            Ok(resp) => match resp.json::<AtolHttpResponse>().await {
                Ok(data) => {
                    let result = data.results.and_then(|r| r.into_iter().next());

                    match result {
                        Some(r)
                            if r.status.as_deref() == Some("ready")
                                || r.error.as_ref().and_then(|e| e.code) == Some(0) =>
                        {
                            let payload = r.payload.unwrap_or(AtolPayload {
                                fiscal_document_number: None,
                                fiscal_document_sign: None,
                                ofd_url: None,
                            });
                            info!(
                                fiscal_number = payload.fiscal_document_number.unwrap_or(0),
                                "ATOL HTTP fiscal success"
                            );
                            FiscalResult {
                                success: true,
                                fiscal_number: payload
                                    .fiscal_document_number
                                    .map(|n| n.to_string())
                                    .unwrap_or_default(),
                                fiscal_sign: payload
                                    .fiscal_document_sign
                                    .map(|n| n.to_string())
                                    .unwrap_or_default(),
                                receipt_url: payload.ofd_url.unwrap_or_default(),
                                error_code: None,
                                error_message: String::new(),
                            }
                        }
                        Some(r) => {
                            let err = r.error.unwrap_or(AtolHttpError {
                                code: None,
                                description: None,
                            });
                            warn!(
                                code = err.code.unwrap_or(-1),
                                msg = err.description.as_deref().unwrap_or(""),
                                "ATOL HTTP fiscal failed"
                            );
                            FiscalResult {
                                success: false,
                                fiscal_number: String::new(),
                                fiscal_sign: String::new(),
                                receipt_url: String::new(),
                                error_code: err.code,
                                error_message: err.description.unwrap_or("Unknown error".into()),
                            }
                        }
                        None => FiscalResult {
                            success: false,
                            fiscal_number: String::new(),
                            fiscal_sign: String::new(),
                            receipt_url: String::new(),
                            error_code: None,
                            error_message: "Empty response from ATOL".into(),
                        },
                    }
                }
                Err(e) => {
                    error!(error = %e, "ATOL HTTP response parse error");
                    FiscalResult {
                        success: false,
                        fiscal_number: String::new(),
                        fiscal_sign: String::new(),
                        receipt_url: String::new(),
                        error_code: None,
                        error_message: format!("Parse error: {e}"),
                    }
                }
            },
            Err(e) => {
                error!(error = %e, "ATOL HTTP request error");
                FiscalResult {
                    success: false,
                    fiscal_number: String::new(),
                    fiscal_sign: String::new(),
                    receipt_url: String::new(),
                    error_code: None,
                    error_message: format!("Connection error: {e}"),
                }
            }
        };

        if result.success {
            self.print_bank_slips_http(http, base_url, &request).await;
        }

        result
    }

    async fn shift_http(
        &self,
        http: &reqwest::Client,
        base_url: &str,
        op_type: &str,
        cashier: &str,
        cashier_inn: Option<&str>,
        print_options: ShiftPrintOptions,
    ) -> ShiftResult {
        let url = format!("{base_url}/api/v2/requests");
        let electronically = match op_type {
            "openShift" => !print_options.print_open_report,
            "closeShift" => !print_options.print_close_report,
            _ => false,
        };

        let atol_request = AtolHttpRequest {
            uuid: Uuid::new_v4().to_string(),
            request: vec![AtolOperation {
                op_type: op_type.into(),
                taxation_type: None,
                correction_type: None,
                correction_base_date: None,
                correction_base_number: None,
                electronically: Some(electronically),
                operator: Some(AtolOperator {
                    name: cashier.into(),
                    vatin: clean_optional_string(cashier_inn),
                }),
                pre_items: None,
                post_items: None,
                items: None,
                payments: None,
                total: None,
                client_info: None,
            }],
        };

        match http.post(&url).json(&atol_request).send().await {
            Ok(resp) => match resp.json::<AtolHttpResponse>().await {
                Ok(data) => {
                    let result = data.results.and_then(|r| r.into_iter().next());
                    match result {
                        Some(r)
                            if r.status.as_deref() == Some("ready")
                                || r.error.as_ref().and_then(|e| e.code) == Some(0) =>
                        {
                            ShiftResult {
                                success: true,
                                error_message: String::new(),
                            }
                        }
                        Some(r) => {
                            let msg = r
                                .error
                                .and_then(|e| e.description)
                                .unwrap_or("Unknown error".into());
                            ShiftResult {
                                success: false,
                                error_message: msg,
                            }
                        }
                        None => ShiftResult {
                            success: false,
                            error_message: "Empty response".into(),
                        },
                    }
                }
                Err(e) => ShiftResult {
                    success: false,
                    error_message: format!("Parse error: {e}"),
                },
            },
            Err(e) => ShiftResult {
                success: false,
                error_message: format!("Connection error: {e}"),
            },
        }
    }

    async fn cash_drawer_http(&self, http: &reqwest::Client, base_url: &str) -> ShiftResult {
        let url = format!("{base_url}/api/v2/requests");

        let atol_request = AtolHttpRequest {
            uuid: Uuid::new_v4().to_string(),
            request: vec![AtolOperation {
                op_type: "openCashDrawer".into(),
                taxation_type: None,
                correction_type: None,
                correction_base_date: None,
                correction_base_number: None,
                electronically: None,
                operator: None,
                pre_items: None,
                post_items: None,
                items: None,
                payments: None,
                total: None,
                client_info: None,
            }],
        };

        match http.post(&url).json(&atol_request).send().await {
            Ok(resp) => match resp.json::<AtolHttpResponse>().await {
                Ok(data) => {
                    let result = data.results.and_then(|r| r.into_iter().next());
                    match result {
                        Some(r)
                            if r.status.as_deref() == Some("ready")
                                || r.error.as_ref().and_then(|e| e.code) == Some(0) =>
                        {
                            ShiftResult {
                                success: true,
                                error_message: String::new(),
                            }
                        }
                        Some(r) => {
                            let msg = r
                                .error
                                .and_then(|e| e.description)
                                .unwrap_or("Unknown error".into());
                            ShiftResult {
                                success: false,
                                error_message: msg,
                            }
                        }
                        None => ShiftResult {
                            success: false,
                            error_message: "Empty response".into(),
                        },
                    }
                }
                Err(e) => ShiftResult {
                    success: false,
                    error_message: format!("Parse error: {e}"),
                },
            },
            Err(e) => ShiftResult {
                success: false,
                error_message: format!("Connection error: {e}"),
            },
        }
    }

    async fn receipt_copy_http(
        &self,
        http: &reqwest::Client,
        base_url: &str,
        request: &ReceiptCopyPrintRequest,
    ) -> ShiftResult {
        let url = format!("{base_url}/api/v2/requests");
        let atol_request = AtolHttpRawRequest {
            uuid: Uuid::new_v4().to_string(),
            request: vec![build_receipt_copy_document(request)],
        };

        match http.post(&url).json(&atol_request).send().await {
            Ok(resp) if resp.status().is_success() => ShiftResult {
                success: true,
                error_message: String::new(),
            },
            Ok(resp) => ShiftResult {
                success: false,
                error_message: format!("ATOL HTTP status: {}", resp.status()),
            },
            Err(e) => ShiftResult {
                success: false,
                error_message: format!("Connection error: {e}"),
            },
        }
    }

    #[cfg(windows)]
    fn print_bank_slips_dll(&self, device: &Mutex<AtolDevice>, request: &FiscalRequest) {
        for slip in bank_slip_json_documents(request) {
            let json = slip.to_string();
            let dev = device.lock().unwrap();
            if let Err(e) = dev.process_json(&json) {
                let code = dev.lib.error_code(dev.handle);
                let desc = dev.lib.error_description(dev.handle);
                warn!(
                    code,
                    desc = %desc,
                    error = %e,
                    receipt_id = %request.receipt_id,
                    "ATOL DLL bank slip print failed after fiscal success"
                );
            }
        }
    }

    async fn print_bank_slips_http(
        &self,
        http: &reqwest::Client,
        base_url: &str,
        request: &FiscalRequest,
    ) {
        let url = format!("{base_url}/api/v2/requests");

        for slip in bank_slip_json_documents(request) {
            let atol_request = AtolHttpRawRequest {
                uuid: Uuid::new_v4().to_string(),
                request: vec![slip],
            };

            match http.post(&url).json(&atol_request).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        warn!(
                            status = %resp.status(),
                            receipt_id = %request.receipt_id,
                            "ATOL HTTP bank slip print returned non-success status"
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        receipt_id = %request.receipt_id,
                        "ATOL HTTP bank slip print failed after fiscal success"
                    );
                }
            }
        }
    }
}

fn clean_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn fiscal_measurement_unit(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        DEFAULT_MEASUREMENT_UNIT.into()
    } else {
        normalized.into()
    }
}

fn receipt_operation_type(receipt_type: &str) -> &'static str {
    match receipt_type {
        "refund" => "sellReturn",
        "correction" => "sellCorrection",
        "refund_correction" => "sellReturnCorrection",
        _ => "sell",
    }
}

#[derive(Clone)]
struct AtolCorrectionFields {
    correction_type: String,
    correction_base_date: String,
    correction_base_number: Option<String>,
}

fn correction_type_value(value: Option<&str>) -> String {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some("instruction") => "instruction".into(),
        _ => "self".into(),
    }
}

fn fallback_correction_base_date() -> String {
    chrono::Local::now().format("%Y.%m.%d").to_string()
}

fn fiscal_correction_fields(request: &FiscalRequest) -> Option<AtolCorrectionFields> {
    if request.receipt_type != "correction" && request.receipt_type != "refund_correction" {
        return None;
    }

    let correction = request.correction.as_ref();
    Some(AtolCorrectionFields {
        correction_type: correction_type_value(
            correction.map(|metadata| metadata.correction_type.as_str()),
        ),
        correction_base_date: clean_optional_string(
            correction.map(|metadata| metadata.correction_base_date.as_str()),
        )
        .unwrap_or_else(fallback_correction_base_date),
        correction_base_number: clean_optional_string(
            correction.map(|metadata| metadata.correction_base_number.as_str()),
        ),
    })
}

fn receipt_electronically(request: &FiscalRequest) -> Option<bool> {
    if request.receipt_print_options.print_receipt {
        return Some(false);
    }

    if request
        .customer_email
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warn!(
            receipt_id = %request.receipt_id,
            "ATOL paper receipt suppression requested without customer contact; printing paper receipt"
        );
        return Some(false);
    }

    Some(true)
}

fn document_text_items(lines: &[String], alignment: &str) -> Option<Vec<AtolDocumentTextItem>> {
    let items: Vec<AtolDocumentTextItem> = lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| AtolDocumentTextItem {
            item_type: "text".into(),
            text: line.to_owned(),
            alignment: alignment.into(),
        })
        .collect();

    if items.is_empty() { None } else { Some(items) }
}

#[cfg(windows)]
fn shift_operator_json(cashier: &str, cashier_inn: Option<&str>) -> serde_json::Value {
    let mut operator = serde_json::json!({ "name": cashier });
    if let Some(vatin) = clean_optional_string(cashier_inn) {
        operator["vatin"] = serde_json::Value::String(vatin);
    }
    operator
}

fn is_electronic_payment_method(method: &str) -> bool {
    matches!(method, "card" | "online" | "transfer" | "sbp")
}

fn electronic_payment_total_kopecks(request: &FiscalRequest) -> i64 {
    let explicit_total = request
        .payments
        .iter()
        .filter(|payment| is_electronic_payment_method(&payment.payment_method))
        .map(|payment| payment.amount_kopecks.abs())
        .sum::<i64>();

    if explicit_total > 0 {
        return explicit_total;
    }

    if is_electronic_payment_method(&request.payment_method) {
        request.total_kopecks.abs()
    } else {
        0
    }
}

fn payment_method_label(method: &str) -> &'static str {
    match method {
        "sbp" => "СБП",
        "card" | "online" | "transfer" => "КАРТА",
        "cash" => "НАЛИЧНЫЕ",
        _ => "БЕЗНАЛИЧНО",
    }
}

fn clean_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn first_electronic_payment(payments: &[FiscalPayment]) -> Option<&FiscalPayment> {
    payments
        .iter()
        .find(|payment| is_electronic_payment_method(&payment.payment_method))
}

fn card_display(payment: &FiscalPayment) -> Option<&str> {
    clean_text(&payment.card_mask).or_else(|| clean_text(&payment.card_info))
}

fn format_kopecks(kopecks: i64) -> String {
    format!("{:.2} руб.", kopecks.abs() as f64 / 100.0)
}

fn format_receipt_copy_quantity(quantity: f64) -> String {
    let rounded = quantity.round();
    if (quantity - rounded).abs() < f64::EPSILON {
        return format!("{rounded:.0}");
    }

    let value = format!("{quantity:.3}");
    value.trim_end_matches('0').trim_end_matches('.').to_owned()
}

fn push_receipt_copy_text(
    items: &mut Vec<serde_json::Value>,
    text: impl Into<String>,
    alignment: &str,
) {
    let text = text.into();
    if text.trim().is_empty() {
        return;
    }

    items.push(serde_json::json!({
        "type": "text",
        "text": text,
        "alignment": alignment
    }));
}

fn build_receipt_copy_document(request: &ReceiptCopyPrintRequest) -> serde_json::Value {
    let mut items = Vec::new();

    push_receipt_copy_text(&mut items, "КОПИЯ ДЛЯ КЛИЕНТА", "center");
    push_receipt_copy_text(&mut items, "НЕ ФИСКАЛЬНЫЙ ДОКУМЕНТ", "center");
    push_receipt_copy_text(
        &mut items,
        format!("ЧЕК: {}", request.receipt_number),
        "center",
    );
    push_receipt_copy_text(
        &mut items,
        format!("ДАТА: {}", request.created_at),
        "center",
    );
    push_receipt_copy_text(&mut items, "------------------------------", "center");

    for line in &request.lines {
        let name = line.name.trim();
        push_receipt_copy_text(
            &mut items,
            if name.is_empty() {
                "Позиция"
            } else {
                name
            },
            "left",
        );
        push_receipt_copy_text(
            &mut items,
            format!(
                "{} x {}",
                format_receipt_copy_quantity(line.quantity),
                format_kopecks(line.amount_kopecks),
            ),
            "left",
        );
    }

    push_receipt_copy_text(&mut items, "------------------------------", "center");
    push_receipt_copy_text(
        &mut items,
        format!("ИТОГО: {}", format_kopecks(request.total_kopecks)),
        "center",
    );

    for payment in &request.payments {
        push_receipt_copy_text(
            &mut items,
            format!(
                "{}: {}",
                payment_method_label(&payment.payment_method),
                format_kopecks(payment.amount_kopecks),
            ),
            "left",
        );
        if let Some(value) = clean_text(&payment.card_mask) {
            push_receipt_copy_text(&mut items, format!("КАРТА: {}", value), "left");
        }
        if let Some(value) = clean_text(&payment.approval_code) {
            push_receipt_copy_text(&mut items, format!("КОД АВТ: {}", value), "left");
        }
        if let Some(value) = clean_text(&payment.rrn) {
            push_receipt_copy_text(&mut items, format!("RRN: {}", value), "left");
        }
    }

    push_receipt_copy_text(&mut items, format!("КАССИР: {}", request.cashier), "left");

    serde_json::json!({
        "type": "nonFiscal",
        "items": items,
        "printFooter": true
    })
}

fn build_bank_slip_copy(
    request: &FiscalRequest,
    copy_label: &str,
    electronic_total_kopecks: i64,
) -> Vec<String> {
    let options = &request.bank_slip_options;
    let electronic_payment = first_electronic_payment(&request.payments);
    let payment_method = electronic_payment
        .map(|payment| payment.payment_method.as_str())
        .unwrap_or_else(|| {
            if request.payment_method.is_empty() {
                "card"
            } else {
                &request.payment_method
            }
        });
    let mut lines = vec![
        "БАНКОВСКИЙ СЛИП".to_owned(),
        copy_label.to_owned(),
        format!(
            "ОПЕРАЦИЯ: {}",
            if request.receipt_type == "refund" {
                "ВОЗВРАТ"
            } else {
                "ОПЛАТА"
            }
        ),
        format!("ТИП: {}", payment_method_label(payment_method)),
        format!("СУММА: {}", format_kopecks(electronic_total_kopecks)),
        format!("ЧЕК: {}", request.receipt_id),
    ];

    if options.include_card_mask {
        if let Some(value) = electronic_payment.and_then(card_display) {
            lines.push(format!("КАРТА: {}", value));
        }
    }

    if options.include_approval_code {
        if let Some(value) =
            electronic_payment.and_then(|payment| clean_text(&payment.approval_code))
        {
            lines.push(format!("КОД АВТ: {}", value));
        }
    }

    if options.include_rrn {
        if let Some(value) = electronic_payment.and_then(|payment| clean_text(&payment.rrn)) {
            lines.push(format!("RRN: {}", value));
        }
    }

    if options.include_sbp_id && payment_method == "sbp" {
        if let Some(value) =
            electronic_payment.and_then(|payment| clean_text(&payment.transaction_id))
        {
            lines.push(format!("ID СБП: {}", value));
        }
    }

    if request.receipt_print_options.show_cashier {
        lines.push(format!("КАССИР: {}", request.cashier));
    }

    lines.extend(
        request
            .bank_slip_options
            .footer_lines
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned),
    );

    lines
}

fn build_bank_slip_documents(request: &FiscalRequest) -> Vec<Vec<String>> {
    let options = &request.bank_slip_options;
    let electronic_total_kopecks = electronic_payment_total_kopecks(request);

    if !options.print_bank_slip_on_atol || electronic_total_kopecks == 0 {
        return Vec::new();
    }

    let copies = options.bank_slip_copies.clamp(1, 3);
    let mut documents = Vec::new();

    for _ in 0..copies {
        if options.print_merchant_copy {
            documents.push(build_bank_slip_copy(
                request,
                "КОПИЯ ПРОДАВЦА",
                electronic_total_kopecks,
            ));
        }

        if options.print_customer_copy {
            documents.push(build_bank_slip_copy(
                request,
                "КОПИЯ КЛИЕНТА",
                electronic_total_kopecks,
            ));
        }
    }

    documents
}

fn bank_slip_json_documents(request: &FiscalRequest) -> Vec<serde_json::Value> {
    build_bank_slip_documents(request)
        .into_iter()
        .map(|lines| {
            let items: Vec<serde_json::Value> = lines
                .into_iter()
                .map(|line| {
                    serde_json::json!({
                        "type": "text",
                        "text": line,
                        "alignment": "center"
                    })
                })
                .collect();

            serde_json::json!({
                "type": "nonFiscal",
                "items": items,
                "printFooter": true
            })
        })
        .collect()
}

fn payment_type_for_method(method: &str) -> &'static str {
    match method {
        "cash" => "cash",
        "card" | "online" | "transfer" | "sbp" => "electronically",
        "prepaid" | "advance" | "subscription" => "prepaid",
        _ => "electronically",
    }
}

fn fiscal_payment_rows(
    payments: &[FiscalPayment],
    fallback_method: &str,
    fallback_total_kopecks: i64,
) -> Vec<(String, f64)> {
    let rows: Vec<(String, f64)> = payments
        .iter()
        .filter(|payment| payment.amount_kopecks.abs() > 0)
        .map(|payment| {
            (
                payment_type_for_method(&payment.payment_method).to_string(),
                payment.amount_kopecks.abs() as f64 / 100.0,
            )
        })
        .collect();

    if rows.is_empty() {
        vec![(
            payment_type_for_method(fallback_method).to_string(),
            fallback_total_kopecks.abs() as f64 / 100.0,
        )]
    } else {
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_width_setting_maps_supported_widths_to_atol_values() {
        let narrow = paper_width_setting(58).unwrap();
        assert_eq!(narrow.parameter_id, ATOL_PAPER_WIDTH_SETTING_ID);
        assert_eq!(narrow.value, ATOL_PAPER_WIDTH_57_VALUE);
        assert_eq!(
            paper_width_setting(57).map(|setting| setting.value),
            Some(2)
        );
        assert_eq!(
            paper_width_setting(80).map(|setting| setting.value),
            Some(1)
        );
        assert_eq!(paper_width_setting(59), None);
    }

    #[test]
    fn fiscal_item_to_dll_item_conversion() {
        let item = FiscalItem {
            name: "Фото 10x15".into(),
            price_kopecks: 1500,
            quantity: 3,
            vat_rate: "none".into(),
            payment_method: "".into(),
            payment_object: "".into(),
            measurement_unit: "".into(),
        };
        let price_rub = item.price_kopecks as f64 / 100.0;
        let dll_item = DllItem {
            item_type: "position".into(),
            name: item.name.clone(),
            price: price_rub,
            quantity: item.quantity as f64,
            amount: price_rub * item.quantity as f64,
            tax: DllTax {
                tax_type: item.vat_rate.clone(),
            },
            payment_method: if item.payment_method.is_empty() {
                "fullPayment".into()
            } else {
                item.payment_method.clone()
            },
            payment_object: if item.payment_object.is_empty() {
                "commodity".into()
            } else {
                item.payment_object.clone()
            },
            measurement_unit: fiscal_measurement_unit(&item.measurement_unit),
        };
        let json = serde_json::to_value(&dll_item).unwrap();
        assert_eq!(json["type"], "position");
        assert_eq!(json["name"], "Фото 10x15");
        assert_eq!(json["price"], 15.0);
        assert_eq!(json["quantity"], 3.0);
        assert_eq!(json["amount"], 45.0);
        assert_eq!(json["measurementUnit"], "piece");
        assert_eq!(json["paymentMethod"], "fullPayment");
        assert_eq!(json["paymentObject"], "commodity");
    }

    #[test]
    fn dll_fiscal_request_serialization() {
        let req = DllFiscalRequest {
            op_type: "sell".into(),
            taxation_type: Some("osn".into()),
            correction_type: None,
            correction_base_date: None,
            correction_base_number: None,
            electronically: Some(false),
            operator: Some(DllOperator {
                name: "Иванов".into(),
                vatin: None,
            }),
            pre_items: None,
            post_items: None,
            items: Some(vec![DllItem {
                item_type: "position".into(),
                name: "Печать А4".into(),
                price: 10.0,
                quantity: 5.0,
                amount: 50.0,
                tax: DllTax {
                    tax_type: "none".into(),
                },
                payment_method: "fullPayment".into(),
                payment_object: "service".into(),
                measurement_unit: DEFAULT_MEASUREMENT_UNIT.into(),
            }]),
            payments: Some(vec![DllPayment {
                payment_type: "electronically".into(),
                sum: 50.0,
            }]),
            total: Some(50.0),
            client_info: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["type"], "sell");
        assert_eq!(json["taxationType"], "osn");
        assert_eq!(json["operator"]["name"], "Иванов");
        assert_eq!(json["items"].as_array().unwrap().len(), 1);
        assert_eq!(json["payments"][0]["type"], "electronically");
        assert_eq!(json["payments"][0]["sum"], 50.0);
        // clientInfo should be absent (skip_serializing_if)
        assert!(json.get("clientInfo").is_none());
    }

    #[test]
    fn dll_fiscal_request_with_client_info() {
        let req = DllFiscalRequest {
            op_type: "sell".into(),
            taxation_type: None,
            correction_type: None,
            correction_base_date: None,
            correction_base_number: None,
            electronically: None,
            operator: None,
            pre_items: None,
            post_items: None,
            items: None,
            payments: None,
            total: None,
            client_info: Some(DllClientInfo {
                email_or_phone: "test@example.com".into(),
            }),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["clientInfo"]["emailOrPhone"], "test@example.com");
        // taxationType should be absent
        assert!(json.get("taxationType").is_none());
    }

    #[test]
    fn dll_response_deserialize_success() {
        let json = r#"{
            "fiscalDocumentNumber": 42,
            "fiscalDocumentSign": 1234567890,
            "ofdUrl": "https://ofd.ru/check/42"
        }"#;
        let resp: DllResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.fiscal_document_number, Some(42));
        assert_eq!(resp.fiscal_document_sign, Some(1234567890));
        assert_eq!(resp.ofd_url.as_deref(), Some("https://ofd.ru/check/42"));
        assert!(resp.error.is_none());
    }

    #[test]
    fn dll_response_deserialize_error() {
        let json = r#"{"error": {"code": 3, "description": "Нет бумаги"}}"#;
        let resp: DllResponse = serde_json::from_str(json).unwrap();
        assert!(resp.fiscal_document_number.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, Some(3));
        assert_eq!(err.description.as_deref(), Some("Нет бумаги"));
    }

    #[test]
    fn http_response_deserialize_success() {
        let json = r#"{
            "results": [{
                "status": "ready",
                "payload": {
                    "fiscalDocumentNumber": 100,
                    "fiscalDocumentSign": 9876543210,
                    "ofdUrl": "https://ofd.ru/100"
                },
                "error": {"code": 0, "description": ""}
            }]
        }"#;
        let resp: AtolHttpResponse = serde_json::from_str(json).unwrap();
        let results = resp.results.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status.as_deref(), Some("ready"));
        let payload = results[0].payload.as_ref().unwrap();
        assert_eq!(payload.fiscal_document_number, Some(100));
    }

    #[test]
    fn http_response_empty_results() {
        let json = r#"{"results": null}"#;
        let resp: AtolHttpResponse = serde_json::from_str(json).unwrap();
        assert!(resp.results.is_none());
    }

    #[test]
    fn payment_type_mapping() {
        assert_eq!(payment_type_for_method("cash"), "cash");
        assert_eq!(payment_type_for_method("card"), "electronically");
        assert_eq!(payment_type_for_method("online"), "electronically");
        assert_eq!(payment_type_for_method("transfer"), "electronically");
        assert_eq!(payment_type_for_method("sbp"), "electronically");
        assert_eq!(payment_type_for_method("prepaid"), "prepaid");
        assert_eq!(payment_type_for_method("advance"), "prepaid");
        assert_eq!(payment_type_for_method("subscription"), "prepaid");
        assert_eq!(payment_type_for_method("unknown"), "electronically");
    }

    #[test]
    fn fiscal_payment_rows_use_explicit_payments() {
        let rows = fiscal_payment_rows(
            &[
                FiscalPayment {
                    payment_method: "prepaid".into(),
                    amount_kopecks: 20_000,
                    transaction_id: String::new(),
                    approval_code: String::new(),
                    rrn: String::new(),
                    card_mask: String::new(),
                    card_info: String::new(),
                },
                FiscalPayment {
                    payment_method: "cash".into(),
                    amount_kopecks: 10_000,
                    transaction_id: String::new(),
                    approval_code: String::new(),
                    rrn: String::new(),
                    card_mask: String::new(),
                    card_info: String::new(),
                },
            ],
            "card",
            30_000,
        );

        assert_eq!(
            rows,
            vec![("prepaid".into(), 200.0), ("cash".into(), 100.0)]
        );
    }

    #[test]
    fn fiscal_payment_rows_fallback_to_top_level_method() {
        let rows = fiscal_payment_rows(&[], "sbp", 30_000);
        assert_eq!(rows, vec![("electronically".into(), 300.0)]);
    }

    #[test]
    fn fiscal_payment_rows_use_absolute_refund_amounts() {
        let rows = fiscal_payment_rows(
            &[
                FiscalPayment {
                    payment_method: "prepaid".into(),
                    amount_kopecks: -20_000,
                    transaction_id: String::new(),
                    approval_code: String::new(),
                    rrn: String::new(),
                    card_mask: String::new(),
                    card_info: String::new(),
                },
                FiscalPayment {
                    payment_method: "cash".into(),
                    amount_kopecks: -10_000,
                    transaction_id: String::new(),
                    approval_code: String::new(),
                    rrn: String::new(),
                    card_mask: String::new(),
                    card_info: String::new(),
                },
            ],
            "card",
            -30_000,
        );

        assert_eq!(
            rows,
            vec![("prepaid".into(), 200.0), ("cash".into(), 100.0)]
        );
    }

    #[test]
    fn fiscal_payment_rows_negative_fallback_uses_absolute_total() {
        let rows = fiscal_payment_rows(&[], "sbp", -30_000);
        assert_eq!(rows, vec![("electronically".into(), 300.0)]);
    }

    #[test]
    fn receipt_type_to_op_type() {
        assert_eq!(receipt_operation_type("sale"), "sell");
        assert_eq!(receipt_operation_type("refund"), "sellReturn");
        assert_eq!(receipt_operation_type("correction"), "sellCorrection");
        assert_eq!(receipt_operation_type(""), "sell");
    }

    #[test]
    fn kopecks_to_rubles_conversion() {
        assert_eq!(15000_i64 as f64 / 100.0, 150.0);
        assert_eq!(1_i64 as f64 / 100.0, 0.01);
        assert_eq!(99_i64 as f64 / 100.0, 0.99);
        assert_eq!(0_i64 as f64 / 100.0, 0.0);
    }

    #[test]
    fn http_request_serialization() {
        let req = AtolHttpRequest {
            uuid: "test-uuid-123".into(),
            request: vec![AtolOperation {
                op_type: "sell".into(),
                taxation_type: Some("osn".into()),
                correction_type: None,
                correction_base_date: None,
                correction_base_number: None,
                electronically: Some(false),
                operator: Some(AtolOperator {
                    name: "Кассир".into(),
                    vatin: None,
                }),
                pre_items: None,
                post_items: None,
                items: Some(vec![AtolHttpItem {
                    item_type: "position".into(),
                    name: "Услуга".into(),
                    price: 100.0,
                    quantity: 1,
                    amount: 100.0,
                    tax: AtolTax {
                        tax_type: "none".into(),
                    },
                    payment_method: "fullPayment".into(),
                    payment_object: "service".into(),
                    measurement_unit: DEFAULT_MEASUREMENT_UNIT.into(),
                }]),
                payments: Some(vec![AtolPayment {
                    payment_type: "cash".into(),
                    sum: 100.0,
                }]),
                total: Some(100.0),
                client_info: None,
            }],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["uuid"], "test-uuid-123");
        let op = &json["request"][0];
        assert_eq!(op["type"], "sell");
        assert_eq!(op["taxationType"], "osn");
        assert_eq!(op["operator"]["name"], "Кассир");
        assert_eq!(op["items"][0]["paymentMethod"], "fullPayment");
        assert_eq!(op["items"][0]["paymentObject"], "service");
        assert_eq!(op["items"][0]["measurementUnit"], DEFAULT_MEASUREMENT_UNIT);
        assert_eq!(op["payments"][0]["type"], "cash");
        assert!(op.get("clientInfo").is_none());
    }

    #[test]
    fn correction_request_serializes_required_atol_fields() {
        let req = DllFiscalRequest {
            op_type: receipt_operation_type("correction").into(),
            taxation_type: Some("usnIncome".into()),
            correction_type: Some("self".into()),
            correction_base_date: Some("2026.05.24".into()),
            correction_base_number: Some("ФД 4773".into()),
            electronically: Some(false),
            operator: Some(DllOperator {
                name: "Ольга".into(),
                vatin: Some("123456789012".into()),
            }),
            pre_items: None,
            post_items: None,
            items: Some(vec![DllItem {
                item_type: "position".into(),
                name: "Фото 20x30 супер".into(),
                price: 140.0,
                quantity: 1.0,
                amount: 140.0,
                tax: DllTax {
                    tax_type: "none".into(),
                },
                payment_method: "fullPayment".into(),
                payment_object: "commodity".into(),
                measurement_unit: DEFAULT_MEASUREMENT_UNIT.into(),
            }]),
            payments: Some(vec![DllPayment {
                payment_type: "electronically".into(),
                sum: 150.0,
            }]),
            total: Some(150.0),
            client_info: None,
        };

        let json = serde_json::to_value(&req).unwrap();

        assert_eq!(json["type"], "sellCorrection");
        assert_eq!(json["correctionType"], "self");
        assert_eq!(json["correctionBaseDate"], "2026.05.24");
        assert_eq!(json["correctionBaseNumber"], "ФД 4773");
        assert_eq!(json["items"][0]["measurementUnit"], "piece");
    }

    #[test]
    fn cash_drawer_request_serialization() {
        let req = AtolHttpRequest {
            uuid: "test-cash-drawer".into(),
            request: vec![AtolOperation {
                op_type: "openCashDrawer".into(),
                taxation_type: None,
                correction_type: None,
                correction_base_date: None,
                correction_base_number: None,
                electronically: None,
                operator: None,
                pre_items: None,
                post_items: None,
                items: None,
                payments: None,
                total: None,
                client_info: None,
            }],
        };

        let json = serde_json::to_value(&req).unwrap();
        let op = &json["request"][0];
        assert_eq!(op["type"], "openCashDrawer");
        assert!(op.get("operator").is_none());
        assert!(op.get("items").is_none());
        assert!(op.get("payments").is_none());
    }

    #[test]
    fn fiscal_shift_status_from_raw_maps_atol_values() {
        assert_eq!(super::fiscal_shift_status_from_raw(0), "closed");
        assert_eq!(super::fiscal_shift_status_from_raw(1), "open");
        assert_eq!(super::fiscal_shift_status_from_raw(2), "expired");
        assert_eq!(super::fiscal_shift_status_from_raw(999), "unknown");
    }

    #[test]
    fn operator_serializes_vatin_when_cashier_inn_is_present() {
        let operator = DllOperator {
            name: "Ольга".into(),
            vatin: Some("123456789012".into()),
        };

        let json = serde_json::to_value(&operator).unwrap();

        assert_eq!(json["name"], "Ольга");
        assert_eq!(json["vatin"], "123456789012");
    }

    #[test]
    fn bank_slip_documents_render_merchant_and_customer_copies() {
        let request = FiscalRequest {
            receipt_id: "receipt-42".into(),
            receipt_type: "sale".into(),
            items: Vec::new(),
            payment_method: "card".into(),
            payments: vec![FiscalPayment {
                payment_method: "card".into(),
                amount_kopecks: 12_345,
                transaction_id: "tx-card-1".into(),
                approval_code: "A12345".into(),
                rrn: "999888777666".into(),
                card_mask: "****3456".into(),
                card_info: String::new(),
            }],
            total_kopecks: 12_345,
            cashier: "Ольга".into(),
            cashier_inn: Some("123456789012".into()),
            customer_email: None,
            taxation_type: None,
            receipt_print_options: FiscalReceiptPrintOptions::default(),
            bank_slip_options: BankSlipPrintOptions {
                print_bank_slip_on_atol: true,
                bank_slip_copies: 1,
                print_merchant_copy: true,
                print_customer_copy: true,
                include_rrn: true,
                include_approval_code: true,
                include_card_mask: true,
                include_sbp_id: true,
                footer_lines: vec!["Спасибо".into()],
            },
            correction: None,
        };

        let documents = build_bank_slip_documents(&request);

        assert_eq!(documents.len(), 2);
        assert!(documents[0].iter().any(|line| line == "КОПИЯ ПРОДАВЦА"));
        assert!(documents[1].iter().any(|line| line == "КОПИЯ КЛИЕНТА"));
        assert!(documents[0].iter().any(|line| line == "ЧЕК: receipt-42"));
        assert!(documents[0].iter().any(|line| line == "КАРТА: ****3456"));
        assert!(documents[0].iter().any(|line| line == "КОД АВТ: A12345"));
        assert!(documents[0].iter().any(|line| line == "RRN: 999888777666"));
        assert!(documents[1].iter().any(|line| line == "Спасибо"));
    }

    #[test]
    fn receipt_copy_document_renders_customer_copy_lines() {
        let doc = build_receipt_copy_document(&ReceiptCopyPrintRequest {
            receipt_number: "SF-POS-000804".into(),
            created_at: "25.06.2026 12:21".into(),
            lines: vec![
                ReceiptCopyLine {
                    name: "Фото для пропуска".into(),
                    quantity: 1.0,
                    amount_kopecks: 70_000,
                },
                ReceiptCopyLine {
                    name: "Максимальная обработка".into(),
                    quantity: 1.0,
                    amount_kopecks: 140_000,
                },
            ],
            payments: vec![ReceiptCopyPayment {
                payment_method: "card".into(),
                amount_kopecks: 210_000,
                approval_code: "076671".into(),
                rrn: "617609255403".into(),
                card_mask: "************3904".into(),
            }],
            total_kopecks: 210_000,
            cashier: "Администратор".into(),
        });

        let items = doc["items"].as_array().expect("items");
        assert!(items.iter().any(|item| item["text"] == "КОПИЯ ДЛЯ КЛИЕНТА"));
        assert!(
            items
                .iter()
                .any(|item| item["text"] == "ЧЕК: SF-POS-000804")
        );
        assert!(
            items
                .iter()
                .any(|item| item["text"] == "ИТОГО: 2100.00 руб.")
        );
        assert!(
            items
                .iter()
                .any(|item| item["text"] == "КАРТА: ************3904")
        );
        assert!(items.iter().any(|item| item["text"] == "RRN: 617609255403"));
    }
}
