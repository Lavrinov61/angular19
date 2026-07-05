import crypto from 'crypto';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { deliverReply } from './channel-delivery.service.js';
import { sendReviewRequestEmail } from './email.service.js';

import { createLogger } from '../utils/logger.js';
const TAG = '[ReviewReq]';

const logger = createLogger('review-request.service');
// ─── Lookup клиентов по телефону ─────────────────────────────────

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

async function findChatIdByChannel(phone: string, channel: 'telegram' | 'max'): Promise<string | null> {
  const last10 = normalizePhone(phone);
  if (!last10) return null;

  const result = await db.queryOne<{ chat_id: string }>(
    `SELECT metadata->>'externalChatId' AS chat_id
     FROM conversations
     WHERE channel = $1
       AND metadata->>'externalUserId' LIKE '%' || $2
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [channel, last10],
  );

  return result?.chat_id || null;
}

// ─── Review URLs по локации ──────────────────────────────────────

function getReviewUrls(locationSlug: string | null): Record<string, string> {
  const loc = config.reviewSync.locations.find(l => l.slug === (locationSlug || 'soborny'));
  const slug = loc?.slug || 'soborny';

  return {
    '2gis': loc?.dgisUrl ? `${loc.dgisUrl}/tab/reviews` : 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews',
    google: loc?.googleReviewUrl || 'https://g.page/r/CdLAfLUuNAGrEBM/review',
    yandex: loc?.yandexReviewUrl || 'https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/',
  };
}

// ─── Планирование запроса отзыва ─────────────────────────────────

interface ScheduleOpts {
  orderId?: string;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  source: string;
  locationSlug?: string;
  delayMinutes?: number;
}

export async function scheduleReviewRequest(opts: ScheduleOpts): Promise<void> {
  const { orderId, clientName, clientPhone, clientEmail, source, locationSlug } = opts;
  const delay = opts.delayMinutes ?? 30;

  // Дедупликация по order_id
  if (orderId) {
    const existing = await db.queryOne(
      `SELECT id FROM review_requests WHERE order_id = $1 AND status NOT IN ('cancelled', 'failed')`,
      [orderId],
    );
    if (existing) {
      logger.info(`${TAG} Duplicate skipped for order ${orderId}`);
      return;
    }
  }

  // Определение канала: telegram → max → email
  let channel = 'email';
  let externalChatId: string | null = null;

  if (clientPhone) {
    const tgChatId = await findChatIdByChannel(clientPhone, 'telegram');
    if (tgChatId) {
      channel = 'telegram';
      externalChatId = tgChatId;
    } else {
      const maxChatId = await findChatIdByChannel(clientPhone, 'max');
      if (maxChatId) {
        channel = 'max';
        externalChatId = maxChatId;
      }
    }
  }

  // Если нет мессенджера и нет email — не создаём
  if (channel === 'email' && !clientEmail) {
    logger.info(`${TAG} No channel for ${clientPhone || 'unknown'}, skipping`);
    return;
  }

  const reviewToken = crypto.randomBytes(9).toString('base64url');

  await db.query(
    `INSERT INTO review_requests
       (order_id, client_name, client_phone, client_email, channel, external_chat_id,
        status, send_at, source, location_slug, review_token)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + $7 * interval '1 minute', $8, $9, $10)`,
    [
      orderId || null,
      clientName || null,
      clientPhone || null,
      clientEmail || null,
      channel,
      externalChatId,
      delay,
      source,
      locationSlug || null,
      reviewToken,
    ],
  );

  logger.info(`${TAG} Scheduled: ${channel} → ${clientPhone || clientEmail}, send in ${delay}min, source=${source}`);
}

// ─── Обработка (отправка) ────────────────────────────────────────

interface ReviewRequestRow {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  channel: string;
  external_chat_id: string | null;
  review_token: string;
  location_slug: string | null;
}

export async function processReviewRequest(row: ReviewRequestRow): Promise<void> {
  const baseUrl = 'https://svoefoto.ru';
  const reviewPageUrl = `${baseUrl}/review?t=${row.review_token}${row.location_slug ? `&location=${row.location_slug}` : ''}`;

  try {
    if (row.channel === 'telegram' || row.channel === 'max') {
      if (!row.external_chat_id) throw new Error(`No chat_id for ${row.channel}`);

      const name = row.client_name ? row.client_name.split(' ')[0] : '';
      const greeting = name ? `${name}, с` : 'С';
      const text = `${greeting}пасибо за визит в Своё Фото! \u2B50\n\nБудем благодарны за отзыв — это займёт пару минут:\n${reviewPageUrl}\n\nВаше мнение помогает нам становиться лучше!`;

      const sent = await deliverReply(row.channel, row.external_chat_id, text);
      if (!sent) throw new Error(`deliverReply returned false for ${row.channel}`);
    } else if (row.channel === 'email' && row.client_email) {
      await sendReviewRequestEmail(row.client_email, {
        clientName: row.client_name,
        reviewToken: row.review_token,
        locationSlug: row.location_slug,
      });
    } else {
      throw new Error(`Invalid channel: ${row.channel}`);
    }

    await db.query(
      `UPDATE review_requests SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    logger.info(`${TAG} Sent via ${row.channel} to ${row.client_phone || row.client_email}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE review_requests SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [row.id, message],
    );
    logger.error(`${TAG} Failed for ${row.id}:`, { detail: message });
  }
}

// ─── Трекинг кликов ──────────────────────────────────────────────

export async function trackClick(token: string, platform: string): Promise<string | null> {
  const row = await db.queryOne<{ location_slug: string | null }>(
    `UPDATE review_requests
     SET clicked_at = COALESCE(clicked_at, NOW()), click_platform = $2, updated_at = NOW()
     WHERE review_token = $1 AND status = 'sent'
     RETURNING location_slug`,
    [token, platform],
  );

  if (!row) return null;

  const urls = getReviewUrls(row.location_slug);
  return urls[platform] || urls['2gis'];
}

// Получить redirect URL без трекинга (для QR без токена)
export function getReviewPlatformUrl(locationSlug: string | null, platform: string): string {
  const urls = getReviewUrls(locationSlug);
  return urls[platform] || urls['2gis'];
}

// ─── Статистика для CRM ──────────────────────────────────────────

export async function getReviewRequestStats(): Promise<{
  total: number;
  sent: number;
  clicked: number;
  sent7d: number;
  clicked7d: number;
  conversionRate: number;
}> {
  const row = await db.queryOne<{
    total: string;
    sent: string;
    clicked: string;
    sent_7d: string;
    clicked_7d: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'sent') AS sent,
       COUNT(*) FILTER (WHERE status = 'clicked') AS clicked,
       COUNT(*) FILTER (WHERE sent_at > NOW() - interval '7 days') AS sent_7d,
       COUNT(*) FILTER (WHERE clicked_at > NOW() - interval '7 days') AS clicked_7d
     FROM review_requests`,
  );

  const sent7d = parseInt(row?.sent_7d || '0', 10);
  const clicked7d = parseInt(row?.clicked_7d || '0', 10);

  return {
    total: parseInt(row?.total || '0', 10),
    sent: parseInt(row?.sent || '0', 10),
    clicked: parseInt(row?.clicked || '0', 10),
    sent7d,
    clicked7d,
    conversionRate: sent7d > 0 ? Math.round((clicked7d / sent7d) * 100) : 0,
  };
}
