import { PoolClient } from 'pg';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type { ProductStockId } from '../types/generated/public/ProductStock.js';
import type { StudiosId } from '../types/generated/public/Studios.js';
import type { UsersId } from '../types/generated/public/Users.js';

const logger = createLogger('inventory.service');

// ─── TYPES ────────────────────────────────────────────

/** Transaction types matching DB CHECK constraint */
export type InventoryTransactionType =
  | 'receipt_deduction'
  | 'consumable_deduction'
  | 'receipt_refund'
  | 'manual_receive'
  | 'manual_writeoff'
  | 'transfer_out'
  | 'transfer_in'
  | 'audit_adjustment';

export interface InventoryTransaction {
  id: string;
  product_stock_id: ProductStockId;
  studio_id: StudiosId;
  type: InventoryTransactionType;
  quantity: string;
  reference_id: string | null;
  reference_type: string | null;
  employee_id: UsersId | null;
  notes: string | null;
  created_at: string;
}

export interface RecordTransactionInput {
  productStockId: ProductStockId;
  studioId: StudiosId;
  type: InventoryTransactionType;
  quantity: number;
  referenceId?: string;
  referenceType?: string;
  employeeId?: UsersId;
  notes?: string;
}

export interface StudioStockRow {
  product_stock_id: ProductStockId;
  product_id: string;
  product_name: string;
  quantity: string;
  min_quantity: string | null;
  avg_daily_usage: string;
  days_until_empty: number | null;
  is_low_stock: boolean;
}

export interface InventoryAudit {
  id: string;
  studio_id: StudiosId;
  employee_id: UsersId;
  status: 'in_progress' | 'completed' | 'cancelled';
  started_at: string;
  completed_at: string | null;
  notes: string | null;
}

export interface InventoryAuditItem {
  id: string;
  audit_id: string;
  product_stock_id: ProductStockId;
  system_quantity: string;
  actual_quantity: string | null;
  discrepancy: string | null;
}

// ─── RECORD TRANSACTION ──────────────────────────────

/**
 * Append-only: записать транзакцию движения запасов.
 * Может работать внутри существующей транзакции (client).
 */
export async function record(
  tx: RecordTransactionInput,
  client?: PoolClient,
): Promise<InventoryTransaction> {
  const sql = `
    INSERT INTO inventory_transactions
      (product_stock_id, studio_id, type, quantity, reference_id, reference_type, employee_id, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`;
  const params = [
    tx.productStockId,
    tx.studioId,
    tx.type,
    tx.quantity,
    tx.referenceId ?? null,
    tx.referenceType ?? null,
    tx.employeeId ?? null,
    tx.notes ?? null,
  ];

  if (client) {
    const result = await client.query<InventoryTransaction>(sql, params);
    return result.rows[0];
  }
  const row = await db.queryOne<InventoryTransaction>(sql, params);
  if (!row) throw new AppError(500, 'Failed to record inventory transaction');
  return row;
}

// ─── GET STUDIO STOCK ────────────────────────────────

/**
 * Остатки по студии с прогнозом (avg_daily_usage, days_until_empty).
 */
export async function getStudioStock(studioId: StudiosId): Promise<StudioStockRow[]> {
  return db.query<StudioStockRow>(
    `SELECT
       ps.id         AS product_stock_id,
       ps.product_id,
       p.name        AS product_name,
       ps.quantity,
       ps.min_quantity,
       COALESCE(ps.avg_daily_usage, 0) AS avg_daily_usage,
       ps.days_until_empty,
       (ps.min_quantity IS NOT NULL
        AND ps.min_quantity > 0
        AND ps.quantity <= ps.min_quantity) AS is_low_stock
     FROM product_stock ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.studio_id = $1
     ORDER BY p.name`,
    [studioId],
  );
}

// ─── GET HISTORY ─────────────────────────────────────

export interface HistoryOpts {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * История движений для конкретного product_stock с пагинацией.
 */
export async function getHistory(
  productStockId: ProductStockId,
  opts: HistoryOpts,
): Promise<{ items: InventoryTransaction[]; total: number }> {
  const conditions: string[] = ['it.product_stock_id = $1'];
  const params: unknown[] = [productStockId];
  let idx = 2;

  if (opts.dateFrom) {
    conditions.push(`it.created_at >= $${idx++}`);
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push(`it.created_at <= $${idx++}`);
    params.push(opts.dateTo);
  }

  const where = conditions.join(' AND ');
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const limitIdx = idx++;
  const offsetIdx = idx++;
  const [items, countResult] = await Promise.all([
    db.query<InventoryTransaction>(
      `SELECT it.* FROM inventory_transactions it
       WHERE ${where}
       ORDER BY it.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM inventory_transactions it WHERE ${where}`,
      params,
    ),
  ]);

  return { items, total: parseInt(countResult?.count ?? '0', 10) };
}

// ─── RECEIVE ─────────────────────────────────────────

/**
 * Поступление: обновить stock + записать транзакцию.
 */
export async function receive(
  productStockId: ProductStockId,
  studioId: StudiosId,
  quantity: number,
  employeeId: UsersId,
  notes?: string,
): Promise<InventoryTransaction> {
  if (quantity <= 0) throw new AppError(400, 'quantity must be positive');

  return db.transaction(async (client) => {
    await client.query(
      `UPDATE product_stock
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2`,
      [quantity, productStockId],
    );

    const tx = await record(
      {
        productStockId,
        studioId,
        type: 'manual_receive',
        quantity,
        referenceType: 'manual',
        employeeId,
        notes,
      },
      client,
    );

    logger.info('Inventory received', {
      productStockId,
      studioId,
      quantity,
      employeeId,
    });

    return tx;
  });
}

// ─── WRITE OFF ───────────────────────────────────────

/**
 * Списание: вычесть из stock + записать транзакцию.
 */
export async function writeOff(
  productStockId: ProductStockId,
  studioId: StudiosId,
  quantity: number,
  employeeId: UsersId,
  notes?: string,
): Promise<InventoryTransaction> {
  if (quantity <= 0) throw new AppError(400, 'quantity must be positive');

  return db.transaction(async (client) => {
    await client.query(
      `UPDATE product_stock
       SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
       WHERE id = $2`,
      [quantity, productStockId],
    );

    const tx = await record(
      {
        productStockId,
        studioId,
        type: 'manual_writeoff',
        quantity: -quantity,
        referenceType: 'manual',
        employeeId,
        notes,
      },
      client,
    );

    logger.info('Inventory written off', {
      productStockId,
      studioId,
      quantity,
      employeeId,
    });

    return tx;
  });
}

// ─── TRANSFER ────────────────────────────────────────

/**
 * Перемещение между студиями: transfer_out + transfer_in в одной транзакции.
 */
export async function transfer(
  productStockId: ProductStockId,
  fromStudioId: StudiosId,
  toStudioId: StudiosId,
  quantity: number,
  employeeId: UsersId,
): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
  if (quantity <= 0) throw new AppError(400, 'quantity must be positive');
  if (fromStudioId === toStudioId) {
    throw new AppError(400, 'Source and destination studios must differ');
  }

  return db.transaction(async (client) => {
    // Получить product_id из исходного stock
    const sourceStock = await client.query<{ product_id: string; quantity: string }>(
      `SELECT product_id, quantity FROM product_stock WHERE id = $1 FOR UPDATE`,
      [productStockId],
    );
    if (sourceStock.rows.length === 0) {
      throw new AppError(404, 'Source product stock not found');
    }
    const { product_id } = sourceStock.rows[0];

    // Вычесть из источника
    await client.query(
      `UPDATE product_stock
       SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
       WHERE id = $2`,
      [quantity, productStockId],
    );

    // Upsert в целевую студию
    const destResult = await client.query<{ id: string }>(
      `INSERT INTO product_stock (product_id, studio_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, studio_id)
       DO UPDATE SET quantity = product_stock.quantity + $3, updated_at = NOW()
       RETURNING id`,
      [product_id, toStudioId, quantity],
    );
    const destStockId = destResult.rows[0].id as ProductStockId;

    const transferId = crypto.randomUUID();

    const outTx = await record(
      {
        productStockId,
        studioId: fromStudioId,
        type: 'transfer_out',
        quantity: -quantity,
        referenceId: transferId,
        referenceType: 'transfer',
        employeeId,
      },
      client,
    );

    const inTx = await record(
      {
        productStockId: destStockId,
        studioId: toStudioId,
        type: 'transfer_in',
        quantity,
        referenceId: transferId,
        referenceType: 'transfer',
        employeeId,
      },
      client,
    );

    logger.info('Inventory transferred', {
      productStockId,
      fromStudioId,
      toStudioId,
      quantity,
      transferId,
    });

    return { out: outTx, in: inTx };
  });
}

// ─── AUDIT ───────────────────────────────────────────

/**
 * Начать инвентаризацию: создать audit + заполнить items текущими system_quantity.
 */
export async function startAudit(
  studioId: StudiosId,
  employeeId: UsersId,
): Promise<InventoryAudit & { items: InventoryAuditItem[] }> {
  return db.transaction(async (client) => {
    // Проверить, нет ли уже открытой инвентаризации
    const existing = await client.query(
      `SELECT id FROM inventory_audits
       WHERE studio_id = $1 AND status = 'in_progress'
       FOR UPDATE`,
      [studioId],
    );
    if (existing.rows.length > 0) {
      throw new AppError(409, 'В этой студии уже идёт инвентаризация');
    }

    const auditResult = await client.query<InventoryAudit>(
      `INSERT INTO inventory_audits (studio_id, employee_id)
       VALUES ($1, $2) RETURNING *`,
      [studioId, employeeId],
    );
    const audit = auditResult.rows[0];

    // Заполнить items по всем product_stock в студии
    const itemsResult = await client.query<InventoryAuditItem>(
      `INSERT INTO inventory_audit_items (audit_id, product_stock_id, system_quantity)
       SELECT $1, ps.id, ps.quantity
       FROM product_stock ps
       WHERE ps.studio_id = $2
       RETURNING *`,
      [audit.id, studioId],
    );

    logger.info('Audit started', { auditId: audit.id, studioId, itemCount: itemsResult.rows.length });

    return { ...audit, items: itemsResult.rows };
  });
}

/**
 * Записать фактическое количество для позиции инвентаризации.
 */
export async function recordAuditItem(
  auditId: string,
  productStockId: ProductStockId,
  actualQuantity: number,
): Promise<InventoryAuditItem> {
  // Проверить, что audit существует и in_progress
  const audit = await db.queryOne<InventoryAudit>(
    `SELECT * FROM inventory_audits WHERE id = $1`,
    [auditId],
  );
  if (!audit) throw new AppError(404, 'Инвентаризация не найдена');
  if (audit.status !== 'in_progress') {
    throw new AppError(400, 'Инвентаризация уже завершена или отменена');
  }

  const item = await db.queryOne<InventoryAuditItem>(
    `UPDATE inventory_audit_items
     SET actual_quantity = $1
     WHERE audit_id = $2 AND product_stock_id = $3
     RETURNING *`,
    [actualQuantity, auditId, productStockId],
  );
  if (!item) throw new AppError(404, 'Позиция не найдена в данной инвентаризации');
  return item;
}

/**
 * Завершить инвентаризацию:
 * - Для расхождений создать audit_adjustment транзакции
 * - Обновить product_stock.quantity
 */
export async function completeAudit(auditId: string): Promise<InventoryAudit> {
  return db.transaction(async (client) => {
    const audit = await client.query<InventoryAudit>(
      `SELECT * FROM inventory_audits WHERE id = $1 FOR UPDATE`,
      [auditId],
    );
    if (audit.rows.length === 0) throw new AppError(404, 'Инвентаризация не найдена');
    if (audit.rows[0].status !== 'in_progress') {
      throw new AppError(400, 'Инвентаризация уже завершена или отменена');
    }

    // Получить все items с фактическим количеством
    const items = await client.query<InventoryAuditItem & { studio_id: StudiosId }>(
      `SELECT iai.*, ps.studio_id
       FROM inventory_audit_items iai
       JOIN product_stock ps ON iai.product_stock_id = ps.id
       WHERE iai.audit_id = $1
         AND iai.actual_quantity IS NOT NULL`,
      [auditId],
    );

    // Для каждого расхождения: создать audit_adjustment + обновить stock
    for (const item of items.rows) {
      const discrepancy = parseFloat(item.actual_quantity!) - parseFloat(item.system_quantity);
      if (Math.abs(discrepancy) < 0.001) continue;

      // Обновить stock до фактического количества
      await client.query(
        `UPDATE product_stock SET quantity = $1, updated_at = NOW() WHERE id = $2`,
        [item.actual_quantity, item.product_stock_id],
      );

      // Записать транзакцию корректировки
      await record(
        {
          productStockId: item.product_stock_id,
          studioId: item.studio_id,
          type: 'audit_adjustment',
          quantity: discrepancy,
          referenceId: auditId,
          referenceType: 'audit',
          employeeId: audit.rows[0].employee_id,
          notes: `Инвентаризация: было ${item.system_quantity}, факт ${item.actual_quantity}`,
        },
        client,
      );
    }

    // Завершить audit
    const updated = await client.query<InventoryAudit>(
      `UPDATE inventory_audits
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [auditId],
    );

    logger.info('Audit completed', {
      auditId,
      adjustmentCount: items.rows.filter(
        (i) => Math.abs(parseFloat(i.actual_quantity!) - parseFloat(i.system_quantity)) >= 0.001,
      ).length,
    });

    return updated.rows[0];
  });
}

// ─── UPDATE FORECAST ─────────────────────────────────

/**
 * Пересчитать avg_daily_usage из последних 30 дней inventory_transactions.
 * Обновить days_until_empty.
 */
export async function updateForecast(studioId: StudiosId): Promise<void> {
  await db.query(
    `WITH daily_usage AS (
       SELECT
         it.product_stock_id,
         COALESCE(SUM(ABS(it.quantity)) / GREATEST(1,
           EXTRACT(DAY FROM (NOW() - MIN(it.created_at)))::int
         ), 0) AS avg_usage
       FROM inventory_transactions it
       WHERE it.studio_id = $1
         AND it.quantity < 0
         AND it.created_at > NOW() - INTERVAL '30 days'
       GROUP BY it.product_stock_id
     )
     UPDATE product_stock ps
     SET
       avg_daily_usage = du.avg_usage,
       days_until_empty = CASE
         WHEN du.avg_usage > 0 THEN FLOOR(ps.quantity / du.avg_usage)::int
         ELSE NULL
       END,
       updated_at = NOW()
     FROM daily_usage du
     WHERE ps.id = du.product_stock_id
       AND ps.studio_id = $1`,
    [studioId],
  );

  logger.info('Forecast updated', { studioId });
}
