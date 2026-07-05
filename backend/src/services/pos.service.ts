import db from '../database/db.js';
import { PoolClient } from 'pg';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { applyConsumption, reverseConsumption, type ConsumptionItem } from './consumable-rules.service.js';
import { recordSale, reverseSale as reverseEmployeeSale } from './employee-sales.service.js';
import { studioBasePayRateSql } from './virtual-shift.service.js';
import type { PosReceiptsId } from '../types/generated/public/PosReceipts.js';
import type { StudiosId } from '../types/generated/public/Studios.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { CountResult } from '../types/views/common-views.js';
import type { PhotoPrintOrdersId } from '../types/generated/public/PhotoPrintOrders.js';
import type { PosReceiptMetadataJsonb } from '../types/jsonb/pos-receipt-jsonb.js';
import { findProfile } from './loyalty.service.js';
import {
  getSubscriptionCreditMapping,
  printPackageCreditMultiplierForCoveragePercent,
  restoreCreditsForPosReceiptItemsWithClient,
  restoreCreditsForPosReceiptWithClient,
  useCreditsWithClient,
} from './subscription.service.js';
import {
  getStudentDiscountForPhone,
  recordEducationVolumeUsageForReceiptWithClient,
  recordStudentDiscountUsageForReceiptWithClient,
  restoreStudentDiscountUsageForReceiptItemsWithClient,
  restoreStudentDiscountUsageForReceiptWithClient,
  type StudentDiscountSummary,
} from './student-discount.service.js';
import {
  recordStudentIdPhotoPromoForReceiptWithClient,
  restoreStudentIdPhotoPromoForReceiptWithClient,
} from './student-id-photo-promo.service.js';
import type { StudentDiscountBenefitType } from '../types/views/student-discount-views.js';
import {
  getFiscalShiftStatusForShift,
  withFiscalShiftDeviceStatus,
} from './pos-fiscal-shift.service.js';
import { recordBusinessEvent } from './business-observability.service.js';

import type {
  ShiftReceiptStats, ShiftPaymentRow, ShiftTopServiceRow,
  CustomerNameRow, ActiveSubscriptionRow, SubscriptionCreditRow,
  CashPaymentsSumRow, EmployeeShiftIdRow, SalesAggregateRow,
  PosReceiptListRow, CashWithdrawalTotalsRow, CashMovementInsertRow,
  CashMovementReportRow, PosShiftFiscalStatus, PosShiftListRow,
} from '../types/views/pos-views.js';
import { createLogger } from '../utils/logger.js';
// ─── TYPES ────────────────────────────────────────────

const logger = createLogger('pos.service');
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
  status: 'open' | 'closed';
  total_sales: number;
  total_refunds: number;
  receipt_count: number;
  cash_collected: number | null;
  collection_count: number | null;
  notes: string | null;
  fiscal_enabled: boolean;
  fiscal_status?: PosShiftFiscalStatus;
}

export interface PosShiftListFilters {
  employee_id?: string;
  studio_id?: string;
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

export interface PosReceiptItem {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  discount_percent?: number;
  points_used?: number;
  subscription_credits_used?: number;
  total: number;
  vat_rate?: string;
  vat_amount?: number;
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
  method?: PosReceiptPayment['payment_type'];
  transaction_status?: string | null;
  payment_resolution?: string | null;
  effective_status?: string | null;
  terminal_error_message?: string | null;
  terminal_initiated_at?: string | null;
  terminal_completed_at?: string | null;
}

export interface PosReceipt {
  id: string;
  receipt_number: string;
  shift_id: string | null;
  employee_id: string;
  studio_id: string;
  customer_phone: string | null;
  customer_name: string | null;
  loyalty_profile_id: string | null;
  subscription_id: string | null;
  is_refund: boolean;
  refund_receipt_id: string | null;
  subtotal: number;
  discount_total: number;
  points_discount: number;
  subscription_credit_used: number;
  total: number;
  fiscal_receipt_url: string | null;
  fiscal_receipt_number: string | null;
  fiscal_sign: string | null;
  fiscal_source: string;
  fiscal_status?: string | null;
  fiscal_attempts?: number | null;
  fiscal_last_error?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  created_at: string;
  employee_name?: string | null;
  studio_name?: string | null;
  items?: PosReceiptItem[];
  payments?: PosReceiptPayment[];
}

export interface TopService {
  product_name: string;
  quantity: number;
  revenue: number;
}

export interface CashMovement {
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

export interface ShiftReport {
  shift: PosShift;
  receipts_count: number;
  refunds_count: number;
  total_sales: number;
  total_refunds: number;
  net_sales: number;
  cash_payments: number;
  cash_withdrawals: number;
  cash_withdrawal_count: number;
  cash_movements: CashMovement[];
  card_payments: number;
  sbp_payments: number;
  subscription_payments: number;
  employee_name?: string;
  studio_name?: string;
  voided_count: number;
  avg_receipt: number;
  top_services: TopService[];
}

export interface SubscriptionCoverageInputItem {
  product_id?: string | null;
  product_name?: string;
  quantity: number;
  unit_price: number;
  total: number;
  print_fill_percent?: number | string | null;
  coverage_percent?: number | string | null;
}

export interface SubscriptionCoverageLine {
  index: number;
  product_id: string;
  credit_product_id: string;
  product_name: string;
  quantity: number;
  credit_multiplier: number;
  coverage_multiplier: number;
  coverage_percent: number | null;
  covered_quantity: number;
  remaining_quantity: number;
  credits_consumed: number;
  covered_amount: number;
}

export interface SubscriptionCoverageResult {
  subscription_id: string;
  total_covered_amount: number;
  total_credits_consumed: number;
  items: SubscriptionCoverageLine[];
}

interface CreditAvailabilityRow {
  id: string;
  product_id: string;
  total_credits: string | number;
  used_credits: string | number;
  remaining: string | number;
}

interface ExistsRow {
  exists: boolean;
}

interface IdRow {
  id: string;
}

interface OpenShiftForCashMovementRow {
  id: string;
  studio_id: string;
}

interface RefundSourceReceiptRow {
  id: string;
  is_refund: boolean;
  voided_at: string | null;
}

interface RefundedProductQuantityRow {
  product_id: string;
  refunded_quantity: string | number;
}

interface ProductSubscriptionEligibilityRow {
  id: string;
  is_subscription_eligible: boolean;
}

interface LowStockRow {
  quantity: number;
  min_quantity: number;
  name: string;
  employee_ids: string[];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNullableIsoString(value: string | Date | null): string | null {
  if (value === null) return null;
  return toIsoString(value);
}

function mapPosShiftRow(row: PosShiftListRow): PosShift {
  return {
    id: row.id,
    employee_id: row.employee_id,
    studio_id: row.studio_id,
    shift_number: toNumber(row.shift_number),
    opened_at: toIsoString(row.opened_at),
    closed_at: toNullableIsoString(row.closed_at),
    cash_at_open: toNumber(row.cash_at_open),
    cash_at_close: row.cash_at_close === null ? null : toNumber(row.cash_at_close),
    expected_cash: row.expected_cash === null ? null : toNumber(row.expected_cash),
    status: row.status,
    total_sales: toNumber(row.total_sales),
    total_refunds: toNumber(row.total_refunds),
    receipt_count: toNumber(row.receipt_count),
    cash_collected: row.cash_collected === null ? null : toNumber(row.cash_collected),
    collection_count: row.collection_count === null ? null : toNumber(row.collection_count),
    notes: row.notes,
    fiscal_enabled: row.fiscal_enabled,
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePrintFillPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(100, Math.max(0, numeric));
}

function mapCashMovement(row: CashMovementInsertRow | CashMovementReportRow): CashMovement {
  const movement: CashMovement = {
    id: row.id,
    shift_id: row.shift_id,
    studio_id: row.studio_id,
    employee_id: row.employee_id,
    movement_type: 'withdrawal',
    amount: toNumber(row.amount),
    reason: row.reason,
    created_at: row.created_at,
  };
  return 'employee_name' in row
    ? { ...movement, employee_name: row.employee_name }
    : movement;
}

function normalizePayment(payment: PosReceiptPayment): PosReceiptPayment {
  const paymentType = payment.payment_type ?? payment.method;
  if (!paymentType) {
    throw new AppError(400, 'payment_type is required', ErrorCode.VALIDATION_ERROR);
  }

  return {
    payment_type: paymentType,
    amount: toNumber(payment.amount),
    card_info: payment.card_info,
    transaction_id: payment.transaction_id,
  };
}

async function receiptHasSubscriptionPayment(client: PoolClient, receiptId: string): Promise<boolean> {
  const result = await client.query<ExistsRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM pos_receipt_payments
       WHERE receipt_id = $1 AND payment_type = 'subscription'
     ) AS exists`,
    [receiptId],
  );
  return Boolean(result.rows[0]?.exists);
}

async function receiptHasActiveRefund(client: PoolClient, receiptId: string): Promise<boolean> {
  const result = await client.query<IdRow>(
    `SELECT id
     FROM pos_receipts
     WHERE refund_receipt_id = $1
       AND is_refund = true
       AND voided_at IS NULL
     LIMIT 1`,
    [receiptId],
  );
  return result.rows.length > 0;
}

async function lockReceiptForRefundSource(client: PoolClient, receiptId: string): Promise<void> {
  const result = await client.query<RefundSourceReceiptRow>(
    `SELECT id, is_refund, voided_at
     FROM pos_receipts
     WHERE id = $1
     FOR UPDATE`,
    [receiptId],
  );
  const receipt = result.rows[0];
  if (!receipt) throw new AppError(404, 'Receipt not found', ErrorCode.POS_RECEIPT_NOT_FOUND);
  if (receipt.is_refund) throw new AppError(400, 'Cannot refund a refund receipt', ErrorCode.POS_CANNOT_REFUND_REFUND);
  if (receipt.voided_at) throw new AppError(400, 'Чек уже аннулирован', ErrorCode.POS_RECEIPT_ALREADY_VOIDED);
}

async function getRefundedQuantitiesByProduct(client: PoolClient, receiptId: string): Promise<Map<string, number>> {
  const result = await client.query<RefundedProductQuantityRow>(
    `SELECT ri.product_id, COALESCE(SUM(ABS(ri.quantity)), 0) AS refunded_quantity
     FROM pos_receipts rr
     JOIN pos_receipt_items ri ON ri.receipt_id = rr.id
     WHERE rr.refund_receipt_id = $1
       AND rr.is_refund = true
       AND rr.voided_at IS NULL
       AND ri.product_id IS NOT NULL
     GROUP BY ri.product_id`,
    [receiptId],
  );
  return new Map(result.rows.map(row => [row.product_id, toNumber(row.refunded_quantity)]));
}

// ─── SHIFTS ───────────────────────────────────────────

export interface OpenShiftResult {
  posShift: PosShift;
  employeeShiftId: string;
}

export interface EnableShiftFiscalResult {
  shift: PosShift;
  fiscalEnabledChanged: boolean;
}

export interface ShiftFiscalActionState {
  shift: PosShift;
  fiscalShiftOpen: boolean;
}

export async function openShift(data: {
  employee_id: string;
  studio_id: string;
  cash_at_open: number;
  fiscal_enabled?: boolean;
}): Promise<OpenShiftResult> {
  return db.transaction(async (client) => {
    // Lock the row (or absence of row) to prevent TOCTOU race condition
    const existing = await client.query(
      `SELECT id FROM pos_shifts WHERE employee_id = $1 AND status = 'open' FOR UPDATE`,
      [data.employee_id]
    );
    if (existing.rows.length > 0) {
      throw new AppError(409, 'У вас уже есть открытая смена. Закройте её перед открытием новой.', ErrorCode.POS_SHIFT_ALREADY_OPEN);
    }

    const result = await client.query(
      `INSERT INTO pos_shifts (employee_id, studio_id, cash_at_open, fiscal_enabled)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.employee_id, data.studio_id, data.cash_at_open, false]
    );
    const posShift = result.rows[0] as PosShift;

    // Link to employee_shift: find today's scheduled shift or create ad-hoc
    const today = new Date().toISOString().split('T')[0];
    const empShift = await client.query<IdRow>(
      `SELECT id FROM employee_shifts
       WHERE employee_id = $1 AND studio_id = $2 AND shift_date = $3
         AND status IN ('scheduled', 'active')
       FOR UPDATE`,
      [data.employee_id, data.studio_id, today]
    );

    let employeeShiftId: string;
    if (empShift.rows.length > 0) {
      employeeShiftId = empShift.rows[0].id;
      await client.query(
        `UPDATE employee_shifts
         SET status = 'active',
             checked_in_at = NOW(),
             pos_shift_id = $2,
             cash_at_open = COALESCE(cash_at_open, $3),
             base_pay_rate = COALESCE(base_pay_rate, ${studioBasePayRateSql('employee_shifts.studio_id')})
         WHERE id = $1`,
        [employeeShiftId, posShift.id, data.cash_at_open]
      );
    } else {
      const newShift = await client.query<IdRow>(
        `INSERT INTO employee_shifts (employee_id, studio_id, shift_date, status, checked_in_at, pos_shift_id, cash_at_open, base_pay_rate)
         VALUES ($1, $2, $3, 'active', NOW(), $4, $5, ${studioBasePayRateSql('$2')})
         RETURNING id`,
        [data.employee_id, data.studio_id, today, posShift.id, data.cash_at_open]
      );
      employeeShiftId = newShift.rows[0].id;
    }

    logger.info('POS shift opened with employee_shift link', {
      posShiftId: posShift.id, employeeShiftId, employeeId: data.employee_id,
    });

    return { posShift, employeeShiftId };
  });
}

export async function getOpenShiftFiscalState(data: {
  shift_id: string;
  employee_id: string;
}): Promise<ShiftFiscalActionState> {
  const shift = await db.queryOne<PosShift>(
    `SELECT id, employee_id, studio_id, shift_number, opened_at, closed_at, cash_at_open, cash_at_close,
            expected_cash, status, total_sales, total_refunds, receipt_count, cash_collected,
            collection_count, notes, fiscal_enabled
     FROM pos_shifts
     WHERE id = $1 AND employee_id = $2 AND status = 'open'`,
    [data.shift_id, data.employee_id],
  );

  if (!shift) {
    throw new AppError(404, 'Смена не найдена или уже закрыта', ErrorCode.POS_SHIFT_NOT_FOUND);
  }

  const shiftWithDeviceStatus = await withFiscalShiftDeviceStatus(shift);
  return {
    shift: shiftWithDeviceStatus,
    fiscalShiftOpen: shiftWithDeviceStatus.fiscal_enabled,
  };
}

export async function enableShiftFiscal(data: {
  shift_id: string;
  employee_id: string;
}): Promise<EnableShiftFiscalResult> {
  const fiscalState = await getOpenShiftFiscalState(data);
  return {
    shift: fiscalState.shift,
    fiscalEnabledChanged: !fiscalState.fiscalShiftOpen,
  };
}

export interface CommissionSummary {
  sales_total: number;
  commission_total: number;
  receipts_count: number;
}

export interface CloseShiftResult {
  shift: PosShift;
  commissionSummary: CommissionSummary | null;
}

export interface CashDenomination {
  denomination: number;
  type: 'banknote' | 'coin';
  count: number;
}

export async function closeShift(data: {
  shift_id: string;
  employee_id: string;
  cash_at_close: number;
  notes?: string;
  denominations?: CashDenomination[];
}): Promise<CloseShiftResult> {
  const cashPayments = await db.queryOne<CashPaymentsSumRow>(
    `SELECT COALESCE(SUM(rp.amount), 0) as sum
     FROM pos_receipt_payments rp
     JOIN pos_receipts r ON rp.receipt_id = r.id
     WHERE r.shift_id = $1 AND rp.payment_type = 'cash' AND rp.status = 'completed'
       AND r.voided_at IS NULL`,
    [data.shift_id]
  );

  const cashWithdrawals = await db.queryOne<CashWithdrawalTotalsRow>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*)::text as count
     FROM pos_cash_movements
     WHERE shift_id = $1 AND movement_type = 'withdrawal'`,
    [data.shift_id],
  );

  const shift = await db.queryOne<PosShift>(
    `SELECT id, employee_id, studio_id, shift_number, opened_at, closed_at, cash_at_open, cash_at_close,
            expected_cash, status, total_sales, total_refunds, receipt_count, cash_collected,
            collection_count, notes, fiscal_enabled
     FROM pos_shifts
     WHERE id = $1 AND employee_id = $2 AND status = 'open'`,
    [data.shift_id, data.employee_id]
  );

  if (!shift) {
    throw new AppError(404, 'Смена не найдена или уже закрыта', ErrorCode.POS_SHIFT_NOT_FOUND);
  }

  const fiscalShiftStatus = await getFiscalShiftStatusForShift(shift);

  const expectedCash = roundMoney(
    toNumber(shift.cash_at_open) + toNumber(cashPayments?.sum) - toNumber(cashWithdrawals?.total),
  );

  const result = await db.queryOne<PosShift>(
    `UPDATE pos_shifts SET
      status = 'closed',
      closed_at = NOW(),
      cash_at_close = $2,
      expected_cash = $3,
      notes = COALESCE($4, notes)
     WHERE id = $1 RETURNING *`,
    [data.shift_id, data.cash_at_close, expectedCash, data.notes || null]
  );

  if (data.denominations?.length) {
    await saveCashCounts(data.shift_id, data.denominations);
  }

  if (!result) {
    throw new AppError(500, 'Не удалось закрыть смену', ErrorCode.INTERNAL_ERROR);
  }

  // Finalize linked employee_shift: compute commission totals
  const commissionSummary = await finalizeEmployeeShift(data.shift_id, data.cash_at_close);

  return { shift: { ...result, fiscal_enabled: fiscalShiftStatus.fiscalReady }, commissionSummary };
}

async function finalizeEmployeeShift(posShiftId: string, cashAtClose: number): Promise<CommissionSummary | null> {
  const es = await db.queryOne<EmployeeShiftIdRow>(
    `SELECT id FROM employee_shifts WHERE pos_shift_id = $1`, [posShiftId]);
  if (!es) return null;
  const a = await db.queryOne<SalesAggregateRow>(
    `SELECT COALESCE(SUM(receipt_total),0) st, COALESCE(SUM(commission_amount),0) ct, COUNT(*)::int rc
     FROM employee_sales WHERE shift_id = $1`, [es.id]);
  const s = parseFloat(a?.st ?? '0'), c = parseFloat(a?.ct ?? '0'), r = parseInt(a?.rc ?? '0', 10);
  await db.query(
    `UPDATE employee_shifts SET commission_total=$2, sales_total=$3, receipts_count=$4,
     cash_at_close=COALESCE(cash_at_close, $5), checked_out_at=COALESCE(checked_out_at, NOW()),
     status='completed' WHERE id=$1`, [es.id, c, s, r, cashAtClose]);
  logger.info('Employee shift finalized', { id: es.id, s, c, r });
  return { sales_total: s, commission_total: c, receipts_count: r };
}

async function saveCashCounts(shiftId: string, denominations: CashDenomination[]): Promise<void> {
  const nonZero = denominations.filter(d => d.count > 0);
  if (nonZero.length === 0) return;

  const values: unknown[] = [];
  const placeholders = nonZero.map((d, i) => {
    const b = i * 5;
    values.push(shiftId, d.denomination, d.type, d.count, d.denomination * d.count);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
  });

  await db.query(
    `INSERT INTO pos_cash_counts (shift_id, denomination, denomination_type, count, subtotal)
     VALUES ${placeholders.join(',')}`,
    values
  );
}

export async function createCashWithdrawal(data: {
  shift_id: string;
  employee_id: string;
  amount: number;
  reason: string;
}): Promise<CashMovement> {
  const amount = roundMoney(data.amount);
  const reason = data.reason.trim();
  if (amount <= 0) {
    throw new AppError(400, 'Сумма изъятия должна быть больше нуля', ErrorCode.VALIDATION_ERROR);
  }
  if (reason.length < 2) {
    throw new AppError(400, 'Укажите причину изъятия', ErrorCode.VALIDATION_ERROR);
  }

  return db.transaction(async (client) => {
    const shiftResult = await client.query<OpenShiftForCashMovementRow>(
      `SELECT id, studio_id
       FROM pos_shifts
       WHERE id = $1 AND employee_id = $2 AND status = 'open'
       FOR UPDATE`,
      [data.shift_id, data.employee_id],
    );
    const shift = shiftResult.rows[0];
    if (!shift) {
      throw new AppError(404, 'Смена не найдена или уже закрыта', ErrorCode.POS_SHIFT_NOT_FOUND);
    }

    const insertResult = await client.query<CashMovementInsertRow>(
      `INSERT INTO pos_cash_movements (shift_id, studio_id, employee_id, movement_type, amount, reason)
       VALUES ($1, $2, $3, 'withdrawal', $4, $5)
       RETURNING id, shift_id, studio_id, employee_id, movement_type, amount, reason, created_at`,
      [data.shift_id, shift.studio_id, data.employee_id, amount, reason],
    );
    const movement = insertResult.rows[0];
    if (!movement) {
      throw new AppError(500, 'Не удалось записать изъятие наличных', ErrorCode.INTERNAL_ERROR);
    }

    await client.query(
      `UPDATE pos_shifts
       SET cash_collected = COALESCE(cash_collected, 0) + $2,
           collection_count = COALESCE(collection_count, 0) + 1
       WHERE id = $1`,
      [data.shift_id, amount],
    );

    return mapCashMovement(movement);
  });
}

export async function getCurrentShift(employeeId: string): Promise<PosShift | null> {
  const shift = await db.queryOne<PosShift>(
    `SELECT id, employee_id, studio_id, shift_number, opened_at, closed_at, cash_at_open, cash_at_close,
            expected_cash, status, total_sales, total_refunds, receipt_count, cash_collected,
            collection_count, notes, fiscal_enabled
     FROM pos_shifts
     WHERE employee_id = $1 AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [employeeId]
  );
  return shift ? withFiscalShiftDeviceStatus(shift) : null;
}

export async function getShifts(filters: PosShiftListFilters = {}): Promise<PosShiftListResponse> {
  const where: string[] = [];
  const params: unknown[] = [];

  const addWhere = (condition: string, value: unknown): void => {
    params.push(value);
    where.push(condition.replace('?', `$${params.length}`));
  };

  if (filters.employee_id) addWhere('s.employee_id = ?', filters.employee_id);
  if (filters.studio_id) addWhere('s.studio_id = ?', filters.studio_id);
  if (filters.status) addWhere('s.status = ?', filters.status);
  if (filters.date_from) addWhere('s.opened_at >= ?', filters.date_from);
  if (filters.date_to) addWhere('s.opened_at <= ?', filters.date_to);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const countRow = await db.queryOne<CountResult>(
    `SELECT COUNT(*)::text AS count FROM pos_shifts s ${whereSql}`,
    params,
  );

  const rows = await db.query<PosShiftListRow>(
    `SELECT s.id, s.employee_id, s.studio_id, s.shift_number, s.opened_at, s.closed_at,
            s.cash_at_open, s.cash_at_close, s.expected_cash, s.status, s.total_sales,
            s.total_refunds, s.receipt_count, s.cash_collected, s.collection_count,
            s.notes, s.fiscal_enabled
     FROM pos_shifts s
     ${whereSql}
     ORDER BY s.opened_at DESC NULLS LAST, s.shift_number DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    items: rows.map(mapPosShiftRow),
    total: parseInt(countRow?.count || '0', 10),
  };
}

export interface CashControlFilters {
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

interface CashControlShiftRow {
  id: string;
  shift_number: number | string;
  employee_id: string;
  employee_name: string | null;
  studio_id: string;
  studio_name: string | null;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
  status: 'open' | 'closed';
  cash_at_open: string | number;
  cash_sales: string | number;
  withdrawals: string | number;
  expected_cash: string | number | null;
  cash_at_close: string | number | null;
}

interface OrphanTotalsRow {
  count: number;
  sum: string | number;
}

interface OrphanByDayRow {
  day: string;
  count: number;
  sum: string | number;
}

interface OrphanByEmployeeRow {
  employee_id: string | null;
  employee_name: string | null;
  count: number;
  sum: string | number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Контроль кассы по сменам: остаток на открытии, наличная выручка, изъятия,
 * ожидаемая сумма, фактический пересчёт и расхождение (недостача/излишек),
 * плюс «непривязанная наличка» — наличные чеки с shift_id IS NULL за период.
 */
export async function getCashControl(filters: CashControlFilters = {}): Promise<CashControlResponse> {
  // ── Смены за период/точку ──
  const shiftWhere: string[] = [];
  const shiftParams: unknown[] = [];
  const addShiftWhere = (condition: string, value: unknown): void => {
    shiftParams.push(value);
    shiftWhere.push(condition.replace('?', `$${shiftParams.length}`));
  };
  if (filters.studio_id) addShiftWhere('s.studio_id = ?', filters.studio_id);
  if (filters.date_from) addShiftWhere('s.opened_at >= ?', filters.date_from);
  if (filters.date_to) addShiftWhere('s.opened_at <= ?', filters.date_to);
  const shiftWhereSql = shiftWhere.length > 0 ? `WHERE ${shiftWhere.join(' AND ')}` : '';

  const shiftRows = await db.query<CashControlShiftRow>(
    `SELECT s.id, s.shift_number, s.employee_id,
            u.display_name AS employee_name,
            s.studio_id, st.name AS studio_name,
            s.opened_at, s.closed_at, s.status,
            s.cash_at_open, s.cash_at_close, s.expected_cash,
            COALESCE(cs.cash_sales, 0) AS cash_sales,
            COALESCE(w.withdrawals, 0) AS withdrawals
     FROM pos_shifts s
     LEFT JOIN users u ON u.id = s.employee_id
     LEFT JOIN studios st ON st.id = s.studio_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(rp.amount), 0) AS cash_sales
       FROM pos_receipt_payments rp
       JOIN pos_receipts r ON r.id = rp.receipt_id
       WHERE rp.payment_type = 'cash' AND rp.status = 'completed'
         AND NOT r.is_refund AND r.voided_at IS NULL
         AND (
           r.shift_id = s.id
           OR (
             r.shift_id IS NULL
             AND r.employee_id = s.employee_id
             AND r.studio_id = s.studio_id
             AND r.created_at >= s.opened_at
             AND (s.status = 'open' OR (s.closed_at IS NOT NULL AND r.created_at <= s.closed_at))
           )
         )
     ) cs ON true
     LEFT JOIN (
       SELECT shift_id, SUM(amount) AS withdrawals
       FROM pos_cash_movements
       WHERE movement_type = 'withdrawal'
       GROUP BY shift_id
     ) w ON w.shift_id = s.id
     ${shiftWhereSql}
     ORDER BY s.opened_at DESC NULLS LAST, s.shift_number DESC
     LIMIT 500`,
    shiftParams,
  );

  const shifts: CashControlShift[] = shiftRows.map((row) => {
    const cashAtOpen = toNumber(row.cash_at_open);
    const cashSales = toNumber(row.cash_sales);
    const withdrawals = toNumber(row.withdrawals);
    const expectedCash = row.status === 'closed'
      ? round2(cashAtOpen + cashSales - withdrawals)
      : null;
    const cashAtClose = row.cash_at_close === null ? null : toNumber(row.cash_at_close);
    const reconciled = row.status === 'closed' && expectedCash !== null && cashAtClose !== null;
    return {
      id: row.id,
      shift_number: toNumber(row.shift_number),
      employee_id: row.employee_id,
      employee_name: row.employee_name || 'Сотрудник не указан',
      studio_id: row.studio_id,
      studio_name: row.studio_name || 'Точка не указана',
      opened_at: toNullableIsoString(row.opened_at) ?? '',
      closed_at: toNullableIsoString(row.closed_at),
      status: row.status,
      cash_at_open: cashAtOpen,
      cash_sales: cashSales,
      withdrawals,
      expected_cash: expectedCash,
      cash_at_close: cashAtClose,
      diff: reconciled ? round2(cashAtClose - expectedCash) : null,
      reconciled,
    };
  });

  // ── Непривязанная наличка (shift_id IS NULL) ──
  const orphanWhere: string[] = [
    "rp.payment_type = 'cash'",
    'NOT r.is_refund',
    'r.voided_at IS NULL',
    'r.shift_id IS NULL',
    `NOT EXISTS (
      SELECT 1
      FROM pos_shifts matched_shift
      WHERE matched_shift.employee_id = r.employee_id
        AND matched_shift.studio_id = r.studio_id
        AND r.created_at >= matched_shift.opened_at
        AND (
          matched_shift.status = 'open'
          OR (matched_shift.closed_at IS NOT NULL AND r.created_at <= matched_shift.closed_at)
        )
    )`,
  ];
  const orphanParams: unknown[] = [];
  const addOrphanWhere = (condition: string, value: unknown): void => {
    orphanParams.push(value);
    orphanWhere.push(condition.replace('?', `$${orphanParams.length}`));
  };
  if (filters.studio_id) addOrphanWhere('r.studio_id = ?', filters.studio_id);
  if (filters.date_from) addOrphanWhere('r.created_at >= ?', filters.date_from);
  if (filters.date_to) addOrphanWhere('r.created_at <= ?', filters.date_to);
  const orphanWhereSql = `WHERE ${orphanWhere.join(' AND ')}`;
  const orphanFrom = `FROM pos_receipt_payments rp JOIN pos_receipts r ON r.id = rp.receipt_id`;

  const orphanTotals = await db.queryOne<OrphanTotalsRow>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(rp.amount), 0) AS sum ${orphanFrom} ${orphanWhereSql}`,
    orphanParams,
  );

  const orphanByDay = await db.query<OrphanByDayRow>(
    `SELECT to_char(r.created_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS count, COALESCE(SUM(rp.amount), 0) AS sum
     ${orphanFrom} ${orphanWhereSql}
     GROUP BY day ORDER BY day`,
    orphanParams,
  );

  const orphanByEmployee = await db.query<OrphanByEmployeeRow>(
    `SELECT r.employee_id, u.display_name AS employee_name,
            COUNT(*)::int AS count, COALESCE(SUM(rp.amount), 0) AS sum
     ${orphanFrom}
     LEFT JOIN users u ON u.id = r.employee_id
     ${orphanWhereSql}
     GROUP BY r.employee_id, u.display_name
     ORDER BY sum DESC`,
    orphanParams,
  );

  return {
    shifts,
    orphan_cash: {
      count: toNumber(orphanTotals?.count ?? 0),
      sum: toNumber(orphanTotals?.sum ?? 0),
      by_day: orphanByDay.map((r) => ({ day: r.day, count: toNumber(r.count), sum: toNumber(r.sum) })),
      by_employee: orphanByEmployee.map((r) => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name || 'Сотрудник не указан',
        count: toNumber(r.count),
        sum: toNumber(r.sum),
      })),
    },
  };
}

export async function getShiftReport(shiftId: string): Promise<ShiftReport> {
  const shift = await db.queryOne<PosShift & { employee_name: string; studio_name: string }>(
    `SELECT s.*, u.display_name as employee_name, st.name as studio_name
     FROM pos_shifts s
     LEFT JOIN users u ON s.employee_id = u.id
     LEFT JOIN studios st ON s.studio_id = st.id
     WHERE s.id = $1`,
    [shiftId]
  );

  if (!shift) throw new AppError(404, 'Смена не найдена');

  const stats = await db.queryOne<ShiftReceiptStats>(
    `SELECT
       COUNT(*) FILTER (WHERE NOT is_refund AND voided_at IS NULL) as receipts_count,
       COUNT(*) FILTER (WHERE is_refund) as refunds_count,
       COUNT(*) FILTER (WHERE voided_at IS NOT NULL) as voided_count,
       COALESCE(SUM(total) FILTER (WHERE NOT is_refund AND voided_at IS NULL), 0) as total_sales,
       COALESCE(SUM(total) FILTER (WHERE is_refund), 0) as total_refunds
     FROM pos_receipts WHERE shift_id = $1`,
    [shiftId]
  );

  const paymentStats = await db.query<ShiftPaymentRow>(
    `SELECT rp.payment_type, COALESCE(SUM(rp.amount), 0) as sum
     FROM pos_receipt_payments rp
     JOIN pos_receipts r ON rp.receipt_id = r.id
     WHERE r.shift_id = $1 AND rp.status = 'completed' AND NOT r.is_refund AND r.voided_at IS NULL
     GROUP BY rp.payment_type`,
    [shiftId]
  );

  const topServices = await db.query<ShiftTopServiceRow>(
    `SELECT ri.product_name,
            SUM(ri.quantity)::text as quantity,
            SUM(ri.total)::text as revenue
     FROM pos_receipt_items ri
     JOIN pos_receipts r ON ri.receipt_id = r.id
     WHERE r.shift_id = $1 AND NOT r.is_refund AND r.voided_at IS NULL
     GROUP BY ri.product_name
     ORDER BY SUM(ri.total) DESC
     LIMIT 5`,
    [shiftId]
  );

  const cashWithdrawalTotals = await db.queryOne<CashWithdrawalTotalsRow>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*)::text as count
     FROM pos_cash_movements
     WHERE shift_id = $1 AND movement_type = 'withdrawal'`,
    [shiftId],
  );

  const cashMovements = await db.query<CashMovementReportRow>(
    `SELECT m.id, m.shift_id, m.studio_id, m.employee_id, u.display_name as employee_name,
            m.movement_type, m.amount, m.reason, m.created_at
     FROM pos_cash_movements m
     LEFT JOIN users u ON u.id = m.employee_id
     WHERE m.shift_id = $1 AND m.movement_type = 'withdrawal'
     ORDER BY m.created_at ASC`,
    [shiftId],
  );

  const paymentMap = new Map(paymentStats.map(p => [p.payment_type, parseFloat(p.sum)]));
  const receiptsCount = parseInt(stats?.receipts_count || '0', 10);
  const totalSales = parseFloat(stats?.total_sales || '0');
  const cashWithdrawals = toNumber(cashWithdrawalTotals?.total);

  return {
    shift,
    receipts_count: receiptsCount,
    refunds_count: parseInt(stats?.refunds_count || '0', 10),
    voided_count: parseInt(stats?.voided_count || '0', 10),
    total_sales: totalSales,
    total_refunds: parseFloat(stats?.total_refunds || '0'),
    net_sales: totalSales - parseFloat(stats?.total_refunds || '0'),
    avg_receipt: receiptsCount > 0 ? Math.round(totalSales / receiptsCount) : 0,
    cash_payments: paymentMap.get('cash') || 0,
    cash_withdrawals: cashWithdrawals,
    cash_withdrawal_count: parseInt(cashWithdrawalTotals?.count || '0', 10),
    cash_movements: cashMovements.map(mapCashMovement),
    card_payments: paymentMap.get('card') || 0,
    sbp_payments: paymentMap.get('sbp') || 0,
    subscription_payments: paymentMap.get('subscription') || 0,
    top_services: topServices.map(s => ({
      product_name: s.product_name,
      quantity: parseFloat(s.quantity),
      revenue: parseFloat(s.revenue),
    })),
    employee_name: shift.employee_name,
    studio_name: shift.studio_name,
  };
}

export async function calculateSubscriptionCoverageWithClient(
  client: PoolClient,
  data: {
    subscription_id: string;
    items: SubscriptionCoverageInputItem[];
  },
  options: { lock?: boolean } = {},
): Promise<SubscriptionCoverageResult> {
  if (!data.subscription_id) {
    throw new AppError(400, 'subscription_id is required for subscription payment', ErrorCode.POS_SUBSCRIPTION_REQUIRED);
  }

  const subscriptionLock = options.lock ? ' FOR UPDATE' : '';
  const subscription = await client.query<IdRow>(
    `SELECT id
     FROM user_subscriptions
     WHERE id = $1 AND status = 'active'${subscriptionLock}`,
    [data.subscription_id],
  );

  if (subscription.rows.length === 0) {
    throw new AppError(400, 'Активная подписка не найдена', ErrorCode.POS_SUBSCRIPTION_NOT_ACTIVE);
  }

  const mappedItems = data.items
    .map((item, index) => {
      const quantity = toNumber(item.quantity);
      const total = roundMoney(toNumber(item.total, toNumber(item.unit_price) * quantity));
      return {
        index,
        product_id: item.product_id ?? null,
        product_name: item.product_name ?? '',
        quantity,
        total,
        coverage_percent: normalizePrintFillPercent(item.print_fill_percent ?? item.coverage_percent ?? null),
      };
    });
  const candidateItems: Array<{
    index: number;
    product_id: string;
    product_name: string;
    quantity: number;
    total: number;
    coverage_percent: number | null;
  }> = [];
  for (const item of mappedItems) {
    if (item.product_id && item.quantity > 0 && item.total > 0) {
      candidateItems.push({ ...item, product_id: item.product_id });
    }
  }

  if (candidateItems.length === 0) {
    return {
      subscription_id: data.subscription_id,
      total_covered_amount: 0,
      total_credits_consumed: 0,
      items: [],
    };
  }

  const productIds = [...new Set(candidateItems.map((item) => item.product_id))];
  const productRows = await client.query<ProductSubscriptionEligibilityRow>(
    `SELECT id, is_subscription_eligible
     FROM products
     WHERE id = ANY($1::uuid[])`,
    [productIds],
  );
  const eligibleProductIds = new Set(
    productRows.rows
      .filter((product) => product.is_subscription_eligible)
      .map((product) => product.id),
  );

  const coverageItems = candidateItems
    .filter((item) => eligibleProductIds.has(item.product_id))
    .map((item) => {
      const { creditProductId, creditMultiplier: productCreditMultiplier } = getSubscriptionCreditMapping(item.product_id);
      const coverageMultiplier = printPackageCreditMultiplierForCoveragePercent(item.coverage_percent);
      const creditMultiplier = productCreditMultiplier * coverageMultiplier;
      return { ...item, creditProductId, creditMultiplier, coverageMultiplier };
    });

  if (coverageItems.length === 0) {
    return {
      subscription_id: data.subscription_id,
      total_covered_amount: 0,
      total_credits_consumed: 0,
      items: [],
    };
  }

  const creditProductIds = [...new Set(coverageItems.map((item) => item.creditProductId))];
  const creditsLock = options.lock ? ' FOR UPDATE' : '';
  const credits = await client.query<CreditAvailabilityRow>(
    `SELECT id, product_id, total_credits, used_credits,
            (total_credits - used_credits) AS remaining
     FROM subscription_credits
     WHERE subscription_id = $1
       AND product_id = ANY($2::uuid[])
       AND expires_at > NOW()
       AND used_credits < total_credits
     ORDER BY expires_at ASC${creditsLock}`,
    [data.subscription_id, creditProductIds],
  );

  const availableByProduct = new Map<string, number>();
  for (const credit of credits.rows) {
    availableByProduct.set(
      credit.product_id,
      (availableByProduct.get(credit.product_id) ?? 0) + toNumber(credit.remaining),
    );
  }

  const items: SubscriptionCoverageLine[] = [];
  for (const item of coverageItems) {
    const availableCredits = availableByProduct.get(item.creditProductId) ?? 0;
    if (availableCredits <= 0) continue;

    const maxCoveredUnits = Math.floor((availableCredits + Number.EPSILON) / item.creditMultiplier);
    const coveredQuantity = Math.min(item.quantity, maxCoveredUnits);
    if (coveredQuantity <= 0) continue;

    const creditsConsumed = coveredQuantity * item.creditMultiplier;
    availableByProduct.set(item.creditProductId, availableCredits - creditsConsumed);

    const coveredAmount = roundMoney((item.total / item.quantity) * coveredQuantity);
    items.push({
      index: item.index,
      product_id: item.product_id,
      credit_product_id: item.creditProductId,
      product_name: item.product_name,
      quantity: item.quantity,
      credit_multiplier: item.creditMultiplier,
      coverage_multiplier: item.coverageMultiplier,
      coverage_percent: item.coverage_percent,
      covered_quantity: coveredQuantity,
      remaining_quantity: item.quantity - coveredQuantity,
      credits_consumed: creditsConsumed,
      covered_amount: coveredAmount,
    });
  }

  return {
    subscription_id: data.subscription_id,
    total_covered_amount: roundMoney(items.reduce((sum, item) => sum + item.covered_amount, 0)),
    total_credits_consumed: items.reduce((sum, item) => sum + item.credits_consumed, 0),
    items,
  };
}

export async function calculateSubscriptionCoverage(data: {
  subscription_id: string;
  items: SubscriptionCoverageInputItem[];
}): Promise<SubscriptionCoverageResult> {
  return db.transaction((client: PoolClient) => calculateSubscriptionCoverageWithClient(client, data));
}

// ─── RECEIPTS ─────────────────────────────────────────

export async function createReceipt(data: {
  shift_id?: string | null;
  employee_id: string;
  studio_id: string;
  customer_phone?: string;
  customer_name?: string;
  loyalty_profile_id?: string;
  subscription_id?: string;
  is_refund?: boolean;
  refund_receipt_id?: string;
  items: PosReceiptItem[];
  payments: PosReceiptPayment[];
  subtotal: number;
  discount_total?: number;
  points_discount?: number;
  subscription_credit_used?: number;
  total: number;
  category_slug?: string | null;
  consumableItems?: ConsumptionItem[];
  promo_code?: string | null;
  partner_id?: number | null;
  print_order_id?: PhotoPrintOrdersId | null;
  education_volume_consumed?: {
    entitlementId: string;
    userId: string;
    documents: number;
    photos: number;
    documentDiscountAmount?: number;
    photoDiscountAmount?: number;
  } | null;
  /** Акция «Фото на студенческий 4×200»: пакет к списанию на образовательный аккаунт (в окне period_key). */
  student_id_photo_promo_consumed?: {
    studentAccountId: string;
    userId: string;
    periodKey: string;
    units: number;
    unitPrice: number;
    discountAmount: number;
  } | null;
  /** POS receipt metadata JSONB, written atomically with the receipt. */
  metadata?: PosReceiptMetadataJsonb | null;
}): Promise<PosReceipt> {
  const normalizedInputPayments = data.payments.map(normalizePayment);
  const inputHasSubscriptionPayment = normalizedInputPayments.some(p => p.payment_type === 'subscription');
  const inputHasSubscriptionCreditMarks = toNumber(data.subscription_credit_used) > 0
    || data.items.some(item => toNumber(item.subscription_credits_used) > 0);

  if (!inputHasSubscriptionPayment && inputHasSubscriptionCreditMarks) {
    throw new AppError(
      400,
      'subscription_credits_used можно передавать только вместе с оплатой subscription',
      ErrorCode.POS_SUBSCRIPTION_COVERAGE_MISMATCH,
    );
  }

  const receiptCreatedAt = Date.now();
  return db.transaction(async (client: PoolClient) => {
    let receiptItems: PosReceiptItem[] = data.items.map(item => ({
      ...item,
      subscription_credits_used: 0,
    }));
    const receiptPayments: PosReceiptPayment[] = normalizedInputPayments;
    let subscriptionCoverage: SubscriptionCoverageResult | null = null;
    let subscriptionCreditUsed = 0;

    if (data.is_refund && data.refund_receipt_id) {
      await lockReceiptForRefundSource(client, data.refund_receipt_id);
      if (await receiptHasActiveRefund(client, data.refund_receipt_id)) {
        throw new AppError(
          409,
          'По этому чеку уже оформлен возврат',
          ErrorCode.POS_RECEIPT_ALREADY_REFUNDED,
        );
      }
    }

    if (inputHasSubscriptionPayment && !data.is_refund) {
      if (!data.subscription_id) {
        throw new AppError(
          400,
          'subscription_id is required for subscription payment',
          ErrorCode.POS_SUBSCRIPTION_REQUIRED,
        );
      }

      subscriptionCoverage = await calculateSubscriptionCoverageWithClient(
        client,
        { subscription_id: data.subscription_id, items: data.items },
        { lock: true },
      );

      if (subscriptionCoverage.total_covered_amount <= 0) {
        throw new AppError(
          400,
          'Подписка не покрывает позиции этого чека',
          ErrorCode.POS_SUBSCRIPTION_INSUFFICIENT_CREDITS,
        );
      }

      const subscriptionPaymentAmount = roundMoney(
        receiptPayments
          .filter(payment => payment.payment_type === 'subscription')
          .reduce((sum, payment) => sum + payment.amount, 0),
      );

      if (Math.abs(subscriptionPaymentAmount - subscriptionCoverage.total_covered_amount) > 0.01) {
        throw new AppError(
          400,
          `Сумма оплаты подпиской (${subscriptionPaymentAmount}) не совпадает с покрытием (${subscriptionCoverage.total_covered_amount})`,
          ErrorCode.POS_SUBSCRIPTION_COVERAGE_MISMATCH,
        );
      }

      const coveredAmountByIndex = new Map(
        subscriptionCoverage.items.map(item => [item.index, item.covered_amount]),
      );
      receiptItems = data.items.map((item, index) => ({
        ...item,
        subscription_credits_used: coveredAmountByIndex.get(index) ?? 0,
      }));
      subscriptionCreditUsed = subscriptionCoverage.total_covered_amount;
    }

    // Validate payments total matches receipt total after server-side subscription coverage.
    const paymentsSum = roundMoney(receiptPayments.reduce((sum, p) => sum + p.amount, 0));
    if (Math.abs(paymentsSum - data.total) > 0.01) {
      throw new AppError(400, `Payments total (${paymentsSum}) does not match receipt total (${data.total})`, ErrorCode.POS_PAYMENTS_MISMATCH);
    }

    const itemsSum = roundMoney(receiptItems.reduce((sum, item) => sum + toNumber(item.total), 0));
    if (Math.abs(itemsSum - data.total) > 0.01) {
      throw new AppError(400, `Receipt items total (${itemsSum}) does not match receipt total (${data.total})`, ErrorCode.POS_RECEIPT_ITEMS_MISMATCH);
    }

    // Generate receipt number
    const seq = await client.query(`SELECT nextval('pos_receipt_seq') as num`);
    const num = String(seq.rows[0].num).padStart(6, '0');
    const receiptNumber = `SF-POS-${num}`;

    // Insert receipt
    const receiptResult = await client.query(
      `INSERT INTO pos_receipts (
        receipt_number, shift_id, employee_id, studio_id,
        customer_phone, customer_name, loyalty_profile_id, subscription_id,
        is_refund, refund_receipt_id,
        subtotal, discount_total, points_discount, subscription_credit_used, total,
        promo_code, partner_id, print_order_id, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::jsonb, '{}'::jsonb))
      RETURNING *`,
      [
        receiptNumber,
        data.shift_id || null, data.employee_id, data.studio_id,
        data.customer_phone || null, data.customer_name || null,
        data.loyalty_profile_id || null, data.subscription_id || null,
        data.is_refund || false, data.refund_receipt_id || null,
        data.subtotal, data.discount_total || 0,
        data.points_discount || 0, subscriptionCreditUsed,
        data.total,
        data.promo_code || null, data.partner_id || null,
        data.print_order_id || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    const receipt = receiptResult.rows[0] as PosReceipt;

    // Batch insert items (один запрос вместо N последовательных)
    if (receiptItems.length > 0) {
      const itemVals: unknown[] = [];
      const itemRows = receiptItems.map((item, i) => {
        const o = i * 16;
        itemVals.push(
          receipt.id, item.product_id || null, item.product_name,
          item.quantity, item.unit_price,
          item.discount_amount || 0, item.discount_percent || 0,
          item.points_used || 0, item.subscription_credits_used || 0,
          item.total, item.vat_rate || null, item.vat_amount || 0, i,
          item.discount_type || null,
          item.discount_label || null,
          item.print_fill_percent ?? null,
        );
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12},$${o+13},$${o+14},$${o+15},$${o+16})`;
      });
      await client.query(
        `INSERT INTO pos_receipt_items (
          receipt_id, product_id, product_name, quantity, unit_price,
          discount_amount, discount_percent, points_used, subscription_credits_used,
          total, vat_rate, vat_amount, sort_order, discount_type, discount_label, print_fill_percent
        ) VALUES ${itemRows.join(',')}`,
        itemVals
      );
    }

    // Batch insert payments
    if (receiptPayments.length > 0) {
      const payVals: unknown[] = [];
      const payRows = receiptPayments.map((payment, i) => {
        const o = i * 6;
        payVals.push(
          receipt.id, payment.payment_type, payment.amount,
          payment.card_info || null, payment.transaction_id || null,
          'completed',
        );
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6})`;
      });
      await client.query(
        `INSERT INTO pos_receipt_payments (
          receipt_id, payment_type, amount, card_info, transaction_id, status
        ) VALUES ${payRows.join(',')}`,
        payVals
      );
    }

    // Update shift totals
    if (data.is_refund) {
      await client.query(
        `UPDATE pos_shifts SET total_refunds = total_refunds + ABS($2), receipt_count = receipt_count + 1
         WHERE id = $1`,
        [data.shift_id, data.total]
      );
    } else {
      await client.query(
        `UPDATE pos_shifts SET total_sales = total_sales + $2, receipt_count = receipt_count + 1
         WHERE id = $1`,
        [data.shift_id, data.total]
      );
    }

    // Adjust stock for product-type items (upsert to handle missing product_stock rows)
    for (const item of receiptItems) {
      if (item.product_id) {
        const delta = data.is_refund ? item.quantity : -item.quantity;
        await client.query(
          `INSERT INTO product_stock (product_id, studio_id, quantity)
           VALUES ($1, $2, GREATEST(0, $3))
           ON CONFLICT (product_id, studio_id)
           DO UPDATE SET quantity = GREATEST(0, product_stock.quantity + $3), updated_at = NOW()`,
          [item.product_id, data.studio_id, delta]
        );
      }
    }

    // Apply consumable rules deductions (service option -> product_stock)
    if (data.consumableItems?.length && !data.is_refund) {
      await applyConsumption(
        receipt.id as PosReceiptsId,
        data.consumableItems,
        data.studio_id as StudiosId,
        data.employee_id as UsersId,
        client,
      );
    }

    // Reverse consumable deductions on refund
    if (data.is_refund && data.refund_receipt_id) {
      await reverseConsumption(data.refund_receipt_id as PosReceiptsId, client);
      await restoreStudentDiscountUsageForReceiptWithClient(client, { receiptId: data.refund_receipt_id });
      await restoreStudentIdPhotoPromoForReceiptWithClient(client, { receiptId: data.refund_receipt_id });
    }

    if (!data.is_refund) {
      await recordStudentDiscountUsageForReceiptWithClient(client, {
        receiptId: receipt.id,
        customerPhone: data.customer_phone ?? null,
        items: receiptItems,
      });
      // Образовательный rolling-30 лимит: списать фактически покрытые account-скидкой
      // единицы (документы/фото). Кап объёма уже выполнен в pricing-engine.
      if (data.education_volume_consumed
        && (data.education_volume_consumed.documents > 0 || data.education_volume_consumed.photos > 0)) {
        await recordEducationVolumeUsageForReceiptWithClient(client, {
          receiptId: receipt.id,
          customerPhone: data.customer_phone ?? null,
          entitlementId: data.education_volume_consumed.entitlementId,
          userId: data.education_volume_consumed.userId,
          documents: data.education_volume_consumed.documents,
          photos: data.education_volume_consumed.photos,
          documentDiscountAmount: data.education_volume_consumed.documentDiscountAmount,
          photoDiscountAmount: data.education_volume_consumed.photoDiscountAmount,
          printOrderId: data.print_order_id ?? null,
        });
      }
      // Акция «Фото на студенческий 4×200»: одноразовое списание пакета на образовательный
      // аккаунт (lifetime-кап). ON CONFLICT(student_account_id) DO NOTHING — гонко-безопасно.
      if (data.student_id_photo_promo_consumed) {
        await recordStudentIdPhotoPromoForReceiptWithClient(client, {
          receiptId: receipt.id,
          studentAccountId: data.student_id_photo_promo_consumed.studentAccountId,
          userId: data.student_id_photo_promo_consumed.userId,
          periodKey: data.student_id_photo_promo_consumed.periodKey,
          units: data.student_id_photo_promo_consumed.units,
          unitPrice: data.student_id_photo_promo_consumed.unitPrice,
          discountAmount: data.student_id_photo_promo_consumed.discountAmount,
          customerPhone: data.customer_phone ?? null,
          printOrderId: data.print_order_id ?? null,
          source: 'pos',
        });
      }
    }

    // Employee sales attribution
    if (!data.is_refund && data.total > 0) {
      await recordSale(
        receipt.id,
        data.employee_id,
        data.total,
        data.category_slug ?? null,
        client,
      );
    }

    // Reverse employee sale on refund
    if (data.is_refund && data.refund_receipt_id) {
      await reverseEmployeeSale(data.refund_receipt_id, client);
      await restoreCreditsForPosReceiptWithClient(client, {
        pos_receipt_id: data.refund_receipt_id,
        employee_id: data.employee_id,
        description: `Возврат POS чека ${receiptNumber}`,
        reversal_reason: `refund:${receipt.id}`,
      });
    }

    // Deduct subscription credits atomically (within same transaction)
    if (subscriptionCoverage && data.subscription_id && !data.is_refund) {
      for (const item of subscriptionCoverage.items) {
        if (item.covered_quantity > 0 && item.product_id) {
          await useCreditsWithClient(client, {
            subscription_id: data.subscription_id,
            product_id: item.product_id,
            quantity: item.covered_quantity,
            coverage_multiplier: item.coverage_multiplier,
            coverage_percent: item.coverage_percent,
            pos_receipt_id: receipt.id,
            employee_id: data.employee_id,
            description: `POS чек ${receiptNumber}`,
          });
        }
      }
    }

    receipt.items = receiptItems;
    receipt.payments = receiptPayments;
    return receipt;
  }).then(receipt => {
    recordBusinessEvent({
      domain: 'pos',
      event: data.is_refund ? 'receipt.refund_created' : 'receipt.created',
      outcome: 'success',
      severity: 'info',
      actorId: data.employee_id,
      entityType: 'pos_receipt',
      entityId: receipt.id,
      orderId: data.print_order_id ?? null,
      durationMs: Date.now() - receiptCreatedAt,
      metadata: {
        receiptNumber: receipt.receipt_number,
        studioId: data.studio_id,
        shiftId: data.shift_id ?? null,
        total: data.total,
        isRefund: !!data.is_refund,
        itemCount: data.items.length,
        paymentTypes: receipt.payments?.map(payment => payment.payment_type) ?? [],
      },
    });

    return receipt;
  }).catch((err: unknown) => {
    recordBusinessEvent({
      domain: 'pos',
      event: data.is_refund ? 'receipt.refund_failed' : 'receipt.create_failed',
      outcome: 'failure',
      severity: 'error',
      actorId: data.employee_id,
      orderId: data.print_order_id ?? null,
      durationMs: Date.now() - receiptCreatedAt,
      error: err,
      metadata: {
        studioId: data.studio_id,
        shiftId: data.shift_id ?? null,
        total: data.total,
        isRefund: !!data.is_refund,
        itemCount: data.items.length,
        paymentTypes: normalizedInputPayments.map(payment => payment.payment_type),
      },
    });
    throw err;
  });
}

// ─── VOID RECEIPT ────────────────────────────────────

export async function voidReceipt(
  receiptId: string,
  reason: string,
  voidedBy: string,
  shiftId: string,
): Promise<PosReceipt> {
  return db.transaction(async (client: PoolClient) => {
    // Lock receipt row to prevent concurrent void
    const receiptRow = await client.query<PosReceipt & { voided_at: string | null }>(
      `SELECT r.*, s.opened_at as shift_opened_at
       FROM pos_receipts r
       JOIN pos_shifts s ON r.shift_id = s.id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [receiptId],
    );
    const receipt = receiptRow.rows[0];
    if (!receipt) throw new AppError(404, 'Чек не найден', ErrorCode.POS_RECEIPT_NOT_FOUND);
    if (receipt.voided_at) throw new AppError(400, 'Чек уже аннулирован', ErrorCode.POS_RECEIPT_ALREADY_VOIDED);
    if (receipt.is_refund) throw new AppError(400, 'Нельзя аннулировать чек возврата', ErrorCode.POS_CANNOT_REFUND_REFUND);
    const hasSubscriptionCreditUsage = toNumber(receipt.subscription_credit_used) > 0
      || await receiptHasSubscriptionPayment(client, receiptId);

    // Verify receipt belongs to current shift
    if (receipt.shift_id !== shiftId) {
      throw new AppError(400, 'Чек не принадлежит текущей смене', ErrorCode.POS_RECEIPT_WRONG_SHIFT);
    }

    // Verify current shift is open
    const currentShift = await client.query(
      `SELECT id, status FROM pos_shifts WHERE id = $1 AND status = 'open' FOR UPDATE`,
      [shiftId],
    );
    if (currentShift.rows.length === 0) {
      throw new AppError(400, 'Смена закрыта — аннулирование невозможно', ErrorCode.POS_SHIFT_CLOSED);
    }

    // Mark receipt as voided
    await client.query(
      `UPDATE pos_receipts
       SET void_reason = $2, voided_at = NOW(), voided_by = $3
       WHERE id = $1`,
      [receiptId, reason, voidedBy],
    );

    // Reverse shift totals
    const receiptTotal = parseFloat(String(receipt.total));
    if (!receipt.is_refund) {
      await client.query(
        `UPDATE pos_shifts
         SET total_sales = total_sales - $2, receipt_count = GREATEST(0, receipt_count - 1)
         WHERE id = $1`,
        [shiftId, receiptTotal],
      );
    } else {
      await client.query(
        `UPDATE pos_shifts
         SET total_refunds = total_refunds - ABS($2), receipt_count = GREATEST(0, receipt_count - 1)
         WHERE id = $1`,
        [shiftId, receiptTotal],
      );
    }

    // Reverse stock adjustments for product items
    const items = await client.query<Pick<PosReceiptItem, 'product_id' | 'quantity'>>(
      `SELECT product_id, quantity FROM pos_receipt_items WHERE receipt_id = $1 AND product_id IS NOT NULL`,
      [receiptId],
    );
    for (const item of items.rows) {
      await client.query(
        `UPDATE product_stock
         SET quantity = quantity + $1, updated_at = NOW()
         WHERE product_id = $2 AND studio_id = $3`,
        [item.quantity, item.product_id, receipt.studio_id],
      );
    }

    // Reverse consumable deductions
    await reverseConsumption(receiptId as PosReceiptsId, client);

    // Reverse employee sale attribution
    await reverseEmployeeSale(receiptId, client);

    await restoreStudentDiscountUsageForReceiptWithClient(client, { receiptId });
    await restoreStudentIdPhotoPromoForReceiptWithClient(client, { receiptId });

    if (hasSubscriptionCreditUsage) {
      await restoreCreditsForPosReceiptWithClient(client, {
        pos_receipt_id: receiptId,
        employee_id: voidedBy,
        description: `Аннулирование POS чека ${receipt.receipt_number || receiptId}`,
        reversal_reason: reason,
      });
    }

    return { ...receipt, void_reason: reason, voided_at: new Date().toISOString(), voided_by: voidedBy };
  });
}

// ─── PARTIAL REFUND ──────────────────────────────────

export interface PartialRefundItem {
  product_id: string;
  quantity: number;
  amount: number;
}

export async function partialRefund(
  receiptId: string,
  items: PartialRefundItem[],
  shiftId: string,
  employeeId: string,
  studioId: string,
): Promise<PosReceipt> {
  return db.transaction(async (client: PoolClient) => {
    // Lock original receipt
    const originalRow = await client.query<PosReceipt>(
      `SELECT * FROM pos_receipts WHERE id = $1 FOR UPDATE`,
      [receiptId],
    );
    const original = originalRow.rows[0];
    if (!original) throw new AppError(404, 'Оригинальный чек не найден', ErrorCode.POS_RECEIPT_NOT_FOUND);
    if (original.is_refund) throw new AppError(400, 'Нельзя сделать возврат на чек возврата', ErrorCode.POS_CANNOT_REFUND_REFUND);
    const hasSubscriptionCreditUsage = toNumber(original.subscription_credit_used) > 0
      || await receiptHasSubscriptionPayment(client, receiptId);

    // Load original items for validation
    const originalItems = await client.query<PosReceiptItem & { id: string }>(
      `SELECT * FROM pos_receipt_items WHERE receipt_id = $1`,
      [receiptId],
    );

    // Build lookup: product_id -> original item
    const originalItemMap = new Map<string, PosReceiptItem & { id: string }>();
    for (const oi of originalItems.rows) {
      if (oi.product_id) {
        originalItemMap.set(oi.product_id, oi);
      }
    }

    const refundedByProduct = await getRefundedQuantitiesByProduct(client, receiptId);

    // Validate refund items
    for (const item of items) {
      const orig = originalItemMap.get(item.product_id);
      if (!orig) {
        throw new AppError(400, `Товар ${item.product_id} не найден в оригинальном чеке`);
      }
      const originalQuantity = toNumber(orig.quantity);
      const alreadyRefundedQuantity = refundedByProduct.get(item.product_id) ?? 0;
      const remainingQuantity = originalQuantity - alreadyRefundedQuantity;
      if (item.quantity > remainingQuantity + Number.EPSILON) {
        throw new AppError(400, `Количество возврата (${item.quantity}) превышает остаток (${Math.max(0, remainingQuantity)}) для товара ${orig.product_name}`, ErrorCode.POS_REFUND_QTY_EXCEEDED);
      }
    }

    // Calculate refund total
    const refundTotal = items.reduce((sum, i) => sum + i.amount, 0);

    // Get original payment types for refund payments
    const originalPayments = await client.query<PosReceiptPayment>(
      `SELECT * FROM pos_receipt_payments WHERE receipt_id = $1 ORDER BY amount DESC`,
      [receiptId],
    );
    const primaryNonSubscriptionPayment = originalPayments.rows.find(payment => payment.payment_type !== 'subscription');
    const primaryPaymentType = (primaryNonSubscriptionPayment ?? originalPayments.rows[0])?.payment_type || 'cash';

    const subscriptionRestoreItems: { product_id: string; quantity: number }[] = [];
    let subscriptionRefundAmount = 0;
    if (hasSubscriptionCreditUsage) {
      for (const item of items) {
        const orig = originalItemMap.get(item.product_id);
        if (!orig) continue;
        const originalQuantity = toNumber(orig.quantity);
        const originalTotal = toNumber(orig.total);
        const unitTotal = originalQuantity > 0 ? originalTotal / originalQuantity : toNumber(orig.unit_price);
        const coveredQuantity = unitTotal > 0
          ? Math.floor((toNumber(orig.subscription_credits_used) + Number.EPSILON) / unitTotal)
          : 0;
        const quantityToRestore = Math.min(item.quantity, coveredQuantity);
        if (quantityToRestore <= 0) continue;
        subscriptionRestoreItems.push({ product_id: item.product_id, quantity: quantityToRestore });
        subscriptionRefundAmount += roundMoney(unitTotal * quantityToRestore);
      }
    }
    subscriptionRefundAmount = roundMoney(Math.min(subscriptionRefundAmount, refundTotal));
    const nonSubscriptionRefundAmount = roundMoney(refundTotal - subscriptionRefundAmount);

    // Build refund receipt items
    const refundReceiptItems: PosReceiptItem[] = items.map((item) => {
      const orig = originalItemMap.get(item.product_id)!;
      return {
        product_id: item.product_id,
        product_name: orig.product_name,
        quantity: item.quantity,
        unit_price: parseFloat(String(orig.unit_price)),
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: -item.amount,
        vat_rate: orig.vat_rate ?? undefined,
      };
    });

    const refundPayments: PosReceiptPayment[] = [];
    if (subscriptionRefundAmount > 0) {
      refundPayments.push({ payment_type: 'subscription', amount: -subscriptionRefundAmount });
    }
    if (nonSubscriptionRefundAmount > 0 || refundPayments.length === 0) {
      refundPayments.push({
        payment_type: primaryPaymentType as PosReceiptPayment['payment_type'],
        amount: -nonSubscriptionRefundAmount || -refundTotal,
      });
    }

    // Generate receipt number
    const seq = await client.query(`SELECT nextval('pos_receipt_seq') as num`);
    const num = String(seq.rows[0].num).padStart(6, '0');
    const receiptNumber = `SF-POS-${num}`;

    // Insert refund receipt
    const refundItemsJson = items.map(i => ({
      product_id: i.product_id,
      quantity: i.quantity,
      amount: i.amount,
    }));

    const receiptResult = await client.query(
      `INSERT INTO pos_receipts (
        receipt_number, shift_id, employee_id, studio_id,
        customer_phone, customer_name, loyalty_profile_id, subscription_id,
        is_refund, refund_receipt_id, refund_items,
        subtotal, discount_total, points_discount, subscription_credit_used, total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        receiptNumber, shiftId, employeeId, studioId,
        original.customer_phone, original.customer_name,
        original.loyalty_profile_id, original.subscription_id,
        true, receiptId, JSON.stringify(refundItemsJson),
        -refundTotal, 0, 0, 0, -refundTotal,
      ],
    );
    const refundReceipt = receiptResult.rows[0] as PosReceipt;

    // Insert refund receipt items
    if (refundReceiptItems.length > 0) {
      const itemVals: unknown[] = [];
      const itemRows = refundReceiptItems.map((item, i) => {
        const o = i * 13;
        itemVals.push(
          refundReceipt.id, item.product_id || null, item.product_name,
          item.quantity, item.unit_price,
          item.discount_amount || 0, item.discount_percent || 0,
          item.points_used || 0, item.subscription_credits_used || 0,
          item.total, item.vat_rate || null, 0, i,
        );
        return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12},$${o+13})`;
      });
      await client.query(
        `INSERT INTO pos_receipt_items (
          receipt_id, product_id, product_name, quantity, unit_price,
          discount_amount, discount_percent, points_used, subscription_credits_used,
          total, vat_rate, vat_amount, sort_order
        ) VALUES ${itemRows.join(',')}`,
        itemVals,
      );
    }

    // Insert refund payments
    if (refundPayments.length > 0) {
      const payVals: unknown[] = [];
      const payRows = refundPayments.map((payment, i) => {
        const o = i * 3;
        payVals.push(refundReceipt.id, payment.payment_type, payment.amount);
        return `($${o+1}, $${o+2}, $${o+3}, 'completed')`;
      });
      await client.query(
        `INSERT INTO pos_receipt_payments (receipt_id, payment_type, amount, status)
         VALUES ${payRows.join(',')}`,
        payVals,
      );
    }

    // Update shift totals
    await client.query(
      `UPDATE pos_shifts SET total_refunds = total_refunds + $2, receipt_count = receipt_count + 1
       WHERE id = $1`,
      [shiftId, refundTotal],
    );

    // Reverse stock for refunded items
    for (const item of items) {
      await client.query(
        `UPDATE product_stock
         SET quantity = quantity + $1, updated_at = NOW()
         WHERE product_id = $2 AND studio_id = $3`,
        [item.quantity, item.product_id, studioId],
      );
    }

    if (subscriptionRestoreItems.length > 0) {
      await restoreCreditsForPosReceiptItemsWithClient(client, {
        pos_receipt_id: receiptId,
        items: subscriptionRestoreItems,
        employee_id: employeeId,
        description: `Частичный возврат POS чека ${receiptNumber}`,
        reversal_reason: `partial_refund:${refundReceipt.id}`,
      });
    }

    await restoreStudentDiscountUsageForReceiptItemsWithClient(client, {
      receiptId,
      items: items.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
      })),
    });

    refundReceipt.items = refundReceiptItems;
    refundReceipt.payments = refundPayments;
    return refundReceipt;
  });
}

export async function getReceiptById(id: string): Promise<PosReceipt | null> {
  const receipt = await db.queryOne<PosReceipt>(
    `SELECT r.id, r.receipt_number, r.shift_id, r.employee_id, r.studio_id,
            u.display_name AS employee_name, s.name AS studio_name,
            r.customer_phone, r.customer_name, r.loyalty_profile_id, r.subscription_id,
            r.is_refund, r.refund_receipt_id, r.subtotal, r.discount_total,
            r.points_discount, r.subscription_credit_used, r.total,
            r.fiscal_receipt_url, r.fiscal_receipt_number, r.fiscal_sign, r.fiscal_source,
            r.fiscal_status, r.fiscal_attempts, r.fiscal_last_error,
            r.void_reason, r.voided_at, r.created_at
     FROM pos_receipts r
     LEFT JOIN users u ON u.id = r.employee_id
     LEFT JOIN studios s ON s.id = r.studio_id
     WHERE r.id = $1`,
    [id]
  );
  if (!receipt) return null;

  const items = await db.query<PosReceiptItem>(
    `SELECT id, receipt_id, product_id, product_name, quantity, unit_price, discount_amount,
            discount_percent, points_used, subscription_credits_used, total, vat_rate,
            vat_amount, sort_order, discount_type, discount_label, print_fill_percent
     FROM pos_receipt_items
     WHERE receipt_id = $1
     ORDER BY sort_order`,
    [id]
  );

  const payments = await db.query<PosReceiptPayment>(
    `SELECT p.id, p.receipt_id, p.payment_type, p.amount, p.card_info, p.transaction_id, p.sbp_qr_url, p.status,
            pt.status AS transaction_status,
            pt.payment_resolution,
            COALESCE(pt.payment_resolution, pt.status, p.status) AS effective_status,
            pt.error_message AS terminal_error_message,
            pt.initiated_at AS terminal_initiated_at,
            pt.completed_at AS terminal_completed_at
     FROM pos_receipt_payments p
     LEFT JOIN pos_transactions pt ON pt.id::text = p.transaction_id AND pt.transaction_type = 'payment'
     WHERE p.receipt_id = $1`,
    [id]
  );

  receipt.items = items;
  receipt.payments = payments;
  return receipt;
}

function isReceiptPaymentType(value: string): value is PosReceiptPayment['payment_type'] {
  return value === 'cash'
    || value === 'card'
    || value === 'sbp'
    || value === 'online'
    || value === 'subscription'
    || value === 'transfer';
}

function mapReceiptListItem(row: PosReceiptListRow['items'][number]): PosReceiptItem {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: toNumber(row.quantity),
    unit_price: toNumber(row.unit_price),
    discount_amount: toNumber(row.discount_amount),
    discount_percent: toNumber(row.discount_percent),
    points_used: toNumber(row.points_used),
    subscription_credits_used: toNumber(row.subscription_credits_used),
    total: toNumber(row.total),
    vat_rate: row.vat_rate ?? undefined,
    vat_amount: toNumber(row.vat_amount),
    discount_type: row.discount_type,
    discount_label: row.discount_label,
    print_fill_percent: row.print_fill_percent,
  };
}

function mapReceiptListPayment(row: PosReceiptListRow['payments'][number]): PosReceiptPayment | null {
  if (!isReceiptPaymentType(row.payment_type)) {
    return null;
  }
  return {
    payment_type: row.payment_type,
    amount: toNumber(row.amount),
    card_info: row.card_info ?? undefined,
    transaction_id: row.transaction_id ?? undefined,
    transaction_status: row.transaction_status,
    payment_resolution: row.payment_resolution,
    effective_status: row.effective_status,
    terminal_error_message: row.terminal_error_message,
    terminal_initiated_at: row.terminal_initiated_at,
    terminal_completed_at: row.terminal_completed_at,
  };
}

function mapReceiptListRow(row: PosReceiptListRow): PosReceipt {
  return {
    id: row.id,
    receipt_number: row.receipt_number,
    shift_id: row.shift_id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    studio_id: row.studio_id,
    studio_name: row.studio_name,
    customer_phone: row.customer_phone,
    customer_name: row.customer_name,
    loyalty_profile_id: row.loyalty_profile_id,
    subscription_id: row.subscription_id,
    is_refund: row.is_refund === true,
    refund_receipt_id: row.refund_receipt_id,
    subtotal: toNumber(row.subtotal),
    discount_total: toNumber(row.discount_total),
    points_discount: toNumber(row.points_discount),
    subscription_credit_used: toNumber(row.subscription_credit_used),
    total: toNumber(row.total),
    fiscal_receipt_url: row.fiscal_receipt_url,
    fiscal_receipt_number: row.fiscal_receipt_number,
    fiscal_sign: row.fiscal_sign,
    fiscal_source: row.fiscal_source ?? '',
    fiscal_status: row.fiscal_status,
    fiscal_attempts: row.fiscal_attempts,
    fiscal_last_error: row.fiscal_last_error,
    void_reason: row.void_reason,
    voided_at: row.voided_at,
    created_at: row.created_at,
    items: row.items.map(mapReceiptListItem),
    payments: row.payments
      .map(mapReceiptListPayment)
      .filter((payment): payment is PosReceiptPayment => payment !== null),
  };
}

export async function getReceipts(filters: {
  shift_id?: string;
  studio_id?: string;
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  customer_phone?: string;
  is_refund?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: PosReceipt[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.shift_id) {
    conditions.push(`r.shift_id = $${idx++}`);
    params.push(filters.shift_id);
  }
  if (filters.studio_id) {
    conditions.push(`r.studio_id = $${idx++}`);
    params.push(filters.studio_id);
  }
  if (filters.employee_id) {
    conditions.push(`r.employee_id = $${idx++}`);
    params.push(filters.employee_id);
  }
  if (filters.date_from) {
    conditions.push(`r.created_at >= $${idx++}`);
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push(`r.created_at <= $${idx++}`);
    params.push(filters.date_to);
  }
  if (filters.customer_phone) {
    conditions.push(`r.customer_phone = $${idx++}`);
    params.push(filters.customer_phone);
  }
  if (filters.is_refund !== undefined) {
    conditions.push(`r.is_refund = $${idx++}`);
    params.push(filters.is_refund);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [rows, countResult] = await Promise.all([
    db.query<PosReceiptListRow>(
      `SELECT r.id, r.receipt_number, r.shift_id, r.employee_id, u.display_name AS employee_name,
              r.studio_id, s.name AS studio_name,
              r.customer_phone, r.customer_name, r.loyalty_profile_id, r.subscription_id,
              r.is_refund, r.refund_receipt_id, r.subtotal, r.discount_total,
              r.points_discount, r.subscription_credit_used, r.total,
              r.fiscal_receipt_url, r.fiscal_receipt_number, r.fiscal_sign, r.fiscal_source,
              r.fiscal_status, r.fiscal_attempts, r.fiscal_last_error,
              r.void_reason, r.voided_at, r.created_at,
              COALESCE(ri.items, '[]'::json) AS items,
              COALESCE(rp.payments, '[]'::json) AS payments
       FROM pos_receipts r
       LEFT JOIN users u ON u.id = r.employee_id
       LEFT JOIN studios s ON s.id = r.studio_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'product_id', i.product_id,
           'product_name', i.product_name,
           'quantity', i.quantity,
           'unit_price', i.unit_price,
           'discount_amount', i.discount_amount,
           'discount_percent', i.discount_percent,
           'points_used', i.points_used,
           'subscription_credits_used', i.subscription_credits_used,
           'total', i.total,
           'vat_rate', i.vat_rate,
           'vat_amount', i.vat_amount,
           'discount_type', i.discount_type,
           'discount_label', i.discount_label,
           'print_fill_percent', i.print_fill_percent
         ) ORDER BY i.sort_order NULLS LAST, i.id) AS items
         FROM pos_receipt_items i
         WHERE i.receipt_id = r.id
       ) ri ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'payment_type', p.payment_type,
           'amount', p.amount,
           'card_info', p.card_info,
           'transaction_id', p.transaction_id,
           'status', p.status,
           'transaction_status', pt.status,
           'payment_resolution', pt.payment_resolution,
           'effective_status', COALESCE(pt.payment_resolution, pt.status, p.status),
           'terminal_error_message', pt.error_message,
           'terminal_initiated_at', pt.initiated_at,
           'terminal_completed_at', pt.completed_at
         ) ORDER BY p.amount DESC, p.id) AS payments
         FROM pos_receipt_payments p
         LEFT JOIN pos_transactions pt ON pt.id::text = p.transaction_id AND pt.transaction_type = 'payment'
         WHERE p.receipt_id = r.id
       ) rp ON true
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    db.queryOne<CountResult>(
      `SELECT COUNT(*) as count FROM pos_receipts r ${where}`,
      params
    ),
  ]);

  return { items: rows.map(mapReceiptListRow), total: parseInt(countResult?.count || '0', 10) };
}

// ─── CUSTOMER LOOKUP ──────────────────────────────────


export interface CustomerLookupResult {
  loyalty: {
    id: string;
    points: number;
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
    credits: { product_name: string; remaining: number }[];
  } | null;
  student_discount: StudentDiscountSummary | null;
  recent_receipts: number;
  customer_name: string | null;
}

function normalizePhoneTail(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export async function lookupCustomer(phone: string): Promise<CustomerLookupResult> {
  const phoneTail = normalizePhoneTail(phone);

  // Find customer name from customers table
  const customerRow = phoneTail
    ? await db.queryOne<CustomerNameRow>(
      `SELECT name
       FROM customers
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
       LIMIT 1`,
      [phoneTail],
    )
    : null;

  // Unified loyalty profile lookup via LoyaltyService
  const loyaltyProfile = await findProfile({ phone });

  // Find active subscription
  const sub = phoneTail
    ? await db.queryOne<ActiveSubscriptionRow>(
      `SELECT us.id, COALESCE(sp.name, 'Кастомный') as plan_name, us.status
       FROM user_subscriptions us
       LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(us.phone, ''), '\\D', '', 'g'), 10) = $1
         AND us.status = 'active'
       LIMIT 1`,
      [phoneTail],
    )
    : null;

  let credits: SubscriptionCreditRow[] = [];
  if (sub) {
    credits = await db.query<SubscriptionCreditRow>(
      `SELECT sc.product_id, p.name as product_name,
              (sc.total_credits - sc.used_credits) as remaining
       FROM subscription_credits sc
       JOIN products p ON sc.product_id = p.id
       WHERE sc.subscription_id = $1
         AND sc.expires_at > NOW()
         AND sc.used_credits < sc.total_credits
       ORDER BY sc.expires_at ASC`,
      [sub.id]
    );
  }

  const studentDiscount = await getStudentDiscountForPhone(phone);

  // Recent receipts count (last 30 days)
  const recentResult = phoneTail
    ? await db.queryOne<CountResult>(
      `SELECT COUNT(*) as count FROM pos_receipts
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(customer_phone, ''), '\\D', '', 'g'), 10) = $1
         AND created_at > NOW() - INTERVAL '30 days'`,
      [phoneTail],
    )
    : null;

  // Map LoyaltyProfileView to frontend format (preserving old response shape)
  const enrichedLoyalty: CustomerLookupResult['loyalty'] = loyaltyProfile ? {
    id: loyaltyProfile.id,
    points: loyaltyProfile.points,
    level: loyaltyProfile.level,
    total_spent: loyaltyProfile.totalSpent,
    levelName: loyaltyProfile.levelName,
    pointsAsRubles: loyaltyProfile.pointsAsRubles,
    conversionRate: loyaltyProfile.conversionRate,
    can_spend_points: Math.min(loyaltyProfile.points, loyaltyProfile.pointsAsRubles),
    referral_code: loyaltyProfile.referralCode,
    invited_count: loyaltyProfile.invitedCount,
    referred_by_name: null,
  } : null;

  return {
    loyalty: enrichedLoyalty,
    subscription: sub ? { ...sub, credits } : null,
    student_discount: studentDiscount,
    recent_receipts: parseInt(recentResult?.count || '0', 10),
    customer_name: customerRow?.name || null,
  };
}

// ─── ORDER ITEMS ──────────────────────────────────────

/**
 * Записать позиции заказа в order_items (аналитика, fire-and-forget).
 * Вызывается после createReceipt() для POS-заказов через pricing engine.
 */
export async function insertPosOrderItems(
  receiptNumber: string,
  items: {
    name: string;
    unit_price: number;
    quantity: number;
    subtotal: number;
    service_option_id?: string | null;
    product_id?: string | null;
    delivery_method?: string;
  }[]
): Promise<void> {
  if (items.length === 0) return;

  // Batch INSERT вместо цикла (Phase 5 performance pattern)
  const FIELDS_PER_ITEM = 9;
  const values: unknown[] = [];
  const placeholders = items.map((item, i) => {
    const base = i * FIELDS_PER_ITEM;
    values.push(
      receiptNumber,
      'pos',
      item.service_option_id ?? null,
      item.product_id ?? null,
      item.name,
      item.unit_price,
      item.quantity,
      item.subtotal,
      item.delivery_method ?? null,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
  });

  await db.query(
    `INSERT INTO order_items
       (order_id, order_type, service_option_id, product_id,
        name, unit_price, quantity, subtotal, delivery_method)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

// ─── SERVICE WORK TIMER ───────────────────────────────

export interface ServiceWorkLog {
  id: string;
  receipt_id: string | null;
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

export async function startServiceTimer(data: {
  employee_id: string;
  studio_id: string;
  order_description?: string;
  is_custom_order?: boolean;
  custom_surcharge?: number;
  custom_surcharge_reason?: string;
  hourly_rate?: number;
}): Promise<ServiceWorkLog> {
  // Транзакция + FOR UPDATE предотвращает race condition
  // (аналогично openShift)
  return db.transaction(async (client: PoolClient) => {
    const existing = await client.query(
      `SELECT id FROM service_work_logs WHERE employee_id = $1 AND status = 'active' FOR UPDATE`,
      [data.employee_id]
    );
    if (existing.rows.length > 0) {
      throw new AppError(409, 'У вас уже есть активный таймер. Завершите его перед началом нового.');
    }

    const result = await client.query<ServiceWorkLog>(
      `INSERT INTO service_work_logs
         (employee_id, studio_id, order_description, is_custom_order,
          custom_surcharge, custom_surcharge_reason, hourly_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        data.employee_id,
        data.studio_id,
        data.order_description ?? null,
        data.is_custom_order ?? false,
        data.custom_surcharge ?? 0,
        data.custom_surcharge_reason ?? null,
        data.hourly_rate ?? 2000,
      ]
    );
    if (!result.rows[0]) throw new AppError(500, 'Failed to start timer');
    return result.rows[0];
  });
}

export async function stopServiceTimer(workLogId: string, employeeId: string): Promise<ServiceWorkLog> {
  const log = await db.queryOne<ServiceWorkLog>(
    `SELECT * FROM service_work_logs WHERE id = $1 AND employee_id = $2 AND status = 'active'`,
    [workLogId, employeeId]
  );
  if (!log) throw new AppError(404, 'Активный таймер не найден');

  const durationMs = Date.now() - new Date(log.started_at).getTime();
  const durationMinutes = Math.ceil(durationMs / 60000); // округление вверх (поминутный)
  const calculatedAmount = (durationMinutes * log.hourly_rate) / 60;

  const result = await db.queryOne<ServiceWorkLog>(
    `UPDATE service_work_logs
     SET ended_at = NOW(), duration_minutes = $3, calculated_amount = $4, status = 'completed'
     WHERE id = $1 AND employee_id = $2
     RETURNING *`,
    [workLogId, employeeId, durationMinutes, calculatedAmount]
  );
  if (!result) throw new AppError(500, 'Failed to stop timer');
  return result;
}

export async function getActiveTimer(employeeId: string): Promise<ServiceWorkLog | null> {
  return db.queryOne<ServiceWorkLog>(
    `SELECT * FROM service_work_logs WHERE employee_id = $1 AND status = 'active' LIMIT 1`,
    [employeeId]
  );
}

export async function addCustomSurcharge(
  workLogId: string,
  amount: number,
  reason: string
): Promise<ServiceWorkLog> {
  const result = await db.queryOne<ServiceWorkLog>(
    `UPDATE service_work_logs
     SET is_custom_order = true, custom_surcharge = $2, custom_surcharge_reason = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [workLogId, amount, reason]
  );
  if (!result) throw new AppError(404, 'Work log not found');
  return result;
}

// ─── MATERIAL USAGE ───────────────────────────────────

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
  current_stock: number;
  min_quantity: number;
}

export async function recordMaterialUsage(data: {
  receipt_id?: string;
  work_log_id?: string;
  product_id: string;
  quantity: number;
  unit: string;
  studio_id: string;
  employee_id: string;
  notes?: string;
}): Promise<void> {
  await db.transaction(async (client: PoolClient) => {
    // Записать расход
    await client.query(
      `INSERT INTO material_usage
         (receipt_id, work_log_id, product_id, quantity, unit, studio_id, employee_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        data.receipt_id ?? null,
        data.work_log_id ?? null,
        data.product_id,
        data.quantity,
        data.unit,
        data.studio_id,
        data.employee_id,
        data.notes ?? null,
      ]
    );

    // Вычесть из stock (не уходит в минус)
    await client.query(
      `UPDATE product_stock
       SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
       WHERE product_id = $2 AND studio_id = $3`,
      [data.quantity, data.product_id, data.studio_id]
    );

    // Проверить низкий остаток
    const stock = await client.query<LowStockRow>(
      `SELECT ps.quantity, ps.min_quantity, p.name
       FROM product_stock ps
       JOIN products p ON ps.product_id = p.id
       WHERE ps.product_id = $1 AND ps.studio_id = $2`,
      [data.product_id, data.studio_id]
    );

    if (stock.rows[0] && stock.rows[0].min_quantity > 0 &&
        stock.rows[0].quantity <= stock.rows[0].min_quantity) {
      // Логируем для мониторинга (GET /api/pos/materials/low-stock/:studioId для dashboard)
      logger.warn(`[POS] Low stock: ${stock.rows[0].name}, qty=${stock.rows[0].quantity}/${stock.rows[0].min_quantity}, studio=${data.studio_id}`);
    }
  });
}

export async function getMaterialUsageReport(
  studioId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<MaterialUsageReport[]> {
  const conditions: string[] = ['mu.studio_id = $1'];
  const params: unknown[] = [studioId];
  let idx = 2;

  if (dateFrom) {
    conditions.push(`mu.created_at >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`mu.created_at < $${idx++}`);
    params.push(dateTo);
  }

  const where = conditions.join(' AND ');

  return db.query<MaterialUsageReport>(
    `SELECT p.id as product_id, p.name as product_name,
            SUM(mu.quantity)::numeric as total_used,
            mu.unit,
            ps.quantity::numeric as current_stock,
            ps.min_quantity::numeric as min_quantity,
            (ps.quantity IS NOT NULL AND ps.min_quantity IS NOT NULL AND ps.quantity <= ps.min_quantity) as is_low_stock
     FROM material_usage mu
     JOIN products p ON mu.product_id = p.id
     LEFT JOIN product_stock ps ON ps.product_id = mu.product_id AND ps.studio_id = mu.studio_id
     WHERE ${where}
     GROUP BY p.id, p.name, mu.unit, ps.quantity, ps.min_quantity
     ORDER BY total_used DESC`,
    params
  );
}

export async function getLowStock(studioId: string): Promise<LowStockItem[]> {
  return db.query<LowStockItem>(
    `SELECT ps.product_id, p.name as product_name,
            ps.quantity::numeric as current_stock,
            ps.min_quantity::numeric as min_quantity
     FROM product_stock ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.studio_id = $1
       AND ps.min_quantity > 0
       AND ps.quantity <= ps.min_quantity
     ORDER BY (ps.quantity / ps.min_quantity) ASC`,
    [studioId]
  );
}

// ─── FISCAL ───────────────────────────────────────────

export async function updateReceiptFiscal(
  receiptId: string,
  fiscal: { receipt_url: string; receipt_number: string; fiscal_sign: string; source: string }
): Promise<void> {
  await db.query(
    `UPDATE pos_receipts SET
      fiscal_receipt_url = $2,
      fiscal_receipt_number = $3,
      fiscal_sign = $4,
      fiscal_source = $5
     WHERE id = $1`,
    [receiptId, fiscal.receipt_url, fiscal.receipt_number, fiscal.fiscal_sign, fiscal.source]
  );
}

// ─── ОСИРОТЕВШИЕ КАРТ-ОПЛАТЫ + АВТО-ФИСКАЛИЗАЦИЯ (sweep ↔ endpoint, DRY) ──────

/** Снимок корзины в command_payload (минимум для UI; форма как CartSnapshotInput). */
interface OrphanSnapshot {
  items?: unknown[];
  subtotal?: number;
  total?: number;
  customerPhone?: string;
}

/**
 * Строка осиротевшей оплаты: payment+completed без привязанного чека. Источник
 * для GET /payments/orphan и для orphan-sweep (детект → уведомление). snapshot у
 * реальных orphan обычно отсутствует (order_id NULL, /bridge/pay без snapshot).
 */
export interface OrphanPaymentRow {
  id: string;
  studio_id: string;
  amount: string;
  order_id: string | null;
  status: string | null;
  rrn: string | null;
  initiated_by: string | null;
  initiated_by_name: string | null;
  completed_at: string | null;
  command_payload: { orderId?: string; snapshot?: OrphanSnapshot } | null;
}

/**
 * Детектор осиротевших карт-оплат: payment + completed старше ageMinutes, без
 * привязанного чека (нет settled_receipt_id, нет receipt_id, нет строки в
 * pos_receipt_payments по transaction_id), не разрешённых вручную
 * (payment_resolution IS NULL). join pos_receipt_payments строго pt.id::text
 * (колонка text). studioId — фильтр по студии (endpoint); опущен → все студии
 * (sweep). SQL единый для endpoint и sweep (DRY).
 *
 * Проверено на dev-БД: ловит 525/80/1₽ (включая legacy 1₽ с initiated_by NULL),
 * исключает 85₽-failed (status != completed) и 2100₽-с-payments (NOT EXISTS).
 */
export async function findOrphanPayments(
  studioId: string | undefined,
  ageMinutes: number,
  limit = 100,
): Promise<OrphanPaymentRow[]> {
  return db.query<OrphanPaymentRow>(
    `SELECT pt.id, pt.studio_id, pt.amount, pt.order_id, pt.status, pt.rrn,
            pt.initiated_by, u.display_name AS initiated_by_name, pt.completed_at,
            pt.command_payload
       FROM pos_transactions pt
       LEFT JOIN users u ON u.id = pt.initiated_by
      WHERE pt.transaction_type = 'payment'
        AND pt.status = 'completed'
        AND pt.payment_resolution IS NULL
        AND pt.settled_receipt_id IS NULL
        AND pt.receipt_id IS NULL
        AND pt.completed_at <= NOW() - ($2::int * INTERVAL '1 minute')
        AND ($1::uuid IS NULL OR pt.studio_id = $1::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM pos_receipt_payments prp WHERE prp.transaction_id = pt.id::text
        )
      ORDER BY pt.completed_at DESC
      LIMIT $3`,
    [studioId ?? null, ageMinutes, limit],
  );
}

/** Чек-кандидат для авто-ретрая фискализации. */
export interface FiscalRetryCandidateRow {
  id: string;
  receipt_number: string;
  total: string | number;
  fiscal_status: string;
  studio_id: string;
}

/**
 * Кандидаты авто-ретрая фискализации: чеки fiscal_status pending/failed (+ застрявшие
 * queued/processing при includeStuck) свежее maxAgeMinutes, у которых НЕТ завершённой
 * fiscal_sale/refund (анти-дубль слой 1) и число таких fiscal-tx < maxAttempts
 * (стоп-зацикливание). includeStuck=false (default) НЕ берёт queued/processing —
 * у них может быть in-flight fiscal_sale на ATOL (риск двойного чека).
 *
 * P1.2: окно maxAgeMinutes (default 24ч) исключает legacy failed/queued — их
 * добивают только ручной кнопкой, sweep не обстреливает.
 */
export async function findFiscalRetryCandidates(opts: {
  maxAttempts: number;
  maxAgeMinutes: number;
  includeStuck: boolean;
  staleMinutes: number;
  limit?: number;
}): Promise<FiscalRetryCandidateRow[]> {
  const statuses = opts.includeStuck
    ? ['pending', 'failed', 'queued', 'processing']
    : ['pending', 'failed'];
  return db.query<FiscalRetryCandidateRow>(
    `SELECT pr.id, pr.receipt_number, pr.total, pr.fiscal_status, pr.studio_id
       FROM pos_receipts pr
      WHERE pr.fiscal_status = ANY($1::text[])
        AND pr.created_at > NOW() - ($2::int * INTERVAL '1 minute')
        AND (
          pr.fiscal_status <> ALL(ARRAY['queued','processing']::text[])
          OR pr.fiscal_queued_at < NOW() - ($3::int * INTERVAL '1 minute')
        )
        AND NOT EXISTS (
          SELECT 1 FROM pos_transactions ft
           WHERE ft.receipt_id = pr.id
             AND ft.transaction_type IN ('fiscal_sale','fiscal_refund')
             AND ft.status = 'completed'
        )
        AND (
          SELECT count(*) FROM pos_transactions ft2
           WHERE ft2.receipt_id = pr.id
             AND ft2.transaction_type IN ('fiscal_sale','fiscal_refund')
        ) < $4::int
      ORDER BY pr.created_at ASC
      LIMIT $5`,
    [statuses, opts.maxAgeMinutes, opts.staleMinutes, opts.maxAttempts, opts.limit ?? 50],
  );
}
