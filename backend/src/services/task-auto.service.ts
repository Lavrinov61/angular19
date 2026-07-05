/**
 * Автоматическое создание work_tasks из заказов, бронирований и чатов.
 * Используется в orders.routes, bookings.routes и redis-subscriber.service.
 */
import { pool } from '../database/db.js';
import type { PoolClient } from 'pg';

import { createLogger } from '../utils/logger.js';
interface TaskFromOrderParams {
  orderId: string;
  orderTable: 'orders' | 'photo_print_orders';
  taskType?: string;
  clientName?: string;
  clientPhone?: string;
  clientChannel?: string;
  title: string;
  description?: string;
  studioId?: string;
  chatSessionId?: string;
  createdBy?: string;
  priority?: string;
  estimatedReadyAt?: Date;
}

const logger = createLogger('task-auto.service');

interface TaskAutoResult {
  id: string;
  task_number: number;
  assigned_studio_id: string | null;
}

interface UserContactRow {
  display_name: string | null;
  phone: string | null;
}

function defaultTaskDeadline(params: { orderTable?: 'orders' | 'photo_print_orders'; priority?: string }): Date {
  if (params.orderTable === 'photo_print_orders') {
    const minutes = params.priority === 'urgent' ? 15 : 30;
    return new Date(Date.now() + minutes * 60_000);
  }

  const hours = params.priority === 'urgent' ? 4 : 24;
  return new Date(Date.now() + hours * 3600_000);
}

interface TaskFromBookingParams {
  bookingId: string;
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  title: string;
  description?: string;
  studioId?: string;
  dueDate?: Date;
  createdBy?: string;
}

interface TaskFromChatParams {
  chatSessionId?: string;
  bitrixChatId?: string;
  messengerType?: string;
  clientName?: string;
  clientPhone?: string;
  clientChannel?: string;
  taskType: string;
  title: string;
  description?: string;
  studioId?: string;
  createdBy?: string;
  priority?: string;
}

/**
 * Создать задачу из заказа (orders или photo_print_orders)
 */
export async function createTaskFromOrder(params: TaskFromOrderParams): Promise<TaskAutoResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Определяем studio — берём первую (Соборный) как дефолт
    const studioId = params.studioId || await getDefaultStudioId(client);

    const fkColumn = params.orderTable === 'orders' ? 'order_id' : 'print_order_id';

    // Проверяем, нет ли уже задачи для этого заказа
    const existing = await client.query<TaskAutoResult>(
      `SELECT id, task_number, assigned_studio_id FROM work_tasks WHERE ${fkColumn} = $1 LIMIT 1`,
      [params.orderId],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return existing.rows[0];
    }

    const priority = params.priority || 'normal';
    const deadline = params.estimatedReadyAt || defaultTaskDeadline({ orderTable: params.orderTable, priority });

    const result = await client.query<TaskAutoResult>(
      `INSERT INTO work_tasks (
        task_type, ${fkColumn}, chat_session_id,
        assigned_studio_id, priority, status,
        title, description, client_name, client_phone, client_channel,
        due_date, sla_deadline, created_by
      ) VALUES (
        $11, $1, $2,
        $3, $4, 'open',
        $5, $6, $7, $8, $9,
        $12, $12, $10
      ) RETURNING *`,
      [
        params.orderId,
        params.chatSessionId || null,
        studioId,
        priority,
        params.title,
        params.description || null,
        params.clientName || null,
        params.clientPhone || null,
        params.clientChannel || 'online',
        params.createdBy || null,
        params.taskType || (params.orderTable === 'photo_print_orders' ? 'delivery' : 'photo_order'),
        deadline,
      ],
    );

    const task = result.rows[0];

    // Если есть chat_session_id, создаём chat_task_link
    if (params.chatSessionId) {
      await client.query(
        `INSERT INTO chat_task_links (task_id, chat_session_id, messenger_type)
         VALUES ($1, $2, 'website')
         ON CONFLICT DO NOTHING`,
        [task.id, params.chatSessionId],
      );
    }

    // Создаём системную заметку
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [task.id, params.createdBy || null, 'Задача создана автоматически из заказа'],
    );

    await client.query('COMMIT');
    logger.info(`[TaskAuto] Created task ${task.id} (${task.task_number}) from ${params.orderTable} ${params.orderId}`);
    return task;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[TaskAuto] Failed to create task from order:', { error: String(err) });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Создать задачу из бронирования (booking)
 */
export async function createTaskFromBooking(params: TaskFromBookingParams): Promise<TaskAutoResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const studioId = params.studioId || await getDefaultStudioId(client);

    // Проверяем, нет ли уже задачи для этого бронирования
    const existing = await client.query<TaskAutoResult>(
      `SELECT id, task_number, assigned_studio_id FROM work_tasks WHERE booking_id = $1 LIMIT 1`,
      [params.bookingId],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return existing.rows[0];
    }

    // Получаем имя клиента из users, если не передано
    let clientName = params.clientName;
    let clientPhone = params.clientPhone;
    if (!clientName && params.clientId) {
      const user = await client.query<UserContactRow>(
        `SELECT display_name, phone FROM users WHERE id = $1`,
        [params.clientId],
      );
      if (user.rows[0]) {
        clientName = user.rows[0].display_name ?? undefined;
        clientPhone = clientPhone || user.rows[0].phone || undefined;
      }
    }

    const result = await client.query<TaskAutoResult>(
      `INSERT INTO work_tasks (
        task_type, booking_id,
        client_id, assigned_studio_id, priority, status,
        title, description, client_name, client_phone, client_channel,
        due_date, created_by
      ) VALUES (
        'photo_order', $1,
        $2, $3, 'normal', 'open',
        $4, $5, $6, $7, 'online',
        $8, $9
      ) RETURNING *`,
      [
        params.bookingId,
        params.clientId || null,
        studioId,
        params.title,
        params.description || null,
        clientName || null,
        clientPhone || null,
        params.dueDate || null,
        params.createdBy || null,
      ],
    );

    const task = result.rows[0];

    // Создаём системную заметку
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [task.id, params.createdBy || null, 'Задача создана автоматически из бронирования'],
    );

    await client.query('COMMIT');
    logger.info(`[TaskAuto] Created task ${task.id} (${task.task_number}) from booking ${params.bookingId}`);
    return task;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[TaskAuto] Failed to create task from booking:', { error: String(err) });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Создать задачу из чата (команда /task оператора)
 */
export async function createTaskFromChat(params: TaskFromChatParams): Promise<TaskAutoResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const studioId = params.studioId || await getDefaultStudioId(client);

    const priority = params.priority || 'normal';
    const slaHours = priority === 'urgent' ? 1 : 2;

    const result = await client.query<TaskAutoResult>(
      `INSERT INTO work_tasks (
        task_type, chat_session_id,
        assigned_studio_id, priority, status,
        title, description, client_name, client_phone, client_channel,
        due_date, created_by
      ) VALUES (
        $1, $2,
        $3, $4, 'open',
        $5, $6, $7, $8, $9,
        NOW() + ($11 || ' hours')::interval, $10
      ) RETURNING *`,
      [
        params.taskType,
        params.chatSessionId || null,
        studioId,
        priority,
        params.title,
        params.description || null,
        params.clientName || null,
        params.clientPhone || null,
        params.clientChannel || 'online',
        params.createdBy || null,
        slaHours,
      ],
    );

    const task = result.rows[0];

    // Создаём chat_task_link
    if (params.chatSessionId || params.bitrixChatId) {
      await client.query(
        `INSERT INTO chat_task_links (task_id, chat_session_id, bitrix_chat_id, messenger_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [
          task.id,
          params.chatSessionId || null,
          params.bitrixChatId || null,
          params.messengerType || 'website',
        ],
      );
    }

    // Создаём системную заметку
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [task.id, params.createdBy || null, `Задача создана оператором из чата`],
    );

    await client.query('COMMIT');
    logger.info(`[TaskAuto] Created task ${task.id} (${task.task_number}) from chat, type: ${params.taskType}`);
    return task;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[TaskAuto] Failed to create task from chat:', { error: String(err) });
    return null;
  } finally {
    client.release();
  }
}

// ============================================================================
// Walk-in task creation
// ============================================================================

interface TaskFromWalkInParams {
  orderId: string;        // photo_print_orders.id (UUID)
  orderDisplayId: string; // WI-YYMMDD-XXXX
  assignedTo: string;     // employee user id
  studioId?: string;
  clientName?: string;
  clientPhone?: string;
  priority?: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  estimatedReadyAt?: Date;
}

/**
 * Создать задачу из walk-in заказа.
 * Статус сразу 'in_progress' — сотрудник уже обслуживает клиента.
 */
export async function createTaskFromWalkIn(params: TaskFromWalkInParams): Promise<TaskAutoResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const studioId = params.studioId || await getDefaultStudioId(client);

    // Dedup: одна задача на заказ
    const existing = await client.query<TaskAutoResult>(
      `SELECT id, task_number, assigned_studio_id FROM work_tasks WHERE print_order_id = $1 LIMIT 1`,
      [params.orderId],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return existing.rows[0];
    }

    const priority = params.priority || 'normal';
    const deadline = params.estimatedReadyAt || new Date(Date.now() + (priority === 'urgent' ? 15 : 30) * 60_000);

    const itemNames = params.items.map(i =>
      i.quantity > 1 ? `${i.name} x${i.quantity}` : i.name,
    );
    const title = `Walk-in: ${itemNames.join(', ')}`.substring(0, 255);

    const result = await client.query<TaskAutoResult>(
      `INSERT INTO work_tasks (
        task_type, print_order_id,
        assigned_to, assigned_studio_id,
        priority, status,
        title, description,
        client_name, client_phone, client_channel,
        due_date, sla_deadline, created_by
      ) VALUES (
        'walk_in', $1,
        $2, $3,
        $4, 'in_progress',
        $5, $6,
        $7, $8, 'walk_in',
        $9, $9, $2
      ) RETURNING *`,
      [
        params.orderId,
        params.assignedTo,
        studioId,
        priority,
        title,
        `Заказ ${params.orderDisplayId}`,
        params.clientName || null,
        params.clientPhone || null,
        deadline,
      ],
    );

    const task = result.rows[0];

    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [task.id, params.assignedTo, `Задача создана автоматически из walk-in заказа ${params.orderDisplayId}`],
    );

    await client.query('COMMIT');
    logger.info(`[TaskAuto] Walk-in task ${task.id} (#${task.task_number}) created from ${params.orderDisplayId}`);
    return task;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[TaskAuto] Failed to create walk-in task:', { error: String(err) });
    return null;
  } finally {
    client.release();
  }
}

// ============================================================================

/**
 * Получить ID студии по умолчанию (Соборный 21)
 */
async function getDefaultStudioId(client: PoolClient): Promise<string | null> {
  const result = await client.query(
    `SELECT id FROM studios WHERE location_code = 'soborny' LIMIT 1`,
  );
  return result.rows[0]?.id || null;
}
