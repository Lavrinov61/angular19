/**
 * Планировщик дедлайнов производственных заказов.
 * Каждые 30 минут проверяет заказы с приближающимся/просроченным дедлайном
 * и создаёт уведомления операторам.
 *
 * Дедупликация: не отправляет повторно если за последние 12ч уже было уведомление.
 */

import db from '../database/db.js';
import { NotificationService } from './notification.service.js';

import { createLogger } from '../utils/logger.js';
const INTERVAL_MS = 30 * 60 * 1000; // 30 минут
const DEDUP_WINDOW_H = 12; // не слать повторно раньше чем через 12ч
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('production-deadline-scheduler.service');
interface DeadlineOrderRow {
  id: string;
  order_number: string;
  deadline_at: string;
  printing_house_name: string | null;
  created_by: string;
  alert_type: 'overdue' | 'approaching';
}

async function processDeadlines(): Promise<void> {
  try {
    const rows = await db.query<DeadlineOrderRow>(`
      SELECT
        po.id,
        po.order_number,
        po.deadline_at,
        ph.name AS printing_house_name,
        po.created_by,
        CASE
          WHEN po.deadline_at < NOW() THEN 'overdue'
          ELSE 'approaching'
        END AS alert_type
      FROM production_orders po
      LEFT JOIN printing_houses ph ON ph.id = po.printing_house_id
      WHERE po.status NOT IN ('completed', 'cancelled', 'returned', 'delivered')
        AND po.deadline_at IS NOT NULL
        AND po.deadline_at < NOW() + INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = po.created_by
            AND n.data->>'productionOrderId' = po.id::text
            AND n.created_at > NOW() - ($1 * INTERVAL '1 hour')
        )
    `, [DEDUP_WINDOW_H]);

    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        const isOverdue = row.alert_type === 'overdue';
        const houseName = row.printing_house_name ?? 'типография';
        const title = isOverdue
          ? `Просрочен заказ ${row.order_number}`
          : `Дедлайн: ${row.order_number}`;
        const body = isOverdue
          ? `Производственный заказ в "${houseName}" просрочен`
          : `Дедлайн заказа в "${houseName}" наступает через 24 ч`;

        await NotificationService.create({
          userId: row.created_by,
          title,
          body,
          type: 'system',
          data: {
            productionOrderId: row.id,
            orderNumber: row.order_number,
            alertType: row.alert_type,
          },
        });
      } catch (err) {
        logger.error(`[ProductionDeadline] Failed to notify for order ${row.id}:`, { error: String(err) });
      }
    }

    logger.info(`[ProductionDeadline] Processed ${rows.length} deadline alerts`);
  } catch (err) {
    logger.error('[ProductionDeadline] Processing error:', { error: String(err) });
  }
}

export function startProductionDeadlineScheduler(): void {
  if (intervalHandle) {
    logger.warn('[ProductionDeadline] Scheduler already running');
    return;
  }

  logger.info(`[ProductionDeadline] Scheduler started (interval: ${INTERVAL_MS / 60000} min)`);

  // Первый запуск через 2 минуты после старта сервера
  setTimeout(() => { processDeadlines(); }, 2 * 60 * 1000);

  intervalHandle = setInterval(processDeadlines, INTERVAL_MS);
}

export function stopProductionDeadlineScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[ProductionDeadline] Scheduler stopped');
  }
}
