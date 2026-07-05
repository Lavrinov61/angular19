/** View types for POS domain */

import type { PosReceiptsId } from '../generated/public/PosReceipts.js';

export type { PosReceiptsId };

/** Fiscal status projection for GET /receipts/:id/fiscal-status */
export interface FiscalStatusRow {
  fiscal_status: string;
  fiscal_attempts: number;
  fiscal_last_error: string | null;
}

/** Fiscal retry lookup for POST /receipts/:id/fiscal-retry */
export interface FiscalRetryLookup {
  fiscal_status: string;
  receipt_number: string;
  total: number;
}

/** POS shift list projection for GET /pos/shifts */
export interface PosShiftListRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_number: number | string;
  opened_at: string | Date;
  closed_at: string | Date | null;
  cash_at_open: number | string;
  cash_at_close: number | string | null;
  expected_cash: number | string | null;
  status: 'open' | 'closed';
  total_sales: number | string;
  total_refunds: number | string;
  receipt_count: number | string;
  cash_collected: number | string | null;
  collection_count: number | string | null;
  notes: string | null;
  fiscal_enabled: boolean;
}

/** Fiscal correction lookup for POST /receipts/:id/fiscal-correction */
export interface FiscalCorrectionLookup {
  id: string;
  fiscal_status: string;
  receipt_number: string | null;
  total: number;
  studio_id: string;
  payment_method: string | null;
  created_at: string | Date;
  is_refund: boolean;
  voided_at: string | null;
}

/** Aggregate stats for shift report */
export interface ShiftReceiptStats {
  receipts_count: string;
  refunds_count: string;
  voided_count: string;
  total_sales: string;
  total_refunds: string;
}

/** Payment breakdown row for shift report */
export interface ShiftPaymentRow {
  payment_type: string;
  sum: string;
}

/** Top service row for shift report */
export interface ShiftTopServiceRow {
  product_name: string;
  quantity: string;
  revenue: string;
}

/** Count projection for aggregate queries */
export interface CountRow {
  count: string;
}

/** Customer name lookup for POS */
export interface CustomerNameRow {
  name: string | null;
}

/** Active subscription projection for POS customer lookup */
export interface ActiveSubscriptionRow {
  id: string;
  plan_name: string;
  status: string;
}

/** Subscription credit row for POS customer lookup */
export interface SubscriptionCreditRow {
  product_id: string;
  product_name: string;
  remaining: number;
}

/** Cash payments sum for shift close */
export interface CashPaymentsSumRow {
  sum: string;
}

/** Cash withdrawal aggregate for shift close/report */
export interface CashWithdrawalTotalsRow {
  total: string;
  count: string;
}

/** Inserted cash movement projection */
export interface CashMovementInsertRow {
  id: string;
  shift_id: string;
  studio_id: string;
  employee_id: string;
  movement_type: string;
  amount: string;
  reason: string;
  created_at: string;
}

/** Cash movement report projection */
export interface CashMovementReportRow {
  id: string;
  shift_id: string;
  studio_id: string;
  employee_id: string;
  employee_name: string | null;
  movement_type: string;
  amount: string;
  reason: string;
  created_at: string;
}

/** Employee shift id lookup by POS shift */
export interface EmployeeShiftIdRow {
  id: string;
}

/** Sales aggregate projection */
export interface SalesAggregateRow {
  st: string;
  ct: string;
  rc: string;
}

/** Daily sales source aggregate projection */
export interface DailySalesSourceRow {
  source: string;
  cnt: string;
  total: string;
  commission: string;
}

/** Employee sales detail projection */
export interface EmployeeSaleRow {
  id: string;
  receipt_id: string;
  receipt_total: string;
  commission_rate: string;
  commission_amount: string;
  category_slug: string | null;
  source: string;
  created_at: string;
}

/** Admin sales overview projection */
export interface AdminSalesOverviewRow {
  employee_id: string;
  display_name: string;
  photo_url: string | null;
  cnt: string;
  total: string;
  commission: string;
}

/** POS shift fields needed to compare app shift with device fiscal state */
export interface ShiftFiscalLookupRow {
  id: string;
  studio_id: string;
  opened_at: string | null;
  status: string | null;
}

/** Latest fiscal shift command confirmed by the POS agent */
export interface ShiftFiscalTransactionStateRow {
  id: string;
  transaction_type: string;
  status: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  initiated_by: string | null;
  initiated_by_name: string | null;
}

/** POS bridge transaction status used by frontend polling. */
export interface PosBridgeTransactionStatusRow {
  id: string;
  studio_id: string;
  transaction_type: string;
  status: string | null;
  error_message: string | null;
  terminal_response: unknown;
  initiated_at: string | null;
}

/** Failure fields used to classify an unresolved terminal payment. */
export interface PosPaymentFailureFieldsRow {
  error_message: string | null;
  rrn: string | null;
}

/** Completed card payment fields needed to queue a terminal refund. */
export interface PosBridgePaymentForRefundRow {
  id: string;
  studio_id: string;
  amount: number | string;
  order_id: string | null;
  rrn: string | null;
  status: string | null;
  transaction_type: string;
}

/** Existing refund command lookup for idempotent terminal cancellation. */
export interface PosBridgeRefundLookupRow {
  id: string;
  status: string | null;
}

/** POS-agent availability for fiscal operations in a studio */
export interface FiscalAgentAvailabilityRow {
  available: boolean;
}

/** Stored ATOL27F fiscal print settings by studio. */
export interface PosFiscalSettingsRow {
  studio_id: string;
  agent_id: string | null;
  enabled: boolean;
  receipt_settings: unknown;
  slip_settings: unknown;
  shift_settings: unknown;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FiscalShiftStatusSource = 'telemetry' | 'transaction' | 'none';

/** Public fiscal registrar status attached to POS shift responses. */
export interface PosShiftFiscalStatus {
  ready: boolean;
  available: boolean;
  source: FiscalShiftStatusSource;
  shift_status: string | null;
  checked_at: string | null;
  opened_at: string | null;
  opened_by: string | null;
  opened_by_id: string | null;
  transaction_id: string | null;
  command_status: string | null;
}

/** Employee favorite with joined service_option data */
export interface EmployeeFavoriteRow {
  id: string;
  service_option_id: string;
  name: string;
  base_price: string;
  icon: string | null;
  slug: string;
  category_name: string | null;
  created_at: string;
}

export interface PosReceiptListItemRow {
  product_id: string | null;
  product_name: string;
  quantity: number | string;
  unit_price: number | string;
  discount_amount: number | string | null;
  discount_percent: number | string | null;
  points_used: number | string | null;
  subscription_credits_used: number | string | null;
  total: number | string;
  vat_rate: string | null;
  vat_amount: number | string | null;
  discount_type: string | null;
  discount_label: string | null;
  print_fill_percent: number | string | null;
}

export interface PosReceiptListPaymentRow {
  payment_type: string;
  amount: number | string;
  card_info: string | null;
  transaction_id: string | null;
  status: string | null;
  transaction_status: string | null;
  payment_resolution: string | null;
  effective_status: string | null;
  terminal_error_message: string | null;
  terminal_initiated_at: string | null;
  terminal_completed_at: string | null;
}

/** Receipt list projection with nested items/payments for admin sales views. */
export interface PosReceiptListRow {
  id: string;
  receipt_number: string;
  shift_id: string | null;
  employee_id: string;
  employee_name: string | null;
  studio_id: string;
  studio_name: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  loyalty_profile_id: string | null;
  subscription_id: string | null;
  is_refund: boolean | null;
  refund_receipt_id: string | null;
  subtotal: number | string;
  discount_total: number | string | null;
  points_discount: number | string | null;
  subscription_credit_used: number | string | null;
  total: number | string;
  fiscal_receipt_url: string | null;
  fiscal_receipt_number: string | null;
  fiscal_sign: string | null;
  fiscal_source: string | null;
  fiscal_status: string | null;
  fiscal_attempts: number | null;
  fiscal_last_error: string | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  items: PosReceiptListItemRow[];
  payments: PosReceiptListPaymentRow[];
}
