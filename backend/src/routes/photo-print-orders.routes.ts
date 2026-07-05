import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { PoolClient } from 'pg';
import db, { pool } from '../database/db.js';
import { requireTelegramAuth } from '../middleware/telegramAuth.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createTaskFromWalkIn, createTaskFromOrder } from '../services/task-auto.service.js';
import { v4 as uuidv4 } from 'uuid';
import { processAndNotify } from '../services/photo-print-processing.service.js';
import { sendVisitorChatPush } from '../services/visitor-push.service.js';
import { sendOrderStatusUpdate } from '../services/email.service.js';
import { generateOrderId, secureRandomString } from '../utils/secure-random.js';
import { recalculateQueue, updateEstimatedTimes, recordStatusChange, getStatusHistory, getQueuePosition, getQueueStats } from '../services/queue.service.js';
import {
  getCurrentShift,
  createReceipt,
  calculateSubscriptionCoverageWithClient,
  type SubscriptionCoverageInputItem,
  type SubscriptionCoverageResult,
} from '../services/pos.service.js';
import { useCreditsWithClient } from '../services/subscription.service.js';
import { findOrCreateCustomer } from '../services/customer.service.js';
import { storageService } from '../services/storage.service.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { notifyChatOrderPaidService, syncChatPaymentCardStatus } from '../services/payment.service.js';
import { enqueuePostPaymentJobs, type OrderPaymentData } from '../services/post-payment-queue.service.js';
import { createLogger } from '../utils/logger.js';
import { appendReadableToArchive } from '../utils/archive-utils.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { generateAutoReminders } from '../services/order-reminder.service.js';
import { generateSignedUrl } from '../services/signed-url.service.js';
import { linkChatByPhone } from '../services/chat-link.service.js';
import { validateAddress } from '../services/delivery.service.js';
import { selectNearestStudio } from '../services/delivery/source-studio.service.js';
import { resolveZone } from '../services/delivery/zone-resolver.service.js';
import { checkPrice, normalizeLonLat, calculateParcelWeight } from '../services/delivery/yandex-delivery.service.js';
import { config } from '../config/index.js';
import { computeSlaFromOrderItems } from '../services/sla.service.js';
import { calculateFeatureLevelUnitPrice } from '../services/pricing-engine.service.js';
import { persistAutoReminders } from '../services/order-reminder-persist.service.js';
import { autoPrintOrderItems, shouldAutoPrint } from '../services/print.service.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { applyOrderStatusChange } from '../services/order-status.service.js';
import { recordBusinessEvent } from '../services/business-observability.service.js';
import { captureOrderServiceAttribution } from '../services/service-attribution-forward.js';
import { createRetouchTaskFromCrm } from '../services/retouch.service.js';
import { resolveRetouchConfig } from '../services/retouch-checklist.service.js';
import type { SocketServer } from '../websocket/socket-server.js';
import { logAndEmit } from '../websocket/log-and-emit.js';
import orderAttachmentsRouter from './order-attachments-upload.routes.js';
import type PhotoPrintOrders from '../types/generated/public/PhotoPrintOrders.js';
import type { PhotoPrintOrdersId } from '../types/generated/public/PhotoPrintOrders.js';
import type PosReceipts from '../types/generated/public/PosReceipts.js';
import type ServiceOptions from '../types/generated/public/ServiceOptions.js';
import type OrderItems from '../types/generated/public/OrderItems.js';
import type { PhotoPrintOrder } from '../types/views/print-order-views.js';
import type {
  OrderItemDetailRow,
  OrderItemFeatureBreakdownRow,
} from '../types/views/pricing-views.js';
import type { PickupStudioLookupRow } from '../types/views/studio-views.js';
import type Conversations from '../types/generated/public/Conversations.js';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { validate } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { enqueueCashDrawerCommandSafe } from '../services/cash-drawer.service.js';
import {
  createPhotoPrintOrderSchema, type CreatePhotoPrintOrderInput,
  importBotPhotosSchema, type ImportBotPhotosInput,
  importBotPhotoSchema, type ImportBotPhotoInput,
  createWalkInOrderSchema, type CreateWalkInOrderInput,
  crmCreateOrderSchema, type CrmCreateOrderInput,
  editOrderSchema, type EditOrderInput,
  assignOrderSchema, type AssignOrderInput,
  updateOrderStatusSchema, type UpdateOrderStatusInput,
  workflowActionSchema, type WorkflowActionInput,
  recordPaymentSchema, type RecordPaymentInput,
  payWithSubscriptionSchema, type PayWithSubscriptionInput,
  remindPaymentSchema,
  markPaidSchema, type MarkPaidInput,
  cancelPaymentSchema, type CancelPaymentInput,
  patchOrderItemSchema, type PatchOrderItemInput,
} from '../schemas/orders.schema.js';
import { pricingFeatureValidationRejectTotal } from '../services/metrics.service.js';

const log = createLogger('photo-print-orders');
const DEFAULT_ORDER_WORK_MINUTES = 30;
const URGENT_ORDER_WORK_MINUTES = 15;
// Неоплаченный заказ старше этого порога считается «зависшим» и прячется из
// активной очереди (доступен на вкладке «Зависшие»). Оплаченные не прячем.
const STALE_ORDER_DAYS = 7;

function enqueueCashDrawerForCurrentShift(input: {
  readonly userId: string;
  readonly orderId: string;
  readonly source: string;
}): void {
  getCurrentShift(input.userId)
    .then(shift => {
      if (!shift?.studio_id) {
        log.warn('Cash drawer skipped: no open POS shift for user', {
          orderId: input.orderId,
          userId: input.userId,
          source: input.source,
        });
        return;
      }

      enqueueCashDrawerCommandSafe({
        studioId: shift.studio_id,
        initiatedBy: input.userId,
        orderId: input.orderId,
        source: input.source,
      });
    })
    .catch((err: unknown) => log.warn('Cash drawer shift lookup failed', {
      orderId: input.orderId,
      userId: input.userId,
      source: input.source,
      error: err instanceof Error ? err.message : String(err),
    }));
}
const VIP_ORDER_WORK_MINUTES = 30;

interface CountRow {
  count: string;
}

interface TaskCountRow {
  cnt: string;
}

interface CreatedOrderRow {
  id: string;
  order_id: string;
}

interface ContactLookupRow {
  display_name: string | null;
  phone: string | null;
  email: string | null;
}

interface DocumentTemplateLookupRow {
  slug: string;
  category: string;
}

interface ActiveEmployeeShiftForOrderRow {
  id: string;
  studio_id: string;
  studio_name: string | null;
  studio_address: string | null;
  location_code: string | null;
}

interface OrderTargetStudioRow {
  order_id: string;
  order_studio_id: string | null;
  order_studio_name: string | null;
  order_studio_address: string | null;
  order_location_code: string | null;
}

interface ImportedBotPhoto {
  fileId: string;
  url: string;
}

interface SignableOrderRow {
  items: unknown;
  [key: string]: unknown;
}

interface PrintPhotoArchiveOrderRow {
  order_id: string;
  contact_name: string | null;
  items: unknown;
}

interface PrintPhotoArchiveItem {
  uploadedUrl: string;
  format?: string;
  paperType?: string;
  name?: string;
}

interface OrderAttachmentRow {
  id: string;
  s3_url: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  attachment_type: string;
  sort_order: number;
  created_at: string;
}

interface TrackingOrderRow {
  order_id: string;
  status: string;
  payment_status: string;
  contact_name: string;
  created_at: string;
  updated_at: string;
  total_price: string;
  priority: string;
  queue_position: number | null;
  estimated_ready_at: string | null;
  processing_started_at: string | null;
  delivery_method: string | null;
  items: unknown;
}

interface OrderStatusLookupRow {
  id: string;
  status: string;
}

interface EditableOrderLookupRow extends OrderStatusLookupRow {
  chat_session_id: string | null;
}

interface DeleteOrderLookupRow {
  id: string;
  order_id: string;
  status: string | null;
  payment_status: string | null;
  chat_session_id: string | null;
}

interface DeleteOrderBlockersRow {
  print_jobs_count: number;
  production_orders_count: number;
  pos_receipts_count: number;
  pos_transactions_count: number;
  payment_events_count: number;
  payment_installments_count: number;
  refund_requests_count: number;
  priority_purchases_count: number;
  promo_redemptions_count: number;
  subscription_credit_usage_count: number;
  student_discount_redemptions_count: number;
}

type PhotoPrintPaymentOrderRow = Pick<PhotoPrintOrders, 'id' | 'payment_status' | 'status' | 'total_price'> & {
  items: unknown;
};

type PhotoPrintSubscriptionPaymentOrderRow = PhotoPrintPaymentOrderRow & Pick<PhotoPrintOrders, 'contact_phone'>;
type PosReceiptCardPaymentGuardRow = Pick<PosReceipts, 'id' | 'total' | 'print_order_id' | 'is_refund' | 'voided_at'>;

interface PosReceiptPaymentTotalRow {
  payment_total: string | number | null;
}

type ServiceOptionProductRow = Pick<ServiceOptions, 'id' | 'slug' | 'name' | 'product_id'>;

interface ProductLookupRow {
  id: string;
  name: string;
}

interface SubscriptionPaymentOwnerRow {
  id: string;
  user_id: string | null;
  phone: string | null;
}

interface PrintOrderCoverageCandidate {
  productId: string | null;
  serviceOptionId: string | null;
  optionSlug: string | null;
  fallbackProductName: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PrintOrderCoverageItemRow {
  product_id: string | null;
  service_option_id: string | null;
  service_option_product_id: string | null;
  product_name: string | null;
  quantity: number | string;
  unit_price: number | string;
  total: number | string;
}

interface PrintOrderItemRecord {
  [key: string]: unknown;
}

interface OrderItemMetadata {
  disabled_features?: string[];
  sla_quantity?: number;
  [key: string]: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ONLINE_PHOTO_PRINT_PRODUCT_BY_FORMAT = new Map<string, string>([
  ['10x15', 'Фотобумага 10x15 Premium'],
  ['10x15_super', 'Фотобумага 10x15 Super'],
  ['10x15_matte', 'Фотобумага 10x15 Premium'],
  ['10x15_glossy', 'Фотобумага 10x15 Premium'],
  ['10x15_satin', 'Фотобумага 10x15 Super'],
  ['10x15_supergloss', 'Фотобумага 10x15 Super'],
  ['15x20', 'Фотобумага 15x21 Premium'],
  ['15x20_super', 'Фотобумага 15x21 Super'],
  ['15x20_matte', 'Фотобумага 15x21 Premium'],
  ['15x20_glossy', 'Фотобумага 15x21 Premium'],
  ['15x20_satin', 'Фотобумага 15x21 Super'],
  ['15x20_supergloss', 'Фотобумага 15x21 Super'],
  ['20x30', 'Фотобумага 21x30 (A4) Premium'],
  ['20x30_super', 'Фотобумага 21x30 (A4) Super'],
  ['20x30_matte', 'Фотобумага 21x30 (A4) Premium'],
  ['20x30_glossy', 'Фотобумага 21x30 (A4) Premium'],
  ['20x30_satin', 'Фотобумага 21x30 (A4) Super'],
  ['20x30_supergloss', 'Фотобумага 21x30 (A4) Super'],
  ['30x40', 'Фотобумага 30x40 Premium'],
  ['40x50', 'Фотобумага 40x50 Premium'],
]);

function isUuid(value: string | null): value is string {
  return value !== null && UUID_RE.test(value);
}

function isJsonRecord(value: unknown): value is PrintOrderItemRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJsonRecord(value: unknown): PrintOrderItemRecord | null {
  return isJsonRecord(value) ? value : null;
}

function stringField(record: PrintOrderItemRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function numberField(record: PrintOrderItemRecord, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function positiveQuantity(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.floor(parsed));
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePhoneDigits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeOnlinePhotoFormat(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/[×х]/g, 'x').replace(/-/g, '_');
}

async function findActiveEmployeeShiftForOrder(employeeId: string): Promise<ActiveEmployeeShiftForOrderRow | null> {
  return db.queryOne<ActiveEmployeeShiftForOrderRow>(
    `SELECT es.id,
            es.studio_id,
            s.name AS studio_name,
            s.address AS studio_address,
            s.location_code
     FROM employee_shifts es
     LEFT JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1
       AND es.shift_date = (NOW() AT TIME ZONE 'Europe/Moscow')::date
       AND es.status = 'active'
     ORDER BY es.checked_in_at DESC NULLS LAST, es.created_at DESC NULLS LAST
     LIMIT 1`,
    [employeeId],
  );
}

async function findOrderTargetStudio(
  orderId: string,
  client?: PoolClient,
): Promise<OrderTargetStudioRow | null> {
  const query = `
    SELECT p.order_id,
           COALESCE(active_assignment.studio_id, delivery_studio.id) AS order_studio_id,
           COALESCE(assignment_studio.name, delivery_studio.name) AS order_studio_name,
           COALESCE(assignment_studio.address, delivery_studio.address) AS order_studio_address,
           COALESCE(assignment_studio.location_code, delivery_studio.location_code) AS order_location_code
    FROM photo_print_orders p
    LEFT JOIN LATERAL (
      SELECT oa.studio_id
      FROM order_assignments oa
      WHERE oa.order_id = p.order_id
        AND oa.status NOT IN ('completed', 'cancelled')
      ORDER BY oa.assigned_at DESC NULLS LAST, oa.created_at DESC NULLS LAST
      LIMIT 1
    ) active_assignment ON true
    LEFT JOIN studios assignment_studio ON assignment_studio.id = active_assignment.studio_id
    LEFT JOIN LATERAL (
      SELECT s.id, s.name, s.address, s.location_code
      FROM studios s
      WHERE active_assignment.studio_id IS NULL
        AND p.delivery_address IS NOT NULL
        AND (
          p.delivery_address ILIKE '%' || s.address || '%'
          OR s.address ILIKE '%' || p.delivery_address || '%'
          OR p.delivery_address ILIKE '%' || s.name || '%'
        )
      ORDER BY length(COALESCE(s.address, '')) DESC
      LIMIT 1
    ) delivery_studio ON true
    WHERE p.order_id = $1
    LIMIT 1`;

  if (client) {
    return (await client.query<OrderTargetStudioRow>(query, [orderId])).rows[0] ?? null;
  }
  return db.queryOne<OrderTargetStudioRow>(query, [orderId]);
}

async function assertOrderStudioAccess(
  params: { orderId: string; employeeId: string; overrideLocation: boolean },
): Promise<void> {
  const [shift, target] = await Promise.all([
    findActiveEmployeeShiftForOrder(params.employeeId),
    findOrderTargetStudio(params.orderId),
  ]);

  if (!target) {
    throw new AppError(404, 'Order not found');
  }
  if (!shift) {
    throw new AppError(409, 'Сначала начните рабочий день в нужной точке', 'WORKDAY_REQUIRED');
  }
  if (!target.order_studio_id || target.order_studio_id === shift.studio_id || params.overrideLocation) {
    return;
  }

  const orderStudio = target.order_studio_name || target.order_studio_address || 'другую точку';
  const currentStudio = shift.studio_name || shift.studio_address || 'текущую точку';
  throw new AppError(
    409,
    `Заказ адресован на ${orderStudio}, а рабочий день открыт на ${currentStudio}`,
    'ORDER_STUDIO_MISMATCH',
  );
}

async function resolvePickupStudio(locationId: string | undefined): Promise<PickupStudioLookupRow | null> {
  const normalizedLocationId = locationId?.trim();
  if (!normalizedLocationId) return null;

  return db.queryOne<PickupStudioLookupRow>(
    `SELECT id::text,
            name,
            address,
            location_code,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN 'open'
                 ELSE COALESCE(status, 'open')
            END AS status,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN NULL
                 ELSE status_message
            END AS status_message,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN NULL
                 ELSE status_until::text
            END AS status_until
     FROM studios
     WHERE location_code = $1 OR id::text = $1
     LIMIT 1`,
    [normalizedLocationId],
  );
}

function parsePrintOrderItems(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed: unknown = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error: unknown) {
      log.warn('print order items JSON parse failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
  return [];
}

async function resolveNormalizedSubscriptionCoverageItemsForPrintOrder(
  client: PoolClient,
  orderId: string,
): Promise<SubscriptionCoverageInputItem[]> {
  const rows = await client.query<PrintOrderCoverageItemRow>(
    `SELECT
       oi.product_id,
       oi.service_option_id,
       so.product_id AS service_option_product_id,
       COALESCE(oi.name, so.name, 'Услуга') AS product_name,
       oi.quantity,
       oi.unit_price,
       oi.subtotal AS total
     FROM order_items oi
     LEFT JOIN service_options so ON so.id = oi.service_option_id
     WHERE oi.order_id = $1
     ORDER BY oi.created_at ASC, oi.id ASC`,
    [orderId],
  );

  const coverageItems: SubscriptionCoverageInputItem[] = [];
  for (const row of rows.rows) {
    const productId = row.product_id ?? row.service_option_product_id;
    const quantity = positiveQuantity(row.quantity);
    const unitPrice = finiteNumber(row.unit_price, 0);
    const total = roundCurrency(finiteNumber(row.total, unitPrice * quantity));
    if (!productId || quantity <= 0 || total <= 0) continue;

    coverageItems.push({
      product_id: productId,
      product_name: row.product_name || 'Услуга',
      quantity,
      unit_price: unitPrice > 0 ? unitPrice : roundCurrency(total / quantity),
      total,
    });
  }

  return coverageItems;
}

async function resolveJsonSnapshotSubscriptionCoverageItemsForPrintOrder(
  client: PoolClient,
  items: unknown,
): Promise<SubscriptionCoverageInputItem[]> {
  const candidates: PrintOrderCoverageCandidate[] = [];
  const serviceOptionIds = new Set<string>();
  const optionSlugs = new Set<string>();
  const fallbackProductNames = new Set<string>();

  for (const rawItem of parsePrintOrderItems(items)) {
    const item = asJsonRecord(rawItem);
    if (!item) continue;

    const productId = stringField(item, ['product_id', 'productId']);
    const serviceOptionId = stringField(item, ['service_option_id', 'serviceOptionId', 'option_id', 'id']);
    const optionSlug = stringField(item, ['option_slug', 'slug', 'format_slug', 'format']);
    const quantity = positiveQuantity(item['quantity']);
    const unitPrice = numberField(item, ['unit_price', 'unitPrice', 'price'], 0);
    const total = roundCurrency(numberField(item, ['total', 'subtotal'], unitPrice * quantity));
    const productName = stringField(item, ['product_name', 'productName', 'name', 'service', 'format']) ?? 'Услуга';
    const fallbackProductName = ONLINE_PHOTO_PRINT_PRODUCT_BY_FORMAT.get(normalizeOnlinePhotoFormat(optionSlug) ?? '') ?? null;

    const normalizedServiceOptionId = isUuid(serviceOptionId) ? serviceOptionId : null;
    const normalizedProductId = isUuid(productId) ? productId : null;
    if (normalizedServiceOptionId) serviceOptionIds.add(normalizedServiceOptionId);
    if (optionSlug) optionSlugs.add(optionSlug);
    if (fallbackProductName) fallbackProductNames.add(fallbackProductName);

    candidates.push({
      productId: normalizedProductId,
      serviceOptionId: normalizedServiceOptionId,
      optionSlug,
      fallbackProductName,
      productName,
      quantity,
      unitPrice,
      total,
    });
  }

  const optionsById = new Map<string, ServiceOptionProductRow>();
  const optionsBySlug = new Map<string, ServiceOptionProductRow>();
  const productsByName = new Map<string, ProductLookupRow>();

  if (serviceOptionIds.size > 0 || optionSlugs.size > 0) {
    const options = await client.query<ServiceOptionProductRow>(
      `SELECT id, slug, name, product_id
       FROM service_options
       WHERE id = ANY($1::uuid[]) OR slug = ANY($2::text[])`,
      [[...serviceOptionIds], [...optionSlugs]],
    );
    for (const option of options.rows) {
      optionsById.set(option.id, option);
      optionsBySlug.set(option.slug, option);
    }
  }

  if (fallbackProductNames.size > 0) {
    const products = await client.query<ProductLookupRow>(
      `SELECT id, name
       FROM products
       WHERE name = ANY($1::text[])`,
      [[...fallbackProductNames]],
    );
    for (const product of products.rows) {
      productsByName.set(product.name, product);
    }
  }

  const coverageItems: SubscriptionCoverageInputItem[] = [];
  for (const candidate of candidates) {
    const option = candidate.serviceOptionId
      ? optionsById.get(candidate.serviceOptionId)
      : candidate.optionSlug
        ? optionsBySlug.get(candidate.optionSlug)
        : undefined;
    const fallbackProduct = candidate.fallbackProductName
      ? productsByName.get(candidate.fallbackProductName)
      : undefined;
    const productId = candidate.productId ?? option?.product_id ?? fallbackProduct?.id ?? null;
    if (!productId || candidate.quantity <= 0 || candidate.total <= 0) continue;

    coverageItems.push({
      product_id: productId,
      product_name: candidate.productName || option?.name || 'Услуга',
      quantity: candidate.quantity,
      unit_price: candidate.unitPrice > 0 ? candidate.unitPrice : roundCurrency(candidate.total / candidate.quantity),
      total: candidate.total,
    });
  }

  return coverageItems;
}

async function resolveSubscriptionCoverageItemsForPrintOrder(
  client: PoolClient,
  params: { orderId: string; items: unknown },
): Promise<SubscriptionCoverageInputItem[]> {
  const normalizedItems = await resolveNormalizedSubscriptionCoverageItemsForPrintOrder(client, params.orderId);
  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  return resolveJsonSnapshotSubscriptionCoverageItemsForPrintOrder(client, params.items);
}

async function assertOnlineSubscriptionPaymentOwnerWithClient(
  client: PoolClient,
  params: {
    subscriptionId: string;
    userId: string;
    userPhone: string | null | undefined;
    orderPhone: string | null | undefined;
  },
): Promise<void> {
  const subscription = (await client.query<SubscriptionPaymentOwnerRow>(
    `SELECT id, user_id, phone
     FROM user_subscriptions
     WHERE id = $1 AND status = 'active'
     FOR UPDATE`,
    [params.subscriptionId],
  )).rows[0];

  if (!subscription) {
    throw new AppError(404, 'Active subscription not found');
  }
  if (subscription.user_id !== params.userId) {
    throw new AppError(403, 'Subscription does not belong to current user');
  }

  const orderPhone = normalizePhoneDigits(params.orderPhone);
  if (!orderPhone) {
    throw new AppError(403, 'Order phone is required for online subscription payment');
  }

  const allowedPhones = [
    normalizePhoneDigits(params.userPhone),
    normalizePhoneDigits(subscription.phone),
  ].filter(Boolean);
  if (allowedPhones.length === 0) {
    throw new AppError(403, 'Subscription owner phone is required for online subscription payment');
  }
  if (allowedPhones.length > 0 && !allowedPhones.includes(orderPhone)) {
    throw new AppError(403, 'Order phone does not match subscription owner');
  }
}

function isImportedBotPhoto(value: ImportedBotPhoto | null): value is ImportedBotPhoto {
  return value !== null;
}

function isObjectItem(value: unknown): value is { uploadedUrl?: unknown; [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

/** Sign uploadedUrl in items array so CRM <img> tags can load guest files */
const STAFF_FILE_URL_TTL_SECONDS = 24 * 60 * 60;
const MEDIA_PROXY_PATH_PREFIX = '/media/';

function absoluteUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isSafeMediaKey(key: string): boolean {
  return key.length > 0 && !key.startsWith('/') && !key.includes('..');
}

function normalizeStorageKey(key: string): string {
  return key.split(/[?#]/, 1)[0] ?? key;
}

function extractMediaProxyKey(url: string): { key: string; origin: string | null } | null {
  const storageKey = storageService.keyFromUrl(url);
  if (storageKey && isSafeMediaKey(storageKey)) {
    return { key: normalizeStorageKey(storageKey), origin: absoluteUrlOrigin(url) };
  }

  try {
    const parsed = new URL(url, 'https://svoefoto.ru');
    if (!parsed.pathname.startsWith(MEDIA_PROXY_PATH_PREFIX)) return null;
    const key = parsed.pathname.slice(MEDIA_PROXY_PATH_PREFIX.length);
    if (!isSafeMediaKey(key)) return null;
    return { key, origin: absoluteUrlOrigin(url) };
  } catch {
    return null;
  }
}

function signMediaProxyUrlForStaff(url: string): string | null {
  const media = extractMediaProxyKey(url);
  if (!media) return null;

  const signedPath = generateSignedUrl(
    `${MEDIA_PROXY_PATH_PREFIX}${media.key}`,
    config.guestSession.secret,
    { expiresInMs: STAFF_FILE_URL_TTL_SECONDS * 1000 },
  );

  return media.origin ? `${media.origin}${signedPath}` : signedPath;
}

async function resolveStaffFileUrl(url: string): Promise<string> {
  if (url.startsWith('/api/files/')) {
    return generateSignedUrl(url, config.guestSession.secret, { expiresInMs: STAFF_FILE_URL_TTL_SECONDS * 1000 });
  }

  const signedMediaUrl = signMediaProxyUrlForStaff(url);
  if (signedMediaUrl) return signedMediaUrl;

  try {
    return await storageService.resolveSignedUrl(url, STAFF_FILE_URL_TTL_SECONDS);
  } catch (error: unknown) {
    log.warn('failed to sign staff file URL', {
      error: error instanceof Error ? error.message : String(error),
    });
    return url;
  }
}

async function signItemUrls(items: unknown): Promise<unknown[]> {
  const parsedItems = parsePrintOrderItems(items);
  return Promise.all(parsedItems.map(async item => {
    if (!isObjectItem(item)) return item;
    const uploadedUrl = item.uploadedUrl;
    if (typeof uploadedUrl === 'string' && uploadedUrl.trim()) {
      return { ...item, uploadedUrl: await resolveStaffFileUrl(uploadedUrl) };
    }
    return item;
  }));
}

function printPhotoArchiveItems(items: unknown): PrintPhotoArchiveItem[] {
  const archiveItems: PrintPhotoArchiveItem[] = [];
  for (const rawItem of parsePrintOrderItems(items)) {
    const item = asJsonRecord(rawItem);
    if (!item) continue;

    const uploadedUrl = stringField(item, ['uploadedUrl', 'uploaded_url', 'url']);
    if (!uploadedUrl) continue;

    archiveItems.push({
      uploadedUrl,
      format: stringField(item, ['format']) ?? undefined,
      paperType: stringField(item, ['paperType', 'paper_type']) ?? undefined,
      name: stringField(item, ['name', 'service']) ?? undefined,
    });
  }
  return archiveItems;
}

function sanitizeArchiveSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function archivePhotoExtension(url: string): string {
  try {
    const parsed = new URL(url, 'https://svoefoto.ru');
    const extension = parsed.pathname.split('.').pop()?.toLowerCase();
    if (extension && /^[a-z0-9]{2,5}$/.test(extension)) {
      return extension === 'jpeg' ? 'jpg' : extension;
    }
  } catch {
    return 'jpg';
  }
  return 'jpg';
}

function archivePhotoName(orderId: string, item: PrintPhotoArchiveItem, index: number): string {
  const orderSegment = sanitizeArchiveSegment(orderId, 'order');
  const label = sanitizeArchiveSegment(
    [item.format, item.paperType, item.name].filter(Boolean).join('_'),
    'photo',
  );
  const number = String(index + 1).padStart(3, '0');
  return `${orderSegment}/${number}_${label}.${archivePhotoExtension(item.uploadedUrl)}`;
}

async function appendPrintPhotoToArchive(
  archive: archiver.Archiver,
  uploadedUrl: string,
  archiveName: string,
): Promise<boolean> {
  const media = extractMediaProxyKey(uploadedUrl);
  if (media) {
    const stream = await storageService.getReadStream(media.key);
    await appendReadableToArchive(archive, stream, archiveName);
    return true;
  }

  if (uploadedUrl.startsWith('/uploads/')) {
    const relativePath = uploadedUrl.slice('/uploads/'.length);
    const localPath = safePath(path.resolve(process.cwd(), 'uploads'), relativePath);
    if (localPath && fs.existsSync(localPath)) {
      archive.file(localPath, { name: archiveName });
      return true;
    }
  }

  return false;
}

async function signStaffPhotoUrl(row: SignableOrderRow): Promise<SignableOrderRow> {
  const photoUrl = typeof row['photo_url'] === 'string' && row['photo_url'].trim()
    ? await resolveStaffFileUrl(row['photo_url'])
    : row['photo_url'];

  return {
    ...row,
    items: await signItemUrls(row.items),
    photo_url: photoUrl,
  };
}

/** Определяет приоритет заказа по содержимому items */
function getPriorityFromItems(items: unknown[]): 'normal' | 'urgent' | 'vip' {
  const text = JSON.stringify(items || []).toLowerCase();
  if (text.includes('vip') || text.includes('вип')) return 'vip';
  if (text.includes('срочн') || text.includes('urgent')) return 'urgent';
  return 'normal';
}

/** Безопасно резолвит путь — защита от Path Traversal */
function safePath(basedir: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\//, '');
  const resolved = path.resolve(basedir, cleaned);
  if (!resolved.startsWith(basedir + path.sep) && resolved !== basedir) {
    log.warn(`[Security] Path traversal blocked: ${relativePath}`);
    return null;
  }
  return resolved;
}

const router = express.Router();

interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_name: string | null;
  message_type: string | null;
  content: string;
  created_at: string | Date | null;
}

function getMoscowDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatReadyEstimate(estimatedReadyAt: Date, now = new Date()): string {
  if (Number.isNaN(estimatedReadyAt.getTime())) return 'уточняем';

  const time = estimatedReadyAt.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });

  const readyKey = getMoscowDateKey(estimatedReadyAt);
  if (readyKey === getMoscowDateKey(now)) return `сегодня к ${time}`;

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (readyKey === getMoscowDateKey(tomorrow)) return `завтра к ${time}`;

  const sameYear = estimatedReadyAt.toLocaleDateString('ru-RU', {
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }) === now.toLocaleDateString('ru-RU', {
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });

  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  };
  if (!sameYear) dateOptions.year = 'numeric';

  const date = estimatedReadyAt.toLocaleDateString('ru-RU', dateOptions);

  return `${date} к ${time}`;
}

async function notifyChatOrderReadyEstimate(
  sessionId: string,
  orderId: string,
  estimatedReadyAt: Date,
  req: Request,
): Promise<void> {
  const readyText = formatReadyEstimate(estimatedReadyAt);
  const content = `✅ Заказ **${orderId}** создан.\n\n⏱ Ориентировочное время готовности: **${readyText}**.\nМы напишем, если срок изменится.`;

  const msg = await db.queryOne<ChatMessageRow>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3)
     RETURNING id, conversation_id, sender_type, sender_name, message_type, content, created_at`,
    [sessionId, content, JSON.stringify({ orderId, estimatedReadyAt: estimatedReadyAt.toISOString(), event: 'order_ready_estimate' })],
  );

  if (!msg) throw new Error('Failed to insert order ready estimate message');

  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId,
      id: msg.id,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      attachmentUrl: null,
      timestamp: msg.created_at,
    });
  }

  broadcastChatMessage({
    sessionId,
    message: { ...msg },
  }).catch(err => log.error('[CRM-Create] ready estimate CRM broadcast failed', { orderId, sessionId, error: String(err) }));

  sendVisitorChatPush(sessionId, {
    title: 'Срок готовности заказа',
    body: `Заказ ${orderId}: ${readyText}`,
    tag: `order-ready-estimate-${orderId}`,
    url: `/track/${orderId}`,
  }).catch(err => log.warn('[CRM-Create] ready estimate push failed', { orderId, sessionId, error: String(err) }));

  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );

  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    const { enqueueOutbound } = await import('../services/connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      sourceMessageId: msg.id,
      conversationId: sessionId,
    });
  }
}

async function notifyChatSuperRetouch(
  sessionId: string,
  orderId: string,
  req: Request,
): Promise<void> {
  // Plain text без markdown: эмодзи и переносы корректно рендерятся во всех каналах
  // (web, Telegram, MAX, WhatsApp). Звёздочки/тире сюда НЕ добавлять.
  const content =
    '💎 Спасибо, что выбрали Супер обработку! Это наш премиум-уровень ретуши.\n\n' +
    'Вот что входит в вашу обработку:\n\n' +
    '✨ 10 вариантов ретуши на выбор, вы берёте тот, что нравится больше\n' +
    '🎨 Несколько вариантов макияжа, одежды и фона\n' +
    '🌈 Художественная цветокоррекция и замена фона\n' +
    '✅ Правки до полного одобрения, без доплат\n\n' +
    'Над фото работает наш ретушёр вручную, это не шаблон и не автофильтр. ' +
    'Как только варианты будут готовы, мы пришлём их прямо сюда, в чат, и вы спокойно выберете лучший.\n\n' +
    'Будут пожелания по образу, просто напишите. Мы рядом 🤍\n\n' +
    'Своё Фото';

  const msg = await db.queryOne<ChatMessageRow>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3)
     RETURNING id, conversation_id, sender_type, sender_name, message_type, content, created_at`,
    [sessionId, content, JSON.stringify({ orderId, event: 'super_retouch_intro' })],
  );

  if (!msg) throw new Error('Failed to insert super retouch intro message');

  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId,
      id: msg.id,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      attachmentUrl: null,
      timestamp: msg.created_at,
    });
  }

  broadcastChatMessage({
    sessionId,
    message: { ...msg },
  }).catch(err => log.error('[CRM-Create] super retouch intro CRM broadcast failed', { orderId, sessionId, error: String(err) }));

  sendVisitorChatPush(sessionId, {
    title: 'Супер обработка',
    body: 'Подготовим 10 вариантов ретуши на выбор',
    tag: `super-retouch-${orderId}`,
    url: `/track/${orderId}`,
  }).catch(err => log.warn('[CRM-Create] super retouch intro push failed', { orderId, sessionId, error: String(err) }));

  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );

  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    const { enqueueOutbound } = await import('../services/connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      sourceMessageId: msg.id,
      conversationId: sessionId,
    });
  }
}

/**
 * Pre-signed S3 upload for print orders
 * POST /api/orders/photo-print/direct-upload/presign
 * POST /api/orders/photo-print/direct-upload/complete
 */
const printPresignedRouter = createPresignedUploadRoutes({
  prefix: 'print',
  allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']),
  maxFileSize: 50 * 1024 * 1024,
  maxFiles: 50,
  // Public website orders are anonymous; abuse is bounded by limiter, MIME and size checks.
  auth: [],
  // Large print orders used to call presign/complete per file; keep those deployed clients from tripping the limiter.
  rateLimiter: createUploadLimiter('ul-print-ps:', 400, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], _req: Request, res: Response) => {
    // Return verified file URLs — order creation happens via separate POST /api/orders/photo-print
    const data = files.map(f => ({ url: f.s3Url, s3Key: f.s3Key, fileName: f.fileName }));
    res.json({ success: true, data: { files: data, count: files.length } });
  },
});
router.use('/direct-upload', printPresignedRouter);
router.use('/attachments', orderAttachmentsRouter);

// PhotoPrintItem, PhotoPrintOrderRequest, FORMAT_MAP → imported from photo-print-processing.service

/**
 * Серверный пересчёт курьерской доставки (Яндекс) для заказа печати.
 *
 * Деньги-критичный путь (P0-2/P1-4): клиенту НЕ доверяем ни цену, ни зону, ни координаты.
 * - Координаты резолвим серверно через DaData по `address` из тела (coordinates тела — игнорируем).
 * - Guard Ростов + qc<=1 (минимальное дублирование логики /quote из S3 — см. delivery.routes.ts).
 * - Зона/цена — из БД `delivery_zones` по серверной дистанции (checkPrice→resolveZone).
 * - Мин. заказ дальних зон проверяем по СЕРВЕРНОМУ субтоталу печати.
 *
 * ВАЖНО (отклонение, см. отчёт): публичный заказ печати не несёт serviceOptionId на позициях
 * (только format/paperType), поэтому `calculatePriceWaterfall` для него не вызывается нигде —
 * субтотал печати в этом потоке = `printSubtotalRub` (клиентский totalPrice до доставки).
 * Цена ДОСТАВКИ при этом полностью серверная. Параметр назван `printSubtotalRub`, а не
 * `result.total`, чтобы это ограничение было явным.
 *
 * @throws AppError(400/422) при недоступной фиче / адресе вне зоны / ниже мин. заказа.
 */
interface ResolvedCourierDelivery {
  address: string;
  zoneId: number;
  priceRub: number;
  realPriceRub: number;
  distanceM: number;
  sourceStudioId: string;
  dropoffLon: number;
  dropoffLat: number;
  weightGrams: number;
}

async function resolveCourierDelivery(
  delivery: NonNullable<CreatePhotoPrintOrderInput['delivery']>,
  items: CreatePhotoPrintOrderInput['items'],
  printSubtotalRub: number,
): Promise<ResolvedCourierDelivery> {
  if (!config.yandexDelivery.enabled) {
    throw new AppError(400, 'Курьерская доставка недоступна');
  }

  // Координаты — серверно через DaData (адрес из тела авторитетен, координаты тела — лишь хинт).
  const validated = await validateAddress(delivery.address);
  if (!validated || !validated.geoLon || !validated.geoLat) {
    throw new AppError(422, 'Не удалось определить координаты адреса доставки');
  }

  // Guard зоны обслуживания: только Ростов-на-Дону / Ростовская область, точный адрес (qc<=1).
  const cityOk = (validated.city || '').toLowerCase().includes('ростов');
  const regionOk = (validated.region || '').toLowerCase().includes('ростов');
  if (!cityOk && !regionOk) {
    throw new AppError(422, 'Курьерская доставка доступна только по Ростову-на-Дону и пригороду');
  }
  if (validated.qc >= 2) {
    throw new AppError(422, 'Уточните адрес доставки — он распознан неточно');
  }

  const dropoff = normalizeLonLat(validated.geoLon, validated.geoLat);
  const studio = await selectNearestStudio(dropoff[0], dropoff[1]);

  const weightGrams = calculateParcelWeight(
    items.map(i => ({ format: i.format, quantity: i.quantity })),
  );

  const quote = await checkPrice({
    source: [studio.lon, studio.lat],
    dest: dropoff,
    weightGrams,
  });

  const zone = await resolveZone(quote.distanceMeters);
  if (!zone) {
    throw new AppError(422, 'Адрес доставки вне зоны обслуживания');
  }

  // Жёсткая проверка мин. заказа дальних зон — по серверному субтоталу печати.
  if (zone.minOrderRub > 0 && printSubtotalRub < zone.minOrderRub) {
    throw new AppError(
      422,
      `Доставка в эту зону доступна при заказе печати от ${zone.minOrderRub} ₽`,
    );
  }

  return {
    address: validated.result || delivery.address,
    zoneId: zone.zoneId,
    priceRub: zone.priceRub,
    realPriceRub: quote.priceRub,
    distanceM: Math.round(quote.distanceMeters),
    sourceStudioId: studio.studioId,
    dropoffLon: dropoff[0],
    dropoffLat: dropoff[1],
    weightGrams,
  };
}

/**
 * Create a photo print order
 * POST /api/orders/photo-print
 * Supports two auth paths:
 *  1. Telegram auth (Telegram Mini App) — via requireTelegramAuth middleware
 *  2. Anonymous (website form) — contact.name + contact.phone in body
 */
router.post('/', validate(createPhotoPrintOrderSchema), async (req: Request, res: Response): Promise<void> => {
  const publicOrderStartedAt = Date.now();
  const body = req.body as CreatePhotoPrintOrderInput;

  // Try optional Telegram auth (won't throw if missing)
  let tgUser: { id?: number; username?: string; first_name?: string; last_name?: string } | undefined;
  const tgHeader = req.headers['x-telegram-user'];
  if (tgHeader) {
    try {
      tgUser = typeof tgHeader === 'string' ? JSON.parse(tgHeader) : undefined;
    } catch { /* ignore malformed header */ }
  }

  // Anonymous website orders: additional phone validation
  if (!tgUser) {
    const phoneDigits = (body.contact?.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      throw new AppError(400, 'Укажите корректный номер телефона');
    }
  }

  log.info(`[PrintOrder] New order from TG user: id=${tgUser?.id}, username=${tgUser?.username}, name=${tgUser?.first_name}`);

  const invalidItems = body.items.filter(item => !item.uploadedUrl);
  if (invalidItems.length > 0) {
    throw new AppError(400, 'Не все фотографии загружены');
  }

  const orderId = generateOrderId();
  const contactName = body.contact?.name || [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || 'Telegram User';
  const source = body.source || 'website';
  const requiresOnlinePayment = source === 'website' || source === 'miniapp';
  const initialStatus = requiresOnlinePayment ? 'pending_payment' : 'processing';
  const tgUserId = tgUser?.id ? String(tgUser.id) : undefined;
  const tgUsername = tgUser?.username || undefined;

  // Курьерская доставка исключает самовывоз. Для website без курьера самовывоз обязателен.
  const isCourier = body.delivery?.method === 'courier';

  // Серверный пересчёт доставки (деньги-критичный путь P0-2/P1-4) — до выбора студии самовывоза.
  // printSubtotalRub — субтотал печати (totalPrice до доставки); см. оговорку в resolveCourierDelivery.
  const courier = isCourier
    ? await resolveCourierDelivery(body.delivery!, body.items, body.totalPrice)
    : null;

  const pickupStudio = (source === 'website' && !isCourier)
    ? await resolvePickupStudio(body.pickupLocationId)
    : null;

  if (source === 'website' && !isCourier) {
    if (!body.pickupLocationId) {
      throw new AppError(400, 'Выберите точку самовывоза');
    }
    if (!pickupStudio) {
      throw new AppError(400, 'Выбранная точка самовывоза недоступна');
    }
    if ((pickupStudio.status || 'open') !== 'open') {
      throw new AppError(409, pickupStudio.status_message || 'Эта точка сейчас недоступна для самовывоза');
    }
  }

  // Итоговая цена: печать + серверная цена доставки (delivery_cost в чек до этого не попадал).
  const deliveryCost = courier ? courier.priceRub : 0;
  const finalTotalPrice = courier ? body.totalPrice + deliveryCost : body.totalPrice;

  const description = courier
    ? 'Печать фото, курьерская доставка'
    : pickupStudio
      ? `Печать фото, самовывоз: ${pickupStudio.name}`
      : 'Печать фото';
  const wishes = courier
    ? `Курьерская доставка: ${courier.address}`
    : pickupStudio
      ? `Самовывоз: ${pickupStudio.name}, ${pickupStudio.address}`
      : null;
  const deliveryMethod = courier ? 'courier' : (pickupStudio ? 'pickup' : null);
  const deliveryAddress = courier ? courier.address : (pickupStudio?.address ?? null);

  // Insert order into database
  await db.queryOne(
    `INSERT INTO photo_print_orders (
        order_id, mode, contact_name, contact_phone, contact_email,
        comments, total_price, items, status, payment_status,
        delivery_method, delivery_address, description, wishes,
        telegram_user_id, telegram_username, priority, source,
        delivery_cost, delivery_provider, delivery_zone
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21
      ) RETURNING *`,
    [
      orderId,
      body.mode,
      contactName.trim(),
      (body.contact?.phone || '').trim(),
      body.contact?.email?.trim() || null,
      body.contact?.comments?.trim() || null,
      finalTotalPrice,
      JSON.stringify(body.items),
      initialStatus,
      'none',
      deliveryMethod,
      deliveryAddress,
      description,
      wishes,
      tgUserId || null,
      tgUsername || null,
      getPriorityFromItems(body.items),
      source,
      deliveryCost,
      courier ? 'yandex' : null,
      courier ? courier.zoneId : null,
    ]
  );

  // Курьерская доставка: создаём строку delivery_shipments (status pending) ДО оплаты,
  // чтобы post-payment createYandexClaim нашёл её и идемпотентно обновил.
  // ON CONFLICT по uq_shipment_active_per_order (1 активная отправка на заказ) — идемпотентно.
  if (courier) {
    await db.query(
      `INSERT INTO delivery_shipments (
          order_id, provider, status, zone_id, price_rub, real_price_rub,
          distance_m, source_studio_id, dropoff_address, dropoff_lon, dropoff_lat, weight_grams
        ) VALUES (
          $1, 'yandex', 'pending', $2, $3, $4,
          $5, $6, $7, $8, $9, $10
        )
        ON CONFLICT (order_id) WHERE status NOT IN ('cancelled','failed','delivered')
        DO NOTHING`,
      [
        orderId,
        courier.zoneId,
        courier.priceRub,
        courier.realPriceRub,
        courier.distanceM,
        courier.sourceStudioId,
        courier.address,
        courier.dropoffLon,
        courier.dropoffLat,
        courier.weightGrams,
      ],
    );
  }

  // Auto-link chat session by phone
  await linkChatByPhone(body.contact?.phone, orderId);

  recordBusinessEvent({
    domain: 'orders',
    event: 'photo_print.public_created',
    outcome: 'success',
    severity: 'info',
    entityType: 'photo_print_order',
    entityId: orderId,
    orderId,
    durationMs: Date.now() - publicOrderStartedAt,
    metadata: {
      source,
      status: initialStatus,
      paymentRequired: requiresOnlinePayment,
      pickupLocationId: pickupStudio?.location_code || pickupStudio?.id || null,
      totalPrice: finalTotalPrice,
      deliveryMethod,
      deliveryCost,
      itemCount: body.items.length,
    },
  });

  // Emit order:created event to CRM operators
  try {
    const ss: SocketServer | undefined = req.app['socketServer'];
    if (ss) {
      logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:created', {
        orderId,
        totalPrice: finalTotalPrice,
        contactName: body.contact?.name || '',
        status: initialStatus,
        pickupAddress: deliveryAddress,
      });
    }
  } catch (_e) { /* socket not available */ }

  enqueueCrmEvent('order', orderId, 'order_created', {
    client_name: contactName || null,
    client_phone: (body.contact?.phone || '').trim() || null,
    preview: `Заказ ${orderId}`,
    status: initialStatus,
    priority: 2,
    sort_time: new Date().toISOString(),
    channel: null,
    assigned_to: null,
    assigned_to_name: null,
    unread: false,
    metadata: {
      paymentRequired: requiresOnlinePayment,
      pickupLocationId: pickupStudio?.location_code || pickupStudio?.id || null,
      pickupAddress: pickupStudio?.address ?? null,
    },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  // Respond immediately
  res.status(201).json({
    success: true,
    data: {
      orderId,
      totalPrice: finalTotalPrice,
      deliveryCost,
      paymentUrl: requiresOnlinePayment ? `/pay/${orderId}` : null,
      message: initialStatus === 'pending_payment' ? 'Заказ создан, ожидается оплата' : 'Заказ создан, фото обрабатываются',
    }
  });

  // Background processing only for non-payment orders (payment orders start after webhook)
  if (initialStatus !== 'pending_payment') {
    processAndNotify(orderId, body, tgUserId, tgUsername).catch(err => {
    log.error(`[PrintOrder ${orderId}] Background processing failed:`, { error: String(err) });
    });
  }
});

// processAndNotify → imported from photo-print-processing.service (supports S3 + local files)

/**
 * Detect print format from user's text messages
 */
function detectFormat(messages: string[]): string | null {
  const text = messages.join(' ').toLowerCase();
  const patterns: [RegExp, string][] = [
    [/10\s*[xх×]\s*15/, '10x15'],
    [/15\s*[xх×]\s*20/, '15x20'],
    [/20\s*[xх×]\s*30/, '20x30'],
    [/30\s*[xх×]\s*40/, '30x40'],
    [/40\s*[xх×]\s*50/, '40x50'],
    [/холст/, '30x40_canvas'],
  ];
  let fmt: string | null = null;
  for (const [re, id] of patterns) {
    if (re.test(text)) { fmt = id; break; }
  }
  if (fmt && /сатин|суперглян|супер|super/.test(text)) {
    const s = fmt + '_super';
    if (['10x15_super', '15x20_super', '20x30_super'].includes(s)) fmt = s;
  }
  return fmt;
}

interface TelegramGetFileResponse {
  ok?: boolean;
  result?: { file_path?: string };
}

/**
 * Download a single file from Telegram and upload to S3 (or local fallback).
 */
async function downloadTelegramFile(fileId: string, botToken: string): Promise<{ fileId: string; url: string } | null> {
  try {
    const fileRes = await fetchWithTimeout(`${config.telegram.apiUrl}/bot${botToken}/getFile?file_id=${fileId}`, {
      timeout: 10_000,
    });
    const fileData: TelegramGetFileResponse = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) return null;

    const filePath = fileData.result.file_path;
    const ext = path.extname(filePath) || '.jpg';
    const s3Key = `print/${uuidv4()}${ext}`;

    const downloadRes = await fetchWithTimeout(`${config.telegram.apiUrl}/file/bot${botToken}/${filePath}`, {
      timeout: 30_000,
    });
    if (!downloadRes.ok) return null;

    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const uploaded = await storageService.upload(buffer, s3Key, mime);

    return { fileId, url: uploaded.url };
  } catch {
    return null;
  }
}

/**
 * Batch import photos from Telegram bot to S3 storage
 * POST /api/orders/photo-print/import-bot-photos
 */
router.post('/import-bot-photos', requireTelegramAuth, validate(importBotPhotosSchema), async (req: Request, res: Response): Promise<void> => {
  const { fileIds } = req.body as ImportBotPhotosInput;

  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';

  const results = await Promise.all(
    fileIds.map((fid: string) => downloadTelegramFile(fid, botToken))
  );

  const imported = results.filter(isImportedBotPhoto);

  res.json({ success: true, data: imported });
});

/**
 * Import a single photo from Telegram bot to S3 storage (legacy, kept for compatibility)
 * POST /api/orders/photo-print/import-bot-photo
 */
router.post('/import-bot-photo', requireTelegramAuth, validate(importBotPhotoSchema), async (req: Request, res: Response): Promise<void> => {
  const { fileId } = req.body as ImportBotPhotoInput;

  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
  const result = await downloadTelegramFile(fileId, botToken);

  if (!result) {
    throw new AppError(500, 'Ошибка импорта файла');
  }

  res.json({ success: true, data: { url: result.url } });
});

// ============================================================================
// GET /staff-list — Orders list for staff (with filters, search, pagination)
// ============================================================================
function isStaff(role: string): boolean {
  return ['admin', 'employee', 'photographer'].includes(role);
}

router.get('/staff-list', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const {
    scope,
    status,
    payment_status,
    priority,
    search,
    chat_session_id,
    date_from,
    date_to,
    sales_scope,
    page = '1',
    limit = '25',
    sort = 'created_at',
    order = 'desc',
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));
  const offset = (pageNum - 1) * limitNum;

  if (scope && scope !== 'active' && scope !== 'archive') {
    throw new AppError(400, 'Invalid order scope');
  }
  if (sales_scope && sales_scope !== 'mine') {
    throw new AppError(400, 'Invalid sales scope');
  }

  const allowedSorts = ['created_at', 'updated_at', 'completed_at', 'total_price', 'status', 'priority', 'order_id'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`p.status = $${paramIdx++}`);
    params.push(status);
  } else if (scope === 'archive') {
    conditions.push(`p.status IN ('completed', 'cancelled')`);
  } else if (scope === 'active') {
    conditions.push(`p.status NOT IN ('completed', 'cancelled')`);
  }
  if (payment_status) {
    conditions.push(`p.payment_status = $${paramIdx++}`);
    params.push(payment_status);
  }
  if (priority) {
    conditions.push(`p.priority = $${paramIdx++}`);
    params.push(priority);
  }
  if (search) {
    conditions.push(`(p.order_id ILIKE $${paramIdx} OR p.contact_name ILIKE $${paramIdx} OR p.contact_phone ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (chat_session_id) {
    conditions.push(`p.chat_session_id = $${paramIdx++}`);
    params.push(chat_session_id);
  }
  if (date_from) {
    conditions.push(`p.created_at >= $${paramIdx++}`);
    params.push(date_from);
  }
  if (date_to) {
    conditions.push(`p.created_at <= $${paramIdx++}::date + interval '1 day'`);
    params.push(date_to);
  }
  if (sales_scope === 'mine') {
    const employeeParam = paramIdx++;
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM payment_events pos_paid
      WHERE pos_paid.order_id = p.order_id
        AND pos_paid.event_type = 'pos_auto_mark_paid'
    )`);
    conditions.push(`COALESCE(p.receipt_url, '') NOT LIKE '/pos/receipts/%'`);
    conditions.push(`(
      p.initiated_by = $${employeeParam}
      OR p.assigned_employee_id = $${employeeParam}
      OR EXISTS (
        SELECT 1
        FROM employee_shifts own_shift
        WHERE own_shift.id = p.employee_shift_id
          AND own_shift.employee_id = $${employeeParam}
      )
      OR EXISTS (
        SELECT 1
        FROM payment_events own_payment
        WHERE own_payment.order_id = p.order_id
          AND own_payment.event_type IN ('payment_confirmed', 'mark_paid_external')
          AND COALESCE(
            own_payment.metadata->>'recorded_by',
            own_payment.metadata->>'marked_by'
          ) = $${employeeParam}
      )
    )`);
    params.push(req.user.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.queryOne<CountRow>(
    `SELECT COUNT(*) as count FROM photo_print_orders p ${whereClause}`,
    params
  );
  const total = parseInt(countResult?.count || '0');

  const orders = await db.query<SignableOrderRow>(
    `SELECT p.order_id, p.contact_name, p.contact_phone, p.contact_email,
            p.total_price, p.status, p.payment_status, p.priority,
            p.items, p.comments, p.delivery_address, p.delivery_cost,
            p.delivery_method, p.delivery_provider,
            p.tracking_number, p.receipt_url, p.payment_card_info,
            p.promo_code, p.promo_discount, p.telegram_username,
            p.created_at, p.updated_at, p.paid_at, p.completed_at, p.id,
            p.assigned_employee_id, p.assigned_at, p.chat_session_id,
            p.reminder_sent_at, p.processing_started_at, p.processing_duration_minutes,
            p.description, p.source, p.wishes, p.medals_required, p.medals_description,
            p.uniform_description, p.document_template_id, p.photo_size,
            COALESCE(
              payment_meta.payment_method,
              CASE
                WHEN p.payment_mode IN ('cash', 'card', 'sbp', 'transfer', 'online', 'subscription')
                  THEN p.payment_mode
                ELSE NULL
              END
            ) AS payment_method,
            payment_meta.payment_channel,
            payment_meta.event_type AS payment_event_type,
            payment_meta.recorded_at AS payment_recorded_at,
            payment_meta.recorded_by AS payment_recorded_by,
            payment_user.display_name AS payment_recorded_by_name,
            dt.name as document_template_name,
            COALESCE(active_assignment.studio_id, delivery_studio.id) AS order_studio_id,
            COALESCE(assignment_studio.name, delivery_studio.name) AS order_studio_name,
            COALESCE(assignment_studio.address, delivery_studio.address) AS order_studio_address,
            COALESCE(assignment_studio.location_code, delivery_studio.location_code) AS order_location_code,
            u.display_name as assigned_employee_name,
            COALESCE(p.contact_phone, vcs.visitor_phone) as resolved_phone,
            vcs.user_id as resolved_user_id,
            COALESCE((t.metadata->>'escalation_level')::int, 0) as escalation_level,
            COALESCE(t.sla_deadline, p.estimated_ready_at, p.created_at + interval '30 minutes') as deadline,
            (SELECT attachment_url FROM messages
             WHERE conversation_id = p.chat_session_id AND message_type = 'image'
             ORDER BY created_at DESC LIMIT 1) as photo_url
     FROM photo_print_orders p
     LEFT JOIN users u ON u.id = p.assigned_employee_id
     LEFT JOIN work_tasks t ON t.print_order_id = p.id
       AND t.status NOT IN ('completed', 'cancelled')
     LEFT JOIN conversations vcs ON vcs.id = p.chat_session_id
     LEFT JOIN document_templates dt ON dt.id = p.document_template_id
     LEFT JOIN LATERAL (
       SELECT pe.event_type,
              pe.created_at AS recorded_at,
              COALESCE(pe.metadata->>'payment_method', pe.metadata->>'method') AS payment_method,
              pe.metadata->>'channel' AS payment_channel,
              COALESCE(pe.metadata->>'recorded_by', pe.metadata->>'marked_by') AS recorded_by
       FROM payment_events pe
       WHERE pe.order_id = p.order_id
         AND pe.event_type IN ('payment_confirmed', 'mark_paid_external', 'pos_auto_mark_paid')
       ORDER BY pe.created_at DESC NULLS LAST
       LIMIT 1
     ) payment_meta ON true
     LEFT JOIN users payment_user ON payment_user.id::text = payment_meta.recorded_by
     LEFT JOIN LATERAL (
       SELECT oa.studio_id
       FROM order_assignments oa
       WHERE oa.order_id = p.order_id
         AND oa.status NOT IN ('completed', 'cancelled')
       ORDER BY oa.assigned_at DESC NULLS LAST, oa.created_at DESC NULLS LAST
       LIMIT 1
     ) active_assignment ON true
     LEFT JOIN studios assignment_studio ON assignment_studio.id = active_assignment.studio_id
     LEFT JOIN LATERAL (
       SELECT s.id, s.name, s.address, s.location_code
       FROM studios s
       WHERE active_assignment.studio_id IS NULL
         AND p.delivery_address IS NOT NULL
         AND (
           p.delivery_address ILIKE '%' || s.address || '%'
           OR s.address ILIKE '%' || p.delivery_address || '%'
           OR p.delivery_address ILIKE '%' || s.name || '%'
         )
       ORDER BY length(COALESCE(s.address, '')) DESC
       LIMIT 1
     ) delivery_studio ON true
     ${whereClause}
     ORDER BY p.${sortCol} ${sortDir}
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limitNum, offset]
  );

  const signedOrders = await Promise.all(orders.map(signStaffPhotoUrl));

  res.json({
    success: true,
    data: signedOrders,
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// ============================================================================
// GET /staff-list/queue — Priority-sorted order queue for operators
// ============================================================================
router.get('/staff-list/queue', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  // bucket=active (по умолчанию) — рабочая очередь; bucket=stale — «зависшие»
  // (неоплаченные заказы старше порога, которые забивали очередь красной стеной).
  const bucket = req.query['bucket'] === 'stale' ? 'stale' : 'active';
  // Зависший = не оплачен И создан раньше порога. Оплаченные не прячем никогда:
  // «оплачен, но не выдан» — это как раз то, что оператор обязан видеть.
  const STALE_PREDICATE = `p.payment_status <> 'paid' AND p.created_at < NOW() - INTERVAL '${STALE_ORDER_DAYS} days'`;
  const bucketFilter = bucket === 'stale'
    ? `AND (${STALE_PREDICATE})`
    : `AND NOT (${STALE_PREDICATE})`;
  // В активной очереди — ближайший дедлайн первым; в «зависших» — самые старые сверху.
  const bucketOrder = bucket === 'stale'
    ? `p.created_at ASC`
    : `CASE p.priority
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'normal' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       COALESCE(t.sla_deadline, t.due_date) ASC NULLS LAST,
       p.created_at DESC`;
  // Активных после скрытия зависших немного — поднимаем лимит, чтобы оператор видел
  // все свежие заказы (раньше LIMIT 20 прятал хвост). Зависшие — крупнее, с запасом.
  const bucketLimit = bucket === 'stale' ? 100 : 40;

  const orders = await db.query<SignableOrderRow>(
    `SELECT p.id, p.order_id, p.contact_name, p.contact_phone, p.contact_email,
            p.total_price, p.status, p.payment_status, p.priority,
            p.items, p.comments, p.delivery_address, p.delivery_cost,
            p.tracking_number, p.promo_code, p.promo_discount,
            p.created_at, p.updated_at, p.paid_at, p.completed_at,
            p.processing_started_at, p.processing_duration_minutes,
            p.assigned_employee_id, p.assigned_at, p.chat_session_id,
            p.wishes, p.medals_required, p.medals_description,
            p.uniform_description, p.document_template_id, p.photo_size,
            dt.name as document_template_name,
            COALESCE(active_assignment.studio_id, delivery_studio.id) AS order_studio_id,
            COALESCE(assignment_studio.name, delivery_studio.name) AS order_studio_name,
            COALESCE(assignment_studio.address, delivery_studio.address) AS order_studio_address,
            COALESCE(assignment_studio.location_code, delivery_studio.location_code) AS order_location_code,
            u.display_name as assigned_employee_name,
            COALESCE(t.sla_deadline, t.due_date) as sla_deadline,
            CASE WHEN COALESCE(t.sla_deadline, t.due_date) IS NOT NULL THEN
              EXTRACT(EPOCH FROM (COALESCE(t.sla_deadline, t.due_date) - NOW())) * 1000
            ELSE NULL END as time_remaining_ms,
            CASE WHEN COALESCE(t.sla_deadline, t.due_date) IS NOT NULL AND COALESCE(t.sla_deadline, t.due_date) < NOW() THEN true
            ELSE false END as is_overdue,
            COALESCE((t.metadata->>'escalation_level')::int, 0) as escalation_level,
            COALESCE(p.contact_phone, vcs.visitor_phone) as resolved_phone,
            vcs.user_id as resolved_user_id,
            COALESCE(t.sla_deadline, p.estimated_ready_at, p.created_at + interval '30 minutes') as deadline,
            -- Поля согласования валидны ТОЛЬКО для задач ретуши. У заказов с задачей
            -- доставки (delivery) согласовывать нечего, поэтому отдаём NULL — иначе фронт
            -- ошибочно показывает кнопку «На согласование»/бейдж «У клиента» и открывает
            -- диалог ретуши с чужим id (см. инцидент «кривое отправление»).
            CASE WHEN t.task_type = 'retouch' THEN t.id END as retouch_task_id,
            CASE WHEN t.task_type = 'retouch' THEN t.status END as retouch_status,
            CASE WHEN t.task_type = 'retouch' THEN t.retouch_level END as retouch_level,
            CASE WHEN t.task_type = 'retouch' THEN t.retouch_options END as retouch_options,
            CASE WHEN t.task_type = 'retouch' THEN t.source_photo_url END as retouch_source_url,
            CASE WHEN t.task_type = 'retouch' THEN t.result_photo_url END as retouch_result_url,
            CASE WHEN t.task_type = 'retouch' THEN COALESCE(t.revision_count, 0) ELSE 0 END as revision_count,
            CASE WHEN t.task_type = 'retouch' THEN t.approval_session_id END as approval_session_id,
            (t.task_type = 'retouch' AND COALESCE(t.revision_count, 0) > 0 AND t.status = 'in_progress') as revision_requested,
            CASE WHEN t.task_type = 'retouch' THEN pas.public_token END as approval_token,
            CASE WHEN t.task_type = 'retouch' THEN pas.status END as approval_status,
            (SELECT attachment_url FROM messages
             WHERE conversation_id = p.chat_session_id AND message_type = 'image'
             ORDER BY created_at DESC LIMIT 1) as photo_url
     FROM photo_print_orders p
     LEFT JOIN users u ON u.id = p.assigned_employee_id
     LEFT JOIN LATERAL (
       SELECT wt.* FROM work_tasks wt
       WHERE wt.print_order_id = p.id
         AND wt.status NOT IN ('completed', 'cancelled')
       ORDER BY (wt.task_type = 'retouch') DESC, wt.created_at DESC
       LIMIT 1
     ) t ON true
     LEFT JOIN photo_approval_sessions pas ON pas.id = t.approval_session_id
     LEFT JOIN conversations vcs ON vcs.id = p.chat_session_id
     LEFT JOIN document_templates dt ON dt.id = p.document_template_id
     LEFT JOIN LATERAL (
       SELECT oa.studio_id
       FROM order_assignments oa
       WHERE oa.order_id = p.order_id
         AND oa.status NOT IN ('completed', 'cancelled')
       ORDER BY oa.assigned_at DESC NULLS LAST, oa.created_at DESC NULLS LAST
       LIMIT 1
     ) active_assignment ON true
     LEFT JOIN studios assignment_studio ON assignment_studio.id = active_assignment.studio_id
     LEFT JOIN LATERAL (
       SELECT s.id, s.name, s.address, s.location_code
       FROM studios s
       WHERE active_assignment.studio_id IS NULL
         AND p.delivery_address IS NOT NULL
         AND (
           p.delivery_address ILIKE '%' || s.address || '%'
           OR s.address ILIKE '%' || p.delivery_address || '%'
           OR p.delivery_address ILIKE '%' || s.name || '%'
         )
       ORDER BY length(COALESCE(s.address, '')) DESC
       LIMIT 1
     ) delivery_studio ON true
     WHERE p.status IN ('new', 'pending_payment', 'paid', 'processing', 'ready')
       AND p.payment_status IN ('pending', 'paid', 'none')
       ${bucketFilter}
     ORDER BY ${bucketOrder}
     LIMIT ${bucketLimit}`
  );

  // Сколько зависших всего — для счётчика на вкладке «Зависшие» (дёшево, без join'ов).
  const staleCountRow = await db.queryOne<CountRow>(
    `SELECT COUNT(*) AS count
       FROM photo_print_orders p
      WHERE p.status IN ('new', 'pending_payment', 'paid', 'processing', 'ready')
        AND p.payment_status IN ('pending', 'paid', 'none')
        AND (${STALE_PREDICATE})`
  );
  const staleTotal = Number(staleCountRow?.count ?? 0);

  const signedOrders = await Promise.all(orders.map(signStaffPhotoUrl));

  res.json({
    success: true,
    data: signedOrders,
    total: bucket === 'stale' ? staleTotal : signedOrders.length,
    staleTotal,
    page: 1,
    limit: bucketLimit,
  });
});

// ============================================================================
// GET /api/orders/photo-print/queue-stats — статистика очереди (публичная)
// ВАЖНО: этот маршрут должен быть до /:orderId
// ============================================================================
router.get('/queue-stats', async (_req: Request, res: Response): Promise<void> => {
  const stats = await getQueueStats();
  res.json({ success: true, ...stats });
});

// ============================================================================
// GET /api/orders/photo-print/track/:orderId — публичный трекинг заказа
// ВАЖНО: этот маршрут должен быть до /:orderId
// ============================================================================
router.get('/track/:orderId', async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  const order = await db.queryOne<TrackingOrderRow>(
    `SELECT order_id, status, payment_status, contact_name, created_at, updated_at,
            total_price, COALESCE(priority, 'normal') as priority,
            queue_position, estimated_ready_at, processing_started_at,
            delivery_method, items
     FROM photo_print_orders
     WHERE order_id = $1`,
    [orderId]
  );

  if (!order) {
    res.status(404).json({ success: false, error: 'Заказ не найден' });
    return;
  }

  const [queueInfo, statusHistory, queueStats] = await Promise.all([
    getQueuePosition(orderId),
    getStatusHistory(orderId),
    getQueueStats(),
  ]);

  const statusSteps = [
    { id: 'paid', label: 'Оплачен', done: ['paid', 'processing', 'ready', 'completed'].includes(order.status) },
    { id: 'processing', label: 'Принят в работу', done: ['processing', 'ready', 'completed'].includes(order.status) },
    { id: 'ready', label: 'Готов', done: ['ready', 'completed'].includes(order.status) },
    { id: 'completed', label: 'Выполнен', done: order.status === 'completed' },
  ];

  res.json({
    success: true,
    order: {
      order_id: order.order_id,
      status: order.status,
      payment_status: order.payment_status,
      contact_name: order.contact_name,
      total_price: parseFloat(order.total_price),
      priority: order.priority,
      queue_position: order.queue_position,
      estimated_ready_at: order.estimated_ready_at,
      created_at: order.created_at,
      updated_at: order.updated_at,
      delivery_method: order.delivery_method,
      items: order.items,
    },
    queue: queueInfo,
    status_steps: statusSteps,
    status_history: statusHistory,
    queue_stats: {
      completed_today: queueStats.completedToday,
    },
  });
});

// ============================================================================
// POST /api/orders/photo-print/:orderId/workflow-action — старт выполнения
// ============================================================================
router.post(
  '/:orderId/workflow-action',
  authenticateToken,
  requirePermission('pos:use'),
  validate(workflowActionSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user || !isStaff(req.user.role)) {
      throw new AppError(403, 'Staff access required');
    }

    const staffUser = req.user;
    const { orderId } = req.params;
    const { action } = req.body as WorkflowActionInput;

    const updated = await db.transaction(async (client: PoolClient) => {
      const updatedOrder = (await client.query<PhotoPrintOrder>(
        `UPDATE photo_print_orders
         SET processing_started_at = COALESCE(processing_started_at, NOW()),
             processed_by = $2,
             processed_at = NOW(),
             assigned_employee_id = COALESCE(assigned_employee_id, $2),
             assigned_at = COALESCE(assigned_at, NOW()),
             updated_at = NOW()
         WHERE order_id = $1
           AND status = 'processing'
         RETURNING *`,
        [orderId, staffUser.id],
      )).rows[0];

      if (!updatedOrder) {
        const existing = (await client.query<OrderStatusLookupRow>(
          `SELECT id, status
           FROM photo_print_orders
           WHERE order_id = $1`,
          [orderId],
        )).rows[0];
        if (!existing) {
          throw new AppError(404, 'Order not found');
        }
        throw new AppError(409, 'Сначала примите заказ в работу', 'ORDER_NOT_ACCEPTED');
      }

      await client.query(
        `UPDATE work_tasks
         SET status = 'in_progress', updated_at = NOW()
         WHERE print_order_id = $1
           AND status NOT IN ('completed', 'cancelled')`,
        [updatedOrder.id],
      );

      await client.query(
        `UPDATE order_assignments
         SET status = 'in_progress',
             assigned_to = COALESCE(assigned_to, $3),
             assigned_at = COALESCE(assigned_at, NOW()),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'executionAction', $2::text,
                    'executionStartedAt', COALESCE(metadata->>'executionStartedAt', $4::text),
                    'executionStartedBy', $3::text
                  ),
             updated_at = NOW()
         WHERE order_id = $1
           AND status NOT IN ('completed', 'cancelled')`,
        [orderId, action, staffUser.id, updatedOrder.processing_started_at],
      );

      return updatedOrder;
    });

    try {
      const socketServer = req.app.socketServer;
      if (socketServer) {
        socketServer.getIO().to('employee:dashboard').emit('order:workflow-action', {
          orderId,
          action,
          processing_started_at: updated.processing_started_at,
        });
        socketServer.getIO().to(`order:${orderId}`).emit('order:workflow-action', {
          orderId,
          action,
          processing_started_at: updated.processing_started_at,
        });
      }
    } catch (err) {
      log.error('[Order] Workflow WebSocket emit error', { error: (err as Error).message });
    }

    res.json({ success: true, data: updated });
  },
);

// ============================================================================
// GET /api/orders/photo-print/:orderId/download-photos — ZIP with uploaded files
// ============================================================================
router.get('/:orderId/download-photos', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId } = req.params;
  const order = await db.queryOne<PrintPhotoArchiveOrderRow>(
    `SELECT order_id, contact_name, items
     FROM photo_print_orders
     WHERE order_id = $1`,
    [orderId],
  );

  if (!order) {
    throw new AppError(404, 'Заказ не найден');
  }

  const items = printPhotoArchiveItems(order.items);
  if (!items.length) {
    throw new AppError(404, 'В заказе нет загруженных файлов');
  }

  const archive = archiver('zip', { zlib: { level: 6 } });
  let appended = 0;

  archive.on('warning', (error: Error) => {
    log.warn('print photo archive warning', {
      orderId: order.order_id,
      error: error.message,
    });
  });

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const archiveName = archivePhotoName(order.order_id, item, index);
    try {
      if (await appendPrintPhotoToArchive(archive, item.uploadedUrl, archiveName)) {
        appended++;
      }
    } catch (error: unknown) {
      log.warn('failed to append print photo to archive', {
        orderId: order.order_id,
        archiveName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (appended === 0) {
    archive.abort();
    throw new AppError(404, 'Не удалось добавить файлы в архив');
  }

  const zipName = `${sanitizeArchiveSegment(order.order_id, 'photo-order')}-photos.zip`;
  const encodedZipName = encodeURIComponent(zipName);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodedZipName}"; filename*=UTF-8''${encodedZipName}`);

  const archiveError = new Promise<never>((_, reject) => {
    archive.on('error', reject);
  });

  archive.pipe(res);
  await Promise.race([archive.finalize(), archiveError]);
});

// ============================================================================
// POST /api/orders/photo-print/crm-create — создание заказа из CRM
// ============================================================================
router.post('/crm-create', authenticateToken, requirePermission('pos:use'), idempotent(60), validate(crmCreateOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const crmOrderStartedAt = Date.now();
  const body = req.body as CrmCreateOrderInput;
  const activeEmployeeShift = await findActiveEmployeeShiftForOrder(req.user.id);
  const resolvedStudioId = body.studio_id || activeEmployeeShift?.studio_id || null;

  // 1. Generate CRM-YYMMDD-XXXX order ID
  const date = new Date();
  const yr = date.getFullYear().toString().slice(-2);
  const mo = (date.getMonth() + 1).toString().padStart(2, '0');
  const dy = date.getDate().toString().padStart(2, '0');
  const rnd = secureRandomString(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const orderId = `CRM-${yr}${mo}${dy}-${rnd}`;

  // 2. Resolve contact data
  let clientName = body.client_name?.trim() || null;
  let clientPhone = body.client_phone?.trim() || null;
  let clientEmail = body.client_email?.trim() || null;

  if (body.contact_id) {
    const contact = await db.queryOne<ContactLookupRow>(
      `SELECT display_name, phone, email FROM contacts WHERE id = $1 AND deleted_at IS NULL`,
      [body.contact_id],
    );
    if (contact) {
      clientName = clientName || contact.display_name;
      clientPhone = clientPhone || contact.phone;
      clientEmail = clientEmail || contact.email;
    }
  }

  // Feature-Level Pricing: recalc unit_price по активным features за вычетом disabled.
  // Допуск 1₽ на rounding между клиентом и сервером — иначе 400.
  // hasFeatures=false → legacy опция, оставляем клиентскую цену (custom-items уже без service_option_id).
  for (const item of body.items) {
    if (!item.service_option_id) continue;
    const disabled = item.disabled_features ?? [];
    const { unitPrice, unknownFeatures, allDisabled, hasFeatures } = await calculateFeatureLevelUnitPrice({
      serviceOptionId: item.service_option_id,
      disabledFeatures: disabled,
    });
    if (!hasFeatures) {
      if (disabled.length > 0) {
        pricingFeatureValidationRejectTotal.inc({ reason: 'legacy_not_supported' });
        throw new AppError(400, `Опция "${item.name}" не поддерживает feature-level pricing, disabled_features недопустим`);
      }
      continue;
    }
    if (unknownFeatures.length > 0) {
      pricingFeatureValidationRejectTotal.inc({ reason: 'unknown_features' });
      throw new AppError(400, `Неизвестные features для позиции "${item.name}": ${unknownFeatures.join(', ')}`);
    }
    if (allDisabled) {
      pricingFeatureValidationRejectTotal.inc({ reason: 'all_disabled' });
      throw new AppError(400, `Нельзя отключить все features для позиции "${item.name}" — используйте опцию "без обработки"`);
    }
    if (Math.abs(unitPrice - item.price) > 1) {
      pricingFeatureValidationRejectTotal.inc({ reason: 'price_mismatch' });
      throw new AppError(400, `Цена позиции "${item.name}" расходится с сервером: клиент=${item.price}, сервер=${unitPrice}`);
    }
    item.price = unitPrice;
  }

  // 3. Compute total server-side
  const computedTotal = body.items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);

  // 4. findOrCreateCustomer (outside transaction — uses shared pool)
  let customerId: string | null = null;
  if (clientPhone) {
    try {
      const customer = await findOrCreateCustomer({
        phone: clientPhone,
        name: clientName || undefined,
        email: clientEmail || undefined,
      });
      customerId = customer?.id || null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('[CRM-Create] findOrCreateCustomer failed', { error: msg });
    }
  }

  // 5. Transaction: order + items + assignment
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    // 5a. INSERT photo_print_orders (with wizard fields)
    const orderResult = await pgClient.query<CreatedOrderRow>(
      `INSERT INTO photo_print_orders (
        order_id, mode, contact_name, contact_phone, contact_email,
        comments, total_price, items, status, payment_status,
        priority, assigned_employee_id, assigned_at,
        initiated_by, employee_shift_id,
        delivery_method, customer_id, chat_session_id,
        description, deadline_at, source,
        document_template_id, photo_size, medals_required, medals_description, uniform_description, wishes,
        promo_code
      ) VALUES (
        $1, 'crm', $2, $3, $4,
        $5, $6, $7, 'new', 'pending',
        $8, $9, ${body.assigned_employee_id ? 'NOW()' : 'NULL'},
        $10, $11,
        'pickup', $12, $13,
        $14, $15, $16,
        $17, $18, $19, $20, $21, $22,
        $23
      ) RETURNING id, order_id`,
      [
        orderId,
        clientName,
        clientPhone,
        clientEmail,
        body.comment?.trim() || null,
        computedTotal,
        JSON.stringify(body.items),
        body.priority,
        body.assigned_employee_id || null,
        req.user.id,
        activeEmployeeShift?.id || null,
        customerId,
        body.chat_session_id || null,
        body.description?.trim() || null,
        body.deadline_at || null,
        body.source,
        body.document_template_id || null,
        body.photo_size || null,
        body.medals_required ?? false,
        body.medals_description?.trim() || null,
        body.uniform_description?.trim() || null,
        body.wishes?.trim() || null,
        body.promo_code?.trim().toUpperCase() || null,
      ],
    );

    const newOrder = orderResult.rows[0];
    if (!newOrder) {
      await pgClient.query('ROLLBACK');
      throw new AppError(500, 'Не удалось создать заказ');
    }

    // 3c. INSERT order_items
    for (const item of body.items) {
      const qty = item.quantity || 1;
      const subtotal = item.price * qty;
      const metadata: OrderItemMetadata = { ...(item.options || {}) };
      if (item.disabled_features && item.disabled_features.length > 0) {
        metadata['disabled_features'] = item.disabled_features;
      }
      if (item.sla_quantity) {
        metadata['sla_quantity'] = item.sla_quantity;
      }
      await pgClient.query(
        `INSERT INTO order_items (order_id, order_type, name, unit_price, quantity, subtotal, metadata, service_option_id)
         VALUES ($1, 'crm', $2, $3, $4, $5, $6, $7)`,
        [orderId, item.name, item.price, qty, subtotal, JSON.stringify(metadata), item.service_option_id || null],
      );
    }

    // 3d. INSERT order_assignments (if assigned_employee_id)
    if (body.assigned_employee_id) {
      const itemNames = body.items.map(i => i.quantity > 1 ? `${i.name} x${i.quantity}` : i.name);
      await pgClient.query(
        `INSERT INTO order_assignments (order_id, order_type, source, status, assigned_to, assigned_at, studio_id, order_summary)
         VALUES ($1, 'other', $2, 'pending', $3, NOW(), $4, $5)`,
        [orderId, body.source, body.assigned_employee_id, resolvedStudioId, itemNames.join(', ').substring(0, 255)],
      );
    }

    // 3e. Generate auto-reminders for employee
    if (body.document_template_id || body.medals_required || body.wishes) {
      let templateSlug: string | null = null;
      let templateCategory: string | null = null;
      if (body.document_template_id) {
        const tpl = await pgClient.query<DocumentTemplateLookupRow>(
          `SELECT slug, category FROM document_templates WHERE id = $1`,
          [body.document_template_id],
        );
        if (tpl.rows[0]) {
          templateSlug = tpl.rows[0].slug;
          templateCategory = tpl.rows[0].category;
        }
      }
      const reminders = generateAutoReminders({
        documentTemplateSlug: templateSlug,
        documentTemplateCategory: templateCategory,
        medalsRequired: body.medals_required,
        wishes: body.wishes,
      });
      if (reminders.length > 0) {
        await pgClient.query(
          `UPDATE photo_print_orders SET employee_reminder = $1 WHERE order_id = $2`,
          [JSON.stringify(reminders), orderId],
        );
      }
    }

    await pgClient.query('COMMIT');

    // 3f. Set estimated_ready_at (outside transaction, fire-and-forget)
    // Use operator-provided deadline_at, or compute SLA from option IDs → fallback to priority
    const orderSlaItems = body.items.flatMap(item => item.service_option_id
      ? [{
          serviceOptionId: item.service_option_id,
          quantity: item.quantity,
          slaQuantity: item.sla_quantity,
        }]
      : []);
    const extraSlaItems = (body.sla_items ?? []).map(item => ({
      serviceOptionId: item.service_option_id,
      quantity: item.quantity,
      slaQuantity: item.sla_quantity,
    }));
    const slaItems = extraSlaItems.length > 0 ? extraSlaItems : orderSlaItems;
    const slaMinutes = slaItems.length > 0
      ? await computeSlaFromOrderItems(slaItems)
      : (body.priority === 'urgent'
          ? URGENT_ORDER_WORK_MINUTES
          : body.priority === 'vip'
            ? VIP_ORDER_WORK_MINUTES
            : DEFAULT_ORDER_WORK_MINUTES);
    pool.query(
      `UPDATE photo_print_orders
       SET estimated_ready_at = COALESCE($2::timestamptz, created_at + $3 * interval '1 minute')
       WHERE order_id = $1 AND estimated_ready_at IS NULL`,
      [orderId, body.deadline_at || null, slaMinutes],
    ).catch(err => log.error(`[CRM-Create ${orderId}] Failed to set estimated_ready_at`, { error: String(err) }));

    // 4. createTaskFromOrder (outside transaction)
    const estimatedReadyAt = body.deadline_at
      ? new Date(body.deadline_at)
      : new Date(Date.now() + slaMinutes * 60_000);

    // Sync sla_deadline in work_tasks (if task already exists from a race)
    pool.query(
      `UPDATE work_tasks SET sla_deadline = $2, due_date = $2
       WHERE print_order_id = (SELECT id FROM photo_print_orders WHERE order_id = $1)
         AND status NOT IN ('completed', 'cancelled')`,
      [orderId, estimatedReadyAt],
    ).catch(err => log.error(`[CRM-Create ${orderId}] Failed to sync sla_deadline`, { error: String(err) }));

    let taskId: string | null = null;
    try {
      const itemNames = body.items.map(i => i.quantity > 1 ? `${i.name} x${i.quantity}` : i.name);
      const task = await createTaskFromOrder({
        orderId: newOrder.id,
        orderTable: 'photo_print_orders',
        taskType: 'delivery',
        clientName: clientName || undefined,
        clientPhone: clientPhone || undefined,
        clientChannel: body.source,
        title: `CRM: ${itemNames.join(', ')}`.substring(0, 255),
        description: body.description || `Заказ ${orderId}`,
        studioId: resolvedStudioId || undefined,
        chatSessionId: body.chat_session_id || undefined,
        createdBy: req.user.id,
        priority: body.priority,
        estimatedReadyAt,
      });
      taskId = task?.id || null;
    } catch (taskErr: unknown) {
      const msg = taskErr instanceof Error ? taskErr.message : String(taskErr);
      log.warn(`[CRM-Create ${orderId}] Task creation failed (non-critical)`, { error: msg });
    }

    // 4b. Задача ретуши «Супер обработки» (fire-and-forget после COMMIT).
    // Создаётся ВСЕГДА при processing-super (как POS, P0-2), даже если галочки пусты —
    // это лист-задание для ретушёра. Дедуп по print_order_id внутри сервиса.
    const hasSuper = body.items.some(i => i.slug === 'processing-super');
    if (hasSuper) {
      let resolved: Awaited<ReturnType<typeof resolveRetouchConfig>> | null = null;
      try {
        resolved = await resolveRetouchConfig(body.retouch_config ?? { groups: {} });
      } catch (resolveErr: unknown) {
        const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        log.warn(`[CRM-Create ${orderId}] resolveRetouchConfig failed, creating task with empty options`, { error: msg });
      }
      const r = resolved ?? { options: [], notes: null, gender: 'any' as const };
      createRetouchTaskFromCrm({
        print_order_id: newOrder.id,
        order_id_label: orderId,
        studio_id: resolvedStudioId,
        client_name: clientName,
        client_phone: clientPhone,
        chat_session_id: body.chat_session_id ?? null,
        gender: r.gender,
        retouch_options: r.options,
        notes: r.notes,
        created_by: req.user.id,
      }).catch(err => log.error(`[CRM-Create ${orderId}] createRetouchTaskFromCrm failed`, { error: String(err) }));
    }

    // 5. Socket.IO
    try {
      const ss: SocketServer | undefined = req.app['socketServer'];
      if (ss) {
        const orderCreatedPayload = {
          orderId,
          totalPrice: computedTotal,
          contactName: clientName,
          source: body.source,
        };
        logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:created', orderCreatedPayload);
        logAndEmit(ss.getIO(), 'employee:dashboard', 'order:created', orderCreatedPayload);
      }
    } catch (_socketErr: unknown) { /* socket not available — logged by socket layer */ }

    // 6. CRM event outbox
    enqueueCrmEvent('order', orderId, 'order_created', {
      client_name: clientName,
      client_phone: clientPhone,
      preview: `Заказ ${orderId}`,
      status: 'new',
      priority: body.priority === 'urgent' ? 1 : body.priority === 'vip' ? 0 : 2,
      sort_time: new Date().toISOString(),
      channel: null,
      assigned_to: body.assigned_employee_id || req.user.id,
      assigned_to_name: null,
      unread: false,
      metadata: {},
    }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

    if (body.chat_session_id) {
      try {
        await notifyChatOrderReadyEstimate(body.chat_session_id, orderId, estimatedReadyAt, req);
      } catch (notifyErr: unknown) {
        log.warn(`[CRM-Create ${orderId}] Failed to send ready estimate to chat`, {
          sessionId: body.chat_session_id,
          error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
      }

      if (hasSuper) {
        await notifyChatSuperRetouch(body.chat_session_id, orderId, req)
          .catch(err => log.error('[CRM-Create] super retouch intro failed', { orderId, error: String(err) }));
      }
    }

    recordBusinessEvent({
      domain: 'orders',
      event: 'photo_print.crm_created',
      outcome: 'success',
      severity: 'info',
      actorId: req.user.id,
      entityType: 'photo_print_order',
      entityId: String(newOrder.id),
      orderId,
      chatSessionId: body.chat_session_id || null,
      durationMs: Date.now() - crmOrderStartedAt,
      metadata: {
        source: body.source,
        totalPrice: computedTotal,
        priority: body.priority,
        assigned: !!body.assigned_employee_id,
        taskCreated: !!taskId,
        studioId: resolvedStudioId,
        itemCount: body.items.length,
      },
    });

    // FC-1: forward-capture услуги заказа (best-effort, вне ответа). Структурные
    // items CRM-пути нормализуются attributeOrder; selected_service/tg_user_id —
    // при наличии chat_session_id (slice S5).
    void captureOrderServiceAttribution(newOrder.id, body.chat_session_id || null);

    res.status(201).json({
      success: true,
      data: {
        orderId,
        orderNumber: orderId,
        taskId,
      },
    });
  } catch (err: unknown) {
    try { await pgClient.query('ROLLBACK'); } catch (rbErr: unknown) {
      log.error('[CRM-Create] ROLLBACK failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
    }
    throw err;
  } finally {
    pgClient.release();
  }
});

// ============================================================================
// POST /api/orders/photo-print/walk-in — ручное создание заказа (walk-in)
// ============================================================================
router.post('/walk-in', authenticateToken, requirePermission('pos:use'), idempotent(60), validate(createWalkInOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  const {
    items,
    client_name,
    client_phone,
    client_email,
    total_price,
    payment_method,
    comment,
    studio_id,
    document_template_id,
    photo_size,
    medals_required,
    medals_description,
    uniform_description,
    wishes,
  } = req.body as CreateWalkInOrderInput;

  // Генерация WI-YYMMDD-XXXX
  const date = new Date();
  const yr = date.getFullYear().toString().slice(-2);
  const mo = (date.getMonth() + 1).toString().padStart(2, '0');
  const dy = date.getDate().toString().padStart(2, '0');
  const rnd = secureRandomString(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const orderId = `WI-${yr}${mo}${dy}-${rnd}`;

  const isPaid = !!payment_method;
  const orderStatus = isPaid ? 'processing' : 'new';
  const paymentStatus = isPaid ? 'paid' : 'pending';

  // 1. Создать заказ
  const displayName = client_name?.trim() || 'Гость';
  const displayPhone = client_phone?.trim() || null;

  const newOrder = await db.queryOne<CreatedOrderRow>(
    `INSERT INTO photo_print_orders (
        order_id, mode, contact_name, contact_phone, contact_email,
        comments, total_price, items, status, payment_status,
        paid_at, priority, assigned_employee_id, assigned_at, delivery_method,
        document_template_id, photo_size, medals_required, medals_description, uniform_description, wishes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        ${isPaid ? 'NOW()' : 'NULL'}, $11, $12, ${isPaid ? 'NOW()' : 'NULL'}, 'pickup',
        $13, $14, $15, $16, $17, $18)
      RETURNING id, order_id`,
    [
      orderId,
      'custom',
      displayName,
      displayPhone,
      client_email?.trim() || null,
      comment?.trim() || null,
      total_price,
      JSON.stringify(items),
      orderStatus,
      paymentStatus,
      'normal',
      req.user.id,
      document_template_id || null,
      photo_size || null,
      medals_required ?? false,
      medals_description?.trim() || null,
      uniform_description?.trim() || null,
      wishes?.trim() || null,
    ]
  );

  if (!newOrder) { throw new AppError(500, 'Не удалось создать заказ'); }

  // 1b. Set estimated_ready_at (walk-in: SLA из option IDs → fallback 30 мин)
  const walkInSlaItems = items.flatMap(item => item.service_option_id
    ? [{
        serviceOptionId: item.service_option_id,
        quantity: item.quantity,
        slaQuantity: item.sla_quantity,
      }]
    : []);
  const walkInSlaMinutes = walkInSlaItems.length > 0
    ? await computeSlaFromOrderItems(walkInSlaItems)
    : 30;
  pool.query(
    `UPDATE photo_print_orders SET estimated_ready_at = created_at + $2 * interval '1 minute'
     WHERE order_id = $1 AND estimated_ready_at IS NULL`,
    [orderId, walkInSlaMinutes],
  ).catch(err => log.error(`[WalkIn ${orderId}] Failed to set estimated_ready_at`, { error: String(err) }));

  // Sync sla_deadline in work_tasks
  const walkInEstimatedReadyAtSync = new Date(Date.now() + walkInSlaMinutes * 60_000);
  pool.query(
    `UPDATE work_tasks SET sla_deadline = $2, due_date = $2
     WHERE print_order_id = (SELECT id FROM photo_print_orders WHERE order_id = $1)
       AND status NOT IN ('completed', 'cancelled')`,
    [orderId, walkInEstimatedReadyAtSync],
  ).catch(err => log.error(`[WalkIn ${orderId}] Failed to sync sla_deadline`, { error: String(err) }));

  // 1c. Generate auto-reminders for employee
  if (document_template_id || medals_required || wishes) {
    await persistAutoReminders(orderId, document_template_id, medals_required, wishes);
  }

  // 2. Найти/создать клиента (только если есть хоть какие-то данные)
  if (displayPhone || (client_name?.trim())) {
    try {
      const customer = await findOrCreateCustomer({
        phone: displayPhone || undefined,
        name: client_name?.trim() || undefined,
      });
      if (customer?.id) {
        await db.query(`UPDATE photo_print_orders SET customer_id = $1 WHERE order_id = $2`, [customer.id, orderId]);
      }
    } catch (e) { log.warn('[WalkIn] findOrCreateCustomer failed', { error: (e as Error).message }); }
  }

  // 3. Создать order_assignment
  try {
    const orderType = (items[0]?.slug || '').includes('photo') || (items[0]?.name || '').toLowerCase().includes('фото') ? 'photo' : 'other';
    const validTypes = ['print', 'retouch', 'photo', 'marketplace', 'scan', 'design', 'other'];
    const safeType = validTypes.includes(orderType) ? orderType : 'other';
    await db.query(
      `INSERT INTO order_assignments (order_id, order_type, source, status, assigned_to, assigned_at, studio_id)
       VALUES ($1, $2, 'walk_in', 'in_progress', $3, NOW(), $4)`,
      [orderId, safeType, req.user.id, studio_id || null]
    );
  } catch (e) { log.warn('[WalkIn] order_assignment insert failed', { error: (e as Error).message }); }

  // 4. Если оплата — создать POS чек
  let receiptNumber: string | undefined;
  let cashDrawerStudioId: string | null = studio_id || null;
  if (isPaid && payment_method) {
    try {
      const shift = await getCurrentShift(req.user.id);
      if (shift && shift.status === 'open') {
        cashDrawerStudioId = shift.studio_id;
        const receiptItems = items.map(item => ({
          product_id: null,
          product_name: item.name,
          quantity: item.quantity || 1,
          unit_price: item.price,
          total: (item.price) * (item.quantity || 1),
        }));
        const receipt = await createReceipt({
          shift_id: shift.id,
          employee_id: req.user.id,
          studio_id: shift.studio_id,
          customer_phone: displayPhone || undefined,
          customer_name: displayName !== 'Гость' ? displayName : undefined,
          items: receiptItems,
          payments: [{ payment_type: payment_method, amount: total_price }],
          subtotal: total_price,
          total: total_price,
        });
        receiptNumber = receipt.receipt_number;
        // Сохранить receipt_number в заказе
        await db.query(
          `UPDATE photo_print_orders SET receipt_url = $1 WHERE order_id = $2`,
          [`/pos/receipts/${receipt.id}`, orderId]
        );
      }
    } catch (posErr) {
      log.warn(`[WalkIn ${orderId}] POS receipt failed (non-critical)`, { error: (posErr as Error).message });
    }
  }
  if (isPaid && payment_method === 'cash') {
    enqueueCashDrawerCommandSafe({
      studioId: cashDrawerStudioId,
      initiatedBy: req.user.id,
      orderId,
      source: 'photo-print.walk-in',
    });
  }

  // 4b. Создать work_task (fire-and-forget, не блокирует ответ)
  const walkInEstimatedReadyAt = new Date(Date.now() + walkInSlaMinutes * 60_000);

  let taskData: { id: string; task_number: number } | null = null;
  try {
    taskData = await createTaskFromWalkIn({
      orderId: newOrder.id,
      orderDisplayId: orderId,
      assignedTo: req.user.id,
      studioId: studio_id || undefined,
      clientName: displayName !== 'Гость' ? displayName : undefined,
      clientPhone: displayPhone || undefined,
      priority: 'normal',
      items: items.map(i => ({ name: i.name, quantity: i.quantity || 1, price: i.price })),
      estimatedReadyAt: walkInEstimatedReadyAt,
    });
  } catch (taskErr) {
    log.warn(`[WalkIn ${orderId}] Task creation failed (non-critical)`, { error: (taskErr as Error).message });
  }

  // 4c. Подсчёт активных задач сотрудника
  let activeTaskCount = 0;
  try {
    const countRow = await db.queryOne<TaskCountRow>(
      `SELECT COUNT(*) as cnt FROM work_tasks WHERE assigned_to = $1 AND status NOT IN ('completed', 'cancelled')`,
      [req.user.id],
    );
    activeTaskCount = parseInt(countRow?.cnt || '0', 10);
  } catch { /* non-critical */ }

  // 5. Socket.IO: уведомить дашборд
  try {
    const ss: SocketServer | undefined = req.app['socketServer'];
    if (ss) {
      const io = ss.getIO();
      const orderCreatedPayload = { orderId, totalPrice: total_price, contactName: displayName };
      logAndEmit(io, 'admin:visitor-chats', 'order:created', orderCreatedPayload);
      logAndEmit(io, 'employee:dashboard', 'order:created', orderCreatedPayload);
      if (taskData) {
        io.to('employee:dashboard').emit('task:created', { taskId: taskData.id, taskNumber: taskData.task_number });
      }
    }
  } catch (_e) { /* socket not available */ }

  enqueueCrmEvent('order', orderId, 'order_created', {
    client_name: displayName || null,
    client_phone: displayPhone || null,
    preview: `Заказ ${orderId}`,
    status: orderStatus,
    priority: 2,
    sort_time: new Date().toISOString(),
    channel: null,
    assigned_to: req.user.id,
    assigned_to_name: null,
    unread: false,
    metadata: {},
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  res.status(201).json({
    success: true,
    data: {
      orderId,
      receiptNumber: receiptNumber || null,
      taskId: taskData?.id || null,
      taskNumber: taskData?.task_number || null,
      activeTaskCount,
    },
  });
});

/**
 * Get order status by ID (public)
 * GET /api/orders/photo-print/:orderId
 */
router.get('/:orderId', async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  const order = await db.queryOne(
    'SELECT order_id, status, created_at, total_price FROM photo_print_orders WHERE order_id = $1',
    [orderId]
  );

  if (!order) {
    throw new AppError(404, 'Заказ не найден');
  }

  const itemRows = await db.query<OrderItemDetailRow>(
    `SELECT id, name, unit_price, quantity, subtotal, service_option_id,
            COALESCE(metadata, '{}'::jsonb) AS metadata
     FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const featureRows = itemRows.length === 0 ? [] : await db.query<OrderItemFeatureBreakdownRow>(
    `SELECT order_item_id, feature_name, feature_price, tier_index, origin_tier_index, sort_order, is_disabled
     FROM v_order_item_features WHERE order_id = $1 ORDER BY sort_order`,
    [orderId],
  );
  const featuresByItem = new Map<string, OrderItemFeatureBreakdownRow[]>();
  for (const fr of featureRows) {
    const list = featuresByItem.get(fr.order_item_id) ?? [];
    list.push(fr);
    featuresByItem.set(fr.order_item_id, list);
  }

  const items = itemRows.map(r => ({
    id: r.id,
    name: r.name,
    unit_price: parseFloat(r.unit_price),
    quantity: r.quantity,
    subtotal: parseFloat(r.subtotal),
    service_option_id: r.service_option_id,
    metadata: r.metadata,
    features_breakdown: (featuresByItem.get(r.id) ?? []).map(f => ({
      name: f.feature_name,
      price: parseFloat(f.feature_price),
      is_disabled: f.is_disabled,
      is_inherited: f.origin_tier_index < f.tier_index,
      origin_tier_index: f.origin_tier_index,
    })),
  }));

  res.json({
    success: true,
    data: {
      orderId: order.order_id,
      status: order.status,
      createdAt: order.created_at,
      totalPrice: order.total_price,
      items,
    }
  });
});

// sendOrderNotification → inlined in photo-print-processing.service

// ============================================================================
// GET /api/orders/photo-print/:orderId/attachments — Фото клиента (order_attachments)
// ============================================================================
router.get('/:orderId/attachments', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderId } = req.params;
  const attachments = await db.query<OrderAttachmentRow>(
    `SELECT id, s3_url, file_name, mime_type, file_size_bytes, attachment_type, sort_order, created_at
     FROM order_attachments
     WHERE order_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [orderId]
  );
  const signedAttachments = await Promise.all(attachments.map(async attachment => ({
    ...attachment,
    s3_url: await resolveStaffFileUrl(attachment.s3_url),
  })));
  res.json({ success: true, data: signedAttachments });
});

// ============================================================================
// PATCH /api/orders/photo-print/:orderId/items/:itemId — обновление disabled_features
// Feature-Level Pricing: сервер полностью пересчитывает unit_price/subtotal/total_price.
// Запрещено для payment_status='paid' и status IN (completed, cancelled).
// ============================================================================
router.patch('/:orderId/items/:itemId', authenticateToken, requirePermission('pos:use'), validate(patchOrderItemSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId, itemId } = req.params;
  const { disabled_features } = req.body as PatchOrderItemInput;
  const disabled = disabled_features ?? [];

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const orderRow = await pgClient.query<Pick<PhotoPrintOrders, 'id' | 'status' | 'payment_status'>>(
      `SELECT id, status, payment_status FROM photo_print_orders WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderRow.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      throw new AppError(404, 'Заказ не найден');
    }
    const order = orderRow.rows[0]!;

    if (order.payment_status === 'paid') {
      pricingFeatureValidationRejectTotal.inc({ reason: 'order_paid' });
      await pgClient.query('ROLLBACK');
      throw new AppError(409, 'Нельзя редактировать позиции оплаченного заказа');
    }
    if (order.status && ['completed', 'cancelled'].includes(order.status)) {
      await pgClient.query('ROLLBACK');
      throw new AppError(409, 'Нельзя редактировать позиции завершённого или отменённого заказа');
    }

    const itemRow = await pgClient.query<Pick<OrderItems, 'id' | 'quantity' | 'service_option_id' | 'name' | 'metadata'>>(
      `SELECT id, quantity, service_option_id, name, COALESCE(metadata, '{}'::jsonb) AS metadata
       FROM order_items WHERE id = $1 AND order_id = $2`,
      [itemId, orderId],
    );
    if (itemRow.rows.length === 0) {
      await pgClient.query('ROLLBACK');
      throw new AppError(404, 'Позиция заказа не найдена');
    }
    const item = itemRow.rows[0]!;

    if (!item.service_option_id && disabled.length > 0) {
      pricingFeatureValidationRejectTotal.inc({ reason: 'legacy_not_supported' });
      await pgClient.query('ROLLBACK');
      throw new AppError(400, `Позиция "${item.name}" не поддерживает feature-level pricing`);
    }

    let newUnitPrice: number | null = null;
    if (item.service_option_id) {
      const { unitPrice, unknownFeatures, allDisabled, hasFeatures } = await calculateFeatureLevelUnitPrice({
        serviceOptionId: item.service_option_id,
        disabledFeatures: disabled,
      });
      if (!hasFeatures) {
        if (disabled.length > 0) {
          pricingFeatureValidationRejectTotal.inc({ reason: 'legacy_not_supported' });
          await pgClient.query('ROLLBACK');
          throw new AppError(400, `Позиция "${item.name}" не поддерживает feature-level pricing`);
        }
      } else {
        if (unknownFeatures.length > 0) {
          pricingFeatureValidationRejectTotal.inc({ reason: 'unknown_features' });
          await pgClient.query('ROLLBACK');
          throw new AppError(400, `Неизвестные features для позиции "${item.name}": ${unknownFeatures.join(', ')}`);
        }
        if (allDisabled) {
          pricingFeatureValidationRejectTotal.inc({ reason: 'all_disabled' });
          await pgClient.query('ROLLBACK');
          throw new AppError(400, `Нельзя отключить все features для позиции "${item.name}" — используйте опцию "без обработки"`);
        }
        newUnitPrice = unitPrice;
      }
    }

    if (newUnitPrice !== null) {
      await pgClient.query(
        `UPDATE order_items
         SET unit_price = $1,
             subtotal   = $1 * quantity,
             metadata   = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{disabled_features}', $2::jsonb, true)
         WHERE id = $3`,
        [newUnitPrice, JSON.stringify(disabled), itemId],
      );
    } else {
      await pgClient.query(
        `UPDATE order_items
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{disabled_features}', $1::jsonb, true)
         WHERE id = $2`,
        [JSON.stringify(disabled), itemId],
      );
    }

    await pgClient.query(
      `UPDATE photo_print_orders
       SET total_price = COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id = $1), 0),
           updated_at  = NOW()
       WHERE order_id  = $1`,
      [orderId],
    );

    await pgClient.query('COMMIT');
  } catch (err: unknown) {
    try { await pgClient.query('ROLLBACK'); } catch (rbErr: unknown) {
      log.error('[PATCH items] ROLLBACK failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
    }
    throw err;
  } finally {
    pgClient.release();
  }

  // Enrichment via v_order_item_features (after commit)
  const itemDetail = await db.queryOne<OrderItemDetailRow>(
    `SELECT id, name, unit_price, quantity, subtotal, service_option_id,
            COALESCE(metadata, '{}'::jsonb) AS metadata
     FROM order_items WHERE id = $1`,
    [itemId],
  );
  const featureRows = await db.query<OrderItemFeatureBreakdownRow>(
    `SELECT order_item_id, feature_name, feature_price, tier_index, origin_tier_index, sort_order, is_disabled
     FROM v_order_item_features WHERE order_item_id = $1 ORDER BY sort_order`,
    [itemId],
  );
  const orderTotalRow = await db.queryOne<Pick<PhotoPrintOrders, 'total_price'>>(
    `SELECT total_price FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  const enrichedItem = itemDetail
    ? {
        id: itemDetail.id,
        name: itemDetail.name,
        unit_price: parseFloat(itemDetail.unit_price),
        quantity: itemDetail.quantity,
        subtotal: parseFloat(itemDetail.subtotal),
        service_option_id: itemDetail.service_option_id,
        metadata: itemDetail.metadata,
        features_breakdown: featureRows.map(f => ({
          name: f.feature_name,
          price: parseFloat(f.feature_price),
          is_disabled: f.is_disabled,
          is_inherited: f.origin_tier_index < f.tier_index,
          origin_tier_index: f.origin_tier_index,
        })),
      }
    : null;

  const orderTotal = orderTotalRow?.total_price ? parseFloat(orderTotalRow.total_price) : 0;

  // WS broadcast
  try {
    const ss: SocketServer | undefined = req.app['socketServer'];
    if (ss) {
      logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:updated', { orderId });
    }
  } catch (socketErr: unknown) {
    log.warn('[PATCH items] socket emit failed', { error: socketErr instanceof Error ? socketErr.message : String(socketErr) });
  }

  res.json({
    success: true,
    data: {
      item: enrichedItem,
      orderTotal,
    },
  });
});

// ============================================================================
// PUT /api/orders/photo-print/:orderId/edit — редактирование заказа (для сотрудников)
// ============================================================================
router.put('/:orderId/edit', authenticateToken, requirePermission('pos:use'), validate(editOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId } = req.params;
  const {
    contact_name, contact_phone, contact_email, delivery_address, comments, tracking_number,
    priority, chat_session_id, deadline_at, description, source,
    wishes, medals_required, medals_description, uniform_description,
    document_template_id, photo_size,
  } = req.body as EditOrderInput;

  const existing = await db.queryOne<EditableOrderLookupRow>(
    'SELECT id, status, chat_session_id FROM photo_print_orders WHERE order_id = $1',
    [orderId]
  );

  if (!existing) {
    throw new AppError(404, 'Заказ не найден');
  }

  if (['completed', 'cancelled'].includes(existing.status)) {
    throw new AppError(400, 'Нельзя редактировать завершённый или отменённый заказ');
  }

  let normalizedChatSessionId: string | null | undefined = chat_session_id;
  if (normalizedChatSessionId === '') normalizedChatSessionId = null;

  if (normalizedChatSessionId !== undefined && normalizedChatSessionId !== null) {
    const chatExists = await db.queryOne<Pick<Conversations, 'id'>>(
      'SELECT id FROM conversations WHERE id = $1',
      [normalizedChatSessionId],
    );
    if (!chatExists) {
      throw new AppError(400, 'Указанный чат не найден');
    }
  }

  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  const fields: Partial<EditOrderInput> = {
    contact_name, contact_phone, contact_email, delivery_address, comments, tracking_number,
    priority, chat_session_id: normalizedChatSessionId, deadline_at, description, source,
    wishes, medals_required, medals_description, uniform_description,
    document_template_id, photo_size,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(value === '' ? null : value);
    }
  }

  params.push(orderId);

  const updated = await db.queryOne<PhotoPrintOrders>(
    `UPDATE photo_print_orders SET ${sets.join(', ')} WHERE order_id = $${idx} RETURNING *`,
    params
  );

  if (normalizedChatSessionId !== undefined && normalizedChatSessionId !== existing.chat_session_id) {
    await db.query(
      `UPDATE work_tasks
       SET chat_session_id = $1, updated_at = NOW()
       WHERE print_order_id = $2`,
      [normalizedChatSessionId, existing.id],
    );
  }

  try {
    const ss: SocketServer | undefined = req.app['socketServer'];
    if (ss) {
      logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:updated', { orderId });
    }
  } catch { /* socket not available */ }

  res.json({ success: true, data: updated });
});

// ============================================================================
// DELETE /api/orders/photo-print/:orderId — удалить ошибочно созданный заказ
// ============================================================================
router.delete('/:orderId', authenticateToken, requirePermission('pos:use'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId } = req.params;

  const order = await db.queryOne<DeleteOrderLookupRow>(
    `SELECT id, order_id, status, payment_status, chat_session_id
     FROM photo_print_orders
     WHERE order_id = $1`,
    [orderId],
  );

  if (!order) {
    throw new AppError(404, 'Заказ не найден');
  }

  if (order.status === 'completed') {
    throw new AppError(409, 'Нельзя удалить завершённый заказ');
  }

  if (order.payment_status === 'paid') {
    throw new AppError(409, 'Нельзя удалить оплаченный заказ. Сначала оформите отмену или возврат.');
  }

  const blockers = await db.queryOne<DeleteOrderBlockersRow>(
    `SELECT
       (SELECT COUNT(*)::int FROM print_jobs WHERE order_id = $2) AS print_jobs_count,
       (SELECT COUNT(*)::int FROM production_orders WHERE photo_print_order_id = $1) AS production_orders_count,
       (SELECT COUNT(*)::int FROM pos_receipts WHERE print_order_id = $1) AS pos_receipts_count,
       (SELECT COUNT(*)::int FROM pos_transactions WHERE order_id = $1) AS pos_transactions_count,
       (SELECT COUNT(*)::int FROM payment_events WHERE order_id = $2) AS payment_events_count,
       (SELECT COUNT(*)::int FROM payment_installments WHERE order_id = $2) AS payment_installments_count,
       (SELECT COUNT(*)::int FROM refund_requests WHERE order_id = $2) AS refund_requests_count,
       (SELECT COUNT(*)::int FROM priority_purchases WHERE order_id = $2) AS priority_purchases_count,
       (SELECT COUNT(*)::int FROM promo_redemptions WHERE order_id = $1 AND COALESCE(order_type, 'photo_print') = 'photo_print') AS promo_redemptions_count,
       (SELECT COUNT(*)::int FROM subscription_credit_usage_log WHERE print_order_id = $1) AS subscription_credit_usage_count,
       (SELECT COUNT(*)::int FROM student_discount_redemptions WHERE print_order_id = $1) AS student_discount_redemptions_count`,
    [order.id, order.order_id],
  );

  const productionRefs = (blockers?.print_jobs_count ?? 0) + (blockers?.production_orders_count ?? 0);
  if (productionRefs > 0) {
    throw new AppError(409, 'Нельзя удалить заказ с печатью или производственными заказами');
  }

  const paymentRefs =
    (blockers?.pos_receipts_count ?? 0) +
    (blockers?.pos_transactions_count ?? 0) +
    (blockers?.payment_events_count ?? 0) +
    (blockers?.payment_installments_count ?? 0) +
    (blockers?.refund_requests_count ?? 0) +
    (blockers?.priority_purchases_count ?? 0) +
    (blockers?.promo_redemptions_count ?? 0) +
    (blockers?.subscription_credit_usage_count ?? 0) +
    (blockers?.student_discount_redemptions_count ?? 0);

  if (paymentRefs > 0) {
    throw new AppError(409, 'Нельзя удалить заказ с платёжными, кассовыми или скидочными записями');
  }

  await db.transaction(async (client) => {
    await client.query(
      `DELETE FROM crm_inbox
       WHERE type = 'order'
         AND (
           id = $1 OR id = $2
           OR metadata->>'orderId' = $1
           OR metadata->>'orderId' = $2
         )`,
      [order.order_id, order.id],
    );
    await client.query('DELETE FROM order_attachments WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM order_items WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM order_delay_compensations WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM order_status_history WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM partner_referrals WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM review_requests WHERE order_id = $1', [order.order_id]);
    await client.query('DELETE FROM webhook_idempotency WHERE order_id = $1', [order.order_id]);
    await client.query('UPDATE photo_approval_sessions SET order_id = NULL, updated_at = NOW() WHERE order_id = $1', [order.id]);
    await client.query('UPDATE work_tasks SET print_order_id = NULL, updated_at = NOW() WHERE print_order_id = $1', [order.id]);
    await client.query('DELETE FROM photo_print_orders WHERE id = $1', [order.id]);
  });

  try {
    const ss: SocketServer | undefined = req.app['socketServer'];
    if (ss) {
      logAndEmit(ss.getIO(), 'admin:visitor-chats', 'order:deleted', { orderId: order.order_id });
      logAndEmit(ss.getIO(), 'employee:dashboard', 'order:deleted', { orderId: order.order_id });
    }
  } catch (socketErr: unknown) {
    log.warn('[DELETE order] socket emit failed', { error: socketErr instanceof Error ? socketErr.message : String(socketErr) });
  }

  log.info('Photo print order deleted', { orderId: order.order_id, deletedBy: req.user.id });

  res.json({ success: true });
});

// ============================================================================
// PUT /api/orders/photo-print/:orderId/assign — назначить заказ на сотрудника
// ============================================================================
router.put('/:orderId/assign', authenticateToken, requirePermission('pos:use'), validate(assignOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !['admin', 'employee', 'photographer'].includes(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId } = req.params;
  const { employee_id } = req.body as AssignOrderInput;

  const order = await db.queryOne<OrderStatusLookupRow>(
    'SELECT id, status FROM photo_print_orders WHERE order_id = $1', [orderId]
  );

  if (!order) {
    throw new AppError(404, 'Order not found');
  }

  if (['completed', 'cancelled'].includes(order.status)) {
    throw new AppError(400, 'Cannot assign completed/cancelled order');
  }

  const updated = await db.queryOne(
    `UPDATE photo_print_orders
     SET assigned_employee_id = $1, assigned_at = ${employee_id ? 'NOW()' : 'NULL'}
     WHERE order_id = $2
     RETURNING *`,
    [employee_id || null, orderId]
  );

  try {
    const socketServer = req.app.socketServer;
    if (socketServer) {
      socketServer.getIO().to('employee:dashboard').emit('order:assigned', { order_id: orderId, employee_id, assigned_by: req.user.id });
    }
  } catch { /* socket not available */ }

  res.json({ success: true, data: updated });
});

// ============================================================================
// PUT /api/orders/photo-print/:orderId/status — обновить статус заказа (для сотрудников)
// ============================================================================
router.put('/:orderId/status', authenticateToken, requirePermission('pos:use'), validate(updateOrderStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !['admin', 'employee', 'photographer'].includes(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }
  const staffUser = req.user;

  const { orderId } = req.params;
  const { status, override_location } = req.body as UpdateOrderStatusInput;

  if (status === 'processing') {
    await assertOrderStudioAccess({
      orderId,
      employeeId: staffUser.id,
      overrideLocation: override_location === true,
    });
  }

  const applied = await applyOrderStatusChange({
    orderRef: orderId,
    status,
    actorUserId: staffUser.id,
  });
  if (!applied) {
    throw new AppError(404, 'Order not found');
  }
  const { oldStatus, ...updated } = applied;

  // Записать историю статусов и пересчитать очередь (fire-and-forget)
  recordStatusChange({
    orderId,
    oldStatus: oldStatus || null,
    newStatus: status,
    changedBy: staffUser.id,
  }).catch(err => log.error('[Queue] recordStatusChange error:', err.message));

  if (['paid', 'processing', 'ready', 'completed', 'cancelled'].includes(status)) {
    recalculateQueue()
      .then(() => updateEstimatedTimes())
      .catch(err => log.error('[Queue] recalculate error:', err.message));
  }

  // Gamification: award XP for order completion (fire-and-forget)
  if (status === 'completed') {
    const completedByUserId = req.user.id;
    import('../services/employee-gamification.service.js').then(({ awardXP }) => {
      awardXP(completedByUserId, 'order_processed', updated.id, `Заказ ${orderId} выполнен`)
        .catch(err => log.warn('[Gamification] awardXP failed', { orderId, error: String(err) }));
    }).catch(err => log.warn('[Gamification] import failed', { orderId, error: String(err) }));
  }

  // ─── Auto-print trigger ───
  if (shouldAutoPrint(status)) {
    autoPrintOrderItems(orderId, req.user!.id)
      .then(result => {
        if (result.queued > 0) {
          const ss: SocketServer | undefined = req.app['socketServer'];
          if (ss) {
            ss.getIO().to('employee:dashboard').emit('print:auto-triggered', {
              orderId,
              jobCount: result.queued,
              printerName: result.printerName,
            });
          }
        }
      })
      .catch(err => log.error('[AutoPrint] Failed', { orderId, error: String(err) }));
  }

  // ─── Push + Email уведомления клиенту ───
  const statusLabels: Record<string, string> = {
    processing: 'Заказ принят в работу',
    ready: 'Заказ готов',
    completed: 'Заказ выполнен',
    cancelled: 'Заказ отменён',
  };

  const statusLabel = statusLabels[status];
  if (statusLabel) {
    const sessionId = updated.chat_session_id as string | null;
    const contactEmail = updated.contact_email as string | null;

    // Push-уведомление (web push через сессию чата)
    if (sessionId) {
      sendVisitorChatPush(sessionId, {
        title: statusLabel,
        body: `Заказ ${orderId} — ${statusLabel.toLowerCase()}`,
        tag: `order-status-${orderId}`,
        url: `/track/${orderId}`,
      }).catch(err => log.error('[Push] Order status notification error:', err.message));

      // Бот-сообщение в чат клиенту
      notifyChatOrderStatus(sessionId, orderId, status, statusLabel, req)
        .catch(err => log.error('[Chat] Order status notification error:', err.message));
    }

    // Email-уведомление
    if (contactEmail) {
      sendOrderStatusUpdate(contactEmail, orderId, status, statusLabel)
        .catch(err => log.error('[Email] Order status notification error:', err.message));
    }
  }

  // WebSocket: уведомить подписчиков трекинга
  try {
    const socketServer = req.app.socketServer;

    if (socketServer) {
      const queueInfo = await getQueuePosition(orderId).catch(() => null);
      socketServer.getIO().to(`order:${orderId}`).emit('order:status-changed', {
        orderId,
        status,
        queue_position: queueInfo?.position ?? null,
        estimated_ready_at: updated.estimated_ready_at,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    log.error('[Order] WebSocket emit error', { error: (err as Error).message });
  }

  enqueueCrmEvent('order', orderId, 'order_status_changed', {
    status,
    sort_time: new Date().toISOString(),
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  res.json({ success: true, data: updated });
});

// ============================================================================
// PUT /api/orders/photo-print/:orderId/record-payment — записать оплату заказа
// Используется из CRM для приёма оплаты: наличные, карта (POS), СБП
// ============================================================================
router.put('/:orderId/record-payment', authenticateToken, requirePermission('pos:use'), idempotent(60), validate(recordPaymentSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !['admin', 'employee', 'photographer'].includes(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }
  const staffUser = req.user;
  const recordPaymentStartedAt = Date.now();

  const { orderId } = req.params;
  const { payment_method, transaction_id, card_info, pos_receipt_id, subscription_id } = req.body as RecordPaymentInput;
  const txId = typeof transaction_id === 'string' ? transaction_id : null;
  const cardStr = typeof card_info === 'string' ? card_info : null;

  const { existing, updated, newStatus } = await db.transaction(async (client: PoolClient) => {
    const existingOrder = (await client.query<PhotoPrintPaymentOrderRow>(
      `SELECT id, payment_status, status, total_price, items
       FROM photo_print_orders
       WHERE order_id = $1
       FOR UPDATE`,
      [orderId],
    )).rows[0];

    if (!existingOrder) {
      throw new AppError(404, 'Order not found');
    }
    if (existingOrder.payment_status === 'paid') {
      throw new AppError(409, 'Order already paid');
    }

    let linkedPosReceiptId: string | null = null;
    if (payment_method === 'card') {
      if (!pos_receipt_id) {
        throw new AppError(400, 'Оплата картой требует POS-чек');
      }

      const posReceipt = (await client.query<PosReceiptCardPaymentGuardRow>(
        `SELECT id, total, print_order_id, is_refund, voided_at
         FROM pos_receipts
         WHERE id = $1
         FOR UPDATE`,
        [pos_receipt_id],
      )).rows[0];
      if (!posReceipt) {
        throw new AppError(400, 'POS-чек для оплаты картой не найден');
      }
      if (posReceipt.print_order_id && posReceipt.print_order_id !== existingOrder.id) {
        throw new AppError(400, 'POS-чек уже привязан к другому заказу');
      }
      if (posReceipt.is_refund || posReceipt.voided_at) {
        throw new AppError(400, 'POS-чек недействителен для оплаты заказа');
      }

      const cardPaymentTotal = (await client.query<PosReceiptPaymentTotalRow>(
        `SELECT COALESCE(SUM(amount), 0) AS payment_total
         FROM pos_receipt_payments
         WHERE receipt_id = $1
           AND payment_type = 'card'
           AND status = 'completed'`,
        [posReceipt.id],
      )).rows[0]?.payment_total ?? 0;
      const orderTotal = Number(existingOrder.total_price ?? 0);
      const receiptTotal = Number(posReceipt.total ?? 0);
      const cardTotal = Number(cardPaymentTotal);
      if (
        !Number.isFinite(orderTotal)
        || !Number.isFinite(receiptTotal)
        || !Number.isFinite(cardTotal)
        || Math.abs(receiptTotal - orderTotal) > 0.01
        || Math.abs(cardTotal - orderTotal) > 0.01
      ) {
        throw new AppError(400, 'Сумма POS-чека не совпадает с суммой заказа');
      }

      if (!posReceipt.print_order_id) {
        await client.query(
          `UPDATE pos_receipts
           SET print_order_id = $2
           WHERE id = $1`,
          [posReceipt.id, existingOrder.id],
        );
      }
      linkedPosReceiptId = posReceipt.id;
    }

    const nextStatus = ['new', 'pending_payment'].includes(existingOrder.status ?? '')
      ? 'paid'
      : existingOrder.status;
    let subscriptionCoverage: SubscriptionCoverageResult | null = null;

    if (payment_method === 'subscription') {
      if (!subscription_id) {
        throw new AppError(400, 'subscription_id is required for subscription payment');
      }

      const coverageItems = await resolveSubscriptionCoverageItemsForPrintOrder(client, {
        orderId,
        items: existingOrder.items,
      });
      if (coverageItems.length === 0) {
        throw new AppError(400, 'Подписка не покрывает позиции этого заказа');
      }

      subscriptionCoverage = await calculateSubscriptionCoverageWithClient(
        client,
        { subscription_id, items: coverageItems },
        { lock: true },
      );

      const orderTotal = Number(existingOrder.total_price ?? 0);
      if (subscriptionCoverage.total_covered_amount <= 0) {
        throw new AppError(400, 'Подписка не покрывает позиции этого заказа');
      }
      if (Math.abs(subscriptionCoverage.total_covered_amount - orderTotal) > 0.01) {
        throw new AppError(
          400,
          `Подписка покрывает ${subscriptionCoverage.total_covered_amount}₽ из ${orderTotal}₽`,
        );
      }
    }

    const updatedOrder = (await client.query<PhotoPrintOrder>(
      `UPDATE photo_print_orders
       SET payment_status = 'paid',
           paid_at = NOW(),
           payment_id = COALESCE($2, payment_id),
           payment_card_info = COALESCE($3, payment_card_info),
           status = $4,
           receipt_url = COALESCE($5, receipt_url),
           updated_at = NOW()
       WHERE order_id = $1
       RETURNING *`,
      [
        orderId,
        txId,
        cardStr,
        nextStatus,
        linkedPosReceiptId ? `/pos/receipts/${linkedPosReceiptId}` : null,
      ],
    )).rows[0];

    if (!updatedOrder) {
      throw new AppError(404, 'Order not found');
    }

    if (subscriptionCoverage && subscription_id) {
      for (const item of subscriptionCoverage.items) {
        if (item.covered_quantity <= 0 || !item.product_id) continue;
        await useCreditsWithClient(client, {
          subscription_id,
          product_id: item.product_id,
          quantity: item.covered_quantity,
          coverage_multiplier: item.coverage_multiplier,
          coverage_percent: item.coverage_percent,
          print_order_id: existingOrder.id,
          employee_id: staffUser.id,
          description: `Заказ печати ${orderId}`,
        });
      }
    }

    await client.query(
      `INSERT INTO payment_events (id, order_id, event_type, transaction_id, amount, card_info, metadata)
       VALUES (gen_random_uuid(), $1, 'payment_confirmed', $2, $3, $4, $5)`,
      [
        orderId,
        txId,
        existingOrder.total_price,
        cardStr,
        JSON.stringify({
          payment_method,
          pos_receipt_id: linkedPosReceiptId,
          subscription_id: subscription_id ?? null,
          subscription_coverage: subscriptionCoverage
            ? {
                total_covered_amount: subscriptionCoverage.total_covered_amount,
                total_credits_consumed: subscriptionCoverage.total_credits_consumed,
                items: subscriptionCoverage.items,
              }
            : null,
          recorded_by: staffUser.id,
        }),
      ],
    );

    return { existing: existingOrder, updated: updatedOrder, newStatus: nextStatus };
  });

  // Синхронизируем статус связанной задачи
  if (newStatus === 'processing' && existing.status !== 'processing') {
    db.query(
      `UPDATE work_tasks SET status = 'in_progress', updated_at = NOW()
       WHERE print_order_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [existing.id],
    ).catch(err => log.warn('work_task sync failed', { error: String(err) }));
  }

  // Fire-and-forget: пересчёт очереди, история, CRM event
  recordStatusChange({
    orderId,
    oldStatus: existing.status ?? 'new',
    newStatus: newStatus ?? 'paid',
    changedBy: req.user.id,
  }).catch(err => log.warn('recordStatusChange failed', { error: String(err) }));

  recalculateQueue()
    .then(() => updateEstimatedTimes())
    .catch(err => log.warn('recalculateQueue failed', { error: String(err) }));

  enqueueCrmEvent('order', orderId, 'order_paid', {
    sort_time: new Date().toISOString(),
    metadata: { payment_method, amount: existing.total_price, recorded_by: req.user.id },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  // WebSocket: уведомить подписчиков
  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`order:${orderId}`).emit('order:payment-updated', {
      orderId,
      payment_status: 'paid',
      payment_method,
      updated_at: new Date().toISOString(),
    });
  }

  // Chat notification: уведомить клиента в чат если есть chatSessionId
  if (updated?.chat_session_id) {
    notifyChatOrderPaidService(
      updated.chat_session_id,
      updated,
      payment_method,
    ).catch(err => log.warn('notifyChatOrderPaidService failed', { error: String(err) }));
  }

  if (payment_method === 'cash') {
    enqueueCashDrawerForCurrentShift({
      userId: req.user.id,
      orderId,
      source: 'photo-print.record-payment',
    });
  }

  // Post-payment pipeline: loyalty, customer stats, email, push, etc.
  if (updated) {
    const serviceName = updated.service_type
      || (Array.isArray(updated.items) && updated.items.length > 0 ? updated.items[0].name : undefined)
      || 'Заказ';
    const postPaymentData: OrderPaymentData = {
      orderId,
      orderDbId: String(updated.id),
      amount: Number(existing.total_price ?? 0),
      paymentMethod: payment_method,
      cardInfo: cardStr,
      payerEmail: updated.contact_email ?? null,
      transactionId: txId ?? `record-${orderId}`,
      contactName: updated.contact_name ?? null,
      contactPhone: updated.contact_phone ?? null,
      contactEmail: updated.contact_email ?? null,
      chatSessionId: updated.chat_session_id ?? null,
      isChatOrder: !!updated.chat_session_id,
      items: Array.isArray(updated.items) ? updated.items : [],
      serviceName,
      priority: updated.priority ?? 'normal',
      deliveryMethod: updated.delivery_method ?? null,
      deliveryAddress: updated.delivery_address ?? null,
      deliveryProvider: ((updated as unknown as Record<string, unknown>)['delivery_provider'] as string) || null,
      partnerPromoCode: updated.partner_promo_code ?? null,
      mode: updated.mode ?? null,
      totalPrice: Number(existing.total_price ?? 0),
      telegramUserId: updated.telegram_user_id ?? null,
      telegramUsername: updated.telegram_username ?? null,
      orderData: updated,
      token: null,
      cardFirstSix: null,
      cardLastFour: null,
      cardType: null,
      cardExpDate: null,
      receiptUrl: updated.receipt_url ?? null,
      createdAt: updated.created_at ? String(updated.created_at) : new Date().toISOString(),
    };
    enqueuePostPaymentJobs(postPaymentData)
      .catch(err => log.warn('enqueuePostPaymentJobs failed', { error: String(err) }));
  }

  log.info('Payment recorded', { orderId, payment_method, amount: existing.total_price, by: req.user.id });

  recordBusinessEvent({
    domain: 'payments',
    event: 'photo_print.record_payment',
    outcome: 'success',
    severity: 'info',
    actorId: req.user.id,
    entityType: 'photo_print_order',
    entityId: String(updated?.id ?? existing.id),
    orderId,
    chatSessionId: updated?.chat_session_id ?? null,
    paymentId: txId,
    durationMs: Date.now() - recordPaymentStartedAt,
    metadata: {
      paymentMethod: payment_method,
      amount: Number(existing.total_price ?? 0),
      newStatus,
      posReceiptId: pos_receipt_id ?? null,
      subscriptionPayment: payment_method === 'subscription',
    },
  });

  res.json({ success: true, data: updated });
});

// ============================================================================
// POST /api/orders/photo-print/:orderId/pay-with-subscription — онлайн-оплата кредитами подписки
// ============================================================================
router.post('/:orderId/pay-with-subscription', authenticateToken, idempotent(60), validate(payWithSubscriptionSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }
  const actorUser = req.user;

  const { orderId } = req.params;
  const { subscription_id } = req.body as PayWithSubscriptionInput;
  const transactionId = `subscription:${orderId}`;
  const paymentMethod = 'subscription';

  const { existing, updated, newStatus, subscriptionCoverage } = await db.transaction(async (client: PoolClient) => {
    const existingOrder = (await client.query<PhotoPrintSubscriptionPaymentOrderRow>(
      `SELECT id, payment_status, status, total_price, items, contact_phone
       FROM photo_print_orders
       WHERE order_id = $1
       FOR UPDATE`,
      [orderId],
    )).rows[0];

    if (!existingOrder) {
      throw new AppError(404, 'Order not found');
    }
    if (existingOrder.payment_status === 'paid') {
      throw new AppError(409, 'Order already paid');
    }
    if (['cancelled', 'refunded'].includes(existingOrder.payment_status ?? '') || existingOrder.status === 'cancelled') {
      throw new AppError(409, 'Order cannot be paid with subscription credits');
    }

    await assertOnlineSubscriptionPaymentOwnerWithClient(client, {
      subscriptionId: subscription_id,
      userId: actorUser.id,
      userPhone: actorUser.phone,
      orderPhone: existingOrder.contact_phone,
    });

    const coverageItems = await resolveSubscriptionCoverageItemsForPrintOrder(client, {
      orderId,
      items: existingOrder.items,
    });
    if (coverageItems.length === 0) {
      throw new AppError(400, 'Подписка не покрывает позиции этого заказа');
    }

    const coverage = await calculateSubscriptionCoverageWithClient(
      client,
      { subscription_id, items: coverageItems },
      { lock: true },
    );

    const orderTotal = Number(existingOrder.total_price ?? 0);
    if (coverage.total_covered_amount <= 0) {
      throw new AppError(400, 'Подписка не покрывает позиции этого заказа');
    }
    if (Math.abs(coverage.total_covered_amount - orderTotal) > 0.01) {
      throw new AppError(
        400,
        `Подписка покрывает ${coverage.total_covered_amount}₽ из ${orderTotal}₽`,
      );
    }

    const nextStatus = ['new', 'pending_payment'].includes(existingOrder.status ?? '')
      ? 'processing'
      : existingOrder.status ?? 'processing';

    const updatedOrder = (await client.query<PhotoPrintOrder>(
      `UPDATE photo_print_orders
       SET payment_status = 'paid',
           paid_at = NOW(),
           payment_id = $2,
           payment_amount = total_price,
           payment_mode = 'subscription',
           status = $3,
           updated_at = NOW()
       WHERE order_id = $1 AND payment_status IS DISTINCT FROM 'paid'
       RETURNING *`,
      [orderId, transactionId, nextStatus],
    )).rows[0];

    if (!updatedOrder) {
      throw new AppError(409, 'Order already paid');
    }

    for (const item of coverage.items) {
      if (item.covered_quantity <= 0 || !item.product_id) continue;
      await useCreditsWithClient(client, {
        subscription_id,
        product_id: item.product_id,
        quantity: item.covered_quantity,
        coverage_multiplier: item.coverage_multiplier,
        coverage_percent: item.coverage_percent,
        print_order_id: existingOrder.id,
        description: `Онлайн-заказ печати ${orderId}`,
      });
    }

    await client.query(
      `INSERT INTO payment_events (id, order_id, event_type, transaction_id, amount, card_info, metadata)
       VALUES (gen_random_uuid(), $1, 'payment_confirmed', $2, $3, NULL, $4)`,
      [
        orderId,
        transactionId,
        existingOrder.total_price,
        JSON.stringify({
          payment_method: paymentMethod,
          channel: 'online',
          subscription_id,
          subscription_coverage: {
            total_covered_amount: coverage.total_covered_amount,
            total_credits_consumed: coverage.total_credits_consumed,
            items: coverage.items,
          },
          recorded_by: actorUser.id,
        }),
      ],
    );

    return { existing: existingOrder, updated: updatedOrder, newStatus: nextStatus, subscriptionCoverage: coverage };
  });

  if (newStatus === 'processing' && existing.status !== 'processing') {
    db.query(
      `UPDATE work_tasks SET status = 'in_progress', updated_at = NOW()
       WHERE print_order_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [existing.id],
    ).catch(err => log.warn('work_task sync failed', { error: String(err) }));
  }

  recordStatusChange({
    orderId,
    oldStatus: existing.status ?? 'new',
    newStatus,
    changedBy: actorUser.id,
  }).catch(err => log.warn('recordStatusChange failed', { error: String(err) }));

  recalculateQueue()
    .then(() => updateEstimatedTimes())
    .catch(err => log.warn('recalculateQueue failed', { error: String(err) }));

  enqueueCrmEvent('order', orderId, 'order_paid', {
    sort_time: new Date().toISOString(),
    metadata: { payment_method: paymentMethod, channel: 'online', amount: existing.total_price, recorded_by: actorUser.id },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`order:${orderId}`).emit('order:payment-updated', {
      orderId,
      payment_status: 'paid',
      payment_method: paymentMethod,
      updated_at: new Date().toISOString(),
    });
  }

  if (updated.chat_session_id) {
    notifyChatOrderPaidService(
      updated.chat_session_id,
      updated,
      paymentMethod,
    ).catch(err => log.warn('notifyChatOrderPaidService failed', { error: String(err) }));
  }

  const serviceName = updated.service_type
    || (Array.isArray(updated.items) && updated.items.length > 0 ? updated.items[0].name : undefined)
    || 'Заказ';
  const postPaymentData: OrderPaymentData = {
    orderId,
    orderDbId: String(updated.id),
    amount: Number(existing.total_price ?? 0),
    paymentMethod,
    cardInfo: null,
    payerEmail: updated.contact_email ?? null,
    transactionId,
    contactName: updated.contact_name ?? null,
    contactPhone: updated.contact_phone ?? null,
    contactEmail: updated.contact_email ?? null,
    chatSessionId: updated.chat_session_id ?? null,
    isChatOrder: !!updated.chat_session_id,
    items: Array.isArray(updated.items) ? updated.items : [],
    serviceName,
    priority: updated.priority ?? 'normal',
    deliveryMethod: updated.delivery_method ?? null,
    deliveryAddress: updated.delivery_address ?? null,
    deliveryProvider: ((updated as unknown as Record<string, unknown>)['delivery_provider'] as string) || null,
    partnerPromoCode: updated.partner_promo_code ?? null,
    mode: updated.mode ?? null,
    totalPrice: Number(existing.total_price ?? 0),
    telegramUserId: updated.telegram_user_id ?? null,
    telegramUsername: updated.telegram_username ?? null,
    orderData: updated,
    token: null,
    cardFirstSix: null,
    cardLastFour: null,
    cardType: null,
    cardExpDate: null,
    receiptUrl: updated.receipt_url ?? null,
    createdAt: updated.created_at ? String(updated.created_at) : new Date().toISOString(),
  };
  enqueuePostPaymentJobs(postPaymentData)
    .catch(err => log.warn('enqueuePostPaymentJobs failed', { error: String(err) }));

  log.info('Online subscription payment recorded', {
    orderId,
    amount: existing.total_price,
    subscription_id,
    by: actorUser.id,
  });

  res.json({
    success: true,
    data: updated,
    subscription_coverage: {
      total_covered_amount: subscriptionCoverage.total_covered_amount,
      total_credits_consumed: subscriptionCoverage.total_credits_consumed,
      items: subscriptionCoverage.items,
    },
  });
});

/**
 * Отправляет бот-сообщение в чат клиенту при смене статуса заказа.
 */
async function notifyChatOrderStatus(
  sessionId: string,
  orderId: string,
  status: string,
  statusLabel: string,
  req: Request,
): Promise<void> {
  const statusMessages: Record<string, string> = {
    processing: `⏳ Ваш заказ **${orderId}** принят в работу! Мы сообщим, когда он будет готов.`,
    ready: `✅ Ваш заказ **${orderId}** готов! Вы можете забрать его в студии или отслеживать доставку.`,
    completed: `🎉 Заказ **${orderId}** выполнен! Спасибо, что выбрали нас. Ждём вас снова!`,
    cancelled: `❌ Заказ **${orderId}** отменён. Если у вас есть вопросы, напишите нам.`,
  };

  const text = statusMessages[status];
  if (!text) return;

  const interactive = status === 'ready' ? {
    type: 'buttons' as const,
    buttons: [
      { id: 'track_order', label: '📦 Отслеживать', icon: 'local_shipping', value: 'track_order', url: `https://svoefoto.ru/track/${orderId}`, color: '#667eea' },
    ],
  } : undefined;

  const metadata = interactive ? JSON.stringify({ interactive }) : null;

  const msgResult = await db.queryOne(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', $2, $3, $4)
     RETURNING *`,
    [sessionId, interactive ? 'interactive' : 'text', text, metadata],
  );

  // Отправляем через Socket.IO
  const socketServer = req.app.socketServer;

  if (socketServer && msgResult) {
    socketServer.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId,
      content: text,
      senderName: 'Своё Фото',
      senderType: 'bot',
      timestamp: msgResult.created_at,
      id: msgResult.id,
      messageType: interactive ? 'interactive' : 'text',
      interactive: interactive || null,
    });
  }

  // Отправляем в мессенджер, если клиент пришёл не через web-чат
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );

  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id && msgResult) {
    const { enqueueOutbound } = await import('../services/connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content: text,
      messageType: 'text',
      sourceMessageId: msgResult.id,
      conversationId: sessionId,
    });
  }
}

// ============================================================================
// POST /api/orders/photo-print/:orderId/remind — ручная отправка напоминания об оплате
// F109: Кнопка "Напомнить об оплате" из CRM order-detail-panel
// ============================================================================
router.post('/:orderId/remind', authenticateToken, requirePermission('pos:use'), validate(remindPaymentSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { orderId } = req.params;

  const order = await db.queryOne<Pick<PhotoPrintOrders, 'id' | 'payment_status' | 'chat_session_id' | 'reminder_sent_at' | 'payment_reminder_count' | 'total_price' | 'order_id'>>(
    `SELECT id, payment_status, chat_session_id, reminder_sent_at, payment_reminder_count, total_price, order_id
     FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (!order) {
    throw new AppError(404, 'Order not found');
  }

  if (order.payment_status === 'paid') {
    throw new AppError(409, 'Заказ уже оплачен');
  }

  if (!order.chat_session_id) {
    throw new AppError(400, 'У заказа нет привязанного чата — отправить напоминание невозможно');
  }

  // Rate limit: 1 hour cooldown
  if (order.reminder_sent_at) {
    const lastSent = new Date(order.reminder_sent_at).getTime();
    const cooldownMs = 60 * 60 * 1000; // 1 hour
    const remaining = cooldownMs - (Date.now() - lastSent);
    if (remaining > 0) {
      const minutesLeft = Math.ceil(remaining / 60_000);
      res.status(429).json({
        success: false,
        error: `Напоминание уже отправлено. Повторить через ${minutesLeft} мин.`,
        cooldownMinutes: minutesLeft,
      });
      return;
    }
  }

  const sessionId = order.chat_session_id;
  const paymentUrl = `https://svoefoto.ru/pay/${order.order_id}`;
  const amount = order.total_price ?? '0';
  const content = `Напоминаем об оплате заказа на ${amount}\u20BD. Ссылка: ${paymentUrl}`;

  // 1. Insert bot message
  await db.queryOne(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
     RETURNING id`,
    [sessionId, content],
  );

  // 2. Update conversation last_message
  await db.query(
    `UPDATE conversations
     SET last_message_content = $1, last_message_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [content, sessionId],
  );

  // 3. WebSocket emit
  const ss = req.app.socketServer;
  if (ss) {
    const msgPayload = {
      sessionId,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      timestamp: new Date(),
    };
    ss.getIO().to(`visitor:${sessionId}`).emit('operator:message', msgPayload);
    const { broadcastChatMessage } = await import('../services/chat-broadcast.service.js');
    await broadcastChatMessage({ sessionId, message: msgPayload });
  }

  // 4. Messenger outbound if not web channel
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );
  if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id) {
    const { enqueueOutbound } = await import('../services/connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      conversationId: sessionId,
    });
  }

  // 5. Update reminder tracking
  await db.query(
    `UPDATE photo_print_orders
     SET reminder_sent_at = NOW(),
         payment_reminder_count = payment_reminder_count + 1,
         payment_reminder_sent = true
     WHERE order_id = $1`,
    [orderId],
  );

  log.info('Manual payment reminder sent', {
    orderId,
    operatorId: req.user.id,
    reminderCount: (order.payment_reminder_count ?? 0) + 1,
    channel: conv?.channel ?? 'web',
  });

  res.json({
    success: true,
    message: 'Напоминание отправлено',
    reminder_sent_at: new Date().toISOString(),
  });
});

// ============================================================================
// POST /api/orders/photo-print/:orderId/mark-paid — отметить заказ как оплаченный
// F110: Кнопка "Оплачено наличными/переводом" из CRM order-detail-panel
// ============================================================================
router.post('/:orderId/mark-paid', authenticateToken, requirePermission('pos:use'), validate(markPaidSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const markPaidStartedAt = Date.now();
  const { orderId } = req.params;
  const { method, note } = req.body as MarkPaidInput;

  const existing = await db.queryOne<Pick<PhotoPrintOrders, 'id' | 'payment_status' | 'status' | 'total_price'>>(
    `SELECT id, payment_status, status, total_price FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (!existing) {
    throw new AppError(404, 'Order not found');
  }
  if (existing.payment_status === 'paid') {
    throw new AppError(409, 'Заказ уже оплачен');
  }

  const newStatus = ['new', 'pending_payment'].includes(existing.status ?? '') ? 'processing' : existing.status;

  const updated = await db.queryOne<PhotoPrintOrder>(
    `UPDATE photo_print_orders
     SET payment_status = 'paid',
         paid_at = NOW(),
         status = $2,
         updated_at = NOW()
     WHERE order_id = $1 AND payment_status != 'paid'
     RETURNING *`,
    [orderId, newStatus],
  );

  if (!updated) {
    throw new AppError(409, 'Заказ уже оплачен');
  }

  // Payment event audit trail
  db.query(
    `INSERT INTO payment_events (id, order_id, event_type, amount, metadata)
     VALUES (gen_random_uuid(), $1, 'mark_paid_external', $2, $3)`,
    [
      orderId,
      existing.total_price,
      JSON.stringify({ method, note: note || null, marked_by: req.user.id }),
    ],
  ).catch(err => log.warn('payment_event insert failed', { error: String(err) }));

  // Sync work task status
  if (newStatus === 'processing' && existing.status !== 'processing') {
    db.query(
      `UPDATE work_tasks SET status = 'in_progress', updated_at = NOW()
       WHERE print_order_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [existing.id],
    ).catch(err => log.warn('work_task sync failed', { error: String(err) }));
  }

  // CRM event
  enqueueCrmEvent('order', orderId, 'order_paid', {
    sort_time: new Date().toISOString(),
    metadata: { payment_method: method, amount: existing.total_price, marked_by: req.user.id, note },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  // WebSocket notification
  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`order:${orderId}`).emit('order:payment-updated', {
      orderId,
      payment_status: 'paid',
      payment_method: method,
      updated_at: new Date().toISOString(),
    });
  }

  if (updated.chat_session_id) {
    notifyChatOrderPaidService(
      updated.chat_session_id,
      updated,
      method,
    ).catch(err => log.warn('notifyChatOrderPaidService failed', { error: String(err) }));
  }

  if (method === 'cash') {
    enqueueCashDrawerForCurrentShift({
      userId: req.user.id,
      orderId,
      source: 'photo-print.mark-paid',
    });
  }

  log.info('Order marked as paid externally', {
    orderId,
    method,
    amount: existing.total_price,
    markedBy: req.user.id,
    note: note || null,
  });

  recordBusinessEvent({
    domain: 'payments',
    event: 'photo_print.mark_paid',
    outcome: 'success',
    severity: 'info',
    actorId: req.user.id,
    entityType: 'photo_print_order',
    entityId: String(updated.id),
    orderId,
    chatSessionId: updated.chat_session_id ?? null,
    durationMs: Date.now() - markPaidStartedAt,
    metadata: {
      paymentMethod: method,
      amount: Number(existing.total_price ?? 0),
      newStatus,
      noteProvided: !!note,
    },
  });

  res.json({ success: true, data: updated });
});

// ============================================================================
// POST /api/orders/photo-print/:orderId/cancel-payment — отменить pending платёж
// Останавливает напоминания, переводит заказ в cancelled
// ============================================================================
router.post('/:orderId/cancel-payment', authenticateToken, requirePermission('pos:use'), validate(cancelPaymentSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { orderId } = req.params;
  const { reason } = req.body as CancelPaymentInput;

  const existing = await db.queryOne<Pick<PhotoPrintOrders, 'id' | 'payment_status' | 'status' | 'total_price'>>(
    `SELECT id, payment_status, status, total_price FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (!existing) {
    throw new AppError(404, 'Order not found');
  }
  if (existing.payment_status === 'paid') {
    throw new AppError(409, 'Нельзя отменить уже оплаченный заказ');
  }
  if (existing.status === 'cancelled') {
    throw new AppError(409, 'Заказ уже отменён');
  }

  const updated = await db.queryOne<PhotoPrintOrders>(
    `UPDATE photo_print_orders
     SET payment_status = 'cancelled',
         status = 'cancelled',
         updated_at = NOW()
     WHERE order_id = $1 AND payment_status != 'paid' AND status != 'cancelled'
     RETURNING *`,
    [orderId],
  );

  if (!updated) {
    throw new AppError(409, 'Не удалось отменить заказ');
  }

  // Audit trail
  db.query(
    `INSERT INTO payment_events (id, order_id, event_type, amount, metadata)
     VALUES (gen_random_uuid(), $1, 'payment_cancelled', $2, $3)`,
    [
      orderId,
      existing.total_price,
      JSON.stringify({ reason: reason || null, cancelled_by: req.user.id }),
    ],
  ).catch(err => log.warn('payment_event insert failed', { error: String(err) }));

  syncChatPaymentCardStatus(orderId, 'cancelled')
    .catch(err => log.warn('chat payment card cancel sync failed', { error: String(err), orderId }));

  // CRM event
  enqueueCrmEvent('order', orderId, 'order_cancelled', {
    sort_time: new Date().toISOString(),
    metadata: { reason: reason || null, cancelled_by: req.user.id, amount: existing.total_price },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  // WebSocket notification
  const ss = req.app.socketServer;
  if (ss) {
    ss.getIO().to(`order:${orderId}`).emit('order:payment-updated', {
      orderId,
      payment_status: 'cancelled',
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    });
  }

  log.info('Order payment cancelled', {
    orderId,
    amount: existing.total_price,
    cancelledBy: req.user.id,
    reason: reason || null,
  });

  res.json({ success: true, data: updated });
});

export default router;
