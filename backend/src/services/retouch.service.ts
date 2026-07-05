/**
 * retouch.service.ts — Business logic for retouch task flow.
 * Manages retouch task lifecycle: create → assign → start → upload → approve/reject.
 */

import db from '../database/db.js';
import { pool } from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type WorkTasks from '../types/generated/public/WorkTasks.js';
import type { CrmRetouchTaskMetadata } from '../types/jsonb/task-metadata.js';
import type {
  BestRetoucherRow,
  RetouchHistoryMetadata,
  RetouchStatsResult,
  RetouchStatsSummaryRow,
  RetoucherStatsRow,
} from '../types/views/retouch-views.js';
import { computeRetouchDeadline, normalizeRetouchDeadlineMinutes } from './retouch-deadline.service.js';
import crypto from 'crypto';

const log = createLogger('retouch');

/**
 * Свежее окно SLA при доработке (минуты). Когда клиент просит доработку,
 * обратный отсчёт на карточке заказа сбрасывается на это окно. Конфигурируемо
 * через RETOUCH_REVISION_DEADLINE_MINUTES, по умолчанию 2 часа.
 */
const REVISION_DEADLINE_MINUTES = Number(process.env['RETOUCH_REVISION_DEADLINE_MINUTES']) || 120;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateRetouchTaskData {
  order_id?: string;
  print_order_id?: string;
  chat_session_id?: string;
  client_name?: string;
  client_phone?: string;
  studio_id?: string;
  retouch_level: string;
  retouch_options?: unknown[];
  source_photo_url: string;
  document_type?: string;
  priority?: string;
  deadline_minutes?: number | string;
  notes?: string;
  created_by: string;
}

export interface RetouchQueueFilters {
  status?: string;
  assigned_to?: string;
  studio_id?: string;
  order_id?: string;
  requesting_user_id?: string;
}

export interface RetouchTaskRow {
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  retouch_level: string;
  retouch_options: unknown[];
  source_photo_url: string;
  result_photo_url: string | null;
  revision_count: number;
  assigned_to: string | null;
  assigned_studio_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  order_id: string | null;
  approval_session_id: string | null;
  chat_session_id: string | null;
  due_date: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  retoucher_name: string | null;
  studio_name: string | null;
  approval_token: string | null;
  approval_status: string | null;
  total_photos: number | null;
  approved_count: number | null;
  rejected_count: number | null;
}

// ─── Auto-assign retoucher ──────────────────────────────────────────────────

export async function findBestRetoucher(studioId?: string): Promise<BestRetoucherRow | null> {
  const result = await db.queryOne<BestRetoucherRow>(`
    WITH retouchers AS (
      SELECT u.id, u.display_name
      FROM users u
      WHERE u.is_active = true
        AND (u.role = 'admin' OR 'retoucher' = ANY(u.skills))
    ),
    on_shift AS (
      SELECT es.employee_id, es.studio_id
      FROM employee_shifts es
      INNER JOIN studios s ON s.id = es.studio_id
      LEFT JOIN studio_schedule_exceptions ex
        ON ex.studio_id = es.studio_id
       AND ex.exception_date = es.shift_date
      WHERE es.shift_date = CURRENT_DATE
        AND es.status IN ('scheduled', 'active')
        AND ((es.shift_date::date + es.end_time::time) AT TIME ZONE COALESCE(s.timezone, 'Europe/Moscow')) > NOW()
        AND (
          COALESCE(s.status, 'open') = 'open'
          OR (s.status_until IS NOT NULL AND s.status_until < es.shift_date)
        )
        AND COALESCE(ex.is_closed, false) = false
    ),
    workload AS (
      SELECT assigned_to, COUNT(*) AS active_count
      FROM work_tasks
      WHERE task_type = 'retouch'
        AND status IN ('open', 'assigned', 'in_progress', 'waiting')
        AND assigned_to IS NOT NULL
      GROUP BY assigned_to
    )
    SELECT
      r.id AS retoucher_id,
      r.display_name
    FROM retouchers r
    INNER JOIN on_shift os ON os.employee_id = r.id
    LEFT JOIN workload w ON w.assigned_to = r.id
    ORDER BY
      CASE WHEN $1::text IS NOT NULL AND os.studio_id::text = $1::text THEN 0 ELSE 1 END,
      COALESCE(w.active_count, 0) ASC
    LIMIT 1
  `, [studioId ?? null]);

  return result;
}

// ─── History helper ─────────────────────────────────────────────────────────

async function insertHistory(
  taskId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string | null,
  reason?: string,
  metadata?: RetouchHistoryMetadata,
): Promise<void> {
  await db.query(
    `INSERT INTO retouch_task_history (task_id, from_status, to_status, changed_by, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [taskId, fromStatus, toStatus, changedBy, reason || null, JSON.stringify(metadata || {})],
  );
}

// ─── Revision (доработка) ─────────────────────────────────────────────────────

/**
 * Регистрирует доработку по сессии согласования: возвращает связанную задачу
 * ретуши (status='waiting') в работу, инкрементирует revision_count, обнуляет
 * результат и СБРАСЫВАЕТ обратный отсчёт (sla_deadline/due_date на свежее окно).
 * Идемпотентно по природе: действует только пока задача в статусе 'waiting' —
 * повторный вызов в той же сессии вернёт null (задача уже in_progress).
 *
 * Очередь заказов читает дедлайн как COALESCE(t.sla_deadline, ...), поэтому
 * сброс sla_deadline сразу отражается обратным отсчётом на карточке заказа.
 *
 * @returns { taskId } если задача найдена и обновлена, иначе null.
 */
export async function markRetouchRevision(params: {
  approvalSessionId: string;
  reason: string | null;
  changedBy: string | null;
}): Promise<{ taskId: string } | null> {
  const task = await db.queryOne<Pick<WorkTasks, 'id'>>(
    `SELECT id FROM work_tasks
     WHERE approval_session_id = $1 AND task_type = 'retouch' AND status = 'waiting'`,
    [params.approvalSessionId],
  );
  if (!task) return null;

  await db.query(
    `UPDATE work_tasks
        SET status = 'in_progress',
            revision_count = revision_count + 1,
            result_photo_url = NULL,
            sla_deadline = NOW() + (INTERVAL '1 minute' * $2::int),
            due_date = NOW() + (INTERVAL '1 minute' * $2::int),
            updated_at = NOW()
      WHERE id = $1`,
    [task.id, REVISION_DEADLINE_MINUTES],
  );

  await insertHistory(
    String(task.id), 'waiting', 'in_progress', params.changedBy,
    params.reason || 'Клиент запросил доработку',
  ).catch(err => log.error('[Retouch] revision history error', { error: String(err) }));

  return { taskId: String(task.id) };
}

// ─── Create retouch task ────────────────────────────────────────────────────

export async function createRetouchTask(data: CreateRetouchTaskData): Promise<{
  id: string;
  task_number: number;
  status: string;
  assigned_to: string | null;
  retoucher_name: string | null;
  approval_session_id: string;
}> {
  const deadlineMinutes = normalizeRetouchDeadlineMinutes(data.deadline_minutes);
  const dueDate = deadlineMinutes
    ? await computeRetouchDeadline(deadlineMinutes, { studioId: data.studio_id })
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const title = data.document_type
      ? `Ретушь: ${data.document_type}`
      : `Ретушь: ${data.retouch_level}`;

    // 1. INSERT work_task
    const taskResult = await client.query<{
      id: string; task_number: number; status: string;
    }>(
      `INSERT INTO work_tasks (
         task_type, title, retouch_level, retouch_options, source_photo_url,
         priority, order_id, print_order_id, chat_session_id, client_name, client_phone,
         assigned_studio_id, due_date, description, created_by
       ) VALUES (
         'retouch', $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14
       ) RETURNING id, task_number, status`,
      [
        title,
        data.retouch_level,
        JSON.stringify(data.retouch_options || []),
        data.source_photo_url,
        data.priority || 'normal',
        data.order_id || null,
        data.print_order_id || null,
        data.chat_session_id || null,
        data.client_name || null,
        data.client_phone || null,
        data.studio_id || null,
        dueDate,
        data.notes || null,
        data.created_by,
      ],
    );
    const task = taskResult.rows[0];

    // 2. Create photo_approval_session
    const publicToken = crypto.randomBytes(24).toString('hex');
    const sessionResult = await client.query<{ id: string }>(
      `INSERT INTO photo_approval_sessions (
         public_token, client_name, client_phone, chat_session_id,
         title, status, total_photos
       ) VALUES ($1, $2, $3, $4, $5, 'pending', 1)
       RETURNING id`,
      [
        publicToken,
        data.client_name || null,
        data.client_phone || null,
        data.chat_session_id || null,
        title,
      ],
    );
    const approvalSessionId = sessionResult.rows[0].id;

    // 3. Create photo_approvals record (source photo)
    await client.query(
      `INSERT INTO photo_approvals (
         approval_session_id, original_photo_url, status, revision_round
       ) VALUES ($1, $2, 'pending', 1)`,
      [approvalSessionId, data.source_photo_url],
    );

    // 4. Link approval session to task
    await client.query(
      `UPDATE work_tasks SET approval_session_id = $1 WHERE id = $2`,
      [approvalSessionId, task.id],
    );

    // 5. Auto-assign retoucher (NO FALLBACK — if none on shift, task stays open)
    let assignedTo: string | null = null;
    let retoucherName: string | null = null;
    const retoucher = await findBestRetoucher(data.studio_id);
    if (retoucher) {
      assignedTo = retoucher.retoucher_id;
      retoucherName = retoucher.display_name;
      await client.query(
        `UPDATE work_tasks SET assigned_to = $1, status = 'assigned' WHERE id = $2`,
        [assignedTo, task.id],
      );
      task.status = 'assigned';
    }

    await client.query('COMMIT');

    // 6. History (outside transaction — non-critical)
    await insertHistory(task.id, null, task.status, data.created_by, 'Задача создана').catch(
      err => log.error('[Retouch] History insert error', { error: String(err) }),
    );

    log.info(`[Retouch] Created task #${task.task_number}, assigned_to=${assignedTo || 'none'}`);

    return {
      id: task.id,
      task_number: task.task_number,
      status: task.status,
      assigned_to: assignedTo,
      retoucher_name: retoucherName,
      approval_session_id: approvalSessionId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Create retouch task from POS (lightweight, no approval session) ─────────

export interface CreateRetouchTaskFromPosParams {
  receipt_id: string;
  receipt_number: string;
  studio_id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  gender?: string | null;
  /** Resolved options snapshot ([{group, group_name, slug, label}]). */
  retouch_options: unknown[];
  notes?: string | null;
  created_by: string;
}

/**
 * Лёгкое создание задачи ретуши из POS-чека «Супер обработки».
 * В отличие от createRetouchTask: БЕЗ photo_approval_session и без авто-назначения —
 * это просто лист-задание для ретушёра (связь «оплата → работа»).
 * Вызывается fire-and-forget после createReceipt; задача создаётся ВСЕГДА при processing-super,
 * даже если retouch_options пуст (P0-2) — title несёт № чека + клиента.
 */
export async function createRetouchTaskFromPos(
  params: CreateRetouchTaskFromPosParams,
): Promise<Pick<WorkTasks, 'id' | 'task_number' | 'status'>> {
  const clientLabel = params.client_name?.trim()
    || params.client_phone?.trim()
    || `чек ${params.receipt_number}`;
  // Колонки: title/client_name — varchar(255), client_phone — varchar(20).
  // Подрезаем, чтобы длинный ввод не уронил INSERT и не потерял задачу (P2-2).
  const title = `Супер обработка — ${clientLabel}`.slice(0, 255);
  const clientName = params.client_name ? params.client_name.slice(0, 255) : null;
  const clientPhone = params.client_phone ? params.client_phone.slice(0, 20) : null;

  const result = await db.queryOne<Pick<WorkTasks, 'id' | 'task_number' | 'status'>>(
    `INSERT INTO work_tasks (
       task_type, status, title, description, retouch_level, retouch_options,
       source_photo_url, order_id, assigned_studio_id,
       client_name, client_phone, metadata, created_by
     ) VALUES (
       'retouch', 'open', $1, $2, 'super', $3,
       NULL, NULL, $4,
       $5, $6, $7, $8
     ) RETURNING id, task_number, status`,
    [
      title,
      params.notes?.trim() || null,
      JSON.stringify(params.retouch_options ?? []),
      params.studio_id || null,
      clientName,
      clientPhone,
      JSON.stringify({
        source: 'pos',
        receipt_id: params.receipt_id,
        receipt_number: params.receipt_number,
        studio_id: params.studio_id ?? null,
        gender: params.gender ?? 'any',
        item_count: Array.isArray(params.retouch_options) ? params.retouch_options.length : 0,
      }),
      params.created_by,
    ],
  );

  if (!result) {
    throw new AppError(500, 'Не удалось создать задачу ретуши из POS');
  }

  log.info(`[Retouch] Created POS task #${result.task_number} for receipt ${params.receipt_number}`);

  return result;
}

// ─── Create retouch task from CRM order (lightweight, no approval session) ────

export interface CreateRetouchTaskFromCrmParams {
  /** UUID заказа из photo_print_orders (FK print_order_id — НЕ человекочитаемый order_id). */
  print_order_id: string;
  /** Человекочитаемый ярлык заказа (CRM-YYMMDD-XXXX) — для title/metadata. */
  order_id_label: string;
  studio_id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  chat_session_id?: string | null;
  gender?: string | null;
  /** Resolved options snapshot ([{group, group_name, slug, label}]). */
  retouch_options: unknown[];
  notes?: string | null;
  created_by: string;
}

type CreatedRetouchTaskRow = Pick<WorkTasks, 'id' | 'task_number' | 'status'>;

/**
 * Лёгкое создание задачи ретуши из CRM-заказа «Супер обработки».
 * Зеркало createRetouchTaskFromPos, но связь идёт по print_order_id (FK на photo_print_orders),
 * а НЕ по order_id (человекочитаемый ярлык). БЕЗ photo_approval_session и без авто-назначения —
 * это лист-задание для ретушёра (связь «CRM-заказ → работа»).
 * Вызывается fire-and-forget после COMMIT заказа; задача создаётся ВСЕГДА при processing-super,
 * даже если retouch_options пуст (P0-2) — title несёт № заказа + клиента.
 * Дедуп по print_order_id (как createRetouchTaskFromPayment): двойной сабмит не плодит задачи.
 */
export async function createRetouchTaskFromCrm(
  params: CreateRetouchTaskFromCrmParams,
): Promise<CreatedRetouchTaskRow | null> {
  // 1. Дедуп ПЕРЕД INSERT — если задача ретуши на этот print_order уже есть, выходим.
  const existing = await db.queryOne<Pick<WorkTasks, 'id'>>(
    `SELECT id FROM work_tasks WHERE print_order_id = $1 AND task_type = 'retouch'`,
    [params.print_order_id],
  );
  if (existing) {
    log.info(`[Retouch] CRM task already exists for order ${params.order_id_label}`);
    return null;
  }

  const clientLabel = params.client_name?.trim()
    || params.client_phone?.trim()
    || `заказ ${params.order_id_label}`;
  // Колонки: title/client_name — varchar(255), client_phone — varchar(20).
  // Подрезаем, чтобы длинный ввод не уронил INSERT и не потерял задачу (P2-2).
  const title = `Супер обработка — ${clientLabel}`.slice(0, 255);
  const clientName = params.client_name ? params.client_name.slice(0, 255) : null;
  const clientPhone = params.client_phone ? params.client_phone.slice(0, 20) : null;

  const metadata: CrmRetouchTaskMetadata = {
    source: 'crm',
    order_id_label: params.order_id_label,
    gender: params.gender ?? 'any',
    item_count: Array.isArray(params.retouch_options) ? params.retouch_options.length : 0,
    chat_session_id: params.chat_session_id ?? null,
  };

  const result = await db.queryOne<CreatedRetouchTaskRow>(
    `INSERT INTO work_tasks (
       task_type, status, title, description, retouch_level, retouch_options,
       source_photo_url, order_id, print_order_id, assigned_studio_id,
       client_name, client_phone, chat_session_id, metadata, created_by
     ) VALUES (
       'retouch', 'open', $1, $2, 'super', $3,
       NULL, NULL, $4, $5,
       $6, $7, $8, $9, $10
     ) RETURNING id, task_number, status`,
    [
      title,
      params.notes?.trim() || null,
      JSON.stringify(params.retouch_options ?? []),
      params.print_order_id,
      params.studio_id || null,
      clientName,
      clientPhone,
      params.chat_session_id || null,
      JSON.stringify(metadata),
      params.created_by,
    ],
  );

  if (!result) {
    throw new AppError(500, 'Не удалось создать задачу ретуши из CRM');
  }

  log.info(`[Retouch] Created CRM task #${result.task_number} for order ${params.order_id_label}`);

  return result;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface StringFieldSource {
  [field: string]: unknown;
}

function isRecord(val: unknown): val is StringFieldSource {
  return typeof val === 'object' && val !== null;
}

function getStringField(obj: unknown, field: string): string {
  if (isRecord(obj) && typeof obj[field] === 'string') return obj[field];
  return '';
}

// ─── Auto-create from payment ──────────────────────────────────────────────

export async function createRetouchTaskFromPayment(data: {
  orderId: string;
  orderDbId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  chatSessionId?: string | null;
  items?: unknown[];
  priority?: string;
}): Promise<void> {
  // 1. Deduplicate — skip if retouch task already exists for this print order (UUID)
  const existing = await db.queryOne<Pick<WorkTasks, 'id'>>(
    `SELECT id FROM work_tasks WHERE print_order_id = $1 AND task_type = 'retouch'`,
    [data.orderDbId],
  );
  if (existing) {
    log.info('Retouch task already exists for order', { orderId: data.orderId });
    return;
  }

  // 2. Extract source photo URL from items
  const items = Array.isArray(data.items) ? data.items : [];
  let sourcePhotoUrl = '';
  for (const item of items) {
    const url = getStringField(item, 'uploadedUrl');
    if (url) { sourcePhotoUrl = url; break; }
  }

  // 3. Determine retouch level from item names
  let retouchLevel: 'basic' | 'extended' | 'maximum' = 'basic';
  const retouchOptions: string[] = [];
  for (const item of items) {
    const name = getStringField(item, 'name').toLowerCase();
    if (name.includes('расширенн')) retouchLevel = 'extended';
    if (name.includes('максимальн')) retouchLevel = 'maximum';
    if (name.includes('чистка лица')) retouchOptions.push('face_cleanup');
    if (name.includes('чистка фона')) retouchOptions.push('background_cleanup');
    if (name.includes('выравнивание плеч')) retouchOptions.push('shoulder_align');
    if (name.includes('коррекция причёски') || name.includes('коррекция прически')) retouchOptions.push('hair_fix');
    if (name.includes('коррекция освещения')) retouchOptions.push('color_correction');
    if (name.includes('подстановка формы')) retouchOptions.push('clothing_fix');
  }

  // 4. Determine document type
  let documentType: string | undefined;
  const docTypeMap: [string, string][] = [
    ['паспорт рф', 'passport_rf'],
    ['загранпаспорт', 'passport_intl'],
    ['виза', 'visa'],
    ['гринкарт', 'greencard'], ['green card', 'greencard'],
    ['вод. права', 'drivers_license'], ['водительск', 'drivers_license'],
    ['военный', 'military_id'],
    ['студенческ', 'student_id'],
    ['медкнижк', 'medical_book'],
  ];
  for (const item of items) {
    const name = getStringField(item, 'name').toLowerCase();
    for (const [keyword, docType] of docTypeMap) {
      if (name.includes(keyword)) { documentType = docType; break; }
    }
    if (documentType) break;
  }

  // 5. Create retouch task via existing createRetouchTask
  const result = await createRetouchTask({
    print_order_id: data.orderDbId,
    chat_session_id: data.chatSessionId || undefined,
    client_name: data.contactName || undefined,
    client_phone: data.contactPhone || undefined,
    retouch_level: retouchLevel,
    retouch_options: retouchOptions,
    source_photo_url: sourcePhotoUrl,
    document_type: documentType,
    priority: data.priority === 'urgent' ? 'urgent' : 'normal',
    created_by: 'system',
  });

  log.info('Auto-created retouch task from payment', {
    orderId: data.orderId,
    taskNumber: result.task_number,
    retouchLevel,
    documentType,
    assignedTo: result.assigned_to,
  });
}

// ─── Get retouch queue ──────────────────────────────────────────────────────

export async function getRetouchQueue(filters: RetouchQueueFilters): Promise<RetouchTaskRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`rq.status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.assigned_to) {
    if (filters.assigned_to === 'me' && filters.requesting_user_id) {
      conditions.push(`rq.assigned_to = $${idx++}`);
      params.push(filters.requesting_user_id);
    } else if (filters.assigned_to !== 'me') {
      conditions.push(`rq.assigned_to = $${idx++}`);
      params.push(filters.assigned_to);
    }
  }

  if (filters.studio_id) {
    conditions.push(`rq.assigned_studio_id = $${idx++}`);
    params.push(filters.studio_id);
  }

  if (filters.order_id) {
    const paramRef = `$${idx++}`;
    conditions.push(`(
      rq.order_id::text = ${paramRef}
      OR EXISTS (
        SELECT 1
        FROM work_tasks wt
        LEFT JOIN photo_print_orders p ON p.id = wt.print_order_id
        WHERE wt.id = rq.id
          AND wt.task_type = 'retouch'
          AND (
            p.order_id = ${paramRef}
            OR wt.metadata->>'order_id_label' = ${paramRef}
          )
      )
    )`);
    params.push(filters.order_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query<RetouchTaskRow>(
    `SELECT rq.* FROM retouch_queue rq
     ${where}
     ORDER BY
       CASE rq.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       rq.created_at ASC`,
    params,
  );
}

// ─── Get retouch detail ─────────────────────────────────────────────────────

export async function getRetouchDetail(taskId: string): Promise<{
  task: RetouchTaskRow;
  photos: unknown[];
  history: unknown[];
}> {
  const task = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );
  if (!task) throw new AppError(404, 'Задача ретуши не найдена');

  const photos = await db.query(
    `SELECT id, original_photo_url, retouched_photo_url, thumbnail_url, status, comment, created_at
     FROM photo_approvals
     WHERE approval_session_id = $1
     ORDER BY created_at ASC`,
    [task.approval_session_id],
  );

  const history = await db.query(
    `SELECT h.*, u.display_name as changed_by_name
     FROM retouch_task_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.task_id = $1
     ORDER BY h.created_at DESC`,
    [taskId],
  );

  return { task, photos, history };
}

// ─── Start retouch (take in work) ───────────────────────────────────────────

export async function startRetouch(taskId: string, userId: string): Promise<RetouchTaskRow> {
  // Atomic UPDATE — race condition protection
  const result = await db.queryOne<RetouchTaskRow>(
    `UPDATE work_tasks
     SET status = 'in_progress', assigned_to = $1, started_at = NOW()
     WHERE id = $2 AND status IN ('open', 'assigned')
     RETURNING *`,
    [userId, taskId],
  );

  if (!result) throw new AppError(409, 'Задача уже занята или не найдена');

  await insertHistory(taskId, 'open', 'in_progress', userId, 'Взято в работу').catch(
    err => log.error('[Retouch] History error', { error: String(err) }),
  );

  // Return enriched data from view
  const enriched = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );

  return enriched || result;
}

// ─── Upload result ──────────────────────────────────────────────────────────

export async function uploadResult(
  taskId: string,
  userId: string,
  s3Key: string,
  notes?: string,
): Promise<RetouchTaskRow> {
  // Check ownership
  const task = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );
  if (!task) throw new AppError(404, 'Задача не найдена');
  if (task.assigned_to !== userId) throw new AppError(403, 'Задача назначена другому сотруднику');

  const s3Url = `/media/${s3Key}`;

  // Update task
  await db.query(
    `UPDATE work_tasks SET result_photo_url = $1 WHERE id = $2`,
    [s3Url, taskId],
  );

  // Update photo_approvals
  await db.query(
    `UPDATE photo_approvals SET retouched_photo_url = $1, updated_at = NOW()
     WHERE approval_session_id = $2`,
    [s3Url, task.approval_session_id],
  );

  await insertHistory(taskId, task.status, task.status, userId, notes || 'Результат загружен').catch(
    err => log.error('[Retouch] History error', { error: String(err) }),
  );

  const enriched = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );

  return enriched!;
}

// ─── KPI stats ─────────────────────────────────────────────────────────────

export async function getStats(studioId?: string): Promise<RetouchStatsResult> {
  const params: unknown[] = [];
  let studioFilter = '';
  if (studioId) {
    params.push(studioId);
    studioFilter = `AND assigned_studio_id = $${params.length}`;
  }

  const result = await pool.query<RetouchStatsSummaryRow>(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','assigned')) AS pending,
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'waiting') AS waiting_approval,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) FILTER (WHERE status = 'completed' AND started_at IS NOT NULL))::int AS avg_minutes,
      ROUND(AVG(revision_count) FILTER (WHERE status = 'completed'), 1) AS avg_revisions,
      COUNT(DISTINCT assigned_to) FILTER (WHERE status IN ('in_progress','waiting')) AS active_retouchers
    FROM work_tasks
    WHERE task_type = 'retouch'
      AND created_at >= NOW() - INTERVAL '30 days'
      ${studioFilter}
  `, params);

  const retouchers = await pool.query<RetoucherStatsRow>(`
    SELECT
      t.assigned_to, u.display_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
      ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 60) FILTER (WHERE t.status = 'completed' AND t.started_at IS NOT NULL))::int AS avg_minutes
    FROM work_tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.task_type = 'retouch'
      AND t.assigned_to IS NOT NULL
      AND t.created_at >= NOW() - INTERVAL '30 days'
      ${studioFilter}
    GROUP BY t.assigned_to, u.display_name
    ORDER BY completed DESC
    LIMIT 10
  `, params);

  return {
    summary: result.rows[0] ?? {
      pending: 0,
      in_progress: 0,
      waiting_approval: 0,
      completed: 0,
      cancelled: 0,
      avg_minutes: null,
      avg_revisions: null,
      active_retouchers: 0,
    },
    retouchers: retouchers.rows,
  };
}

// ─── Bulk assign ───────────────────────────────────────────────────────────

export async function bulkAssign(
  taskIds: string[],
  retoucherId: string,
  changedBy: string,
): Promise<{ updated: number }> {
  if (!taskIds.length) throw new AppError(400, 'task_ids is required');
  if (!retoucherId) throw new AppError(400, 'retoucher_id is required');

  const result = await pool.query(
    `UPDATE work_tasks
     SET assigned_to = $1, status = 'assigned', updated_at = NOW()
     WHERE id = ANY($2) AND task_type = 'retouch' AND status IN ('open', 'assigned')
     RETURNING id`,
    [retoucherId, taskIds],
  );

  for (const row of result.rows) {
    await insertHistory(row.id, null, 'assigned', changedBy, 'Назначено через bulk assign').catch(
      err => log.error('[Retouch] Bulk assign history error', { error: String(err) }),
    );
  }

  log.info(`[Retouch] Bulk assign: ${result.rowCount} tasks → retoucher ${retoucherId}`);
  return { updated: result.rowCount ?? 0 };
}

// ─── Bulk cancel ───────────────────────────────────────────────────────────

export async function bulkCancel(
  taskIds: string[],
  changedBy: string,
): Promise<{ updated: number }> {
  if (!taskIds.length) throw new AppError(400, 'task_ids is required');

  const result = await pool.query(
    `UPDATE work_tasks
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = ANY($1) AND task_type = 'retouch' AND status IN ('open', 'assigned', 'in_progress')
     RETURNING id`,
    [taskIds],
  );

  for (const row of result.rows) {
    await insertHistory(row.id, null, 'cancelled', changedBy, 'Отменено через bulk cancel').catch(
      err => log.error('[Retouch] Bulk cancel history error', { error: String(err) }),
    );
  }

  log.info(`[Retouch] Bulk cancel: ${result.rowCount} tasks`);
  return { updated: result.rowCount ?? 0 };
}

// ─── Bulk reassign ─────────────────────────────────────────────────────────

export async function bulkReassign(
  taskIds: string[],
  retoucherId: string,
  changedBy: string,
): Promise<{ updated: number }> {
  if (!taskIds.length) throw new AppError(400, 'task_ids is required');
  if (!retoucherId) throw new AppError(400, 'retoucher_id is required');

  const result = await pool.query(
    `UPDATE work_tasks
     SET assigned_to = $1, updated_at = NOW()
     WHERE id = ANY($2) AND task_type = 'retouch' AND status IN ('open', 'assigned', 'in_progress')
     RETURNING id`,
    [retoucherId, taskIds],
  );

  for (const row of result.rows) {
    await insertHistory(row.id, null, 'assigned', changedBy, 'Переназначено через bulk reassign').catch(
      err => log.error('[Retouch] Bulk reassign history error', { error: String(err) }),
    );
  }

  log.info(`[Retouch] Bulk reassign: ${result.rowCount} tasks → retoucher ${retoucherId}`);
  return { updated: result.rowCount ?? 0 };
}

// ─── Preset CRUD ───────────────────────────────────────────────────────────

export interface RetouchPreset {
  id: string;
  name: string;
  description: string | null;
  retouch_level: string;
  retouch_options: unknown[];
  document_type: string | null;
  price: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export async function getPresets(documentType?: string): Promise<RetouchPreset[]> {
  if (documentType) {
    return db.query<RetouchPreset>(
      `SELECT * FROM retouch_presets WHERE is_active = true AND document_type = $1 ORDER BY sort_order`,
      [documentType],
    );
  }
  return db.query<RetouchPreset>(
    `SELECT * FROM retouch_presets WHERE is_active = true ORDER BY sort_order`,
  );
}

export async function createPreset(data: {
  name: string;
  description?: string;
  retouch_level: string;
  retouch_options: unknown[];
  document_type?: string;
  price?: number;
  sort_order?: number;
}): Promise<RetouchPreset> {
  if (!data.name) throw new AppError(400, 'name is required');
  if (!data.retouch_level) throw new AppError(400, 'retouch_level is required');

  const result = await pool.query<RetouchPreset>(
    `INSERT INTO retouch_presets (name, description, retouch_level, retouch_options, document_type, price, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.name,
      data.description || null,
      data.retouch_level,
      JSON.stringify(data.retouch_options || []),
      data.document_type || null,
      data.price || null,
      data.sort_order || 0,
    ],
  );

  return result.rows[0];
}

export async function updatePreset(
  presetId: string,
  data: Partial<{
    name: string;
    description: string;
    retouch_level: string;
    retouch_options: unknown[];
    document_type: string;
    price: number;
    sort_order: number;
    is_active: boolean;
  }>,
): Promise<RetouchPreset> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.retouch_level !== undefined) { fields.push(`retouch_level = $${idx++}`); values.push(data.retouch_level); }
  if (data.retouch_options !== undefined) { fields.push(`retouch_options = $${idx++}`); values.push(JSON.stringify(data.retouch_options)); }
  if (data.document_type !== undefined) { fields.push(`document_type = $${idx++}`); values.push(data.document_type); }
  if (data.price !== undefined) { fields.push(`price = $${idx++}`); values.push(data.price); }
  if (data.sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(data.sort_order); }
  if (data.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.is_active); }

  if (!fields.length) throw new AppError(400, 'No fields to update');

  values.push(presetId);
  const result = await pool.query<RetouchPreset>(
    `UPDATE retouch_presets SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );

  if (!result.rows[0]) throw new AppError(404, 'Preset not found');
  return result.rows[0];
}

export async function deletePreset(presetId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE retouch_presets SET is_active = false WHERE id = $1 AND is_active = true`,
    [presetId],
  );
  if (result.rowCount === 0) throw new AppError(404, 'Preset not found');
}

// ─── Send for approval ──────────────────────────────────────────────────────

interface InsertedIdRow { id: string }

/**
 * Лениво создаёт сессию согласования для задачи ретуши, у которой её ещё нет.
 * Lightweight CRM-задачи «Супер обработки» создаются без сессии (createRetouchTaskFromCrm);
 * это позволяет отправить такую задачу на согласование прямо с карточки заказа.
 * Для задач с уже существующей сессией поведение не меняется.
 */
async function ensureApprovalSession(
  task: RetouchTaskRow,
  userId: string,
): Promise<{ approvalSessionId: string; publicToken: string }> {
  const publicToken = crypto.randomBytes(24).toString('hex');
  const title = task.title || 'Согласование фото';

  const session = await db.queryOne<InsertedIdRow>(
    `INSERT INTO photo_approval_sessions (
       public_token, client_name, client_phone, chat_session_id, title, status, total_photos
     ) VALUES ($1, $2, $3, $4, $5, 'pending', 1)
     RETURNING id`,
    [publicToken, task.client_name, task.client_phone, task.chat_session_id, title],
  );
  const approvalSessionId = session!.id;

  await db.query(
    `INSERT INTO photo_approvals (
       approval_session_id, original_photo_url, retouched_photo_url, photographer_id, status, revision_round
     ) VALUES ($1, $2, $3, $4, 'pending', 1)`,
    [approvalSessionId, task.source_photo_url, task.result_photo_url, userId],
  );

  await db.query(
    `UPDATE work_tasks SET approval_session_id = $1 WHERE id = $2`,
    [approvalSessionId, task.id],
  );

  return { approvalSessionId, publicToken };
}

export async function sendForApproval(
  taskId: string,
  userId: string,
): Promise<{ task: RetouchTaskRow; publicLink: string | null }> {
  const task = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );
  if (!task) throw new AppError(404, 'Задача не найдена');
  if (task.assigned_to !== userId) throw new AppError(403, 'Задача назначена другому сотруднику');

  // Лениво создаём сессию согласования, если её ещё нет (CRM-задачи без сессии)
  let approvalSessionId = task.approval_session_id;
  let approvalToken = task.approval_token;
  if (!approvalSessionId) {
    const created = await ensureApprovalSession(task, userId);
    approvalSessionId = created.approvalSessionId;
    approvalToken = created.publicToken;
  }

  // Update status to waiting
  await db.query(
    `UPDATE work_tasks SET status = 'waiting' WHERE id = $1`,
    [taskId],
  );

  let publicLink: string | null = null;

  if (task.chat_session_id) {
    // Send gallery to chat
    const { sendGalleryToChat } = await import('./photo-approval.service.js');
    try {
      const result = await sendGalleryToChat({ sessionId: approvalSessionId });
      publicLink = result?.reviewUrl || null;
    } catch (err) {
      log.warn('[Retouch] sendGalleryToChat failed, task still set to waiting', { error: String(err) });
    }
  } else if (approvalToken) {
    publicLink = `/photo-approval/${approvalToken}`;
  }

  await insertHistory(taskId, task.status, 'waiting', userId, 'Отправлено на согласование').catch(
    err => log.error('[Retouch] History error', { error: String(err) }),
  );

  const enriched = await db.queryOne<RetouchTaskRow>(
    `SELECT * FROM retouch_queue WHERE id = $1`,
    [taskId],
  );

  return { task: enriched!, publicLink };
}
