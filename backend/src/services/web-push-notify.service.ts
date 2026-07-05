/**
 * Web Push Notification Service — серверные push-уведомления для сотрудников.
 * Использует web-push (VAPID) для отправки браузерных уведомлений.
 */
import webpush from 'web-push';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { toErrorMessage, toStatusCode } from '../utils/error-helpers.js';

import { createLogger } from '../utils/logger.js';
const vapidPublicKey = config.webPush.publicKey;
const vapidPrivateKey = config.webPush.privateKey;
const vapidSubject = config.webPush.subject;

const logger = createLogger('web-push-notify.service');
// Init VAPID
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  logger.info('[WebPush] VAPID configured for employees');
} else {
  logger.warn('[WebPush] VAPID keys not set, Web Push disabled');
}

// ============================================================================
// Public API
// ============================================================================

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

/**
 * Сохранить push-подписку сотрудника
 */
export async function saveSubscription(userId: string, subscription: any, userAgent?: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO employee_push_subscriptions (user_id, endpoint, keys, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = $3, user_agent = $4`,
      [userId, subscription.endpoint, JSON.stringify(subscription.keys || {}), userAgent || null]
    );
    logger.info(`[WebPush] Subscription saved for user ${userId}`);
  } catch (err) {
    logger.error('[WebPush] saveSubscription error:', { error: String(err) });
  }
}

/**
 * Удалить push-подписку
 */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  try {
    await db.query(
      `DELETE FROM employee_push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint]
    );
  } catch (err) {
    logger.error('[WebPush] removeSubscription error:', { error: String(err) });
  }
}

/**
 * Отправить push-уведомление сотруднику
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<number> {
  if (!vapidPublicKey || !vapidPrivateKey) return 0;

  try {
    const subs = await db.query<{ id: string; endpoint: string; keys: any }>(
      `SELECT id, endpoint, keys FROM employee_push_subscriptions WHERE user_id = $1`,
      [userId]
    );

    if (subs.length === 0) return 0;

    let sent = 0;
    const staleIds: string[] = [];

    for (const sub of subs) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys,
      };

      try {
        await webpush.sendNotification(subscription as any, JSON.stringify(payload));
        sent++;
      } catch (err: unknown) {
        const statusCode = toStatusCode(err);
        if (statusCode === 410 || statusCode === 404) {
          staleIds.push(sub.id);
        } else {
          logger.error(`[WebPush] Send error for ${sub.endpoint.substring(0, 40)}...`, { error: String(statusCode || toErrorMessage(err)) });
        }
      }
    }

    if (staleIds.length > 0) {
      await db.query(
        `DELETE FROM employee_push_subscriptions WHERE id = ANY($1)`,
        [staleIds]
      );
      logger.info(`[WebPush] Removed ${staleIds.length} stale subscriptions`);
    }

    return sent;
  } catch (err) {
    logger.error('[WebPush] sendPush error:', { error: String(err) });
    return 0;
  }
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  sound?: boolean;
}
