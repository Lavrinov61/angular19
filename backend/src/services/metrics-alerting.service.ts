/**
 * Metrics Alerting Service (Stage 7: Monitoring)
 *
 * Periodic threshold checks → Telegram alerts to admin chat IDs.
 *
 * Alerts:
 * - PG pool exhaustion (waiting > 10 or idle = 0)
 * - BullMQ failed jobs accumulation (failed > 50)
 * - Circuit breaker OPEN
 * - High memory usage (RSS > 1.2GB)
 *
 * Cooldown: 15 minutes between repeated alerts of same type.
 * Runs every 60 seconds on the leader node.
 */

import { pool } from '../database/db.js';
import { config } from '../config/index.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('metrics-alerting');

const BOT_TOKEN = config.telegram.botToken;
const ADMIN_CHAT_IDS = config.telegram.adminChatIds;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

let alertInterval: ReturnType<typeof setInterval> | null = null;
let initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;
const lastAlertTimes = new Map<string, number>();

async function sendAlert(key: string, text: string): Promise<void> {
  const now = Date.now();
  const lastSent = lastAlertTimes.get(key) ?? 0;
  if (now - lastSent < COOLDOWN_MS) return;

  lastAlertTimes.set(key, now);

  if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
    log.warn('Alert skipped — no bot token or admin chat IDs', { key });
    return;
  }

  for (const chatId of ADMIN_CHAT_IDS) {
    try {
      await fetchWithTimeout(`${config.telegram.apiUrl}/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🚨 <b>API Alert</b>\n\n${text}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      log.error('Telegram alert send failed', { chatId, key, error: String(err) });
    }
  }
}

async function checkThresholds(): Promise<void> {
  try {
    // PG pool exhaustion
    if (pool.waitingCount > 10) {
      await sendAlert('pg_pool_waiting', `PG pool: ${pool.waitingCount} клиентов в очереди (idle: ${pool.idleCount}, total: ${pool.totalCount})`);
    }
    if (pool.totalCount >= 45 && pool.idleCount === 0) {
      await sendAlert('pg_pool_exhaustion', `PG pool почти исчерпан: ${pool.totalCount}/50 подключений, 0 idle`);
    }

    // Memory usage (RSS > 1.2GB)
    const rss = process.memoryUsage().rss;
    if (rss > 1.2 * 1024 * 1024 * 1024) {
      const rssMb = Math.round(rss / 1048576);
      await sendAlert('high_memory', `Высокое потребление памяти: RSS = ${rssMb} MB`);
    }

    // BullMQ failed jobs
    try {
      const { outboundQueue } = await import('./connectors/pipeline/outbound-worker.js');
      const counts = await outboundQueue.getJobCounts('failed');
      if ((counts['failed'] ?? 0) > 50) {
        await sendAlert(`bullmq_failed_${outboundQueue.name}`, `BullMQ очередь <b>${outboundQueue.name}</b>: ${counts['failed']} failed jobs`);
      }
    } catch {
      // Queues not initialized
    }

    try {
      const { getPostPaymentQueue } = await import('./post-payment-queue.service.js');
      const ppq = getPostPaymentQueue();
      const counts = await ppq.getJobCounts('failed');
      if ((counts['failed'] ?? 0) > 10) {
        await sendAlert('bullmq_failed_post_payment', `⚠️ Post-payment очередь: ${counts['failed']} failed jobs — возможна потеря side-effects!`);
      }
    } catch {
      // Post-payment queue not initialized
    }

    try {
      const { getVoiceOtpDispatchQueue } = await import('./voice-otp-dispatcher.service.js');
      const queue = getVoiceOtpDispatchQueue();
      const counts = await queue.getJobCounts('failed');
      if ((counts['failed'] ?? 0) > 5) {
        await sendAlert('bullmq_failed_voice_otp', `⚠️ Voice OTP dispatcher: ${counts['failed']} failed jobs — возможна деградация phone auth.`);
      }
    } catch {
      // Voice OTP queue not initialized
    }

    // Circuit breakers
    try {
      const { getAllBreakers } = await import('../utils/circuit-breaker.js');
      for (const [name, breaker] of getAllBreakers()) {
        if (breaker.getState() === 'OPEN') {
          await sendAlert(`cb_open_${name}`, `Circuit breaker <b>${name}</b> OPEN — канал недоступен.\nОшибка: ${breaker.getLastError()}`);
        }
      }
    } catch {
      // Circuit breakers not initialized
    }
  } catch (err) {
    log.error('Threshold check error', { error: String(err) });
  }
}

export function startMetricsAlerting(): void {
  if (alertInterval) return;
  alertInterval = setInterval(checkThresholds, 60_000);
  // Run first check after 30s (let system stabilize)
  initialCheckTimeout = setTimeout(checkThresholds, 30_000);
  log.info('Metrics alerting started (60s interval)');
}

export function stopMetricsAlerting(): void {
  if (initialCheckTimeout) {
    clearTimeout(initialCheckTimeout);
    initialCheckTimeout = null;
  }
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
  lastAlertTimes.clear();
}
