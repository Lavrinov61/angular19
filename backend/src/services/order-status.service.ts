/**
 * order-status.service.ts — единая точка смены рабочего статуса заказа.
 *
 * Ядро `applyOrderStatusChange` вынесено из PUT /api/orders/photo-print/:orderId/status,
 * чтобы тот же набор побочных эффектов (work_tasks, order_assignments, completed_at,
 * processing_duration) применялся и при ручной смене статуса сотрудником, и при
 * автоматических переходах по событиям согласования результата.
 *
 * `syncOrderStatusForApproval` связывает согласование со статусом заказа:
 *   • отправили фото клиенту на согласование → «Готов» (ready)
 *   • клиент одобрил → «Завершён» (completed)
 *   • клиент запросил правку → откат на «В работе» (processing) + плашка «На доработке» на фронте
 */

import db, { pool } from '../database/db.js';
import type { PoolClient } from 'pg';
import { createLogger } from '../utils/logger.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { recalculateQueue, updateEstimatedTimes } from './queue.service.js';
import type { ApprovalOrderSyncOrderRow, ApprovalOrderSyncSessionRow } from '../types/views/approval-views.js';

const log = createLogger('order-status');

export type OrderWorkStatus =
  | 'new'
  | 'pending_payment'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'cancelled';

/** Статус заказа → статус связанной задачи work_tasks. */
export const ORDER_TASK_STATUS_MAP: Partial<Record<OrderWorkStatus, string>> = {
  processing: 'in_progress',
  ready: 'waiting',
  completed: 'completed',
  cancelled: 'cancelled',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApplyOrderStatusParams {
  /** Человекочитаемый order_id (CRM-...) ИЛИ uuid (photo_print_orders.id). */
  orderRef: string;
  status: OrderWorkStatus;
  /**
   * Кто инициировал смену статуса. id сотрудника — проставляем processed_by/assigned.
   * null/undefined — клиент или система: владельца-обработчика не трогаем.
   */
  actorUserId?: string | null;
}

export interface AppliedOrderStatus {
  id: string;
  order_id: string;
  status: string;
  estimated_ready_at: Date | string | null;
  chat_session_id: string | null;
  contact_email: string | null;
  processing_started_at: Date | string | null;
  processing_duration_minutes: number | null;
  oldStatus: string | null;
}

interface AppliedOrderStatusRow extends Omit<AppliedOrderStatus, 'oldStatus'> {
  old_status: string | null;
}

/**
 * Сменить рабочий статус заказа в одной транзакции вместе со связанными
 * сущностями (work_tasks, order_assignments) и метками времени.
 * Возвращает null, если заказ не найден.
 *
 * Уведомления клиента, пересчёт очереди, гамификация, авто-печать и WS остаются
 * за вызывающим — у ручного и автоматического путей они разные.
 */
export async function applyOrderStatusChange(
  params: ApplyOrderStatusParams,
): Promise<AppliedOrderStatus | null> {
  const { orderRef, status } = params;
  const actorUserId = params.actorUserId ?? null;
  const taskStatus = ORDER_TASK_STATUS_MAP[status];

  return db.transaction(async (client: PoolClient) => {
    const setClauses = ['status = $1', 'updated_at = NOW()'];
    const sqlParams: unknown[] = [status, orderRef];
    const trackProcessor = actorUserId !== null && ['processing', 'ready', 'completed'].includes(status);
    let processorParam: number | null = null;

    if (trackProcessor) {
      processorParam = sqlParams.length + 1;
      sqlParams.push(actorUserId);
      setClauses.push(`processed_by = $${processorParam}`, 'processed_at = NOW()');
    }
    if (status === 'processing' && processorParam !== null) {
      setClauses.push(`assigned_employee_id = COALESCE(assigned_employee_id, $${processorParam})`);
      setClauses.push('assigned_at = COALESCE(assigned_at, NOW())');
    }
    if (status === 'completed') {
      setClauses.push('completed_at = NOW()');
      setClauses.push(`
        processing_duration_minutes = CASE
          WHEN processing_started_at IS NOT NULL
            THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - processing_started_at)) / 60.0)::int)
          ELSE processing_duration_minutes
        END`);
    }

    // ВАЖНО: если один и тот же плейсхолдер использовать как `$2::uuid` и
    // `order_id = $2`, PostgreSQL выводит его тип как uuid → `character varying = uuid`
    // (operator does not exist). Поэтому для varchar-колонки order_id берём отдельный
    // плейсхолдер с тем же значением.
    let targetMatch: string;
    if (UUID_RE.test(orderRef)) {
      const orderRefTextParam = sqlParams.length + 1;
      sqlParams.push(orderRef);
      targetMatch = `(id = $2::uuid OR order_id = $${orderRefTextParam})`;
    } else {
      targetMatch = 'order_id = $2';
    }

    const updatedRow = (await client.query<AppliedOrderStatusRow>(
      `WITH target AS (
         SELECT id, status AS old_status
         FROM photo_print_orders
         WHERE ${targetMatch}
         FOR UPDATE
       ),
       updated AS (
         UPDATE photo_print_orders p
         SET ${setClauses.join(', ')}
         FROM target
         WHERE p.id = target.id
         RETURNING p.id, p.order_id, p.status, p.estimated_ready_at, p.chat_session_id, p.contact_email,
                   p.processing_started_at, p.processing_duration_minutes, target.old_status
       )
       SELECT * FROM updated`,
      sqlParams,
    )).rows[0];

    if (!updatedRow) return null;

    const { old_status, ...rest } = updatedRow;

    // Синхронизируем статус связанной задачи
    if (taskStatus) {
      await client.query(
        `UPDATE work_tasks SET status = $1, updated_at = NOW()
         WHERE print_order_id = $2 AND status NOT IN ('completed', 'cancelled')`,
        [taskStatus, rest.id],
      );
    }

    const assignmentStatus = ({
      processing: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
    } as Record<string, string>)[status];
    if (assignmentStatus) {
      await client.query(
        `UPDATE order_assignments
         SET status = $1::text,
             assigned_to = COALESCE(assigned_to, $2),
             assigned_at = COALESCE(assigned_at, NOW()),
             completed_at = CASE WHEN $4::boolean THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE order_id = $3
           AND status NOT IN ('completed', 'cancelled')`,
        [assignmentStatus, actorUserId, rest.order_id, assignmentStatus === 'completed'],
      );
    }

    return { ...rest, oldStatus: old_status };
  });
}

/** Какие исходные статусы заказа допускают автопереход в target. */
function canAutoTransition(current: string, target: OrderWorkStatus): boolean {
  if (current === target) return false;
  if (current === 'cancelled' || current === 'completed') return false; // финальные не трогаем автоматически
  switch (target) {
    case 'ready':
      return ['new', 'paid', 'pending', 'pending_payment', 'processing', 'ready'].includes(current);
    case 'completed':
      return ['new', 'processing', 'ready'].includes(current);
    case 'processing':
      return ['ready', 'processing'].includes(current);
    default:
      return false;
  }
}

export type ApprovalTrigger = 'sent' | 'reviewed';

/**
 * Подтянуть статус заказа под событие согласования. Никогда не бросает —
 * сбой синка не должен ронять основной поток согласования.
 *
 * trigger='sent'      — отправили галерею клиенту → «Готов».
 * trigger='reviewed'  — клиент ответил: по статусу сессии → «Завершён» или «В работе».
 */
export async function syncOrderStatusForApproval(opts: {
  sessionId: string;
  trigger: ApprovalTrigger;
  actorUserId?: string | null;
}): Promise<void> {
  try {
    const sess = await pool.query<ApprovalOrderSyncSessionRow>(
      `SELECT order_id::text AS order_id, chat_session_id::text AS chat_session_id, status
       FROM photo_approval_sessions WHERE id = $1`,
      [opts.sessionId],
    );
    const row = sess.rows[0];
    if (!row) return;

    let order: ApprovalOrderSyncOrderRow | undefined;
    if (row.order_id) {
      // Раздельные плейсхолдеры: $1 как uuid (для id), $2 как varchar (для order_id),
      // иначе PostgreSQL выведет тип параметра как uuid и `order_id = $1` упадёт с
      // `operator does not exist: character varying = uuid`.
      const byUuid = UUID_RE.test(row.order_id);
      const orderSql = byUuid
        ? 'SELECT order_id, status FROM photo_print_orders WHERE id = $1::uuid OR order_id = $2 LIMIT 1'
        : 'SELECT order_id, status FROM photo_print_orders WHERE order_id = $1 LIMIT 1';
      const ord = await pool.query<ApprovalOrderSyncOrderRow>(
        orderSql,
        byUuid ? [row.order_id, row.order_id] : [row.order_id],
      );
      order = ord.rows[0];
    }
    if (!order && row.chat_session_id) {
      const ord = await pool.query<ApprovalOrderSyncOrderRow>(
        'SELECT order_id, status FROM photo_print_orders WHERE chat_session_id = $1 LIMIT 1',
        [row.chat_session_id],
      );
      order = ord.rows[0];
    }
    if (!order || !order.status) return;
    const current = order.status;

    let target: OrderWorkStatus | null = null;
    if (opts.trigger === 'sent') {
      target = 'ready';
    } else {
      // reviewed: производное от пересчитанного статуса сессии
      if (row.status === 'approved' || row.status === 'completed') {
        target = 'completed';
      } else if (row.status === 'changes_requested' || row.status === 'partially_approved') {
        target = 'processing';
      }
    }

    if (!target || !canAutoTransition(current, target)) return;

    const applied = await applyOrderStatusChange({
      orderRef: order.order_id,
      status: target,
      actorUserId: opts.actorUserId ?? null,
    });
    if (!applied) return;

    log.info('[OrderStatus] авто-переход по согласованию', {
      orderId: applied.order_id,
      from: applied.oldStatus,
      to: applied.status,
      trigger: opts.trigger,
      sessionStatus: row.status,
    });

    // Пересчёт очереди (fire-and-forget)
    recalculateQueue()
      .then(() => updateEstimatedTimes())
      .catch(err => log.error('[OrderStatus] queue recalc error', { error: String(err) }));

    // WS: обновить карточку/панель в CRM (комната операторов)
    try {
      broadcastToRoom('order:status-changed', 'admin:visitor-chats', {
        orderId: applied.order_id,
        orderUuid: applied.id,
        status: applied.status,
        updated_at: new Date().toISOString(),
      });
    } catch { /* pub/sub недоступен */ }
  } catch (err) {
    log.error('[OrderStatus] syncOrderStatusForApproval failed', {
      sessionId: opts.sessionId,
      trigger: opts.trigger,
      error: String(err),
    });
  }
}
