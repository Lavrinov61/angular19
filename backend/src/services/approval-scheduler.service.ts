/**
 * F14: Approval SLA Scheduler (leader-only)
 *
 * - Every 15 min: check for overdue approval sessions
 * - Reminder at SLA breach → notification to photographer
 * - Auto-expire at 2× SLA → mark session expired, notify
 */

import db from '../database/db.js';
import { NotificationService } from './notification.service.js';

import { createLogger } from '../utils/logger.js';
let intervalId: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('approval-scheduler.service');
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function checkApprovalSLA(): Promise<void> {
  try {
    // 1. Send reminders for sessions past SLA but not yet expired
    const overdueForReminder = await db.query<{
      id: string; photographer_id: string; client_name: string; title: string;
      sla_hours: number; created_at: string;
    }>(
      `SELECT id, photographer_id, client_name, title, sla_hours, created_at
       FROM photo_approval_sessions
       WHERE status IN ('pending', 'in_review')
         AND expired_at IS NULL
         AND reminder_sent_at IS NULL
         AND created_at + (sla_hours || ' hours')::interval < NOW()`,
      []
    );

    for (const s of overdueForReminder) {
      await db.query(
        `UPDATE photo_approval_sessions SET reminder_sent_at = NOW() WHERE id = $1`,
        [s.id]
      );

      NotificationService.create({
        userId: s.photographer_id,
        title: 'Просрочено согласование',
        body: `Клиент "${s.client_name}" не ответил по "${s.title}" (SLA: ${s.sla_hours}ч)`,
        type: 'retouch_approval',
        data: { session_id: s.id },
      }).catch(err => logger.error('[ApprovalSLA] notification error', { error: String(err) }));

      logger.info(`[ApprovalSLA] Reminder sent for session ${s.id} (${s.client_name})`);
    }

    // 2. Auto-expire sessions past 2× SLA
    const expiredSessions = await db.query<{
      id: string; photographer_id: string; client_name: string; title: string;
      sla_hours: number;
    }>(
      `SELECT id, photographer_id, client_name, title, sla_hours
       FROM photo_approval_sessions
       WHERE status IN ('pending', 'in_review')
         AND expired_at IS NULL
         AND created_at + ((sla_hours * 2) || ' hours')::interval < NOW()`,
      []
    );

    for (const s of expiredSessions) {
      await db.query(
        `UPDATE photo_approval_sessions
         SET expired_at = NOW(), status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [s.id]
      );

      NotificationService.create({
        userId: s.photographer_id,
        title: 'Согласование истекло',
        body: `Сессия "${s.title}" для "${s.client_name}" автоматически закрыта по таймауту`,
        type: 'retouch_approval',
        data: { session_id: s.id },
      }).catch(err => logger.error('[ApprovalSLA] notification error', { error: String(err) }));

      logger.info(`[ApprovalSLA] Session ${s.id} expired (${s.client_name})`);
    }
  } catch (err) {
    logger.error('[ApprovalSLA] scheduler error:', { error: String(err) });
  }
}

export function startApprovalScheduler(): void {
  if (intervalId) return;
  checkApprovalSLA();
  intervalId = setInterval(checkApprovalSLA, INTERVAL_MS);
  logger.info('[ApprovalSLA] Scheduler started (every 15 min)');
}

export function stopApprovalScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[ApprovalSLA] Scheduler stopped');
  }
}
