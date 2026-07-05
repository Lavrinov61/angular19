import { Router, Request, Response } from 'express';
import {
  openShift, enableShiftFiscal, getOpenShiftFiscalState, closeShift, getShifts, getCurrentShift, getShiftReport,
  getCashControl, type CashControlFilters,
  createCashWithdrawal,
  createReceipt, getReceiptById, getReceipts,
  voidReceipt, partialRefund,
  lookupCustomer, updateReceiptFiscal, insertPosOrderItems,
  calculateSubscriptionCoverage,
  startServiceTimer, stopServiceTimer, getActiveTimer, addCustomSurcharge,
  recordMaterialUsage, getMaterialUsageReport, getLowStock,
  findOrphanPayments,
  type PosReceiptItem, type PosReceipt, type PosShiftListFilters,
} from '../services/pos.service.js';
import { findOpenShiftIdForStudio } from '../services/pos-open-shift.helper.js';
import { resolveCustomerPricingPhone } from '../services/customer-pricing-phone.service.js';
import { resolveRetouchConfig } from '../services/retouch-checklist.service.js';
import { createRetouchTaskFromPos } from '../services/retouch.service.js';
import {
  MINIMUM_CHECK_TOTAL,
  MINIMUM_CHECK_WATERFALL_STEP,
  calculatePriceWaterfall, getCategories,
  minimumCheckSurchargeForTotal,
  minimumCheckSurchargeFromWaterfall,
} from '../services/pricing-engine.service.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import {
  openShiftSchema, closeShiftSchema, cashWithdrawalSchema,
  createReceiptSchema, voidReceiptSchema, partialRefundSchema, fullRefundSchema,
  createFromPricingSchema, subscriptionCoverageSchema, updateFiscalSchema,
  fiscalCorrectionSchema, type FiscalCorrectionInput,
  posFiscalSettingsQuerySchema, posFiscalSettingsSchema,
  bridgePaySchema, bridgeRefundSchema, bridgeFiscalSchema, bridgeCashDrawerSchema, bridgeSettlementSchema,
  resolvePaymentSchema, createOrphanReceiptSchema, type CartSnapshotInput, type BridgePricingInput,
  startTimerSchema, stopTimerSchema, customSurchargeSchema,
  recordMaterialUsageSchema,
} from '../schemas/pos.schema.js';
import { idempotent } from '../middleware/idempotency.js';
import { config } from '../config/index.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';
import type Partners from '../types/generated/public/Partners.js';
import { recordReferral, confirmReferral } from '../services/partners.service.js';
import type {
  DailySalesSourceRow,
  AdminSalesOverviewRow,
  EmployeeFavoriteRow,
  EmployeeSaleRow,
  FiscalCorrectionLookup,
  FiscalRetryLookup,
  FiscalStatusRow,
  CountRow,
  PosBridgePaymentForRefundRow,
  PosBridgeRefundLookupRow,
  PosBridgeTransactionStatusRow,
  PosPaymentFailureFieldsRow,
  SalesAggregateRow,
} from '../types/views/pos-views.js';
import db from '../database/db.js';
import { logAudit } from '../services/audit.service.js';
import { enqueueFiscal } from '../workers/pos-fiscal-worker.js';
import {
  isFiscalShiftOpenForShift,
  reconcileFiscalShiftTransactionFromTelemetry,
  getTerminalGateState,
} from '../services/pos-fiscal-shift.service.js';
import {
  classifyFailedPayment,
  effectivePaymentStatus,
} from '../services/pos-payment-classifier.js';
import { enqueueShiftReconciliation } from '../services/pos-reconciliation.service.js';
import { enqueueShiftFiscalCommand } from '../services/pos-fiscal-command.service.js';
import {
  getPosFiscalSettings,
  upsertPosFiscalSettings,
} from '../services/pos-fiscal-settings.service.js';
import {
  enqueueCashDrawerCommand,
  enqueueCashDrawerCommandSafe,
  findPosAgentId,
  hasPositiveCashPayment,
} from '../services/cash-drawer.service.js';

import { createLogger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/error-helpers.js';
import { detectCashbackCategoryKey, findProfile, spendPoints } from '../services/loyalty.service.js';
import { enqueueLoyaltyEarn } from '../workers/loyalty-worker.js';
import type { LoyaltyProfilesId } from '../types/generated/public/LoyaltyProfiles.js';
import type { Server as IOServer } from 'socket.io';
import type PhotoPrintOrders from '../types/generated/public/PhotoPrintOrders.js';
import type Agents from '../types/generated/public/Agents.js';
import type PosTransactions from '../types/generated/public/PosTransactions.js';
import type PosReceipts from '../types/generated/public/PosReceipts.js';
import type PosReceiptPayments from '../types/generated/public/PosReceiptPayments.js';

const router = Router();

const logger = createLogger('pos.routes');
// 660с — согласовано с reqwest-таймаутом op59 в pos-agent (inpas.rs:25). Раньше
// 90с: Node объявлял bank_settlement timeout раньше реального ответа терминала.
const BANK_SETTLEMENT_TIMEOUT_SECONDS = 660;
const BANK_SETTLEMENT_TIMEOUT_MESSAGE = 'Не получен ответ от терминала по сверке итогов';
/**
 * Порог «зависшей» оплаты картой (с): pending/processing старше → in_doubt при
 * polling (P1-2). Покрывает зависший pending, пока фронт ещё опрашивает статус.
 */
const PAYMENT_OPEN_DOUBT_SECONDS = 120;
/**
 * Возраст pending/processing-оплаты (мин) для детекта «зависших» (контур #4).
 * Незаполленные старые pending ловятся при открытии смены / на дашборде кассы.
 */
const IN_DOUBT_PAYMENT_AGE_MINUTES = 5;

/** Строка после UPDATE payment_resolution (RETURNING). */
interface PaymentResolutionRow {
  payment_resolution: string | null;
}

/**
 * Bridge-транзакция polling + payment_resolution (контур #1). Расширяет
 * PosBridgeTransactionStatusRow только в pos.routes.ts (тип view владеет S0/S1).
 */
type BridgeTransactionWithResolution = PosBridgeTransactionStatusRow & {
  payment_resolution?: string | null;
};
type ReceiptCopyLookup = Pick<PosReceipts, 'id' | 'receipt_number' | 'studio_id' | 'voided_at'>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_FISCAL_CORRECTION_BASE_NAME = 'Самостоятельная коррекция после ошибки фискализации';

interface PricingSelectionForPos {
  slug: string;
  quantity: number;
  pricing_group_key?: string | null;
  pricingGroupKey?: string | null;
  print_fill_percent?: number | null;
  fill_percent?: number | null;
  coverage_percent?: number | null;
}

interface ReceiptItemForStock {
  product_id?: string | null;
  quantity?: number | string;
  [key: string]: unknown;
}

interface RefundItemForReceipt {
  total: number | string;
  subscription_credits_used?: number;
  [key: string]: unknown;
}

interface RefundPaymentForReceipt {
  amount: number | string;
  [key: string]: unknown;
}

interface DirectReceiptLoyaltyItem {
  productName: string;
  total: number;
  discountAmount: number;
  discountLabel: string | null;
  discountType: string | null;
}

interface UnknownObject {
  [key: string]: unknown;
}

function fiscalCorrectionDateFromReceipt(createdAt: string | Date): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(Number.isNaN(date.getTime()) ? new Date() : date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '01';
  return `${part('day')}.${part('month')}.${part('year')}`;
}

function fiscalCorrectionBaseNumber(receiptNumber: string | null): string {
  const normalized = receiptNumber?.trim();
  return normalized ? `ФД ${normalized}` : 'POS receipt';
}

function uuidOrNull(value: string): string | null {
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

const LOYALTY_MAX_DIRECT_RECEIPT_RATIO = 0.15;

/** Minimal interface for the socket server methods used in POS routes */
interface PosSocketServer {
  getIO(): IOServer;
}

function isUnknownObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null;
}

function toNumberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function queryStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function queryPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function queryNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function queryShiftStatus(value: unknown): PosShiftListFilters['status'] | undefined {
  return value === 'open' || value === 'closed' ? value : undefined;
}

function normalizeReceiptLoyaltyText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function isA3PhotoPrintReceiptText(value: string): boolean {
  const text = normalizeReceiptLoyaltyText(value);
  const isPhoto = text.includes('фото') || text.includes('photo');
  const hasA3 = /(^|[^a-zа-я0-9])(a3|а3)([^a-zа-я0-9]|$)/i.test(text)
    || /(^|[^0-9])(29[,.]?7|30)\s*[xх×]\s*(42|40)([^0-9]|$)/i.test(text);
  return isPhoto && hasA3;
}

function isAccountDiscountReceiptText(value: string | null | undefined): boolean {
  const text = normalizeReceiptLoyaltyText(value);
  return text.includes('личн')
    || text.includes('personal')
    || text.includes('образоват')
    || text.includes('education')
    || text.includes('бизнес')
    || text.includes('business');
}

function mapDirectReceiptLoyaltyItem(value: unknown): DirectReceiptLoyaltyItem {
  const record = isUnknownObject(value) ? value : {};
  return {
    productName: toStringValue(record['product_name']) ?? '',
    total: toNumberValue(record['total']),
    discountAmount: toNumberValue(record['discount_amount']),
    discountLabel: toStringValue(record['discount_label']),
    discountType: toStringValue(record['discount_type']),
  };
}

function directReceiptLoyaltyLimit(items: DirectReceiptLoyaltyItem[]): number {
  const accountDiscountApplied = items.some(item =>
    item.discountAmount > 0 && (
      isAccountDiscountReceiptText(item.discountLabel)
      || isAccountDiscountReceiptText(item.discountType)
    ),
  );
  if (accountDiscountApplied) return 0;

  const eligibleTotal = items.reduce((sum, item) => {
    if (isA3PhotoPrintReceiptText(item.productName)) return sum;
    return sum + Math.max(0, item.total);
  }, 0);

  return Math.floor(eligibleTotal * LOYALTY_MAX_DIRECT_RECEIPT_RATIO);
}

function isPosSocketServer(value: unknown): value is PosSocketServer {
  return typeof value === 'object' && value !== null && 'getIO' in value && typeof (value as PosSocketServer).getIO === 'function';
}

/** Safely retrieve socket server from Express app */
function getPosSocketServer(req: Request): PosSocketServer | undefined {
  if (!Object.hasOwn(req.app, 'socketServer')) return undefined;
  const candidate: unknown = Reflect.get(req.app, 'socketServer');
  return isPosSocketServer(candidate) ? candidate : undefined;
}

/** Auto mark-paid a linked photo_print_order when POS receipt is created */
async function autoMarkPrintOrderPaid(
  printOrderId: string, markedBy: string, receiptId: string,
  amount: number, ss: PosSocketServer | undefined,
): Promise<void> {
  const updated = await db.queryOne<Pick<PhotoPrintOrders, 'order_id'>>(
    `UPDATE photo_print_orders
     SET payment_status = 'paid', paid_at = NOW(), payment_method = 'pos_terminal', updated_at = NOW()
     WHERE id = $1 AND payment_status != 'paid'
     RETURNING order_id`,
    [printOrderId],
  );
  if (!updated) return;

  db.query(
    `INSERT INTO payment_events (id, order_id, event_type, amount, metadata)
     VALUES (gen_random_uuid(), $1, 'pos_auto_mark_paid', $2, $3)`,
    [updated.order_id, amount, JSON.stringify({ receipt_id: receiptId, marked_by: markedBy })],
  ).catch((err: unknown) => logger.warn('[pos] payment_event insert failed', { detail: err instanceof Error ? err.message : String(err) }));

  if (ss) {
    ss.getIO().to(`order:${updated.order_id}`).emit('order:payment-updated', {
      orderId: updated.order_id, payment_status: 'paid', payment_method: 'pos_terminal', updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Проверяет подтверждённую ФР-смену на устройстве.
 * Если shift_id null или АТОЛ не подтвердил открытую смену —
 * ставит fiscal_status = 'skipped' и возвращает false.
 */
async function shouldFiscalize(receiptId: string, shiftId: string | null | undefined): Promise<boolean> {
  if (!shiftId) {
    await db.query(`UPDATE pos_receipts SET fiscal_status = 'skipped' WHERE id = $1`, [receiptId]);
    return false;
  }
  if (!(await isFiscalShiftOpenForShift(shiftId))) {
    await db.query(`UPDATE pos_receipts SET fiscal_status = 'skipped' WHERE id = $1`, [receiptId]);
    return false;
  }
  return true;
}

interface ReceiptPaymentMethodLike {
  readonly payment_type?: unknown;
  readonly method?: unknown;
  readonly amount?: unknown;
}

function receiptPaymentMethod(payment: unknown): string | null {
  if (typeof payment !== 'object' || payment === null) return null;
  const candidate = payment as ReceiptPaymentMethodLike;
  const method = candidate.payment_type ?? candidate.method;
  return typeof method === 'string' ? method : null;
}

function receiptPaymentAmount(payment: unknown): number {
  if (typeof payment !== 'object' || payment === null) return 0;
  const candidate = payment as ReceiptPaymentMethodLike;
  return toNumberValue(candidate.amount);
}

function hasOnlyTransferNonSubscriptionPayments(payments: unknown): boolean {
  if (!Array.isArray(payments)) return false;

  const fiscalRelevantMethods = payments
    .filter(payment => receiptPaymentAmount(payment) > 0)
    .map(payment => receiptPaymentMethod(payment))
    .filter((method): method is string => method !== null && method !== 'subscription');

  return fiscalRelevantMethods.length > 0
    && fiscalRelevantMethods.every(method => method === 'transfer');
}

async function shouldFiscalizeReceipt(
  receiptId: string,
  shiftId: string | null | undefined,
  payments: unknown,
): Promise<boolean> {
  if (hasOnlyTransferNonSubscriptionPayments(payments)) {
    await db.query(`UPDATE pos_receipts SET fiscal_status = 'skipped' WHERE id = $1`, [receiptId]);
    return false;
  }

  return shouldFiscalize(receiptId, shiftId);
}

function hasPaymentRequiringFiscalShift(payments: unknown, fiscalRequired: boolean): boolean {
  if (fiscalRequired) return true;
  if (!Array.isArray(payments)) return false;
  return payments.some(payment => {
    const method = receiptPaymentMethod(payment);
    return method === 'card' || method === 'sbp';
  });
}

function fiscalShiftRequiredMessage(fiscalRequired: boolean): string {
  return fiscalRequired
    ? 'Для фискализации нужна открытая смена ФР'
    : 'Карта и СБП требуют открытой смены ФР';
}

async function assertFiscalShiftForRequiredPayments(
  payments: unknown,
  shiftId: string | null | undefined,
  fiscalRequired = false,
): Promise<void> {
  if (!hasPaymentRequiringFiscalShift(payments, fiscalRequired)) return;

  const message = fiscalShiftRequiredMessage(fiscalRequired);

  if (!shiftId) {
    throw new AppError(400, message);
  }

  if (!(await isFiscalShiftOpenForShift(shiftId))) {
    throw new AppError(400, message);
  }
}

interface BuildPricingReceiptItemsInput {
  category_slug: string;
  selected_options: unknown;
  promo_code?: string | null;
  customer_phone?: string | null;
  client_user_id?: string | null;
  client_contact_id?: string | null;
  loyalty_profile_id?: string | null;
  loyalty_points_to_use?: number | null;
  apply_volume_discount?: boolean;
  manual_amount?: number | null;
  manual_description?: string | null;
  print_order_id?: string | null;
  payments?: { payment_type?: string }[];
}

interface PricingWaterfallItem {
  serviceOptionId: string;
  quantity: number;
  slug: string;
  pricingGroupKey?: string | null;
  printFillPercent: number | null;
}

interface BuildPricingReceiptItemsResult {
  priceResult: Awaited<ReturnType<typeof calculatePriceWaterfall>>;
  receiptItems: PosReceiptItem[];
  calculatedTotal: number;
  optionMap: Map<string, { id: string; product_id: string | null }>;
  idToSlug: Map<string, string>;
  isSubscriptionPayment: boolean;
  categoryName: string | null;
}

/**
 * Единый серверный расчёт позиций POS-чека из pricing-выбора (waterfall v2):
 * резолв slug→serviceOptionId, calculatePriceWaterfall, построение receiptItems
 * (включая manual-позицию и минимальный чек). Источник правды состава для двух
 * путей: happy-path материализации (/receipts/from-pricing) и order-first
 * персистенции snapshot (/bridge/pay, pricing-ветка) — чтобы состав НЕ расходился
 * между предложением об оплате и итоговым чеком. НЕ делает сверку суммы (она
 * остаётся у вызывающего, где есть payments) и НЕ создаёт чек/побочки.
 */
async function buildPricingReceiptItems(
  input: BuildPricingReceiptItemsInput,
): Promise<BuildPricingReceiptItemsResult> {
  const {
    category_slug,
    selected_options,
    promo_code,
    customer_phone,
    client_user_id,
    client_contact_id,
    loyalty_profile_id,
    loyalty_points_to_use,
    apply_volume_discount,
    manual_amount,
    manual_description,
    print_order_id,
    payments,
  } = input;

  // Строим lookup option_slug → { id, product_id } (нужно ДО waterfall для slug→id резолва)
  const categories = await getCategories();
  const category = categories.find(c => c.slug === category_slug);
  const optionMap = new Map<string, { id: string; product_id: string | null }>();
  if (category) {
    for (const group of category.optionGroups) {
      for (const opt of group.options) {
        optionMap.set(opt.slug, { id: opt.id, product_id: opt.product_id });
      }
    }
  }

  // Резолвим slug → serviceOptionId для waterfall input
  const pricingSelections = selected_options as PricingSelectionForPos[];
  const fillPercentBySlug = new Map<string, number | null>();
  const waterfallItems: PricingWaterfallItem[] = [];
  for (const sel of pricingSelections) {
    const optInfo = optionMap.get(sel.slug);
    if (!optInfo) {
      throw new AppError(400, `Опция "${sel.slug}" не найдена в категории "${category_slug}"`);
    }
    const printFillPercent = sel.print_fill_percent ?? sel.fill_percent ?? sel.coverage_percent ?? null;
    fillPercentBySlug.set(sel.slug, printFillPercent);
    waterfallItems.push({
      serviceOptionId: optInfo.id,
      quantity: sel.quantity,
      slug: sel.slug,
      pricingGroupKey: sel.pricing_group_key ?? sel.pricingGroupKey ?? null,
      printFillPercent,
    });
  }

  // Серверный расчёт цены через v2 waterfall (volume modifiers, category degressive, subscription per-item)
  const pricingPhone = await resolveCustomerPricingPhone({
    phone: customer_phone,
    clientUserId: client_user_id,
    clientContactId: client_contact_id,
  });
  const priceResult = await calculatePriceWaterfall({
    items: waterfallItems.map(i => ({
      serviceOptionId: i.serviceOptionId,
      quantity: i.quantity,
      pricingGroupKey: i.pricingGroupKey,
      printFillPercent: i.printFillPercent,
    })),
    channel: 'pos',
    customerPhone: pricingPhone ?? undefined,
    promoCode: promo_code ?? undefined,
    loyaltyPointsToUse: loyalty_points_to_use ?? 0,
    loyaltyProfileId: loyalty_profile_id ?? undefined,
    applyVolumeDiscount: apply_volume_discount,
  });

  const manualAmt = Number(manual_amount) || 0;
  const engineMinimumSurcharge = minimumCheckSurchargeFromWaterfall(priceResult.waterfall);
  const priceTotalBeforeMinimum = Math.max(0, Math.round((priceResult.total - engineMinimumSurcharge) * 100) / 100);
  const totalBeforeMinimum = priceTotalBeforeMinimum + manualAmt;
  const minimumCheckSurcharge = minimumCheckSurchargeForTotal(totalBeforeMinimum);
  const calculatedTotal = Math.round((totalBeforeMinimum + minimumCheckSurcharge) * 100) / 100;

  // Обратный маппинг serviceOptionId → slug для product_id lookup
  const idToSlug = new Map(waterfallItems.map(i => [i.serviceOptionId, i.slug]));

  // Determine if this is a subscription payment
  const isSubscriptionPayment = Array.isArray(payments)
    && payments.some(p => p.payment_type === 'subscription');
  const receiptDiscounts = allocateReceiptDiscounts(priceResult, minimumCheckSurcharge);

  // Формируем позиции чека из waterfall items
  const receiptItems: PosReceiptItem[] = priceResult.items.map((item): PosReceiptItem => {
    const slug = idToSlug.get(item.serviceOptionId) ?? item.slug;
    const optInfo = optionMap.get(slug);
    const receiptDiscount = receiptDiscounts.get(item.serviceOptionId) ?? null;
    // Mark subscription_credits_used when paying by subscription
    const creditsUsed = isSubscriptionPayment && optInfo?.product_id
      ? item.finalPrice
      : 0;
    return {
      product_id: optInfo?.product_id ?? null,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.discountApplied === 'student' ? item.basePrice : item.unitPrice,
      discount_amount: roundMoney(item.discountAmount + (receiptDiscount?.amount ?? 0)),
      discount_percent: 0,
      discount_type: receiptDiscount ? receiptDiscount.type : item.discountApplied !== 'none' ? item.discountApplied : null,
      discount_label: joinReceiptLabels(item.discountLabel, receiptDiscount?.label),
      student_discount_benefit: item.studentDiscountBenefit,
      student_discount_units: item.studentDiscountUnits,
      print_fill_percent: fillPercentBySlug.get(slug) ?? null,
      print_order_id: print_order_id ?? null,
      points_used: 0,
      subscription_credits_used: creditsUsed,
      total: roundMoney(Math.max(0, item.finalPrice - (receiptDiscount?.amount ?? 0))),
      vat_rate: 'NoVat',
    };
  });

  // Добавить ручную позицию, если есть
  if (manualAmt > 0) {
    receiptItems.push({
      product_id: null,
      product_name: manual_description || `Доп. оплата ${manualAmt}₽`,
      quantity: 1,
      unit_price: manualAmt,
      discount_amount: 0,
      discount_percent: 0,
      discount_type: null,
      discount_label: null,
      student_discount_benefit: null,
      student_discount_units: 0,
      print_fill_percent: null,
      print_order_id: null,
      points_used: 0,
      subscription_credits_used: 0,
      total: manualAmt,
      vat_rate: 'NoVat',
    });
  }

  if (minimumCheckSurcharge > 0) {
    receiptItems.push({
      product_id: null,
      product_name: 'Минимальный чек',
      quantity: 1,
      unit_price: minimumCheckSurcharge,
      discount_amount: 0,
      discount_percent: 0,
      discount_type: MINIMUM_CHECK_WATERFALL_STEP,
      discount_label: `Минимальный чек ${MINIMUM_CHECK_TOTAL}₽`,
      student_discount_benefit: null,
      student_discount_units: 0,
      print_fill_percent: null,
      print_order_id: null,
      points_used: 0,
      subscription_credits_used: 0,
      total: minimumCheckSurcharge,
      vat_rate: 'NoVat',
    });
  }

  return {
    priceResult,
    receiptItems,
    calculatedTotal,
    optionMap,
    idToSlug,
    isSubscriptionPayment,
    categoryName: category?.name ?? null,
  };
}

/** Округление денег до копеек (банковское не нужно — суммы уже округлены движком). */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

interface ReceiptDiscountAllocation {
  amount: number;
  label: string | null;
  type: 'account' | 'global';
}

function joinReceiptLabels(...labels: Array<string | null | undefined>): string | null {
  const parts = labels.filter((label): label is string => !!label?.trim());
  return parts.length > 0 ? parts.join(' | ') : null;
}

function waterfallGlobalDiscountLabel(
  priceResult: Awaited<ReturnType<typeof calculatePriceWaterfall>>,
): string {
  if (priceResult.promoDiscount) return `Промокод ${priceResult.promoDiscount.code}`;
  if (priceResult.partnerDiscount) return 'Партнёрская скидка';
  if (priceResult.loyaltyDiscount) return 'Бонусы лояльности';
  return priceResult.accountDiscount?.label ?? 'Скидка';
}

function allocateReceiptDiscounts(
  priceResult: Awaited<ReturnType<typeof calculatePriceWaterfall>>,
  minimumCheckSurcharge: number,
): Map<string, ReceiptDiscountAllocation> {
  const buckets = priceResult.items.map(item => ({
    serviceOptionId: item.serviceOptionId,
    remaining: Math.max(0, roundMoney(item.finalPrice)),
    amount: 0,
    labels: new Set<string>(),
    type: 'global' as ReceiptDiscountAllocation['type'],
  }));
  const totalBeforeGlobalDiscounts = roundMoney(buckets.reduce((sum, bucket) => sum + bucket.remaining, 0));
  const targetWithoutMinimum = roundMoney(Math.max(0, priceResult.total - minimumCheckSurcharge));
  let discountLeft = Math.min(
    totalBeforeGlobalDiscounts,
    Math.max(0, roundMoney(totalBeforeGlobalDiscounts - targetWithoutMinimum)),
  );

  if (discountLeft <= 0.004) return new Map();

  for (const line of priceResult.accountDiscount?.lines ?? []) {
    if (discountLeft <= 0.004) break;
    const bucket = buckets.find(candidate => candidate.serviceOptionId === line.serviceOptionId);
    if (!bucket || bucket.remaining <= 0) continue;

    const amount = Math.min(roundMoney(Number(line.amount) || 0), bucket.remaining, discountLeft);
    if (amount <= 0.004) continue;

    bucket.amount = roundMoney(bucket.amount + amount);
    bucket.remaining = roundMoney(bucket.remaining - amount);
    bucket.type = 'account';
    if (line.label) bucket.labels.add(line.label);
    discountLeft = roundMoney(discountLeft - amount);
  }

  if (discountLeft > 0.004) {
    const globalLabel = waterfallGlobalDiscountLabel(priceResult);
    let remainingBase = roundMoney(buckets.reduce((sum, bucket) => sum + bucket.remaining, 0));
    for (const bucket of buckets) {
      if (discountLeft <= 0.004 || bucket.remaining <= 0 || remainingBase <= 0) break;

      const amount = Math.min(
        roundMoney(discountLeft * (bucket.remaining / remainingBase)),
        bucket.remaining,
        discountLeft,
      );
      if (amount <= 0.004) {
        remainingBase = roundMoney(remainingBase - bucket.remaining);
        continue;
      }

      bucket.amount = roundMoney(bucket.amount + amount);
      bucket.remaining = roundMoney(bucket.remaining - amount);
      bucket.labels.add(globalLabel);
      discountLeft = roundMoney(discountLeft - amount);
      remainingBase = roundMoney(remainingBase - bucket.remaining - amount);
    }
  }

  const result = new Map<string, ReceiptDiscountAllocation>();
  for (const bucket of buckets) {
    if (bucket.amount <= 0.004) continue;
    result.set(bucket.serviceOptionId, {
      amount: roundMoney(bucket.amount),
      label: [...bucket.labels][0] ?? null,
      type: bucket.type,
    });
  }
  return result;
}

/**
 * Канонизирует snapshot прямой корзины для order-first: НЕ доверяет фронту по
 * суммам — пересчитывает per-item total = unit_price*quantity и subtotal = Σ,
 * проставляет studioId из тела запроса и source='cart'. total чека выводит из
 * subtotal − discount_total (если фронт прислал свой total — игнорируем). Прочие
 * поля snapshot (shiftId, контакт, промокод) сохраняем. Денежная 54-ФЗ-сверка
 * остаётся на материализации чека — здесь только сохранение состава.
 */
function canonicalizeCartSnapshot(
  snapshot: CartSnapshotInput,
  studioId: string,
): CartSnapshotInput {
  const items = snapshot.items.map(item => ({
    ...item,
    total: roundMoney(item.unit_price * item.quantity),
  }));
  const subtotal = roundMoney(items.reduce((sum, i) => sum + i.total, 0));
  const discountTotal = snapshot.discount_total ?? 0;
  const total = roundMoney(subtotal - discountTotal);
  return {
    ...snapshot,
    items,
    subtotal,
    total,
    studioId,
    source: 'cart',
  };
}

/**
 * Строит канонический snapshot из pricing-выбора (услуги, order-first) серверным
 * расчётом waterfall — тот же состав, что уйдёт в createFromPricing на
 * материализации. subtotal/total берём из движка (calculatedTotal), discount_total
 * — промо-скидка. Источник правды состава — buildPricingReceiptItems.
 */
async function buildPricingSnapshot(
  pricing: BridgePricingInput,
  studioId: string,
): Promise<CartSnapshotInput> {
  const { priceResult, receiptItems, calculatedTotal } = await buildPricingReceiptItems({
    category_slug: pricing.category_slug,
    selected_options: pricing.selected_options,
    promo_code: pricing.promo_code ?? null,
    customer_phone: pricing.customer_phone ?? null,
    client_user_id: pricing.client_user_id ?? null,
    client_contact_id: pricing.client_contact_id ?? null,
    loyalty_profile_id: pricing.loyalty_profile_id ?? null,
    apply_volume_discount: pricing.apply_volume_discount,
  });
  // unit_price = ЭФФЕКТИВНАЯ per-unit цена (total/quantity), а НЕ базовая: волюм/
  // студенческая/абонементная скидка уже встроена в item.total (finalPrice). При
  // допробитии buildResolveReceiptItems пересчитывает total=unit_price*qty — с
  // базовой ценой Σ завысился бы (fail-safe 400 на скидочных позициях). С
  // эффективной ценой Σ(unit_price*qty)=total → раскладка сходится с amount, цена
  // позиции = реально списанная (фискально верно). discount_amount=0 — скидку НЕ
  // дублируем (она уже в цене). quantity 0 (теоретически) — цену не трогаем.
  const items = receiptItems.map(item => {
    const qty = Number(item.quantity) || 0;
    const total = roundMoney(item.total);
    const effectiveUnitPrice = qty > 0 ? roundMoney(total / qty) : roundMoney(item.unit_price);
    const snapItem: CartSnapshotInput['items'][number] = {
      product_id: item.product_id ?? null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: effectiveUnitPrice,
      discount_amount: 0,
      discount_percent: 0,
      points_used: item.points_used ?? 0,
      subscription_credits_used: item.subscription_credits_used ?? 0,
      total,
      vat_rate: item.vat_rate ?? 'NoVat',
    };
    if (item.print_fill_percent !== undefined && item.print_fill_percent !== null) {
      const fill = Number(item.print_fill_percent);
      if (Number.isFinite(fill)) snapItem.print_fill_percent = fill;
    }
    return snapItem;
  });
  const snapshot: CartSnapshotInput = {
    items,
    subtotal: roundMoney(priceResult.subtotal),
    total: roundMoney(calculatedTotal),
    studioId,
    source: 'from_pricing',
  };
  const discountTotal = priceResult.promoDiscount?.amount ?? 0;
  if (discountTotal > 0) snapshot.discount_total = roundMoney(discountTotal);
  if (pricing.shift_id) snapshot.shiftId = pricing.shift_id;
  if (pricing.customer_phone) snapshot.customerPhone = pricing.customer_phone;
  if (pricing.loyalty_profile_id) snapshot.loyaltyProfileId = pricing.loyalty_profile_id;
  if (pricing.promo_code) snapshot.promoCode = pricing.promo_code;
  return snapshot;
}

// All POS routes require authentication + pos:use permission (blocks client role)
router.use(authenticateToken, requirePermission('pos:use'));

// ─── SHIFTS ───────────────────────────────────────────

router.get('/shifts', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const canViewAll = req.user.role === 'admin' || req.user.role === 'manager' || req.user.permissions?.includes('reports:view');
  const requestedEmployeeId = queryStringValue(req.query['employee_id']);
  const filters: PosShiftListFilters = {
    limit: queryPositiveInt(req.query['limit'], 30, 100),
  };
  const studioId = queryStringValue(req.query['studio_id']);
  const dateFrom = queryStringValue(req.query['date_from']);
  const dateTo = queryStringValue(req.query['date_to']);
  const status = queryShiftStatus(req.query['status']);
  const offset = queryNonNegativeInt(req.query['offset']);

  if (studioId) filters.studio_id = studioId;
  if (dateFrom) filters.date_from = dateFrom;
  if (dateTo) filters.date_to = dateTo;
  if (status) filters.status = status;
  if (offset !== undefined) filters.offset = offset;
  filters.employee_id = canViewAll ? requestedEmployeeId : req.user.id;

  const result = await getShifts(filters);
  res.json({ success: true, items: result.items, total: result.total });
});

// Контроль кассы: недостачи по сменам + непривязанная наличка (только reports:view)
router.get('/cash-control', requirePermission('reports:view'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const filters: CashControlFilters = {};
  const studioId = queryStringValue(req.query['studio_id']);
  const dateFrom = queryStringValue(req.query['date_from']);
  const dateTo = queryStringValue(req.query['date_to']);
  if (studioId) filters.studio_id = studioId;
  if (dateFrom) filters.date_from = dateFrom;
  if (dateTo) filters.date_to = dateTo;
  const result = await getCashControl(filters);
  res.json({ success: true, ...result });
});

router.post('/shifts/open', validate(openShiftSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { studio_id, cash_at_open, fiscal_enabled } = req.body;
  const requestedFiscalEnabled = fiscal_enabled ?? true;
  const { posShift: shift, employeeShiftId } = await openShift({
    employee_id: req.user.id,
    studio_id,
    cash_at_open,
    fiscal_enabled: false,
  });
  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:shift_opened',
    entityType: 'pos_shift',
    entityId: shift.id,
    details: {
      shift_number: shift.shift_number,
      studio_id,
      cash_at_open,
      fiscal_enabled: shift.fiscal_enabled,
      requested_fiscal_enabled: requestedFiscalEnabled,
      employeeShiftId,
    },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });
  const fiscalTransactionId = requestedFiscalEnabled
    ? await enqueueShiftFiscalCommand(shift.studio_id, 'shift_open', req.user.id)
    : null;
  res.status(201).json({ success: true, shift, employeeShiftId, fiscalTransactionId });
});

router.post('/shifts/:id/fiscal/open', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { shift, fiscalEnabledChanged } = await enableShiftFiscal({
    shift_id: req.params['id'],
    employee_id: req.user.id,
  });

  const fiscalTransactionId = fiscalEnabledChanged
    ? await enqueueShiftFiscalCommand(shift.studio_id, 'shift_open', req.user.id)
    : null;

  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:shift_fiscal_opened',
    entityType: 'pos_shift',
    entityId: shift.id,
    details: {
      shift_number: shift.shift_number,
      studio_id: shift.studio_id,
      fiscalEnabledChanged,
    },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  res.json({ success: true, shift, fiscalCommandEnqueued: fiscalEnabledChanged, fiscalTransactionId });
});

router.post('/shifts/:id/fiscal/close', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { shift, fiscalShiftOpen } = await getOpenShiftFiscalState({
    shift_id: req.params['id'],
    employee_id: req.user.id,
  });

  const fiscalTransactionId = fiscalShiftOpen
    ? await enqueueShiftFiscalCommand(shift.studio_id, 'shift_close', req.user.id)
    : null;

  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:shift_fiscal_closed',
    entityType: 'pos_shift',
    entityId: shift.id,
    details: {
      shift_number: shift.shift_number,
      studio_id: shift.studio_id,
      fiscalShiftOpen,
    },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  res.json({ success: true, shift, fiscalCommandEnqueued: fiscalShiftOpen, fiscalTransactionId });
});

router.post('/shifts/close', validate(closeShiftSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { shift_id, cash_at_close, notes, denominations } = req.body;
  const fiscalShiftWasOpen = await isFiscalShiftOpenForShift(shift_id);
  const { shift, commissionSummary } = await closeShift({ shift_id, employee_id: req.user.id, cash_at_close, notes, denominations });
  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:shift_closed', entityType: 'pos_shift', entityId: shift_id, details: { cash_at_close, notes, commissionSummary }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });

  // F54: Auto Z-report when last shift for studio is closed
  let zReportSent = false;
  const openShiftsResult = await db.queryOne<CountRow>(
    `SELECT COUNT(*)::text as count FROM pos_shifts WHERE status = 'open' AND studio_id = $1`,
    [shift.studio_id],
  );
  let fiscalTransactionId: string | null = null;
  const isLastShiftOfStudio = parseInt(openShiftsResult?.count || '0', 10) === 0;
  if (isLastShiftOfStudio && fiscalShiftWasOpen) {
    zReportSent = true;
    fiscalTransactionId = await enqueueShiftFiscalCommand(shift.studio_id, 'shift_close', req.user.id);
  }

  // Контур #2: сверка эквайринга (op59) при закрытии последней смены студии.
  // Fire-and-forget — закрытие смены НЕ ждёт op59 (таймаут до 600с) и не падает
  // при ошибке сверки. enqueueShiftReconciliation внутри дедуплицирует op59.
  if (isLastShiftOfStudio) {
    enqueueShiftReconciliation(shift_id, shift.studio_id).catch((err: unknown) => {
      logger.error('shift reconciliation enqueue failed', {
        shiftId: shift_id,
        studioId: shift.studio_id,
        error: toErrorMessage(err),
      });
    });
  }

  res.json({ success: true, shift, zReportSent, fiscalTransactionId, commissionSummary });
});

router.get('/shifts/current', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  // admin/manager могут проверять смену любого сотрудника, остальные — только свою
  const queryEmployeeId = req.query['employee_id'] as string | undefined;
  let employeeId: string;
  if (queryEmployeeId && queryEmployeeId !== req.user.id) {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      throw new AppError(403, 'Можно просматривать только свою текущую смену');
    }
    employeeId = queryEmployeeId;
  } else {
    employeeId = req.user.id;
  }
  const shift = await getCurrentShift(employeeId);
  res.json({ success: true, shift });
});

router.post('/shifts/:id/cash-withdrawals', validate(cashWithdrawalSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const movement = await createCashWithdrawal({
    shift_id: req.params['id'],
    employee_id: req.user.id,
    amount: req.body.amount,
    reason: req.body.reason,
  });
  enqueueCashDrawerCommandSafe({
    studioId: movement.studio_id,
    initiatedBy: req.user.id,
    source: 'pos.cash-withdrawal',
  });
  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:cash_withdrawal',
    entityType: 'pos_shift',
    entityId: req.params['id'],
    details: { amount: movement.amount, reason: movement.reason },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });
  res.status(201).json({ success: true, movement });
});

router.get('/shifts/:id/report', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const report = await getShiftReport(req.params['id']);
  const canViewOtherEmployee = req.user.role === 'admin' || req.user.role === 'manager';
  if (report.shift.employee_id !== req.user.id && !canViewOtherEmployee) {
    throw new AppError(403, 'Можно просматривать только свою кассовую смену');
  }
  res.json({ success: true, report });
});

// ─── RECEIPTS ─────────────────────────────────────────

router.post('/receipts', idempotent(60), validate(createReceiptSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { items, payments, total, promo_code, loyalty_profile_id, loyalty_points_to_use, fiscal_required } = req.body;
  const receiptTotal = Number(total) || 0;
  if (receiptTotal > 0 && receiptTotal < MINIMUM_CHECK_TOTAL) {
    throw new AppError(400, `Минимальный чек — ${MINIMUM_CHECK_TOTAL}₽`);
  }
  await assertFiscalShiftForRequiredPayments(payments, req.body.shift_id, fiscal_required === true);
  const rawLoyaltyPointsToUse = Math.max(0, Math.floor(Number(loyalty_points_to_use) || 0));
  const pointsDiscount = Math.max(0, Math.floor(Number(req.body.points_discount) || 0));
  let loyaltyPointsToUse = 0;

  if (rawLoyaltyPointsToUse > 0 && !loyalty_profile_id) {
    throw new AppError(400, 'Для списания бонусов нужен профиль лояльности');
  }

  if (rawLoyaltyPointsToUse > 0 && loyalty_profile_id) {
    const loyaltyItems = Array.isArray(items)
      ? (items as unknown[]).map(mapDirectReceiptLoyaltyItem)
      : [];
    const maxLoyaltyDiscount = directReceiptLoyaltyLimit(loyaltyItems);

    const loyaltyDiscountAmount = rawLoyaltyPointsToUse;
    if (pointsDiscount < loyaltyDiscountAmount) {
      throw new AppError(400, 'Сумма списания бонусов не соответствует скидке чека');
    }
    if (loyaltyDiscountAmount > maxLoyaltyDiscount) {
      throw new AppError(400, `Бонусами можно оплатить не более 15% разрешённых позиций: ${maxLoyaltyDiscount}₽`);
    }

    const profile = await findProfile({ profileId: loyalty_profile_id });
    if (!profile) {
      throw new AppError(404, 'Профиль лояльности не найден');
    }
    if (profile.points < rawLoyaltyPointsToUse) {
      throw new AppError(400, 'Недостаточно бонусов');
    }

    loyaltyPointsToUse = rawLoyaltyPointsToUse;
  }

  // Lookup партнёра по промокоду
  let partnerId: number | null = null;
  if (promo_code) {
    const partnerRows = await db.query<Pick<Partners, 'id'>>(
      `SELECT id FROM partners WHERE UPPER(promo_code) = UPPER($1) AND status = 'approved'`,
      [promo_code],
    );
    partnerId = partnerRows[0]?.id ?? null;
  }

  // Акция «Фото на студенческий»: списание приходит ТОЛЬКО из серверного расчёта (/from-pricing),
  // принимать его из тела прямого /receipts нельзя (подделка через passthrough-схему).
  const { student_id_photo_promo_consumed: _ignoredPromo, ...safeReceiptBody } = req.body;
  const receipt = await createReceipt({ ...safeReceiptBody, employee_id: req.user.id, promo_code: promo_code || null, partner_id: partnerId });

  // F10: Loyalty spend — atomic deduction with SELECT FOR UPDATE
  if (loyaltyPointsToUse > 0 && loyalty_profile_id) {
    await spendPoints(loyalty_profile_id as LoyaltyProfilesId, loyaltyPointsToUse, receipt.receipt_number);
  }

  // Промоутерская комиссия: записать реферал и сразу подтвердить (POS-оплата мгновенная)
  if (partnerId && receipt.total > 0) {
    await recordReferral({
      partner_id: partnerId,
      order_id: receipt.id,
      order_type: 'pos',
      order_amount: receipt.total,
      promo_code: promo_code || undefined,
      client_phone: req.body.customer_phone || undefined,
      service_category_slug: req.body.category_slug || undefined,
      status: 'confirmed',
    });
  }

  if (loyalty_profile_id && receipt.total > 0) {
    await enqueueLoyaltyEarn({
      profileId: loyalty_profile_id,
      orderAmount: receipt.total,
      source: 'pos_order',
      referenceId: receipt.receipt_number,
      occurredAt: receipt.created_at,
      cashbackCategoryKey: detectCashbackCategoryKey({
        categorySlug: req.body.category_slug || null,
        items: receipt.items || items,
      }),
    });
  }

  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:receipt_created', entityType: 'pos_receipt', entityId: receipt.id, details: { receipt_number: receipt.receipt_number, total: receipt.total, items_count: items.length }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  // F41: Socket.IO inventory sync
  const ss = getPosSocketServer(req);
  if (ss && items?.length) {
    const receiptItemsForStock: ReceiptItemForStock[] = Array.isArray(items) ? items : [];
    const stockChanges = receiptItemsForStock
      .flatMap(item => typeof item.product_id === 'string' && item.product_id.length > 0
        ? [{ product_id: item.product_id, quantity_delta: -Number(item.quantity ?? 0) }]
        : []);
    if (stockChanges.length) {
      ss.getIO().to(`studio:${req.body.studio_id}`).emit('pos:stock_updated', { studio_id: req.body.studio_id, changes: stockChanges });
    }
  }
  // F38: Fiscal enqueue (skip if АТОЛ/POS-agent has no confirmed fiscal shift)
  const fiscalPayments = receipt.payments || payments;
  const fiscalShiftId = receipt.shift_id ?? req.body.shift_id ?? null;
  if (await shouldFiscalizeReceipt(receipt.id, fiscalShiftId, fiscalPayments)) {
    enqueueFiscal({
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      items: receipt.items || items,
      total: receipt.total,
      payments: fiscalPayments,
      operation: 'sale',
    }).catch((err: unknown) => logger.error('[pos] fiscal enqueue:', { detail: err instanceof Error ? err.message : String(err) }));
  }
  if (hasPositiveCashPayment(receipt.payments || payments)) {
    enqueueCashDrawerCommandSafe({
      studioId: req.body.studio_id,
      initiatedBy: req.user.id,
      receiptId: receipt.id,
      source: 'pos.receipts',
    });
  }
  // Auto mark-paid linked print order
  if (req.body.print_order_id) {
    autoMarkPrintOrderPaid(req.body.print_order_id as string, req.user.id, receipt.id, receipt.total, ss).catch(
      (err: unknown) => logger.error('[pos] auto mark-paid failed:', { detail: err instanceof Error ? err.message : String(err) }),
    );
  }
  res.status(201).json({ success: true, receipt });
});

router.post('/receipts/:id/refund', idempotent(60), validate(fullRefundSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const originalReceipt = await getReceiptById(req.params['id']);
  if (!originalReceipt) throw new AppError(404, 'Receipt not found', ErrorCode.POS_RECEIPT_NOT_FOUND);
  if (originalReceipt.is_refund) throw new AppError(400, 'Cannot refund a refund receipt', ErrorCode.POS_CANNOT_REFUND_REFUND);
  const hasSubscriptionCreditUsage = Number(originalReceipt.subscription_credit_used || 0) > 0
    || originalReceipt.payments?.some(payment => payment.payment_type === 'subscription');
  const refundSourceItems = hasSubscriptionCreditUsage ? originalReceipt.items : req.body.items || originalReceipt.items;
  const refundSourcePayments = hasSubscriptionCreditUsage ? originalReceipt.payments : req.body.payments || originalReceipt.payments;

  // Create refund receipt with same items/payments but negated
  const refundItems = (refundSourceItems || []).map(
    (item: RefundItemForReceipt) => ({
      ...item,
      total: -Number(item.total),
      subscription_credits_used: 0,
    })
  );

  const refundPayments = (refundSourcePayments || []).map(
    (p: RefundPaymentForReceipt) => ({
      ...p,
      amount: -Number(p.amount),
    })
  );

  const refundReceipt = await createReceipt({
    shift_id: req.body.shift_id || originalReceipt.shift_id,
    employee_id: req.user.id,
    studio_id: originalReceipt.studio_id,
    customer_phone: originalReceipt.customer_phone || undefined,
    customer_name: originalReceipt.customer_name || undefined,
    subscription_id: originalReceipt.subscription_id || undefined,
    is_refund: true,
    refund_receipt_id: originalReceipt.id,
    items: refundItems,
    payments: refundPayments,
    subtotal: -originalReceipt.subtotal,
    discount_total: -originalReceipt.discount_total,
    total: -originalReceipt.total,
  });
  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:receipt_refunded', entityType: 'pos_receipt', entityId: req.params['id'], details: { refund_receipt_id: refundReceipt.id, total: originalReceipt.total }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  if (await shouldFiscalize(refundReceipt.id, refundReceipt.shift_id)) {
    enqueueFiscal({
      receiptId: refundReceipt.id,
      receiptNumber: refundReceipt.receipt_number,
      items: refundReceipt.items || refundItems,
      total: refundReceipt.total,
      payments: refundReceipt.payments || refundPayments,
      operation: 'refund',
    }).catch((err: unknown) => logger.error('[pos] fiscal enqueue full refund:', { detail: err instanceof Error ? err.message : String(err) }));
  }

  res.status(201).json({ success: true, receipt: refundReceipt });
});

router.post('/receipts/:id/void', idempotent(60), validate(voidReceiptSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { shift_id, reason } = req.body;
  const receipt = await voidReceipt(req.params['id'], reason, req.user.id, shift_id);
  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:receipt_voided', entityType: 'pos_receipt', entityId: req.params['id'], details: { reason, total: receipt.total }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  // F41: Socket.IO inventory sync — stock restored on void
  const voidSs = getPosSocketServer(req);
  if (voidSs && receipt.items?.length) {
    const voidStockChanges = receipt.items.filter(i => i.product_id).map(i => ({ product_id: i.product_id!, quantity_delta: i.quantity }));
    if (voidStockChanges.length) {
      voidSs.getIO().to(`studio:${receipt.studio_id}`).emit('pos:stock_updated', { studio_id: receipt.studio_id, changes: voidStockChanges });
    }
  }
  // F38: Fiscal enqueue for void (skip if АТОЛ/POS-agent has no confirmed fiscal shift)
  if (await shouldFiscalize(receipt.id, receipt.shift_id)) {
    enqueueFiscal({ receiptId: receipt.id, receiptNumber: receipt.receipt_number, items: receipt.items || [], total: receipt.total, payments: receipt.payments || [], operation: 'refund' }).catch((err: unknown) => logger.error('[pos] fiscal enqueue void return:', { detail: err instanceof Error ? err.message : String(err) }));
  }
  res.json({ success: true, data: { receipt } });
});

router.post('/receipts/:id/partial-refund', idempotent(60), validate(partialRefundSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { shift_id, items, studio_id } = req.body;
  const receipt = await partialRefund(req.params['id'], items, shift_id, req.user.id, studio_id);
  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:partial_refund', entityType: 'pos_receipt', entityId: req.params['id'], details: { refund_receipt_id: receipt.id, items_count: items.length, total: receipt.total }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  // F41: Socket.IO inventory sync — stock restored on partial refund
  const refundSs = getPosSocketServer(req);
  if (refundSs && items?.length) {
    const refundStockChanges = (items as Array<{ product_id: string; quantity: number }>).filter(i => i.product_id).map(i => ({ product_id: i.product_id, quantity_delta: i.quantity }));
    if (refundStockChanges.length) {
      refundSs.getIO().to(`studio:${studio_id}`).emit('pos:stock_updated', { studio_id, changes: refundStockChanges });
    }
  }
  // F38: Fiscal enqueue for partial refund (skip if АТОЛ/POS-agent has no confirmed fiscal shift)
  if (await shouldFiscalize(receipt.id, receipt.shift_id)) {
    enqueueFiscal({ receiptId: receipt.id, receiptNumber: receipt.receipt_number, items: receipt.items || [], total: receipt.total, payments: receipt.payments || [], operation: 'refund' }).catch((err: unknown) => logger.error('[pos] fiscal enqueue refund:', { detail: err instanceof Error ? err.message : String(err) }));
  }
  res.json({ success: true, data: { receipt } });
});

router.get('/receipts/:id', async (req: Request, res: Response) => {
  const receipt = await getReceiptById(req.params['id']);
  if (!receipt) throw new AppError(404, 'Receipt not found', ErrorCode.POS_RECEIPT_NOT_FOUND);
  res.json({ success: true, receipt });
});

router.get('/receipts', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const canViewGlobalSales = req.user.permissions?.includes('reports:view') ?? false;
  const filters = {
    shift_id: req.query['shift_id'] as string | undefined,
    studio_id: req.query['studio_id'] as string | undefined,
    employee_id: canViewGlobalSales
      ? (req.query['employee_id'] as string | undefined)
      : req.user.id,
    date_from: req.query['date_from'] as string | undefined,
    date_to: req.query['date_to'] as string | undefined,
    customer_phone: req.query['customer_phone'] as string | undefined,
    is_refund: req.query['is_refund'] !== undefined
      ? req.query['is_refund'] === 'true'
      : undefined,
    limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    offset: req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : undefined,
  };
  const result = await getReceipts(filters);
  res.json({ success: true, ...result });
});

// ─── CUSTOMER LOOKUP ──────────────────────────────────

router.get('/customer/:phone', async (req: Request, res: Response) => {
  const data = await lookupCustomer(req.params['phone']);
  res.json({ success: true, ...data });
});

router.post('/subscription-coverage', validate(subscriptionCoverageSchema), async (req: Request, res: Response) => {
  const coverage = await calculateSubscriptionCoverage(req.body);
  res.json({ success: true, coverage });
});

// ─── FISCAL UPDATE ────────────────────────────────────

router.patch('/receipts/:id/fiscal', validate(updateFiscalSchema), async (req: Request, res: Response) => {
  const { receipt_url, receipt_number, fiscal_sign, source } = req.body;
  await updateReceiptFiscal(req.params['id'], {
    receipt_url, receipt_number, fiscal_sign, source: source || 'atol27f',
  });
  res.json({ success: true });
});

router.get('/fiscal/settings', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { studio_id } = posFiscalSettingsQuerySchema.parse(req.query);
  const settings = await getPosFiscalSettings(studio_id);
  res.json({ success: true, settings });
});

router.put('/fiscal/settings', validate(posFiscalSettingsSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const settings = await upsertPosFiscalSettings(req.body.studio_id, req.body, req.user.id);
  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:fiscal_settings_updated',
    entityType: 'studio',
    entityId: req.body.studio_id,
    details: {
      enabled: settings.enabled,
      receipt_copies: settings.receipt_settings.receipt_copies,
      bank_slip_copies: settings.slip_settings.bank_slip_copies,
      print_bank_slip_on_atol: settings.slip_settings.print_bank_slip_on_atol,
    },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });
  res.json({ success: true, settings });
});

// ─── FROM PRICING ─────────────────────────────────────

/**
 * POST /api/pos/receipts/from-pricing
 *
 * Создаёт POS-чек через pricing engine (server-side расчёт).
 * Гарантирует корректные product_id и запись в order_items.
 *
 * Body: { category_slug, selected_options, delivery_method,
 *         shift_id, employee_id, studio_id,
 *         customer_phone?, customer_name?, loyalty_profile_id?, subscription_id?,
 *         payments, loyalty_points_to_use?, promo_code? }
 */
router.post('/receipts/from-pricing', idempotent(60), validate(createFromPricingSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const {
    category_slug, selected_options, delivery_method,
    shift_id, studio_id,
    customer_phone, client_user_id, client_contact_id, customer_name, loyalty_profile_id, subscription_id,
    payments, loyalty_points_to_use, promo_code,
    manual_amount, manual_description,
    apply_volume_discount,
    fiscal_required,
  } = req.body;
  await assertFiscalShiftForRequiredPayments(payments, shift_id, fiscal_required === true);

  // Lookup партнёра по промокоду
  let fpPartnerId: number | null = null;
  if (promo_code) {
    const fpPartnerRows = await db.query<Pick<Partners, 'id'>>(
      `SELECT id FROM partners WHERE UPPER(promo_code) = UPPER($1) AND status = 'approved'`,
      [promo_code],
    );
    fpPartnerId = fpPartnerRows[0]?.id ?? null;
  }

  // Серверный расчёт состава чека (waterfall + receiptItems) — единый хелпер,
  // тот же источник правды, что и order-first /bridge/pay (анти-расхождение).
  const {
    priceResult,
    receiptItems,
    calculatedTotal,
    optionMap,
    idToSlug,
    isSubscriptionPayment,
    categoryName,
  } = await buildPricingReceiptItems({
    category_slug,
    selected_options,
    promo_code,
    customer_phone,
    client_user_id,
    client_contact_id,
    loyalty_profile_id,
    loyalty_points_to_use,
    apply_volume_discount,
    manual_amount,
    manual_description,
    print_order_id: req.body.print_order_id ?? null,
    payments,
  });

  const paymentsTotal = Array.isArray(payments)
    ? payments.reduce((sum: number, p: { amount?: number }) => sum + Number(p.amount ?? 0), 0)
    : 0;

  // Допуск 1₽ (округление)
  if (Math.abs(paymentsTotal - calculatedTotal) > 1) {
    throw new AppError(400,
      `Сумма оплаты (${paymentsTotal}₽) не совпадает с расчётной (${calculatedTotal}₽)`
    );
  }

  const loyaltyDiscount = priceResult.loyaltyDiscount?.amount ?? 0;
  const promoDiscount = priceResult.promoDiscount?.amount ?? 0;

  // Build consumable items for auto-deduction rules
  const consumableItems = priceResult.items.map(item => ({
    option_id: item.serviceOptionId as ServiceOptionsId,
    quantity: item.quantity,
  }));

  // Calculate total subscription credits used
  const totalSubscriptionCreditsUsed = isSubscriptionPayment
    ? receiptItems.reduce((sum, i) => sum + (i.subscription_credits_used || 0), 0)
    : 0;

  // Образовательный лимит: фактически покрытые account-скидкой единицы (документы/фото) +
  // суммы скидки по видам — для списания rolling-30 лимита и аудита.
  const eduVolume = priceResult.educationVolumeConsumed ?? null;
  const educationVolumeConsumed = eduVolume
    ? {
        entitlementId: eduVolume.entitlementId,
        userId: eduVolume.userId,
        documents: eduVolume.documents,
        photos: eduVolume.photos,
        documentDiscountAmount: (priceResult.accountDiscount?.lines ?? [])
          .filter(l => l.kind === 'document_print')
          .reduce((s, l) => s + l.amount, 0),
        photoDiscountAmount: (priceResult.accountDiscount?.lines ?? [])
          .filter(l => l.kind === 'photo_print')
          .reduce((s, l) => s + l.amount, 0),
      }
    : null;

  // «Супер обработка»: при наличии processing-super в выборе резолвим конфигуратор ретуши
  // (анти-tamper по каталогу) и сохраняем snapshot в pos_receipts.metadata атомарно с чеком.
  // Резолв в try/catch: сбой каталога/SELECT НЕ должен ронять денежный чек (P2-1).
  const hasSuperRetouch = (selected_options as PricingSelectionForPos[]).some(sel => sel.slug === 'processing-super');
  let resolvedRetouch: Awaited<ReturnType<typeof resolveRetouchConfig>> | null = null;
  if (hasSuperRetouch) {
    try {
      resolvedRetouch = await resolveRetouchConfig(req.body.retouch_config || { groups: {} });
    } catch (e: unknown) {
      logger.error('[pos/from-pricing] resolveRetouchConfig failed', {
        detail: e instanceof Error ? e.message : String(e),
      });
      resolvedRetouch = null;
    }
  }
  const receiptMetadata = resolvedRetouch
    ? {
        retouch_config: {
          gender: resolvedRetouch.gender,
          options: resolvedRetouch.options,
          notes: resolvedRetouch.notes,
        },
      }
    : null;

  const receipt = await createReceipt({
    shift_id,
    employee_id: req.user.id,
    studio_id,
    customer_phone: customer_phone ?? undefined,
    customer_name: customer_name ?? undefined,
    loyalty_profile_id: loyalty_profile_id ?? undefined,
    subscription_id: subscription_id ?? undefined,
    items: receiptItems,
    payments,
    subtotal: priceResult.subtotal,
    discount_total: promoDiscount,
    points_discount: loyaltyDiscount,
    subscription_credit_used: totalSubscriptionCreditsUsed,
    total: calculatedTotal,
    category_slug: category_slug,
    print_order_id: req.body.print_order_id ?? null,
    consumableItems,
    promo_code: promo_code || null,
    partner_id: fpPartnerId,
    education_volume_consumed: educationVolumeConsumed,
    student_id_photo_promo_consumed: priceResult.studentIdPhotoPromoConsumed ?? null,
    metadata: receiptMetadata,
  });

  // «Супер обработка»: создаём лист-задание ретушёру (fire-and-forget).
  // ВСЕГДА при processing-super, даже если выбор пуст или резолв упал (P0-2) — связь «оплата → работа».
  if (hasSuperRetouch) {
    const retouchForTask = resolvedRetouch ?? { options: [], notes: null, gender: 'any' as const };
    createRetouchTaskFromPos({
      receipt_id: receipt.id,
      receipt_number: receipt.receipt_number,
      studio_id,
      client_name: customer_name ?? null,
      client_phone: customer_phone ?? null,
      gender: retouchForTask.gender,
      retouch_options: retouchForTask.options,
      notes: retouchForTask.notes,
      created_by: req.user.id,
    }).catch((err: unknown) =>
      logger.error('[pos/from-pricing] retouch task create failed:', {
        detail: err instanceof Error ? err.message : String(err),
        receipt_id: receipt.id,
      }),
    );
  }

  // Промоутерская комиссия: записать реферал и сразу подтвердить (POS-оплата мгновенная)
  if (fpPartnerId && calculatedTotal > 0) {
    await recordReferral({
      partner_id: fpPartnerId,
      order_id: receipt.id,
      order_type: 'pos',
      order_amount: calculatedTotal,
      promo_code: promo_code || undefined,
      client_phone: customer_phone || undefined,
      service_category_slug: category_slug || undefined,
      status: 'confirmed',
    });
  }

  // Записать order_items (аналитика, fire-and-forget)
  const orderItemsData = priceResult.items.map(item => {
    const slug = idToSlug.get(item.serviceOptionId) ?? item.slug;
    const optInfo = optionMap.get(slug);
    return {
      name: item.name,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      subtotal: item.finalPrice,
      service_option_id: item.serviceOptionId,
      product_id: optInfo?.product_id ?? null,
      delivery_method,
    };
  });

  insertPosOrderItems(receipt.receipt_number, orderItemsData).catch((err: Error) => {
    logger.error('[pos/from-pricing] order_items insert failed:', { detail: err.message });
  });

  // Записать material_usage для аналитики расхода материалов (fire-and-forget, без вычета stock — уже вычтен в createReceipt)
  const materialItems = priceResult.items
    .filter(item => {
      const slug = idToSlug.get(item.serviceOptionId) ?? item.slug;
      return optionMap.get(slug)?.product_id;
    })
    .map(item => {
      const slug = idToSlug.get(item.serviceOptionId) ?? item.slug;
      return {
        receipt_id: receipt.id,
        product_id: optionMap.get(slug)!.product_id!,
        quantity: item.quantity,
        studio_id,
        employee_id: req.user!.id,
      };
    });
  if (materialItems.length > 0) {
    const values: unknown[] = [];
    const placeholders = materialItems.map((mu, i) => {
      const b = i * 5;
      values.push(mu.receipt_id, mu.product_id, mu.quantity, mu.studio_id, mu.employee_id);
      return `($${b + 1},$${b + 2},$${b + 3},'sheets',$${b + 4},$${b + 5})`;
    });
    db.query(
      `INSERT INTO material_usage (receipt_id, product_id, quantity, unit, studio_id, employee_id)
       VALUES ${placeholders.join(',')}`,
      values
    ).catch((err: Error) => logger.error('[pos/from-pricing] material_usage insert failed:', { detail: err.message }));
  }

  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:receipt_from_pricing', entityType: 'pos_receipt', entityId: receipt.id, details: { receipt_number: receipt.receipt_number, total: calculatedTotal, category_slug }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  // F41: Socket.IO inventory sync
  const fpSs = getPosSocketServer(req);
  if (fpSs && receiptItems.length) {
    const fpStockChanges = receiptItems.filter(i => i.product_id).map(i => ({ product_id: i.product_id!, quantity_delta: -i.quantity }));
    if (fpStockChanges.length) {
      fpSs.getIO().to(`studio:${studio_id}`).emit('pos:stock_updated', { studio_id, changes: fpStockChanges });
    }
  }
  // F38: Fiscal enqueue (skip if АТОЛ/POS-agent has no confirmed fiscal shift)
  const fiscalPayments = receipt.payments || payments;
  if (await shouldFiscalizeReceipt(receipt.id, shift_id, fiscalPayments)) {
    enqueueFiscal({
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      items: receipt.items || receiptItems,
      total: receipt.total,
      payments: fiscalPayments,
      operation: 'sale',
    }).catch((err: unknown) => logger.error('[pos/from-pricing] fiscal enqueue:', { detail: err instanceof Error ? err.message : String(err) }));
  }
  if (hasPositiveCashPayment(receipt.payments || payments)) {
    enqueueCashDrawerCommandSafe({
      studioId: studio_id,
      initiatedBy: req.user.id,
      receiptId: receipt.id,
      source: 'pos.receipts.from-pricing',
    });
  }

  // Auto mark-paid linked print order
  if (req.body.print_order_id) {
    autoMarkPrintOrderPaid(req.body.print_order_id as string, req.user.id, receipt.id, calculatedTotal, fpSs).catch(
      (err: unknown) => logger.error('[pos/from-pricing] auto mark-paid failed:', { detail: err instanceof Error ? err.message : String(err) }),
    );
  }

  // F10: Loyalty spend — atomic deduction with SELECT FOR UPDATE
  const pointsUsed = priceResult.loyaltyDiscount?.points_used ?? 0;
  if (pointsUsed > 0 && loyalty_profile_id) {
    await spendPoints(loyalty_profile_id as LoyaltyProfilesId, pointsUsed, receipt.receipt_number);
  }

  // F49: Loyalty earn — async via BullMQ
  if (loyalty_profile_id && calculatedTotal > 0) {
    await enqueueLoyaltyEarn({
      profileId: loyalty_profile_id,
      orderAmount: calculatedTotal,
      source: 'pos_order',
      referenceId: receipt.receipt_number,
      occurredAt: receipt.created_at,
      cashbackCategoryKey: detectCashbackCategoryKey({
        categorySlug: category_slug,
        serviceName: categoryName ?? category_slug,
        items: receipt.items || receiptItems,
      }),
    });
  }

  res.status(201).json({ success: true, receipt });
});

// ─── FISCAL STATUS / RETRY ────────────────────────────

/** Статусы для ручной повторной фискализации (расширено с только-failed). */
const FISCAL_RETRYABLE_STATUSES = ['pending', 'queued', 'failed'] as const;

const COMPLETED_FISCAL_TX_TYPES = ['fiscal_sale', 'fiscal_refund'];

router.get('/receipts/:id/fiscal-status', async (req: Request, res: Response) => {
  const row = await db.queryOne<FiscalStatusRow>(
    `SELECT fiscal_status, fiscal_attempts, fiscal_last_error FROM pos_receipts WHERE id = $1`,
    [req.params['id']],
  );
  if (!row) throw new AppError(404, 'Receipt not found');
  res.json({ success: true, ...row });
});

router.post('/receipts/:id/print-copy', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const row = await db.queryOne<ReceiptCopyLookup>(
    `SELECT id, receipt_number, studio_id, voided_at
       FROM pos_receipts
      WHERE id = $1`,
    [req.params['id']],
  );
  if (!row) throw new AppError(404, 'Чек не найден');
  if (row.voided_at) {
    throw new AppError(400, 'Нельзя печатать копию аннулированного чека');
  }

  const agentId = await findPosAgentId(row.studio_id);
  if (!agentId) throw new AppError(503, 'POS-терминал не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  const commandPayload = JSON.stringify({
    command: 'receipt_copy_print',
    source: 'pos.receipt_journal',
    receipt_id: row.id,
    receipt_number: row.receipt_number,
    copy_type: 'customer',
  });

  const txResult = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, receipt_id, status, initiated_by, command_payload)
     VALUES ($1, $2, 'receipt_copy_print', 0, $3, 'pending', $4, $5::jsonb)
     RETURNING id`,
    [row.studio_id, agentId, row.id, req.user.id, commandPayload],
  );

  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:receipt_copy_print',
    entityType: 'pos_receipt',
    entityId: row.id,
    details: { receipt_number: row.receipt_number, transaction_id: txResult?.id ?? null },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  res.json({ success: true, transactionId: txResult?.id });
});

router.post('/receipts/:id/fiscal-retry', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const row = await db.queryOne<FiscalRetryLookup & { has_completed_fiscal: boolean }>(
    `SELECT fiscal_status, receipt_number, total,
            EXISTS (
              SELECT 1 FROM pos_transactions ft
               WHERE ft.receipt_id = pr.id
                 AND ft.transaction_type = ANY($2::text[])
                 AND ft.status = 'completed'
            ) AS has_completed_fiscal
       FROM pos_receipts pr WHERE pr.id = $1`,
    [req.params['id'], COMPLETED_FISCAL_TX_TYPES],
  );
  if (!row) throw new AppError(404, 'Receipt not found');
  if (!FISCAL_RETRYABLE_STATUSES.includes(row.fiscal_status as (typeof FISCAL_RETRYABLE_STATUSES)[number])) {
    throw new AppError(400, `Повторная фискализация доступна для pending/queued/failed, текущий статус: ${row.fiscal_status}`, ErrorCode.POS_FISCAL_WRONG_STATUS);
  }
  // Анти-дубль 409: завершённая фискальная транзакция по чеку → повтор создал бы
  // второй документ на ATOL (54-ФЗ). enqueueFiscal no-op'ит queued/processing/success,
  // эта проверка ловит редкий failed-чек с уже завершённой фискализацией (лаг триггера).
  if (row.has_completed_fiscal) {
    throw new AppError(409, 'Чек уже фискализирован — повтор невозможен', ErrorCode.POS_FISCAL_WRONG_STATUS);
  }
  // queued → enqueueFiscal CAS no-op (уже в очереди): честное сообщение.
  const alreadyQueued = row.fiscal_status === 'queued';
  await enqueueFiscal({ receiptId: req.params['id'], receiptNumber: row.receipt_number, items: [], total: row.total, payments: [], operation: 'sale' });
  logAudit({ userId: req.user.id, userName: req.user.display_name || '', action: 'pos:fiscal_retry', entityType: 'pos_receipt', entityId: req.params['id'], details: { fiscal_status: row.fiscal_status }, ip: req.ip || '', userAgent: req.get('user-agent') || '' });
  res.json({ success: true, message: alreadyQueued ? 'Фискальный чек уже в очереди' : 'Фискальный чек поставлен в очередь повторно' });
});

router.post('/receipts/:id/fiscal-correction', validate(fiscalCorrectionSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const input = req.body as FiscalCorrectionInput;
  const row = await db.queryOne<FiscalCorrectionLookup>(
    `SELECT pr.id,
            pr.fiscal_status,
            pr.receipt_number,
            pr.total,
            pr.studio_id,
            pr.created_at,
            pr.is_refund,
            pr.voided_at,
            COALESCE((
              SELECT prp.payment_type
              FROM pos_receipt_payments prp
              WHERE prp.receipt_id = pr.id
                AND prp.status = 'completed'
                AND prp.amount > 0
              ORDER BY prp.id
              LIMIT 1
            ), 'card') AS payment_method
     FROM pos_receipts pr
     WHERE pr.id = $1`,
    [req.params['id']],
  );
  if (!row) throw new AppError(404, 'Receipt not found');
  if (row.fiscal_status !== 'failed') {
    throw new AppError(400, `Чек коррекции доступен только для failed, текущий статус: ${row.fiscal_status}`, ErrorCode.POS_FISCAL_WRONG_STATUS);
  }
  if (row.is_refund || row.voided_at) {
    throw new AppError(400, 'Чек коррекции доступен только для исходной продажи', ErrorCode.POS_FISCAL_WRONG_STATUS);
  }

  const agentId = await findPosAgentId(row.studio_id);
  if (!agentId) throw new AppError(503, 'POS-агент не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  const commandPayload = {
    correction_type: input.correction_type,
    correction_base_date: input.correction_base_date ?? fiscalCorrectionDateFromReceipt(row.created_at),
    correction_base_number: input.correction_base_number ?? fiscalCorrectionBaseNumber(row.receipt_number),
    correction_base_name: input.correction_base_name ?? DEFAULT_FISCAL_CORRECTION_BASE_NAME,
  };

  const txResult = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, receipt_id, status, payment_method, initiated_by, command_payload)
     VALUES ($1, $2, 'fiscal_correction', $3, $4, 'pending', $5, $6, $7::jsonb)
     RETURNING id`,
    [
      row.studio_id,
      agentId,
      row.total,
      req.params['id'],
      row.payment_method ?? 'card',
      req.user.id,
      JSON.stringify(commandPayload),
    ],
  );

  await db.query(
    `UPDATE pos_receipts
     SET fiscal_status = 'queued',
         fiscal_queued_at = NOW()
     WHERE id = $1`,
    [req.params['id']],
  );
  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:fiscal_correction',
    entityType: 'pos_receipt',
    entityId: req.params['id'],
    details: commandPayload,
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });
  res.json({ success: true, transactionId: txResult?.id });
});

// ─── POS BRIDGE (via pos_transactions + PG NOTIFY → print-api → MQTT → agent) ───

router.post('/bridge/pay', validate(bridgePaySchema), async (req: AuthRequest, res: Response) => {
  const studioId = req.body.studioId;
  const orderId = typeof req.body.orderId === 'string' ? req.body.orderId.trim() : '';
  const transactionOrderId = uuidOrNull(orderId);

  // Order-first (флаг POS_ORDER_FIRST_ENABLED): бэк сам канонизирует/строит состав
  // заказа и персистит его в command_payload payment-tx ДО отправки на терминал —
  // чтобы при обрыве/in_doubt чек допробивался без потери номенклатуры. Бэк НЕ
  // делает hard-сверку суммы (54-ФЗ-сверка остаётся на материализации, совместима
  // со сплитом subscription+card). При OFF — старый payload {orderId} либо
  // переданный фронтом snapshot как есть (обратная совместимость со старым фронтом).
  const rawSnapshot = req.body.snapshot as CartSnapshotInput | undefined;
  const rawPricing = req.body.pricing as BridgePricingInput | undefined;
  let canonicalSnapshot: CartSnapshotInput | undefined;
  if (config.pos.orderFirstEnabled) {
    if (rawPricing) {
      canonicalSnapshot = await buildPricingSnapshot(rawPricing, studioId);
    } else if (rawSnapshot) {
      canonicalSnapshot = canonicalizeCartSnapshot(rawSnapshot, studioId);
    }
  } else {
    canonicalSnapshot = rawSnapshot;
  }
  const commandPayload = JSON.stringify(
    canonicalSnapshot ? { orderId, snapshot: canonicalSnapshot } : { orderId },
  );

  const agentId = await findPosAgentId(studioId);
  if (!agentId) throw new AppError(503, 'POS-терминал не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  // Контур #3: блок приёма карты при свежем terminal_online=false (за фича-флагом).
  // Мягкая деградация: getTerminalGateState блокирует ТОЛЬКО при свежем false-снимке
  // (нет/устаревшая telemetry → blocked=false, оплату пускаем).
  if (config.pos.terminalGateEnabled) {
    const gate = await getTerminalGateState(studioId);
    if (gate.blocked) {
      throw new AppError(
        503,
        'Терминал недоступен, обновление или перезагрузка, примите оплату позже или другим способом',
        ErrorCode.POS_TERMINAL_OFFLINE,
      );
    }
  }

  // INSERT pos_transaction — PG NOTIFY trigger отправит через print-api → MQTT → pos-agent
  const txResult = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, order_id, status, initiated_by, command_payload)
     VALUES ($1, $2, 'payment', $3, $4, 'pending', $5, $6::jsonb)
     RETURNING id`,
    [studioId, agentId, req.body.amount, transactionOrderId, req.user?.id || null, commandPayload],
  );

  res.json({ success: true, transactionId: txResult?.id });
});

router.post('/bridge/refund', validate(bridgeRefundSchema), async (req: AuthRequest, res: Response) => {
  const studioId = req.body.studioId;
  const originalTransactionId = req.body.transactionId;

  const originalPayment = await db.queryOne<PosBridgePaymentForRefundRow>(
    `SELECT id, studio_id, amount, order_id, rrn, status, transaction_type
     FROM pos_transactions
     WHERE id = $1 AND studio_id = $2 AND transaction_type = 'payment'
     LIMIT 1`,
    [originalTransactionId, studioId],
  );

  if (!originalPayment) {
    throw new AppError(404, 'Исходная оплата не найдена');
  }

  if (originalPayment.status !== 'completed') {
    throw new AppError(409, 'Исходная оплата ещё не подтверждена терминалом');
  }

  const originalRrn = typeof originalPayment.rrn === 'string' ? originalPayment.rrn.trim() : '';
  if (!originalRrn) {
    throw new AppError(400, 'Не найден RRN исходной оплаты; проверьте отмену в Т-Бизнесе');
  }

  const existingRefund = await db.queryOne<PosBridgeRefundLookupRow>(
    `SELECT id, status
     FROM pos_transactions
     WHERE studio_id = $2
       AND transaction_type = 'refund'
       AND command_payload->>'original_transaction_id' = $1
     ORDER BY initiated_at DESC
     LIMIT 1`,
    [originalTransactionId, studioId],
  );

  if (
    existingRefund
    && ['pending', 'processing', 'completed'].includes(existingRefund.status ?? '')
  ) {
    res.json({ success: true, transactionId: existingRefund.id });
    return;
  }

  const agentId = await findPosAgentId(studioId);
  if (!agentId) throw new AppError(503, 'POS-терминал не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  const commandPayload = JSON.stringify({
    original_transaction_id: originalTransactionId,
    original_rrn: originalRrn,
    source: 'card_fiscal_failure',
  });

  const refundTransaction = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, order_id, status, initiated_by, command_payload)
     VALUES ($1, $2, 'refund', $3, $4, 'pending', $5, $6::jsonb)
     RETURNING id`,
    [
      studioId,
      agentId,
      originalPayment.amount,
      originalPayment.order_id,
      req.user?.id || null,
      commandPayload,
    ],
  );

  res.json({ success: true, transactionId: refundTransaction?.id });
});

router.post('/bridge/cash-drawer', validate(bridgeCashDrawerSchema), async (req: AuthRequest, res: Response) => {
  const studioId = req.body.studioId || req.user?.studio_id;
  if (!studioId) throw new AppError(400, 'studioId required');

  const transactionId = await enqueueCashDrawerCommand({
    studioId,
    initiatedBy: req.user?.id ?? null,
    source: 'pos.bridge.cash-drawer',
  });
  if (!transactionId) throw new AppError(503, 'POS-агент не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  res.json({ success: true, transactionId });
});

router.post('/bridge/bank-settlement', validate(bridgeSettlementSchema), async (req: AuthRequest, res: Response) => {
  const studioId = req.body.studioId;

  const agentId = await findPosAgentId(studioId);
  if (!agentId) throw new AppError(503, 'POS-терминал не подключён', ErrorCode.POS_BRIDGE_UNAVAILABLE);

  const txResult = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, status, initiated_by)
     VALUES ($1, $2, 'bank_settlement', 0, 'pending', $3)
     RETURNING id`,
    [studioId, agentId, req.user?.id || null],
  );

  res.json({ success: true, transactionId: txResult?.id });
});

router.post('/bridge/fiscal', validate(bridgeFiscalSchema), async (req: AuthRequest, res: Response) => {
  const studioId = req.body.studioId;
  if (!studioId) throw new AppError(400, 'studioId required for fiscal');

  const agent = await db.queryOne<Pick<Agents, 'id'>>(
    `SELECT id FROM agents WHERE studio_id = $1 AND agent_type = 'pos' LIMIT 1`,
    [studioId],
  );

  await db.query(
    `INSERT INTO pos_transactions (studio_id, agent_id, transaction_type, amount, receipt_id, status, initiated_by)
     VALUES ($1, $2, 'fiscal_sale', $3, $4, 'pending', $5)`,
    [studioId, agent?.id ?? null, req.body.total || 0, req.body.receiptId || null, req.user?.id || null],
  );

  res.json({ success: true });
});

/**
 * Помечает оплату картой `payment_resolution='in_doubt'` (контур #1), если её
 * исход неопределён: failed без явного отказа (классификатор → in_doubt) ИЛИ
 * pending/processing старше PAYMENT_OPEN_DOUBT_SECONDS (P1-2, зависший pending).
 *
 * Пишем ТОЛЬКО `payment_resolution`, `status` не трогаем (его пишет Rust) —
 * это физически исключает гонку Rust↔Node. Guard `payment_resolution IS NULL`
 * делает операцию идемпотентной. Возвращает обновлённую строку или null.
 */
async function markPaymentInDoubtIfNeeded(
  transaction: PosBridgeTransactionStatusRow,
): Promise<PaymentResolutionRow | null> {
  const status = transaction.status;

  // Зависший pending/processing старше порога → in_doubt (фронт ещё поллит).
  if (status === 'pending' || status === 'processing') {
    return db.queryOne<PaymentResolutionRow>(
      `UPDATE pos_transactions
       SET payment_resolution = 'in_doubt'
       WHERE id = $1
         AND transaction_type = 'payment'
         AND payment_resolution IS NULL
         AND status IN ('pending', 'processing')
         AND initiated_at <= NOW() - ($2::int * INTERVAL '1 second')
       RETURNING payment_resolution`,
      [transaction.id, PAYMENT_OPEN_DOUBT_SECONDS],
    );
  }

  // failed → классифицируем: таймаут/обрыв = in_doubt, явный отказ/RRN = failed.
  if (status === 'failed') {
    const fields = await db.queryOne<PosPaymentFailureFieldsRow>(
      `SELECT error_message, rrn FROM pos_transactions WHERE id = $1`,
      [transaction.id],
    );
    const classification = classifyFailedPayment({
      error_message: fields?.error_message ?? transaction.error_message,
      rrn: fields?.rrn ?? null,
    });
    if (classification !== 'in_doubt') return null;

    return db.queryOne<PaymentResolutionRow>(
      `UPDATE pos_transactions
       SET payment_resolution = 'in_doubt'
       WHERE id = $1
         AND transaction_type = 'payment'
         AND payment_resolution IS NULL
       RETURNING payment_resolution`,
      [transaction.id],
    );
  }

  return null;
}

async function reconcileBridgeTransactionForPolling(
  transaction: PosBridgeTransactionStatusRow,
): Promise<BridgeTransactionWithResolution> {
  if (
    transaction.transaction_type === 'bank_settlement'
    && (transaction.status === 'pending' || transaction.status === 'processing')
  ) {
    const timedOutTransaction = await db.queryOne<PosBridgeTransactionStatusRow>(
      `UPDATE pos_transactions
       SET status = 'timeout',
           error_message = COALESCE(NULLIF(error_message, ''), $2),
           completed_at = NOW()
       WHERE id = $1
         AND transaction_type = 'bank_settlement'
         AND status IN ('pending', 'processing')
         AND initiated_at <= NOW() - ($3::int * INTERVAL '1 second')
       RETURNING id, studio_id, transaction_type, status, error_message, terminal_response, initiated_at`,
      [transaction.id, BANK_SETTLEMENT_TIMEOUT_MESSAGE, BANK_SETTLEMENT_TIMEOUT_SECONDS],
    );

    if (timedOutTransaction) return timedOutTransaction;
  }

  // Контур #1/#2 (P1-2): неопределённая оплата картой → payment_resolution='in_doubt'.
  if (transaction.transaction_type === 'payment') {
    const resolved = await markPaymentInDoubtIfNeeded(transaction);
    if (resolved) {
      return { ...transaction, payment_resolution: resolved.payment_resolution };
    }
    return transaction;
  }

  return reconcileFiscalShiftTransactionFromTelemetry(transaction);
}

router.get('/bridge/transactions/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const transaction = await db.queryOne<BridgeTransactionWithResolution>(
    `SELECT id, studio_id, status, payment_resolution, transaction_type, error_message, terminal_response, initiated_at
     FROM pos_transactions
     WHERE id = $1 AND (initiated_by = $2 OR $3 = 'admin' OR $3 = 'manager')`,
    [req.params['id'], req.user.id, req.user.role],
  );
  if (!transaction) throw new AppError(404, 'Transaction not found');

  const reconciledTransaction = await reconcileBridgeTransactionForPolling(transaction);
  // Эффективный статус = COALESCE(payment_resolution, status): in_doubt доходит до фронта.
  res.json({
    success: true,
    transaction: {
      id: reconciledTransaction.id,
      status: effectivePaymentStatus(reconciledTransaction),
      transaction_type: reconciledTransaction.transaction_type,
      error_message: reconciledTransaction.error_message,
      terminal_response: reconciledTransaction.terminal_response,
    },
  });
});

router.get('/bridge/status', async (req: AuthRequest, res: Response) => {
  const studioId = (req.query['studioId'] || req.user?.studio_id) as string | undefined;
  if (!studioId) {
    res.json({ online: false, reason: 'no_studio' });
    return;
  }

  const agent = await db.queryOne<Pick<Agents, 'id' | 'is_online' | 'last_heartbeat_at'>>(
    `SELECT id, is_online, last_heartbeat_at FROM agents WHERE studio_id = $1 AND agent_type = 'pos' LIMIT 1`,
    [studioId],
  );
  if (!agent) {
    res.json({ online: false, reason: 'no_agent', terminalOnline: null, terminalCheckedAt: null });
    return;
  }
  const isOnline = !!agent.is_online &&
    !!agent.last_heartbeat_at && new Date(agent.last_heartbeat_at).getTime() > Date.now() - 120_000;
  // Контур #3: онлайн терминала по telemetry (для дизейбла кнопки «Карта» на фронте).
  const gate = await getTerminalGateState(studioId);
  res.json({
    online: isOnline,
    agentId: agent.id,
    lastHeartbeat: agent.last_heartbeat_at,
    terminalOnline: gate.terminalOnline,
    terminalCheckedAt: gate.checkedAt,
  });
});

// ─── POS PAYMENTS — детект зависших / разрешение / сверка (контур #2/#4) ───

/** Строка зависшей оплаты для списка in-doubt. */
interface InDoubtPaymentRow {
  id: string;
  studio_id: string;
  amount: string;
  order_id: string | null;
  status: string | null;
  payment_resolution: string | null;
  error_message: string | null;
  rrn: string | null;
  initiated_by: string | null;
  initiated_by_name: string | null;
  initiated_at: string | null;
  command_payload: { orderId?: string; snapshot?: CartSnapshotInput } | null;
}

/**
 * GET /api/pos/payments/in-doubt?studioId= — оплаты с неопределённым исходом
 * (контур #4): payment_resolution='in_doubt' ИЛИ pending/processing старше N
 * минут. Возраст и сортировка по initiated_at (NOT NULL, DEFAULT now()).
 *
 * AuthZ (P0-3): admin/manager видят оплаты любого инициатора студии; остальные —
 * только свои (initiated_by = req.user.id), как у /bridge/transactions/:id.
 */
router.get('/payments/in-doubt', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const studioId = (req.query['studioId'] || req.user.studio_id) as string | undefined;
  if (!studioId || !UUID_RE.test(studioId)) throw new AppError(400, 'studioId required');

  const canViewAll = req.user.role === 'admin' || req.user.role === 'manager';

  // Ленивое покрытие B6: свежие failed без classification (фронт не довёл polling
  // до markPaymentInDoubtIfNeeded) прогоняем через классификатор перед SELECT.
  // Обрыв/таймаут → in_doubt (попадёт в список), «Error 16»/отказ → остаётся
  // failed (классификатор отсеет). Без нового шедулера, идемпотентно (guard NULL).
  const freshFailed = await db.query<Pick<PosTransactions, 'id'>>(
    `SELECT id FROM pos_transactions
     WHERE studio_id = $1
       AND transaction_type = 'payment'
       AND status = 'failed'
       AND payment_resolution IS NULL
       AND initiated_at > NOW() - INTERVAL '24 hours'
     LIMIT 100`,
    [studioId],
  );
  for (const f of freshFailed) {
    await markPaymentInDoubtIfNeeded({
      id: f.id,
      studio_id: studioId,
      transaction_type: 'payment',
      status: 'failed',
      error_message: null,
      terminal_response: null,
      initiated_at: null,
    }).catch((err: unknown) => logger.error('[pos] in-doubt lazy classify:', { detail: toErrorMessage(err) }));
  }

  const rows = await db.query<InDoubtPaymentRow>(
    `SELECT pt.id, pt.studio_id, pt.amount, pt.order_id, pt.status,
            pt.payment_resolution, pt.error_message, pt.rrn,
            pt.initiated_by, u.display_name AS initiated_by_name, pt.initiated_at,
            pt.command_payload
     FROM pos_transactions pt
     LEFT JOIN users u ON u.id = pt.initiated_by
     WHERE pt.studio_id = $1
       AND pt.transaction_type = 'payment'
       AND (pt.initiated_by = $2 OR $3 = true)
       AND (
         pt.payment_resolution = 'in_doubt'
         OR (
           pt.payment_resolution IS NULL
           AND pt.status IN ('pending', 'processing')
           AND pt.initiated_at <= NOW() - ($4::int * INTERVAL '1 minute')
         )
       )
     ORDER BY pt.initiated_at DESC
     LIMIT 100`,
    [studioId, req.user.id, canViewAll, IN_DOUBT_PAYMENT_AGE_MINUTES] as unknown[],
  );

  // Контракт фронта PosInDoubtPayment (camelCase): id, amount, orderId,
  // initiatedAt, status, errorMessage, snapshot. Ответ — { success, items }.
  // snapshot ({items, subtotal, total}) из command_payload — фронт показывает
  // позиции и активирует «Подтвердить оплату»; нет снимка → null.
  const items = rows.map(r => {
    const snap = r.command_payload?.snapshot;
    return {
      id: r.id,
      amount: Number.parseFloat(r.amount),
      orderId: r.order_id,
      terminalOrderId: r.command_payload?.orderId ?? null,
      initiatedAt: r.initiated_at,
      initiatedByName: r.initiated_by_name,
      status: effectivePaymentStatus(r) ?? r.status ?? 'unknown',
      errorMessage: r.error_message,
      snapshot: snap
        ? { items: snap.items, subtotal: snap.subtotal, total: snap.total }
        : null,
    };
  });

  res.json({ success: true, items });
});

/** Строка оплаты для проверки прав и допробития чека при разрешении. */
interface ResolvePaymentLookupRow {
  id: string;
  studio_id: string;
  initiated_by: string | null;
  payment_resolution: string | null;
  amount: string | number | null;
  command_payload: { orderId?: string; snapshot?: CartSnapshotInput } | null;
  settled_receipt_id: string | null;
}

/** Округление до копеек для денежных сумм чека (как roundMoney в pos.service). */
function roundReceiptMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Ищет уже созданный чек по этой payment-tx через мягкую связь
 * pos_receipt_payments.transaction_id (createReceipt пишет туда transaction_id,
 * pos.service.ts:1181). Источник самолечения идемпотентности resolve: если чек
 * уже создан (краш после createReceipt до settled_receipt_id, либо конкурентный
 * запрос), не создаём второй. Возвращает receipt_id или null.
 */
async function findReceiptIdByPaymentTransaction(paymentId: string): Promise<string | null> {
  const row = await db.queryOne<Pick<PosReceiptPayments, 'receipt_id'>>(
    `SELECT receipt_id FROM pos_receipt_payments WHERE transaction_id = $1 LIMIT 1`,
    [paymentId],
  );
  return row?.receipt_id ?? null;
}

/**
 * Достраивает payload createReceipt из снимка корзины / переданных позиций.
 * total чека = сумма реального списания (payment.amount, источник истины).
 *
 * P1-1/3/4 (НЕ доверять суммам с фронта): per-item `total` ПЕРЕСЧИТЫВАЕМ из
 * unit_price*quantity (round до копеек), а `subtotal` ВСЕГДА считаем из этих
 * пересчитанных позиций — snapshot.subtotal/item.total с фронта игнорируем как
 * источник денежной суммы. discount_total берём из snapshot (влияет только на
 * отображение скидки, не на сумму к оплате). createReceipt сам сверит, что
 * payments total совпадает с total чека (POS_PAYMENTS_MISMATCH).
 */
function buildResolveReceiptItems(
  snapshot: CartSnapshotInput | undefined,
  bodyItems: CartSnapshotInput['items'] | undefined,
): { items: PosReceiptItem[]; subtotal: number; discountTotal: number } | null {
  const sourceItems = snapshot?.items ?? bodyItems;
  if (!Array.isArray(sourceItems) || sourceItems.length === 0) return null;
  // Нормализуем product_id (zod даёт string|null|undefined) под PosReceiptItem;
  // per-item total пересчитываем сервером (не доверяем total с фронта).
  const items: PosReceiptItem[] = sourceItems.map(item => ({
    ...item,
    product_id: item.product_id ?? null,
    total: roundReceiptMoney(Number(item.unit_price || 0) * Number(item.quantity || 0)),
  }));
  const subtotal = roundReceiptMoney(items.reduce((sum, item) => sum + item.total, 0));
  const discountTotal = typeof snapshot?.discount_total === 'number' ? snapshot.discount_total : 0;
  return { items, subtotal, discountTotal };
}

/**
 * shift_id для оформления чека по осиротевшей оплате. Если в снимке есть shiftId —
 * берём его; иначе (у реальных orphan snapshot=null) резолвим текущую открытую
 * POS-смену студии (любой кассир). Нет открытой смены → компенсация CAS + 400.
 */
async function resolveOrphanReceiptShiftId(
  snapshotShiftId: string | null,
  studioId: string,
  revertClaim: () => Promise<void>,
): Promise<string> {
  if (snapshotShiftId) return snapshotShiftId;
  const openShiftId = await findOpenShiftIdForStudio(studioId);
  if (!openShiftId) {
    await revertClaim();
    throw new AppError(400, 'Нет открытой смены ФР');
  }
  return openShiftId;
}

/**
 * POST /api/pos/payments/:id/resolve — ручное разрешение зависшей оплаты
 * (контур #4): {outcome:'paid'|'unpaid', items?} → payment_resolution
 * resolved_paid / resolved_unpaid. Денежно-фискальное действие.
 *
 * outcome='paid' за флагом POS_INDOUBT_RESOLVE_ENABLED: допробивает чек по
 * сохранённому в command_payload снимку корзины (или переданным items) и
 * фискализирует приход на АТОЛ. Повторного СПИСАНИЯ нет — resolve НЕ зовёт
 * /bridge/pay, деньги уже списаны терминалом (слип напечатан). Идемпотентность
 * против гонки/дабл-клика: CAS payment_resolution in_doubt→resolved_paid ПЕРВЫМ;
 * 0 строк ⇒ чек уже создан → возвращаем существующий по settled_receipt_id, без
 * второго чека/двойной фискализации. Замок settled_receipt_id фиксирует
 * «один чек на оплату». При флаге OFF — старое поведение (только пометка статуса).
 *
 * AuthZ (P0-A): pos:use гарантирован глобальным router.use; разрешать можно
 * свою зависшую оплату (initiated_by) ИЛИ любую студии для admin/manager. Это
 * осознанное product-решение владельца — кассир завершает свою продажу.
 * Guard CAS `WHERE payment_resolution='in_doubt'` — нельзя переопределить
 * уже подтверждённый исход.
 */
router.post('/payments/:id/resolve', validate(resolvePaymentSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const paymentId = req.params['id'];
  if (!paymentId || !UUID_RE.test(paymentId)) throw new AppError(400, 'Некорректный id оплаты');

  const outcome = req.body.outcome as 'paid' | 'unpaid';
  const bodyItems = req.body.items as CartSnapshotInput['items'] | undefined;

  const payment = await db.queryOne<ResolvePaymentLookupRow>(
    `SELECT id, studio_id, initiated_by, payment_resolution, amount, command_payload, settled_receipt_id
     FROM pos_transactions
     WHERE id = $1 AND transaction_type = 'payment'`,
    [paymentId],
  );
  if (!payment) throw new AppError(404, 'Оплата не найдена');

  // Studio-scope (P0-A): admin/manager — любую оплату студии; остальные — только
  // свою инициированную. pos:use уже проверен глобальным router.use выше.
  const canManageAll = req.user.role === 'admin' || req.user.role === 'manager';
  if (!canManageAll && payment.initiated_by !== req.user.id) {
    throw new AppError(403, 'Можно разрешать только свои оплаты');
  }
  // P1-A (явная studio-проверка, defence-in-depth): если у пользователя задана
  // студия (online-смена), оплата чужой студии запрещена даже admin/manager.
  // В текущем authenticateToken user.studio_id не заполняется → no-op, но не
  // даёт привилегированной роли разрешить оплату вне своей студии, если scope
  // появится. employee и так жёстко ограничен своей initiated_by выше.
  if (req.user.studio_id && payment.studio_id !== req.user.studio_id) {
    throw new AppError(403, 'Оплата относится к другой студии');
  }

  // unpaid: списания не было — просто метим статус (CAS, как Этап 1).
  if (outcome === 'unpaid') {
    const updated = await db.queryOne<PaymentResolutionRow>(
      `UPDATE pos_transactions
       SET payment_resolution = 'resolved_unpaid'
       WHERE id = $1
         AND transaction_type = 'payment'
         AND payment_resolution = 'in_doubt'
       RETURNING payment_resolution`,
      [paymentId],
    );
    if (!updated) throw new AppError(409, 'Оплата не в статусе in_doubt, разрешение невозможно');
    logAudit({
      userId: req.user.id, userName: req.user.display_name || '',
      action: 'pos:payment_resolved', entityType: 'pos_transaction', entityId: paymentId,
      details: { outcome, resolution: 'resolved_unpaid' }, ip: req.ip || '', userAgent: req.get('user-agent') || '',
    });
    res.json({ success: true, payment_resolution: updated.payment_resolution });
    return;
  }

  // ── outcome === 'paid' ──────────────────────────────────────────────────────

  // Флаг OFF: денежно-фискальное допробитие выключено — старое поведение (только
  // пометка статуса, чек не создаётся). CAS-guard как раньше.
  if (!config.pos.indoubtResolveEnabled) {
    const updated = await db.queryOne<PaymentResolutionRow>(
      `UPDATE pos_transactions
       SET payment_resolution = 'resolved_paid'
       WHERE id = $1
         AND transaction_type = 'payment'
         AND payment_resolution = 'in_doubt'
       RETURNING payment_resolution`,
      [paymentId],
    );
    if (!updated) throw new AppError(409, 'Оплата не в статусе in_doubt, разрешение невозможно');
    logAudit({
      userId: req.user.id, userName: req.user.display_name || '',
      action: 'pos:payment_resolved', entityType: 'pos_transaction', entityId: paymentId,
      details: { outcome, resolution: 'resolved_paid' }, ip: req.ip || '', userAgent: req.get('user-agent') || '',
    });
    res.json({ success: true, payment_resolution: updated.payment_resolution });
    return;
  }

  // Флаг ON: допробить чек по снимку корзины. CAS ПЕРВЫМ (P1-гонка) — атомарно
  // забираем право на разрешение, до создания чека.
  const claimed = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `UPDATE pos_transactions
     SET payment_resolution = 'resolved_paid'
     WHERE id = $1
       AND transaction_type = 'payment'
       AND payment_resolution = 'in_doubt'
     RETURNING id`,
    [paymentId],
  );

  // P0-3 (CAS=0 строк ⇒ оплата уже разрешена — дабл-клик/гонка): возвращаем
  // существующий чек, НЕ создаём второй. Сперва по settled_receipt_id, затем по
  // мягкой связи pos_receipt_payments.transaction_id (если settled ещё не
  // проставлен). Если чека нет вовсе — разрешение выполняется конкурентно прямо
  // сейчас → 409 «обновите». НИКОГДА не отдаём receipt: undefined.
  if (!claimed) {
    const existingReceiptId = payment.settled_receipt_id
      ?? await findReceiptIdByPaymentTransaction(paymentId);
    if (existingReceiptId) {
      const existing = await getReceiptById(existingReceiptId);
      if (existing) {
        res.json({ success: true, payment_resolution: 'resolved_paid', receipt: existing });
        return;
      }
    }
    throw new AppError(409, 'Разрешение этой оплаты уже выполняется, обновите список');
  }

  // P0-1 (самолечение идемпотентности ДО createReceipt): если по этой оплате чек
  // уже создан (краш после createReceipt до простановки settled_receipt_id, либо
  // конкурентный путь), возвращаем его — НЕ создаём второй чек/вторую фискализацию.
  const priorReceiptId = await findReceiptIdByPaymentTransaction(paymentId);
  if (priorReceiptId) {
    const prior = await getReceiptById(priorReceiptId);
    if (prior) {
      // Достраиваем замок settled_receipt_id, если он не был проставлен (краш).
      await db.query(
        `UPDATE pos_transactions SET settled_receipt_id = $2
         WHERE id = $1 AND settled_receipt_id IS NULL`,
        [paymentId, prior.id],
      );
      res.json({ success: true, payment_resolution: 'resolved_paid', receipt: prior });
      return;
    }
  }

  // Компенсация CAS: вернуть оплату в in_doubt, если дальше нельзя создать чек.
  const revertClaim = async (): Promise<void> => {
    await db.query(
      `UPDATE pos_transactions SET payment_resolution = 'in_doubt'
       WHERE id = $1 AND transaction_type = 'payment' AND payment_resolution = 'resolved_paid' AND settled_receipt_id IS NULL`,
      [paymentId],
    );
  };

  const snapshot = payment.command_payload?.snapshot;
  const built = buildResolveReceiptItems(snapshot, bodyItems);
  if (!built) {
    await revertClaim();
    throw new AppError(400, 'Нет сохранённых позиций корзины — передайте items для создания чека');
  }

  const amount = roundReceiptMoney(Number(payment.amount) || 0);
  if (amount <= 0) {
    await revertClaim();
    throw new AppError(400, 'Сумма оплаты должна быть положительной');
  }

  const shiftId = snapshot?.shiftId ?? null;

  // Гейт ФР-смены (P1-D/E): карта требует открытой смены ФР, иначе чек уйдёт в
  // skipped и его не добить через fiscal-retry (тот требует failed). Компенсируем
  // CAS перед 400, чтобы оплату можно было разрешить позже при открытой смене.
  try {
    await assertFiscalShiftForRequiredPayments([{ payment_type: 'card' }], shiftId, true);
  } catch (err) {
    await revertClaim();
    throw err;
  }

  let receipt: PosReceipt;
  try {
    receipt = await createReceipt({
      shift_id: shiftId,
      employee_id: req.user.id,
      studio_id: payment.studio_id,
      customer_phone: snapshot?.customerPhone,
      loyalty_profile_id: snapshot?.loyaltyProfileId,
      items: built.items,
      subtotal: built.subtotal,
      discount_total: built.discountTotal,
      total: amount,
      promo_code: snapshot?.promoCode ?? null,
      // P0-2/P1-C (документация намерения, НЕ баг): у in_doubt-tx rrn/card_mask =
      // NULL (поздний ответ банка в БД не дошёл, подтверждено), поэтому чек
      // пробивается как оплата картой/электронными на сумму БЕЗ RRN — для 54-ФЗ
      // валидно: слип терминала уже напечатан, ФД фиксирует приход. transaction_id
      // здесь = привязка к оплате + ключ идемпотентности фискализации, НЕ источник
      // реквизитов карты.
      payments: [{ payment_type: 'card', amount, transaction_id: paymentId }],
    });
  } catch (err) {
    // Чек не создан (валидация сумм/смены) — вернуть оплату в in_doubt.
    await revertClaim();
    throw err;
  }

  // P0-2 (замок «один чек на оплату» с RETURNING-guard): связываем закрывающий
  // чек с payment-tx ТОЛЬКО если settled_receipt_id ещё пуст. Фискализацию
  // запускаем ИСКЛЮЧИТЕЛЬНО при успешной привязке (вернулась строка) — иначе
  // чек уже привязан конкурентным путём, его фискализация уже идёт.
  const linked = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `UPDATE pos_transactions SET settled_receipt_id = $2
     WHERE id = $1 AND settled_receipt_id IS NULL
     RETURNING id`,
    [paymentId, receipt.id],
  );

  // P1-2 (гонка закрытия смены): если ФР-смену закрыли между гейтом и созданием
  // чека, shouldFiscalizeReceipt вернёт false и чек останется fiscal_status=
  // 'skipped' (его не добить через fiscal-retry, тот требует 'failed'). Сообщаем
  // оператору явным флагом fiscalized, а не молча.
  let fiscalized = false;
  if (linked) {
    const fiscalPayments = receipt.payments ?? [{ payment_type: 'card', amount }];
    const fiscalShiftId = receipt.shift_id ?? shiftId ?? null;
    fiscalized = await shouldFiscalizeReceipt(receipt.id, fiscalShiftId, fiscalPayments);
    if (fiscalized) {
      // enqueueFiscal идемпотентен (S1: guard по fiscal_status) — повтор не создаст
      // вторую фискальную транзакцию.
      enqueueFiscal({
        receiptId: receipt.id,
        receiptNumber: receipt.receipt_number,
        items: receipt.items || built.items,
        total: receipt.total,
        payments: fiscalPayments,
        operation: 'sale',
      }).catch((err: unknown) => logger.error('[pos] resolve fiscal enqueue:', { detail: toErrorMessage(err) }));
    }
  }

  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:payment_resolved',
    entityType: 'pos_transaction',
    entityId: paymentId,
    details: { outcome, resolution: 'resolved_paid', receipt_id: receipt.id, receipt_number: receipt.receipt_number, total: receipt.total, fiscalized },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  // fiscalWarning — явное предупреждение оператору, что чек создан, но НЕ
  // фискализирован (смена ФР закрылась в гонке): нужно открыть смену и добить.
  const response: { success: true; payment_resolution: 'resolved_paid'; receipt: PosReceipt; fiscalized: boolean; fiscalWarning?: string } = {
    success: true,
    payment_resolution: 'resolved_paid',
    receipt,
    fiscalized,
  };
  if (linked && !fiscalized) {
    response.fiscalWarning = 'Чек создан, но не фискализирован: смена ФР закрыта. Откройте смену ФР и добейте фискализацию.';
  }
  res.status(201).json(response);
});

/**
 * GET /api/pos/payments/orphan?studioId= — осиротевшие карт-оплаты (completed
 * без чека). Деньги списаны терминалом, чек не оформился. Список отдаётся только
 * при POS_ORPHAN_DETECT_ENABLED (иначе пустой). Контракт фронта совместим с
 * PosInDoubtPayment + kind:'orphan'; snapshot обычно null (order_id NULL).
 *
 * AuthZ как in-doubt: pos:use (глобальный router.use) + admin/manager видят всю
 * студию, employee — только свои инициированные (initiated_by). orphan с
 * initiated_by NULL (legacy) видны только admin/manager.
 */
router.get('/payments/orphan', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const studioId = (req.query['studioId'] || req.user.studio_id) as string | undefined;
  if (!studioId || !UUID_RE.test(studioId)) throw new AppError(400, 'studioId required');

  // Флаг OFF — детектор выключен (тёмный запуск), отдаём пустой список.
  if (!config.pos.orphanDetectEnabled) {
    res.json({ success: true, items: [] });
    return;
  }

  const canViewAll = req.user.role === 'admin' || req.user.role === 'manager';
  const rows = await findOrphanPayments(studioId, config.pos.orphanPaymentAgeMinutes);

  const items = rows
    .filter(r => canViewAll || r.initiated_by === req.user!.id)
    .map(r => {
      const snap = r.command_payload?.snapshot;
      return {
        id: r.id,
        kind: 'orphan' as const,
        amount: Number.parseFloat(r.amount),
        orderId: r.order_id,
        terminalOrderId: r.command_payload?.orderId ?? null,
        initiatedAt: r.completed_at,
        initiatedByName: r.initiated_by_name,
        status: r.status ?? 'completed',
        errorMessage: null,
        snapshot: snap
          ? { items: snap.items ?? [], subtotal: snap.subtotal ?? 0, total: snap.total ?? 0 }
          : null,
      };
    });

  res.json({ success: true, items });
});

/** Строка оплаты для оформления чека по осиротевшей оплате. */
interface OrphanPaymentLookupRow {
  id: string;
  studio_id: string;
  initiated_by: string | null;
  payment_resolution: string | null;
  amount: string | number | null;
  command_payload: { orderId?: string; snapshot?: CartSnapshotInput } | null;
  settled_receipt_id: string | null;
}

/**
 * POST /api/pos/payments/:id/create-receipt — оформление чека кассиром по
 * осиротевшей оплате (completed без чека). Body: {items?} (ручной ввод, т.к.
 * snapshot обычно нет; если snapshot есть — берём из него). За флагом
 * POS_ORPHAN_DETECT_ENABLED. Денежно-фискальное действие БЕЗ повторного списания
 * (НЕ зовёт /bridge/pay — деньги уже списаны терминалом).
 *
 * Отдельный endpoint (НЕ resolve): у orphan исходное payment_resolution = NULL
 * (а не in_doubt), поэтому CAS и компенсация работают по NULL. Работающий путь
 * /payments/:id/resolve не трогаем.
 *
 * AuthZ как resolve: admin/manager — любую оплату студии; employee — только свою
 * инициированную (initiated_by).
 */
router.post('/payments/:id/create-receipt', validate(createOrphanReceiptSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const paymentId = req.params['id'];
  if (!paymentId || !UUID_RE.test(paymentId)) throw new AppError(400, 'Некорректный id оплаты');

  if (!config.pos.orphanDetectEnabled) {
    throw new AppError(403, 'Оформление чека по осиротевшей оплате выключено');
  }

  const bodyItems = req.body.items as CartSnapshotInput['items'] | undefined;

  const payment = await db.queryOne<OrphanPaymentLookupRow>(
    `SELECT id, studio_id, initiated_by, payment_resolution, amount, command_payload, settled_receipt_id
       FROM pos_transactions
      WHERE id = $1 AND transaction_type = 'payment' AND status = 'completed'`,
    [paymentId],
  );
  if (!payment) throw new AppError(404, 'Осиротевшая оплата не найдена');

  const canManageAll = req.user.role === 'admin' || req.user.role === 'manager';
  if (!canManageAll && payment.initiated_by !== req.user.id) {
    throw new AppError(403, 'Можно оформлять чек только по своим оплатам');
  }
  if (req.user.studio_id && payment.studio_id !== req.user.studio_id) {
    throw new AppError(403, 'Оплата относится к другой студии');
  }

  // CAS-claim ПЕРВЫМ (P1-гонка против детектора/дабл-клика): атомарно забираем
  // право оформить чек. Исходное orphan-состояние — payment_resolution IS NULL.
  const claimed = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `UPDATE pos_transactions
        SET payment_resolution = 'resolved_paid'
      WHERE id = $1
        AND transaction_type = 'payment'
        AND status = 'completed'
        AND payment_resolution IS NULL
        AND settled_receipt_id IS NULL
      RETURNING id`,
    [paymentId],
  );

  // CAS=0 строк ⇒ оплата уже оформлена/разрешена (гонка/дабл-клик): возвращаем
  // существующий чек, НЕ создаём второй. Сперва settled_receipt_id, затем мягкая
  // связь pos_receipt_payments.transaction_id. Нет чека вовсе → 409.
  if (!claimed) {
    const existingReceiptId = payment.settled_receipt_id
      ?? await findReceiptIdByPaymentTransaction(paymentId);
    if (existingReceiptId) {
      const existing = await getReceiptById(existingReceiptId);
      if (existing) {
        res.json({ success: true, payment_resolution: 'resolved_paid', receipt: existing });
        return;
      }
    }
    throw new AppError(409, 'Чек по этой оплате уже оформляется, обновите список');
  }

  // Идемпотентность ДО createReceipt: чек уже создан (краш после createReceipt до
  // settled_receipt_id, либо конкурентный путь) → достраиваем замок, возвращаем.
  const priorReceiptId = await findReceiptIdByPaymentTransaction(paymentId);
  if (priorReceiptId) {
    const prior = await getReceiptById(priorReceiptId);
    if (prior) {
      await db.query(
        `UPDATE pos_transactions SET settled_receipt_id = $2
          WHERE id = $1 AND settled_receipt_id IS NULL`,
        [paymentId, prior.id],
      );
      res.json({ success: true, payment_resolution: 'resolved_paid', receipt: prior });
      return;
    }
  }

  // Компенсация CAS: вернуть оплату в исходное orphan-состояние (NULL), если
  // дальше нельзя создать чек. Маркеры orphan_* НЕ трогаем (P2/nit).
  const revertClaim = async (): Promise<void> => {
    await db.query(
      `UPDATE pos_transactions SET payment_resolution = NULL
        WHERE id = $1 AND transaction_type = 'payment' AND payment_resolution = 'resolved_paid' AND settled_receipt_id IS NULL`,
      [paymentId],
    );
  };

  const snapshot = payment.command_payload?.snapshot;
  const built = buildResolveReceiptItems(snapshot, bodyItems);
  if (!built) {
    await revertClaim();
    throw new AppError(400, 'Нет сохранённых позиций корзины — введите позиции для создания чека');
  }

  const amount = roundReceiptMoney(Number(payment.amount) || 0);
  if (amount <= 0) {
    await revertClaim();
    throw new AppError(400, 'Сумма оплаты должна быть положительной');
  }

  // P1 (54-ФЗ): фискальный чек ATOL обязан отражать ровно списанную сумму. Серверно
  // сверяем сумму позиций (subtotal − discount_total, всё пересчитано в
  // buildResolveReceiptItems из unit_price*quantity, не доверяя total с фронта) с
  // реальным списанием amount (из pos_transactions, не из тела). Расхождение → 400.
  const itemsTotal = roundReceiptMoney(built.subtotal - built.discountTotal);
  if (Math.abs(itemsTotal - amount) > 0.01) {
    await revertClaim();
    throw new AppError(400, `Сумма позиций (${itemsTotal} ₽) не совпадает со списанием ${amount} ₽`);
  }

  const shiftId = await resolveOrphanReceiptShiftId(snapshot?.shiftId ?? null, payment.studio_id, revertClaim);

  // Гейт ФР-смены (карта требует открытой смены ФР). Компенсируем CAS перед 400.
  try {
    await assertFiscalShiftForRequiredPayments([{ payment_type: 'card' }], shiftId, true);
  } catch (err) {
    await revertClaim();
    throw err;
  }

  let receipt: PosReceipt;
  try {
    receipt = await createReceipt({
      shift_id: shiftId,
      employee_id: req.user.id,
      studio_id: payment.studio_id,
      customer_phone: snapshot?.customerPhone,
      loyalty_profile_id: snapshot?.loyaltyProfileId,
      items: built.items,
      subtotal: built.subtotal,
      discount_total: built.discountTotal,
      total: amount,
      promo_code: snapshot?.promoCode ?? null,
      payments: [{ payment_type: 'card', amount, transaction_id: paymentId }],
    });
  } catch (err) {
    await revertClaim();
    throw err;
  }

  // Замок «один чек на оплату»: связываем чек ТОЛЬКО если settled_receipt_id пуст.
  // Фискализацию запускаем при успешной привязке (вернулась строка).
  const linked = await db.queryOne<Pick<PosTransactions, 'id'>>(
    `UPDATE pos_transactions SET settled_receipt_id = $2
      WHERE id = $1 AND settled_receipt_id IS NULL
     RETURNING id`,
    [paymentId, receipt.id],
  );

  let fiscalized = false;
  if (linked) {
    const fiscalPayments = receipt.payments ?? [{ payment_type: 'card', amount }];
    const fiscalShiftId = receipt.shift_id ?? shiftId ?? null;
    fiscalized = await shouldFiscalizeReceipt(receipt.id, fiscalShiftId, fiscalPayments);
    if (fiscalized) {
      enqueueFiscal({
        receiptId: receipt.id,
        receiptNumber: receipt.receipt_number,
        items: receipt.items || built.items,
        total: receipt.total,
        payments: fiscalPayments,
        operation: 'sale',
      }).catch((err: unknown) => logger.error('[pos] create-receipt fiscal enqueue:', { detail: toErrorMessage(err) }));
    }
  }

  logAudit({
    userId: req.user.id,
    userName: req.user.display_name || '',
    action: 'pos:orphan_receipt_created',
    entityType: 'pos_transaction',
    entityId: paymentId,
    details: { receipt_id: receipt.id, receipt_number: receipt.receipt_number, total: receipt.total, fiscalized },
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  });

  const response: { success: true; payment_resolution: 'resolved_paid'; receipt: PosReceipt; fiscalized: boolean; fiscalWarning?: string } = {
    success: true,
    payment_resolution: 'resolved_paid',
    receipt,
    fiscalized,
  };
  if (linked && !fiscalized) {
    response.fiscalWarning = 'Чек создан, но не фискализирован: смена ФР закрыта. Откройте смену ФР и добейте фискализацию.';
  }
  res.status(201).json(response);
});

/** Строка сверки смены для UI. */
interface ShiftReconciliationRow {
  id: string;
  shift_id: string;
  studio_id: string;
  cash_card_sum: string | null;
  terminal_card_sum: string | null;
  terminal_qr_sum: string | null;
  terminal_total_sum: string | null;
  diff_card: string | null;
  diff_total: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Смена для проверки прав чтения сверки. */
interface ShiftScopeRow {
  id: string;
  employee_id: string | null;
}

/**
 * GET /api/pos/shifts/:id/reconciliation — чтение pos_shift_reconciliation для UI.
 *
 * AuthZ: admin/manager — любая смена; остальные — только своя (employee_id),
 * как у /shifts/:id/report. reconciliation может отсутствовать (смена ещё не
 * закрывалась или дедуп) → возвращаем null.
 */
router.get('/shifts/:id/reconciliation', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const shiftId = req.params['id'];
  if (!shiftId || !UUID_RE.test(shiftId)) throw new AppError(400, 'Некорректный id смены');

  const shift = await db.queryOne<ShiftScopeRow>(
    `SELECT id, employee_id FROM pos_shifts WHERE id = $1`,
    [shiftId],
  );
  if (!shift) throw new AppError(404, 'Смена не найдена');

  const canViewOther = req.user.role === 'admin' || req.user.role === 'manager';
  if (shift.employee_id !== req.user.id && !canViewOther) {
    throw new AppError(403, 'Можно просматривать только свою кассовую смену');
  }

  const row = await db.queryOne<ShiftReconciliationRow>(
    `SELECT id, shift_id, studio_id, cash_card_sum,
            terminal_card_sum, terminal_qr_sum, terminal_total_sum,
            diff_card, diff_total, status, notes, created_at, updated_at
     FROM pos_shift_reconciliation
     WHERE shift_id = $1`,
    [shiftId],
  );

  res.json({ success: true, reconciliation: row ?? null });
});

// ─── SERVICE WORK TIMER ───────────────────────────────

router.post('/service/start-timer', validate(startTimerSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  // employee_id всегда из токена — нельзя запустить таймер от имени другого сотрудника
  const { studio_id, order_description, is_custom_order,
    custom_surcharge, custom_surcharge_reason, hourly_rate } = req.body;
  const log = await startServiceTimer({
    employee_id: req.user.id,
    studio_id, order_description, is_custom_order,
    custom_surcharge, custom_surcharge_reason, hourly_rate,
  });
  res.status(201).json({ success: true, log });
});

router.post('/service/stop-timer', validate(stopTimerSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { work_log_id } = req.body;
  const log = await stopServiceTimer(work_log_id, req.user.id);
  res.json({ success: true, log });
});

router.get('/service/active-timer', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const log = await getActiveTimer(req.user.id);
  res.json({ success: true, log });
});

router.post('/service/custom-surcharge', validate(customSurchargeSchema), async (req: AuthRequest, res: Response) => {
  const { work_log_id, amount, reason } = req.body;
  const log = await addCustomSurcharge(work_log_id, amount, reason);
  res.json({ success: true, log });
});

// ─── MATERIALS ────────────────────────────────────────

router.post('/materials/usage', validate(recordMaterialUsageSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { receipt_id, work_log_id, product_id, quantity, unit, studio_id, notes } = req.body;
  await recordMaterialUsage({ receipt_id, work_log_id, product_id, quantity, unit, studio_id, employee_id: req.user.id, notes });
  res.status(201).json({ success: true });
});

router.get('/materials/report/:studioId', async (req: Request, res: Response) => {
  const { date_from, date_to } = req.query;
  const report = await getMaterialUsageReport(
    req.params['studioId'],
    date_from as string | undefined,
    date_to as string | undefined
  );
  res.json({ success: true, report });
});

router.get('/materials/low-stock/:studioId', async (req: Request, res: Response) => {
  const items = await getLowStock(req.params['studioId']);
  res.json({ success: true, items });
});

// ─── EMPLOYEE FAVORITES (F62) ────────────────────────

router.get('/favorites', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const rows = await db.query<EmployeeFavoriteRow>(
    `SELECT ef.id, ef.service_option_id, so.name, so.base_price, so.icon, so.slug,
            og.name AS category_name, ef.created_at
     FROM employee_favorites ef
     JOIN service_options so ON so.id = ef.service_option_id
     JOIN option_groups og ON og.id = so.option_group_id
     WHERE ef.employee_id = $1
     ORDER BY ef.created_at DESC`,
    [req.user.id],
  );
  res.json({ success: true, items: rows });
});

router.post('/favorites/:optionId', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  await db.query(
    `INSERT INTO employee_favorites (employee_id, service_option_id)
     VALUES ($1, $2)
     ON CONFLICT (employee_id, service_option_id) DO NOTHING`,
    [req.user.id, req.params['optionId']],
  );
  res.status(201).json({ success: true });
});

router.delete('/favorites/:optionId', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  await db.query(
    `DELETE FROM employee_favorites WHERE employee_id = $1 AND service_option_id = $2`,
    [req.user.id, req.params['optionId']],
  );
  res.json({ success: true });
});


// ─── SALES & COMMISSION ENDPOINTS ────────────────────

/** GET /api/pos/sales/daily — daily commission summary */
router.get('/sales/daily', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const date = (req.query['date'] as string) || new Date().toISOString().split('T')[0];
  const rows = await db.query<DailySalesSourceRow>(
    `SELECT source, COUNT(*)::int cnt, COALESCE(SUM(receipt_total),0) total,
            COALESCE(SUM(commission_amount),0) commission
     FROM employee_sales WHERE employee_id=$1 AND created_at::date=$2::date GROUP BY source`,
    [req.user.id, date]);
  const bySource: Record<string, { count: number; total: number; commission: number }> = {};
  let totalSales = 0, totalCommission = 0, totalCount = 0;
  for (const r of rows) {
    const c = parseInt(r.cnt, 10), t = parseFloat(r.total), cm = parseFloat(r.commission);
    bySource[r.source] = { count: c, total: t, commission: cm };
    totalSales += t; totalCommission += cm; totalCount += c;
  }
  res.json({ success: true, date, totalSales, totalCommission, totalCount, bySource });
});

/** GET /api/pos/sales/shift/:shiftId — commission details per shift */
router.get('/sales/shift/:shiftId', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { shiftId } = req.params;
  const sales = await db.query<EmployeeSaleRow>(
    `SELECT id, receipt_id, receipt_total, commission_rate,
            commission_amount, category_slug, source, created_at
     FROM employee_sales WHERE shift_id=$1 ORDER BY created_at DESC`,
    [shiftId]);
  const agg = await db.queryOne<SalesAggregateRow>(
    `SELECT COALESCE(SUM(receipt_total),0) st, COALESCE(SUM(commission_amount),0) ct, COUNT(*)::int rc
     FROM employee_sales WHERE shift_id=$1`, [shiftId]);
  res.json({
    success: true, shiftId,
    sales_total: parseFloat(agg?.st ?? '0'),
    commission_total: parseFloat(agg?.ct ?? '0'),
    receipts_count: parseInt(agg?.rc ?? '0', 10),
    sales,
  });
});

/** GET /api/pos/sales/admin/overview — admin overview all employees */
router.get('/sales/admin/overview', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    throw new AppError(403, 'Только для администраторов');
  }
  const period = (req.query['period'] as string) || new Date().toISOString().slice(0, 7);
  const rows = await db.query<AdminSalesOverviewRow>(
    `SELECT es.employee_id, u.display_name, u.photo_url,
            COUNT(*)::int cnt, COALESCE(SUM(es.receipt_total),0) total,
            COALESCE(SUM(es.commission_amount),0) commission
     FROM employee_sales es JOIN users u ON u.id=es.employee_id
     WHERE to_char(es.created_at,'YYYY-MM')=$1
     GROUP BY es.employee_id, u.display_name, u.photo_url ORDER BY total DESC`,
    [period]);
  const employees = rows.map((r, i) => ({
    employee_id: r.employee_id, display_name: r.display_name, photo_url: r.photo_url,
    receipts_count: parseInt(r.cnt, 10), total_sales: parseFloat(r.total),
    total_commission: parseFloat(r.commission), rank: i + 1,
  }));
  res.json({ success: true, period, employees });
});
export default router;
