/**
 * Scheduler автоматического завершения смен.
 *
 * Запускается каждые 5 минут:
 * 1. Напоминает сотрудникам закрыть employee_shifts, когда текущее время >= 19:45 МСК
 * 2. Завершает вчерашние и более старые employee_shifts, если их не закрыли вручную
 * 3. Закрывает pos_shifts открытые более 12 часов (защита от забытых касс)
 * 4. В 19:45 МСК закрывает ФИСКАЛЬНУЮ смену ATOL (shift_close), пока ПК/POS-агент ещё онлайн.
 *    НЕ трогает pos_shifts/employee_shifts — только фискальная смена на ККТ. Полноэкранное окно
 *    закрытия рабочего дня шлёт лишь check-out (employee_shift) и фискальную смену не закрывает,
 *    а 12-часовой шаг (3) срабатывает ~21:00, когда ПК уже выключен и команда не доходит до ККТ.
 */
import db from '../database/db.js';
import { NotificationService } from './notification.service.js';
import { enqueueShiftFiscalCommand } from './pos-fiscal-command.service.js';
import { enqueueShiftReconciliation } from './pos-reconciliation.service.js';
import { isFiscalShiftOpenForShift } from './pos-fiscal-shift.service.js';
import { POS_AGENT_ONLINE_WINDOW_SECONDS } from './pos-agent-availability.service.js';
import type { CountRow } from '../types/views/pos-views.js';

import { createLogger } from '../utils/logger.js';
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
const WORKDAY_CLOSE_REMINDER_TIME = '19:45:00';
// Время автозакрытия ФИСКАЛЬНОЙ смены ATOL (МСК). Студии закрываются в 19:30, ПК выключают ~20:00 —
// закрываем ФР в 19:45, пока POS-агент ещё онлайн, не дожидаясь 12-часового шага (срабатывает ~21:00).
const EVENING_FISCAL_CLOSE_TIME = '19:45:00';
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('shift-auto-close.service');

interface EmployeeShiftCloseReminderRow {
  id: string;
  employee_id: string;
  employee_name: string;
}

interface StaleEmployeeShiftRow {
  id: string;
  employee_id: string;
  end_time: string;
  shift_date: string;
  employee_name: string;
}

interface StalePosShiftRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_number: number;
}

interface EveningFiscalCloseRow {
  id: string;
  studio_id: string;
  employee_id: string;
  shift_number: number;
}

async function processShiftAutoClose(): Promise<void> {
  try {
    let remindedEmployee = 0;
    let closedEmployee = 0;
    let closedPos = 0;
    let closedFiscalEvening = 0;

    // 1. Employee shifts: active + shift_date=today + Moscow time >= 19:45.
    // Не закрываем смену автоматически в день работы: сотрудник должен закрыть ее сам
    // или отложить напоминание в пульте.
    const reminderShifts = await db.query<EmployeeShiftCloseReminderRow>(
      `SELECT es.id, es.employee_id,
              COALESCE(u.display_name, u.email, 'Сотрудник') as employee_name
       FROM employee_shifts es
       JOIN users u ON u.id = es.employee_id
       WHERE es.shift_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date
         AND es.status = 'active'
         AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::time >= $1::time
         AND NOT EXISTS (
           SELECT 1
           FROM notifications n
           WHERE n.user_id = es.employee_id
             AND n.type = 'shift_reminder'
             AND n.data->>'shiftId' = es.id::text
             AND n.data->>'event' = 'workday_close_due'
             AND n.created_at >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date AT TIME ZONE 'Europe/Moscow')
         )`,
      [WORKDAY_CLOSE_REMINDER_TIME],
    );

    for (const shift of reminderShifts) {
      try {
        const notification = await NotificationService.create({
          userId: shift.employee_id,
          title: 'Закройте рабочий день',
          body: 'Смена по расписанию завершилась в 19:45 МСК. Закройте смену в пульте.',
          type: 'shift_reminder',
          data: { shiftId: shift.id, event: 'workday_close_due', endTime: WORKDAY_CLOSE_REMINDER_TIME },
        });

        if (notification) {
          logger.info(`[ShiftAutoClose] Employee shift ${shift.id} close reminder sent for ${shift.employee_name} (time: ${WORKDAY_CLOSE_REMINDER_TIME})`);
          remindedEmployee++;
        }
      } catch (err) {
        logger.error(`[ShiftAutoClose] Failed to send close reminder for employee shift ${shift.id}:`, { error: String(err) });
      }
    }

    // 2. Employee shifts from previous days: stale active shifts are completed as a cleanup fallback.
    const staleEmployeeShifts = await db.query<StaleEmployeeShiftRow>(
      `SELECT es.id, es.employee_id, es.end_time::text, es.shift_date::text,
              COALESCE(u.display_name, u.email, 'Сотрудник') as employee_name
       FROM employee_shifts es
       JOIN users u ON u.id = es.employee_id
       WHERE es.shift_date < CURRENT_DATE
         AND es.status = 'active'`,
    );

    for (const shift of staleEmployeeShifts) {
      try {
        const updated = await db.queryOne(
          `UPDATE employee_shifts SET status = 'completed', checked_out_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'active'
           RETURNING id`,
          [shift.id],
        );
        if (!updated) continue; // уже завершена другим процессом

        // Кэшировать все итоги за смену (online + total + commission)
        await db.queryOne(
          `UPDATE employee_shifts SET
             online_earnings = COALESCE(online_sub.amount, 0),
             online_count = COALESCE(online_sub.cnt, 0),
             sales_total = COALESCE(all_sub.total, 0),
             commission_total = COALESCE(all_sub.commission, 0),
             receipts_count = COALESCE(all_sub.cnt, 0)
           FROM (
             SELECT COALESCE(SUM(receipt_total), 0) as amount, COUNT(*) as cnt
             FROM employee_sales WHERE shift_id = $1 AND source = 'online'
           ) online_sub,
           (
             SELECT COALESCE(SUM(receipt_total), 0) as total,
                    COALESCE(SUM(commission_amount), 0) as commission,
                    COUNT(*) as cnt
             FROM employee_sales WHERE shift_id = $1
           ) all_sub
          WHERE employee_shifts.id = $1`,
          [shift.id],
        );

        try {
          await NotificationService.create({
            userId: shift.employee_id,
            title: 'Рабочий день завершён автоматически',
            body: `Смена за ${shift.shift_date} автоматически завершена как незакрытая с прошлого дня`,
            type: 'shift_reminder',
            data: { shiftId: shift.id, autoClose: true },
          });
        } catch { /* уведомление некритично */ }

        logger.info(`[ShiftAutoClose] Stale employee shift ${shift.id} auto-completed for ${shift.employee_name} (date: ${shift.shift_date})`);
        closedEmployee++;
      } catch (err) {
        logger.error(`[ShiftAutoClose] Failed to close employee shift ${shift.id}:`, { error: String(err) });
      }
    }

    // 3. POS shifts: open + открыты более 12 часов (защита от забытых касс)
    const stalePosShifts = await db.query<StalePosShiftRow>(
      `SELECT id, employee_id, studio_id, shift_number FROM pos_shifts
       WHERE status = 'open'
         AND opened_at < NOW() - INTERVAL '12 hours'`,
    );

    for (const ps of stalePosShifts) {
      try {
        const fiscalShiftWasOpen = await isFiscalShiftOpenForShift(ps.id);
        const updated = await db.queryOne(
          `UPDATE pos_shifts SET
             status = 'closed',
             closed_at = NOW(),
             notes = COALESCE(notes || ' ', '') || '[Автозакрытие: смена открыта более 12 часов]'
           WHERE id = $1 AND status = 'open'
           RETURNING id`,
          [ps.id],
        );
        if (!updated) continue;

        try {
          await NotificationService.create({
            userId: ps.employee_id,
            title: 'Кассовая смена закрыта автоматически',
            body: `Кассовая смена #${ps.shift_number} закрыта: открыта более 12 часов`,
            type: 'shift_reminder',
            data: { posShiftId: ps.id, shiftNumber: ps.shift_number, autoClose: true },
          });
        } catch { /* некритично */ }

        const openPosShifts = await db.queryOne<CountRow>(
          `SELECT COUNT(*)::text AS count
           FROM pos_shifts
           WHERE status = 'open' AND studio_id = $1`,
          [ps.studio_id],
        );
        const isLastShiftOfStudio = parseInt(openPosShifts?.count || '0', 10) === 0;
        if (isLastShiftOfStudio && fiscalShiftWasOpen) {
          const fiscalTransactionId = await enqueueShiftFiscalCommand(ps.studio_id, 'shift_close', ps.employee_id);
          if (fiscalTransactionId) {
            logger.info(`[ShiftAutoClose] Fiscal shift_close enqueued for POS shift ${ps.id} (#${ps.shift_number})`, {
              fiscalTransactionId,
              studioId: ps.studio_id,
            });
          } else {
            logger.warn(`[ShiftAutoClose] Fiscal shift_close was needed but no active POS-agent was available for POS shift ${ps.id}`, {
              studioId: ps.studio_id,
            });
          }
        }

        // Контур #2: сверка эквайринга (op59) при авто-закрытии последней смены студии.
        // Рядом с Z-отчётом, консистентно с роутом /pos/shifts/close и check-out.
        // Идемпотентна по shift_id, дедуплицирует op59; не блокирует цикл авто-закрытия.
        if (isLastShiftOfStudio) {
          await enqueueShiftReconciliation(ps.id, ps.studio_id).catch((reconErr: unknown) => {
            logger.error(`[ShiftAutoClose] Shift reconciliation enqueue failed for POS shift ${ps.id}`, {
              studioId: ps.studio_id,
              error: String(reconErr),
            });
          });
        }

        logger.info(`[ShiftAutoClose] POS shift ${ps.id} (#${ps.shift_number}) auto-closed (>12h)`);
        closedPos++;
      } catch (err) {
        logger.error(`[ShiftAutoClose] Failed to close POS shift ${ps.id}:`, { error: String(err) });
      }
    }

    // 4. ФИСКАЛЬНАЯ смена ATOL: автозакрытие в 19:45 МСК, пока ПК/POS-агент ещё онлайн.
    //    Закрываем ТОЛЬКО фискальную смену (shift_close) — pos_shifts/employee_shifts не трогаем,
    //    чтобы кассир мог отдельно свести наличные и закрыть кассу в БД.
    const eveningFiscalShifts = await db.query<EveningFiscalCloseRow>(
      `SELECT ps.id, ps.studio_id, ps.employee_id, ps.shift_number
       FROM pos_shifts ps
       WHERE ps.status = 'open'
         AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::time >= $1::time
         AND EXISTS (
           SELECT 1 FROM agents a
           WHERE a.studio_id = ps.studio_id
             AND a.agent_type = 'pos'
             AND a.is_active = true
             AND a.is_online = true
             AND a.last_heartbeat_at IS NOT NULL
             AND a.last_heartbeat_at >= NOW() - ($2::int * INTERVAL '1 second')
         )
         AND NOT EXISTS (
           SELECT 1 FROM pos_transactions pt
           WHERE pt.studio_id = ps.studio_id
             AND pt.transaction_type = 'shift_close'
             AND pt.initiated_at >= NOW() - INTERVAL '30 minutes'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pos_transactions pt
           WHERE pt.studio_id = ps.studio_id
             AND pt.transaction_type IN ('fiscal_sale', 'fiscal_refund')
             AND pt.initiated_at >= NOW() - INTERVAL '5 minutes'
         )
       ORDER BY ps.studio_id, ps.opened_at`,
      [EVENING_FISCAL_CLOSE_TIME, POS_AGENT_ONLINE_WINDOW_SECONDS],
    );

    const eveningProcessedStudios = new Set<string>();
    for (const ps of eveningFiscalShifts) {
      if (eveningProcessedStudios.has(ps.studio_id)) continue; // один ФР на студию
      eveningProcessedStudios.add(ps.studio_id);
      try {
        // Фискальная смена ещё открыта на ККТ? (телеметрия / последняя завершённая команда)
        if (!(await isFiscalShiftOpenForShift(ps.id))) continue;

        const fiscalTransactionId = await enqueueShiftFiscalCommand(ps.studio_id, 'shift_close', ps.employee_id);
        if (!fiscalTransactionId) {
          logger.warn(`[ShiftAutoClose] Evening fiscal shift_close skipped — no online POS-agent for studio ${ps.studio_id}`, {
            studioId: ps.studio_id,
            posShiftId: ps.id,
          });
          continue;
        }

        try {
          await NotificationService.create({
            userId: ps.employee_id,
            title: 'Фискальная смена закрыта автоматически',
            body: `Смена ККТ закрыта автоматически в ${EVENING_FISCAL_CLOSE_TIME.slice(0, 5)} МСК. Касса в БД остаётся за вами — сверьте наличные и закройте смену.`,
            type: 'shift_reminder',
            data: { posShiftId: ps.id, shiftNumber: ps.shift_number, fiscalTransactionId, autoClose: true, scope: 'fiscal_evening' },
          });
        } catch { /* уведомление некритично */ }

        logger.info(`[ShiftAutoClose] Evening fiscal shift_close enqueued for studio ${ps.studio_id} (POS shift #${ps.shift_number})`, {
          fiscalTransactionId,
          studioId: ps.studio_id,
          posShiftId: ps.id,
        });
        closedFiscalEvening++;
      } catch (err) {
        logger.error(`[ShiftAutoClose] Failed evening fiscal shift_close for studio ${ps.studio_id}:`, { error: String(err) });
      }
    }

    if (remindedEmployee > 0 || closedEmployee > 0 || closedPos > 0 || closedFiscalEvening > 0) {
      logger.info(`[ShiftAutoClose] Done: ${remindedEmployee} employee reminders, ${closedEmployee} stale employee shifts, ${closedPos} POS shifts auto-closed, ${closedFiscalEvening} evening fiscal shifts closed`);
    }
  } catch (err) {
    logger.error('[ShiftAutoClose] Processing error:', { error: String(err) });
  }
}

export function startShiftAutoCloseScheduler(): void {
  if (intervalHandle) {
    logger.warn('[ShiftAutoClose] Scheduler already running');
    return;
  }

  logger.info(`[ShiftAutoClose] Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // Первый запуск через 2 минуты после старта сервера (не блокируем init)
  setTimeout(() => { processShiftAutoClose(); }, 2 * 60_000);

  intervalHandle = setInterval(processShiftAutoClose, INTERVAL_MS);
}

export function stopShiftAutoCloseScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[ShiftAutoClose] Scheduler stopped');
  }
}
