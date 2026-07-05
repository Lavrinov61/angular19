import db from '../database/db.js';
import { NotificationService } from './notification.service.js';
import { logAudit } from './audit.service.js';
import { getAdminAndManagerIds } from '../utils/user-helpers.js';

import { createLogger } from '../utils/logger.js';
const INTERVAL_MS = 10 * 60 * 1000; // 10 минут
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('task-deadline-scheduler.service');

const GENERAL_CHAT_ID = '00000000-0000-0000-0000-000000000001';

interface EscalationTask {
  id: string;
  task_number: number;
  title: string;
  assigned_to: string | null;
  effective_deadline: string;
  current_level: number;
  last_escalated: string | null;
  print_order_id: string | null;
  display_order_id: string | null;
  contact_name: string | null;
}

type EscalationLevel = 1 | 2 | 3 | 4;

const LEVEL_LABELS: Record<EscalationLevel, string> = {
  1: 'warning',
  2: 'overdue',
  3: 'critical',
  4: 'emergency',
};

const LEVEL_TITLES: Record<EscalationLevel, string> = {
  1: 'Срок задачи истекает',
  2: 'Задача просрочена!',
  3: 'КРИТИЧНО: задача просрочена',
  4: 'АВАРИЯ: задача не выполнена',
};

/**
 * 4-level escalation for overdue tasks:
 *
 * Level 1 (warning):   deadline in ≤30 min  → assigned_to notification
 * Level 2 (overdue):   deadline passed       → assigned_to + admins/managers notification + team_chat system message
 * Level 3 (critical):  deadline + 30 min     → assigned_to + admins/managers notification + metadata.is_critical = true
 * Level 4 (emergency): deadline + 60 min     → admins/managers notification
 */
async function processTaskDeadlines(): Promise<void> {
  try {
    const tasks = await db.query<EscalationTask>(
      `SELECT t.id, t.task_number, t.title, t.assigned_to,
              COALESCE(t.sla_deadline, t.due_date) as effective_deadline,
              COALESCE((t.metadata->>'escalation_level')::int, 0) as current_level,
              t.metadata->>'last_escalation_at' as last_escalated,
              t.print_order_id,
              p.order_id as display_order_id,
              p.contact_name
       FROM work_tasks t
       LEFT JOIN photo_print_orders p ON p.id = t.print_order_id
       WHERE t.status NOT IN ('completed', 'cancelled')
         AND COALESCE(t.sla_deadline, t.due_date) IS NOT NULL
         AND COALESCE((t.metadata->>'escalation_level')::int, 0) < 4
       ORDER BY COALESCE(t.sla_deadline, t.due_date) ASC`,
    );

    if (tasks.length === 0) return;

    // Cache admin/manager IDs — reused across all tasks in this cycle
    let adminManagerIds: string[] | null = null;

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };

    for (const task of tasks) {
      try {
        const deadline = new Date(task.effective_deadline);
        const minutesPast = (Date.now() - deadline.getTime()) / 60000;

        let targetLevel: EscalationLevel;
        if (minutesPast < -30) continue;          // too early
        else if (minutesPast < 0) targetLevel = 1;  // warning
        else if (minutesPast < 30) targetLevel = 2; // overdue
        else if (minutesPast < 60) targetLevel = 3; // critical
        else targetLevel = 4;                        // emergency

        if (targetLevel <= task.current_level) continue; // already escalated

        // Lazy-load admin/manager IDs
        if (targetLevel >= 2 && adminManagerIds === null) {
          adminManagerIds = await getAdminAndManagerIds();
        }

        // Update metadata
        const metadataUpdate = targetLevel === 3
          ? `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('escalation_level', $2::int, 'last_escalation_at', NOW()::text, 'is_critical', true)`
          : `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('escalation_level', $2::int, 'last_escalation_at', NOW()::text)`;

        await db.query(
          `UPDATE work_tasks SET metadata = ${metadataUpdate} WHERE id = $1`,
          [task.id, targetLevel],
        );

        // Build notification body
        const orderRef = task.display_order_id ? ` (заказ ${task.display_order_id})` : '';
        const contactRef = task.contact_name ? ` — ${task.contact_name}` : '';
        const body = `#${task.task_number}: ${task.title}${orderRef}${contactRef}`;

        // Determine recipients
        const recipients: string[] = [];
        if (targetLevel <= 3 && task.assigned_to) {
          recipients.push(task.assigned_to);
        }
        if (targetLevel >= 2 && adminManagerIds) {
          for (const adminId of adminManagerIds) {
            if (!recipients.includes(adminId)) {
              recipients.push(adminId);
            }
          }
        }

        // Send notifications
        for (const userId of recipients) {
          await NotificationService.create({
            userId,
            title: LEVEL_TITLES[targetLevel],
            body,
            type: 'task_deadline',
            data: {
              taskId: task.id,
              taskNumber: task.task_number,
              escalationLevel: targetLevel,
              escalationLabel: LEVEL_LABELS[targetLevel],
              printOrderId: task.print_order_id,
              orderId: task.display_order_id,
            },
          });
        }

        // Level 2+: system message in general team chat
        if (targetLevel >= 2 && adminManagerIds && adminManagerIds.length > 0) {
          try {
            await db.query(
              `INSERT INTO staff_messages
                (conversation_id, sender_id, sender_name, content, message_type)
               VALUES ($1, $2, $3, $4, 'text')`,
              [
                GENERAL_CHAT_ID,
                adminManagerIds[0], // use first admin as sender (FK requires valid users.id)
                'Система',
                `[${LEVEL_LABELS[targetLevel].toUpperCase()}] ${body}`,
              ],
            );
          } catch (chatErr) {
            logger.warn(`[TaskDeadline] Failed to send team chat message for task ${task.id}:`, { error: String(chatErr) });
          }
        }

        logAudit({
          action: `task_escalation_${LEVEL_LABELS[targetLevel]}`,
          entityType: 'task',
          entityId: task.id,
          details: {
            taskNumber: task.task_number,
            escalationLevel: targetLevel,
            previousLevel: task.current_level,
            recipientCount: recipients.length,
          },
        });

        counts[targetLevel]++;
      } catch (err) {
        logger.error(`[TaskDeadline] Escalation failed for task ${task.id}:`, { error: String(err) });
      }
    }

    const total = counts[1] + counts[2] + counts[3] + counts[4];
    if (total > 0) {
      logger.info(`[TaskDeadline] Escalated: ${counts[1]} warning, ${counts[2]} overdue, ${counts[3]} critical, ${counts[4]} emergency`);
    }
  } catch (err) {
    logger.error('[TaskDeadline] Processing error:', { error: String(err) });
  }
}

export function startTaskDeadlineScheduler(): void {
  if (intervalHandle) {
    logger.warn('[TaskDeadline] Scheduler already running');
    return;
  }

  logger.info(`[TaskDeadline] Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // Первый запуск через 60 секунд после старта сервера
  setTimeout(() => {
    processTaskDeadlines();
  }, 60_000);

  intervalHandle = setInterval(processTaskDeadlines, INTERVAL_MS);
}

export function stopTaskDeadlineScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[TaskDeadline] Scheduler stopped');
  }
}
