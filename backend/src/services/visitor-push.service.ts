import webpush from 'web-push';
import { config } from '../config/index.js';
import { pool } from '../database/db.js';

import { createLogger } from '../utils/logger.js';
export interface VisitorPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  sessionId?: string;
}

const logger = createLogger('visitor-push.service');
// ── Web Push (VAPID) — для браузеров ──

interface PushConversationRow {
  id: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys: unknown;
}

interface PushPageUrlRow {
  page_url: string | null;
}

function readOwnString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function readOwnNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === 'number' ? property : undefined;
}

const vapidPublicKey = config.webPush.publicKey || process.env['WEB_PUSH_PUBLIC_KEY'] || '';
const vapidPrivateKey = config.webPush.privateKey || process.env['WEB_PUSH_PRIVATE_KEY'] || '';
const vapidSubject = config.webPush.subject || process.env['WEB_PUSH_SUBJECT'] || 'mailto:info@svoefoto.ru';

const hasVapidKeys = Boolean(vapidPublicKey && vapidPrivateKey);

if (hasVapidKeys) {
  webpush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey,
  );
} else {
  logger.warn('[WebPush] VAPID keys are missing. Push notifications are disabled.');
}

// ── Public API ──

export function getWebPushPublicKey(): string | null {
  return vapidPublicKey || null;
}

async function resolvePushConversationId(sessionId: string): Promise<string> {
  const result = await pool.query<PushConversationRow>(
    `SELECT id
       FROM conversations
      WHERE id = $1 OR legacy_session_id = $1
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [sessionId],
  );

  return result.rows[0]?.id ?? sessionId;
}

/**
 * Отправляет push-уведомление всем подписчикам сессии.
 * - Web (VAPID) — для браузеров
 * - Мобильное приложение получает уведомления через WebSocket (Socket.IO),
 *   т.к. мы не используем Firebase/FCM — свой сервер.
 */
export async function sendVisitorChatPush(
  sessionId: string,
  payload: VisitorPushPayload,
): Promise<void> {
  if (!hasVapidKeys) {
    logger.warn('[WebPush] Skipped — no VAPID keys');
    return;
  }

  const conversationId = await resolvePushConversationId(sessionId);

  const subscriptions = await pool.query<PushSubscriptionRow>(
    `SELECT id, endpoint, keys FROM visitor_push_subscriptions
     WHERE session_id = $1 AND platform = 'web' AND endpoint IS NOT NULL`,
    [conversationId],
  );

  logger.info(`[WebPush] Found ${subscriptions.rows.length} web subscriptions for session ${conversationId}`);

  if (subscriptions.rows.length === 0) {
    return;
  }

  const sessionResult = await pool.query<PushPageUrlRow>(
    `SELECT page_url FROM conversations WHERE id = $1`,
    [conversationId],
  );

  const pageUrl = sessionResult.rows[0]?.page_url || '/';
  const normalizedPayload = {
    ...payload,
    url: payload.url || pageUrl,
    sessionId: conversationId,
    tag: payload.tag || `sf-chat-${conversationId}`,
  };

  const notificationPayload = JSON.stringify(normalizedPayload);
  const deletions: string[] = [];

  await Promise.allSettled(
    subscriptions.rows.map(async (row) => {
      const keys = normalizeKeys(row.keys);
      if (!keys?.p256dh || !keys?.auth) {
        return;
      }

      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys },
          notificationPayload,
          { TTL: 60 * 60 },
        );
        logger.info(`[WebPush] Notification sent to ${row.endpoint.substring(0, 60)}...`);
      } catch (err: unknown) {
        const statusCode = readOwnNumber(err, 'statusCode');
        if (statusCode === 404 || statusCode === 410) {
          deletions.push(row.id);
        } else {
          logger.warn('[WebPush] Failed to send notification', {
            statusCode,
            endpoint: row.endpoint,
          });
        }
      }
    }),
  );

  if (deletions.length > 0) {
    await pool.query(
      `DELETE FROM visitor_push_subscriptions WHERE id = ANY($1::uuid[])`,
      [deletions],
    );
  }
}

/**
 * Отправляет push-уведомление о смене статуса заказа клиенту (по chat session).
 */
export async function sendOrderStatusPush(
  sessionId: string,
  orderId: string,
  status: string,
): Promise<void> {
  const statusLabels: Record<string, string> = {
    processing: 'Заказ в работе ⏳',
    ready: 'Заказ готов! ✅',
    completed: 'Заказ выполнен 🎉',
    cancelled: 'Заказ отменён ❌',
  };
  const label = statusLabels[status];
  if (!label) return;

  await sendVisitorChatPush(sessionId, {
    title: label,
    body: `Заказ ${orderId} — ${label.toLowerCase()}`,
    tag: `order-${orderId}`,
    url: `/track/${orderId}`,
  });
}

/**
 * Отправляет push-уведомление о падении цены подписанным клиентам.
 */
export async function sendPriceDropPush(
  sessionId: string,
  categorySlug: string,
  newPrice: number,
  discountPercent: number,
): Promise<void> {
  if (!hasVapidKeys) return;

  await sendVisitorChatPush(sessionId, {
    title: `Цена снизилась -${discountPercent}% 🏷️`,
    body: `Закажите ${categorySlug} сейчас всего за ${newPrice}₽!`,
    tag: `price-drop-${categorySlug}`,
    url: '/',
  });
}

function normalizeKeys(raw: unknown): { p256dh: string; auth: string } | null {
  if (!raw) return null;

  try {
    const keys: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const p256dh = readOwnString(keys, 'p256dh');
    const auth = readOwnString(keys, 'auth');
    if (!p256dh || !auth) {
      return null;
    }
    return { p256dh, auth };
  } catch (err) {
    logger.warn('[WebPush] Failed to parse subscription keys', { error: String(err) });
    return null;
  }
}
