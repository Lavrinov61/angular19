/**
 * post-payment-queue.service.ts — BullMQ queue for post-payment operations.
 *
 * Replaces 12 fire-and-forget .catch() calls in the /pay webhook.
 * Webhook now: UPDATE order → enqueue → return { code: 0 } in <50ms.
 * Worker processes jobs with retry (5 attempts, exponential backoff).
 *
 * Pattern copied from connectors/pipeline/outbound-worker.ts.
 */

import { Queue, Worker } from 'bullmq';
import type { Job, JobsOptions } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import { getRequestId, runWithRequestId } from '../middleware/request-context.js';
import db from '../database/db.js';
import {
  confirmPartnerReferral,
  findCustomerAndRecord,
  createCrmTask,
  scheduleReview,
  sendBridgeAttribution,
  automateOrderShipping,
  awardOrderPoints,
  sendPaymentEmailConfirmation,
  createPaymentPushNotification,
  saveCardToken,
  notifyChatOrderPaidService,
  getOrderUserId,
} from './payment.service.js';
import { enqueuePhotoProcessing } from './photo-worker-queue.js';
import type { PhotoPrintOrder } from '../types/views/print-order-views.js';
import type { StudioIdLookupRow } from '../types/views/studio-views.js';
import type { PaymentConversationVisitorRow } from '../types/views/payment-service-views.js';

const log = createLogger('post-payment-queue');

// ─── Type guards for deserialized BullMQ data ────────────────────────────────

interface QueueDataObject {
  [key: string]: unknown;
}

function isRecord(val: unknown): val is QueueDataObject {
  return typeof val === 'object' && val !== null;
}

interface PhotoProcessingItemPayload {
  uploadedUrl?: string;
  format: string;
  paperType: string;
  quantity: number;
  margins?: 'none' | '3mm';
  border?: string;
}

function toPhotoItem(item: unknown): PhotoProcessingItemPayload {
  if (!isRecord(item)) return { format: '', paperType: '', quantity: 1 };
  return {
    ...(typeof item['uploadedUrl'] === 'string' ? { uploadedUrl: item['uploadedUrl'] } : {}),
    format: typeof item['format'] === 'string' ? item['format'] : '',
    paperType: typeof item['paperType'] === 'string' ? item['paperType'] : '',
    quantity: typeof item['quantity'] === 'number' ? item['quantity'] : 1,
    ...((item['margins'] === 'none' || item['margins'] === '3mm') ? { margins: item['margins'] } : {}),
    ...(typeof item['border'] === 'string' ? { border: item['border'] } : {}),
  };
}

function toEmailItem(item: unknown): { service?: string; tariff?: string; document?: string; price?: number } {
  if (!isRecord(item)) return {};
  return {
    ...(typeof item['service'] === 'string' ? { service: item['service'] } : {}),
    ...(typeof item['tariff'] === 'string' ? { tariff: item['tariff'] } : {}),
    ...(typeof item['document'] === 'string' ? { document: item['document'] } : {}),
    ...(typeof item['price'] === 'number' ? { price: item['price'] } : {}),
  };
}

function normalizedString(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function isDocumentPrintItem(item: unknown): boolean {
  if (!isRecord(item)) return false;
  return normalizedString(item['type']) === 'document_print'
    || normalizedString(item['kind']) === 'document_print';
}

// ─── Redis connection (same as connectors/pipeline/outbound-worker.ts) ────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null, // BullMQ requirement
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrderPaymentData {
  orderId: string;
  orderDbId: string;
  amount: number;
  paymentMethod?: string | null;
  cardInfo: string | null;
  payerEmail: string | null;
  transactionId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  chatSessionId: string | null;
  isChatOrder: boolean;
  items: unknown[];
  serviceName: string;
  priority: string;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  /** Провайдер доставки ('yandex' для курьерской). Решает развилку в job 'shipping'. */
  deliveryProvider: string | null;
  partnerPromoCode: string | null;
  mode: string | null;
  totalPrice: number;
  telegramUserId: string | null;
  telegramUsername: string | null;
  orderData: PhotoPrintOrder;
  token: string | null;
  cardFirstSix: string | null;
  cardLastFour: string | null;
  cardType: string | null;
  cardExpDate: string | null;
  receiptUrl: string | null;
  createdAt: string;
  /** Distributed tracing: propagated from the originating HTTP request */
  _requestId?: string;
}

function isDocumentPrintOrder(data: OrderPaymentData): boolean {
  return normalizedString(data.orderData.service_type) === 'document_print'
    || normalizedString(data.serviceName) === 'document_print'
    || (Array.isArray(data.items) && data.items.some(isDocumentPrintItem));
}

// ─── Queue (always created — enqueue can happen from any node) ───────────────

const QUEUE_NAME = 'order-post-payment';
const queue = new Queue(QUEUE_NAME, { connection: { ...redisOpts } });

export function getPostPaymentQueue(): Queue {
  return queue;
}

// ─── CloudPayments Receipt API ──────────────────────────────────────────────

interface CpReceiptAdditionalData {
  OfdReceiptUrl?: string;
  ReceiptLocalUrl?: string;
}

interface CpReceiptResponse {
  Success: boolean;
  Model?: { AdditionalData?: CpReceiptAdditionalData };
}

/**
 * Fetch receipt URL from CloudPayments KKT API.
 * Verified endpoint: POST /kkt/receipt/get with {"Id": TransactionId}
 * Returns OfdReceiptUrl from AdditionalData, saves to DB as side-effect.
 */
async function fetchCloudPaymentsReceiptUrl(transactionId: string, orderId: string): Promise<string | null> {
  const { publicId, apiSecret } = config.cloudPayments;
  if (!publicId || !apiSecret) return null;

  const auth = Buffer.from(`${publicId}:${apiSecret}`).toString('base64');
  const response = await fetchWithCB(SERVICE_BREAKERS.cloudpayments, 'https://api.cloudpayments.ru/kkt/receipt/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ Id: transactionId }),
  });

  const data: CpReceiptResponse = await response.json();

  if (!data.Success || !data.Model?.AdditionalData) return null;

  const url = data.Model.AdditionalData.OfdReceiptUrl ?? data.Model.AdditionalData.ReceiptLocalUrl ?? null;
  if (url) {
    await db.query('UPDATE photo_print_orders SET receipt_url = $1 WHERE order_id = $2 AND receipt_url IS NULL', [url, orderId]);
    log.info('Receipt URL fetched from CloudPayments API', { orderId, url });
  }
  return url;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getItemName(item: unknown): string {
  if (typeof item === 'object' && item !== null && 'name' in item && typeof item.name === 'string') {
    return item.name;
  }
  return 'Заказ';
}

async function resolveStudioIdByDeliveryAddress(deliveryAddress: string | null): Promise<string | null> {
  const address = deliveryAddress?.trim();
  if (!address) return null;

  const studio = await db.queryOne<StudioIdLookupRow>(
    `SELECT id::text AS id
     FROM studios
     WHERE address = $1
     LIMIT 1`,
    [address],
  );

  return studio?.id ?? null;
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

const JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s, 40s, 80s
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export async function enqueuePostPaymentJobs(data: OrderPaymentData): Promise<void> {
  // Propagate requestId for distributed tracing
  const tracedData: OrderPaymentData = { ...data, _requestId: data._requestId ?? getRequestId() };
  const jobs: { name: string; data: OrderPaymentData; opts: typeof JOB_OPTS }[] = [];
  const isDocumentOrder = isDocumentPrintOrder(data);

  // Always
  jobs.push({ name: 'customer-stats', data: tracedData, opts: JOB_OPTS });
  jobs.push({ name: 'loyalty-points', data: tracedData, opts: JOB_OPTS });

  // Conditional on partner promo
  if (data.partnerPromoCode) {
    jobs.push({ name: 'partner-confirm', data: tracedData, opts: JOB_OPTS });
  }

  // Chat orders → notification, CRM task, review, attribution
  if (data.isChatOrder && data.chatSessionId) {
    jobs.push({ name: 'chat-notification', data: tracedData, opts: JOB_OPTS });
    jobs.push({ name: 'crm-task', data: tracedData, opts: JOB_OPTS });
    jobs.push({ name: 'review-schedule', data: tracedData, opts: JOB_OPTS });
    jobs.push({ name: 'attribution', data: tracedData, opts: JOB_OPTS });
  }

  // Print orders → photo processing
  if (!data.isChatOrder) {
    jobs.push({ name: 'crm-task', data: tracedData, opts: JOB_OPTS });
    if (!isDocumentOrder) {
      jobs.push({ name: 'photo-processing', data: tracedData, opts: JOB_OPTS });
    }
  }

  // Delivery → shipping automation
  if (data.deliveryAddress && data.deliveryMethod !== 'pickup') {
    jobs.push({ name: 'shipping', data: tracedData, opts: JOB_OPTS });
  }

  // Email confirmation — delay 30s to allow /receipt webhook to populate receipt_url
  if (data.payerEmail || data.contactEmail) {
    jobs.push({ name: 'email-confirmation', data: tracedData, opts: { ...JOB_OPTS, delay: 30_000 } });
  }

  // Push notification (worker will lookup userId)
  jobs.push({ name: 'push-notification', data: tracedData, opts: JOB_OPTS });

  // Card token saving
  if (data.token && data.cardFirstSix && data.cardLastFour) {
    jobs.push({ name: 'save-card', data: tracedData, opts: JOB_OPTS });
  }

  // Auto-create retouch task if order contains retouch services
  const hasRetouch = Array.isArray(data.items) && data.items.some((item: unknown) => {
    const name = (isRecord(item) && typeof item['name'] === 'string' ? item['name'] : '').toLowerCase();
    return name.includes('обработк') || name.includes('ретуш') || name.includes('чистка');
  });
  if (hasRetouch) {
    jobs.push({ name: 'auto-retouch-task', data: tracedData, opts: JOB_OPTS });
  }

  await queue.addBulk(jobs);
  log.info(`Enqueued ${jobs.length} post-payment jobs for ${data.orderId}`);
}

// ─── Worker (started only on leader node) ────────────────────────────────────

let worker: Worker | null = null;

export function startPostPaymentWorker(): void {
  log.info('Starting post-payment worker');

  worker = new Worker(QUEUE_NAME, async (job: Job<OrderPaymentData>) => {
    // Restore requestId from job data for distributed tracing
    return runWithRequestId(job.data._requestId, async () => {
    const d = job.data;

    switch (job.name) {
      case 'partner-confirm':
        await confirmPartnerReferral(d.orderId, 'print');
        break;

      case 'customer-stats':
        await findCustomerAndRecord(d.orderData, d.amount, d.chatSessionId);
        break;

      case 'chat-notification':
        if (d.chatSessionId) {
          await notifyChatOrderPaidService(d.chatSessionId, d.orderData, d.paymentMethod ?? 'online');
        }
        break;

      case 'crm-task':
        const isDocumentOrder = isDocumentPrintOrder(d);
        const studioId = d.deliveryMethod === 'pickup'
          ? await resolveStudioIdByDeliveryAddress(d.deliveryAddress)
          : null;
        const deliveryLine = d.deliveryMethod === 'pickup' && d.deliveryAddress
          ? `\nСамовывоз: ${d.deliveryAddress}`
          : '';
        await createCrmTask({
          orderId: d.orderId,
          orderDbId: d.orderDbId,
          contactName: d.contactName || 'Онлайн-клиент',
          contactPhone: d.contactPhone || undefined,
          chatSessionId: d.chatSessionId || undefined,
          serviceName: d.serviceName,
          amount: d.amount,
          cardInfo: d.cardInfo,
          priority: d.priority,
          studioId,
          clientChannel: d.isChatOrder ? 'chat' : 'website',
          taskType: isDocumentOrder ? 'document_print' : 'photo_print',
          description: isDocumentOrder
            ? `Заказ ${d.orderId}, оплата ${d.amount}₽ (${d.cardInfo || 'онлайн'}). Распечатать документы и подготовить выдачу.${deliveryLine}`
            : `Заказ ${d.orderId}, оплата ${d.amount}₽ (${d.cardInfo || 'онлайн'}). Напечатать фото и подготовить выдачу.${deliveryLine}`,
        });
        break;

      case 'review-schedule':
        await scheduleReview({
          orderId: d.orderId,
          clientName: d.contactName || '',
          clientPhone: d.contactPhone,
          clientEmail: d.payerEmail || d.contactEmail,
        });
        break;

      case 'attribution': {
        let fpId: string | undefined;
        if (d.chatSessionId) {
          const chatSession = await db.queryOne<PaymentConversationVisitorRow>(
            'SELECT visitor_id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
            [d.chatSessionId],
          );
          fpId = chatSession?.visitor_id ?? undefined;
        }
        const chatServices = Array.isArray(d.items)
          ? d.items.map(i => getItemName(i)).filter(Boolean)
          : ['Заказ из чата'];
        await sendBridgeAttribution({
          amount: d.amount,
          fingerprintVisitorId: fpId,
          phone: d.contactPhone || undefined,
          email: d.payerEmail || d.contactEmail || undefined,
          sourceId: d.orderId,
          services: chatServices,
        });
        break;
      }

      case 'photo-processing': {
        // Delegate to dedicated photo-worker process (Stage 8)
        await enqueuePhotoProcessing({
          orderId: d.orderId,
          mode: d.mode === 'custom' ? 'custom' : 'simple',
          items: d.items.map(toPhotoItem),
          contact: {
            name: d.contactName || '',
            phone: d.contactPhone || '',
            email: d.contactEmail || undefined,
          },
          totalPrice: d.totalPrice,
          telegramUserId: d.telegramUserId || undefined,
          telegramUsername: d.telegramUsername || undefined,
        });
        break;
      }

      case 'shipping':
        // Развилка по провайдеру: Яндекс.Доставка (курьер) vs Почта России (legacy).
        if (d.deliveryProvider === 'yandex') {
          // Авто-claim ОТКЛЮЧЁН: курьера вызывает оператор кнопкой на доске доставки
          // только когда печать готова (`status='ready'`) — иначе курьер приезжал бы
          // до готовности заказа. Ручной путь: POST /api/delivery/shipments/:id/dispatch.
        } else {
          await automateOrderShipping(d.orderId);
        }
        break;

      case 'loyalty-points':
        await awardOrderPoints(d.orderId, d.amount);
        break;

      case 'email-confirmation': {
        const email = d.payerEmail || d.contactEmail;
        if (email) {
          let receiptUrl = d.receiptUrl;

          // 1) Check DB — /receipt webhook may have populated it
          if (!receiptUrl) {
            try {
              const fresh = await db.queryOne<Pick<PhotoPrintOrder, 'receipt_url'>>(
                'SELECT receipt_url FROM photo_print_orders WHERE order_id = $1',
                [d.orderId],
              );
              if (fresh?.receipt_url) receiptUrl = fresh.receipt_url;
            } catch (error: unknown) {
              log.warn('DB receipt_url lookup failed', {
                orderId: d.orderId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // 2) Fallback: fetch receipt URL from CloudPayments API
          if (!receiptUrl && d.transactionId) {
            try {
              receiptUrl = await fetchCloudPaymentsReceiptUrl(d.transactionId, d.orderId);
            } catch (error: unknown) {
              log.warn('CloudPayments receipt API lookup failed', {
                orderId: d.orderId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          await sendPaymentEmailConfirmation(email, {
            order_id: d.orderId,
            contact_name: d.contactName,
            total_price: d.amount,
            items: Array.isArray(d.items) ? d.items.map(toEmailItem) : [],
            created_at: d.createdAt,
            receipt_url: receiptUrl,
          });
        }
        break;
      }

      case 'push-notification': {
        const userId = await getOrderUserId(d.orderId);
        if (userId) {
          await createPaymentPushNotification(userId, d.orderId, d.amount);
        }
        break;
      }

      case 'save-card': {
        if (!d.token || !d.cardFirstSix || !d.cardLastFour) break;
        const userId = await getOrderUserId(d.orderId);
        if (userId) {
          await saveCardToken(
            userId, d.token, d.cardFirstSix, d.cardLastFour,
            d.cardType || undefined, d.cardExpDate || undefined,
          );
        }
        break;
      }

      case 'auto-retouch-task': {
        const { createRetouchTaskFromPayment } = await import('./retouch.service.js');
        await createRetouchTaskFromPayment({
          orderId: d.orderId,
          orderDbId: d.orderDbId,
          contactName: d.contactName,
          contactPhone: d.contactPhone,
          chatSessionId: d.chatSessionId,
          items: d.items,
          priority: d.priority,
        });
        break;
      }

      default:
        log.warn(`Unknown job name: ${job.name}`);
    }
    }); // end runWithRequestId
  }, {
    connection: { ...redisOpts },
    concurrency: parseInt(process.env['BULLMQ_CONCURRENCY'] || '25', 10),
  });

  worker.on('failed', (job: Job<OrderPaymentData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts || 5;
    if (job.attemptsMade >= maxAttempts) {
      captureException(err, {
        tags: { worker: 'post-payment', job: job.name },
        extra: { orderId: job.data.orderId, attempts: job.attemptsMade },
        level: 'error',
      });
      log.error(`Dead letter: ${job.name} for ${job.data.orderId}`, {
        error: err.message,
        attempts: job.attemptsMade,
        orderId: job.data.orderId,
      });
    }
  });

  worker.on('error', (err: Error) => {
    captureException(err, { tags: { worker: 'post-payment' }, level: 'error' });
    log.error('Worker error', { error: err.message });
  });
}

export async function stopPostPaymentWorker(): Promise<void> {
  if (worker) {
    log.info('Stopping post-payment worker');
    await worker.close();
    worker = null;
  }
}
