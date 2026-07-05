/**
 * chat-order.service.ts — Order processing for the visitor chat system.
 * Extracted from visitor-chat.routes.ts (lines 2142-2663, 5280-5318).
 *
 * Handles: order number generation, order finalization, payment processing,
 * photo archiving, and delivery descriptions.
 */

import fs from 'fs';
import axios from 'axios';
import { pool } from '../../database/db.js';
import { processPhotosForPrint, archiveOriginalPhotos, formatFileSize } from '../../services/photo-processor.service.js';
import { findOrCreateCustomer } from '../../services/customer.service.js';
import { config } from '../../config/index.js';
import { buildWidgetPaymentButton, formatServiceDescription } from './chat-pricing.helpers.js';
import type { BotButton, BotMessageResult, DeliveryInfo } from './chat-shared.js';
import { safePath } from './chat-shared.js';
import { getCategoryBySlug } from '../../services/pricing-engine.service.js';
import { storageService } from '../../services/storage.service.js';
import { toErrorMessage } from '../../utils/error-helpers.js';
import { computeOrderSlaMinutes } from '../../services/sla.service.js';
import { recordBusinessEvent } from '../../services/business-observability.service.js';
import { captureOrderServiceAttribution } from '../../services/service-attribution-forward.js';
import type Messages from '../../types/generated/public/Messages.js';
import type PhotoPrintOrders from '../../types/generated/public/PhotoPrintOrders.js';

import { createLogger } from '../../utils/logger.js';

/** Computed ARRAY expression from messages.metadata->'gallery' — no Kanel type exists */
interface MessageGalleryUrls {
  gallery_urls: string[] | null;
}

/**
 * Messages table has attachment_url (VARCHAR 500) but the Kanel type is stale.
 * Use Pick<Messages, 'id'> & the missing column until Kanel is regenerated.
 */
interface MessageWithAttachmentUrl extends Pick<Messages, 'id'> {
  attachment_url: string;
}

interface PerPhotoCopiesMap {
  [photoId: string]: number;
}

interface SelectedOptionsMap {
  [groupSlug: string]: unknown;
}

interface ChatOrderData {
  delivery_method?: string;
  channel?: string;
  categorySlug?: string;
  price?: number;
  tariff?: string;
  service?: string;
  photoCount?: number;
  firstPrice?: number;
  nextPrice?: number;
  size?: string;
  copies?: number;
  printType?: string;
  borders?: string;
  perPhotoCopies?: PerPhotoCopiesMap;
  printAddon?: boolean;
  deliveryAddress?: string;
  deliveryCost?: number;
  deliveryPostalCode?: string;
  document?: string;
  selectedOptions?: SelectedOptionsMap;
}

interface ConversationOrderMetadata {
  pendingOrder?: ChatOrderData;
  pendingDelivery?: DeliveryInfo;
  phoneAsked?: boolean;
  printAddon?: boolean;
  printPrice?: number;
  deliveryAddress?: string;
  preCreatedOrderNumber?: number;
}

interface ConversationOrderMetadataRow {
  metadata: ConversationOrderMetadata | null;
  visitor_phone: string | null;
}

function hasSelectedOptions(data: ChatOrderData): boolean {
  const selectedOptions = data.selectedOptions;
  if (!selectedOptions || typeof selectedOptions !== 'object') return false;
  return Object.values(selectedOptions).some(value => Array.isArray(value) && value.length > 0);
}

const logger = createLogger('chat-order.service');
async function resolveProcessingTimeLabel(categorySlug: string | null, data: ChatOrderData): Promise<string | null> {
  if (!categorySlug) return null;

  const category = await getCategoryBySlug(categorySlug);
  if (!category) return null;

  const selectedOptions = data.selectedOptions;
  const speedSelected = selectedOptions && Array.isArray(selectedOptions.speed)
    ? selectedOptions.speed.find((value): value is string => typeof value === 'string')
    : undefined;

  if (speedSelected) {
    const speedGroup = category.optionGroups.find(group => group.slug === 'speed');
    const speedOption = speedGroup?.options.find(option => option.slug === speedSelected);
    if (speedOption?.processing_time?.trim()) return speedOption.processing_time.trim();

    const fromName = speedOption?.name.match(/\(([^)]+)\)/)?.[1]?.trim();
    if (fromName) return fromName;
  }

  if (category.processing_time?.trim()) return category.processing_time.trim();
  return null;
}

// ============================================================================
// Определение ближайшей точки производства по адресу
// ============================================================================

/** Координаты студий */
const STUDIOS = {
  soborny: { lat: 47.219706, lng: 39.7107641, label: 'Соборный 21' },
};

/**
 * Определяет ближайшую точку производства по тексту адреса.
 * Если адрес содержит ключевые слова — используем их.
 * Иначе — по умолчанию Соборный 21 (центр города).
 */
export function findNearestProduction(address: string): string {
  const lower = address.toLowerCase();

  // Простая эвристика по ключевым словам района
  const sobornyKeywords = [
    'соборн', 'будённ', 'большая садов', 'пушкинск', 'газетн', 'ворошилов',
    'красноармейск', 'центр', 'театральн', 'кировск', 'суворов',
    'московск', 'береговая', 'набережн',
  ];

  const sobScore = sobornyKeywords.filter(kw => lower.includes(kw)).length;

  if (sobScore > 0) return STUDIOS.soborny.label;

  // По умолчанию — Соборный 21 (центр города)
  return STUDIOS.soborny.label;
}

// ============================================================================
// Генерация номера заказа
// ============================================================================

export async function generateOrderNumber(_sessionId: string): Promise<number> {
  // Атомарная генерация номера через PostgreSQL sequence (без race condition)
  // Sequence создаётся при первом вызове, начинается с 1001
  await pool.query(
    `DO $$ BEGIN
       CREATE SEQUENCE IF NOT EXISTS chat_order_number_seq START WITH 1001;
     EXCEPTION WHEN duplicate_table THEN NULL;
     END $$`
  );
  const result = await pool.query(`SELECT nextval('chat_order_number_seq') as num`);
  return parseInt(result.rows[0].num, 10);
}

// ============================================================================
// Финализация заказа: после выбора точки получения
// ============================================================================

export async function handleFinalizeOrder(
  sessionId: string,
  delivery: DeliveryInfo,
  preloaded?: { metadata?: ConversationOrderMetadata; visitor_phone?: string | null }
): Promise<BotMessageResult> {
  // Используем preloaded данные если переданы, иначе запрашиваем из БД
  let metadata: ConversationOrderMetadata;
  let visitorPhone: string | null;
  if (preloaded) {
    metadata = preloaded.metadata || {};
    visitorPhone = preloaded.visitor_phone ?? null;
  } else {
    const metaRes = await pool.query<ConversationOrderMetadataRow>(
      `SELECT metadata, visitor_phone FROM conversations WHERE id = $1`,
      [sessionId]
    );
    metadata = metaRes.rows[0]?.metadata || {};
    visitorPhone = metaRes.rows[0]?.visitor_phone || null;
  }
  const pendingOrder = metadata.pendingOrder;

  if (!pendingOrder) {
    return {
      content: '⚠️ Данные заказа не найдены. Пожалуйста, начните оформление заново.',
      interactive: {
        type: 'buttons',
        step: 'order_error',
        buttons: [
          { id: 'back_menu', label: '◀ В меню', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
        ],
      },
    };
  }

  // Шаг сбора телефона: если телефон отсутствует и ещё не спрашивали
  if (!visitorPhone && !metadata.phoneAsked) {
    // Сохраняем delivery для продолжения после ввода/пропуска телефона
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ pendingDelivery: delivery }), sessionId]
    );
    return {
      content: '📱 Укажите номер телефона — мы свяжемся, если возникнут вопросы по заказу.\n\nНапишите номер в формате `+7XXXXXXXXXX` или `8XXXXXXXXXX`:',
      interactive: {
        type: 'buttons',
        step: 'ask_phone',
        buttons: [
          { id: 'skip_phone', label: '⏩ Пропустить', icon: 'skip_next', value: 'skip_phone', color: '#a8a8a8' },
          { id: 'back_to_order_confirmed', label: '◀ Назад к заказу', icon: 'arrow_back', value: 'back_to_order_confirmed', color: '#a8a8a8' },
        ],
      },
    };
  }

  // Если выбран печатный вид — добавляем +200₽ к цене
  if (metadata.printAddon && metadata.printPrice) {
    pendingOrder.price = (pendingOrder.price || 0) + metadata.printPrice;
    pendingOrder.printAddon = true;
    pendingOrder.deliveryAddress = delivery.deliveryAddress || metadata.deliveryAddress;
  }

  // Если есть стоимость доставки — добавляем к цене
  if (delivery.deliveryCost && delivery.deliveryCost > 0) {
    pendingOrder.price = (pendingOrder.price || 0) + delivery.deliveryCost;
    pendingOrder.deliveryCost = delivery.deliveryCost;
    pendingOrder.deliveryPostalCode = delivery.deliveryPostalCode;
  }

  // Используем ранее сгенерированный номер (из submit-order-bundle) или создаём новый
  const orderNumber = metadata.preCreatedOrderNumber || await generateOrderNumber(sessionId);

  // Сохраняем данные доставки и номер заказа, очищаем preCreatedOrderNumber
  await pool.query(
    `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify({
      delivery,
      orderNumber,
      deliveryStep: 'completed',
      preCreatedOrderNumber: null,
    }), sessionId]
  );

  // Вызываем основную обработку заказа
  const result = await handlePayOrderInternal(sessionId, pendingOrder, delivery, orderNumber);

  return result;
}

/**
 * Нормализация телефона: принимает разные форматы → возвращает +7XXXXXXXXXX или null.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) return '+7' + digits;
  return null;
}

/**
 * Продолжить к оплате после ввода/пропуска телефона.
 * Загружает pendingDelivery из metadata и вызывает handleFinalizeOrder.
 */
export async function proceedAfterPhone(sessionId: string): Promise<BotMessageResult> {
  const metaRes = await pool.query<ConversationOrderMetadataRow>(
    `SELECT metadata, visitor_phone FROM conversations WHERE id = $1`,
    [sessionId]
  );
  const metadata = metaRes.rows[0]?.metadata || {};
  const visitorPhone = metaRes.rows[0]?.visitor_phone || null;
  const delivery = metadata.pendingDelivery || { pickup: 'Не указано', production: 'Онлайн' };

  // Передаём preloaded данные — избегаем повторного SELECT в handleFinalizeOrder
  return handleFinalizeOrder(sessionId, delivery, { metadata, visitor_phone: visitorPhone });
}

// ============================================================================
// Определение приоритета заказа по тарифу
// ============================================================================

export function getOrderPriority(tariff: string): 'normal' | 'urgent' | 'vip' {
  const t = (tariff || '').toLowerCase();
  if (t.includes('vip') || t.includes('вип')) return 'vip';
  if (t.includes('срочн') || t.includes('urgent')) return 'urgent';
  return 'normal';
}

/** Fallback: вычисляет дедлайн по тарифу (если нет selectedOptions) */
function getDeadlineMinutesFallback(tariff: string): number {
  const t = (tariff || '').toLowerCase();
  if (t.includes('экспресс') || t.includes('срочн')) return 15;
  if (t.includes('vip') || t.includes('вип')) return 30;
  return 30;
}

// ============================================================================
// Обработка оплаты: обработка фото + создание архива
// ============================================================================

export async function handlePayOrderInternal(
  sessionId: string,
  buttonData: ChatOrderData | undefined,
  delivery: DeliveryInfo,
  orderNumber: number
): Promise<BotMessageResult> {
  const data = buttonData || {};
  const rawDelivery = data.delivery_method;
  const rawChannel = data.channel;
  const deliveryMethod = rawDelivery || (rawChannel === 'studio' ? 'pickup' : 'electronic');
  const categorySlug = data.categorySlug || null;
  const price = data.price || 0;
  const tariff = data.tariff || '';
  const service = data.service || tariff;
  const displayService = formatServiceDescription(tariff || service);
  const photoCountData = data.photoCount || 1;
  const fpData = data.firstPrice || price;
  const npData = data.nextPrice || price;
  const optionBasedOrder = hasSelectedOptions(data);
  const priceBreakdown = optionBasedOrder
    ? ''
    : photoCountData > 1
    ? (fpData < npData
        ? ` (${fpData}₽ + ${npData}₽ × ${photoCountData - 1})`
        : ` (${fpData}₽ × ${photoCountData})`)
    : '';
  const printSize = data.size;
  const copies = data.copies || 1;
  const printType = data.printType;
  const borders = data.borders;
  const perPhotoCopies = data.perPhotoCopies;
  const printAddon = data.printAddon;
  const deliveryAddress = data.deliveryAddress;
  const deliveryCostValue = data.deliveryCost || 0;
  const deliveryPostalCode = data.deliveryPostalCode || null;

  // Получаем visitor_id и visitor_name из сессии
  const sessionInfo = await pool.query(
    `SELECT visitor_id, visitor_name, visitor_phone FROM conversations WHERE id = $1`,
    [sessionId]
  );
  const visitorId = sessionInfo.rows[0]?.visitor_id || '';
  const visitorName = sessionInfo.rows[0]?.visitor_name || 'Посетитель';
  const visitorPhone = sessionInfo.rows[0]?.visitor_phone || null;

  // Создаём/находим клиента в единой таблице customers
  let customerId: string | null = null;
  try {
    const customer = await findOrCreateCustomer({
      visitorId,
      phone: visitorPhone,
      name: visitorName !== 'Посетитель' ? visitorName : undefined,
    });
    customerId = customer.id;
  } catch (err: unknown) {
    logger.error('[PayOrder] Failed to find/create customer:', { error: toErrorMessage(err) });
  }

  // Базовый URL для формирования абсолютных ссылок на архивы
  const baseUrl = process.env['PUBLIC_URL'] || 'https://svoefoto.ru';

  // Создаём запись заказа в БД — нужна для CloudPayments /check webhook
  const orderId = `chat-${sessionId}-${orderNumber}`;
  const document = data.document || '';
  try {
    await pool.query(
      `INSERT INTO photo_print_orders
        (order_id, mode, total_price, status, payment_status, contact_name, contact_phone, comments, items, chat_session_id, delivery_cost, delivery_address, delivery_postal_code, priority, service_type, customer_id, delivery_method)
       VALUES ($1, 'custom', $2, 'pending_payment', 'pending', $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (order_id) DO UPDATE SET
         total_price = EXCLUDED.total_price,
         status = 'pending_payment',
         payment_status = 'pending',
         comments = EXCLUDED.comments,
         items = EXCLUDED.items,
         delivery_cost = EXCLUDED.delivery_cost,
         delivery_address = EXCLUDED.delivery_address,
         delivery_postal_code = EXCLUDED.delivery_postal_code,
         priority = EXCLUDED.priority,
         service_type = EXCLUDED.service_type,
         customer_id = EXCLUDED.customer_id,
         delivery_method = EXCLUDED.delivery_method`,
      [
        orderId,
        price,
        visitorName || null,
        visitorPhone, // contact_phone из conversations
        JSON.stringify({ sessionId, delivery_method: deliveryMethod, tariff, document, delivery, printAddon, deliveryAddress }),
        JSON.stringify([{ service: displayService, tariff, price, document, ...(printAddon ? { printAddon: true, deliveryAddress } : {}) }]),
        sessionId,
        deliveryCostValue,
        deliveryAddress || null,
        deliveryPostalCode,
        getOrderPriority(tariff),
        tariff || null, // service_type
        customerId,     // customer_id
        deliveryMethod, // $14 — delivery_method (electronic / pickup / postal)
      ]
    );
    recordBusinessEvent({
      domain: 'chat',
      event: 'order.created',
      outcome: 'success',
      severity: 'info',
      entityType: 'photo_print_order',
      entityId: orderId,
      orderId,
      chatSessionId: sessionId,
      metadata: {
        source: 'visitor_chat',
        deliveryMethod,
        totalPrice: price,
        categorySlug,
        optionBasedOrder,
        service: displayService,
      },
    });

    // FC-1 (slice S5): forward-capture услуги chat-заказа (best-effort, вне ответа).
    // Резолвим внутренний UUID по текстовому order_id и делегируем единой точке;
    // selected_service/telegram_user_id проставляются внутри по chat_session_id.
    void pool
      .query<Pick<PhotoPrintOrders, 'id'>>(`SELECT id FROM photo_print_orders WHERE order_id = $1`, [orderId])
      .then(async ({ rows }) => {
        if (rows[0]) await captureOrderServiceAttribution(rows[0].id, sessionId);
      })
      .catch((attrErr: unknown) =>
        logger.error('[PayOrder] forward-capture attribution failed', { error: toErrorMessage(attrErr) }),
      );
  } catch (err: unknown) {
    logger.error('[PayOrder] Failed to create order record:', { error: toErrorMessage(err) });
    recordBusinessEvent({
      domain: 'chat',
      event: 'order.create_failed',
      outcome: 'failure',
      severity: 'critical',
      entityType: 'photo_print_order',
      entityId: orderId,
      orderId,
      chatSessionId: sessionId,
      error: err,
      metadata: {
        source: 'visitor_chat',
        deliveryMethod,
        totalPrice: price,
        categorySlug,
        optionBasedOrder,
      },
      alert: {
        key: `chat_order_create_failed:${orderId}`,
        title: 'Chat order create failed',
      },
    });
  }

  // Проставляем estimated_ready_at: SLA из выбранных опций или fallback по тарифу
  const selectedOptions = Object.fromEntries(
    Object.entries(data.selectedOptions || {}).filter((entry): entry is [string, string[]] => (
      Array.isArray(entry[1]) && entry[1].every(value => typeof value === 'string')
    )),
  );
  const slaCategory = categorySlug || 'photo-docs';
  const deadlineMinutesPromise = Object.keys(selectedOptions).length > 0
    ? computeOrderSlaMinutes(slaCategory, selectedOptions)
    : Promise.resolve(getDeadlineMinutesFallback(tariff));

  deadlineMinutesPromise.then(deadlineMinutes => {
    if (deadlineMinutes > 0) {
      const chatOrderDeadline = new Date(Date.now() + deadlineMinutes * 60_000);
      pool.query(
        `UPDATE photo_print_orders SET estimated_ready_at = created_at + $2 * interval '1 minute'
         WHERE order_id = $1 AND estimated_ready_at IS NULL`,
        [orderId, deadlineMinutes],
      ).catch(err => logger.error('[PayOrder] Failed to set estimated_ready_at', { error: String(err) }));

      // Sync sla_deadline in work_tasks
      pool.query(
        `UPDATE work_tasks SET sla_deadline = $2, due_date = $2
         WHERE print_order_id = (SELECT id FROM photo_print_orders WHERE order_id = $1)
           AND status NOT IN ('completed', 'cancelled')`,
        [orderId, chatOrderDeadline],
      ).catch(err => logger.error('[PayOrder] Failed to sync sla_deadline', { error: String(err) }));
    }
  }).catch(err => logger.error('[PayOrder] Failed to compute SLA', { error: String(err) }));

  // Трекинг создания заказа для воронки продаж (fire-and-forget)
  axios.post(`${config.bridge.url}/api/bridge/track-order-event`, {
    event_type: 'order_created',
    order_id: orderId,
    order_source: 'chat_order',
    amount: price,
    fingerprint_visitor_id: visitorId || undefined,
    services: [displayService],
  }, { timeout: 10_000 }).catch((err: unknown) => logger.error('[Funnel] track-order-event error', { error: toErrorMessage(err) }));

  // Определяем, нужна ли обработка фото (resize/crop)
  // Обработка ТОЛЬКО для заказов печати фотографий с указанным размером
  // НЕ обрабатываем: фото на документы, ретушь, реставрацию, дизайн, холст
  const needsPhotoProcessing = !!printSize && deliveryMethod === 'pickup';

  // Получаем загруженные фото из сессии — только те, что загружены после последнего оплаченного заказа
  // (чтобы не смешивать фото разных заказов в одной сессии)
  const lastPaidOrder = await pool.query(
    `SELECT paid_at FROM photo_print_orders
     WHERE chat_session_id = $1 AND status IN ('processing', 'ready', 'completed')
     ORDER BY paid_at DESC NULLS LAST LIMIT 1`,
    [sessionId],
  );
  const afterDate = lastPaidOrder.rows[0]?.paid_at || null;

  let photosRows: MessageWithAttachmentUrl[] = [];

  if (optionBasedOrder) {
    const latestBundle = await pool.query<MessageGalleryUrls>(
      `SELECT ARRAY(
          SELECT jsonb_array_elements_text(metadata->'gallery')
        ) AS gallery_urls
       FROM messages
       WHERE conversation_id = $1
         AND sender_type = 'visitor'
         AND message_type = 'text'
         AND metadata->>'source' = 'bundle_submit'
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId],
    );

    const galleryUrls = latestBundle.rows[0]?.gallery_urls || [];
    if (galleryUrls.length > 0) {
      const rowsByUrls = await pool.query<MessageWithAttachmentUrl>(
        `SELECT id, attachment_url
         FROM messages
         WHERE conversation_id = $1
           AND sender_type = 'visitor'
           AND message_type = 'image'
           AND attachment_url = ANY($2::text[])
         ORDER BY created_at ASC`,
        [sessionId, galleryUrls],
      );
      photosRows = rowsByUrls.rows;
    }
  }

  if (photosRows.length === 0) {
    const photosResult = await pool.query<MessageWithAttachmentUrl>(
      `SELECT id, attachment_url FROM messages
       WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor'
         AND ($2::timestamptz IS NULL OR created_at > $2)
       ORDER BY created_at ASC`,
      [sessionId, afterDate]
    );
    photosRows = photosResult.rows;
  }

  // Конвертируем URL → абсолютные пути к файлам + маппинг path → messageId
  // Поддерживаем как локальные /uploads/chat/... так и S3 URL
  const pathToMessageId: Record<string, string> = {};
  const resolvedPaths = await Promise.all(
    photosRows.map(async (row) => {
      const url = row.attachment_url as string;
      if (!url) return null;
      if (storageService.isS3Url(url)) {
        const key = storageService.keyFromUrl(url);
        if (!key) return null;
        try {
          const localPath = await storageService.downloadToTemp(key);
          pathToMessageId[localPath] = row.id;
          return localPath;
        } catch (err: unknown) {
          logger.error(`[chat-order] Failed to download S3 file ${key}:`, { error: toErrorMessage(err) });
          return null;
        }
      }
      const absPath = safePath(url);
      if (!absPath) return null;
      pathToMessageId[absPath] = row.id;
      return absPath;
    })
  );
  const sourcePaths = resolvedPaths.filter((p): p is string => p !== null && fs.existsSync(p));

  // ---------- Заказ на ПЕЧАТЬ фотографий (с обработкой размера) ----------
  if (needsPhotoProcessing) {
    if (sourcePaths.length === 0) {
      return {
        content: `✅ **Заказ принят!** — **${price}₽**\n\n📋 ${service}\n\n⚠️ Фотографии не найдены. Загрузите фото — мы обработаем заказ автоматически.`,
        interactive: {
          type: 'buttons',
          step: 'pay_order_no_photos',
          buttons: [
            { id: 'upload_photos', label: '📷 Загрузить фото', icon: 'add_photo_alternate', value: 'studio_upload_more', color: '#4facfe' },
            { id: 'back_menu', label: '◀ В меню', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ],
        },
      };
    }

    try {
      const result = await processPhotosForPrint({
        size: printSize,
        copies,
        sourcePaths,
        sessionId,
        printType,
        borders,
        perPhotoCopies,
        pathToMessageId,
        orderNumber,
      });

      const archiveSize = formatFileSize(result.archiveSize);
      const lay = result.details.layout;

      // Формируем описание обработки
      let processingDesc: string;

      if (lay) {
        // Раскладка: несколько фото на одном листе
        processingDesc = [
          `📦 **Фото подготовлены для печати:**`,
          `• Размер фото: **${printSize} см**`,
          `• Раскладка: **${lay.cols}×${lay.rows}** (${lay.photosPerSheet} фото на листе **${lay.sheetCm} см**)`,
          `• Листов к печати: **${lay.sheetsTotal}** шт.`,
          `• 300 DPI, JPEG 95%`,
          `• Архив: **${archiveSize}**`,
        ].join('\n');
      } else {
        processingDesc = [
          `📦 **Фото подготовлены для печати:**`,
          `• Размер: **${printSize} см** (${result.details.targetWidthPx}×${result.details.targetHeightPx} px)`,
          `• 300 DPI, без обрезки`,
          `• Файлов: **${result.totalFiles}**`,
          `• Архив: **${archiveSize}**`,
        ].join('\n');
      }

      // Формируем строки для доставки
      const deliveryLines = buildDeliveryDescription(delivery, orderNumber);
      const archiveFullUrl = `${baseUrl}${result.archiveUrl}`;

      const paidProcessedButtons: BotButton[] = [
        {
          id: 'download_archive',
          label: `📥 Скачать архив (${archiveSize})`,
          icon: 'download',
          value: 'download_archive',
          url: result.archiveUrl,
          color: '#22c55e',
          visibleTo: 'operator',
        },
      ];
      paidProcessedButtons.push(buildWidgetPaymentButton(orderId, price, `Заказ №${orderNumber}: ${displayService}`));
      paidProcessedButtons.push({ id: 'order_more', label: '📷 Новый заказ', icon: 'add_photo_alternate', value: 'studio_main_menu', color: '#4facfe' });

      return {
        content: `✅ **Заказ №${orderNumber} оформлен!** — **${price}₽**${priceBreakdown}\n\n📋 ${displayService}\n\n${processingDesc}\n\n${deliveryLines}\n\n⏱ Сотрудник подготовит заказ!`,
        interactive: {
          type: 'buttons',
          step: 'order_paid_processed',
          buttons: paidProcessedButtons,
        },
      };
    } catch (err: unknown) {
      logger.error('[PayOrder] Photo processing error:', { error: toErrorMessage(err) });

      // Автообработка не удалась — отправляем оригиналы оператору
      try {
        await archiveOriginalPhotos(sourcePaths, sessionId, { service, tariff, price }, orderNumber);
      } catch (archErr: unknown) {
        logger.error('[PayOrder] Fallback archive also failed:', { error: toErrorMessage(archErr) });
      }

      const deliveryLines = buildDeliveryDescription(delivery, orderNumber);
      const paidManualButtons: BotButton[] = [
        buildWidgetPaymentButton(orderId, price, `Заказ №${orderNumber}: ${displayService}`),
      ];
      paidManualButtons.push({ id: 'order_more', label: '📷 Новый заказ', icon: 'add_photo_alternate', value: 'studio_main_menu', color: '#4facfe' });

      return {
        content: `✅ **Заказ №${orderNumber} принят!** — **${price}₽**${priceBreakdown}\n\n📋 ${displayService}\n\n${deliveryLines}\n\n📦 Фотографии переданы сотруднику для подготовки к печати.\n\n⏱ Ожидайте уведомления!`,
        interactive: {
          type: 'buttons',
          step: 'order_paid_manual',
          buttons: paidManualButtons,
        },
      };
    }
  }

  // ---------- Все остальные заказы (ретушь, документы, реставрация, дизайн, онлайн) ----------
  // Фото НЕ обрабатываем — архивируем оригиналы и передаём сотруднику
  if (sourcePaths.length > 0) {
    try {
      const archResult = await archiveOriginalPhotos(sourcePaths, sessionId, { service, tariff, price });
      const archiveSize = formatFileSize(archResult.archiveSize);

      // Формируем описание для клиента
      const confirmLines: string[] = [
        `✅ **Заказ №${orderNumber} принят!** — **${price}₽**${priceBreakdown}`,
        ``,
        `📋 ${displayService}`,
      ];
      if (printAddon) {
        confirmLines.push(`🖨 Печатный вид: включён (+200₽)`);
        if (deliveryCostValue > 0) {
          confirmLines.push(`📮 Доставка Почтой России: +${deliveryCostValue}₽`);
        }
        if (deliveryAddress) confirmLines.push(`📍 ${deliveryAddress}`);
      }
      confirmLines.push(``, `📦 Фото (${archResult.photosCount} шт.) собраны в архив.`);

      if (deliveryMethod === 'electronic' || deliveryMethod === 'postal') {
        const processingTime = await resolveProcessingTimeLabel(categorySlug, data);
        confirmLines.push(`💳 Оплатите заказ, и мы сразу приступим к работе!`);
        if (processingTime) {
          confirmLines.push(`⏱ Среднее время обработки: ${processingTime}.`);
        }
      } else {
        const deliveryLines = buildDeliveryDescription(delivery, orderNumber);
        confirmLines.push(deliveryLines);
        confirmLines.push(`⏱ Наш специалист получил заявку и приступит к работе!`);
      }

      const confirmedArchivedButtons: BotButton[] = [
        {
          id: 'download_originals',
          label: `📥 Скачать архив (${archiveSize})`,
          icon: 'download',
          value: 'download_archive',
          url: archResult.archiveUrl,
          color: '#22c55e',
          visibleTo: 'operator',
        },
      ];
      confirmedArchivedButtons.push(buildWidgetPaymentButton(orderId, price, `Заказ №${orderNumber}: ${displayService}`));
      confirmedArchivedButtons.push({ id: 'order_more', label: '📷 Новый заказ', icon: 'add_photo_alternate', value: deliveryMethod === 'pickup' ? 'studio_main_menu' : 'main_menu', color: '#4facfe' });

      return {
        content: confirmLines.join('\n'),
        interactive: {
          type: 'buttons',
          step: 'order_confirmed_archived',
          buttons: confirmedArchivedButtons,
        },
      };
    } catch (err: unknown) {
      logger.error('[PayOrder] Original archive error:', { error: toErrorMessage(err) });
      // Fallback без архива
    }
  }

  // Заказ без фото (дизайн, визитки и т.д.) — просто подтверждаем
  const noPhotoLines: string[] = [`✅ **Заказ №${orderNumber} принят!** — **${price}₽**${priceBreakdown}`, ``, `📋 ${displayService}`];
  if (printAddon) {
    noPhotoLines.push(`🖨 Печатный вид: включён (+200₽)`);
    if (deliveryCostValue > 0) noPhotoLines.push(`📮 Доставка Почтой России: +${deliveryCostValue}₽`);
    if (deliveryAddress) noPhotoLines.push(`📍 ${deliveryAddress}`);
  }
  if (deliveryMethod === 'electronic' || deliveryMethod === 'postal') {
    const processingTime = await resolveProcessingTimeLabel(categorySlug, data);
    noPhotoLines.push(``, `💳 Оплатите заказ, и мы сразу приступим к работе!`);
    if (processingTime) {
      noPhotoLines.push(`⏱ Среднее время обработки: ${processingTime}.`);
    }
  } else {
    const deliveryLines = buildDeliveryDescription(delivery, orderNumber);
    noPhotoLines.push(``, deliveryLines, ``, `Наш сотрудник получил заявку и свяжется с вами!`, `⏱ Спасибо за заказ!`);
  }

  const confirmedButtons: BotButton[] = [
    buildWidgetPaymentButton(orderId, price, `Заказ №${orderNumber}: ${displayService}`),
  ];
  confirmedButtons.push({ id: 'order_more', label: '📷 Новый заказ', icon: 'add_photo_alternate', value: deliveryMethod === 'pickup' ? 'studio_main_menu' : 'main_menu', color: '#4facfe' });

  return {
    content: noPhotoLines.join('\n'),
    interactive: {
      type: 'buttons',
      step: 'order_confirmed',
      buttons: confirmedButtons,
    },
  };
}

// ============================================================================
// Форматирование информации о доставке для клиента
// ============================================================================

export function buildDeliveryDescription(delivery: DeliveryInfo, orderNumber: number): string {
  const lines: string[] = [
    `🏷 **Заказ №${orderNumber}**`,
    `🏭 Производство: **${delivery.production}**`,
  ];

  if (delivery.deliveryAddress) {
    lines.push(`🚚 Доставка: **${delivery.deliveryAddress}**`);
    if (delivery.deliveryCost && delivery.deliveryCost > 0) {
      lines.push(`📮 Почта России: **${delivery.deliveryCost}₽**`);
      if (delivery.deliveryDaysMin && delivery.deliveryDaysMax) {
        lines.push(`📅 Срок: **${delivery.deliveryDaysMin}–${delivery.deliveryDaysMax} дней**`);
      }
    }
    if (delivery.deliveryPhone) {
      lines.push(`📞 Телефон: **${delivery.deliveryPhone}**`);
    }
  } else {
    lines.push(`📍 Самовывоз: **${delivery.pickup}**`);
  }

  return lines.join('\n');
}
