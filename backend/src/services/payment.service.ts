/**
 * payment.service.ts — Named functions for post-payment side-effects.
 * Each function wraps what was previously inline fire-and-forget in payments.routes.ts.
 * In Stage 3 these become BullMQ jobs.
 */

import db from '../database/db.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { PhotoPrintOrder } from '../types/views/print-order-views.js';

const log = createLogger('payment-service');
import { confirmReferral } from './partners.service.js';
import { findCustomerByOrder, recordPaidOrder } from './customer.service.js';
import { invalidateCustomerCache } from '../routes/chat/chat-context.service.js';
import { createTaskFromOrder } from './task-auto.service.js';
import { scheduleReviewRequest } from './review-request.service.js';
import { automateShipping } from './shipping-automation.service.js';
import { sendOrderConfirmation, type OrderEmailData } from './email.service.js';
import { NotificationService } from './notification.service.js';
import { sendVisitorChatPush } from './visitor-push.service.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { processAndNotify, type PhotoPrintOrderRequest } from './photo-print-processing.service.js';
import { detectCashbackCategoryKey, getOrCreateByUserId } from './loyalty.service.js';
import { enqueueLoyaltyEarn, enqueueLoyaltyAchievements } from '../workers/loyalty-worker.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type { ConversationIdRow, InsertedMessageRow, LoyaltyOrderLookupRow, OrderUserIdRow } from '../types/views/payment-service-views.js';

// ─── 1. Partner referral confirmation ────────────────────────────────────────

export async function confirmPartnerReferral(orderId: string, orderType: string): Promise<void> {
  await confirmReferral(orderId, orderType);
}

// ─── 2. Customer stats update ────────────────────────────────────────────────

export async function findCustomerAndRecord(
  order: PhotoPrintOrder,
  amount: string | number,
  chatSessionId: string | null,
): Promise<void> {
  const customer = await findCustomerByOrder({ ...order });
  if (!customer) return;
  const serviceType = order.service_type
    || (Array.isArray(order.items) ? order.items[0]?.name : undefined);
  await recordPaidOrder(customer.id, Number(amount), serviceType);
  if (chatSessionId) invalidateCustomerCache(chatSessionId);
}

// ─── 3. CRM task creation ────────────────────────────────────────────────────

export interface CreateCrmTaskParams {
  orderId: string;
  orderDbId: string;
  contactName: string;
  contactPhone?: string;
  chatSessionId?: string;
  serviceName: string;
  amount: string | number;
  cardInfo: string | null;
  priority: string;
  studioId?: string | null;
  clientChannel?: string;
  description?: string;
  taskType?: string;
}

export async function createCrmTask(params: CreateCrmTaskParams): Promise<void> {
  const taskPriority = params.priority === 'vip' ? 'urgent' : params.priority === 'urgent' ? 'urgent' : 'high';
  const prefixLabel = params.priority === 'vip' ? '⭐ VIP ' : params.priority === 'urgent' ? '⚡ Срочно: ' : '';
  const description = params.description
    || `Заказ ${params.orderId}, оплата ${params.amount}₽ (${params.cardInfo || 'СБП'}). Обработать и отправить результат в чат.`;
  const task = await createTaskFromOrder({
    orderId: params.orderDbId,
    orderTable: 'photo_print_orders',
    taskType: params.taskType,
    clientName: params.contactName || 'Онлайн-клиент',
    clientPhone: params.contactPhone,
    clientChannel: params.clientChannel || 'online',
    chatSessionId: params.chatSessionId,
    studioId: params.studioId || undefined,
    title: `${prefixLabel}${params.serviceName} — ${params.amount}₽`,
    description,
    priority: taskPriority,
  });
  if (task) {
    const taskPayload: object = { ...task };
    broadcastToRoom('task:created', `studio:${task.assigned_studio_id}`, taskPayload);
    broadcastToRoom('task:created', 'employee:dashboard', taskPayload);
    log.info(`Task ${task.task_number} created for ${params.orderId}`);
  }
}

// ─── 4. Review request scheduling ───────────────────────────────────────────

export interface ScheduleReviewParams {
  orderId: string;
  clientName: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
}

export async function scheduleReview(params: ScheduleReviewParams): Promise<void> {
  await scheduleReviewRequest({
    orderId: params.orderId,
    clientName: params.clientName,
    clientPhone: params.clientPhone,
    clientEmail: params.clientEmail,
    source: 'payment_webhook',
  });
}

// ─── 5. Bridge attribution ──────────────────────────────────────────────────

export interface BridgeAttributionParams {
  amount: string | number;
  fingerprintVisitorId?: string;
  phone?: string;
  email?: string;
  sourceId: string;
  services: string[];
}

export async function sendBridgeAttribution(params: BridgeAttributionParams): Promise<void> {
  const { savePayment } = await import('./attribution.service.js');
  await savePayment({
    amount: Number(params.amount),
    fingerprint_visitor_id: params.fingerprintVisitorId || undefined,
    phone: params.phone || undefined,
    source: 'cloudpayments',
    source_id: params.sourceId,
    services: params.services,
  });
}

// ─── 6. Photo processing (print orders) ─────────────────────────────────────

export async function processPhotoPrintOrder(
  orderId: string,
  body: PhotoPrintOrderRequest,
  telegramUserId?: string,
  telegramUsername?: string,
): Promise<void> {
  await processAndNotify(orderId, body, telegramUserId, telegramUsername);
}

// ─── 7. Shipping automation ─────────────────────────────────────────────────

export async function automateOrderShipping(orderId: string): Promise<void> {
  await automateShipping(orderId);
}

// ─── 8. Loyalty points ──────────────────────────────────────────────────────

export async function awardOrderPoints(orderId: string, amount: number): Promise<void> {
  const row = await db.queryOne<LoyaltyOrderLookupRow>(
    `SELECT COALESCE(ct.user_id, c.user_id) AS user_id,
            ppo.items,
            ppo.service_type,
            ppo.mode,
            ppo.created_at::text AS created_at
     FROM photo_print_orders ppo
     JOIN conversations c ON c.legacy_session_id::text = ppo.chat_session_id::text
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE ppo.order_id = $1 AND COALESCE(ct.user_id, c.user_id) IS NOT NULL`,
    [orderId],
  );
  if (!row?.user_id) return;

  const { profile } = await getOrCreateByUserId(row.user_id);
  await enqueueLoyaltyEarn({
    profileId: profile.id,
    orderAmount: amount,
    source: 'online_order',
    referenceId: orderId,
    occurredAt: row.created_at,
    cashbackCategoryKey: detectCashbackCategoryKey({
      categorySlug: row.mode,
      serviceName: row.service_type,
      items: row.items,
    }),
  });
  await enqueueLoyaltyAchievements(profile.id);

  log.info(`Enqueued loyalty earn for user ${row.user_id}, order ${orderId}, amount ${amount}`);
}

// ─── 9. Email confirmation ──────────────────────────────────────────────────

export async function sendPaymentEmailConfirmation(
  email: string,
  data: OrderEmailData,
): Promise<void> {
  await sendOrderConfirmation(email, data);
}

// ─── 10. Push notification ──────────────────────────────────────────────────

export async function createPaymentPushNotification(
  userId: string,
  orderId: string,
  amount: string | number,
): Promise<void> {
  await NotificationService.create({
    userId,
    title: 'Оплата получена',
    body: `Заказ ${orderId} — ${amount}₽ оплачен`,
    type: 'payment_confirmed',
    data: { orderId, amount },
  });
}

// ─── 11. Save card token ────────────────────────────────────────────────────

export async function saveCardToken(
  userId: string,
  token: string,
  cardFirstSix: string,
  cardLastFour: string,
  cardType?: string,
  cardExpDate?: string,
): Promise<void> {
  await db.query(
    `INSERT INTO saved_payment_methods (user_id, token, card_first_six, card_last_four, card_type, card_exp_date, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, token) DO UPDATE SET last_used_at = NOW()`,
    [userId, token, cardFirstSix, cardLastFour, cardType || null, cardExpDate || null],
  );
}

// ─── 12. Chat order paid notification ───────────────────────────────────────

export type ChatPaymentCardStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export async function syncChatPaymentCardStatus(
  orderId: string,
  status: ChatPaymentCardStatus,
  timestamp = new Date().toISOString(),
): Promise<void> {
  const patch = status === 'paid'
    ? { status, paidAt: timestamp }
    : { status, updatedAt: timestamp };

  await db.query(
    `UPDATE messages
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{payment}',
       COALESCE(metadata->'payment', '{}'::jsonb) || $2::jsonb,
       true
     )
     WHERE metadata ? 'payment'
       AND metadata->'payment'->>'orderId' = $1`,
    [orderId, JSON.stringify(patch)],
  );
}

export async function notifyChatOrderPaidService(
  sessionId: string,
  order: PhotoPrintOrder,
  paymentMethod: string | null = null,
): Promise<void> {
  const orderId = order.order_id;
  const price = order.total_price;
  const orderNum = orderId.replace(/^(chat-.*-|SF-)/, '');
  const paidAt = new Date().toISOString();
  const normalizedPaymentMethod = paymentMethod?.trim() || null;

  const content = `✅ **Оплата ${price}₽ получена!**\n\n📋 Заказ №${orderNum} в работе.\nНаш специалист обработает ваше фото и отправит результат в этот чат.\n\n⏱ Среднее время обработки: 15–30 минут.\n\n🔗 Отслеживать заказ: https://svoefoto.ru/track/${orderId}`;
  const items = (order.items ?? [])
    .filter((it): it is NonNullable<typeof it> => !!it && typeof it.name === 'string' && it.name.trim().length > 0)
    .map((it) => {
      const quantity = Number(it.quantity) || 1;
      return {
        name: quantity > 1 ? `${it.name} × ${quantity}` : it.name,
        price: Math.round((Number(it.price) || 0) * quantity),
      };
    });
  const metadata = {
    event: 'order_paid',
    payment: {
      orderId,
      amount: Number(price),
      status: 'paid',
      ...(normalizedPaymentMethod ? { method: normalizedPaymentMethod } : {}),
      paidAt,
      ...(items.length ? { items } : {}),
    },
  };

  try {
    await syncChatPaymentCardStatus(orderId, 'paid', paidAt);
  } catch (err) {
    log.warn('[payment] failed to sync chat payment card status', {
      error: err instanceof Error ? err.message : String(err),
      orderId,
    });
  }

  const convIdRes = await db.queryOne<ConversationIdRow>(
    `SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1`,
    [sessionId],
  );
  const conversationId = convIdRes?.id ?? sessionId;

  const msgResult = await db.queryOne<InsertedMessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3)
     RETURNING id, created_at`,
    [conversationId, content, JSON.stringify(metadata)],
  );

  broadcastToRoom('operator:message', `visitor:${sessionId}`, {
    sessionId,
    content,
    senderName: 'Своё Фото',
    senderType: 'bot',
    messageType: 'text',
    attachmentUrl: null,
    metadata,
    timestamp: msgResult?.created_at || new Date(),
    id: msgResult?.id || '',
  });

  // Broadcast to CRM operators
  broadcastChatMessage({
    sessionId: conversationId,
    message: {
      id: msgResult?.id,
      sender_type: 'bot',
      sender_name: 'Своё Фото',
      content,
      message_type: 'text',
      metadata,
      created_at: msgResult?.created_at || new Date(),
    },
  }).catch(err => log.error('[payment] broadcastChatMessage failed (order-paid)', { error: String(err) }));

  try {
    await sendVisitorChatPush(sessionId, {
      title: 'Своё Фото',
      body: `Оплата ${price}₽ получена! Заказ в работе.`,
    });
  } catch (err) {
    log.error('Push notification failed for paid order', { error: err instanceof Error ? err.message : String(err), sessionId, orderId });
  }

  // Outbound messenger notification (Telegram/VK/WhatsApp)
  try {
    const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
      `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id && msgResult) {
      const { enqueueOutbound } = await import('./connectors/pipeline/outbound-worker.js');
      await enqueueOutbound({
        channel: conv.channel,
        externalChatId: conv.external_chat_id,
        content,
        messageType: 'text',
        sourceMessageId: msgResult.id,
        conversationId,
      });
    }
  } catch (err) {
    log.error('[payment] outbound messenger failed (order-paid)', { error: err instanceof Error ? err.message : String(err), sessionId, orderId });
  }

  const contactEmail = order.contact_email;
  if (contactEmail) {
    try {
      await sendOrderConfirmation(contactEmail, {
      order_id: orderId,
      contact_name: order.contact_name,
      total_price: Number(price),
      items: Array.isArray(order.items) ? order.items : [],
      promo_code: order.promo_code,
      promo_discount: Number(order.promo_discount) || 0,
      delivery_cost: Number(order.delivery_cost) || 0,
      delivery_address: order.delivery_address,
      receipt_url: order.receipt_url,
      created_at: String(order.created_at),
      });
    } catch (err) {
      log.error('Email confirmation failed', { error: err instanceof Error ? err.message : String(err), email: contactEmail, orderId });
    }
  }

  log.info(`Payment confirmation sent for order ${orderId}`, { sessionId });
}

// ─── 13. Chat order failed notification ─────────────────────────────────────

export async function notifyChatOrderFailedService(
  sessionId: string,
  order: PhotoPrintOrder,
  reason: string | undefined,
): Promise<void> {
  const orderId = order.order_id;
  const price = order.total_price;
  const reasonText = reason ? `\n\nПричина: ${reason}` : '';
  const content = `❌ **Оплата ${price}₽ не прошла**${reasonText}\n\n📋 Заказ ${orderId}\nВы можете попробовать снова.`;

  const failConvIdRes = await db.queryOne<ConversationIdRow>(
    `SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1`,
    [sessionId],
  );
  const failConversationId = failConvIdRes?.id ?? sessionId;

  const msgResult = await db.queryOne<InsertedMessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
     RETURNING id, created_at`,
    [failConversationId, content],
  );

  const retryPrice = parseFloat(String(price));
  const interactive = {
    type: 'buttons',
    step: 'payment_retry',
    buttons: [
      {
        id: 'pay_online_widget',
        label: `💳 Оплатить ${retryPrice}₽`,
        icon: 'credit_card',
        value: 'pay_online_widget',
        color: '#22c55e',
        data: { orderId, price: retryPrice, description: `Оплата заказа ${orderId}` },
      },
      {
        id: 'back_menu',
        label: '◀ В меню',
        icon: 'arrow_back',
        value: 'studio_main_menu',
        color: '#a8a8a8',
      },
    ],
  };

  await db.queryOne(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', 'Выберите действие:', $2)
     RETURNING id, created_at`,
    [failConversationId, JSON.stringify({ interactive })],
  );

  broadcastToRoom('operator:message', `visitor:${sessionId}`, {
    sessionId,
    content,
    senderName: 'Своё Фото',
    senderType: 'bot',
    messageType: 'text',
    attachmentUrl: null,
    timestamp: msgResult?.created_at || new Date(),
    id: msgResult?.id || '',
  });
  broadcastToRoom('operator:message', `visitor:${sessionId}`, {
    sessionId,
    content: 'Попробуйте оплатить снова:',
    senderName: 'Своё Фото',
    senderType: 'bot',
    messageType: 'interactive',
    attachmentUrl: null,
    timestamp: new Date(),
    id: `retry-${orderId}-${Date.now()}`,
    interactive,
  });

  // Broadcast to CRM operators
  broadcastChatMessage({
    sessionId: failConversationId,
    message: {
      id: msgResult?.id,
      sender_type: 'bot',
      sender_name: 'Своё Фото',
      content,
      message_type: 'text',
      created_at: msgResult?.created_at || new Date(),
    },
  }).catch(err => log.error('[payment] broadcastChatMessage failed (order-failed)', { error: String(err) }));

  try {
    await sendVisitorChatPush(sessionId, {
      title: 'Своё Фото',
      body: `Оплата ${price}₽ не прошла. Попробуйте снова.`,
    });
  } catch (err) {
    log.error('Push notification failed for failed order', { error: err instanceof Error ? err.message : String(err), sessionId, orderId });
  }

  // Outbound messenger notification (Telegram/VK/WhatsApp)
  try {
    const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
      `SELECT channel, external_chat_id FROM conversations WHERE id = $1`,
      [failConversationId],
    );
    if (conv && !['web', 'online', 'studio'].includes(conv.channel) && conv.external_chat_id && msgResult) {
      const { enqueueOutbound } = await import('./connectors/pipeline/outbound-worker.js');
      await enqueueOutbound({
        channel: conv.channel,
        externalChatId: conv.external_chat_id,
        content,
        messageType: 'text',
        sourceMessageId: msgResult.id,
        conversationId: failConversationId,
      });
    }
  } catch (err) {
    log.error('[payment] outbound messenger failed (order-failed)', { error: err instanceof Error ? err.message : String(err), sessionId, orderId });
  }

  await db.query(
    `UPDATE photo_print_orders SET status = 'pending_payment', payment_status = 'none',
     reminder_sent_at = NULL, final_reminder_sent_at = NULL
     WHERE order_id = $1 AND status = 'payment_failed'`,
    [orderId],
  );
}

// ─── Helper: get user ID from order ─────────────────────────────────────────

export async function getOrderUserId(orderId: string): Promise<string | null> {
  const row = await db.queryOne<OrderUserIdRow>(
    `SELECT COALESCE(ct.user_id, c.user_id) AS user_id FROM photo_print_orders ppo
     JOIN conversations c ON c.legacy_session_id::text = ppo.chat_session_id::text
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE ppo.order_id = $1 AND COALESCE(ct.user_id, c.user_id) IS NOT NULL`,
    [orderId],
  );
  return row?.user_id || null;
}
