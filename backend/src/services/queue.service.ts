/**
 * Queue Service — очередь обработки фото-заказов.
 *
 * - Расчёт позиций в очереди (priority DESC, created_at ASC)
 * - Estimated ready time
 * - Priority purchase (платный прыжок)
 * - Статистика дня
 */

import db from '../database/db.js';

// ============================================================================
// Типы
// ============================================================================

export interface QueueItem {
  order_id: string;
  queue_position: number;
  priority: string;
  created_at: Date;
  estimated_ready_at: Date | null;
}

export interface QueueStats {
  inQueue: number;
  avgWaitMinutes: number;
  completedToday: number;
  currentDayLoad: number; // % загрузки от capacity
}

// Среднее время обработки одного заказа (минуты), если нет данных по опциям
const DEFAULT_PROCESSING_MINUTES = 30;
// Ёмкость в день (заказов)
const DAY_CAPACITY = 30;

// ============================================================================
// Публичный API
// ============================================================================

/**
 * Пересчитать позиции очереди для всех заказов в работе.
 * Порядок: priority vip → urgent → normal, затем по created_at ASC.
 */
export async function recalculateQueue(): Promise<void> {
  // Получаем все активные оплаченные заказы
  const orders = await db.query<{ id: string; priority: string; created_at: string }>(
    `SELECT id, COALESCE(priority, 'normal') as priority, created_at
     FROM photo_print_orders
     WHERE payment_status = 'paid'
       AND status IN ('paid', 'processing')
     ORDER BY
       CASE COALESCE(priority, 'normal')
         WHEN 'vip' THEN 1
         WHEN 'urgent' THEN 2
         ELSE 3
       END,
       created_at ASC`
  );

  if (orders.length === 0) return;

  // Обновляем queue_position пакетно
  const updates = orders.map((o, i) => ({
    id: o.id,
    position: i + 1,
  }));

  await db.query(
    `UPDATE photo_print_orders SET queue_position = updates.position
     FROM (VALUES ${updates.map((_, i) => `($${i * 2 + 1}::varchar, $${i * 2 + 2}::int)`).join(',')}) AS updates(id, position)
     WHERE photo_print_orders.id = updates.id`,
    updates.flatMap(u => [u.id, u.position])
  );
}

/**
 * Получить позицию заказа в очереди и estimated ready time.
 */
export async function getQueuePosition(orderId: string): Promise<{
  position: number | null;
  estimated_ready_at: Date | null;
  total_in_queue: number;
} | null> {
  const order = await db.queryOne<{
    id: string;
    queue_position: number | null;
    estimated_ready_at: string | null;
    status: string;
    payment_status: string;
  }>(
    `SELECT order_id as id, queue_position, estimated_ready_at, status, payment_status
     FROM photo_print_orders
     WHERE order_id = $1`,
    [orderId]
  );

  if (!order) return null;

  const totalResult = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM photo_print_orders
     WHERE payment_status = 'paid' AND status IN ('paid', 'processing')`
  );

  const total = parseInt(totalResult?.count || '0');

  return {
    position: order.queue_position,
    estimated_ready_at: order.estimated_ready_at ? new Date(order.estimated_ready_at) : null,
    total_in_queue: total,
  };
}

/**
 * Статистика очереди: в работе, среднее ожидание, выполнено сегодня.
 */
export async function getQueueStats(): Promise<QueueStats> {
  const [inQueueResult, completedResult] = await Promise.all([
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM photo_print_orders
       WHERE payment_status = 'paid' AND status IN ('paid', 'processing')`
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM photo_print_orders
       WHERE payment_status = 'paid'
         AND status = 'ready'
         AND updated_at >= CURRENT_DATE`
    ),
  ]);

  const inQueue = parseInt(inQueueResult?.count || '0');
  const completedToday = parseInt(completedResult?.count || '0');
  const avgWaitMinutes = inQueue * DEFAULT_PROCESSING_MINUTES;
  const currentDayLoad = Math.min(100, Math.round((completedToday + inQueue) / DAY_CAPACITY * 100));

  return { inQueue, avgWaitMinutes, completedToday, currentDayLoad };
}

/**
 * Процент загрузки конкретного дня (для demand-based скидок).
 */
export async function getDayLoad(date: Date = new Date()): Promise<number> {
  const dateStr = date.toISOString().split('T')[0];

  const result = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM photo_print_orders
     WHERE payment_status = 'paid'
       AND DATE(created_at) = $1`,
    [dateStr]
  );

  const count = parseInt(result?.count || '0');
  return Math.min(100, Math.round(count / DAY_CAPACITY * 100));
}

/**
 * Обновить estimated_ready_at для всех заказов в очереди.
 * Вызывается после recalculateQueue().
 */
export async function updateEstimatedTimes(): Promise<void> {
  const orders = await db.query<{
    id: string; queue_position: number; processing_started_at: string | null;
  }>(
    `SELECT id, queue_position, processing_started_at
     FROM photo_print_orders
     WHERE payment_status = 'paid'
       AND status IN ('paid', 'processing')
       AND queue_position IS NOT NULL
     ORDER BY queue_position ASC`
  );

  if (orders.length === 0) return;

  const now = new Date();

  for (const order of orders) {
    // Базовое время = сейчас + позиция * DEFAULT_PROCESSING_MINUTES
    const estimatedMs = now.getTime() + order.queue_position * DEFAULT_PROCESSING_MINUTES * 60 * 1000;
    const estimatedAt = new Date(estimatedMs);

    await db.query(
      `UPDATE photo_print_orders SET estimated_ready_at = $1 WHERE id = $2`,
      [estimatedAt, order.id]
    );
  }
}

// ============================================================================
// Priority Purchase
// ============================================================================

/**
 * Рассчитать стоимость прыжка на N позиций.
 * surcharge = per_position_percent * N * basePrice / 100, cap = max_surcharge_percent * basePrice / 100
 */
export async function calculatePrioritySurcharge(
  orderId: string,
  desiredPosition: number,
): Promise<{
  currentPosition: number;
  desiredPosition: number;
  positionsSkipped: number;
  surchargeAmount: number;
  baseAmount: number;
}> {
  const order = await db.queryOne<{
    id: string; queue_position: number | null; total_price: string | null;
  }>(
    `SELECT id, queue_position, total_price FROM photo_print_orders WHERE id = $1`,
    [orderId]
  );

  if (!order) throw new Error(`Заказ ${orderId} не найден`);
  if (!order.queue_position) throw new Error('Заказ не в очереди');

  const currentPos = order.queue_position;
  if (desiredPosition >= currentPos) {
    throw new Error('Желаемая позиция должна быть меньше текущей');
  }

  const positionsSkipped = currentPos - desiredPosition;
  const baseAmount = parseFloat(order.total_price || '0');

  // Загружаем конфиг
  const cfg = await loadPriorityConfig();
  const perPositionPct = cfg.per_position_percent || 10;
  const maxSurchargePct = cfg.max_surcharge_percent || 50;

  const calculated = Math.round(baseAmount * perPositionPct / 100 * positionsSkipped);
  const maxSurcharge = Math.round(baseAmount * maxSurchargePct / 100);
  const surchargeAmount = Math.min(calculated, maxSurcharge);

  return {
    currentPosition: currentPos,
    desiredPosition,
    positionsSkipped,
    surchargeAmount,
    baseAmount,
  };
}

/**
 * Выполнить покупку приоритета (без оплаты — для MVP через уже оплаченный заказ).
 * В production здесь должна быть проверка платежа.
 */
export async function purchasePriority(params: {
  orderId: string;
  desiredPosition: number;
  surchargeAmount: number;
  paymentId?: string;
}): Promise<void> {
  const { orderId, desiredPosition, surchargeAmount, paymentId } = params;

  // Записать транзакцию
  await db.query(
    `INSERT INTO priority_purchases (order_id, positions_skipped, surcharge_amount, payment_id, payment_status)
     VALUES ($1, $2, $3, $4, 'paid')`,
    [
      orderId,
      0, // будет пересчитано
      surchargeAmount,
      paymentId || null,
    ]
  );

  // Получить приоритет из конфига — vip означает VIP очередь
  await db.query(
    `UPDATE photo_print_orders SET priority = 'vip' WHERE id = $1`,
    [orderId]
  );

  // Пересчитать очередь
  await recalculateQueue();
  await updateEstimatedTimes();
}

// ============================================================================
// Запись истории статусов
// ============================================================================

/**
 * Записать смену статуса заказа в историю.
 */
export async function recordStatusChange(params: {
  orderId: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy?: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by)
     VALUES ($1, $2, $3, $4)`,
    [params.orderId, params.oldStatus, params.newStatus, params.changedBy || null]
  );
}

/**
 * Получить историю статусов заказа.
 */
export async function getStatusHistory(orderId: string): Promise<Array<{
  id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  created_at: Date;
}>> {
  return db.query(
    `SELECT id, old_status, new_status, changed_by, created_at
     FROM order_status_history
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [orderId]
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

async function loadPriorityConfig(): Promise<{ per_position_percent: number; max_surcharge_percent: number }> {
  const row = await db.queryOne<{ config_value: Record<string, number> }>(
    `SELECT config_value FROM dynamic_pricing_config WHERE config_key = 'priority_pricing'`
  );
  return {
    per_position_percent: (row?.config_value?.['per_position_percent'] as number) || 10,
    max_surcharge_percent: (row?.config_value?.['max_surcharge_percent'] as number) || 50,
  };
}
