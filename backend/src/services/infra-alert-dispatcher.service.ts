/**
 * Infra Alert Dispatcher — sends unacknowledged critical infra_alerts to Telegram.
 *
 * Runs every 60 seconds on the leader node.
 * Queries recent critical alerts that haven't been notified yet,
 * sends Telegram messages via the existing alerting bot,
 * and marks them as notified (telegram_notified_at).
 */
import db from '../database/db.js';
import { config } from '../config/index.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('infra-alert-dispatcher');

const BOT_TOKEN = config.telegram.botToken;
const ADMIN_CHAT_IDS = config.telegram.adminChatIds;
const INTERVAL_MS = 60_000; // 60 seconds
const ALERT_WINDOW_MINUTES = 10; // look back 10 minutes for unnotified alerts

let intervalHandle: ReturnType<typeof setInterval> | null = null;

interface UnnotifiedAlert {
  id: string;
  studio_name: string;
  agent_name: string | null;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
    log.warn('Telegram alert skipped — no BOT_TOKEN or ADMIN_CHAT_IDS');
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
      log.error('Failed to send Telegram infra alert', { chatId, error: String(err) });
    }
  }
}

function formatAlert(alert: UnnotifiedAlert): string {
  const ts = new Date(alert.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const agentLine = alert.agent_name ? `\nAgent: <code>${alert.agent_name}</code>` : '';
  const detailsLine = alert.details && Object.keys(alert.details).length > 0
    ? `\nDetails: <code>${JSON.stringify(alert.details).slice(0, 300)}</code>`
    : '';

  return [
    `<b>INFRA ALERT [${alert.severity.toUpperCase()}]</b>`,
    `Studio: <b>${alert.studio_name}</b>${agentLine}`,
    `Type: <code>${alert.alert_type}</code>`,
    `${alert.title}${detailsLine}`,
    ts,
  ].join('\n');
}

async function dispatchAlerts(): Promise<void> {
  try {
    const alerts = await db.query<UnnotifiedAlert>(
      `SELECT
         ia.id,
         s.name AS studio_name,
         a.name AS agent_name,
         ia.alert_type,
         ia.severity,
         ia.title,
         ia.details,
         ia.created_at::text
       FROM infra_alerts ia
       JOIN studios s ON s.id = ia.studio_id
       LEFT JOIN agents a ON a.id = ia.agent_id
       WHERE ia.severity = 'critical'
         AND ia.is_acknowledged = FALSE
         AND ia.telegram_notified_at IS NULL
         AND ia.resolved_at IS NULL
         AND ia.created_at > NOW() - INTERVAL '${ALERT_WINDOW_MINUTES} minutes'
       ORDER BY ia.created_at ASC
       LIMIT 20`,
    );

    if (alerts.length === 0) return;

    log.info(`Dispatching ${alerts.length} critical infra alert(s) to Telegram`);

    for (const alert of alerts) {
      const text = formatAlert(alert);
      await sendTelegram(text);

      // Mark as notified
      await db.query(
        `UPDATE infra_alerts SET telegram_notified_at = NOW() WHERE id = $1`,
        [alert.id],
      );
    }
  } catch (err) {
    log.error('Infra alert dispatch error', { error: String(err) });
  }
}

export function startInfraAlertDispatcher(): void {
  if (intervalHandle) {
    log.warn('Infra alert dispatcher already running');
    return;
  }

  log.info(`Infra alert dispatcher started (interval: ${INTERVAL_MS / 1000}s)`);

  // First run after 15s (let system stabilize)
  setTimeout(dispatchAlerts, 15_000);
  intervalHandle = setInterval(dispatchAlerts, INTERVAL_MS);
}

export function stopInfraAlertDispatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Infra alert dispatcher stopped');
  }
}
