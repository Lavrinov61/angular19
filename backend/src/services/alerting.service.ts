/**
 * Alerting Service — Telegram-based alerts for ops team
 *
 * Sends alerts via existing Telegram bot to admin chat IDs.
 * Deduplication: Redis key with TTL prevents alert spam.
 */
import { config } from '../config/index.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';
import { createLazyRedis } from './redis-factory.js';

const log = createLogger('alerting');
const BOT_TOKEN = config.telegram.botToken;
const ALERT_DEDUP_TTL = 300; // 5 min dedup window

// Parse comma-separated admin chat IDs from env
const ADMIN_CHAT_IDS: string[] = (process.env['TELEGRAM_ADMIN_CHAT_IDS'] || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Lazy Redis singleton for dedup
const getAlertRedis = createLazyRedis('alerting-dedup', {
  enableOfflineQueue: false,
});

async function isDuplicate(alertKey: string): Promise<boolean> {
  const redis = getAlertRedis();
  if (!redis) return false;
  try {
    const result = await redis.set(alertKey, '1', 'EX', ALERT_DEDUP_TTL, 'NX');
    return result === null; // NX returns null if key already exists
  } catch {
    return false; // On Redis error, allow alert
  }
}

async function sendTelegramAlert(text: string): Promise<void> {
  if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
    log.warn('Alert not sent — no BOT_TOKEN or ADMIN_CHAT_IDS configured');
    return;
  }

  for (const chatId of ADMIN_CHAT_IDS) {
    try {
      await fetchWithTimeout(`${config.telegram.apiUrl}/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      log.error('Failed to send Telegram alert', { chatId, error: String(err) });
    }
  }
}

// --- Public alert functions ---

export async function alertCircuitBreakerOpen(
  channel: string,
  failures: number,
  lastError: string,
): Promise<void> {
  const key = `alert:cb_open:${channel}`;
  if (await isDuplicate(key)) return;

  const text = [
    `\u{26A0}\uFE0F <b>Circuit Breaker OPEN</b>`,
    `\u{1F4E1} Channel: <code>${channel}</code>`,
    `\u{274C} Failures: ${failures}`,
    `\u{1F4AC} Last error: ${lastError.slice(0, 200)}`,
    `\u{23F0} ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
  ].join('\n');

  log.warn('Circuit breaker OPEN alert', { channel, failures });
  await sendTelegramAlert(text);
}

export async function alertDeadLetterThreshold(
  channel: string,
  count: number,
): Promise<void> {
  const key = `alert:dead_letter:${channel}`;
  if (await isDuplicate(key)) return;

  const text = [
    `\u{1F4E8} <b>Dead Letters</b>`,
    `\u{1F4E1} Channel: <code>${channel}</code>`,
    `\u{1F4CA} Count: ${count} undelivered`,
    `\u{23F0} ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
  ].join('\n');

  log.warn('Dead letter threshold alert', { channel, count });
  await sendTelegramAlert(text);
}

export async function alertWebhookAuthFailure(
  channel: string,
  ip: string,
): Promise<void> {
  const key = `alert:webhook_auth:${channel}:${ip}`;
  if (await isDuplicate(key)) return;

  const text = [
    `\u{1F6A8} <b>Webhook Auth Failure</b>`,
    `\u{1F4E1} Channel: <code>${channel}</code>`,
    `\u{1F310} IP: <code>${ip}</code>`,
    `\u{23F0} ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
  ].join('\n');

  log.warn('Webhook auth failure alert', { channel, ip });
  await sendTelegramAlert(text);
}
