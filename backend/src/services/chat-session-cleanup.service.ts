import db from '../database/db.js';
import { logAudit } from './audit.service.js';
import { enqueueCrmEvent } from './crm-event-queue.service.js';
import { createLogger } from '../utils/logger.js';

const INTERVAL_MS = 15 * 60 * 1000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
const logger = createLogger('chat-session-cleanup.service');

interface CleanedSession {
  id: string;
  visitor_name: string | null;
  status: string;
}

/**
 * Автозакрытие отключено — операторы закрывают чаты вручную.
 * Ранее: active → resolved после 8ч без сообщений.
 */
async function processStaleSessions(): Promise<void> {
  // no-op: автозакрытие отключено
}

async function insertSystemMessage(sessionId: string, text: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content)
       VALUES ($1, 'bot', 'Система', 'system', $2)`,
      [sessionId, text],
    );
  } catch (err) {
    logger.error(`[ChatCleanup] Failed to insert system message for ${sessionId}:`, { error: String(err) });
  }
}

export function startChatCleanupScheduler(): void {
  if (intervalHandle) {
    logger.warn('[ChatCleanup] Scheduler already running');
    return;
  }

  logger.info(`[ChatCleanup] Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // Первый запуск через 45 секунд после старта сервера
  initialTimeout = setTimeout(() => {
    processStaleSessions();
  }, 45_000);

  intervalHandle = setInterval(processStaleSessions, INTERVAL_MS);
}

export function stopChatCleanupScheduler(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('[ChatCleanup] Scheduler stopped');
}
