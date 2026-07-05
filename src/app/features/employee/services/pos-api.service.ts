import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PosShift {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_number: number;
  opened_at: string;
  closed_at: string | null;
  cash_at_open: number;
  cash_at_close: number | null;
  expected_cash: number | null;
  fiscal_enabled: boolean;
  status: 'open' | 'closed';
  total_sales: number;
  total_refunds: number;
  receipt_count: number;
  cash_collected?: number | null;
  collection_count?: number | null;
  fiscal_status?: PosShiftFiscalStatus | null;
}

export interface PosShiftFiscalStatus {
  ready: boolean;
  available: boolean;
  source: 'telemetry' | 'transaction' | 'none';
  shift_status: string | null;
  checked_at: string | null;
  opened_at: string | null;
  opened_by: string | null;
  opened_by_id: string | null;
  transaction_id: string | null;
  command_status: string | null;
}

export interface PosFiscalReceiptSettings {
  print_receipt: boolean;
  receipt_copies: number;
  header_lines: string[];
  footer_lines: string[];
  show_cashier: boolean;
  show_receipt_number: boolean;
  show_order_number: boolean;
  show_customer: boolean;
  cashier_inn: string | null;
}

export interface PosFiscalSlipSettings {
  print_bank_slip_on_atol: boolean;
  bank_slip_copies: number;
  print_merchant_copy: boolean;
  print_customer_copy: boolean;
  include_rrn: boolean;
  include_approval_code: boolean;
  include_card_mask: boolean;
  include_sbp_id: boolean;
  footer_lines: string[];
}

export interface PosFiscalShiftSettings {
  auto_open_before_card_sbp: boolean;
  auto_close_on_last_pos_shift_close: boolean;
  print_open_report: boolean;
  print_close_report: boolean;
}

export interface PosFiscalSettings {
  studio_id: string;
  agent_id: string | null;
  enabled: boolean;
  receipt_settings: PosFiscalReceiptSettings;
  slip_settings: PosFiscalSlipSettings;
  shift_settings: PosFiscalShiftSettings;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PosFiscalSettingsUpdate {
  studio_id: string;
  agent_id?: string | null;
  enabled?: boolean;
  receipt_settings?: Partial<PosFiscalReceiptSettings>;
  slip_settings?: Partial<PosFiscalSlipSettings>;
  shift_settings?: Partial<PosFiscalShiftSettings>;
}

export interface PosReceiptItem {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  discount_percent: number;
  points_used: number;
  subscription_credits_used: number;
  total: number;
  vat_rate?: string;
  discount_type?: string | null;
  discount_label?: string | null;
  student_discount_benefit?: StudentDiscountBenefitType | null;
  student_discount_units?: number | null;
  print_fill_percent?: number | string | null;
  print_order_id?: string | null;
}

export interface PosReceiptPayment {
  payment_type: 'cash' | 'card' | 'sbp' | 'online' | 'subscription' | 'transfer';
  amount: number;
  card_info?: string;
  transaction_id?: string;
  transaction_status?: string | null;
  payment_resolution?: string | null;
  effective_status?: string | null;
  terminal_error_message?: string | null;
  terminal_initiated_at?: string | null;
  terminal_completed_at?: string | null;
}

export interface PosSubscriptionCoverageLine {
  index: number;
  product_id: string;
  credit_product_id: string;
  product_name: string;
  quantity: number;
  credit_multiplier: number;
  coverage_multiplier?: number;
  coverage_percent?: number | null;
  covered_quantity: number;
  remaining_quantity: number;
  credits_consumed: number;
  covered_amount: number;
}

export interface PosSubscriptionCoverageResult {
  subscription_id: string;
  total_covered_amount: number;
  total_credits_consumed: number;
  items: PosSubscriptionCoverageLine[];
}

export interface PosReceipt {
  id: string;
  receipt_number: string;
  shift_id: string | null;
  employee_id?: string;
  employee_name?: string | null;
  studio_id?: string;
  studio_name?: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  is_refund: boolean;
  subtotal: number;
  discount_total: number;
  points_discount: number;
  subscription_credit_used: number;
  total: number;
  items: PosReceiptItem[];
  payments: PosReceiptPayment[];
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
  fiscal_status?: 'pending' | 'queued' | 'processing' | 'success' | 'failed' | 'skipped';
  fiscal_attempts?: number;
  fiscal_last_error?: string | null;
}

export interface PosReceiptListParams {
  shift_id?: string;
  studio_id?: string;
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  customer_phone?: string;
  is_refund?: boolean;
  limit?: number;
  offset?: number;
}

export interface PosReceiptListResponse {
  items: PosReceipt[];
  total: number;
}

export interface PosShiftListParams {
  studio_id?: string;
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  status?: PosShift['status'];
  limit?: number;
  offset?: number;
}

export interface PosShiftListResponse {
  items: PosShift[];
  total: number;
}

export interface CashControlParams {
  studio_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface CashControlShift {
  id: string;
  shift_number: number;
  employee_id: string;
  employee_name: string;
  studio_id: string;
  studio_name: string;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  cash_at_open: number;
  cash_sales: number;
  withdrawals: number;
  expected_cash: number | null;
  cash_at_close: number | null;
  diff: number | null;
  reconciled: boolean;
}

export interface CashControlOrphanDay {
  day: string;
  count: number;
  sum: number;
}

export interface CashControlOrphanEmployee {
  employee_id: string | null;
  employee_name: string;
  count: number;
  sum: number;
}

export interface CashControlOrphan {
  count: number;
  sum: number;
  by_day: CashControlOrphanDay[];
  by_employee: CashControlOrphanEmployee[];
}

export interface CashControlResponse {
  shifts: CashControlShift[];
  orphan_cash: CashControlOrphan;
}

export interface PosOpenShiftResponse {
  shift: PosShift;
  employeeShiftId?: string;
  fiscalTransactionId?: string | null;
}

export interface PosOpenFiscalShiftResponse {
  shift: PosShift;
  fiscalCommandEnqueued: boolean;
  fiscalTransactionId?: string | null;
}

export type PosCloseFiscalShiftResponse = PosOpenFiscalShiftResponse;

export interface PosBridgeTransaction {
  id: string;
  status: string;
  transaction_type: string;
  error_message: string | null;
  terminal_response: PosBridgeTerminalResponse | null;
}

export interface PosBridgeTerminalResponse {
  approval_code?: string | null;
  response_code?: string | null;
  rrn?: string | null;
  card_mask?: string | null;
  sbp_paid?: boolean | null;
  bank_report?: string | null;
  [key: string]: unknown;
}

/**
 * Снимок корзины, передаваемый вместе с оплатой картой. Если оплата зависнет
 * (in_doubt), backend сохранит его в command_payload payment-транзакции, чтобы
 * чек можно было допробить без потери номенклатуры и без повторного списания.
 */
export interface PosPaymentSnapshot {
  items: PosReceiptItem[];
  subtotal: number;
  total: number;
  discount_total?: number;
  shiftId?: string;
  studioId?: string;
  customerPhone?: string;
  customerName?: string;
  promoCode?: string;
  loyaltyProfileId?: string;
  clientUserId?: string;
  clientContactId?: string;
  /** Источник состава: прямая корзина или прайс-конфигуратор услуг. */
  source?: 'cart' | 'from_pricing';
}

/**
 * Параметры прайс-конфигуратора для ветки «услуги»: бэкенд сам считает состав
 * через `buildPricingReceiptItems` и персистит canonical snapshot до списания.
 */
export interface PosBridgePricing {
  category_slug: string;
  selected_options: {
    option_slug: string;
    quantity: number;
    pricing_group_key?: string;
    print_fill_percent?: number | null;
    fill_percent?: number | null;
    coverage_percent?: number | null;
    print_order_id?: string | null;
  }[];
  delivery_method?: 'electronic' | 'pickup' | 'postal';
  promo_code?: string;
  customer_phone?: string;
  client_user_id?: string;
  client_contact_id?: string;
  loyalty_profile_id?: string;
  apply_volume_discount?: boolean;
}

export interface PosBridgePayRequest {
  amount: number;
  orderId: string;
  studioId: string;
  /** Снимок корзины для допробития чека при зависшей оплате (in_doubt). */
  snapshot?: PosPaymentSnapshot;
  /** Прайс-параметры для ветки «услуги»: состав считает бэкенд (order-first). */
  pricing?: PosBridgePricing;
}

export interface PosBridgeRefundRequest {
  studioId: string;
  transactionId: string;
}

export interface PosBridgePayResponse {
  success: boolean;
  transactionId?: string;
  cardInfo?: string;
}

export type PosBridgeRefundResponse = Pick<PosBridgePayResponse, 'success' | 'transactionId'>;

export interface PosBridgeStatus {
  terminal: string;
  fiscal: string;
  online?: boolean;
  agentId?: string | null;
  lastHeartbeat?: string | null;
  /** true/false по свежей телеметрии, null — данных нет либо снимок устарел (мягкая деградация). */
  terminalOnline: boolean | null;
  terminalCheckedAt?: string | null;
}

export interface PosInDoubtPayment {
  id: string;
  amount: number;
  orderId: string | null;
  terminalOrderId?: string | null;
  initiatedAt: string | null;
  initiatedByName?: string | null;
  status: string;
  errorMessage: string | null;
  /** Снимок корзины из command_payload (если фронт прислал его при оплате). */
  snapshot?: PosPaymentSnapshot | null;
}

/**
 * Осиротевшая карт-оплата: списание прошло (`status='completed'`), но чек не
 * оформлен. Shape совместим с `PosInDoubtPayment`; `kind:'orphan'` отличает её
 * во вкладке «Оплата без чека». Снимок корзины обычно отсутствует — кассир
 * вводит позиции вручную.
 */
export interface PosOrphanPayment extends PosInDoubtPayment {
  kind: 'orphan';
}

export type PosPaymentResolveOutcome = 'paid' | 'unpaid';

export interface PosPaymentResolveResult {
  success: boolean;
  payment_resolution: 'resolved_paid' | 'resolved_unpaid';
  receipt?: PosReceipt;
  fiscalized?: boolean;
  fiscalWarning?: string;
}

export interface TopService {
  product_name: string;
  quantity: number;
  revenue: number;
}

export interface PosCashMovement {
  id: string;
  shift_id: string;
  studio_id: string;
  employee_id: string;
  employee_name?: string | null;
  movement_type: 'withdrawal';
  amount: number;
  reason: string;
  created_at: string;
}

export interface OnlineSalesSection {
  count: number;
  amount: number;
  commission: number;
}

export interface ShiftReport {
  shift: PosShift;
  receipts_count: number;
  refunds_count: number;
  voided_count: number;
  total_sales: number;
  total_refunds: number;
  net_sales: number;
  avg_receipt: number;
  cash_payments: number;
  cash_withdrawals: number;
  cash_withdrawal_count: number;
  cash_movements: PosCashMovement[];
  card_payments: number;
  sbp_payments: number;
  employee_name: string;
  studio_name: string;
  top_services: TopService[];
  online_sales?: OnlineSalesSection;
}

export type StudentDiscountBenefitType = 'print_a4_bw' | 'print_a4_color' | 'binding_spring_a4';

export type StudentDiscountStatus = 'active' | 'expired' | 'revoked' | (string & {});

export interface StudentDiscountInfo {
  status: StudentDiscountStatus;
  source_token: string;
  activated_at: string;
  expires_at: string;
  print_sheets_limit: number;
  print_sheets_used: number;
  print_sheets_remaining: number;
  print_sheet_price?: number;
  max_print_fill_percent?: number;
  allowance_period_id?: string | null;
  allowance_period_start?: string | null;
  allowance_period_end?: string | null;
  binding_limit: number;
  binding_uses: number;
  binding_remaining: number;
}

export interface CustomerLookup {
  loyalty: {
    id: string;
    points: number;
    totalPointsEarned: number;
    level: number;
    levelName: string;
    pointsAsRubles: number;
    conversionRate: number;
    total_spent: number;
    can_spend_points: number;
    referral_code: string | null;
    invited_count: number;
    referred_by_name: string | null;
  } | null;
  subscription: {
    id: string;
    plan_name: string;
    status: string;
    credits: { product_id: string; product_name: string; remaining: number }[];
  } | null;
  student_discount?: StudentDiscountInfo | null;
  recent_receipts: number;
  customer_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class PosApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/pos';

  // Shifts
  openShift(data: { employee_id: string; studio_id: string; cash_at_open: number; fiscal_enabled?: boolean }): Observable<PosShift> {
    return this.openShiftWithFiscalCommand(data).pipe(map(r => r.shift));
  }

  openShiftWithFiscalCommand(data: {
    employee_id: string;
    studio_id: string;
    cash_at_open: number;
    fiscal_enabled?: boolean;
  }): Observable<PosOpenShiftResponse> {
    return this.http.post<{
      success: boolean;
      shift: PosShift;
      employeeShiftId?: string;
      fiscalTransactionId?: string | null;
    }>(`${this.base}/shifts/open`, data).pipe(
      map(r => ({
        shift: r.shift,
        employeeShiftId: r.employeeShiftId,
        fiscalTransactionId: r.fiscalTransactionId,
      })),
    );
  }

  openShiftFiscal(shiftId: string): Observable<PosShift> {
    return this.openShiftFiscalWithCommand(shiftId).pipe(map(r => r.shift));
  }

  openShiftFiscalWithCommand(shiftId: string): Observable<PosOpenFiscalShiftResponse> {
    return this.http.post<{
      success: boolean;
      shift: PosShift;
      fiscalCommandEnqueued: boolean;
      fiscalTransactionId?: string | null;
    }>(`${this.base}/shifts/${shiftId}/fiscal/open`, {}).pipe(
      map(r => ({
        shift: r.shift,
        fiscalCommandEnqueued: r.fiscalCommandEnqueued,
        fiscalTransactionId: r.fiscalTransactionId,
      })),
    );
  }

  closeShiftFiscalWithCommand(shiftId: string): Observable<PosCloseFiscalShiftResponse> {
    return this.http.post<{
      success: boolean;
      shift: PosShift;
      fiscalCommandEnqueued: boolean;
      fiscalTransactionId?: string | null;
    }>(`${this.base}/shifts/${shiftId}/fiscal/close`, {}).pipe(
      map(r => ({
        shift: r.shift,
        fiscalCommandEnqueued: r.fiscalCommandEnqueued,
        fiscalTransactionId: r.fiscalTransactionId,
      })),
    );
  }

  getFiscalSettings(studioId: string): Observable<PosFiscalSettings> {
    return this.http.get<{ success: boolean; settings: PosFiscalSettings }>(
      `${this.base}/fiscal/settings`,
      { params: { studio_id: studioId } },
    ).pipe(map(r => r.settings));
  }

  updateFiscalSettings(data: PosFiscalSettingsUpdate): Observable<PosFiscalSettings> {
    return this.http.put<{ success: boolean; settings: PosFiscalSettings }>(
      `${this.base}/fiscal/settings`,
      data,
    ).pipe(map(r => r.settings));
  }

  closeShift(data: {
    shift_id: string;
    employee_id: string;
    cash_at_close: number;
    notes?: string;
    denominations?: { denomination: number; type: 'banknote' | 'coin'; count: number }[];
  }): Observable<{ shift: PosShift; zReportSent: boolean; fiscalTransactionId?: string | null }> {
    return this.http.post<{
      success: boolean;
      shift: PosShift;
      zReportSent: boolean;
      fiscalTransactionId?: string | null;
    }>(`${this.base}/shifts/close`, data)
      .pipe(map(r => ({
        shift: r.shift,
        zReportSent: r.zReportSent,
        fiscalTransactionId: r.fiscalTransactionId,
      })));
  }

  getCurrentShift(employeeId: string): Observable<PosShift | null> {
    return this.http.get<{ success: boolean; shift: PosShift | null }>(`${this.base}/shifts/current`, {
      params: { employee_id: employeeId },
    }).pipe(map(r => r.shift));
  }

  getShifts(params?: PosShiftListParams): Observable<PosShiftListResponse> {
    return this.http.get<{ success: boolean; items: PosShift[]; total: number }>(
      `${this.base}/shifts`,
      { params: this.buildShiftParams(params) },
    ).pipe(map(r => ({ items: r.items, total: r.total })));
  }

  getCashControl(params?: CashControlParams): Observable<CashControlResponse> {
    let httpParams = new HttpParams();
    if (params?.studio_id) httpParams = httpParams.set('studio_id', params.studio_id);
    if (params?.date_from) httpParams = httpParams.set('date_from', params.date_from);
    if (params?.date_to) httpParams = httpParams.set('date_to', params.date_to);
    return this.http.get<{ success: boolean } & CashControlResponse>(
      `${this.base}/cash-control`,
      { params: httpParams },
    ).pipe(map(r => ({ shifts: r.shifts, orphan_cash: r.orphan_cash })));
  }

  getShiftReport(shiftId: string): Observable<ShiftReport> {
    return this.http.get<{ success: boolean; report: ShiftReport }>(`${this.base}/shifts/${shiftId}/report`)
      .pipe(map(r => r.report));
  }

  createCashWithdrawal(shiftId: string, data: { amount: number; reason: string }): Observable<PosCashMovement> {
    return this.http.post<{ success: boolean; movement: PosCashMovement }>(
      `${this.base}/shifts/${shiftId}/cash-withdrawals`,
      data,
    ).pipe(map(r => r.movement));
  }

  // Receipts
  createReceipt(data: {
    shift_id?: string;
    employee_id: string;
    studio_id: string;
    customer_phone?: string;
    customer_name?: string;
    loyalty_profile_id?: string;
    subscription_id?: string;
    items: PosReceiptItem[];
    payments: PosReceiptPayment[];
    subtotal: number;
    discount_total?: number;
    points_discount?: number;
    subscription_credit_used?: number;
    total: number;
    promo_code?: string;
    loyalty_points_to_use?: number;
    print_order_id?: string | null;
    fiscal_required?: boolean;
  }): Observable<PosReceipt> {
    return this.http.post<{ success: boolean; receipt: PosReceipt }>(`${this.base}/receipts`, data)
      .pipe(map(r => r.receipt));
  }

  calculateSubscriptionCoverage(data: {
    subscription_id: string;
    items: PosReceiptItem[];
  }): Observable<PosSubscriptionCoverageResult> {
    return this.http.post<{ success: boolean; coverage: PosSubscriptionCoverageResult }>(
      `${this.base}/subscription-coverage`,
      data,
    ).pipe(map(r => r.coverage));
  }

  /**
   * Создать чек через pricing engine (server-side расчёт цены).
   * Используется для студийных услуг из PricingConfigurator.
   */
  createFromPricing(data: {
    category_slug: string;
    selected_options: {
      option_slug: string;
      quantity: number;
      pricing_group_key?: string;
      print_fill_percent?: number | null;
      fill_percent?: number | null;
      coverage_percent?: number | null;
      print_order_id?: string | null;
    }[];
    delivery_method: 'electronic' | 'pickup' | 'postal';
    shift_id?: string;
    employee_id: string;
    studio_id: string;
    customer_phone?: string;
    client_user_id?: string;
    client_contact_id?: string;
    customer_name?: string;
    loyalty_profile_id?: string;
    subscription_id?: string;
    payments: PosReceiptPayment[];
    loyalty_points_to_use?: number;
    promo_code?: string;
    manual_amount?: number;
    manual_description?: string;
    apply_volume_discount?: boolean;
    print_order_id?: string | null;
    fiscal_required?: boolean;
    /** Конфигуратор «Супер обработки» — лист-задание ретушёру (необязательно) */
    retouch_config?: {
      gender?: 'male' | 'female' | 'any';
      groups: Record<string, string[]>;
      notes?: string;
    };
  }): Observable<PosReceipt> {
    return this.http.post<{ success: boolean; receipt: PosReceipt }>(
      `${this.base}/receipts/from-pricing`, data
    ).pipe(map(r => r.receipt));
  }

  refundReceipt(receiptId: string, data: { shift_id: string; employee_id: string }): Observable<PosReceipt> {
    return this.http.post<{ success: boolean; receipt: PosReceipt }>(`${this.base}/receipts/${receiptId}/refund`, data)
      .pipe(map(r => r.receipt));
  }

  voidReceipt(receiptId: string, data: { shift_id: string; reason: string }): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/receipts/${receiptId}/void`, data);
  }

  partialRefund(receiptId: string, data: { shift_id: string; studio_id: string; items: PartialRefundItem[] }): Observable<PosReceipt> {
    return this.http.post<{ success: boolean; data: { receipt: PosReceipt } }>(
      `${this.base}/receipts/${receiptId}/partial-refund`, data
    ).pipe(map(r => r.data.receipt));
  }

  getReceiptsPage(params?: PosReceiptListParams): Observable<PosReceiptListResponse> {
    return this.http.get<{ success: boolean; items: PosReceipt[]; total: number }>(
      `${this.base}/receipts`,
      { params: this.buildReceiptParams(params) },
    ).pipe(map(r => ({ items: r.items, total: r.total })));
  }

  getReceipts(params?: PosReceiptListParams): Observable<PosReceipt[]> {
    return this.getReceiptsPage(params)
      .pipe(map(r => r.items));
  }

  getReceiptById(id: string): Observable<PosReceipt> {
    return this.http.get<{ success: boolean; receipt: PosReceipt }>(`${this.base}/receipts/${id}`)
      .pipe(map(r => r.receipt));
  }

  // Customer
  lookupCustomer(phone: string): Observable<CustomerLookup> {
    return this.http.get<{ success: boolean } & CustomerLookup>(`${this.base}/customer/${phone}`)
      .pipe(map(({ success: _success, ...data }) => data));
  }

  // Bridge
  bridgePay(data: PosBridgePayRequest): Observable<PosBridgePayResponse> {
    return this.http.post<PosBridgePayResponse>(`${this.base}/bridge/pay`, data);
  }

  bridgeRefund(data: PosBridgeRefundRequest): Observable<PosBridgeRefundResponse> {
    return this.http.post<PosBridgeRefundResponse>(`${this.base}/bridge/refund`, data);
  }

  openCashDrawer(studioId: string): Observable<{ success: boolean; transactionId?: string }> {
    return this.http.post<{ success: boolean; transactionId?: string }>(`${this.base}/bridge/cash-drawer`, { studioId });
  }

  bridgeBankSettlement(studioId: string): Observable<{ success: boolean; transactionId?: string }> {
    return this.http.post<{ success: boolean; transactionId?: string }>(
      `${this.base}/bridge/bank-settlement`,
      { studioId },
    );
  }

  bridgeFiscal(data: Record<string, unknown>): Observable<{ success: boolean; fiscalNumber?: string; fiscalSign?: string }> {
    return this.http.post<{ success: boolean; fiscalNumber?: string; fiscalSign?: string }>(`${this.base}/bridge/fiscal`, data);
  }

  bridgeStatus(): Observable<PosBridgeStatus> {
    return this.http.get<PosBridgeStatus>(`${this.base}/bridge/status`).pipe(
      map(r => ({
        ...r,
        terminalOnline: r.terminalOnline ?? null,
      })),
    );
  }

  /** Зависшие оплаты (in_doubt + старые pending/processing) по студии для контура детекта. */
  getInDoubtPayments(studioId: string): Observable<PosInDoubtPayment[]> {
    return this.http.get<{ success: boolean; items: PosInDoubtPayment[] }>(
      `${this.base}/payments/in-doubt`,
      { params: { studioId } },
    ).pipe(map(r => r.items ?? []));
  }

  /**
   * Разрешить зависшую оплату. `paid` (за серверным флагом) создаёт чек по
   * сохранённому снимку или переданным позициям и пробивает приход на ККТ БЕЗ
   * повторного списания; `unpaid` помечает оплату как несостоявшуюся.
   */
  resolvePayment(
    paymentId: string,
    data: { outcome: PosPaymentResolveOutcome; items?: PosReceiptItem[] },
  ): Observable<PosPaymentResolveResult> {
    return this.http.post<PosPaymentResolveResult>(
      `${this.base}/payments/${encodeURIComponent(paymentId)}/resolve`,
      data,
    );
  }

  /**
   * Осиротевшие карт-оплаты по студии: списание прошло, но чек не оформлен.
   * Отдаёт данные только при включённом серверном флаге `POS_ORPHAN_DETECT_ENABLED`
   * (иначе пустой список).
   */
  getOrphanPayments(studioId: string): Observable<PosOrphanPayment[]> {
    return this.http.get<{ success: boolean; items: PosOrphanPayment[] }>(
      `${this.base}/payments/orphan`,
      { params: { studioId } },
    ).pipe(map(r => r.items ?? []));
  }

  /**
   * Оформить чек по осиротевшей оплате БЕЗ повторного списания: создаёт чек +
   * пробивает приход на ККТ по переданным позициям (снимка обычно нет).
   * Идемпотентно (CAS на сервере) — повтор вернёт тот же чек.
   */
  createOrphanReceipt(
    paymentId: string,
    data?: { items?: PosReceiptItem[] },
  ): Observable<PosPaymentResolveResult> {
    return this.http.post<PosPaymentResolveResult>(
      `${this.base}/payments/${encodeURIComponent(paymentId)}/create-receipt`,
      data ?? {},
    );
  }

  /** Сверка эквайринга (op59) по студии: подтверждает, списались ли деньги. */
  runBankSettlement(studioId: string): Observable<{ success: boolean; transactionId?: string }> {
    return this.bridgeBankSettlement(studioId);
  }

  getBridgeTransaction(transactionId: string): Observable<PosBridgeTransaction> {
    return this.http.get<{ success: boolean; transaction: PosBridgeTransaction }>(
      `${this.base}/bridge/transactions/${encodeURIComponent(transactionId)}`,
    ).pipe(map(r => r.transaction));
  }

  // ─── Fiscal Status ────────────────────────────────

  getFiscalStatus(receiptId: string): Observable<{
    fiscal_status: string;
    fiscal_attempts: number;
    fiscal_last_error: string | null;
  }> {
    return this.http.get<{
      success: boolean;
      fiscal_status: string;
      fiscal_attempts: number;
      fiscal_last_error: string | null;
    }>(`${this.base}/receipts/${receiptId}/fiscal-status`).pipe(
      map(({ fiscal_status, fiscal_attempts, fiscal_last_error }) => ({
        fiscal_status,
        fiscal_attempts,
        fiscal_last_error,
      })),
    );
  }

  retryFiscal(receiptId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/receipts/${receiptId}/fiscal-retry`, {});
  }

  createFiscalCorrection(receiptId: string): Observable<{ success: boolean; transactionId?: string }> {
    return this.http.post<{ success: boolean; transactionId?: string }>(
      `${this.base}/receipts/${receiptId}/fiscal-correction`,
      {},
    );
  }

  printReceiptCopy(receiptId: string): Observable<{ success: boolean; transactionId?: string }> {
    return this.http.post<{ success: boolean; transactionId?: string }>(
      `${this.base}/receipts/${receiptId}/print-copy`,
      {},
    );
  }

  private buildShiftParams(params?: PosShiftListParams): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;

    if (params.studio_id) httpParams = httpParams.set('studio_id', params.studio_id);
    if (params.employee_id) httpParams = httpParams.set('employee_id', params.employee_id);
    if (params.date_from) httpParams = httpParams.set('date_from', params.date_from);
    if (params.date_to) httpParams = httpParams.set('date_to', params.date_to);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    return httpParams;
  }

  private buildReceiptParams(params?: PosReceiptListParams): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;

    if (params.shift_id) httpParams = httpParams.set('shift_id', params.shift_id);
    if (params.studio_id) httpParams = httpParams.set('studio_id', params.studio_id);
    if (params.employee_id) httpParams = httpParams.set('employee_id', params.employee_id);
    if (params.date_from) httpParams = httpParams.set('date_from', params.date_from);
    if (params.date_to) httpParams = httpParams.set('date_to', params.date_to);
    if (params.customer_phone) httpParams = httpParams.set('customer_phone', params.customer_phone);
    if (params.is_refund !== undefined) httpParams = httpParams.set('is_refund', String(params.is_refund));
    if (params.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));
    if (params.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    return httpParams;
  }

  // ─── Service Work Timer ──────────────────────────────

  startServiceTimer(data: {
    employee_id: string; studio_id: string; order_description?: string;
    is_custom_order?: boolean; custom_surcharge?: number;
    custom_surcharge_reason?: string; hourly_rate?: number;
  }): Observable<ServiceWorkLog> {
    return this.http.post<{ success: boolean; log: ServiceWorkLog }>(`${this.base}/service/start-timer`, data)
      .pipe(map(r => r.log));
  }

  stopServiceTimer(workLogId: string, employeeId: string): Observable<ServiceWorkLog> {
    return this.http.post<{ success: boolean; log: ServiceWorkLog }>(`${this.base}/service/stop-timer`, {
      work_log_id: workLogId,
      employee_id: employeeId,
    }).pipe(map(r => r.log));
  }

  getActiveTimer(employeeId: string): Observable<ServiceWorkLog | null> {
    return this.http.get<{ success: boolean; log: ServiceWorkLog | null }>(`${this.base}/service/active-timer`, {
      params: { employee_id: employeeId },
    }).pipe(map(r => r.log));
  }

  addCustomSurcharge(workLogId: string, amount: number, reason: string): Observable<ServiceWorkLog> {
    return this.http.post<{ success: boolean; log: ServiceWorkLog }>(`${this.base}/service/custom-surcharge`, {
      work_log_id: workLogId, amount, reason,
    }).pipe(map(r => r.log));
  }

  // ─── Materials ──────────────────────────────────────

  recordMaterialUsage(data: {
    receipt_id?: string; work_log_id?: string;
    product_id: string; quantity: number; unit: string;
    studio_id: string; employee_id: string; notes?: string;
  }): Observable<void> {
    return this.http.post<void>(`${this.base}/materials/usage`, data);
  }

  getMaterialReport(studioId: string, dateFrom?: string, dateTo?: string): Observable<MaterialUsageReport[]> {
    const params: Record<string, string> = {};
    if (dateFrom) params['date_from'] = dateFrom;
    if (dateTo) params['date_to'] = dateTo;
    return this.http.get<{ success: boolean; report: MaterialUsageReport[] }>(
      `${this.base}/materials/report/${studioId}`, { params }
    ).pipe(map(r => r.report));
  }

  getLowStock(studioId: string): Observable<LowStockItem[]> {
    return this.http.get<{ success: boolean; items: LowStockItem[] }>(
      `${this.base}/materials/low-stock/${studioId}`
    ).pipe(map(r => r.items));
  }

  // ─── Consumable Preview ───────────────────────────
  previewConsumables(items: ConsumablePreviewRequest[]): Observable<ConsumablePreviewLine[]> {
    return this.http.post<{ success: boolean; preview: ConsumablePreviewLine[] }>(
      `${this.base}/consumable-rules/preview`, { items }
    ).pipe(map(r => r.preview));
  }

  // ─── Employee Favorites (F62) ─────────────────────
  getFavorites(): Observable<EmployeeFavorite[]> {
    return this.http.get<{ success: boolean; items: EmployeeFavorite[] }>(
      `${this.base}/favorites`
    ).pipe(map(r => r.items));
  }

  addFavorite(optionId: string): Observable<void> {
    return this.http.post<{ success: boolean }>(`${this.base}/favorites/${optionId}`, {})
      .pipe(map(() => undefined));
  }

  removeFavorite(optionId: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`${this.base}/favorites/${optionId}`)
      .pipe(map(() => undefined));
  }
}

// ─── Types ──────────────────────────────────────────

export interface ServiceWorkLog {
  id: string;
  employee_id: string;
  studio_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  hourly_rate: number;
  calculated_amount: number | null;
  is_custom_order: boolean;
  custom_surcharge: number;
  custom_surcharge_reason: string | null;
  order_description: string | null;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export interface MaterialUsageReport {
  product_id: string;
  product_name: string;
  total_used: number;
  unit: string;
  current_stock: number | null;
  min_quantity: number | null;
  is_low_stock: boolean;
}

export interface LowStockItem {
  product_id: string;
  product_name: string;
  category_name: string;
  current_stock: number;
  min_quantity: number;
  unit: string;
}

export interface PartialRefundItem {
  product_id: string;
  quantity: number;
  amount: number;
}

export interface ConsumablePreviewRequest {
  option_id: string;
  quantity: number;
}

export interface EmployeeFavorite {
  id: string;
  service_option_id: string;
  name: string;
  base_price: string;
  icon: string | null;
  slug: string;
  category_name: string | null;
  created_at: string;
}

export interface ConsumablePreviewLine {
  rule_id: string;
  product_stock_id: string;
  product_name: string;
  deduction: number;
  unit_label: string | null;
  current_stock: number;
  stock_after: number;
  will_go_negative: boolean;
}
