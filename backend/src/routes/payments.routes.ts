import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { config } from '../config/index.js';
import db, { pool } from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { validate } from '../middleware/validate.js';
import { authenticateToken, optionalAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { checkWebhookSchema, payWebhookSchema, confirmWebhookSchema } from '../schemas/payments.schema.js';
import {
  sbpPaymentSchema, sbpQrSchema, createPaymentLinkSchema,
  createPaymentOrderSchema, confirmFromWidgetSchema, confirmSubscriptionFromWidgetSchema,
  updateTipSchema, quickSaleSchema,
  listPaymentLinksSchema, createOrderFromPaymentLinkSchema, resendPaymentLinkSchema,
  updatePaymentLinkSchema, cancelPaymentLinkSchema, manualChatPaymentSchema,
} from '../schemas/payments-routes.schema.js';
import { secureRandomString } from '../utils/secure-random.js';
import { findOrCreateCustomer } from '../services/customer.service.js';
import { createTaskFromOrder } from '../services/task-auto.service.js';
import { sendVisitorChatPush } from '../services/visitor-push.service.js';
import { validatePartnerPromoCode, recordReferral } from '../services/partners.service.js';
import { NotificationService } from '../services/notification.service.js';
import {
  activateOrRenewSubscriptionPayment,
  cancelSubscription,
  restoreCreditsForPrintOrderWithClient,
  storeVerifiedCard,
  refundVerification,
} from '../services/subscription.service.js';
import { scheduleReviewRequest } from '../services/review-request.service.js';
import { buildWidgetPaymentButton } from './chat/chat-pricing.helpers.js';
import type { BotButton } from './chat/chat-shared.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { withWebhookIdempotency } from '../services/webhook-idempotency.service.js';
import { enqueuePostPaymentJobs, type OrderPaymentData } from '../services/post-payment-queue.service.js';
import { notifyChatOrderFailedService } from '../services/payment.service.js';
import { recordBusinessEvent } from '../services/business-observability.service.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import type { OrderPaymentUpdateRow, PhotoPrintOrder, PhotoPrintOrderPaymentRow } from '../types/views/print-order-views.js';
import type PhotoPrintOrders from '../types/generated/public/PhotoPrintOrders.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { idempotent } from '../middleware/idempotency.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import { enqueueOutbound } from '../services/connectors/pipeline/outbound-worker.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type Messages from '../types/generated/public/Messages.js';
import {
  paymentLinksCreatedTotal,
  paymentLinksPaidTotal,
  paymentLinksExpiredTotal,
  paymentLinksLinkedToOrderTotal,
  paymentLinksResentTotal,
  paymentLinksBlockedByFlagTotal,
  cardChangeIgnoredCancelledTotal,
} from '../services/metrics.service.js';
import type {
  PaymentLinkCheckRow,
  PaymentLinkDedupRow,
  PaymentLinkInsertRow,
  PaymentLinkMutationRow,
  PaymentLinkPayRow,
  PaymentLinkStatusRow,
  PaymentLinkTipRow,
  PaymentLinkExpireRow,
  PaymentLinkListRow,
  PaymentLinkDetailRow,
  PaymentLinkCreateOrderRow,
  PaymentLinkResendRow,
  PaymentLinkLegacyOrderRow,
} from '../types/views/payment-link-views.js';
import type {
  PaymentLinkCartDetailsJson,
  PaymentLinkCartDisplayLineJson,
  PaymentLinkCreateServiceJson,
  PaymentLinkMetadataJson,
  PaymentLinkServiceJson,
} from '../types/jsonb/payment-link-tip-jsonb.js';
import type { ChatCartItemMetadataJson } from '../types/jsonb/chat-cart-jsonb.js';
import type { AppOrderPaymentItemJson, AppOrderPaymentMetadataJson } from '../types/jsonb/app-order-payment-jsonb.js';
import type {
  AppOrderPaymentRow,
  AbandonedPaymentOrderRow,
  ConversationVisitorRow,
  ConversationAttributionRow,
  NotificationUserRow,
  PaymentIdRow,
  PaymentUserContactRow,
  SubscriptionPaymentCheckRow,
  SubscriptionOwnerRow,
  SubscriptionWidgetConfirmRow,
  PrintPaymentStatusRow,
  FiscalReceiptOrderLookupRow,
  UserPhoneRow,
  WorkTaskPaymentSourceRow,
  ManualChatPaymentConversationRow,
} from '../types/views/payment-route-views.js';
import {
  MINIMUM_CHECK_TOTAL,
  calculatePriceWaterfall,
  getVolumeThresholdHints,
  minimumCheckSurchargeForTotal,
  minimumCheckSurchargeFromWaterfall,
  type PriceWaterfallResult,
} from '../services/pricing-engine.service.js';
import { recordSale as recordEmployeeSale } from '../services/employee-sales.service.js';
import {
  recordStudentIdPhotoPromoForReceiptWithClient,
  restoreStudentIdPhotoPromoForPaymentLinkWithClient,
} from '../services/student-id-photo-promo.service.js';
import {
  ensureOnlineEmployeeShift,
  refreshEmployeeShiftSalesCache,
  requireActiveEmployeeShiftForPaymentLink,
} from '../services/virtual-shift.service.js';
import {
  resolveCustomerPricingPhone,
  type CustomerPricingPhoneSource,
} from '../services/customer-pricing-phone.service.js';
import type { ActiveShiftLookup, ShiftEarningsAggregation, TaskOwnerLookup } from '../types/views/earnings-views.js';
import { logAndEmit } from '../websocket/log-and-emit.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import type { Server as SocketIOServer } from 'socket.io';

const log = createLogger('payments');

const router = Router();

const SUPPORT_TEAM_ITEM_ID = 'support-team';
const SUPPORT_TEAM_ITEM_NAME = 'Поддержать команду «Своё Фото»';
const SUPPORT_TEAM_BASE_METADATA_KEY = 'supportTeamBaseAmount';
const SUPPORT_TEAM_TIP_METADATA_KEY = 'supportTeamTipAmount';

function isStaffRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'employee' || role === 'photographer';
}

function deliveryProviderFromOrder(order: object): string | null {
  const value: unknown = Reflect.get(order, 'delivery_provider');
  return typeof value === 'string' && value ? value : null;
}

interface BroadcastableMessage extends Messages {
  readonly [key: string]: unknown;
}

// Card-change (смена карты рекуррента) — проекции для вебхуков /check и /recurrent.
interface CardChangeCheckRow {
  id: string;
  status: string;
  expected_amount: string;
}

interface CardChangeRecurrentSubscriptionRow {
  id: string;
  status: string;
  card_change_in_progress: boolean;
  cloudpayments_subscription_id: string | null;
}

/**
 * Чистое решение anti-tamper для /check SUBCC-ветки (1₽-верификация смены карты).
 * Вынесено из роута для тестируемости (HMAC-middleware недостижим в route-тестах).
 * code:10 — нет операции; code:13 — статус не awaiting_token или сумма невалидна (NaN);
 * code:12 — сумма ≠ ожидаемой (1₽); code:0 — принять.
 */
export function decideCardChangeCheckCode(
  change: CardChangeCheckRow | null,
  numericAmount: number,
): { code: number; reason: string } {
  if (!change) {
    return { code: 10, reason: 'not_found' };
  }
  if (change.status !== 'awaiting_token') {
    return { code: 13, reason: 'wrong_status' };
  }
  // Без валидной суммы НЕ принимаем (иначе NaN проскакивает mismatch-проверку → ложный code 0).
  if (isNaN(numericAmount)) {
    return { code: 13, reason: 'invalid_amount' };
  }
  const expectedVerifyAmount = parseFloat(change.expected_amount);
  if (!isNaN(expectedVerifyAmount) && Math.abs(expectedVerifyAmount - numericAmount) > 0.01) {
    return { code: 12, reason: 'amount_mismatch' };
  }
  return { code: 0, reason: 'ok' };
}

/**
 * Чистый guard от гонки смены карты для /recurrent case Cancelled.
 * При отмене СТАРОГО рекуррента CP шлёт Cancelled с Id=OLD; lookup матчит запись по AccountId →
 * подписку НЕ отменяем, если идёт смена карты ИЛИ Id ≠ текущему (новому) cp_subscription_id.
 * Только для Status='Cancelled' (Rejected — легитимная остановка банком, гасит подписку).
 */
export function decideCardChangeCancelGuard(
  status: string,
  webhookCpId: string,
  sub: Pick<CardChangeRecurrentSubscriptionRow, 'card_change_in_progress' | 'cloudpayments_subscription_id'>,
): { ignore: boolean; reason: 'in_progress' | 'id_mismatch' | null } {
  if (status !== 'Cancelled') {
    return { ignore: false, reason: null };
  }
  if (sub.card_change_in_progress) {
    return { ignore: true, reason: 'in_progress' };
  }
  if (webhookCpId !== sub.cloudpayments_subscription_id) {
    return { ignore: true, reason: 'id_mismatch' };
  }
  return { ignore: false, reason: null };
}

interface OperatorChatSocketPayloadExtra {
  readonly [key: string]: unknown;
}

interface OperatorChatSocketPayload extends OperatorChatSocketPayloadExtra {
  id: string;
  sessionId: string;
  content: string;
  senderName: string | null;
  senderType: string;
  sender_name: string | null;
  sender_type: string;
  messageType: string;
  message_type: string;
  metadata: Messages['metadata'];
  timestamp: string;
}

function isPaymentLinkJsonObject(value: unknown): value is PaymentLinkMetadataJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppOrderPaymentMetadataJson(value: unknown): value is AppOrderPaymentMetadataJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppOrderPaymentItemJson(value: unknown): value is AppOrderPaymentItemJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPaymentLinkCreateServiceJson(value: unknown): value is PaymentLinkCreateServiceJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function numberFromUnknown(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function textFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueText(values: Iterable<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = textFromUnknown(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function combinedPriceNote(values: Iterable<string | null | undefined>): string | null {
  const notes = uniqueText(values);
  return notes.length > 0 ? notes.join('; ') : null;
}

function paymentLinkPrintFillPercent(item: PaymentLinkCreateServiceJson): number | undefined {
  const value = item['printFillPercent'] ?? item['print_fill_percent'] ?? item['fill_percent'] ?? item['coverage_percent'];
  const numeric = numberFromUnknown(value);
  return numeric === null ? undefined : numeric;
}

function parsePaymentLinkMetadata(value: unknown): PaymentLinkMetadataJson {
  const parsed = parseJsonValue(value);
  return isPaymentLinkJsonObject(parsed) ? { ...parsed } : {};
}

function parseAppOrderPaymentMetadata(value: unknown): AppOrderPaymentMetadataJson {
  const parsed = parseJsonValue(value);
  return isAppOrderPaymentMetadataJson(parsed) ? { ...parsed } : {};
}

function normalizePaymentLinkServices(value: unknown): PaymentLinkServiceJson[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isPaymentLinkJsonObject).map((item) => {
    const name = typeof item.name === 'string'
      ? item.name
      : (typeof item.service === 'string' ? item.service : 'Услуга');
    const price = numberFromUnknown(item.price) ?? numberFromUnknown(item.subtotal) ?? 0;
    const quantity = Math.max(1, Math.trunc(numberFromUnknown(item.quantity) ?? 1));
    return { ...item, name, price, quantity };
  });
}

function normalizePaymentLinkCartLine(value: unknown): PaymentLinkCartDisplayLineJson | null {
  if (!isPaymentLinkJsonObject(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;

  const quantity = Math.max(1, Math.trunc(numberFromUnknown(value.quantity) ?? 1));
  const unitPrice = numberFromUnknown(value.unitPrice) ?? 0;
  const total = numberFromUnknown(value.total) ?? unitPrice * quantity;
  const priceNote = textFromUnknown(value.priceNote);
  const discountLabel = textFromUnknown(value.discountLabel);
  const discountAmount = Math.max(0, numberFromUnknown(value.discountAmount) ?? 0);

  return {
    name,
    quantity,
    unitPrice,
    total,
    priceNote,
    discountLabel,
    discountAmount,
  };
}

function normalizePaymentLinkCartDetails(value: unknown): PaymentLinkCartDetailsJson | null {
  const parsed = parseJsonValue(value);
  if (!isPaymentLinkJsonObject(parsed) || !Array.isArray(parsed.lines)) return null;

  const lines = parsed.lines
    .map(normalizePaymentLinkCartLine)
    .filter((line): line is PaymentLinkCartDisplayLineJson => line !== null);
  if (lines.length === 0) return null;

  const priceNote = textFromUnknown(parsed.priceNote)
    ?? combinedPriceNote(lines.map(line => line.priceNote ?? null));

  return {
    lines,
    subtotal: numberFromUnknown(parsed.subtotal) ?? lines.reduce((sum, line) => sum + line.total, 0),
    savings: numberFromUnknown(parsed.savings) ?? lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0),
    priceNote,
  };
}

function formatRubles(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')}\u20BD`;
}

function paymentCartPriceNote(details: PaymentLinkCartDetailsJson | null): string | null {
  if (!details) return null;
  return details.priceNote ?? combinedPriceNote(details.lines.map(line => line.priceNote ?? null));
}

function formatPaymentCartSummary(details: PaymentLinkCartDetailsJson | null): string {
  if (!details) return '';

  const priceNote = paymentCartPriceNote(details);
  const lines = details.lines.slice(0, 5).map((line) => {
    const notes = [line.discountLabel].filter((note): note is string => !!note);
    const composition = notes.length > 0
      ? `${line.quantity} × ${formatRubles(line.unitPrice)}; ${notes.join('; ')}`
      : `${line.quantity} × ${formatRubles(line.unitPrice)}`;
    return `• ${line.name}: ${composition} — ${formatRubles(line.total)}`;
  });

  if (priceNote) {
    lines.push(`Пояснение: ${priceNote}`);
  }

  if ((details.savings ?? 0) > 0) {
    lines.push(`Скидка в заказе: −${formatRubles(details.savings ?? 0)}`);
  }
  return lines.join('\n');
}

/**
 * Состав чека для карточки оплаты в чате. Фронт (chat-detail) рисует каждую
 * позицию строкой `name — price₽` из `metadata.payment.items`.
 */
function paymentCardItemsFromCart(
  details: PaymentLinkCartDetailsJson | null,
): { name: string; price: number }[] {
  if (!details) return [];
  return details.lines.map((line) => ({
    name: line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name,
    price: Math.round(line.total),
  }));
}

function buildPaymentChatContent(total: number, details: PaymentLinkCartDetailsJson | null): string {
  const summary = formatPaymentCartSummary(details);
  const heading = `\u{1F4B3} К оплате: ${formatRubles(total)}`;
  return summary ? `${heading}\n${summary}` : heading;
}

function buildOperatorChatSocketPayload(
  sessionId: string,
  message: BroadcastableMessage,
  extra: OperatorChatSocketPayloadExtra = {},
): OperatorChatSocketPayload {
  const messageType = message.message_type || 'text';
  return {
    ...extra,
    id: message.id,
    sessionId,
    content: message.content,
    senderName: message.sender_name,
    senderType: message.sender_type,
    sender_name: message.sender_name,
    sender_type: message.sender_type,
    messageType,
    message_type: messageType,
    metadata: message.metadata,
    timestamp: message.created_at || new Date().toISOString(),
  };
}

function buildPaymentOutboundContent(
  total: number,
  orderId: string,
  details: PaymentLinkCartDetailsJson | null,
  fallbackDescription: string | null | undefined,
): string {
  const lines = [`\u{1F4B3} К оплате: ${formatRubles(total)}`];
  const priceNote = paymentCartPriceNote(details);
  const fallback = fallbackDescription?.trim();
  if (priceNote) {
    lines.push(priceNote);
  } else if (fallback) {
    lines.push(fallback);
  }
  lines.push(`https://svoefoto.ru/pay/${orderId}`);
  return lines.join('\n');
}

interface PaymentLinkPricingRecalcResult {
  total: number;
  cartDetails: PaymentLinkCartDetailsJson | null;
  /** Акция «Фото на студенческий 4×200», если применилась к счёту — списывается при оплате ссылки. */
  studentIdPhotoPromo: PriceWaterfallResult['studentIdPhotoPromoConsumed'];
}

interface PaymentLinkSupersedeClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface PaymentLinkSupersedeParams {
  conversationId: string;
  employeeShiftId: string;
  newPaymentLinkId: string;
  newOrderRef: string;
}

interface SupersededPaymentLinkRow {
  id: string;
  order_ref: string;
}

export async function supersedePendingPaymentLinksForConversation(
  client: PaymentLinkSupersedeClient,
  params: PaymentLinkSupersedeParams,
): Promise<SupersededPaymentLinkRow[]> {
  const result = await client.query<SupersededPaymentLinkRow>(
    `UPDATE payment_links
        SET status = 'cancelled',
            expires_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'cancelledReason', 'superseded_by_new_payment_link',
              'cancelledAt', NOW(),
              'supersededByPaymentLinkId', $3::uuid::text,
              'supersededByOrderRef', $4::text
            ),
            updated_at = NOW()
      WHERE conversation_id = $1
        AND employee_shift_id = $2
        AND id <> $3::uuid
        AND status = 'pending'
      RETURNING id, order_ref`,
    [params.conversationId, params.employeeShiftId, params.newPaymentLinkId, params.newOrderRef],
  );
  return result.rows;
}

function buildPaymentLinkCartDetailsFromWaterfall(
  sourceServices: readonly PaymentLinkCreateServiceJson[],
  manualServices: readonly PaymentLinkCreateServiceJson[],
  wfResult: PriceWaterfallResult,
  minimumCheckSurcharge = minimumCheckSurchargeFromWaterfall(wfResult.waterfall),
): PaymentLinkCartDetailsJson | null {
  const lines: PaymentLinkCartDisplayLineJson[] = wfResult.items.map((item, index) => {
    const source = sourceServices[index];
    return {
      name: source ? paymentLinkServiceName(source) : item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.finalPrice,
      priceNote: item.priceAdjustmentNotice ?? item.priceAdjustmentLabel,
      discountLabel: item.discountLabel,
      discountAmount: item.discountAmount,
    };
  });

  if (minimumCheckSurcharge > 0) {
    lines.push({
      name: 'Минимальный чек',
      quantity: 1,
      unitPrice: minimumCheckSurcharge,
      total: minimumCheckSurcharge,
      priceNote: `Минимальный чек ${MINIMUM_CHECK_TOTAL}₽`,
      discountLabel: null,
      discountAmount: 0,
    });
  }

  for (const service of manualServices) {
    const quantity = Math.max(1, Math.trunc(numberFromUnknown(service.quantity) ?? 1));
    const unitPrice = numberFromUnknown(service.price) ?? numberFromUnknown(service.subtotal) ?? 0;
    lines.push({
      name: paymentLinkServiceName(service),
      quantity,
      unitPrice,
      total: unitPrice * quantity,
      priceNote: null,
      discountLabel: null,
      discountAmount: 0,
    });
  }

  if (lines.length === 0) return null;
  const priceNote = combinedPriceNote(lines.map(line => line.priceNote ?? null));
  const engineMinimumSurcharge = minimumCheckSurchargeFromWaterfall(wfResult.waterfall);
  const waterfallTotalBeforeMinimum = Math.max(0, Math.round((wfResult.total - engineMinimumSurcharge) * 100) / 100);
  const waterfallSavingsBeforeMinimum = wfResult.items.reduce((sum, item) => sum + item.discountAmount, 0)
    + (wfResult.subtotal - waterfallTotalBeforeMinimum);
  const savings = Math.max(0, Math.round((waterfallSavingsBeforeMinimum - minimumCheckSurcharge) * 100) / 100);
  return {
    lines,
    subtotal: lines.reduce((sum, line) => sum + line.total, 0),
    savings,
    priceNote,
  };
}

function buildPaymentLinkCartDetailsFromServices(
  services: readonly PaymentLinkServiceJson[],
): PaymentLinkCartDetailsJson | null {
  const lines = services
    .filter(item => !isSupportTeamItem(item))
    .map((service): PaymentLinkCartDisplayLineJson => {
      const quantity = Math.max(1, Math.trunc(numberFromUnknown(service.quantity) ?? 1));
      const unitPrice = numberFromUnknown(service.price) ?? numberFromUnknown(service.subtotal) ?? 0;
      const total = numberFromUnknown(service.subtotal) ?? unitPrice * quantity;
      return {
        name: paymentLinkServiceName(service),
        quantity,
        unitPrice,
        total,
        priceNote: paymentLinkServicePriceNote(service),
        discountLabel: textFromUnknown(service['discountLabel']),
        discountAmount: Math.max(0, numberFromUnknown(service['discountAmount']) ?? 0),
      };
    });

  if (lines.length === 0) return null;
  return {
    lines,
    subtotal: lines.reduce((sum, line) => sum + line.total, 0),
    savings: lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0),
    priceNote: combinedPriceNote(lines.map(line => line.priceNote ?? null)),
  };
}

async function calculatePaymentLinkPricing(
  amount: number,
  services: unknown,
  customer: CustomerPricingPhoneSource,
  promoCode: string | undefined,
  logContext: string,
): Promise<PaymentLinkPricingRecalcResult> {
  let total = Number(amount);
  let cartDetails: PaymentLinkCartDetailsJson | null = null;
  let studentIdPhotoPromo: PriceWaterfallResult['studentIdPhotoPromoConsumed'] = null;
  if (!Array.isArray(services) || services.length === 0) return { total, cartDetails, studentIdPhotoPromo };

  const typedServices = services.filter(isPaymentLinkCreateServiceJson);
  const sourceServices = typedServices.filter(s => s.id && s.id !== 'manual' && s.id !== SUPPORT_TEAM_ITEM_ID);
  const manualServices = typedServices.filter(s => !s.id || s.id === 'manual' || s.id === SUPPORT_TEAM_ITEM_ID);
  const waterfallItems = sourceServices
    .map(s => {
      const printFillPercent = paymentLinkPrintFillPercent(s);
      return {
        serviceOptionId: s.id || '',
        quantity: Number(s.quantity) || 1,
        pricingGroupKey: typeof s.pricingGroupKey === 'string' ? s.pricingGroupKey : undefined,
        ...(printFillPercent !== undefined ? { printFillPercent } : {}),
      };
    });

  if (waterfallItems.length === 0) return { total, cartDetails, studentIdPhotoPromo };

  try {
    const customerPhone = await resolveCustomerPricingPhone(customer);
    const wfResult = await calculatePriceWaterfall({
      items: waterfallItems,
      customerPhone: customerPhone ?? undefined,
      channel: 'crm',
      promoCode: promoCode?.trim() || undefined,
    });

    const manualSum = manualServices
      .reduce((sum, s) => sum + (Number(s.price) || 0) * (Number(s.quantity) || 1), 0);

    const engineMinimumSurcharge = minimumCheckSurchargeFromWaterfall(wfResult.waterfall);
    const waterfallTotalBeforeMinimum = Math.max(0, Math.round((wfResult.total - engineMinimumSurcharge) * 100) / 100);
    const totalBeforeMinimum = waterfallTotalBeforeMinimum + manualSum;
    const minimumCheckSurcharge = minimumCheckSurchargeForTotal(totalBeforeMinimum);
    const serverTotal = Math.round((totalBeforeMinimum + minimumCheckSurcharge) * 100) / 100;
    if (Math.abs(serverTotal - total) > 0.01) {
      log.warn(`[Payments] ${logContext} price mismatch — using server-calculated total`, {
        clientTotal: total,
        serverTotal,
        waterfallTotal: wfResult.total,
        manualTotal: manualSum,
        savings: wfResult.savings,
      });
    }
    total = serverTotal;
    cartDetails = buildPaymentLinkCartDetailsFromWaterfall(sourceServices, manualServices, wfResult, minimumCheckSurcharge);
    studentIdPhotoPromo = wfResult.studentIdPhotoPromoConsumed ?? null;
  } catch (err) {
    log.warn(`[Payments] Waterfall recalculate failed for ${logContext}, using client amount`, { error: String(err) });
  }

  return { total, cartDetails, studentIdPhotoPromo };
}

function paymentLinkServiceName(item: PaymentLinkCreateServiceJson): string {
  const rawName = item.name;
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim();
  if (typeof item.service === 'string' && item.service.trim()) return item.service.trim();
  return 'Услуга';
}

function toPaymentLinkServiceItem(item: PaymentLinkCreateServiceJson): PaymentLinkServiceJson {
  const price = numberFromUnknown(item.price) ?? numberFromUnknown(item.subtotal) ?? 0;
  const subtotal = numberFromUnknown(item.subtotal);
  const quantity = Math.max(1, Math.trunc(numberFromUnknown(item.quantity) ?? 1));
  const { price: _rawPrice, subtotal: _rawSubtotal, quantity: _rawQuantity, ...rest } = item;
  return {
    ...rest,
    name: paymentLinkServiceName(item),
    price,
    ...(subtotal !== null ? { subtotal } : {}),
    quantity,
  };
}

function buildPaymentLinkServiceItems(
  services: unknown,
  total: number,
  description: string | undefined,
): PaymentLinkServiceJson[] {
  const serviceItems = Array.isArray(services)
    ? services.filter(isPaymentLinkCreateServiceJson).map(toPaymentLinkServiceItem)
    : [];

  if (serviceItems.length === 0) {
    return [{ name: description || `Оплата ${total}\u20BD`, price: total, quantity: 1 }];
  }

  const servicesSum = serviceItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const diff = total - servicesSum;
  if (diff > 0.01) {
    return [
      ...serviceItems,
      { id: 'manual', name: description || 'Дополнительно', price: Math.round(diff * 100) / 100, quantity: 1 },
    ];
  }

  if (diff < -0.01 && servicesSum > 0) {
    const ratio = total / servicesSum;
    const scaled = serviceItems.map(item => ({
      ...item,
      price: Math.round(item.price * ratio * 100) / 100,
    }));
    const adjustedSum = scaled.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const roundingDiff = total - adjustedSum;
    if (Math.abs(roundingDiff) > 0.001 && scaled.length > 0) {
      const last = scaled[scaled.length - 1];
      scaled[scaled.length - 1] = {
        ...last,
        price: Math.round((last.price + roundingDiff / last.quantity) * 100) / 100,
      };
    }
    return scaled;
  }

  return serviceItems;
}

function buildPaymentLinkServiceItemsForStorage(
  services: unknown,
  total: number,
  description: string | undefined,
  cartDetails: PaymentLinkCartDetailsJson | null,
): PaymentLinkServiceJson[] {
  if (!cartDetails) return buildPaymentLinkServiceItems(services, total, description);

  const serviceItems = cartDetails.lines.map((line): PaymentLinkCreateServiceJson => ({
    name: line.name,
    price: line.quantity > 0 ? Math.round((line.total / line.quantity) * 100) / 100 : line.total,
    subtotal: line.total,
    quantity: line.quantity,
    priceNote: line.priceNote ?? null,
    discountLabel: line.discountLabel ?? null,
  }));

  return buildPaymentLinkServiceItems(serviceItems, total, description);
}

function buildPaymentLinkComments(services: unknown, total: number, description: string | undefined): string {
  const trimmed = description?.trim();
  if (trimmed) return trimmed;

  if (Array.isArray(services) && services.length > 0) {
    const names = services
      .filter(isPaymentLinkCreateServiceJson)
      .map(paymentLinkServiceName)
      .filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }

  return `Оплата ${total}\u20BD`;
}

async function sendPaymentLinkInteractiveMessage(
  req: Request,
  conversationId: string,
  orderId: string,
  total: number,
  comments: string,
  cartDetails: PaymentLinkCartDetailsJson | null,
  step: 'operator_payment' | 'operator_payment_update',
): Promise<void> {
  const interactive = {
    type: 'buttons',
    step,
    buttons: [buildWidgetPaymentButton(orderId, total, comments)],
  };
  const content = buildPaymentChatContent(total, cartDetails);

  const chatMessage = await db.queryOne<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [conversationId, content, JSON.stringify({ interactive })],
  );
  if (!chatMessage) throw new Error('Failed to create payment chat message');

  const socketServer = req.app.socketServer;
  if (socketServer) {
    const msgPayload = buildOperatorChatSocketPayload(conversationId, chatMessage, { interactive });
    socketServer.getIO().to(`visitor:${conversationId}`).emit('operator:message', msgPayload);
    await broadcastChatMessage({ sessionId: conversationId, message: chatMessage });
  }

  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [conversationId],
  );
  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content: buildPaymentOutboundContent(total, orderId, cartDetails, comments),
      messageType: 'text',
      conversationId,
    });
  }
}

async function sendPaymentLinkPaidCustomerMessage(
  req: Request,
  link: PaymentLinkPayRow,
  amount: number,
): Promise<void> {
  if (!link.conversation_id) return;

  const content = [
    `\u2705 Оплата ${formatRubles(amount)} получена.`,
    'Спасибо! Мы уже видим платёж, оператор оформит заказ и напишет вам в этом чате.',
  ].join(' ');
  const paidAt = new Date().toISOString();
  const paymentMethod = 'online';
  const items = paymentCardItemsFromCart(
    buildPaymentLinkCartDetailsFromServices(normalizePaymentLinkServices(link.services)),
  );
  const metadata = {
    kind: 'payment_link_paid_customer_confirmation',
    paymentLinkId: link.id,
    orderRef: link.order_ref,
    amount,
    payment: {
      source: 'payment_link',
      status: 'paid',
      method: paymentMethod,
      amount,
      paymentLinkId: link.id,
      orderRef: link.order_ref,
      paidAt,
      items,
    },
  };

  const chatMessage = await db.queryOne<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3::jsonb)
     RETURNING *`,
    [link.conversation_id, content, JSON.stringify(metadata)],
  );
  if (!chatMessage) throw new Error('Failed to create payment confirmation chat message');

  const socketServer = req.app.socketServer;
  if (socketServer) {
    try {
      const msgPayload = buildOperatorChatSocketPayload(link.conversation_id, chatMessage);
      socketServer.getIO().to(`visitor:${link.conversation_id}`).emit('operator:message', msgPayload);
      await broadcastChatMessage({ sessionId: link.conversation_id, message: chatMessage });
    } catch (err) {
      log.warn('[Payments] payment_link paid chat broadcast failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  sendVisitorChatPush(link.conversation_id, {
    title: 'Своё Фото',
    body: `Оплата ${formatRubles(amount)} получена.`,
  }).catch(err => log.warn('[Payments] payment_link paid push failed', { error: String(err) }));

  try {
    const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
      `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
      [link.conversation_id],
    );
    if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
      await enqueueOutbound({
        channel: conv.channel,
        externalChatId: conv.external_chat_id,
        content,
        messageType: 'text',
        sourceMessageId: chatMessage.id,
        conversationId: link.conversation_id,
      });
    }
  } catch (err) {
    log.warn('[Payments] payment_link paid outbound failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendPaymentLinkCancelledMessage(
  req: Request,
  link: PaymentLinkMutationRow,
  reason: string | undefined,
): Promise<void> {
  if (!link.conversation_id) return;

  const amount = Number(link.amount);
  const reasonText = reason?.trim() ? ` Причина: ${reason.trim()}` : '';
  const content = `Счёт ${link.order_ref} на ${formatRubles(amount)} отменён.${reasonText}`;
  const metadata = {
    kind: 'payment_link_cancelled',
    paymentLinkId: link.id,
    orderRef: link.order_ref,
    amount,
  };

  const chatMessage = await db.queryOne<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_id, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'system', 'Система', 'system', $2, $3::jsonb)
     RETURNING *`,
    [link.conversation_id, content, JSON.stringify(metadata)],
  );
  if (!chatMessage) throw new Error('Failed to create payment cancellation chat message');

  const socketServer = req.app.socketServer;
  if (socketServer) {
    const msgPayload = buildOperatorChatSocketPayload(link.conversation_id, chatMessage);
    socketServer.getIO().to(`visitor:${link.conversation_id}`).emit('operator:message', msgPayload);
    await broadcastChatMessage({ sessionId: link.conversation_id, message: chatMessage });
  }
}

function emitPaymentLinkMutation(
  req: Request,
  event: 'payment-link:updated' | 'payment-link:cancelled',
  link: PaymentLinkMutationRow,
): void {
  const io = req.app.socketServer?.getIO();
  if (!io) return;

  const expiresAt = link.expires_at instanceof Date
    ? link.expires_at.toISOString()
    : String(link.expires_at);
  const payload = {
    id: link.id,
    orderRef: link.order_ref,
    amount: Number(link.amount),
    status: link.status,
    conversationId: link.conversation_id,
    contactId: link.contact_id,
    contactName: link.contact_name,
    expiresAt,
  };

  logAndEmit(io, 'admin:visitor-chats', event, payload);
  if (link.conversation_id) {
    logAndEmit(io, 'admin:visitor-chats', 'chat:inbox-updated', {
      conversationId: link.conversation_id,
    });
  }
}

async function emitShiftEarningsUpdate(
  req: Request,
  employeeId: string,
  amount: number,
  shiftId?: string | null,
): Promise<void> {
  try {
    const io = req.app.socketServer?.getIO();
    if (!io) return;

    const params: unknown[] = [employeeId];
    let shiftFilter = `es.employee_id = $1 AND es.shift_date = CURRENT_DATE
         AND es.status IN ('active', 'scheduled', 'completed')`;
    if (shiftId) {
      params.push(shiftId);
      shiftFilter = `es.employee_id = $1 AND es.id = $2`;
    }

    const empShift = await db.queryOne<ShiftEarningsAggregation>(
      `SELECT es.id,
              COALESCE(SUM(s.receipt_total), 0)::text AS online_earnings,
              COUNT(s.*)::text AS online_count,
              COALESCE(SUM(s.commission_amount), 0)::text AS commission
       FROM employee_shifts es
       LEFT JOIN employee_sales s ON s.shift_id = es.id AND s.source = 'online'
       WHERE ${shiftFilter}
       GROUP BY es.id
       ORDER BY CASE es.status
         WHEN 'active' THEN 0
         WHEN 'scheduled' THEN 1
         ELSE 2
       END
       LIMIT 1`,
      params,
    );
    if (!empShift) return;

    io.to(`user:${employeeId}`).emit('shift:earnings-update', {
      shiftId: empShift.id,
      online_earnings: parseFloat(empShift.online_earnings),
      online_count: parseInt(empShift.online_count, 10),
      commission: parseFloat(empShift.commission),
      amount,
    });
  } catch (wsErr) {
    log.debug('WS shift earnings push failed', {
      error: wsErr instanceof Error ? wsErr.message : String(wsErr),
    });
  }
}

interface OnlineSaleAttributionInput {
  receiptId: string;
  employeeId: string | null;
  shiftId: string | null;
  amount: number;
}

async function recordAttributedOnlineEmployeeSale(
  req: Request,
  input: OnlineSaleAttributionInput,
): Promise<void> {
  if (input.amount <= 0) return;

  let employeeId = input.employeeId;
  if (!employeeId && input.shiftId) {
    const shiftOwner = await db.queryOne<ActiveShiftLookup>(
      `SELECT employee_id FROM employee_shifts WHERE id = $1`,
      [input.shiftId],
    );
    employeeId = shiftOwner?.employee_id ?? null;
  }
  if (!employeeId) return;

  let creditedEmployeeId = String(employeeId);
  let creditedShiftId = input.shiftId;

  await db.transaction(async (txClient) => {
    if (creditedShiftId) {
      const shiftOwner = await txClient.query<ActiveShiftLookup>(
        `SELECT employee_id FROM employee_shifts WHERE id = $1 FOR UPDATE`,
        [creditedShiftId],
      );
      const ownerEmployeeId = shiftOwner.rows[0]?.employee_id ?? null;
      if (ownerEmployeeId) {
        creditedEmployeeId = String(ownerEmployeeId);
      } else {
        creditedShiftId = null;
      }
    }

    if (!creditedShiftId) {
      const ensuredShift = await ensureOnlineEmployeeShift(txClient, creditedEmployeeId);
      creditedShiftId = ensuredShift.shift.id;
    }

    await recordEmployeeSale(
      input.receiptId,
      creditedEmployeeId,
      input.amount,
      null,
      txClient,
      'online',
      creditedShiftId,
    );
    await refreshEmployeeShiftSalesCache(txClient, creditedShiftId);
  });

  await emitShiftEarningsUpdate(req, creditedEmployeeId, input.amount, creditedShiftId);
}

function buildPaymentLinkCartItem(
  orderId: string,
  total: number,
  comments: string,
  cartDetails: PaymentLinkCartDetailsJson | null,
) {
  const metadata: ChatCartItemMetadataJson = {
    backendOrderId: orderId,
    ...(cartDetails ? { displayDetails: cartDetails } : {}),
  };
  return {
    serviceId: `backend-order-${orderId}`,
    name: comments,
    description: `Заказ ${orderId}`,
    icon: 'photo_camera',
    price: total,
    quantity: 1,
    metadata,
    backendOrderId: orderId,
    ...(cartDetails ? { displayDetails: cartDetails } : {}),
  };
}

async function syncPaymentLinkCart(
  req: Request,
  sessionId: string,
  orderId: string,
  total: number,
  comments: string,
  cartDetails: PaymentLinkCartDetailsJson | null,
): Promise<void> {
  const item = buildPaymentLinkCartItem(orderId, total, comments, cartDetails);

  const params: unknown[] = [
    sessionId,
    item.serviceId,
    item.name,
    item.description,
    item.icon,
    item.price,
    item.quantity,
    JSON.stringify(item.metadata),
  ];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM visitor_chat_cart_items WHERE session_id = $1', [sessionId]);
    await client.query(
      `INSERT INTO visitor_chat_cart_items
        (session_id, service_id, service_name, service_description, service_icon, price, quantity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      params,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const io = req.app.socketServer?.getIO();
  if (!io) return;
  const payload = { sessionId, items: [item] };
  io.to(`visitor:${sessionId}`).emit('operator:cart-update', payload);
  io.to('admin:visitor-chats').emit('visitor:cart-update', payload);
}

function isSupportTeamItem(item: PaymentLinkServiceJson): boolean {
  return item.id === SUPPORT_TEAM_ITEM_ID
    || item.service_option_id === SUPPORT_TEAM_ITEM_ID
    || item.slug === SUPPORT_TEAM_ITEM_ID
    || item.name === SUPPORT_TEAM_ITEM_NAME
    || item.service === SUPPORT_TEAM_ITEM_NAME;
}

function getPaymentLinkBaseAmount(amount: number, metadata: PaymentLinkMetadataJson): number {
  const metadataBase = numberFromUnknown(metadata[SUPPORT_TEAM_BASE_METADATA_KEY]);
  if (metadataBase !== null && metadataBase > 0) return metadataBase;

  const metadataTip = numberFromUnknown(metadata[SUPPORT_TEAM_TIP_METADATA_KEY]);
  if (metadataTip !== null && metadataTip > 0) return Math.max(0, amount - metadataTip);

  return amount;
}

function withSupportTeamTip(
  services: PaymentLinkServiceJson[],
  tipAmount: number,
): PaymentLinkServiceJson[] {
  const nextServices = services.filter(item => !isSupportTeamItem(item));
  if (tipAmount > 0) {
    nextServices.push({
      id: SUPPORT_TEAM_ITEM_ID,
      name: SUPPORT_TEAM_ITEM_NAME,
      price: tipAmount,
      quantity: 1,
    });
  }
  return nextServices;
}

function paymentLinkServicePriceNote(service: PaymentLinkServiceJson): string | null {
  return textFromUnknown(service['priceNote']);
}

function stripPaymentLinkServicePriceNotes(services: readonly PaymentLinkServiceJson[]): PaymentLinkServiceJson[] {
  return services.map((service) => {
    const next: PaymentLinkServiceJson = { ...service };
    delete next['priceNote'];
    return next;
  });
}

function serviceNameFromItems(items: unknown[]): string {
  const firstItem = items.length > 0 ? items[0] : null;
  if (isPaymentItemObject(firstItem) && typeof firstItem['format'] === 'string') {
    return 'Печать фотографий';
  }
  if (!isAppOrderPaymentItemJson(firstItem)) return 'Онлайн-заказ';
  return firstItem.service || firstItem.tariff || 'Онлайн-заказ';
}

interface PaymentItemObject {
  [key: string]: unknown;
}

interface CheckoutOrderItemPayload {
  name: string;
  price: number;
  quantity: number;
  service?: string;
  document?: string;
  format?: string;
  paperType?: string;
  details?: string[];
  unitPrice?: number;
}

function isPaymentItemObject(value: unknown): value is PaymentItemObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumberFromUnknown(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = numberFromUnknown(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function positiveIntegerFromUnknown(value: unknown): number {
  const quantity = positiveNumberFromUnknown(value) ?? 1;
  return Math.max(1, Math.trunc(quantity));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function photoFormatBase(format: string | null): string | null {
  if (!format) return null;
  return format.split('_')[0]?.trim().toLowerCase().replace('×', 'x') || null;
}

function photoFormatLabel(format: string | null): string | null {
  const base = photoFormatBase(format);
  if (!base) return null;
  const labels: Record<string, string> = {
    '10x15': '10×15 см',
    '13x18': '13×18 см',
    '15x20': '15×20 см',
    '15x21': '15×21 см',
    '20x30': '20×30 см',
    '30x40': '30×40 см',
    '40x50': '40×50 см',
    a4: 'A4',
  };
  if (labels[base]) return labels[base];
  if (/^\d+x\d+$/.test(base)) return `${base.replace('x', '×')} см`;
  return format;
}

function photoPaperKey(item: PaymentItemObject): string | null {
  const direct = textFromUnknown(item['paperType']) ?? textFromUnknown(item['paper_type']);
  if (direct) return direct.toLowerCase();
  const format = textFromUnknown(item['format']);
  const suffix = format?.split('_').slice(1).join('_');
  return suffix ? suffix.toLowerCase() : null;
}

function photoPaperLabel(paperType: string | null): string | null {
  if (!paperType) return null;
  return ({
    matte: 'Матовая',
    glossy: 'Глянцевая',
    satin: 'Сатин',
    supergloss: 'Суперглянец',
    premium: 'Премиум',
    super: 'Супер',
    luster: 'Люстр',
    lustre: 'Люстр',
    semi_glossy: 'Полуглянцевая',
    semigloss: 'Полуглянцевая',
  } as Record<string, string>)[paperType] ?? paperType;
}

function photoMarginsLabel(value: unknown): string | null {
  const margins = textFromUnknown(value)?.toLowerCase();
  if (!margins) return null;
  return ({
    none: 'Без полей',
    '0': 'Без полей',
    '3mm': 'Поля 3 мм',
    '5mm': 'Поля 5 мм',
    true: 'С полями',
  } as Record<string, string>)[margins] ?? margins;
}

function photoBorderLabel(value: unknown): string | null {
  const border = textFromUnknown(value)?.toLowerCase();
  if (!border || border === 'none') return null;
  return ({
    white: 'Белая рамка',
    black: 'Чёрная рамка',
  } as Record<string, string>)[border] ?? border;
}

function photoItemSubtotal(item: PaymentItemObject, quantity: number): number | null {
  const subtotal = positiveNumberFromUnknown(item['subtotal'])
    ?? positiveNumberFromUnknown(item['total'])
    ?? positiveNumberFromUnknown(item['amount']);
  if (subtotal !== null) return subtotal;

  const unitPrice = positiveNumberFromUnknown(item['unitPrice'])
    ?? positiveNumberFromUnknown(item['unit_price'])
    ?? positiveNumberFromUnknown(item['price']);
  return unitPrice !== null ? unitPrice * quantity : null;
}

interface PhotoCheckoutGroup {
  quantity: number;
  missingPriceQuantity: number;
  explicitSubtotal: number;
  formatLabel: string | null;
  paperLabel: string | null;
  marginsLabel: string | null;
  borderLabel: string | null;
}

function photoCheckoutGroups(items: PaymentItemObject[], totalPrice: number): CheckoutOrderItemPayload[] {
  const groups = new Map<string, PhotoCheckoutGroup>();

  for (const item of items) {
    const quantity = positiveIntegerFromUnknown(item['quantity']);
    const format = textFromUnknown(item['format']);
    const paperKey = photoPaperKey(item);
    const margins = textFromUnknown(item['margins']);
    const border = textFromUnknown(item['border']);
    const formatLabel = photoFormatLabel(format);
    const paperLabel = photoPaperLabel(paperKey);
    const marginsLabel = photoMarginsLabel(margins);
    const borderLabel = photoBorderLabel(border);
    const key = [
      photoFormatBase(format) ?? format ?? '',
      paperKey ?? '',
      margins ?? '',
      border ?? '',
    ].join('|');
    const group = groups.get(key) ?? {
      quantity: 0,
      missingPriceQuantity: 0,
      explicitSubtotal: 0,
      formatLabel,
      paperLabel,
      marginsLabel,
      borderLabel,
    };
    const subtotal = photoItemSubtotal(item, quantity);
    group.quantity += quantity;
    if (subtotal === null) {
      group.missingPriceQuantity += quantity;
    } else {
      group.explicitSubtotal += subtotal;
    }
    groups.set(key, group);
  }

  const entries = [...groups.values()];
  const explicitTotal = entries.reduce((sum, group) => sum + group.explicitSubtotal, 0);
  const missingQuantity = entries.reduce((sum, group) => sum + group.missingPriceQuantity, 0);
  const fallbackUnitPrice = missingQuantity > 0
    ? Math.max(0, totalPrice - explicitTotal) / missingQuantity
    : 0;

  let allocated = 0;
  return entries.map((group, index) => {
    const calculatedPrice = group.explicitSubtotal + group.missingPriceQuantity * fallbackUnitPrice;
    const price = index === entries.length - 1
      ? roundCurrency(Math.max(0, totalPrice - allocated))
      : roundCurrency(calculatedPrice);
    allocated += price;
    const details = [
      group.formatLabel,
      group.paperLabel,
      group.marginsLabel,
      group.borderLabel,
    ].filter((value): value is string => Boolean(value));
    const unitPrice = group.quantity > 0 ? roundCurrency(price / group.quantity) : null;

    return {
      name: 'Печать фотографий',
      service: 'Печать фотографий',
      price,
      quantity: group.quantity,
      ...(group.formatLabel ? { format: group.formatLabel } : {}),
      ...(group.paperLabel ? { paperType: group.paperLabel } : {}),
      ...(details.length > 0 ? { details } : {}),
      ...(unitPrice !== null ? { unitPrice } : {}),
    };
  });
}

function checkoutItemsFromOrderItems(
  items: unknown[],
  totalPrice: number,
  description: string | null,
): CheckoutOrderItemPayload[] {
  const photoItems = items.filter(isPaymentItemObject).filter(item => typeof item['format'] === 'string');
  if (photoItems.length > 0) {
    return photoCheckoutGroups(photoItems, totalPrice);
  }

  const normalized = items
    .filter(isPaymentItemObject)
    .map((item) => {
      const name = [item['name'], item['service'], item['tariff'], item['document']]
        .find(value => typeof value === 'string' && value.trim().length > 0);
      if (typeof name !== 'string') return null;

      const service = textFromUnknown(item['service']);
      const document = textFromUnknown(item['document']);
      const quantity = positiveIntegerFromUnknown(item['quantity']);
      const unitPrice = positiveNumberFromUnknown(item['unitPrice'])
        ?? positiveNumberFromUnknown(item['unit_price'])
        ?? positiveNumberFromUnknown(item['price']);
      const price = positiveNumberFromUnknown(item['subtotal'])
        ?? positiveNumberFromUnknown(item['total'])
        ?? positiveNumberFromUnknown(item['amount'])
        ?? (unitPrice !== null ? unitPrice * quantity : 0);
      const details = uniqueText([
        textFromUnknown(item['tariff']),
        textFromUnknown(item['document']),
        textFromUnknown(item['description']),
      ]);

      return {
        name,
        price: roundCurrency(price),
        quantity,
        ...(service ? { service } : {}),
        ...(document ? { document } : {}),
        ...(details.length > 0 ? { details } : {}),
        ...(unitPrice !== null ? { unitPrice: roundCurrency(unitPrice) } : {}),
      };
    })
    .filter((item): item is CheckoutOrderItemPayload => item !== null);

  return normalized.length > 0
    ? normalized
    : [{ name: description || 'Онлайн-заказ', price: totalPrice, quantity: 1 }];
}

function appOrderServicesFromMetadataItems(items: unknown): string[] {
  if (!Array.isArray(items)) return ['Заказ из приложения'];
  const services = items
    .filter(isAppOrderPaymentItemJson)
    .map(item => item.name || item.service || 'Заказ')
    .filter(Boolean);
  return services.length > 0 ? services : ['Заказ из приложения'];
}

function firstServiceOptionQuantity(items: unknown): { serviceOptionId: string; quantity: number } | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const firstItem = items[0];
  if (!isPaymentLinkCreateServiceJson(firstItem) || !firstItem.service_option_id) return null;
  const quantity = numberFromUnknown(firstItem.quantity);
  if (quantity === null) return null;
  return { serviceOptionId: firstItem.service_option_id, quantity };
}

function paymentLifecycleReversalReason(kind: 'cancel' | 'refund', transactionId: unknown, invoiceId: unknown): string {
  const id = transactionId ? String(transactionId) : String(invoiceId);
  return `cloudpayments_${kind}:${id}`;
}

export async function cancelCloudPaymentsOrder(
  invoiceId: string,
  transactionId?: unknown,
  reason?: unknown,
): Promise<{
  branch: 'print_order' | 'app_order' | 'payment_link';
  printOrderId: string | null;
  restoredCredits: { restored: number; entries: number } | null;
}> {
  return db.transaction(async (client) => {
    const cancelledResult = await client.query<Pick<PhotoPrintOrders, 'id'>>(
      `UPDATE photo_print_orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW()
       WHERE order_id = $1 AND status IN ('pending_payment', 'processing')
       RETURNING id`,
      [invoiceId],
    );
    const cancelled = cancelledResult.rows[0];

    if (cancelled) {
      const restoredCredits = await restoreCreditsForPrintOrderWithClient(client, {
        print_order_id: cancelled.id,
        reversal_reason: paymentLifecycleReversalReason('cancel', transactionId, invoiceId),
        description: reason ? `CloudPayments cancel: ${String(reason)}` : `CloudPayments cancel for order ${invoiceId}`,
      });

      await client.query(
        `UPDATE work_tasks SET status = 'cancelled', updated_at = NOW()
         WHERE print_order_id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [cancelled.id],
      );

      return { branch: 'print_order' as const, printOrderId: cancelled.id, restoredCredits };
    }

    // Онлайн-счёт (payment_link): отмена оплаченного до сеттлмента (void) тоже освобождает акцию.
    const cancelledLink = await client.query<{ id: string }>(
      `UPDATE payment_links SET status = 'cancelled', updated_at = NOW()
       WHERE order_ref = $1 AND status = 'paid' RETURNING id`,
      [invoiceId],
    );
    if (cancelledLink.rows[0]) {
      await restoreStudentIdPhotoPromoForPaymentLinkWithClient(client, { paymentLinkId: cancelledLink.rows[0].id });
      return { branch: 'payment_link' as const, printOrderId: null, restoredCredits: null };
    }

    await client.query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW()
       WHERE id::text = $1 AND status IN ('pending_payment', 'processing')`,
      [invoiceId],
    );

    return { branch: 'app_order' as const, printOrderId: null, restoredCredits: null };
  });
}

export async function refundCloudPaymentsOrder(
  invoiceId: string,
  transactionId?: unknown,
): Promise<{
  branch: 'print_order' | 'app_order' | 'payment_link';
  printOrderId: string | null;
  restoredCredits: { restored: number; entries: number } | null;
}> {
  return db.transaction(async (client) => {
    const updatedResult = await client.query<Pick<PhotoPrintOrders, 'id'>>(
      `UPDATE photo_print_orders
       SET payment_status = 'refunded', status = 'refunded', updated_at = NOW()
       WHERE order_id = $1 RETURNING id`,
      [invoiceId],
    );
    const updated = updatedResult.rows[0];

    if (updated) {
      const restoredCredits = await restoreCreditsForPrintOrderWithClient(client, {
        print_order_id: updated.id,
        reversal_reason: paymentLifecycleReversalReason('refund', transactionId, invoiceId),
        description: `CloudPayments refund for order ${invoiceId}`,
      });

      return { branch: 'print_order' as const, printOrderId: updated.id, restoredCredits };
    }

    // Онлайн-счёт (payment_link): при возврате освобождаем акцию «Фото на студенческий».
    // status='cancelled' — единственный разрешённый CHECK терминальный статус для реверса (нет 'refunded').
    const refundedLink = await client.query<{ id: string }>(
      `UPDATE payment_links SET status = 'cancelled', updated_at = NOW()
       WHERE order_ref = $1 AND status = 'paid' RETURNING id`,
      [invoiceId],
    );
    if (refundedLink.rows[0]) {
      await restoreStudentIdPhotoPromoForPaymentLinkWithClient(client, { paymentLinkId: refundedLink.rows[0].id });
      return { branch: 'payment_link' as const, printOrderId: null, restoredCredits: null };
    }

    await client.query(
      `UPDATE orders SET payment_status = 'refunded', updated_at = NOW()
       WHERE id::text = $1`,
      [invoiceId],
    );

    return { branch: 'app_order' as const, printOrderId: null, restoredCredits: null };
  });
}

function getRequestRawBody(req: Request): string | undefined {
  if (!('rawBody' in req)) return undefined;
  return typeof req.rawBody === 'string' ? req.rawBody : undefined;
}

const DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM = 1;
const CLOUDKASSIR_RECEIPT_BACKEND_KEYS = new Set(['Items', 'items', 'TaxationSystem', 'taxationSystem']);
const CLOUDKASSIR_ITEM_BACKEND_KEYS = new Set(['Vat', 'vat']);

interface UnknownObject {
  readonly [key: string]: unknown;
}

interface MutableUnknownObject {
  [key: string]: unknown;
}

interface CloudPaymentsJsonData {
  cloudpayments: {
    receipt: unknown;
  };
}

function isUnknownObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyWithoutKeys(source: UnknownObject, skippedKeys: ReadonlySet<string>): MutableUnknownObject {
  const result: MutableUnknownObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (!skippedKeys.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

function resolveCloudPaymentsTaxationSystem(): number {
  const taxationSystem = Number(config.cloudPayments.taxationSystem);
  if (!Number.isInteger(taxationSystem) || taxationSystem < 0 || taxationSystem > 5) {
    return DEFAULT_CLOUDPAYMENTS_TAXATION_SYSTEM;
  }
  return taxationSystem;
}

function getCloudKassirReceiptItems(receipt: UnknownObject): unknown[] | null {
  const lowerItems = receipt['items'];
  if (Array.isArray(lowerItems)) return lowerItems;

  const upperItems = receipt['Items'];
  return Array.isArray(upperItems) ? upperItems : null;
}

function normalizeCloudKassirReceiptItem(item: unknown): unknown {
  if (!isUnknownObject(item)) return item;
  return {
    ...copyWithoutKeys(item, CLOUDKASSIR_ITEM_BACKEND_KEYS),
    vat: null,
  };
}

function normalizeCloudKassirReceipt(receipt: unknown, contact: { email?: string; phone?: string }): unknown {
  if (!isUnknownObject(receipt)) return receipt;

  const normalized = copyWithoutKeys(receipt, CLOUDKASSIR_RECEIPT_BACKEND_KEYS);
  normalized['taxationSystem'] = resolveCloudPaymentsTaxationSystem();
  if (contact.email) normalized['email'] = contact.email;
  if (contact.phone) normalized['phone'] = contact.phone;

  const items = getCloudKassirReceiptItems(receipt);
  if (items) {
    normalized['items'] = items.map(normalizeCloudKassirReceiptItem);
  }

  return normalized;
}

function buildSbpReceipt(params: {
  amount: unknown;
  description?: string;
  orderId?: string;
  email?: string;
  phone?: string;
}): MutableUnknownObject {
  const amount = numberFromUnknown(params.amount) ?? 0;
  const label = textFromUnknown(params.description)
    ?? (params.orderId ? `Заказ ${params.orderId}` : 'Оплата заказа');

  return {
    items: [
      {
        label,
        price: amount,
        quantity: 1,
        amount,
        vat: null,
        method: 4,
        object: 4,
        measurementUnit: 'шт',
      },
    ],
    taxationSystem: resolveCloudPaymentsTaxationSystem(),
    email: params.email,
    phone: params.phone,
    amounts: {
      electronic: amount,
      advancePayment: 0,
      credit: 0,
      provision: 0,
    },
  };
}

function createCloudKassirJsonData(receipt: unknown, contact: { email?: string; phone?: string }): CloudPaymentsJsonData {
  return {
    cloudpayments: {
      receipt: normalizeCloudKassirReceipt(receipt, contact),
    },
  };
}

const FISCAL_RECEIPT_ROUTE = '/api/payments/fiscal-receipt';
const receiptMoneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const receiptDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
});

interface FiscalReceiptRenderItem {
  label: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}

function finiteNumberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function receiptValueText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function textFromQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? textFromQueryValue(value[0]) : null;
  return textFromUnknown(value);
}

function buildFiscalReceiptUrl(orderId: string, receiptId: string): string {
  return `${FISCAL_RECEIPT_ROUTE}/${encodeURIComponent(orderId)}?receiptId=${encodeURIComponent(receiptId)}`;
}

function receiptUrlForTracking(orderId: string, storedReceiptUrl: string | null): string | null {
  return storedReceiptUrl ? `${FISCAL_RECEIPT_ROUTE}/${encodeURIComponent(orderId)}` : null;
}

function resolveFiscalReceiptId(storedReceiptUrl: string | null, queryValue: unknown): string | null {
  const queryReceiptId = textFromQueryValue(queryValue);
  if (queryReceiptId) return queryReceiptId;
  if (!storedReceiptUrl) return null;

  try {
    const parsed = new URL(storedReceiptUrl, 'https://svoefoto.local');
    return textFromUnknown(parsed.searchParams.get('receiptId'));
  } catch {
    return null;
  }
}

function safeExternalReceiptUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.pathname.startsWith(FISCAL_RECEIPT_ROUTE)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchCloudKassirReceiptModel(receiptId: string): Promise<UnknownObject | null> {
  const { publicId, apiSecret } = config.cloudPayments;
  if (!publicId || !apiSecret) {
    throw new AppError(503, 'CloudPayments не настроен', ErrorCode.PAYMENT_SYSTEM_NOT_CONFIGURED);
  }

  const auth = Buffer.from(`${publicId}:${apiSecret}`).toString('base64');
  const response = await fetchWithCB(SERVICE_BREAKERS.cloudpayments, 'https://api.cloudpayments.ru/kkt/receipt/get', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify({ Id: receiptId }),
  });

  const payload: unknown = await response.json();
  if (!response.ok || !isUnknownObject(payload)) {
    log.warn('[CloudKassir] receipt details response is invalid', {
      receiptId,
      status: response.status,
    });
    return null;
  }

  if (payload['Success'] !== true) {
    log.warn('[CloudKassir] receipt details request failed', {
      receiptId,
      message: receiptValueText(payload['Message']),
    });
    return null;
  }

  const model = payload['Model'];
  return isUnknownObject(model) ? model : null;
}

function receiptItemsFromModel(model: UnknownObject): FiscalReceiptRenderItem[] {
  const rawItems = model['Items'];
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter(isUnknownObject)
    .map((item) => ({
      label: receiptValueText(item['Label']) ?? 'Позиция',
      quantity: finiteNumberFromUnknown(item['Quantity']),
      price: finiteNumberFromUnknown(item['Price']),
      amount: finiteNumberFromUnknown(item['Amount']),
    }));
}

function escapeReceiptHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatReceiptMoney(value: number | null): string {
  return value === null ? '—' : receiptMoneyFormatter.format(value);
}

function formatReceiptDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : receiptDateFormatter.format(date);
}

function renderReceiptRows(rows: Array<readonly [string, string | null]>): string {
  return rows
    .filter(([, value]) => !!value)
    .map(([label, value]) => `
      <div class="detail-row">
        <span>${escapeReceiptHtml(label)}</span>
        <strong>${escapeReceiptHtml(value ?? '')}</strong>
      </div>
    `)
    .join('');
}

function renderReceiptInfoPage(title: string, message: string): string {
  const safeTitle = escapeReceiptHtml(title);
  const safeMessage = escapeReceiptHtml(message);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0b0b0b; color: #f5f5f5; }
    main { width: min(520px, calc(100% - 32px)); margin: 72px auto; padding: 28px; border: 1px solid #2d2d2d; border-radius: 10px; background: #141414; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0; color: #b8b8b8; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
  </main>
</body>
</html>`;
}

function renderFiscalReceiptPage(params: {
  order: FiscalReceiptOrderLookupRow;
  receiptId: string;
  model: UnknownObject;
}): string {
  const { order, receiptId, model } = params;
  const items = receiptItemsFromModel(model);
  const amount = finiteNumberFromUnknown(model['Amount']) ?? finiteNumberFromUnknown(order.total_price);
  const receiptDate = receiptValueText(model['DateTime']) ?? order.created_at;
  const ofdReceiptUrl = safeExternalReceiptUrl(receiptValueText(model['OfdReceiptUrl']) ?? receiptValueText(model['Url']));
  const qrCodeUrl = safeExternalReceiptUrl(receiptValueText(model['QrCodeUrl']));
  const itemRows = items.length > 0
    ? items.map((item) => `
        <tr>
          <td>
            <strong>${escapeReceiptHtml(item.label)}</strong>
            ${item.price !== null ? `<span>${escapeReceiptHtml(formatReceiptMoney(item.price))} за ед.</span>` : ''}
          </td>
          <td>${item.quantity === null ? '—' : escapeReceiptHtml(String(item.quantity))}</td>
          <td>${escapeReceiptHtml(formatReceiptMoney(item.amount))}</td>
        </tr>
      `).join('')
    : `
        <tr>
          <td><strong>Заказ ${escapeReceiptHtml(order.order_id)}</strong></td>
          <td>1</td>
          <td>${escapeReceiptHtml(formatReceiptMoney(amount))}</td>
        </tr>
      `;
  const fiscalRows = renderReceiptRows([
    ['ID чека', receiptId],
    ['ФН', receiptValueText(model['FiscalNumber'])],
    ['ФД', receiptValueText(model['DocumentNumber'])],
    ['ФП', receiptValueText(model['FiscalSign'])],
    ['Смена', receiptValueText(model['SessionNumber'])],
    ['Чек в смене', receiptValueText(model['SessionCheckNumber']) ?? receiptValueText(model['Number'])],
    ['ККТ', receiptValueText(model['DeviceNumber'])],
    ['РН ККТ', receiptValueText(model['RegNumber'])],
    ['ИНН', receiptValueText(model['OrganizationInn']) ?? receiptValueText(model['Inn'])],
    ['ОФД', receiptValueText(model['Ofd']) ?? receiptValueText(model['OfdName'])],
    ['Транзакция', receiptValueText(model['TransactionId'])],
  ]);
  const externalLinks = [
    ofdReceiptUrl ? `<a href="${escapeReceiptHtml(ofdReceiptUrl)}" target="_blank" rel="noopener">Открыть чек у ОФД</a>` : '',
    qrCodeUrl ? `<a href="${escapeReceiptHtml(qrCodeUrl)}" target="_blank" rel="noopener">Проверить по QR</a>` : '',
  ].filter(Boolean).join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Чек ${escapeReceiptHtml(order.order_id)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0b0b0b; color: #f5f5f5; }
    main { width: min(640px, calc(100% - 32px)); margin: 32px auto; padding: 28px; border: 1px solid #2d2d2d; border-radius: 10px; background: #141414; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0 0 6px; font-size: 26px; }
    .muted { color: #a6a6a6; font-size: 14px; }
    .total { text-align: right; font-size: 24px; font-weight: 700; color: #f59e0b; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0; }
    th { color: #a6a6a6; font-size: 12px; text-transform: uppercase; text-align: left; border-bottom: 1px solid #2d2d2d; padding: 10px 0; }
    td { border-bottom: 1px solid #242424; padding: 12px 0; vertical-align: top; }
    td:nth-child(2), td:nth-child(3), th:nth-child(2), th:nth-child(3) { text-align: right; }
    td span { display: block; color: #a6a6a6; font-size: 12px; margin-top: 4px; }
    .details { margin-top: 20px; display: grid; gap: 8px; }
    .detail-row { display: flex; justify-content: space-between; gap: 16px; color: #a6a6a6; font-size: 13px; }
    .detail-row strong { color: #f5f5f5; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    button, a { border: 1px solid #3a3a3a; border-radius: 8px; padding: 10px 14px; color: #f5f5f5; background: #1d1d1d; text-decoration: none; font-size: 14px; cursor: pointer; }
    button.primary { background: #f59e0b; border-color: #f59e0b; color: #0b0b0b; font-weight: 700; }
    @media print {
      body { background: #fff; color: #111; }
      main { width: auto; margin: 0; padding: 0; border: 0; background: #fff; }
      .muted, th, td span, .detail-row { color: #555; }
      .detail-row strong, td, h1 { color: #111; }
      .total { color: #111; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Кассовый чек</h1>
        <div class="muted">Заказ ${escapeReceiptHtml(order.order_id)}</div>
        <div class="muted">${escapeReceiptHtml(formatReceiptDate(receiptDate))}</div>
      </div>
      <div class="total">${escapeReceiptHtml(formatReceiptMoney(amount))}</div>
    </header>
    <table>
      <thead>
        <tr><th>Позиция</th><th>Кол-во</th><th>Сумма</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <section class="details">${fiscalRows}</section>
    <div class="actions">
      <button class="primary" type="button" onclick="window.print()">Сохранить PDF</button>
      ${externalLinks}
    </div>
  </main>
</body>
</html>`;
}

interface SbpPayloadJson {
  PublicId: string;
  Amount: unknown;
  Currency: string;
  Description: string;
  Scheme: string;
  TtlMinutes: number;
  InvoiceId?: unknown;
  AccountId?: unknown;
  Email?: unknown;
  SuccessRedirectUrl?: unknown;
  JsonData?: CloudPaymentsJsonData;
}

interface CloudPaymentsFindResponse {
  Success: boolean;
  Model?: {
    Status: string;
    StatusCode: number;
    Amount: number;
    Currency?: string;
    TransactionId?: string | number | null;
    SubscriptionId?: string | number | null;
    Token?: string | null;
    DateTime?: string | null;
    CreatedDate?: string | null;
  };
}

interface BridgeAttributionResponse {
  [key: string]: unknown;
}

interface QuickSaleBridgePayload {
  amount: unknown;
  source: 'quick_sale';
  services: unknown;
  fingerprint_visitor_id?: string;
  phone?: string;
}

// Rate limiter для публичных payment endpoints (анти-abuse)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 30, // 30 запросов на IP
  message: 'Слишком много запросов к платёжному API. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('pay:'),
});

/**
 * CloudPayments Webhook уведомления
 *
 * CloudPayments отправляет POST-запросы при различных событиях.
 * Для валидации используется HMAC подпись.
 *
 * Документация: https://developers.cloudpayments.ru/#uvedomleniya
 */

/**
 * Проверка HMAC подписи CloudPayments
 */
function verifyCloudPaymentsSignature(
  body: string,
  signature: string | undefined,
  apiSecret: string,
): boolean {
  if (!signature || !apiSecret) return false;

  const hmac = crypto.createHmac('sha256', apiSecret);
  hmac.update(body);
  const expectedSignature = hmac.digest('base64');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

/**
 * Middleware: проверка HMAC-подписи CloudPayments на всех webhook-эндпоинтах.
 * CloudPayments отправляет подпись в заголовке X-Content-HMAC (HMAC-SHA256 от raw body).
 */
function requireCloudPaymentsSignature(req: Request, res: Response, next: NextFunction): void {
  const apiSecret = config.cloudPayments.apiSecret;

  if (!apiSecret) {
    log.error('[CloudPayments] CRITICAL: CLOUDPAYMENTS_API_SECRET not set — rejecting all webhooks in production');
    const rejectCode = req.path === '/check' ? 13 : 0;
    res.json({ code: rejectCode });
    return;
  }

  // rawBody устанавливается в express.json verify callback (registerApiRoutes → scoped к /payments)
  const rawBody = getRequestRawBody(req);

  // CloudPayments отправляет 2 заголовка:
  //   Content-HMAC — HMAC от URL-encoded тела (rawBody как есть)
  //   X-Content-HMAC — HMAC от URL-decoded тела
  // rawBody из verify callback = URL-encoded → используем Content-HMAC
  const signature = (req.headers['content-hmac'] || req.headers['x-content-hmac']) as string | undefined;

  if (!rawBody || !verifyCloudPaymentsSignature(rawBody, signature, apiSecret)) {
    // Если Content-HMAC не прошёл, пробуем X-Content-HMAC с decoded body
    const xSignature = req.headers['x-content-hmac'] as string | undefined;
    if (rawBody && xSignature) {
      const decodedBody = decodeURIComponent(rawBody.replace(/\+/g, ' '));
      if (verifyCloudPaymentsSignature(decodedBody, xSignature, apiSecret)) {
        next();
        return;
      }
    }

    log.error('[CloudPayments] SIGNATURE VERIFICATION FAILED', {
      path: req.originalUrl,
      contentType: req.headers['content-type'],
      hasRawBody: !!rawBody,
      rawBodyPreview: rawBody?.substring(0, 120),
      hasSignature: !!signature,
      hasXSignature: !!xSignature,
      ip: req.ip,
    });
    // Check: HMAC-fail = отклонить платёж (code 13), иначе CloudPayments ретраит 100 раз
    const rejectCode = req.path === '/check' ? 13 : 0;
    res.json({ code: rejectCode });
    return;
  }

  next();
}

// Применяем проверку подписи ко всем webhook-эндпоинтам
router.use(
  ['/check', '/pay', '/fail', '/receipt', '/confirm', '/cancel', '/refund', '/recurrent', '/sbp-token', '/kkt'],
  requireCloudPaymentsSignature,
);

/**
 * Check уведомление — вызывается ДО оплаты.
 * Здесь можно проверить сумму, наличие товара и т.д.
 *
 * Ответ: { "code": 0 } — разрешить оплату
 * Ответ: { "code": 13 } — отклонить оплату
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { Amount, Currency, InvoiceId, AccountId, TestMode } = req.body;
    const numericAmount = parseFloat(Amount);

    log.info('[CloudPayments] Check notification:', {
      amount: Amount, currency: Currency, orderId: InvoiceId,
      accountId: AccountId, testMode: TestMode,
    });

    // 1. Тестовые транзакции от CloudPayments — всегда принимаем
    if (TestMode === '1' || TestMode === 1) {
      log.info('[CloudPayments] Check: TEST MODE — accepting');
      res.json({ code: 0 });
      return;
    }

    // 2. Валюта должна быть RUB (code 12 — неверная сумма/валюта)
    if (Currency && Currency !== 'RUB') {
      log.warn(`[CloudPayments] Check: wrong currency ${Currency} — rejecting (code 12)`);
      res.json({ code: 12 });
      return;
    }

    // 3. Реальный платёж обязан иметь номер заказа (code 10 — неверный номер заказа)
    if (!InvoiceId) {
      log.warn('[CloudPayments] Check: no InvoiceId — rejecting (code 10)');
      res.json({ code: 10 });
      return;
    }

    // 4a. Subscription check — SUB-* invoices go through separate validation
    if (typeof InvoiceId === 'string' && InvoiceId.startsWith('SUB-')) {
      const subLookupId = InvoiceId.replace('SUB-', '');
      const sub = await db.queryOne<SubscriptionPaymentCheckRow>(
        `SELECT id, monthly_price::text, status,
                EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
         FROM user_subscriptions WHERE id::text = $1`,
        [subLookupId],
      );

      if (!sub) {
        log.warn(`[CloudPayments] Check: subscription ${subLookupId} not found — rejecting (code 10)`);
        res.json({ code: 10 });
        return;
      }

      if (sub.status !== 'pending') {
        log.warn(`[CloudPayments] Check: subscription ${subLookupId} status=${sub.status} — rejecting (code 13)`);
        res.json({ code: 13 });
        return;
      }

      const expectedSubAmount = parseFloat(sub.monthly_price);
      if (!isNaN(numericAmount) && !isNaN(expectedSubAmount) && Math.abs(expectedSubAmount - numericAmount) > 0.01) {
        log.warn(`[CloudPayments] Check: subscription AMOUNT MISMATCH for ${InvoiceId}. Expected ${expectedSubAmount}, got ${numericAmount} — rejecting (code 12)`);
        res.json({ code: 12 });
        return;
      }

      log.info(`[CloudPayments] Check OK: subscription ${InvoiceId}, amount ${Amount}`);
      res.json({ code: 0 });
      return;
    }

    // 4a1. Card-change верификация (1₽) — SUBCC-<changeId>. anti-tamper: открытая операция + сумма + RUB.
    if (typeof InvoiceId === 'string' && InvoiceId.startsWith('SUBCC-')) {
      const changeId = InvoiceId.slice('SUBCC-'.length);
      const change = await db.queryOne<CardChangeCheckRow>(
        `SELECT id, status, expected_amount::text AS expected_amount
           FROM subscription_card_changes
          WHERE idempotency_key = $1`,
        [changeId],
      );
      const decision = decideCardChangeCheckCode(change, numericAmount);
      if (decision.code === 0) {
        log.info(`[CloudPayments] Check OK: card-change ${InvoiceId}, amount ${Amount}`);
      } else {
        log.warn(`[CloudPayments] Check: card-change ${changeId} rejected (${decision.reason}) — code ${decision.code}`, {
          status: change?.status ?? null, amount: Amount,
        });
      }
      res.json({ code: decision.code });
      return;
    }

    // 4a2. Payment links — операторская ссылка на оплату (до photo_print_orders)
    const link = await db.queryOne<PaymentLinkCheckRow>(
      `SELECT id, amount::text AS amount, status, (expires_at < NOW()) AS expired
       FROM payment_links WHERE order_ref = $1`,
      [InvoiceId],
    );
    if (link) {
      if (link.expired || link.status === 'expired') {
        log.warn(`[CloudPayments] Check: payment_link ${InvoiceId} expired — rejecting (code 20)`);
        res.json({ code: 20 });
        return;
      }
      if (link.status !== 'pending') {
        log.warn(`[CloudPayments] Check: payment_link ${InvoiceId} status=${link.status} — rejecting (code 13)`);
        res.json({ code: 13 });
        return;
      }
      const expectedLinkAmount = parseFloat(link.amount);
      if (!isNaN(numericAmount) && !isNaN(expectedLinkAmount) && Math.abs(expectedLinkAmount - numericAmount) > 0.01) {
        log.warn(`[CloudPayments] Check: payment_link AMOUNT MISMATCH for ${InvoiceId}. Expected ${expectedLinkAmount}, got ${numericAmount} — rejecting (code 12)`);
        res.json({ code: 12 });
        return;
      }
      log.info(`[CloudPayments] Check OK: payment_link ${InvoiceId}, amount ${Amount}`);
      res.json({ code: 0 });
      return;
    }

    // 4b. Ищем заказ в БД (один запрос — включая срок давности)
    let order = await db.queryOne(
      `SELECT order_id, total_price, status, contact_email,
              EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
       FROM photo_print_orders WHERE order_id = $1`,
      [InvoiceId]
    );
    if (!order) {
      // Fallback: общая таблица orders (UUID InvoiceId)
      order = await db.queryOne(
        `SELECT id::text AS order_id, total_amount::text AS total_price, status,
                NULL AS contact_email,
                EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
         FROM orders WHERE id::text = $1`,
        [InvoiceId]
      );
    }

    // 5. Заказ не найден (code 10 — неверный номер заказа)
    if (!order) {
      log.warn(`[CloudPayments] Check: order ${InvoiceId} not found — rejecting (code 10)`);
      res.json({ code: 10 });
      return;
    }

    // 6. Заказ просрочен — старше 24 часов (code 20 — CP отправит клиенту спец. уведомление)
    const ageHours = parseFloat(order.age_hours);
    if (!isNaN(ageHours) && ageHours > 24) {
      log.warn(`[CloudPayments] Check: order ${InvoiceId} expired (${ageHours.toFixed(1)}h old) — rejecting (code 20)`);
      res.json({ code: 20 });
      return;
    }

    // 7. Статус заказа — только pending_payment (code 13 — платёж не может быть принят)
    if (order.status !== 'pending_payment') {
      log.warn(`[CloudPayments] Check: order ${InvoiceId} status=${order.status} — rejecting (code 13)`);
      res.json({ code: 13 });
      return;
    }

    // 8. AccountId — сверка с email заказа если оба заданы (code 11 — некорректный AccountId)
    if (AccountId && order.contact_email && AccountId !== order.contact_email) {
      log.warn(`[CloudPayments] Check: AccountId mismatch for ${InvoiceId}. Expected ${order.contact_email}, got ${AccountId} — rejecting (code 11)`);
      res.json({ code: 11 });
      return;
    }

    // 9. Сумма должна совпадать (code 12 — неверная сумма)
    // Tip обновляет total_price через PATCH /:orderId/tip ДО оплаты
    const expectedAmount = parseFloat(order.total_price);
    if (!isNaN(numericAmount) && !isNaN(expectedAmount) && Math.abs(expectedAmount - numericAmount) > 0.01) {
      log.warn(`[CloudPayments] Check: AMOUNT MISMATCH for ${InvoiceId}. Expected ${expectedAmount}, got ${numericAmount} — rejecting (code 12)`);
      res.json({ code: 12 });
      return;
    }

    log.info(`[CloudPayments] Check OK: order ${InvoiceId}, amount ${Amount}`);
    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-check' }, level: 'error' });
    log.error('[CloudPayments] Check error:', { error: String(error) });
    // При DB-ошибке отклоняем — безопаснее не принять неверифицированный платёж
    res.json({ code: 13 });
  }
});

/**
 * Pay уведомление — вызывается ПОСЛЕ успешной оплаты.
 * Здесь нужно обновить статус заказа в БД.
 *
 * Ответ: { "code": 0 } — подтвердить получение
 */
router.post('/pay', async (req: Request, res: Response) => {
  try {
    const {
      TransactionId, Amount, Currency, InvoiceId,
      CardFirstSix, CardLastFour, CardType, Data, TestMode, Email,
      Token, CardExpDate, DateTime,
    } = req.body;

    const metadata = typeof Data === 'string' ? (() => { try { return JSON.parse(Data); } catch { return Data; } })() : Data;
    const cardInfo = CardFirstSix && CardLastFour ? `${CardFirstSix}****${CardLastFour} (${CardType || ''})` : null;
    const payerEmail = (typeof Email === 'string' && Email.includes('@')) ? Email.trim() : null;
    const transactionId = String(TransactionId);

    log.info('Pay webhook received', {
      invoiceId: InvoiceId, amount: Amount, currency: Currency,
      transactionId, testMode: TestMode, card: cardInfo,
    });

    // ─── Idempotency: prevent double-processing of the same webhook ────
    const idemResult = await withWebhookIdempotency(
      'pay',
      transactionId,
      InvoiceId || null,
      async (client) => {
        // ── Branch 0a: Card-change верификация (1₽) — SUBCC-<changeId> ──
        // Сохраняем новый токен/last4/type; рекуррент НЕ активируем (это не оплата периода).
        // Возврат 1₽ — в post-side-effects (внешний CP-вызов вне транзакции).
        if (typeof InvoiceId === 'string' && InvoiceId.startsWith('SUBCC-')) {
          const changeId = InvoiceId.slice('SUBCC-'.length);
          if (Token) {
            await storeVerifiedCard(changeId, {
              token: String(Token),
              last4: CardLastFour ? String(CardLastFour) : null,
              type: CardType ? String(CardType) : null,
              transactionId,
            });
          } else {
            log.warn('Pay: card-change verified without Token', { changeId, transactionId });
          }
          return { branch: 'card_change' as const, changeId };
        }

        // ── Branch 0: Payment links (CRM-created pre-order URLs) ──────
        const linkResult = await client.query<PaymentLinkPayRow>(
          `UPDATE payment_links
           SET status = 'paid',
               paid_at = NOW(),
               payment_id = $1,
               payment_method = $2,
               payment_card_info = $3,
               contact_email = COALESCE($4, contact_email),
               updated_at = NOW()
           WHERE order_ref = $5 AND status = 'pending'
           RETURNING id, order_ref, amount::text AS amount,
                     payment_method,
                     employee_shift_id,
                     COALESCE(created_by, (SELECT assigned_operator_id FROM conversations WHERE id = payment_links.conversation_id)) AS created_by,
                     conversation_id, contact_name, contact_phone, services, student_id_photo_promo,
                     (SELECT contact_id FROM conversations WHERE id = payment_links.conversation_id) AS contact_id`,
          [transactionId, 'online', cardInfo, payerEmail, InvoiceId],
        );
        const paidLink = linkResult.rows[0];
        if (paidLink) {
          // Акция «Фото на студенческий 4×200»: списываем пакет при онлайн-оплате счёта
          // (атомарно с пометкой paid; идемпотентно по (account, period_key)).
          const promoSnap = paidLink.student_id_photo_promo;
          if (promoSnap?.studentAccountId) {
            await recordStudentIdPhotoPromoForReceiptWithClient(client, {
              receiptId: null,
              studentAccountId: promoSnap.studentAccountId,
              userId: promoSnap.userId,
              periodKey: promoSnap.periodKey,
              units: promoSnap.units,
              unitPrice: promoSnap.unitPrice,
              discountAmount: promoSnap.discountAmount,
              customerPhone: paidLink.contact_phone ?? null,
              paymentLinkId: paidLink.id,
              source: 'online',
            });
          }
          return { branch: 'payment_link' as const, link: paidLink };
        }

        // ── Branch 1: Photo print orders (order_id = InvoiceId) ──────
        const updateResult = await client.query<PhotoPrintOrderPaymentRow>(
          `UPDATE photo_print_orders
           SET status = 'paid',
               payment_status = 'paid',
               payment_id = $1,
               payment_amount = $2,
               paid_at = NOW(),
               payment_card_info = $3,
               contact_email = COALESCE($4, contact_email)
           WHERE order_id = $5 AND status = 'pending_payment'
           RETURNING *`,
          [transactionId, Amount, cardInfo, payerEmail, InvoiceId],
        );
        const updated = updateResult.rows[0];

        if (updated) {
          return { branch: 'print_order' as const, order: updated };
        }

        // ── Branch 2: Subscription first payment (SUB-* prefix or raw UUID) ─
        const isSubByPrefix = typeof InvoiceId === 'string' && InvoiceId.startsWith('SUB-');
        const subLookupId = isSubByPrefix ? InvoiceId.replace('SUB-', '') : InvoiceId;
        if (isSubByPrefix || (typeof InvoiceId === 'string' && metadata?.type === 'subscription')) {
          const subPayment = await activateOrRenewSubscriptionPayment({
            subscriptionId: String(subLookupId),
            providerSubscriptionId: metadata?.cpSubscriptionId || metadata?.cloudpaymentsSubscriptionId || null,
            transactionId,
            amount: parseFloat(Amount) || 0,
            currency: Currency || 'RUB',
            kind: 'initial',
            paidAt: DateTime || new Date(),
            providerToken: Token || null,
            rawPayload: req.body,
          }, client);

          if (subPayment.reason === 'subscription_not_found') {
            return { branch: 'subscription_not_found' as const };
          }
          return { branch: 'subscription' as const, subId: subPayment.subscription?.id || String(subLookupId), subPayment };
        }

        // ── Branch 3: General orders table (app orders, UUID InvoiceId) ─
        const appResult = await client.query<AppOrderPaymentRow>(
          `UPDATE orders SET status = 'processing', payment_status = 'paid',
           metadata = metadata || $1::jsonb, updated_at = NOW()
           WHERE id::text = $2 AND status = 'pending_payment' RETURNING *`,
          [JSON.stringify({ payment: { transactionId, amount: Amount, cardInfo, paidAt: new Date().toISOString() } }), InvoiceId],
        );
        const appOrder = appResult.rows[0];

        if (appOrder) {
          return { branch: 'app_order' as const, order: appOrder };
        }

        return { branch: 'not_found' as const };
      },
    );

    // ─── Duplicate webhook → return cached response ─────────────────────
    if (idemResult.duplicate) {
      log.info('Duplicate pay webhook, returning cached response', { transactionId, invoiceId: InvoiceId });
      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'duplicate',
        severity: 'info',
        entityType: 'cloudpayments_transaction',
        entityId: transactionId,
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          provider: 'cloudpayments',
        },
      });
      res.json(idemResult.cachedResponse);
      return;
    }

    // ─── Post-transaction side-effects (enqueued via BullMQ) ────────────
    const { result } = idemResult;

    if (result.branch === 'payment_link') {
      const paidLink = result.link;
      const linkAmount = parseFloat(paidLink.amount);
      const paymentMethodLabel = 'online';

      paymentLinksPaidTotal.inc({ method: paymentMethodLabel });
      log.info(`[Payments] payment_link ${paidLink.order_ref} paid`, {
        amount: linkAmount, conversationId: paidLink.conversation_id,
      });

      // Amount mismatch warning (деньги уже списаны, только логируем)
      const paidAmount = parseFloat(Amount);
      if (!isNaN(linkAmount) && !isNaN(paidAmount) && Math.abs(linkAmount - paidAmount) > 0.01) {
        log.error('PAY AMOUNT MISMATCH (payment_link)', {
          invoiceId: InvoiceId, expected: linkAmount, paid: paidAmount,
        });
        recordBusinessEvent({
          domain: 'payments',
          event: 'cloudpayments.amount_mismatch',
          outcome: 'failure',
          severity: 'critical',
          entityType: 'payment_link',
          entityId: String(paidLink.id),
          orderId: String(InvoiceId || ''),
          chatSessionId: paidLink.conversation_id ?? null,
          paymentId: transactionId,
          metadata: {
            branch: 'payment_link',
            expectedAmount: linkAmount,
            paidAmount,
          },
          alert: {
            key: `cloudpayments:${transactionId}:payment_link_amount_mismatch`,
            title: 'CloudPayments payment link amount mismatch',
          },
        });
      }

      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'success',
        severity: 'info',
        entityType: 'payment_link',
        entityId: String(paidLink.id),
        orderId: paidLink.order_ref,
        chatSessionId: paidLink.conversation_id ?? null,
        paymentId: transactionId,
        metadata: {
          branch: 'payment_link',
          amount: linkAmount,
          method: paymentMethodLabel,
        },
      });

      let employeeForCommission = paidLink.created_by;
      if (!employeeForCommission && !paidLink.employee_shift_id) {
        const activeShift = await db.queryOne<ActiveShiftLookup>(
          `SELECT employee_id FROM employee_shifts
           WHERE shift_date = CURRENT_DATE
             AND status IN ('active', 'scheduled')
           ORDER BY checked_in_at DESC NULLS LAST
           LIMIT 1`,
        );
        employeeForCommission = activeShift?.employee_id ?? null;
      }

      if ((employeeForCommission || paidLink.employee_shift_id) && linkAmount > 0) {
        try {
          await recordAttributedOnlineEmployeeSale(req, {
            receiptId: paidLink.id,
            employeeId: employeeForCommission ? String(employeeForCommission) : null,
            shiftId: paidLink.employee_shift_id,
            amount: linkAmount,
          });
        } catch (e) {
          log.warn('Payment link commission recording failed', {
            paymentLinkId: paidLink.id,
            orderRef: paidLink.order_ref,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Customer confirmation + operator notification in chat
      if (paidLink.conversation_id) {
        try {
          await sendPaymentLinkPaidCustomerMessage(req, paidLink, linkAmount);
        } catch (msgErr) {
          log.warn('[Payments] payment_link customer confirmation failed', {
            error: msgErr instanceof Error ? msgErr.message : String(msgErr),
          });
        }

        const interactive = {
          type: 'buttons' as const,
          step: 'payment_link_paid' as const,
          buttons: [
            {
              id: 'create_order_from_link',
              label: 'Создать заказ',
              value: 'create_order_from_link',
              data: {
                paymentLinkId: paidLink.id,
                orderRef: paidLink.order_ref,
                amount: linkAmount,
              },
            },
          ],
        };
        const notifyContent = `\u2705 Клиент оплатил ${linkAmount}\u20BD по ссылке ${paidLink.order_ref}. Создайте заказ.`;
        const notifyPaidAt = new Date().toISOString();
        const notifyPaymentMethod = 'online';
        try {
          const notifyMessage = await db.queryOne<BroadcastableMessage>(
            `INSERT INTO messages
              (conversation_id, sender_type, sender_name, message_type, content, metadata)
             VALUES ($1, 'system', 'Система', 'interactive', $2, $3)
             RETURNING *`,
            [
              paidLink.conversation_id,
              notifyContent,
              JSON.stringify({
                interactive,
                payment: {
                  source: 'payment_link',
                  status: 'paid',
                  method: notifyPaymentMethod,
                  amount: linkAmount,
                  paymentLinkId: paidLink.id,
                  orderRef: paidLink.order_ref,
                  paidAt: notifyPaidAt,
                },
              }),
            ],
          );
          if (notifyMessage) {
            await broadcastChatMessage({
              sessionId: paidLink.conversation_id,
              message: notifyMessage,
            });
          }
        } catch (msgErr) {
          log.warn('[Payments] payment_link chat notification failed', {
            error: msgErr instanceof Error ? msgErr.message : String(msgErr),
          });
        }
      }

      const wsPayload = {
        id: paidLink.id,
        paymentLinkId: paidLink.id,
        orderRef: paidLink.order_ref,
        amount: linkAmount,
        conversationId: paidLink.conversation_id,
        contactId: paidLink.contact_id,
        contactName: paidLink.contact_name,
        contactPhone: paidLink.contact_phone,
        status: 'paid',
        method: paymentMethodLabel,
      };
      broadcastToRoom('payment-link:paid', 'admin:visitor-chats', wsPayload);
      if (paidLink.conversation_id) {
        broadcastToRoom('payment-link:paid', `visitor:${paidLink.conversation_id}`, wsPayload);
        broadcastToRoom('chat:inbox-updated', 'admin:visitor-chats', {
          conversationId: paidLink.conversation_id,
        });
      }

    } else if (result.branch === 'print_order') {
      const updated = result.order;
      const chatSessionId = typeof updated.chat_session_id === 'string' ? updated.chat_session_id : null;
      log.info(`Order ${InvoiceId} marked as paid`);

      // Amount mismatch warning (деньги уже списаны, только логируем)
      const expectedAmount = parseFloat(String(updated.total_price));
      const paidAmount = parseFloat(Amount);
      if (!isNaN(expectedAmount) && !isNaN(paidAmount) && Math.abs(expectedAmount - paidAmount) > 0.01) {
        log.error('PAY AMOUNT MISMATCH', { invoiceId: InvoiceId, expected: expectedAmount, paid: paidAmount });
        recordBusinessEvent({
          domain: 'payments',
          event: 'cloudpayments.amount_mismatch',
          outcome: 'failure',
          severity: 'critical',
          entityType: 'photo_print_order',
          entityId: String(updated.id),
          orderId: String(InvoiceId || ''),
          chatSessionId,
          paymentId: transactionId,
          metadata: {
            branch: 'print_order',
            expectedAmount,
            paidAmount,
          },
          alert: {
            key: `cloudpayments:${transactionId}:print_order_amount_mismatch`,
            title: 'CloudPayments print order amount mismatch',
          },
        });
      }

      // Real-time socket event (fast, non-critical)
      try {
        const io = req.app.socketServer?.getIO();
        if (io) {
          io.to('admin:visitor-chats').emit('order:paid', {
            orderId: InvoiceId, amount: Amount, contactName: updated.contact_name,
          });
          // Notify visitor widget so payment card updates instantly
          if (chatSessionId) {
            io.to(`visitor:${chatSessionId}`).emit('order:paid', {
              orderId: InvoiceId, amount: parseFloat(Amount),
            });
          }
        }
      } catch (_e) { /* socket not available */ }

      // CRM event queue (already has its own retry)
      enqueueCrmEvent('order', InvoiceId, 'order_paid', {
        status: 'paid',
        sort_time: new Date().toISOString(),
      }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

      // ── Enqueue all post-payment side-effects via BullMQ ──────────
      const isChatOrder = !!chatSessionId || (typeof InvoiceId === 'string' && InvoiceId.startsWith('chat-'));
      const items = typeof updated.items === 'string' ? JSON.parse(updated.items as string) as unknown[] : (updated.items as unknown[]) || [];
      const serviceName = serviceNameFromItems(items);

      const paymentData: OrderPaymentData = {
        orderId: InvoiceId,
        orderDbId: String(updated.id),
        amount: paidAmount,
        paymentMethod: 'online',
        cardInfo,
        payerEmail,
        transactionId,
        contactName: updated.contact_name || null,
        contactPhone: updated.contact_phone || null,
        contactEmail: updated.contact_email || null,
        chatSessionId,
        isChatOrder,
        items,
        serviceName,
        priority: (updated.priority as string) || 'normal',
        deliveryMethod: updated.delivery_method || null,
        deliveryAddress: (updated.delivery_address as string) || null,
        deliveryProvider: deliveryProviderFromOrder(updated),
        partnerPromoCode: (updated.partner_promo_code as string) || null,
        mode: updated.mode || null,
        totalPrice: parseFloat(String(updated.total_price)),
        telegramUserId: updated.telegram_user_id ? String(updated.telegram_user_id) : null,
        telegramUsername: (updated.telegram_username as string) || null,
        orderData: updated,
        token: (Token as string) || null,
        cardFirstSix: (CardFirstSix as string) || null,
        cardLastFour: (CardLastFour as string) || null,
        cardType: (CardType as string) || null,
        cardExpDate: (CardExpDate as string) || null,
        receiptUrl: (updated.receipt_url as string) || null,
        createdAt: String(updated.created_at),
      };

      await enqueuePostPaymentJobs(paymentData);

      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'success',
        severity: 'info',
        entityType: 'photo_print_order',
        entityId: String(updated.id),
        orderId: String(InvoiceId || ''),
        chatSessionId,
        paymentId: transactionId,
        metadata: {
          branch: 'print_order',
          amount: paidAmount,
          isChatOrder,
          serviceName,
        },
      });

      // Record online sale for commission tracking (fallback to initiated_by → active shift employee)
      let employeeForCommission = updated.assigned_employee_id || updated.initiated_by;

      // Fallback: find active shift employee for today (site orders without assignment)
      if (!employeeForCommission && !updated.employee_shift_id) {
        const activeShift = await db.queryOne<ActiveShiftLookup>(
          `SELECT employee_id FROM employee_shifts
           WHERE shift_date = CURRENT_DATE
             AND status IN ('active', 'scheduled')
           ORDER BY checked_in_at DESC NULLS LAST
           LIMIT 1`,
        );
        if (activeShift) {
          employeeForCommission = activeShift.employee_id;
          log.info('Online sale attributed to active shift employee (fallback)', {
            orderId: InvoiceId, employeeId: activeShift.employee_id,
          });
        }
      }

      if (employeeForCommission || updated.employee_shift_id) {
        try {
          await recordAttributedOnlineEmployeeSale(req, {
            receiptId: String(updated.id),
            employeeId: employeeForCommission ? String(employeeForCommission) : null,
            shiftId: updated.employee_shift_id,
            amount: paidAmount,
          });
        } catch (e) {
          log.warn('Online sale commission recording failed', { orderId: InvoiceId, err: e instanceof Error ? e.message : String(e) });
        }
      }
    } else if (result.branch === 'subscription') {
      log.info(`Subscription ${InvoiceId} payment handled`, {
        amount: Amount,
        subscriptionId: result.subId,
        duplicate: result.subPayment.duplicate,
        reason: result.subPayment.reason,
        creditsIssued: result.subPayment.creditsIssued,
      });
      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'success',
        severity: 'info',
        entityType: 'subscription',
        entityId: result.subId,
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          branch: 'subscription',
          amount: parseFloat(Amount) || 0,
          duplicate: !!result.subPayment.duplicate,
          reason: result.subPayment.reason ?? null,
          creditsIssued: result.subPayment.creditsIssued ?? null,
        },
      });
      try {
        req.app.socketServer?.getIO().to('admin:visitor-chats').emit('subscription:activated', {
          subscriptionId: result.subId, amount: Amount,
        });
      } catch (_e) { /* socket not available */ }
    } else if (result.branch === 'app_order') {
      log.info(`App order ${InvoiceId} marked as paid`);

      // Amount mismatch warning for app orders (деньги уже списаны, только логируем)
      const appExpectedAmount = parseFloat(String(result.order['total_amount']));
      const appPaidAmount = parseFloat(Amount);
      if (!isNaN(appExpectedAmount) && !isNaN(appPaidAmount) && Math.abs(appExpectedAmount - appPaidAmount) > 1) {
        log.error('PAY AMOUNT MISMATCH (app_order)', { invoiceId: InvoiceId, expected: appExpectedAmount, paid: appPaidAmount });
        recordBusinessEvent({
          domain: 'payments',
          event: 'cloudpayments.amount_mismatch',
          outcome: 'failure',
          severity: 'critical',
          entityType: 'app_order',
          entityId: String(result.order.id ?? InvoiceId ?? ''),
          orderId: String(InvoiceId || ''),
          paymentId: transactionId,
          metadata: {
            branch: 'app_order',
            expectedAmount: appExpectedAmount,
            paidAmount: appPaidAmount,
          },
          alert: {
            key: `cloudpayments:${transactionId}:app_order_amount_mismatch`,
            title: 'CloudPayments app order amount mismatch',
          },
        });
      }

      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'success',
        severity: 'info',
        entityType: 'app_order',
        entityId: String(result.order.id ?? InvoiceId ?? ''),
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          branch: 'app_order',
          amount: appPaidAmount,
        },
      });

      // Attribution for app orders (simple fire-and-forget, no BullMQ needed for now)
      const appOrder = result.order;
      const orderMeta = parseAppOrderPaymentMetadata(appOrder.metadata);
      const fingerprintId = orderMeta.fingerprint_visitor_id;
      const appServices = appOrderServicesFromMetadataItems(orderMeta.items);

      let appPhone: string | undefined;
      let appEmail: string | undefined;
      if (appOrder.client_id) {
        const client = await db.queryOne<PaymentUserContactRow>(
          'SELECT phone, email FROM users WHERE id = $1',
          [appOrder.client_id],
        );
        appPhone = client?.phone || undefined;
        appEmail = client?.email || undefined;
      }
      fetch(`${config.bridge.url}/api/bridge/save-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Amount,
          phone: appPhone,
          email: appEmail,
          fingerprint_visitor_id: fingerprintId || undefined,
          source: 'cloudpayments',
          source_id: InvoiceId,
          services: appServices,
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(err => log.warn('Attribution Bridge API error', { error: err instanceof Error ? err.message : String(err) }));
    } else if (result.branch === 'card_change') {
      // Карта верифицирована (1₽). Токен уже сохранён в callback. Возвращаем 1₽ best-effort.
      log.info(`Card-change ${result.changeId} verified (1₽), refunding`, { transactionId });
      void refundVerification(transactionId);
      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'success',
        severity: 'info',
        entityType: 'subscription_card_change',
        entityId: result.changeId,
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          branch: 'card_change',
          amount: parseFloat(Amount) || 0,
        },
      });
    } else if (result.branch === 'subscription_not_found') {
      log.warn(`Subscription ${InvoiceId} not found in pending state`);
      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'failure',
        severity: 'critical',
        entityType: 'subscription',
        entityId: String(InvoiceId || ''),
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          branch: 'subscription_not_found',
          amount: parseFloat(Amount) || 0,
        },
        alert: {
          key: `cloudpayments:${transactionId}:subscription_not_found`,
          title: 'CloudPayments subscription not found',
        },
      });
    } else {
      log.warn(`Pay: order ${InvoiceId} not updated (already processed or not found)`);
      recordBusinessEvent({
        domain: 'payments',
        event: 'cloudpayments.pay',
        outcome: 'failure',
        severity: 'critical',
        entityType: 'payment',
        entityId: transactionId,
        orderId: String(InvoiceId || ''),
        paymentId: transactionId,
        metadata: {
          branch: 'not_found',
          amount: parseFloat(Amount) || 0,
        },
        alert: {
          key: `cloudpayments:${transactionId}:order_not_found`,
          title: 'CloudPayments paid order not found',
        },
      });
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-pay' }, level: 'fatal' });
    log.error('Pay webhook error', { error: error instanceof Error ? error.message : String(error) });
    recordBusinessEvent({
      domain: 'payments',
      event: 'cloudpayments.pay',
      outcome: 'failure',
      severity: 'critical',
      entityType: 'payment',
      entityId: String(req.body?.TransactionId || ''),
      orderId: String(req.body?.InvoiceId || ''),
      paymentId: String(req.body?.TransactionId || ''),
      error,
      metadata: {
        branch: 'handler_error',
      },
      alert: {
        key: `cloudpayments:${String(req.body?.TransactionId || 'unknown')}:handler_error`,
        title: 'CloudPayments pay webhook error',
      },
    });
    res.json({ code: 0 }); // Always confirm to avoid retries
  }
});

/**
 * Fail уведомление — вызывается при неуспешной оплате.
 */
router.post('/fail', async (req: Request, res: Response) => {
  try {
    const { TransactionId, Amount, InvoiceId, Reason, ReasonCode } = req.body;
    const transactionId = String(TransactionId);

    log.info('Fail webhook received', {
      transactionId, amount: Amount, invoiceId: InvoiceId,
      reason: Reason, reasonCode: ReasonCode,
    });

    if (InvoiceId) {
      // ─── Idempotency: prevent double-processing ──────────────────
      const idemResult = await withWebhookIdempotency(
        'fail',
        transactionId,
        InvoiceId,
        async (client) => {
          const updateResult = await client.query<PhotoPrintOrder>(
            `UPDATE photo_print_orders
             SET status = 'payment_failed',
                 payment_status = 'failed',
                 fail_reason = $1
             WHERE order_id = $2 AND status IN ('pending_payment', 'payment_failed')
             RETURNING *`,
            [`${Reason || 'Unknown'} (code: ${ReasonCode || '?'})`, InvoiceId],
          );
          const updated = updateResult.rows[0];

          if (updated) {
            return { branch: 'print_order' as const, order: updated };
          }

          // Fallback: general orders table
          await client.query(
            `UPDATE orders SET status = 'payment_failed', payment_status = 'failed',
             metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
             WHERE id::text = $2 AND status = 'pending_payment'`,
            [JSON.stringify({ failReason: Reason, failCode: ReasonCode }), InvoiceId],
          );
          return { branch: 'app_order' as const };
        },
      );

      if (idemResult.duplicate) {
        log.info('Duplicate fail webhook, returning cached response', { transactionId, invoiceId: InvoiceId });
        res.json(idemResult.cachedResponse);
        return;
      }

      // Post-transaction side-effects
      const { result } = idemResult;
      if (result.branch === 'print_order') {
        const updated = result.order;
        const isChatOrder = typeof InvoiceId === 'string' && InvoiceId.startsWith('chat-');
        if (isChatOrder) {
          notifyChatOrderFailedService(
            updated.chat_session_id as string,
            updated,
            Reason,
          ).catch(err =>
            log.error('Chat fail notification error', { error: err instanceof Error ? err.message : String(err), invoiceId: InvoiceId }),
          );

          // Analytics tracking
          if (updated.chat_session_id) {
            const failSession = await db.queryOne<ConversationVisitorRow>(
              'SELECT visitor_id FROM conversations WHERE id = $1',
              [updated.chat_session_id],
            );
            fetch(`${config.bridge.url}/api/bridge/track-order-event`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event_type: 'payment_failed',
                order_id: InvoiceId,
                order_source: 'chat_order',
                amount: Amount,
                fingerprint_visitor_id: failSession?.visitor_id?.startsWith('sf_') ? failSession.visitor_id : undefined,
                metadata: { reason: Reason, code: ReasonCode },
              }),
              signal: AbortSignal.timeout(10_000),
            }).catch(err => log.warn('Funnel track payment_failed error', { error: err instanceof Error ? err.message : String(err) }));
          }
        }
      }
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-fail' }, level: 'error' });
    log.error('Fail webhook error', { error: error instanceof Error ? error.message : String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Публичная страница фискального чека.
 *
 * CloudKassir не требует e-mail клиента для получения чека: берём receipt Id,
 * сохранённый из Receipt webhook, и подтягиваем детализацию через KKT API.
 */
router.get('/fiscal-receipt/:orderId', paymentLimiter, async (req: Request, res: Response) => {
  const orderId = req.params['orderId'];
  if (!orderId) {
    res.status(400).type('html').send(renderReceiptInfoPage('Чек не найден', 'В ссылке не указан номер заказа.'));
    return;
  }

  try {
    const order = await db.queryOne<FiscalReceiptOrderLookupRow>(
      `SELECT order_id, total_price, receipt_url, created_at
       FROM photo_print_orders
       WHERE order_id = $1`,
      [orderId],
    );

    if (!order) {
      res.status(404).type('html').send(renderReceiptInfoPage('Чек не найден', 'Заказ с таким номером не найден.'));
      return;
    }

    const receiptId = resolveFiscalReceiptId(order.receipt_url, req.query['receiptId']);
    if (!receiptId) {
      const externalUrl = safeExternalReceiptUrl(order.receipt_url);
      if (externalUrl) {
        res.redirect(302, externalUrl);
        return;
      }

      res.status(202).type('html').send(renderReceiptInfoPage(
        'Чек формируется',
        'Фискальный чек ещё не пришёл от CloudKassir. Обычно это занимает меньше пары минут.',
      ));
      return;
    }

    const model = await fetchCloudKassirReceiptModel(receiptId);
    if (!model) {
      res.status(202).type('html').send(renderReceiptInfoPage(
        'Чек пока недоступен',
        'CloudKassir ещё не вернул детализацию фискального чека. Попробуйте открыть чек чуть позже.',
      ));
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.type('html').send(renderFiscalReceiptPage({ order, receiptId, model }));
  } catch (error: unknown) {
    log.error('[CloudKassir] receipt page error', {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).type('html').send(renderReceiptInfoPage(
      'Чек временно недоступен',
      'Не удалось получить данные чека от CloudKassir. Попробуйте открыть чек позже.',
    ));
  }
});

/**
 * Receipt уведомление — вызывается после формирования онлайн-чека.
 */
router.post('/receipt', async (req: Request, res: Response) => {
  try {
    const { Id, TransactionId, InvoiceId, Url, Amount, Type } = req.body;

    log.info('[CloudPayments] Receipt:', {
      orderId: InvoiceId,
      receiptId: Id,
      transactionId: TransactionId,
      amount: Amount,
      url: Url,
      type: Type,
    });

    if (InvoiceId && (Id || Url)) {
      const invoiceId = String(InvoiceId);
      const receiptUrl = Id
        ? buildFiscalReceiptUrl(invoiceId, String(Id))
        : String(Url);
      await db.queryOne(
        'UPDATE photo_print_orders SET receipt_url = $1 WHERE order_id = $2',
        [receiptUrl, invoiceId]
      );
      // Fallback: general orders table
      if (Url) {
        await db.query(
          `UPDATE orders SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{receipt_url}', $1::jsonb)
           WHERE id::text = $2`,
          [JSON.stringify(String(Url)), invoiceId]
        );
      }
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-receipt' }, level: 'error' });
    log.error('[CloudPayments] Receipt error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Confirm уведомление — подтверждение двухстадийного платежа.
 *
 * Вызывается при подтверждении (capture) холдированного платежа.
 * Актуально если в будущем перейдём на paymentSchema: 'Auth' (двухстадийная).
 * Сейчас используем Single, но endpoint готов.
 */
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const {
      TransactionId,
      Amount,
      Currency,
      InvoiceId,
      AccountId,
      Email,
      DateTime,
      CardFirstSix,
      CardLastFour,
      Data,
      TestMode,
    } = req.body;

    let metadata: unknown = Data;
    if (typeof Data === 'string') {
      try { metadata = JSON.parse(Data); } catch { metadata = {}; }
    }

    log.info('[CloudPayments] Confirm notification:', {
      transactionId: TransactionId,
      amount: Amount,
      currency: Currency,
      orderId: InvoiceId,
      email: Email,
      card: CardFirstSix && CardLastFour ? `${CardFirstSix}****${CardLastFour}` : 'N/A',
      testMode: TestMode,
      metadata,
    });

    if (InvoiceId) {
      const updated = await db.queryOne<PaymentIdRow>(
        `UPDATE photo_print_orders SET payment_status = 'confirmed', updated_at = NOW()
         WHERE order_id = $1 AND payment_status = 'paid' RETURNING id`,
        [InvoiceId],
      );
      if (updated) {
        log.info(`[CloudPayments] ✅ Заказ ${InvoiceId} подтверждён (двухстадийный)`);
      }
    }

    log.info(`[CloudPayments] ✅ Платёж ${TransactionId} подтверждён: ${Amount} ${Currency}`);

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-confirm' }, level: 'error' });
    log.error('[CloudPayments] Confirm error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Kkt уведомление — изменение статуса онлайн-кассы (CloudKassir).
 *
 * Вызывается при изменении статуса ККТ:
 * - Касса подключена / отключена
 * - Ошибка фискализации
 * - Смена статуса ОФД
 *
 * Полезно для мониторинга работоспособности кассы.
 */
router.post('/kkt', async (req: Request, res: Response) => {
  try {
    const {
      Id,            // ID кассы
      Title,         // Название
      State,         // Статус: Ready | Error | Offline и т.д.
      StateMessage,  // Описание статуса
      FiscalNumber,  // Фискальный номер
      DateTime,
    } = req.body;

    log.info('[CloudPayments] KKT notification:', {
      kktId: Id,
      title: Title,
      state: State,
      message: StateMessage,
      fiscalNumber: FiscalNumber,
      dateTime: DateTime,
    });

    // Мониторинг: логируем критические статусы
    if (State === 'Error' || State === 'Offline') {
      log.error(`[CloudPayments] ⚠️ ВНИМАНИЕ: Касса "${Title}" (${Id}) в состоянии ${State}: ${StateMessage}`);

      // Уведомить всех админов
      const admins = await db.query<NotificationUserRow>(
        `SELECT id FROM users WHERE role = 'admin' LIMIT 10`,
      );
      for (const admin of admins) {
        NotificationService.create({
          userId: admin.id,
          title: `Касса: ${State}`,
          body: `${Title}: ${StateMessage}`,
          type: 'system',
          data: { kktId: Id, state: State },
        });
      }
    } else {
      log.info(`[CloudPayments] 🧾 Касса "${Title}": ${State}`);
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-kkt' }, level: 'warning' });
    log.error('[CloudPayments] KKT error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * SbpToken уведомление — результат привязки счёта СБП.
 *
 * Вызывается при попытке привязки банковского счёта через СБП.
 * Привязка позволяет делать автоплатежи через СБП (без повторного сканирования QR).
 */
router.post('/sbp-token', async (req: Request, res: Response) => {
  try {
    const {
      TransactionId,
      Amount,
      Currency,
      InvoiceId,
      AccountId,
      Email,
      Token,           // Токен СБП для последующих платежей
      Status,          // Accepted | Declined
      StatusCode,
      Reason,
      ReasonCode,
      CardFirstSix,
      CardLastFour,
      Data,
    } = req.body;

    let metadata: unknown = Data;
    if (typeof Data === 'string') {
      try { metadata = JSON.parse(Data); } catch { metadata = {}; }
    }

    log.info('[CloudPayments] SBP Token notification:', {
      transactionId: TransactionId,
      accountId: AccountId,
      status: Status,
      token: Token ? `${Token.substring(0, 8)}...` : 'N/A',
      amount: Amount,
      email: Email,
      reason: Reason,
      metadata,
    });

    if (Status === 'Accepted' && Token) {
      log.info(`[CloudPayments] ✅ СБП-счёт привязан для ${AccountId}. Токен получен.`);

      if (AccountId) {
        const updated = await db.queryOne<PaymentIdRow>(
          `UPDATE user_subscriptions SET cloudpayments_token = $1, updated_at = NOW()
           WHERE id::text = $2 OR cloudpayments_subscription_id = $2
           RETURNING id`,
          [Token, AccountId],
        );
        if (updated) {
          log.info(`[CloudPayments] SBP-токен сохранён для подписки ${updated.id}`);
        }
      }
    } else {
      log.info(`[CloudPayments] ❌ Привязка СБП-счёта отклонена для ${AccountId}: ${Reason} (${ReasonCode})`);
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-sbp-token' }, level: 'error' });
    log.error('[CloudPayments] SBP Token error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Recurrent уведомление — изменение статуса подписки.
 *
 * Вызывается при:
 * - Создании подписки (Active)
 * - Успешном рекуррентном платеже
 * - Ошибке рекуррентного платежа
 * - Отмене подписки (Cancelled)
 * - Завершении подписки (Expired, Completed)
 */
router.post('/recurrent', async (req: Request, res: Response) => {
  try {
    const {
      Id,                  // ID подписки в CloudPayments
      AccountId,           // ID подписки в нашей системе
      TransactionId,
      LastTransactionId,
      Description,
      Email,
      Amount,
      Currency,
      RequireConfirmation, // нужно ли подтверждение
      StartDate,
      Interval,            // Day / Week / Month
      Period,              // частота (1 = каждый интервал)
      MaxPeriods,          // макс. кол-во списаний
      CurrencyCode,
      Status,              // Active | PastDue | Cancelled | Rejected | Expired | Completed
      SuccessfulTransactionsNumber,
      FailedTransactionsNumber,
      LastTransactionDate,
      NextTransactionDate,
    } = req.body;

    const successfulTransactions = Number(SuccessfulTransactionsNumber) || 0;
    const recurrentKind = successfulTransactions > 1 ? 'renewal' : 'initial';
    const recurrentProviderTransactionId = TransactionId || LastTransactionId || null;
    const recurrentEventKey = recurrentProviderTransactionId
      || (Id ? `${Id}:${Status || 'unknown'}:${SuccessfulTransactionsNumber || 0}:${LastTransactionDate || NextTransactionDate || ''}` : null);
    const recurrentPaidAt = LastTransactionDate || StartDate || new Date();

    log.info('[CloudPayments] Recurrent notification:', {
      subscriptionCloudId: Id,
      subscriptionId: AccountId,
      status: Status,
      amount: Amount,
      interval: `${Period} ${Interval}`,
      successfulPayments: SuccessfulTransactionsNumber,
      failedPayments: FailedTransactionsNumber,
      nextPayment: NextTransactionDate,
      email: Email,
    });

    // Обработка по статусу подписки
    switch (Status) {
      case 'Active': {
        log.info(`[CloudPayments] ✅ Подписка ${AccountId} активна. Следующий платёж: ${NextTransactionDate}`);

        const paymentResult = await activateOrRenewSubscriptionPayment({
          subscriptionId: String(AccountId || ''),
          providerSubscriptionId: Id ? String(Id) : null,
          transactionId: recurrentProviderTransactionId ? String(recurrentProviderTransactionId) : null,
          amount: parseFloat(Amount) || 0,
          currency: Currency || CurrencyCode || 'RUB',
          kind: recurrentKind,
          paidAt: recurrentPaidAt,
          nextPaymentDate: NextTransactionDate || null,
          rawPayload: req.body,
        });

        log.info('[CloudPayments] Recurrent active handled via subscription ledger', {
          subscriptionId: paymentResult.subscription?.id || AccountId,
          duplicate: paymentResult.duplicate,
          reason: paymentResult.reason,
          creditsIssued: paymentResult.creditsIssued,
        });
        break;
      }

      case 'PastDue': {
        log.info(`[CloudPayments] Subscription ${AccountId}: past due payment (attempt ${FailedTransactionsNumber})`);

        await activateOrRenewSubscriptionPayment({
          subscriptionId: String(AccountId || ''),
          providerSubscriptionId: Id ? String(Id) : null,
          transactionId: recurrentEventKey ? String(recurrentEventKey) : null,
          amount: parseFloat(Amount) || 0,
          currency: Currency || CurrencyCode || 'RUB',
          status: 'failed',
          kind: recurrentKind,
          paidAt: recurrentPaidAt,
          rawPayload: req.body,
        });

        const pastDueSub = await db.queryOne<SubscriptionOwnerRow>(
          `SELECT id, user_id FROM user_subscriptions
           WHERE id::text = $1 OR cloudpayments_subscription_id = $2`,
          [AccountId, String(Id)],
        );
        if (pastDueSub?.user_id) {
          NotificationService.create({
            userId: pastDueSub.user_id,
            title: 'Проблема с оплатой подписки',
            body: `Не удалось списать ${Amount}₽. Проверьте данные карты.`,
            type: 'system',
            data: { subscriptionId: pastDueSub.id },
          });
        }
        break;
      }

      case 'Cancelled':
      case 'Rejected': {
        log.info(`[CloudPayments] ${Status === 'Cancelled' ? '❌' : '🚫'} Подписка ${AccountId}: ${Status}`);

        await activateOrRenewSubscriptionPayment({
          subscriptionId: String(AccountId || ''),
          providerSubscriptionId: Id ? String(Id) : null,
          transactionId: recurrentEventKey ? String(recurrentEventKey) : null,
          amount: parseFloat(Amount) || 0,
          currency: Currency || CurrencyCode || 'RUB',
          status: Status === 'Rejected' ? 'failed' : 'cancelled',
          kind: recurrentKind,
          paidAt: recurrentPaidAt,
          rawPayload: req.body,
        });

        const cancelSub = await db.queryOne<CardChangeRecurrentSubscriptionRow>(
          `SELECT id, status, card_change_in_progress, cloudpayments_subscription_id
             FROM user_subscriptions
            WHERE id::text = $1 OR cloudpayments_subscription_id = $2`,
          [AccountId, String(Id)],
        );
        if (cancelSub) {
          // Guard от гонки смены карты (только для Cancelled) — чистое решение в хелпере.
          const guard = decideCardChangeCancelGuard(String(Status), String(Id), cancelSub);
          if (guard.ignore) {
            cardChangeIgnoredCancelledTotal.inc({ reason: guard.reason ?? 'unknown' });
            log.warn('[CardChange] ignored stale Cancelled recurrent webhook', {
              subscriptionId: cancelSub.id,
              reason: guard.reason,
              cancelledCpId: String(Id),
              currentCpId: cancelSub.cloudpayments_subscription_id,
              cardChangeInProgress: cancelSub.card_change_in_progress,
            });
            break;
          }
          await cancelSubscription(cancelSub.id, Status === 'Rejected' ? 'Отклонено банком' : undefined);
        }
        break;
      }

      case 'Expired':
      case 'Completed': {
        log.info(`[CloudPayments] 🏁 Подписка ${AccountId} завершена (${Status})`);

        await db.query(
          `UPDATE user_subscriptions SET status = 'expired', updated_at = NOW()
           WHERE id::text = $1 OR cloudpayments_subscription_id = $2`,
          [AccountId, String(Id)],
        );
        break;
      }

      default:
        log.info(`[CloudPayments] Подписка ${AccountId}: неизвестный статус ${Status}`);
    }

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-recurrent' }, level: 'error' });
    log.error('[CloudPayments] Recurrent error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Cancel уведомление — отмена платежа.
 */
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const {
      TransactionId,
      Amount,
      InvoiceId,
      AccountId,
      Email,
      Reason,
    } = req.body;

    log.info('[CloudPayments] Cancel notification:', {
      transactionId: TransactionId,
      amount: Amount,
      orderId: InvoiceId,
      accountId: AccountId,
      reason: Reason,
      email: Email,
    });

    if (InvoiceId) {
      const outcome = await cancelCloudPaymentsOrder(String(InvoiceId), TransactionId, Reason);

      if (outcome.branch === 'print_order') {
        log.info(`[CloudPayments] ❌ Заказ ${InvoiceId} и связанная задача отменены`, {
          restoredCredits: outcome.restoredCredits?.restored ?? 0,
          restoredEntries: outcome.restoredCredits?.entries ?? 0,
        });
      }
    }

    log.info(`[CloudPayments] ❌ Платёж ${TransactionId} отменён: ${Amount}₽`);

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-cancel' }, level: 'error' });
    log.error('[CloudPayments] Cancel error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * Refund уведомление — возврат платежа.
 */
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const {
      TransactionId,
      PaymentTransactionId, // ID оригинального платежа
      Amount,
      InvoiceId,
      AccountId,
      Email,
    } = req.body;

    log.info('[CloudPayments] Refund notification:', {
      refundTransactionId: TransactionId,
      originalTransactionId: PaymentTransactionId,
      amount: Amount,
      orderId: InvoiceId,
      email: Email,
    });

    if (InvoiceId) {
      const outcome = await refundCloudPaymentsOrder(String(InvoiceId), TransactionId);
      if (outcome.branch === 'print_order') {
        log.info('[CloudPayments] Print order refunded', {
          invoiceId: InvoiceId,
          restoredCredits: outcome.restoredCredits?.restored ?? 0,
          restoredEntries: outcome.restoredCredits?.entries ?? 0,
        });
      }
    }

    log.info(`[CloudPayments] 💸 Возврат ${Amount}₽ по заказу ${InvoiceId}`);

    res.json({ code: 0 });
  } catch (error: unknown) {
    captureException(error, { tags: { webhook: 'cloudpayments-refund' }, level: 'error' });
    log.error('[CloudPayments] Refund error:', { error: String(error) });
    res.json({ code: 0 });
  }
});

/**
 * POST /api/payments/sbp — создать СБП-ссылку для оплаты
 *
 * На мобильном → редирект в банковское приложение.
 * На десктопе  → можно показать QR-код (через /sbp/qr).
 *
 * Использует CloudPayments SBP API: https://api.cloudpayments.ru/payments/qr/sbp/link
 */
router.post('/sbp', paymentLimiter, validate(sbpPaymentSchema), async (req: Request, res: Response) => {
    const { amount, orderId, description, email, phone, receipt, successUrl } = req.body;

    const publicId = config.cloudPayments.publicId;
    const apiSecret = config.cloudPayments.apiSecret;

    if (!publicId || !apiSecret) {
      throw new AppError(500, 'Платёжная система не настроена', ErrorCode.PAYMENT_SYSTEM_NOT_CONFIGURED);
    }

    // Basic Auth: publicId:apiSecret
    const authHeader = 'Basic ' + Buffer.from(`${publicId}:${apiSecret}`).toString('base64');

    const sbpPayload: SbpPayloadJson = {
      PublicId: publicId,
      Amount: amount,
      Currency: 'RUB',
      Description: description || `Заказ ${orderId} — Своё Фото`,
      Scheme: 'charge', // одностадийная оплата
      TtlMinutes: 30,   // ссылка действует 30 минут
    };

    if (orderId) sbpPayload.InvoiceId = orderId;
    if (email) sbpPayload.AccountId = email;
    if (email) sbpPayload.Email = email;
    if (successUrl) sbpPayload.SuccessRedirectUrl = successUrl;

    const receiptData = receipt ?? buildSbpReceipt({ amount, description, orderId, email, phone });
    sbpPayload.JsonData = createCloudKassirJsonData(receiptData, { email, phone });

    log.info('[SBP] Creating payment link:', { amount, orderId, description });

    const response = await fetchWithCB(SERVICE_BREAKERS.cloudpayments, 'https://api.cloudpayments.ru/payments/qr/sbp/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(sbpPayload),
    });

    const data = await response.json();

    if (data.Success && data.Model?.QrUrl) {
      log.info(`[SBP] ✅ Ссылка создана: TransactionId=${data.Model.TransactionId}`);
      res.json({
        success: true,
        qrUrl: data.Model.QrUrl,
        transactionId: data.Model.TransactionId,
        providerQrId: data.Model.ProviderQrId,
      });
    } else {
      log.error('[SBP] ❌ Ошибка:', data.Message || data);
      throw new AppError(400, data.Message || 'Не удалось создать СБП-ссылку', ErrorCode.PAYMENT_SBP_FAILED);
    }
});

/**
 * POST /api/payments/sbp/qr — получить QR-код для СБП (десктоп)
 */
router.post('/sbp/qr', paymentLimiter, validate(sbpQrSchema), async (req: Request, res: Response) => {
    const { amount, orderId, description, email, phone, receipt } = req.body;

    const publicId = config.cloudPayments.publicId;
    const apiSecret = config.cloudPayments.apiSecret;

    if (!publicId || !apiSecret) {
      throw new AppError(500, 'Платёжная система не настроена', ErrorCode.PAYMENT_SYSTEM_NOT_CONFIGURED);
    }

    const authHeader = 'Basic ' + Buffer.from(`${publicId}:${apiSecret}`).toString('base64');

    const sbpPayload: SbpPayloadJson = {
      PublicId: publicId,
      Amount: amount,
      Currency: 'RUB',
      Description: description || `Заказ ${orderId} — Своё Фото`,
      Scheme: 'charge',
      TtlMinutes: 30,
    };

    if (orderId) sbpPayload.InvoiceId = orderId;
    if (email) sbpPayload.AccountId = email;
    if (email) sbpPayload.Email = email;

    const receiptData = receipt ?? buildSbpReceipt({ amount, description, orderId, email, phone });
    sbpPayload.JsonData = createCloudKassirJsonData(receiptData, { email, phone });

    const response = await fetchWithCB(SERVICE_BREAKERS.cloudpayments, 'https://api.cloudpayments.ru/payments/qr/sbp/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(sbpPayload),
    });

    const data = await response.json();

    if (data.Success && data.Model) {
      res.json({
        success: true,
        qrUrl: data.Model.QrUrl,
        qrImage: data.Model.QrImage, // base64 PNG
        transactionId: data.Model.TransactionId,
      });
    } else {
      throw new AppError(400, data.Message || 'Не удалось создать QR-код', ErrorCode.PAYMENT_QR_FAILED);
    }
});

/**
 * POST /api/payments/manual-chat-payment — зафиксировать ручную оплату в чате.
 */
router.post('/manual-chat-payment', paymentLimiter, authenticateToken, requirePermission('pos:use'), validate(manualChatPaymentSchema), async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized', ErrorCode.UNAUTHORIZED);
    }

    const { sessionId, amount, method, fiscalMode, receiptId, receiptNumber, phone, clientName } = req.body;
    const cartDetails = normalizePaymentLinkCartDetails(req.body.cartDetails);

    const conversation = await db.queryOne<ManualChatPaymentConversationRow>(
      `SELECT c.id::text AS id,
              c.contact_id::text AS contact_id,
              COALESCE(ct.display_name, client_u.display_name, c.visitor_name, $2) AS contact_name,
              COALESCE(ct.phone, client_u.phone, c.visitor_phone, $3) AS contact_phone
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, c.user_id)
       WHERE c.id = $1`,
      [sessionId, clientName ?? null, phone ?? null],
    );
    if (!conversation) {
      throw new AppError(404, 'Чат не найден');
    }

    const roundedAmount = Number(amount);
    const cashMethodLabel = fiscalMode === 'skip' ? 'наличные без фискализации' : 'наличные';
    const methodLabel = method === 'cash'
      ? cashMethodLabel
      : method === 'transfer'
        ? 'перевод'
        : method === 'sbp'
          ? 'СБП'
          : 'карта';
    const summary = formatPaymentCartSummary(cartDetails);
    const lines = [`\u2705 Приняты ${methodLabel}: ${formatRubles(roundedAmount)}`];
    if (receiptNumber) lines.push(`Чек: ${receiptNumber}`);
    if (summary) lines.push(summary);

    const paidAt = new Date().toISOString();
    const orderRef = receiptNumber ?? `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const metadata = {
      payment: {
        source: 'pos_receipt',
        status: 'paid',
        method,
        methodLabel,
        fiscalMode: fiscalMode ?? null,
        amount: roundedAmount,
        receiptId: receiptId ?? null,
        receiptNumber: receiptNumber ?? null,
        orderRef,
        paidAt,
        items: paymentCardItemsFromCart(cartDetails),
      },
    };

    const notifyMessage = await db.queryOne<BroadcastableMessage>(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_name, message_type, content, metadata)
       VALUES ($1, 'system', 'Система', 'system', $2, $3::jsonb)
       RETURNING *`,
      [sessionId, lines.join('\n'), JSON.stringify(metadata)],
    );
    if (!notifyMessage) {
      throw new Error('Failed to create manual payment chat message');
    }

    await broadcastChatMessage({ sessionId, message: notifyMessage });

    const wsPayload = {
      paymentLinkId: null,
      orderRef,
      amount: roundedAmount,
      conversationId: sessionId,
      contactId: conversation.contact_id,
      contactName: conversation.contact_name,
      contactPhone: conversation.contact_phone,
      method,
      status: 'paid',
    };
    broadcastToRoom('payment-link:paid', 'admin:visitor-chats', wsPayload);
    broadcastToRoom('payment-link:paid', `visitor:${sessionId}`, wsPayload);
    broadcastToRoom('chat:inbox-updated', 'admin:visitor-chats', { conversationId: sessionId });

    res.status(201).json({ success: true, message: notifyMessage });
});

router.post('/create-link', paymentLimiter, authenticateToken, requirePermission('pos:use'), validate(createPaymentLinkSchema), idempotent(60), async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized', ErrorCode.UNAUTHORIZED);
    }
    if (!config.featureFlags.paymentLinksEnabled) {
      paymentLinksBlockedByFlagTotal.inc();
      throw new AppError(503, 'Платёжные ссылки временно отключены', ErrorCode.PAYMENT_LINKS_DISABLED);
    }

    const { amount, description, phone, clientName, sessionId, services, autoSend } = req.body;
    let cartDetails = normalizePaymentLinkCartDetails(req.body.cartDetails);

    const operatorId = req.user.id;

    // Detailed request logging — trace duplicate order creation source
    log.info('[Payments] create-link request', {
      userId: operatorId,
      userName: req.user.display_name ?? null,
      userIp: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 120),
      sessionId: sessionId ?? null,
      amount,
      autoSend: autoSend ?? false,
      description: (description ?? '').slice(0, 80),
    });

    const pricing = await calculatePaymentLinkPricing(
      amount,
      services,
      {
        phone,
        clientUserId: req.body.clientUserId,
        clientContactId: req.body.clientContactId,
        sessionId,
      },
      req.body.promo_code,
      'create-link',
    );
    const total = pricing.total;
    if (pricing.cartDetails) cartDetails = pricing.cartDetails;

    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).substring(2, 8);
    const generatedOrderId = `SF-${ts}-${rnd}`.toUpperCase();

    const comments = buildPaymentLinkComments(services, total, description);
    const serviceItems = buildPaymentLinkServiceItemsForStorage(services, total, comments, cartDetails);

    const linkCreation = await db.transaction(async (client) => {
      const activeShift = await requireActiveEmployeeShiftForPaymentLink(client, operatorId);

      // Server-side dedup: same operator + same open workday + same chat + amount.
      if (sessionId) {
        const existingResult = await client.query<PaymentLinkDedupRow>(
          `SELECT id, order_ref FROM payment_links
           WHERE conversation_id = $1
             AND amount = $2
             AND created_by = $3
             AND employee_shift_id = $4
             AND status = 'pending'
             AND created_at > NOW() - INTERVAL '2 minutes'
           ORDER BY created_at DESC
           LIMIT 1`,
          [sessionId, total, operatorId, activeShift.id],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          return { orderId: existing.order_ref, deduplicated: true, supersededCount: 0 };
        }
      }

      const insertedResult = await client.query<PaymentLinkInsertRow>(
        `INSERT INTO payment_links
          (order_ref, amount, services, description, conversation_id,
           contact_phone, contact_name, created_by, employee_shift_id, student_id_photo_promo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, order_ref`,
        [
          generatedOrderId,
          total,
          JSON.stringify(serviceItems),
          comments,
          sessionId || null,
          (phone || '').trim() || null,
          (clientName || '').trim() || 'Клиент CRM',
          operatorId,
          activeShift.id,
          pricing.studentIdPhotoPromo ? JSON.stringify(pricing.studentIdPhotoPromo) : null,
        ],
      );
      const inserted = insertedResult.rows[0];
      if (!inserted) {
        throw new AppError(500, 'Не удалось создать ссылку на оплату');
      }
      const superseded = autoSend === true && sessionId
        ? await supersedePendingPaymentLinksForConversation(client, {
          conversationId: sessionId,
          employeeShiftId: activeShift.id,
          newPaymentLinkId: inserted.id,
          newOrderRef: inserted.order_ref,
        })
        : [];
      return { orderId: inserted.order_ref, deduplicated: false, supersededCount: superseded.length };
    });

    const orderId = linkCreation.orderId;
    if (linkCreation.deduplicated) {
      log.warn('[Payments] Duplicate payment_link prevented (multi-click)', {
        existingOrderRef: orderId,
        sessionId,
        amount: total,
        operatorId,
      });
      const paymentUrl = `https://svoefoto.ru/pay/${orderId}`;
      res.json({ success: true, data: { paymentUrl, orderId, amount: total, sent: false, deduplicated: true } });
      return;
    }

    paymentLinksCreatedTotal.inc({ channel: sessionId ? 'chat' : 'manual' });

    const paymentUrl = `https://svoefoto.ru/pay/${orderId}`;

    log.info(`[Payments] Payment link created: ${orderId}, amount: ${total}₽, phone: ${phone || 'n/a'}`);
    if (linkCreation.supersededCount > 0) {
      log.info('[Payments] Superseded stale pending payment links', {
        orderRef: orderId,
        sessionId,
        supersededCount: linkCreation.supersededCount,
      });
    }

    if (sessionId) {
      try {
        await syncPaymentLinkCart(req, sessionId, orderId, total, comments, cartDetails);
      } catch (error) {
        log.warn('[Payments] Failed to sync payment link cart', {
          error: String(error),
          sessionId,
          orderId,
        });
      }
    }

    // Auto-send payment message to chat session
    let sent = false;
    if (autoSend === true && sessionId) {
      const desc = comments;
      const interactive = {
        type: 'buttons',
        step: 'operator_payment',
        buttons: [buildWidgetPaymentButton(orderId, total, desc)],
      };

      const content = buildPaymentChatContent(total, cartDetails);

      const chatMessage = await db.queryOne<BroadcastableMessage>(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
         RETURNING *`,
        [sessionId, content, JSON.stringify({ interactive })],
      );
      if (!chatMessage) throw new Error('Failed to create payment chat message');

      // Notify visitor via WebSocket
      const socketServer = req.app.socketServer;
      if (socketServer) {
        const msgPayload = buildOperatorChatSocketPayload(sessionId, chatMessage, { interactive });
        socketServer.getIO().to(`visitor:${sessionId}`).emit('operator:message', msgPayload);
        await broadcastChatMessage({ sessionId, message: chatMessage });
      }

      // If session is in a messenger channel — enqueue outbound message
      const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
        `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
        [sessionId],
      );
      if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
        const serviceDesc = Array.isArray(services) && services.length > 0
          ? services.map((s: { name: string }) => s.name).join(', ')
          : (description || '');
        await enqueueOutbound({
          channel: conv.channel,
          externalChatId: conv.external_chat_id,
          content: buildPaymentOutboundContent(total, orderId, cartDetails, serviceDesc),
          messageType: 'text',
          conversationId: sessionId,
        });
      }

      sent = true;
    }

    res.json({ success: true, data: { paymentUrl, orderId, amount: total, sent } });
});

/**
 * POST /api/payments/create-order — создать заказ в БД перед оплатой через виджет.
 * Корзина вызывает этот endpoint перед открытием CloudPayments Widget,
 * чтобы /check и /pay webhook могли найти заказ.
 */
router.post('/create-order', paymentLimiter, optionalAuth, validate(createPaymentOrderSchema), idempotent(60), async (req: AuthRequest, res: Response) => {
    const { items, email, phone, chatSessionId, promoCode, promoDiscount, partnerPromoCode } = req.body;
    let total: number = Number(req.body.total);
    const staffPricing = isStaffRole(req.user?.role);
    const pricingPhone = await resolveCustomerPricingPhone({
      phone,
      clientUserId: staffPricing ? req.body.clientUserId : null,
      clientContactId: staffPricing ? req.body.clientContactId : null,
      sessionId: staffPricing ? chatSessionId : null,
    });

    // Server-side waterfall recalculate: if items have serviceOptionId (id field), verify price
    const typedItems = Array.isArray(items) ? items.filter(isPaymentLinkCreateServiceJson) : [];
    const waterfallItems = typedItems
      .filter(i => i.id && i.id !== 'manual' && i.id !== 'support-team')
      .map(i => {
        const printFillPercent = paymentLinkPrintFillPercent(i);
        return {
          serviceOptionId: i.id || '',
          quantity: Number(i.quantity) || 1,
          pricingGroupKey: typeof i.pricingGroupKey === 'string' ? i.pricingGroupKey : undefined,
          ...(printFillPercent !== undefined ? { printFillPercent } : {}),
        };
      });

    if (waterfallItems.length > 0) {
      try {
        const wfResult = await calculatePriceWaterfall({
          items: waterfallItems,
          customerPhone: pricingPhone ?? undefined,
          channel: 'online',
          promoCode: (promoCode || '').trim() || undefined,
        });

        const manualSum = typedItems
          .filter(i => !i.id || i.id === 'manual' || i.id === 'support-team')
          .reduce((sum, i) => sum + (Number(i.price ?? i.subtotal) || 0) * (Number(i.quantity) || 1), 0);

        const serverTotal = wfResult.total + manualSum;

        if (Math.abs(serverTotal - total) > 0.01) {
          log.warn('[Payments] create-order price mismatch — using server-calculated total', {
            clientTotal: total,
            serverTotal,
            waterfallTotal: wfResult.total,
            manualTotal: manualSum,
          });
        }
        total = serverTotal;
      } catch (err) {
        log.warn('[Payments] Waterfall recalculate failed for create-order, using client amount', { error: String(err) });
      }
    }

    // Server-side dedup: prevent duplicate widget orders (same session + amount within 2 min)
    if (chatSessionId) {
      const existing = await db.queryOne<Pick<PhotoPrintOrders, 'order_id'>>(
        `SELECT order_id FROM photo_print_orders
         WHERE chat_session_id = $1
           AND total_price = $2
           AND created_at > NOW() - INTERVAL '2 minutes'
           AND status IN ('pending_payment', 'processing', 'paid')
         ORDER BY created_at DESC
         LIMIT 1`,
        [chatSessionId, total],
      );
      if (existing) {
        log.warn('[Payments] Duplicate widget order prevented', {
          existingOrderId: existing.order_id,
          chatSessionId,
          amount: total,
        });
        res.json({ success: true, orderId: existing.order_id });
        return;
      }
    }

    // Генерируем orderId
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).substring(2, 8);
    const orderId = `SF-${ts}-${rnd}`.toUpperCase();

    // Validate partner promo code
    const partnerCode = (partnerPromoCode || '').trim() || null;
    let partnerId: number | null = null;
    if (partnerCode) {
      const partner = await validatePartnerPromoCode(partnerCode);
      if (partner) partnerId = partner.id;
    }
    const referralPhone = typeof phone === 'string' && phone.trim()
      ? phone.trim()
      : pricingPhone ?? undefined;

    // Extract tip from items (support-team item)
    const supportItem = typedItems.find((i) => {
      return i.service === 'Поддержать команду «Своё Фото»' || i.id === 'support-team';
    });
    const tipAmount = supportItem ? parseFloat(String(supportItem.price ?? supportItem.subtotal ?? 0)) : 0;

    // Сохраняем заказ
    await db.queryOne(
      `INSERT INTO photo_print_orders
        (order_id, mode, total_price, tip_amount, status, payment_status, contact_name, contact_phone, contact_email,
         comments, items, chat_session_id, promo_code, promo_discount, partner_promo_code)
       VALUES ($1, 'custom', $2, $3, 'pending_payment', 'none', $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING order_id`,
      [
        orderId,
        total,
        tipAmount,
        'Онлайн-клиент',
        (phone || '').trim(),
        (email || '').trim() || null,
        null,
        JSON.stringify(items),
        chatSessionId || null,
        (promoCode || '').trim() || null,
        promoDiscount || null,
        partnerCode,
      ]
    );

    // Fire-and-forget: record pending referral
    if (partnerId && partnerCode) {
      recordReferral({
        partner_id: partnerId,
        order_id: orderId,
        order_type: 'print',
        order_amount: total,
        promo_code: partnerCode,
        client_phone: referralPhone,
        status: 'pending',
      }).catch(err => log.error('[Payments] recordReferral failed', { error: String(err) }));
    }

    log.info(`[Payments] Order ${orderId} created for widget payment, total: ${total}₽${partnerCode ? ', partner: ' + partnerCode : ''}`);
    res.json({ success: true, orderId });
});

/**
 * POST /api/payments/confirm-subscription-from-widget — server-side subscription payment verification.
 *
 * The widget result only proves that the browser saw a successful payment.
 * The backend verifies the SUB-* invoice with CloudPayments before activating
 * the subscription and extending account entitlements.
 */
router.post(
  '/confirm-subscription-from-widget',
  authenticateToken,
  validate(confirmSubscriptionFromWidgetSchema),
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', ErrorCode.UNAUTHORIZED);
    }

    const subscriptionId = String(req.body.subscriptionId);
    const widgetTransactionId = req.body.transactionId != null
      ? String(req.body.transactionId)
      : null;

    const subscription = await db.queryOne<SubscriptionWidgetConfirmRow>(
      `SELECT id::text AS id,
              user_id::text AS user_id,
              status,
              monthly_price::text AS monthly_price,
              cloudpayments_subscription_id,
              cloudpayments_token
       FROM user_subscriptions
       WHERE id::text = $1`,
      [subscriptionId],
    );

    if (!subscription) {
      throw new AppError(404, 'Подписка не найдена', ErrorCode.NOT_FOUND);
    }

    const canManageSubscriptions = req.user.permissions?.includes('subscriptions:manage') ?? false;
    if (subscription.user_id !== req.user.id && !canManageSubscriptions) {
      throw new AppError(403, 'Нет доступа к этой подписке', ErrorCode.FORBIDDEN);
    }

    if (subscription.status === 'active' || subscription.status === 'paused') {
      res.json({
        success: true,
        status: 'already_processed',
        subscription_id: subscription.id,
      });
      return;
    }

    if (subscription.status !== 'pending') {
      log.warn('[CP-Verify] Subscription widget confirm called for unexpected status', {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      res.json({
        success: true,
        status: subscription.status ?? 'unknown',
        subscription_id: subscription.id,
      });
      return;
    }

    const invoiceId = `SUB-${subscription.id}`;
    const cpPayment = await findPaymentWithCloudPayments(invoiceId);

    if (!cpPayment || !isCloudPaymentsPaid(cpPayment)) {
      log.info(`[CP-Verify] CloudPayments did not confirm subscription ${invoiceId}`);
      res.json({
        success: true,
        status: 'pending_payment',
        subscription_id: subscription.id,
      });
      return;
    }

    const expectedAmount = Number.parseFloat(subscription.monthly_price);
    const paidAmount = Number(cpPayment.Amount);
    const currency = cpPayment.Currency || 'RUB';
    if (
      Number.isNaN(expectedAmount) ||
      Number.isNaN(paidAmount) ||
      Math.abs(expectedAmount - paidAmount) > 0.01 ||
      currency !== 'RUB'
    ) {
      log.error('[CP-Verify] Subscription payment mismatch', {
        subscriptionId: subscription.id,
        invoiceId,
        expectedAmount,
        paidAmount,
        currency,
      });
      res.json({
        success: true,
        status: 'pending_payment',
        subscription_id: subscription.id,
      });
      return;
    }

    const transactionId = readCloudPaymentsString(cpPayment.TransactionId)
      ?? widgetTransactionId;
    const providerSubscriptionId = readCloudPaymentsString(cpPayment.SubscriptionId)
      ?? subscription.cloudpayments_subscription_id
      ?? null;
    const providerToken = readCloudPaymentsString(cpPayment.Token)
      ?? subscription.cloudpayments_token
      ?? null;
    const paidAt = cpPayment.DateTime ?? cpPayment.CreatedDate ?? new Date();

    const result = await activateOrRenewSubscriptionPayment({
      subscriptionId: subscription.id,
      providerSubscriptionId,
      providerToken,
      transactionId,
      amount: paidAmount,
      currency,
      kind: 'initial',
      paidAt,
      rawPayload: {
        source: 'widget_confirm_subscription',
        invoiceId,
        widgetTransactionId,
        cloudPayments: cpPayment,
      },
    });

    if (result.reason === 'subscription_not_found') {
      throw new AppError(404, 'Подписка не найдена', ErrorCode.NOT_FOUND);
    }

    log.info('[CP-Verify] Subscription widget payment confirmed', {
      subscriptionId: result.subscription?.id ?? subscription.id,
      duplicate: result.duplicate,
      reason: result.reason,
    });

    res.json({
      success: true,
      status: result.duplicate ? 'already_processed' : 'confirmed',
      subscription_id: result.subscription?.id ?? subscription.id,
    });
  },
);

/**
 * POST /api/payments/confirm-from-widget — серверная верификация оплаты.
 *
 * ENTERPRISE: Фронтенд НЕ может подтвердить оплату — только запросить проверку.
 * Бэкенд верифицирует через CloudPayments API (/payments/find) что транзакция
 * реально существует и оплачена. Без подтверждения от CP — статус не меняется.
 *
 * Если webhook уже обработал — возвращает success.
 * Если webhook ещё не пришёл, но CP подтверждает оплату — обрабатывает.
 * Если CP не подтверждает — возвращает pending (фронтенд продолжит поллить).
 */
router.post('/confirm-from-widget', validate(confirmFromWidgetSchema), async (req: Request, res: Response) => {
    const { orderId } = req.body;

    // Проверяем текущий статус заказа
    const order = await db.queryOne<Pick<OrderPaymentUpdateRow, 'id' | 'order_id' | 'status' | 'payment_status'>>(
      `SELECT id, order_id, status, payment_status FROM photo_print_orders WHERE order_id = $1`,
      [orderId],
    );

    if (!order) {
      throw new AppError(404, 'Заказ не найден', ErrorCode.PAYMENT_ORDER_NOT_FOUND);
    }

    // Если webhook уже обработал — просто подтверждаем
    if (order.payment_status === 'paid' || order.status === 'processing' || order.status === 'completed') {
      log.info(`Order ${orderId} already processed by webhook`);
      res.json({ success: true, status: 'already_processed' });
      return;
    }

    // Если заказ не в pending_payment — нечего подтверждать
    if (order.status !== 'pending_payment') {
      log.warn(`Order ${orderId} in unexpected status: ${order.status}`);
      res.json({ success: true, status: order.status });
      return;
    }

    // === ENTERPRISE: Верификация через CloudPayments API ===
    const cpVerified = await verifyPaymentWithCloudPayments(orderId);

    if (!cpVerified) {
      log.info(`CloudPayments did NOT confirm payment for ${orderId} — staying pending`);
      res.json({ success: true, status: 'pending_payment' });
      return;
    }

    log.info(`CloudPayments VERIFIED payment for ${orderId}, marking paid`);

    // Обновляем статус (только после верификации CP)
    const updated = await db.queryOne<PhotoPrintOrder>(
      `UPDATE photo_print_orders
       SET status = 'paid',
           payment_status = 'paid',
           paid_at = NOW()
       WHERE order_id = $1 AND status = 'pending_payment'
       RETURNING *`,
      [orderId],
    );

    if (!updated) {
      log.info(`Order ${orderId} was processed by webhook during confirm`);
      res.json({ success: true, status: 'already_processed' });
      return;
    }

    log.info(`Order ${orderId} marked as paid (CP-verified)`);

    // ── Enqueue all post-payment side-effects via BullMQ (same as /pay) ──
    const chatSessionId = updated.chat_session_id as string | null;
    const isChatOrder = !!chatSessionId || (typeof orderId === 'string' && orderId.startsWith('chat-'));
    const items = typeof updated.items === 'string' ? JSON.parse(updated.items as string) as unknown[] : (updated.items as unknown[]) || [];
    const serviceName = serviceNameFromItems(items);
    const totalPrice = parseFloat(String(updated.total_price) || '0');

    const paymentData: OrderPaymentData = {
      orderId,
      orderDbId: String(updated.id),
      amount: totalPrice,
      paymentMethod: 'online',
      cardInfo: null,
      payerEmail: null,
      transactionId: `widget-${orderId}`,
      contactName: updated.contact_name || null,
      contactPhone: updated.contact_phone || null,
      contactEmail: updated.contact_email || null,
      chatSessionId,
      isChatOrder,
      items,
      serviceName,
      priority: (updated.priority as string) || 'normal',
      deliveryMethod: updated.delivery_method || null,
      deliveryAddress: (updated.delivery_address as string) || null,
      deliveryProvider: deliveryProviderFromOrder(updated),
      partnerPromoCode: (updated.partner_promo_code as string) || null,
      mode: updated.mode || null,
      totalPrice,
      telegramUserId: updated.telegram_user_id ? String(updated.telegram_user_id) : null,
      telegramUsername: (updated.telegram_username as string) || null,
      orderData: updated,
      token: null,
      cardFirstSix: null,
      cardLastFour: null,
      cardType: null,
      cardExpDate: null,
      receiptUrl: (updated.receipt_url as string) || null,
      createdAt: String(updated.created_at),
    };

    await enqueuePostPaymentJobs(paymentData);

    res.json({ success: true, status: 'confirmed' });
});

/**
 * Верификация оплаты через CloudPayments API.
 * Вызывает POST /payments/find с InvoiceId = orderId.
 * Возвращает true только если транзакция найдена и статус = Completed/Authorized.
 *
 * Документация: https://developers.cloudpayments.ru/#poisk-tranzaktsii-po-nomeru-zakaza
 */
function readCloudPaymentsString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isCloudPaymentsPaid(model: CloudPaymentsFindResponse['Model']): boolean {
  if (!model) return false;
  return model.StatusCode === 3 || model.StatusCode === 4;
}

async function findPaymentWithCloudPayments(invoiceId: string): Promise<CloudPaymentsFindResponse['Model'] | null> {
  try {
    const { publicId, apiSecret } = config.cloudPayments;
    if (!publicId || !apiSecret) {
      log.error('[CP-Verify] CloudPayments credentials not configured');
      return null;
    }

    const auth = Buffer.from(`${publicId}:${apiSecret}`).toString('base64');

    const response = await fetchWithCB(SERVICE_BREAKERS.cloudpayments, 'https://api.cloudpayments.ru/payments/find', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({ InvoiceId: invoiceId }),
    });

    const data: CloudPaymentsFindResponse = await response.json();

    if (!data.Success || !data.Model) {
      log.info(`[CP-Verify] No transaction found for ${invoiceId}`);
      return null;
    }

    return data.Model;
  } catch (err) {
    log.error(`[CP-Verify] API call failed for ${invoiceId}:`, { error: String(err) });
    // При ошибке API — НЕ подтверждаем (безопасный дефолт)
    return null;
  }
}

async function verifyPaymentWithCloudPayments(orderId: string): Promise<boolean> {
  const model = await findPaymentWithCloudPayments(orderId);
  if (!model) return false;

  // StatusCode: 3 = Authorized, 4 = Completed (оба = оплата прошла)
  const isCompleted = isCloudPaymentsPaid(model);
  const { StatusCode, Status, Amount } = model;

  log.info(`[CP-Verify] Order ${orderId}: Status=${Status}(${StatusCode}), Amount=${Amount}, verified=${isCompleted}`);
  return isCompleted;
}

/**
 * PATCH /api/payments/:orderId/tip — обновить tip перед оплатой
 * Вызывается фронтендом при включении/выключении "Поддержать команду"
 */
router.patch('/:orderId/tip', paymentLimiter, validate(updateTipSchema), async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const tipAmount = numberFromUnknown(req.body.tipAmount) ?? 0;

  const order = await db.queryOne<Pick<PhotoPrintOrders, 'total_price' | 'tip_amount' | 'status'>>(
    `SELECT total_price, tip_amount, status FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (order) {
    if (order.status !== 'pending_payment') {
      throw new AppError(409, 'Order already paid or cancelled');
    }

    const currentTip = parseFloat(order.tip_amount) || 0;
    const basePrice = parseFloat(order.total_price ?? '0') - currentTip;
    const newTotal = basePrice + tipAmount;

    await db.query(
      `UPDATE photo_print_orders SET tip_amount = $1, total_price = $2 WHERE order_id = $3`,
      [tipAmount, newTotal, orderId],
    );

    log.info(`[Tip] Order ${orderId}: tip ${currentTip} -> ${tipAmount}, total ${order.total_price} -> ${newTotal}`);
    res.json({ totalPrice: newTotal, tipAmount, basePrice });
    return;
  }

  const paymentLink = await db.queryOne<PaymentLinkTipRow>(
    `SELECT amount::text AS amount, status, services, metadata
     FROM payment_links WHERE order_ref = $1`,
    [orderId],
  );

  if (!paymentLink) throw new AppError(404, 'Order not found');
  if (paymentLink.status !== 'pending') {
    throw new AppError(409, 'Order already paid or cancelled');
  }

  const currentAmount = parseFloat(paymentLink.amount);
  if (!Number.isFinite(currentAmount)) {
    throw new AppError(500, 'Invalid payment link amount');
  }

  const metadata = parsePaymentLinkMetadata(paymentLink.metadata);
  const basePrice = getPaymentLinkBaseAmount(currentAmount, metadata);
  const newTotal = basePrice + tipAmount;
  const services = withSupportTeamTip(normalizePaymentLinkServices(paymentLink.services), tipAmount);
  const nextMetadata: PaymentLinkMetadataJson = {
    ...metadata,
    [SUPPORT_TEAM_BASE_METADATA_KEY]: basePrice,
    [SUPPORT_TEAM_TIP_METADATA_KEY]: tipAmount,
  };

  await db.query(
    `UPDATE payment_links
     SET amount = $1, services = $2::jsonb, metadata = $3::jsonb, updated_at = NOW()
     WHERE order_ref = $4`,
    [newTotal, JSON.stringify(services), JSON.stringify(nextMetadata), orderId],
  );

  log.info(`[Tip] Payment link ${orderId}: total ${currentAmount} -> ${newTotal}, tip ${tipAmount}`);
  res.json({ totalPrice: newTotal, tipAmount, basePrice });
});

/**
 * GET /api/payments/status/:orderId — проверка статуса заказа
 */
router.get('/status/:orderId', paymentLimiter, async (req: Request, res: Response) => {
  const { orderId } = req.params;

    // Branch: payment_links (CRM-created pre-order URLs)
    const paymentLink = await db.queryOne<PaymentLinkStatusRow>(
      `SELECT id, order_ref, amount::text AS amount, status, paid_at, created_at,
              services, description, contact_name, contact_phone, contact_email, expires_at, metadata
       FROM payment_links WHERE order_ref = $1`,
      [orderId],
    );
    if (paymentLink) {
      const linkAmount = parseFloat(paymentLink.amount);
      const linkMetadata = parsePaymentLinkMetadata(paymentLink.metadata);
      const baseAmount = getPaymentLinkBaseAmount(linkAmount, linkMetadata);
      const sourceLinkServices = withSupportTeamTip(normalizePaymentLinkServices(paymentLink.services), 0);
      const priceNote = combinedPriceNote(sourceLinkServices.map(paymentLinkServicePriceNote));
      const linkServices = stripPaymentLinkServicePriceNotes(sourceLinkServices);
      const checkoutStatus = paymentLink.status === 'paid'
        ? 'processing'
        : paymentLink.status === 'pending'
          ? 'pending_payment'
          : paymentLink.status;
      res.json({
        success: true,
        order: {
          id: paymentLink.order_ref,
          status: checkoutStatus,
          paymentStatus: paymentLink.status === 'paid' ? 'paid' : 'none',
          totalPrice: baseAmount,
          description: paymentLink.description,
          items: linkServices,
          priceNote,
          receiptUrl: null,
          contactName: paymentLink.contact_name,
          contactEmail: paymentLink.contact_email,
          contactPhone: paymentLink.contact_phone,
          createdAt: paymentLink.created_at,
          paidAt: paymentLink.paid_at,
        },
      });
      return;
    }

    const order = await db.queryOne<PrintPaymentStatusRow>(
      `SELECT order_id, status, payment_status, total_price, tip_amount, paid_at, created_at,
              items, delivery_address, delivery_method, delivery_cost, receipt_url,
              payment_card_info, contact_name, contact_email,
              promo_code, promo_discount, description
       FROM photo_print_orders WHERE order_id = $1`,
      [orderId]
    );

    if (!order) {
      throw new AppError(404, 'Заказ не найден', ErrorCode.PAYMENT_ORDER_NOT_FOUND);
    }

    const parsedItems = parseJsonValue(order.items);
    const items = Array.isArray(parsedItems) ? parsedItems : [];

    // Маскируем персональные данные — эндпоинт публичный
    const maskedName = order.contact_name
      ? order.contact_name.split(' ').map((w: string) => w[0] + '*'.repeat(Math.max(w.length - 1, 0))).join(' ')
      : null;
    const maskedEmail = order.contact_email
      ? order.contact_email.replace(/^(.{2})(.*)(@.*)$/, '$1***$3')
      : null;

    // Return BASE price (without tip) — frontend adds tip via supportTeam checkbox.
    // total_price in DB may include tip from a previous PATCH /tip call.
    const totalPrice = parseFloat(order.total_price || '0');
    const tipAmount = parseFloat(order.tip_amount || '0') || 0;
    const basePrice = totalPrice - tipAmount;
    const pickupLabel = order.delivery_method === 'pickup' && order.delivery_address
      ? `Самовывоз: ${order.delivery_address}`
      : null;

    res.json({
      success: true,
      order: {
        id: order.order_id,
        status: order.status,
        paymentStatus: order.payment_status,
        totalPrice: basePrice,
        description: order.description || serviceNameFromItems(items),
        paidAt: order.paid_at,
        createdAt: order.created_at,
        items: checkoutItemsFromOrderItems(items, basePrice, order.description),
        deliveryAddress: pickupLabel || (order.delivery_address ? 'Доставка оформлена' : null),
        deliveryCost: order.delivery_cost ? parseFloat(order.delivery_cost) : null,
        receiptUrl: receiptUrlForTracking(order.order_id, order.receipt_url),
        cardInfo: order.payment_card_info || null,
        contactName: maskedName,
        contactEmail: maskedEmail,
        promoCode: order.promo_code || null,
        promoDiscount: order.promo_discount ? parseFloat(order.promo_discount) : null,
      },
    });
});

// ============================================================================
// Payment links management (staff): list / detail / create-order
// ============================================================================

const PAYMENT_LINK_SELECT_COLS = `
  pl.id, pl.order_ref, pl.amount::text AS amount, pl.currency, pl.services, pl.description,
  pl.conversation_id, pl.contact_phone, pl.contact_name, pl.contact_email,
  pl.created_by, pl.status, pl.payment_id, pl.payment_method, pl.payment_card_info,
  pl.paid_at, pl.expires_at, pl.order_ref_linked, pl.metadata, pl.created_at, pl.updated_at,
  c.contact_id, u.display_name AS created_by_name,
  payment_shift.studio_id AS studio_id, shift_studio.name AS studio_name,
  COALESCE(ac.channels, ARRAY[]::text[]) AS available_channels
`;

const PAYMENT_LINK_MUTATION_SELECT_COLS = `
  pl.id, pl.order_ref, pl.amount::text AS amount, pl.status, pl.services, pl.description,
  pl.conversation_id, c.contact_id, pl.contact_name, pl.contact_phone, pl.expires_at
`;

const PAYMENT_LINK_MUTATION_RETURNING_COLS = `
  id, order_ref, amount::text AS amount, status, services, description,
  conversation_id,
  (SELECT c.contact_id FROM conversations c WHERE c.id = conversation_id) AS contact_id,
  contact_name, contact_phone, expires_at
`;

/**
 * LATERAL subquery joining available channels (non-closed conversations)
 * per payment_link's contact. Returned as text[] via ac.channels.
 */
const PAYMENT_LINK_AVAILABLE_CHANNELS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT conv.channel::text ORDER BY conv.channel::text) AS channels
    FROM conversations conv
    WHERE conv.contact_id = c.contact_id AND conv.status != 'closed'
  ) ac ON true
`;

const PAYMENT_LINK_STUDIO_JOIN = `
  LEFT JOIN employee_shifts payment_shift ON payment_shift.id = pl.employee_shift_id
  LEFT JOIN studios shift_studio ON shift_studio.id = payment_shift.studio_id
`;

type ResendTargetConv = { id: string; channel: Conversations['channel']; external_chat_id: string | null };

async function resolveResendTargetConv(
  link: PaymentLinkResendRow,
  overrideChannel: string | undefined,
): Promise<ResendTargetConv | null> {
  if (!overrideChannel) return null;
  if (!link.contact_id) {
    throw new AppError(400, 'У ссылки нет связанного контакта', ErrorCode.VALIDATION_ERROR);
  }
  if (overrideChannel === 'web' && !link.conversation_id) {
    throw new AppError(400, 'У платежа нет связанного веб-чата', ErrorCode.VALIDATION_ERROR);
  }
  const convRow = await db.queryOne<ResendTargetConv>(
    `SELECT id, channel, external_chat_id
     FROM conversations
     WHERE contact_id = $1 AND channel = $2 AND status != 'closed'
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [link.contact_id, overrideChannel],
  );
  if (!convRow) {
    throw new AppError(400, `Канал ${overrideChannel} недоступен для контакта`, ErrorCode.VALIDATION_ERROR);
  }
  return convRow;
}

async function computeEffectiveResendConv(
  link: PaymentLinkResendRow,
  targetConv: ResendTargetConv | null,
): Promise<ResendTargetConv | null> {
  if (targetConv) return targetConv;
  if (!link.conversation_id) return null;
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [link.conversation_id],
  );
  if (!conv) return null;
  return { id: link.conversation_id, channel: conv.channel, external_chat_id: conv.external_chat_id };
}

function mapResendChannelLabel(effective: ResendTargetConv | null): string {
  if (!effective) return 'web';
  const ch = effective.channel;
  if (['web', 'online', 'studio'].includes(ch)) return 'chat';
  return ch;
}

async function sendResendWebChatMessage(
  req: Request,
  conversationId: string,
  orderId: string,
  amount: number,
  description: string,
  cartDetails: PaymentLinkCartDetailsJson | null,
): Promise<void> {
  const interactive = {
    type: 'buttons',
    step: 'payment_resend',
    buttons: [buildWidgetPaymentButton(orderId, amount, description)],
  };
  const content = buildPaymentChatContent(amount, cartDetails);

  const chatMessage = await db.queryOne<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [conversationId, content, JSON.stringify({ interactive })],
  );
  if (!chatMessage) throw new Error('Failed to create payment resend chat message');

  const socketServer = req.app.socketServer;
  if (socketServer) {
    const msgPayload = buildOperatorChatSocketPayload(conversationId, chatMessage, { interactive });
    socketServer.getIO().to(`visitor:${conversationId}`).emit('operator:message', msgPayload);
    await broadcastChatMessage({ sessionId: conversationId, message: chatMessage });
  }
}

async function enqueueResendOutbound(
  effective: ResendTargetConv,
  orderId: string,
  amount: number,
  description: string,
  cartDetails: PaymentLinkCartDetailsJson | null,
): Promise<void> {
  await enqueueOutbound({
    channel: effective.channel,
    externalChatId: effective.external_chat_id!,
    content: buildPaymentOutboundContent(amount, orderId, cartDetails, description),
    messageType: 'text',
    conversationId: effective.id,
  });
}

/**
 * GET /api/payments/links — список payment_links с фильтрами.
 * Поддерживает контекстный список по contact_id/conversation_id и общий список для reports:view.
 */
router.get('/links', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response) => {
  const parsed = listPaymentLinksSchema.safeParse(req.query);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
      .join('; ');
    throw new AppError(400, msg, ErrorCode.VALIDATION_ERROR);
  }
  const { contact_id, conversation_id, created_by, sales_scope, status, date_from, date_to, limit, offset } = parsed.data;
  const scopedToClient = !!contact_id || !!conversation_id;
  const canViewGlobalSales = req.user?.permissions?.includes('reports:view') ?? false;
  const requestedOwnLinks = sales_scope === 'mine' || (!!created_by && created_by === req.user?.id);
  if (!scopedToClient && !canViewGlobalSales && !requestedOwnLinks) {
    throw new AppError(403, 'Недостаточно прав для общего списка счетов', ErrorCode.FORBIDDEN);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (contact_id) {
    params.push(contact_id);
    conditions.push(`c.contact_id = $${params.length}`);
  }
  if (conversation_id) {
    params.push(conversation_id);
    conditions.push(`pl.conversation_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`pl.status = $${params.length}`);
  }
  if (sales_scope === 'mine') {
    if (!req.user) throw new AppError(401, 'Unauthorized');
    params.push(req.user.id);
    conditions.push(`(
      pl.created_by = $${params.length}
      OR EXISTS (
        SELECT 1
        FROM employee_shifts own_shift
        WHERE own_shift.id = pl.employee_shift_id
          AND own_shift.employee_id = $${params.length}
      )
    )`);
  } else if (created_by) {
    params.push(created_by);
    conditions.push(`pl.created_by = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`pl.created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`pl.created_at <= $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.query<PaymentLinkListRow>(
    `SELECT ${PAYMENT_LINK_SELECT_COLS}
     FROM payment_links pl
     LEFT JOIN conversations c ON c.id = pl.conversation_id
     LEFT JOIN users u ON u.id = pl.created_by
     ${PAYMENT_LINK_STUDIO_JOIN}
     ${PAYMENT_LINK_AVAILABLE_CHANNELS_JOIN}
     ${whereClause}
     ORDER BY pl.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  res.json({
    success: true,
    links: rows,
    pagination: { limit, offset, count: rows.length },
  });
});

/**
 * GET /api/payments/link/:id — деталь одной ссылки.
 */
router.get('/link/:id', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const link = await db.queryOne<PaymentLinkDetailRow>(
    `SELECT ${PAYMENT_LINK_SELECT_COLS}
     FROM payment_links pl
     LEFT JOIN conversations c ON c.id = pl.conversation_id
     LEFT JOIN users u ON u.id = pl.created_by
     ${PAYMENT_LINK_STUDIO_JOIN}
     ${PAYMENT_LINK_AVAILABLE_CHANNELS_JOIN}
     WHERE pl.id = $1`,
    [id],
  );
  if (!link) {
    res.status(404).json({ success: false, error: ErrorCode.PAYMENT_LINK_NOT_FOUND });
    return;
  }
  res.json({ success: true, link });
});

/**
 * PATCH /api/payments/link/:id — изменить pending payment_link.
 * Сохраняет прежний order_ref, поэтому старая публичная ссылка остаётся той же,
 * но CloudPayments /check увидит уже новую сумму и корзину.
 */
router.patch(
  '/link/:id',
  authenticateToken,
  requirePermission('pos:use'),
  validate(updatePaymentLinkSchema),
  async (req: AuthRequest, res: Response) => {
    if (!config.featureFlags.paymentLinksEnabled) {
      paymentLinksBlockedByFlagTotal.inc();
      throw new AppError(503, 'Платёжные ссылки временно отключены', ErrorCode.PAYMENT_LINKS_DISABLED);
    }

    const { id: linkId } = req.params;
    const body = req.body as import('../schemas/payments-routes.schema.js').UpdatePaymentLinkInput;

    const current = await db.queryOne<PaymentLinkMutationRow>(
      `SELECT ${PAYMENT_LINK_MUTATION_SELECT_COLS}
       FROM payment_links pl
       LEFT JOIN conversations c ON c.id = pl.conversation_id
       WHERE pl.id = $1`,
      [linkId],
    );
    if (!current) {
      throw new AppError(404, 'Платёжная ссылка не найдена', ErrorCode.PAYMENT_LINK_NOT_FOUND);
    }
    if (current.status !== 'pending') {
      throw new AppError(
        409,
        `Можно редактировать только ожидающую оплату (текущий статус: ${current.status})`,
        ErrorCode.PAYMENT_ORDER_INVALID_STATUS,
      );
    }

    const pricing = await calculatePaymentLinkPricing(
      body.amount,
      body.services,
      {
        phone: body.phone,
        clientUserId: body.clientUserId,
        clientContactId: body.clientContactId,
        sessionId: current.conversation_id,
      },
      body.promo_code,
      'update-link',
    );
    const total = pricing.total;
    const cartDetails = pricing.cartDetails ?? normalizePaymentLinkCartDetails(body.cartDetails);
    const comments = buildPaymentLinkComments(body.services, total, body.description);
    const serviceItems = buildPaymentLinkServiceItemsForStorage(body.services, total, comments, cartDetails);
    const contactPhone = body.phone?.trim() || null;
    const contactName = body.clientName?.trim() || null;

    const updated = await db.queryOne<PaymentLinkMutationRow>(
      `UPDATE payment_links pl
       SET amount = $2,
           services = $3::jsonb,
           description = $4,
           contact_phone = COALESCE($5, pl.contact_phone),
           contact_name = COALESCE($6, pl.contact_name),
           student_id_photo_promo = $7::jsonb,
           expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
       WHERE pl.id = $1 AND pl.status = 'pending'
       RETURNING ${PAYMENT_LINK_MUTATION_RETURNING_COLS}`,
      [
        linkId,
        total,
        JSON.stringify(serviceItems),
        comments,
        contactPhone,
        contactName,
        // Снимок акции пересчитывается на актуальную корзину (или очищается, если позиция ушла).
        pricing.studentIdPhotoPromo ? JSON.stringify(pricing.studentIdPhotoPromo) : null,
      ],
    );
    if (!updated) {
      throw new AppError(409, 'Платёжная ссылка уже не ожидает оплату', ErrorCode.PAYMENT_ORDER_INVALID_STATUS);
    }

    if (updated.conversation_id) {
      try {
        await syncPaymentLinkCart(req, updated.conversation_id, updated.order_ref, total, comments, cartDetails);
      } catch (error) {
        log.warn('[Payments] Failed to sync edited payment link cart', {
          error: String(error),
          conversationId: updated.conversation_id,
          orderId: updated.order_ref,
        });
      }
    }

    let sent = false;
    if (body.autoSend === true && updated.conversation_id) {
      await sendPaymentLinkInteractiveMessage(
        req,
        updated.conversation_id,
        updated.order_ref,
        total,
        comments,
        cartDetails,
        'operator_payment_update',
      );
      sent = true;
    }

    emitPaymentLinkMutation(req, 'payment-link:updated', updated);

    const paymentUrl = `https://svoefoto.ru/pay/${updated.order_ref}`;
    res.json({
      success: true,
      data: {
        paymentUrl,
        orderId: updated.order_ref,
        amount: total,
        sent,
        link: updated,
      },
    });
  },
);

/**
 * POST /api/payments/link/:id/cancel — отменить pending payment_link.
 */
router.post(
  '/link/:id/cancel',
  authenticateToken,
  requirePermission('pos:use'),
  validate(cancelPaymentLinkSchema),
  async (req: AuthRequest, res: Response) => {
    const { id: linkId } = req.params;
    const body = req.body as import('../schemas/payments-routes.schema.js').CancelPaymentLinkInput;

    const current = await db.queryOne<PaymentLinkMutationRow>(
      `SELECT ${PAYMENT_LINK_MUTATION_SELECT_COLS}
       FROM payment_links pl
       LEFT JOIN conversations c ON c.id = pl.conversation_id
       WHERE pl.id = $1`,
      [linkId],
    );
    if (!current) {
      throw new AppError(404, 'Платёжная ссылка не найдена', ErrorCode.PAYMENT_LINK_NOT_FOUND);
    }
    if (current.status !== 'pending') {
      throw new AppError(
        409,
        `Можно отменить только ожидающую оплату (текущий статус: ${current.status})`,
        ErrorCode.PAYMENT_ORDER_INVALID_STATUS,
      );
    }

    const cancelled = await db.queryOne<PaymentLinkMutationRow>(
      `UPDATE payment_links pl
       SET status = 'cancelled',
           expires_at = NOW(),
           metadata = COALESCE(pl.metadata, '{}'::jsonb) || jsonb_build_object(
             'cancelledBy', $2::text,
             'cancelledReason', $3::text,
             'cancelledAt', NOW()
           ),
           updated_at = NOW()
       WHERE pl.id = $1 AND pl.status = 'pending'
       RETURNING ${PAYMENT_LINK_MUTATION_RETURNING_COLS}`,
      [linkId, req.user?.id ?? null, body.reason ?? null],
    );
    if (!cancelled) {
      throw new AppError(409, 'Платёжная ссылка уже не ожидает оплату', ErrorCode.PAYMENT_ORDER_INVALID_STATUS);
    }

    if (body.notifyClient) {
      try {
        await sendPaymentLinkCancelledMessage(req, cancelled, body.reason);
      } catch (error) {
        log.warn('[Payments] Failed to send cancellation message', {
          error: String(error),
          paymentLinkId: cancelled.id,
        });
      }
    }

    emitPaymentLinkMutation(req, 'payment-link:cancelled', cancelled);

    res.json({ success: true, link: cancelled });
  },
);

/**
 * GET /api/payments/links/:id/history — audit log (P3 #15).
 * Compliance ФЗ-54: все INSERT/UPDATE/DELETE payment_links capture via trigger.
 * Доступ: settings:manage (admin-only в static RBAC).
 */
router.get('/links/:id/history', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res: Response) => {
  const linkId = req.params['id'];
  if (!linkId || !/^[0-9a-f-]{36}$/i.test(linkId)) {
    throw new AppError(400, 'Invalid linkId UUID', ErrorCode.VALIDATION_ERROR);
  }
  const rows = await db.query(
    `SELECT id, payment_link_id, action, old_data, new_data, changed_at
     FROM payment_links_history
     WHERE payment_link_id = $1
     ORDER BY changed_at DESC
     LIMIT 100`,
    [linkId],
  );
  res.json({ success: true, history: rows });
});

/**
 * POST /api/payments/link/:id/create-order — создать photo_print_orders из оплаченной ссылки.
 * Идемпотентно: повторный вызов для уже связанной ссылки возвращает прежний orderId.
 */
router.post(
  '/link/:id/create-order',
  authenticateToken,
  requirePermission('pos:use'),
  idempotent(60),
  validate(createOrderFromPaymentLinkSchema),
  async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError(401, 'Authentication required', ErrorCode.UNAUTHORIZED);
    const { id: linkId } = req.params;
    const body = req.body as import('../schemas/payments-routes.schema.js').CreateOrderFromPaymentLinkInput;

    // 1. Generate CRM order ID
    const date = new Date();
    const yr = date.getFullYear().toString().slice(-2);
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    const dy = date.getDate().toString().padStart(2, '0');
    const rnd = secureRandomString(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    const orderId = `CRM-${yr}${mo}${dy}-${rnd}`;

    const pgClient = await pool.connect();
    try {
      await pgClient.query('BEGIN');

      // 2. Lock payment_link row
      const lockResult = await pgClient.query<PaymentLinkCreateOrderRow>(
        `SELECT pl.id, pl.order_ref, pl.amount::text AS amount, pl.status, pl.services,
                pl.description, pl.conversation_id, pl.contact_phone, pl.contact_name,
                pl.contact_email, pl.payment_id, pl.paid_at, pl.order_ref_linked,
                c.contact_id
         FROM payment_links pl
         LEFT JOIN conversations c ON c.id = pl.conversation_id
         WHERE pl.id = $1
         FOR UPDATE OF pl`,
        [linkId],
      );
      const link = lockResult.rows[0];

      if (!link) {
        await pgClient.query('ROLLBACK');
        res.status(404).json({ success: false, error: ErrorCode.PAYMENT_LINK_NOT_FOUND });
        return;
      }

      // Idempotent success: already linked to an order
      if (link.order_ref_linked) {
        await pgClient.query('COMMIT');
        res.json({
          success: true,
          data: { orderId: link.order_ref_linked, idempotent: true },
        });
        return;
      }

      if (link.status !== 'paid') {
        await pgClient.query('ROLLBACK');
        res.status(409).json({ success: false, error: ErrorCode.PAYMENT_LINK_NOT_PAID });
        return;
      }

      // 3. Resolve services (from jsonb)
      const services = Array.isArray(link.services)
        ? (link.services as Array<{ name?: string; price?: number; quantity?: number; service_option_id?: string; options?: unknown }>)
        : [];
      const totalPrice = parseFloat(link.amount);

      // 4. findOrCreateCustomer (outside TX for consistency with crm-create, but we do it inside
      //    because the lock row ensures idempotency — customer.service uses its own pool connection)
      let customerId: string | null = null;
      if (link.contact_phone) {
        try {
          const customer = await findOrCreateCustomer({
            phone: link.contact_phone,
            name: link.contact_name || undefined,
            email: link.contact_email || undefined,
          });
          customerId = customer?.id || null;
        } catch (err: unknown) {
          log.warn('[Payments] link→order findOrCreateCustomer failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const source: string = link.conversation_id ? 'chat' : 'crm';
      const assignedEmployeeId: string = body.assigned_employee_id || req.user.id;

      // 5. INSERT photo_print_orders
      const orderInsert = await pgClient.query<{ id: string; order_id: string }>(
        `INSERT INTO photo_print_orders (
          order_id, mode, source,
          contact_name, contact_phone, contact_email,
          customer_id, chat_session_id,
          items, total_price,
          comments, uniform_description, wishes,
          status, payment_status, payment_id, paid_at,
          priority, assigned_employee_id, assigned_at, deadline_at,
          delivery_method
        ) VALUES (
          $1, 'crm', $2,
          $3, $4, $5,
          $6, $7,
          $8, $9,
          $10, $11, $12,
          'new', 'paid', $13, NOW(),
          $14, $15, NOW(), $16,
          'pickup'
        ) RETURNING id, order_id`,
        [
          orderId,
          source,
          link.contact_name,
          link.contact_phone,
          link.contact_email,
          customerId,
          link.conversation_id,
          JSON.stringify(services),
          totalPrice,
          body.comment?.trim() || link.description || null,
          body.uniform_description?.trim() || null,
          body.wishes?.trim() || null,
          link.payment_id,
          body.priority,
          assignedEmployeeId,
          body.deadline_at || null,
        ],
      );
      const newOrder = orderInsert.rows[0];
      if (!newOrder) {
        await pgClient.query('ROLLBACK');
        throw new AppError(500, 'Не удалось создать заказ');
      }

      // 6. INSERT order_items
      for (const item of services) {
        const name = item.name || 'Услуга';
        const price = Number(item.price) || 0;
        const qty = Number(item.quantity) || 1;
        const subtotal = price * qty;
        await pgClient.query(
          `INSERT INTO order_items (order_id, order_type, name, unit_price, quantity, subtotal, metadata, service_option_id)
           VALUES ($1, 'crm', $2, $3, $4, $5, $6, $7)`,
          [orderId, name, price, qty, subtotal, JSON.stringify(item.options || {}), item.service_option_id || null],
        );
      }

      // 7. INSERT order_assignments
      if (assignedEmployeeId) {
        const summary = services
          .map((s) => (s.quantity && s.quantity > 1 ? `${s.name} x${s.quantity}` : s.name || ''))
          .filter(Boolean)
          .join(', ')
          .substring(0, 255);
        await pgClient.query(
          `INSERT INTO order_assignments (order_id, order_type, source, status, assigned_to, assigned_at, studio_id, order_summary)
           VALUES ($1, 'other', $2, 'pending', $3, NOW(), $4, $5)`,
          [orderId, source, assignedEmployeeId, body.studio_id || null, summary],
        );
      }

      // 8. UPDATE payment_links link reference
      await pgClient.query(
        `UPDATE payment_links SET order_ref_linked = $1, updated_at = NOW() WHERE id = $2`,
        [orderId, linkId],
      );

      await pgClient.query('COMMIT');

      try {
        paymentLinksLinkedToOrderTotal.inc({
          source: link.conversation_id ? 'chat' : 'manual',
        });
      } catch (_metricErr) { /* metrics best-effort */ }

      // 9. Outside TX: task + WS + CRM event queue (fire-and-forget)
      createTaskFromOrder({
        orderId: newOrder.id,
        orderTable: 'photo_print_orders',
        taskType: 'delivery',
        clientName: link.contact_name || undefined,
        clientPhone: link.contact_phone || undefined,
        clientChannel: source,
        title: `CRM: ${link.description || orderId}`.substring(0, 255),
        description: body.comment || link.description || `Заказ ${orderId}`,
        studioId: body.studio_id || undefined,
        chatSessionId: link.conversation_id || undefined,
        createdBy: req.user.id,
        priority: body.priority,
        estimatedReadyAt: body.deadline_at ? new Date(body.deadline_at) : undefined,
      }).catch((err) =>
        log.warn(`[Payments] link→order createTaskFromOrder failed`, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      try {
        const io = req.app.socketServer?.getIO();
        if (io) {
          const orderCreatedPayload = {
            orderId,
            totalPrice,
            contactName: link.contact_name,
            source,
          };
          logAndEmit(io, 'admin:visitor-chats', 'order:created', orderCreatedPayload);
          logAndEmit(io, 'employee:dashboard', 'order:created', orderCreatedPayload);

          logAndEmit(io, 'admin:visitor-chats', 'payment-link:linked', {
            paymentLinkId: link.id,
            orderRef: orderId,
            orderId: link.order_ref,
            contactId: link.contact_id,
            conversationId: link.conversation_id,
          });

          if (link.conversation_id) {
            logAndEmit(io, 'admin:visitor-chats', 'chat:inbox-updated', {
              conversationId: link.conversation_id,
            });
          }
        }
      } catch (_socketErr) { /* socket not available */ }

      enqueueCrmEvent('order', orderId, 'order_created', {
        client_name: link.contact_name,
        client_phone: link.contact_phone,
        preview: `Заказ ${orderId}`,
        status: 'new',
        priority: body.priority === 'urgent' ? 1 : body.priority === 'vip' ? 0 : 2,
        sort_time: new Date().toISOString(),
        channel: null,
        assigned_to: assignedEmployeeId,
        assigned_to_name: null,
        unread: false,
        metadata: {},
      }).catch((err) => log.warn('enqueueCrmEvent failed', { error: String(err) }));

      res.json({
        success: true,
        data: { orderId, idempotent: false },
      });
    } catch (err) {
      try { await pgClient.query('ROLLBACK'); } catch (rbErr) {
        log.error('[Payments] link→order ROLLBACK failed', {
          error: rbErr instanceof Error ? rbErr.message : String(rbErr),
        });
      }
      throw err;
    } finally {
      pgClient.release();
    }
  },
);

/**
 * GET /api/payments/config — public payment config for frontend
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    publicId: config.cloudPayments.publicId,
    taxationSystem: resolveCloudPaymentsTaxationSystem(),
  });
});

/**
 * POST /api/payments/resend/:orderId — повторная отправка ссылки на оплату.
 * Сначала проверяем payment_links (pending) → обновляем expires_at + рассылаем;
 * иначе fallthrough к legacy photo_print_orders.
 */
router.post('/resend/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;

    const parsedBody = resendPaymentLinkSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      throw new AppError(
        400,
        parsedBody.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const overrideChannel = parsedBody.data.channel;

    // ── Branch: payment_links (новая воронка) ─────────────────────────
    const link = await db.queryOne<PaymentLinkResendRow>(
      `SELECT pl.id, pl.order_ref, pl.amount::text AS amount, pl.status, pl.services, pl.description,
              pl.conversation_id, c.contact_id
       FROM payment_links pl
       LEFT JOIN conversations c ON c.id = pl.conversation_id
       WHERE pl.order_ref = $1`,
      [orderId],
    );

    if (link) {
      if (link.status !== 'pending') {
        throw new AppError(
          400,
          `Ссылка не может быть переотправлена (статус: ${link.status})`,
          ErrorCode.PAYMENT_ORDER_INVALID_STATUS,
        );
      }

      const targetConv = await resolveResendTargetConv(link, overrideChannel);

      await db.query(
        `UPDATE payment_links
         SET expires_at = NOW() + INTERVAL '24 hours', updated_at = NOW()
         WHERE id = $1`,
        [link.id],
      );

      const amount = parseFloat(link.amount);
      const description = link.description || `Заказ ${orderId}`;
      const cartDetails = buildPaymentLinkCartDetailsFromServices(normalizePaymentLinkServices(link.services));

      let resendChannel: string = 'web';
      const effective = await computeEffectiveResendConv(link, targetConv);

      if (effective && ['web', 'online', 'studio'].includes(effective.channel)) {
        await sendResendWebChatMessage(req, effective.id, orderId, amount, description, cartDetails);
      }

      resendChannel = mapResendChannelLabel(effective);

      if (effective
          && !['web', 'online', 'studio'].includes(effective.channel)
          && effective.external_chat_id) {
        await enqueueResendOutbound(effective, orderId, amount, description, cartDetails);
      }

      try { paymentLinksResentTotal.inc({ channel: resendChannel }); } catch (_e) { /* metrics best-effort */ }

      res.json({ success: true, mode: 'payment_link', orderId, amount });
      return;
    }

    // ── Legacy branch: photo_print_orders ──────────────────────────────
    const order = await db.queryOne<PaymentLinkLegacyOrderRow>(
      `SELECT order_id, total_price, status, chat_session_id, items
       FROM photo_print_orders WHERE order_id = $1`,
      [orderId],
    );

    if (!order) {
      throw new AppError(404, 'Заказ не найден', ErrorCode.PAYMENT_ORDER_NOT_FOUND);
    }

    if (!['pending_payment', 'payment_failed'].includes(order.status)) {
      throw new AppError(400, `Заказ не может быть оплачен (статус: ${order.status})`, ErrorCode.PAYMENT_ORDER_INVALID_STATUS);
    }

    // Сбросить статус и счётчики напоминаний для повторной попытки
    if (order.status === 'payment_failed') {
      await db.query(
        `UPDATE photo_print_orders SET status = 'pending_payment', payment_status = 'none',
         reminder_sent_at = NULL, final_reminder_sent_at = NULL, updated_at = NOW() WHERE order_id = $1`,
        [orderId],
      );
    }

    // Сформировать кнопку для inline-виджета оплаты
    const price = parseFloat(order.total_price);
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : null;
    const description = firstItem?.service || firstItem?.tariff || 'Заказ';

    // Отправить в чат
    const sessionId = order.chat_session_id;
    if (sessionId) {
      const interactive = {
        type: 'buttons',
        step: 'payment_resend',
        buttons: [buildWidgetPaymentButton(orderId, price, `${description} — ${price}₽`)],
      };

      const chatMessage = await db.queryOne<BroadcastableMessage>(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
         RETURNING *`,
        [sessionId, `Кнопка оплаты обновлена. Сумма: ${price}₽`, JSON.stringify({ interactive })],
      );
      if (!chatMessage) throw new Error('Failed to create payment update chat message');

      // WebSocket
      const socketServer = req.app.socketServer;
      if (socketServer) {
        const msgPayload = buildOperatorChatSocketPayload(sessionId, chatMessage, { interactive });
        socketServer.getIO().to(`visitor:${sessionId}`).emit('operator:message', msgPayload);

        broadcastChatMessage({
          sessionId,
          message: chatMessage,
        }).catch(err => log.error('[Payments] CRM broadcast failed', { error: String(err) }));
      }
    }

    res.json({ success: true, mode: 'widget', orderId, amount: price });
});

// ============================================================================
// Автоочистка заказов pending_payment старше 24 часов
// ============================================================================

export async function cleanupAbandonedOrders(): Promise<void> {
  try {
    const rows = await db.query<AbandonedPaymentOrderRow>(
      `UPDATE photo_print_orders
       SET status = 'expired', payment_status = 'expired'
       WHERE status = 'pending_payment'
         AND created_at < NOW() - INTERVAL '24 hours'
       RETURNING order_id, total_price, chat_session_id`,
    );
    if (rows.length > 0) {
      const ids = rows.map(r => r.order_id).join(', ');
      log.info(`[Cleanup] Expired ${rows.length} abandoned orders: ${ids}`);

      // Трекинг брошенных корзин в аналитике
      for (const row of rows) {
        let fingerprint: string | undefined;
        if (row.chat_session_id) {
          const session = await db.queryOne<ConversationVisitorRow>(
            'SELECT visitor_id FROM conversations WHERE id = $1',
            [row.chat_session_id]
          );
          fingerprint = session?.visitor_id?.startsWith('sf_') ? session.visitor_id : undefined;
        }

        fetch(`${config.bridge.url}/api/bridge/track-order-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'order_abandoned',
            order_id: row.order_id,
            order_source: row.order_id.startsWith('chat-') ? 'chat_order' : 'print_order',
            amount: parseFloat(row.total_price || '0'),
            fingerprint_visitor_id: fingerprint,
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(err => log.error('[Funnel] track abandoned order error', { error: String(err) }));

        // Уведомляем клиента о протухании заказа
        if (row.chat_session_id) {
          const price = parseFloat(row.total_price || '0');
          db.query(
            `INSERT INTO messages
              (conversation_id, sender_type, sender_name, message_type, content)
             VALUES ($1, 'bot', 'Своё Фото', 'text', $2)`,
            [row.chat_session_id, `⏰ Заказ ${row.order_id} на ${price}₽ был отменён — истёк срок оплаты (24 часа).\n\nЕсли вы всё ещё хотите заказать, напишите нам — мы поможем!`],
          ).catch((err: unknown) => log.error('[Cleanup] Failed to insert expiry message', { error: String(err) }));

          sendVisitorChatPush(row.chat_session_id, {
            title: 'Заказ отменён',
            body: `Заказ на ${price}₽ отменён — истёк срок оплаты`,
          }).catch((err: unknown) => log.error('[Cleanup] Failed to send expiry push', { error: String(err) }));
        }
      }
    }
  } catch (err) {
    log.error('[Cleanup] Failed to expire abandoned orders:', { error: String(err) });
  }
}

// NOTE: cleanup & reminder scheduling moved to payment-scheduler.service.ts (leader-only).
// Do NOT add setInterval/setTimeout here — they run on every node at import time.

// ============================================================================
// Напоминания о неоплаченных заказах (2ч + 22ч)
// ============================================================================

type AbandonedOrder = Pick<
  PhotoPrintOrders,
  'order_id' | 'total_price' | 'chat_session_id' | 'contact_email' | 'contact_name' | 'items'
>;

/** Group orders by chat_session_id, filtering out orders without a session. */
function groupOrdersBySession(
  orders: AbandonedOrder[],
): Map<string, AbandonedOrder[]> {
  const map = new Map<string, AbandonedOrder[]>();
  for (const order of orders) {
    const sid = order.chat_session_id;
    if (!sid) continue;
    const group = map.get(sid);
    if (group) {
      group.push(order);
    } else {
      map.set(sid, [order]);
    }
  }
  return map;
}

/**
 * Mark pending payment_links as expired once expires_at has passed.
 * Leader-only. Called by scheduler every 15 min.
 */
export async function expirePaymentLinks(): Promise<void> {
  try {
    const rows = await db.query<PaymentLinkExpireRow>(
      `UPDATE payment_links
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id, order_ref, conversation_id, amount`,
    );
    for (const row of rows) {
      paymentLinksExpiredTotal.inc();
      if (row.conversation_id) {
        try {
          await db.query(
            `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content, metadata)
             VALUES ($1, 'bot', 'system', 'Система', 'system', $2, $3::jsonb)`,
            [
              row.conversation_id,
              `Платёжная ссылка ${row.order_ref} истекла (24 часа). Создайте новую через «+ Заказ» → «Онлайн».`,
              JSON.stringify({ kind: 'payment_link_expired', paymentLinkId: row.id, orderRef: row.order_ref, amount: row.amount }),
            ],
          );
        } catch (err) {
          log.warn('failed to insert expired system message', { err: err instanceof Error ? err.message : String(err), paymentLinkId: row.id });
        }
      }
      if (row.conversation_id) {
        try {
          broadcastToRoom('chat:inbox-updated', 'admin:visitor-chats', {
            conversationId: row.conversation_id,
          });
          broadcastToRoom('payment-link:expired', 'admin:visitor-chats', {
            id: row.id,
            orderRef: row.order_ref,
            conversationId: row.conversation_id,
            amount: Number(row.amount),
          });
        } catch { /* pub/sub not available */ }
      }
    }
    if (rows.length > 0) {
      log.info(`[Payments] Expired ${rows.length} payment_links`);
    }
  } catch (err) {
    log.error('[Payments] expirePaymentLinks failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendAbandonedCartReminders(): Promise<void> {
  try {
    // 1) Заказы, неоплаченные 2 часа — первое напоминание
    //    Группировка по chat_session_id → один клиент = одно сообщение
    const twoHourOrders = await db.query<AbandonedOrder>(
      `SELECT order_id, total_price, chat_session_id, contact_email, contact_name, items
       FROM photo_print_orders
       WHERE status IN ('pending_payment', 'payment_failed')
         AND created_at < NOW() - INTERVAL '2 hours'
         AND created_at > NOW() - INTERVAL '3 hours'
         AND reminder_sent_at IS NULL
         AND payment_reminder_count = 0
         AND total_price >= 50`,
    );

    // Group by client (chat_session_id) to avoid spamming
    const twoHourByClient = groupOrdersBySession(twoHourOrders);

    for (const [sessionId, orders] of twoHourByClient) {
      // Re-check: между SQL-выборкой и отправкой клиент мог оплатить (race condition)
      const orderIds = orders.map((o) => o.order_id);
      const stillUnpaid = await db.query<AbandonedOrder>(
        `SELECT order_id, total_price, chat_session_id, contact_email, contact_name, items
         FROM photo_print_orders
         WHERE order_id = ANY($1)
           AND status IN ('pending_payment', 'payment_failed')
           AND payment_status NOT IN ('paid', 'confirmed')`,
        [orderIds],
      );
      if (stillUnpaid.length === 0) continue;

      // Используем только актуально неоплаченные заказы
      const activeOrders = stillUnpaid;
      const totalPrice = activeOrders.reduce((s, o) => s + parseFloat(String(o.total_price ?? '0')), 0);

      // Volume hint — check if ordering more would unlock a discount
      let volumeHint: string | null = null;
      try {
        const firstItem = firstServiceOptionQuantity(activeOrders[0].items);
        if (firstItem) {
          const hint = await getVolumeThresholdHints({
            serviceOptionId: firstItem.serviceOptionId,
            currentQty: firstItem.quantity,
          });
          if (hint) volumeHint = hint.label;
        }
      } catch {
        // non-critical — skip hint on error
      }

      // Push — одно на клиента
      sendVisitorChatPush(sessionId, {
        title: 'Своё Фото',
        body: activeOrders.length === 1
          ? `Не забудьте оплатить заказ на ${parseFloat(String(activeOrders[0].total_price ?? '0'))}₽`
          : `У вас ${activeOrders.length} неоплаченных заказа на ${totalPrice}₽`,
      }).catch(err => log.error('[Reminder] Push failed', { error: String(err) }));

      // Одно interactive-сообщение с кнопками для всех заказов
      const buttons: BotButton[] = [];
      for (const o of activeOrders) {
        const price = parseFloat(String(o.total_price ?? '0'));
        buttons.push(buildWidgetPaymentButton(o.order_id, price, `Оплата ${price}₽`));
        buttons.push({
          id: 'cancel_invoice',
          label: 'Отменить счёт',
          icon: 'cancel',
          value: 'cancel_invoice',
          color: '#ef4444',
          visibleTo: 'operator',
          data: { orderId: o.order_id },
        });
      }

      const interactive = {
        type: 'buttons',
        step: 'payment_reminder',
        buttons,
      };

      const baseContent = activeOrders.length === 1
        ? `Ваш заказ на ${parseFloat(String(activeOrders[0].total_price ?? '0'))}₽ ждёт оплаты.`
        : `У вас ${activeOrders.length} неоплаченных заказа на сумму ${totalPrice}₽. Выберите для оплаты:`;
      const content = volumeHint ? `${baseContent}\n\n💡 ${volumeHint}` : baseContent;

      await db.query(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)`,
        [sessionId, content, JSON.stringify({ interactive })],
      );

      // Outbound — deliver to messenger channel (Telegram, VK, WhatsApp)
      const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
        `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
        [sessionId],
      );
      if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
        await enqueueOutbound({
          channel: conv.channel,
          externalChatId: conv.external_chat_id,
          content,
          messageType: 'text',
          conversationId: sessionId,
        });
      }

      // Email — одно на клиента (берём данные первого заказа для контакта)
      const firstWithEmail = activeOrders.find((o) => o.contact_email);
      if (firstWithEmail?.contact_email) {
        const { sendPaymentReminder } = await import('../services/email.service.js');
        sendPaymentReminder(firstWithEmail.contact_email, {
          order_id: activeOrders[0].order_id,
          contact_name: firstWithEmail.contact_name,
          total_price: totalPrice,
          payment_url: `${config.cors.origin}/chat`,
          volumeHint,
        }).catch(err => log.error('[Reminder] Email failed:', err.message));
      }

      // Помечаем ВСЕ заказы клиента как отправленные (increment count)
      const activeOrderIds = activeOrders.map((o) => o.order_id);
      await db.query(
        `UPDATE photo_print_orders
         SET reminder_sent_at = NOW(),
             payment_reminder_count = payment_reminder_count + 1,
             payment_reminder_sent = true
         WHERE order_id = ANY($1)`,
        [activeOrderIds],
      );

      log.info('[Reminder] 2h reminder sent (grouped)', {
        sessionId,
        orderCount: activeOrders.length,
        orderIds: activeOrderIds,
      });
    }

    // 2) 22-hour final reminder — A/B test (variant A: standard, B: volume+urgency)
    const finalOrders = await db.query<AbandonedOrder>(
      `SELECT order_id, total_price, chat_session_id, contact_email, contact_name, items
       FROM photo_print_orders
       WHERE status IN ('pending_payment', 'payment_failed')
         AND payment_reminder_count = 1
         AND reminder_sent_at < NOW() - INTERVAL '22 hours'
         AND final_reminder_sent_at IS NULL
         AND total_price >= 50`,
    );

    const finalByClient = groupOrdersBySession(finalOrders);

    for (const [sessionId, orders] of finalByClient) {
      // Re-check: клиент мог оплатить между выборкой и отправкой
      const orderIds = orders.map((o) => o.order_id);
      const stillUnpaid = await db.query<AbandonedOrder>(
        `SELECT order_id, total_price, chat_session_id, contact_email, contact_name, items
         FROM photo_print_orders
         WHERE order_id = ANY($1)
           AND status IN ('pending_payment', 'payment_failed')
           AND payment_status NOT IN ('paid', 'confirmed')`,
        [orderIds],
      );
      if (stillUnpaid.length === 0) continue;

      const activeOrders = stillUnpaid;
      const totalPrice = activeOrders.reduce((s, o) => s + parseFloat(String(o.total_price ?? '0')), 0);

      // A/B variant assignment
      const variant = Math.random() < 0.5 ? 'A' : 'B';

      // Volume hint for variant B
      let volumeHint: string | null = null;
      if (variant === 'B') {
        try {
          const firstItem = firstServiceOptionQuantity(activeOrders[0].items);
          if (firstItem) {
            const hint = await getVolumeThresholdHints({
              serviceOptionId: firstItem.serviceOptionId,
              currentQty: firstItem.quantity,
            });
            if (hint) volumeHint = hint.label;
          }
        } catch {
          // non-critical — skip hint on error
        }
      }

      // Push notification
      sendVisitorChatPush(sessionId, {
        title: 'Своё Фото',
        body: activeOrders.length === 1
          ? `Напоминание: заказ на ${parseFloat(String(activeOrders[0].total_price ?? '0'))}₽ ждёт оплаты`
          : `Напоминание: ${activeOrders.length} заказа на ${totalPrice}₽ ждут оплаты`,
      }).catch(err => log.error('[Reminder] 22h push failed', { error: String(err) }));

      // Interactive message with payment buttons
      const buttons = activeOrders.map((o) => {
        const price = parseFloat(String(o.total_price ?? '0'));
        return buildWidgetPaymentButton(o.order_id, price, `Оплата ${price}₽`);
      });

      const interactive = {
        type: 'buttons',
        step: 'payment_final_reminder',
        buttons,
      };

      // Message text depends on A/B variant
      const priceStr = activeOrders.length === 1
        ? `${parseFloat(String(activeOrders[0].total_price ?? '0'))}₽`
        : `${totalPrice}₽`;

      let content: string;
      if (variant === 'B' && volumeHint) {
        content = `Ваш заказ на ${priceStr} готов к оплате. Ссылка активна ещё 2 часа.\n\n💡 ${volumeHint}`;
      } else {
        // Variant A, or Variant B without volumeHint (fallback to standard)
        content = `Напоминание: ваш заказ на ${priceStr} готов к оплате. Ссылка активна ещё 2 часа.`;
      }

      await db.query(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)`,
        [sessionId, content, JSON.stringify({ interactive })],
      );

      // Outbound — deliver to messenger channel
      const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
        `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
        [sessionId],
      );
      if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
        await enqueueOutbound({
          channel: conv.channel,
          externalChatId: conv.external_chat_id,
          content,
          messageType: 'text',
          conversationId: sessionId,
        });
      }

      // Email with isFinal: true
      const firstWithEmail = activeOrders.find((o) => o.contact_email);
      if (firstWithEmail?.contact_email) {
        const { sendPaymentReminder } = await import('../services/email.service.js');
        sendPaymentReminder(firstWithEmail.contact_email, {
          order_id: activeOrders[0].order_id,
          contact_name: firstWithEmail.contact_name,
          total_price: totalPrice,
          payment_url: `${config.cors.origin}/chat`,
          isFinal: true,
          volumeHint: variant === 'B' ? volumeHint : undefined,
        }).catch(err => log.error('[Reminder] 22h email failed:', err.message));
      }

      // Mark all orders: final_reminder_sent_at, increment count, store A/B variant
      const activeOrderIds = activeOrders.map((o) => o.order_id);
      await db.query(
        `UPDATE photo_print_orders
         SET final_reminder_sent_at = NOW(),
             payment_reminder_count = payment_reminder_count + 1,
             reminder_ab_variant = $2
         WHERE order_id = ANY($1)`,
        [activeOrderIds, variant],
      );

      log.info('[Reminder] 22h final reminder sent (A/B)', {
        sessionId,
        variant,
        orderCount: activeOrders.length,
        orderIds: activeOrderIds,
        hasVolumeHint: !!volumeHint,
      });
    }
  } catch (err) {
    log.error('[Reminder] Failed to send reminders:', { error: String(err) });
  }
}

// NOTE: reminder scheduling moved to payment-scheduler.service.ts (leader-only).

// ============================================================================
// API: Заказы пользователя (для истории)
// ============================================================================

router.get('/my-orders', async (req: Request, res: Response) => {
  const visitorId = (req.query['visitorId'] as string) || '';
  if (!visitorId) {
    throw new AppError(400, 'visitorId обязателен');
  }

    interface MyOrderRow {
      order_id: string; status: string; payment_status: string; total_price: string;
      paid_at: Date | null; created_at: Date; items: unknown; payment_card_info: string | null;
      delivery_address: string | null; delivery_cost: string | null; contact_email: string | null;
      priority: string; delivery_method: string | null;
    }
    const result = await db.query<MyOrderRow>(
      `SELECT o.order_id, o.status, o.payment_status, o.total_price,
              o.paid_at, o.created_at, o.items, o.payment_card_info,
              o.delivery_address, o.delivery_cost, o.contact_email, o.priority,
              o.delivery_method
       FROM photo_print_orders o
       JOIN conversations s ON s.id = o.chat_session_id
       WHERE s.visitor_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [visitorId],
    );

    res.json({
      success: true,
      orders: result.map(r => ({
        id: r.order_id,
        status: r.status,
        paymentStatus: r.payment_status,
        totalPrice: parseFloat(String(r.total_price || '0')),
        paidAt: r.paid_at,
        createdAt: r.created_at,
        items: r.items,
        cardInfo: r.payment_card_info,
        deliveryAddress: r.delivery_address,
        deliveryCost: r.delivery_cost ? parseFloat(String(r.delivery_cost)) : null,
        email: r.contact_email,
        priority: r.priority || 'normal',
        deliveryMethod: r.delivery_method,
      })),
    });
});

/**
 * Быстрая касса — запись продажи из CRM
 * POST /api/payments/quick-sale
 *
 * Кассир записывает оплату после обслуживания клиента.
 * Параллельно Контур Маркет используется для фискального чека.
 * Этот endpoint нужен для атрибуции продажи к рекламной кампании.
 */
router.post('/quick-sale', validate(quickSaleSchema), async (req: Request, res: Response): Promise<void> => {
    const { phone, amount, services, taskId, chatSessionId } = req.body;

    let fingerprintVisitorId: string | undefined;
    let resolvedPhone: string | undefined = phone;

    // Путь 1: через задачу CRM → чат-сессия → fingerprint
    if (taskId) {
      const task = await db.queryOne<WorkTaskPaymentSourceRow>(
        'SELECT chat_session_id, client_id FROM work_tasks WHERE id = $1',
        [taskId]
      );
      if (task?.chat_session_id) {
        const session = await db.queryOne<ConversationAttributionRow>(
          'SELECT visitor_id, visitor_phone FROM conversations WHERE id = $1',
          [task.chat_session_id]
        );
        if (session?.visitor_id?.startsWith('sf_')) {
          fingerprintVisitorId = session.visitor_id;
        }
        if (!resolvedPhone && session?.visitor_phone) {
          resolvedPhone = session.visitor_phone;
        }
      }
      if (task?.client_id && !resolvedPhone) {
        const client = await db.queryOne<UserPhoneRow>('SELECT phone FROM users WHERE id = $1', [task.client_id]);
        if (client?.phone) resolvedPhone = client.phone;
      }
    }

    // Путь 2: через чат-сессию напрямую
    if (!fingerprintVisitorId && chatSessionId) {
      const session = await db.queryOne<ConversationAttributionRow>(
        'SELECT visitor_id, visitor_phone FROM conversations WHERE id = $1',
        [chatSessionId]
      );
      if (session?.visitor_id?.startsWith('sf_')) {
        fingerprintVisitorId = session.visitor_id;
      }
      if (!resolvedPhone && session?.visitor_phone) {
        resolvedPhone = session.visitor_phone;
      }
    }

    // Отправляем в Bridge API для атрибуции
    const bridgePayload: QuickSaleBridgePayload = {
      amount,
      source: 'quick_sale',
      services: services || ['Продажа'],
    };
    if (fingerprintVisitorId) bridgePayload.fingerprint_visitor_id = fingerprintVisitorId;
    if (resolvedPhone) bridgePayload.phone = resolvedPhone;

    let attribution: BridgeAttributionResponse = {};
    try {
      const bridgeResponse = await fetch(`${config.bridge.url}/api/bridge/save-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bridgePayload),
        signal: AbortSignal.timeout(10_000),
      });
      if (bridgeResponse.ok) {
        attribution = await bridgeResponse.json();
      }
    } catch (err: unknown) {
      log.error('QuickSale Bridge API error', { error: err instanceof Error ? err.message : String(err) });
    }

    // Если есть taskId — обновляем задачу как завершённую
    if (taskId) {
      await db.query(
        `UPDATE work_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [taskId]
      );
      await db.query(
        `INSERT INTO task_notes (task_id, author_id, note_type, content, created_at)
         VALUES ($1, NULL, 'system', $2, NOW())`,
        [taskId, `Оплата записана: ${amount}₽ (${(services || []).join(', ')})`]
      );
    }

    // Record employee sale for commission tracking
    let saleEmployeeId: string | null = null;
    if (taskId) {
      const taskOwner = await db.queryOne<TaskOwnerLookup>(
        'SELECT assigned_to FROM work_tasks WHERE id = $1', [taskId]);
      saleEmployeeId = taskOwner?.assigned_to ?? null;
    }
    if (!saleEmployeeId) {
      const activeShift = await db.queryOne<ActiveShiftLookup>(
        `SELECT employee_id FROM employee_shifts
         WHERE shift_date = CURRENT_DATE AND status IN ('active', 'scheduled')
         ORDER BY checked_in_at DESC NULLS LAST LIMIT 1`);
      saleEmployeeId = activeShift?.employee_id ?? null;
    }
    if (saleEmployeeId && amount > 0) {
      try {
        const saleReceiptId = `quick-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await db.transaction(async (txClient) => {
          await recordEmployeeSale(saleReceiptId, saleEmployeeId!, amount, null, txClient, 'pos');
        });
      } catch (e) {
        log.warn('QuickSale commission recording failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Планируем запрос отзыва через 30 минут
    if (resolvedPhone) {
      scheduleReviewRequest({
        clientPhone: resolvedPhone,
        source: 'quicksale',
      }).catch(err => log.error('[QuickSale] Review schedule failed', { error: String(err) }));
    }

    log.info('QuickSale recorded', {
      amount,
      phone: resolvedPhone || 'none',
      fp: fingerprintVisitorId?.substring(0, 8) || 'none',
      attributed: !!attribution['attributed_campaign_id'],
    });

    res.json({
      success: true,
      amount,
      phone: resolvedPhone,
      fingerprint: fingerprintVisitorId ? fingerprintVisitorId.substring(0, 8) + '...' : null,
      attribution: {
        campaign_id: attribution['attributed_campaign_id'] || null,
        utm_source: attribution['first_utm_source'] || null,
        utm_campaign: attribution['first_utm_campaign'] || null,
      },
    });
});

// Bitrix24 Redis publisher removed — no-op retained for backward compat
export async function closePaymentsRedis(): Promise<void> {
  // noop — Bitrix24 Redis publisher was removed
}

export default router;
