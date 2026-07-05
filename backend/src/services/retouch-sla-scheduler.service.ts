import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('retouch-sla');
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Retouch SLA scheduler — escalates overdue retouch tasks:
 *
 * Level "warning":  past due_date             → priority = 'urgent', sla_level = 'warning'
 * Level "critical": past due_date + 30 min    → sla_level = 'critical'
 * Auto-unassign:    in_progress > 2 hours with no result → reset to 'open'
 */
async function processRetouchSLA(): Promise<void> {
  try {
    // Level 1: past due_date → priority = 'urgent', sla_level = 'warning'
    const warningResult = await db.query(
      `UPDATE work_tasks
       SET priority = 'urgent',
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{sla_level}', '"warning"')
       WHERE task_type = 'retouch'
         AND status IN ('open', 'assigned', 'in_progress')
         AND due_date IS NOT NULL
         AND due_date < NOW()
         AND (metadata->>'sla_level') IS NULL
       RETURNING id, task_number`,
    );

    // Level 2: past due_date + 30 min → sla_level = 'critical'
    const criticalResult = await db.query(
      `UPDATE work_tasks
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{sla_level}', '"critical"')
       WHERE task_type = 'retouch'
         AND status IN ('open', 'assigned', 'in_progress')
         AND due_date IS NOT NULL
         AND due_date < NOW() - INTERVAL '30 minutes'
         AND COALESCE(metadata->>'sla_level', '') = 'warning'
       RETURNING id, task_number`,
    );

    // Auto-unassign stuck tasks: in_progress > 2 hours with no result
    const stuckResult = await db.query(
      `UPDATE work_tasks
       SET status = 'open', assigned_to = NULL, started_at = NULL,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{auto_unassigned}', 'true')
       WHERE task_type = 'retouch'
         AND status = 'in_progress'
         AND started_at < NOW() - INTERVAL '2 hours'
         AND result_photo_url IS NULL
       RETURNING id, task_number`,
    );

    const total = warningResult.length + criticalResult.length + stuckResult.length;
    if (total > 0) {
      logger.info('Retouch SLA processed', {
        warnings: warningResult.length,
        critical: criticalResult.length,
        unassigned: stuckResult.length,
      });
    }
  } catch (err) {
    logger.error('Retouch SLA scheduler error', { error: String(err) });
  }
}

export function startRetouchSLAScheduler(): void {
  if (intervalHandle) {
    logger.warn('Retouch SLA scheduler already running');
    return;
  }

  logger.info(`Retouch SLA scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // Первый запуск через 10 секунд после старта
  setTimeout(processRetouchSLA, 10_000);
  intervalHandle = setInterval(processRetouchSLA, INTERVAL_MS);
}

export function stopRetouchSLAScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Retouch SLA scheduler stopped');
  }
}
