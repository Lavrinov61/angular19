import db from '../database/db.js';
import { NotificationService } from './notification.service.js';
import { logAudit } from './audit.service.js';

import { createLogger } from '../utils/logger.js';
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('followup-scheduler.service');
interface FollowupRow {
  id: string;
  session_id: string;
  operator_id: string;
  follow_up_at: string;
  note: string | null;
  visitor_name: string | null;
}

async function processFollowups(): Promise<void> {
  try {
    const pending = await db.query<FollowupRow>(
      `SELECT f.id, f.session_id, f.operator_id, f.follow_up_at, f.note,
              s.visitor_name
       FROM chat_followups f
       JOIN conversations s ON s.id = f.session_id
       WHERE f.status = 'pending' AND f.follow_up_at <= NOW()`,
    );

    if (pending.length === 0) return;

    for (const f of pending) {
      try {
        await db.query(
          `UPDATE chat_followups SET status = 'done' WHERE id = $1`,
          [f.id],
        );

        const clientName = f.visitor_name || 'Посетитель';
        const noteText = f.note ? ` — ${f.note}` : '';

        await NotificationService.create({
          userId: f.operator_id,
          title: `Follow-up: ${clientName}`,
          body: `Напоминание вернуться к чату${noteText}`,
          type: 'chat_message',
          data: { sessionId: f.session_id, followupId: f.id },
        });

        logAudit({
          action: 'followup_triggered',
          entityType: 'chat',
          entityId: f.session_id,
          userId: f.operator_id,
          details: { followupId: f.id, note: f.note },
        });
      } catch (err) {
        logger.error(`[Followup] Failed to process followup ${f.id}:`, { error: String(err) });
      }
    }

    logger.info(`[Followup] Processed: ${pending.length} follow-ups`);
  } catch (err) {
    logger.error('[Followup] Processing error:', { error: String(err) });
  }
}

export function startFollowupScheduler(): void {
  if (intervalHandle) {
    logger.warn('[Followup] Scheduler already running');
    return;
  }

  logger.info(`[Followup] Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  setTimeout(() => {
    processFollowups();
  }, 90_000);

  intervalHandle = setInterval(processFollowups, INTERVAL_MS);
}

export function stopFollowupScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[Followup] Scheduler stopped');
  }
}
