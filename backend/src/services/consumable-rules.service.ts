import { PoolClient } from 'pg';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';
import type { ProductStockId } from '../types/generated/public/ProductStock.js';
import type { PosReceiptsId } from '../types/generated/public/PosReceipts.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { StudiosId } from '../types/generated/public/Studios.js';

const logger = createLogger('consumable-rules.service');

// ─── TYPES ────────────────────────────────────────────

/** consumable_rules row (Kanel not yet generated for new table) */
export interface ConsumableRule {
  id: string;
  service_option_id: ServiceOptionsId;
  product_stock_id: ProductStockId;
  quantity_per_unit: number;
  unit_label: string | null;
  is_active: boolean;
  created_at: string;
}

/** Enriched rule with product/option names for API responses */
interface ConsumableRuleEnriched extends ConsumableRule {
  option_name: string;
  product_name: string;
  studio_name: string | null;
  current_stock: number;
}

/** Single item in consumption preview/apply */
export interface ConsumptionItem {
  option_id: ServiceOptionsId;
  quantity: number;
}

/** Preview result for a single deduction line */
interface ConsumptionPreviewLine {
  rule_id: string;
  product_stock_id: ProductStockId;
  product_name: string;
  deduction: number;
  unit_label: string | null;
  current_stock: number;
  stock_after: number;
  will_go_negative: boolean;
}

// ─── READ ─────────────────────────────────────────────

export async function getActiveRules(
  serviceOptionIds: ServiceOptionsId[],
): Promise<ConsumableRule[]> {
  if (serviceOptionIds.length === 0) return [];

  const placeholders = serviceOptionIds.map((_, i) => `$${i + 1}`).join(',');
  return db.query<ConsumableRule>(
    `SELECT id, service_option_id, product_stock_id, quantity_per_unit::numeric,
            unit_label, is_active, created_at
     FROM consumable_rules
     WHERE is_active = true AND service_option_id IN (${placeholders})`,
    serviceOptionIds,
  );
}

export async function getRulesForOption(
  optionId: ServiceOptionsId,
): Promise<ConsumableRule[]> {
  return db.query<ConsumableRule>(
    `SELECT id, service_option_id, product_stock_id, quantity_per_unit::numeric,
            unit_label, is_active, created_at
     FROM consumable_rules
     WHERE service_option_id = $1
     ORDER BY created_at`,
    [optionId],
  );
}

export async function getAllRulesEnriched(): Promise<ConsumableRuleEnriched[]> {
  return db.query<ConsumableRuleEnriched>(
    `SELECT cr.id, cr.service_option_id, cr.product_stock_id,
            cr.quantity_per_unit::numeric, cr.unit_label, cr.is_active, cr.created_at,
            so.name AS option_name,
            p.name AS product_name,
            st.name AS studio_name,
            ps.quantity::numeric AS current_stock
     FROM consumable_rules cr
     JOIN service_options so ON cr.service_option_id = so.id
     JOIN product_stock ps ON cr.product_stock_id = ps.id
     JOIN products p ON ps.product_id = p.id
     LEFT JOIN studios st ON ps.studio_id = st.id
     ORDER BY so.name, p.name`,
  );
}

// ─── PREVIEW ──────────────────────────────────────────

export async function previewConsumption(
  items: ConsumptionItem[],
): Promise<ConsumptionPreviewLine[]> {
  if (items.length === 0) return [];

  const optionIds = [...new Set(items.map(i => i.option_id))];
  const rules = await getActiveRules(optionIds as ServiceOptionsId[]);
  if (rules.length === 0) return [];

  // Build quantity map: optionId -> total quantity
  const qtyMap = new Map<string, number>();
  for (const item of items) {
    qtyMap.set(item.option_id, (qtyMap.get(item.option_id) ?? 0) + item.quantity);
  }

  // Collect unique product_stock_ids for stock lookup
  const stockIds = [...new Set(rules.map(r => r.product_stock_id))];
  const placeholders = stockIds.map((_, i) => `$${i + 1}`).join(',');
  const stockRows = await db.query<{
    id: ProductStockId;
    quantity: number;
    product_name: string;
  }>(
    `SELECT ps.id, ps.quantity::numeric AS quantity, p.name AS product_name
     FROM product_stock ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.id IN (${placeholders})`,
    stockIds,
  );
  const stockMap = new Map(stockRows.map(r => [r.id as string, r]));

  const lines: ConsumptionPreviewLine[] = [];
  for (const rule of rules) {
    const orderQty = qtyMap.get(rule.service_option_id) ?? 0;
    const deduction = orderQty * rule.quantity_per_unit;
    const stock = stockMap.get(rule.product_stock_id as string);
    const currentStock = stock?.quantity ?? 0;
    const stockAfter = currentStock - deduction;

    lines.push({
      rule_id: rule.id,
      product_stock_id: rule.product_stock_id,
      product_name: stock?.product_name ?? 'Unknown',
      deduction,
      unit_label: rule.unit_label,
      current_stock: currentStock,
      stock_after: stockAfter,
      will_go_negative: stockAfter < 0,
    });
  }

  return lines;
}

// ─── APPLY (inside existing transaction) ──────────────

export async function applyConsumption(
  receiptId: PosReceiptsId,
  items: ConsumptionItem[],
  studioId: StudiosId,
  employeeId: UsersId,
  client: PoolClient,
): Promise<void> {
  if (items.length === 0) return;

  const optionIds = [...new Set(items.map(i => i.option_id))];
  const placeholders = optionIds.map((_, i) => `$${i + 1}`).join(',');
  const rulesResult = await client.query<ConsumableRule>(
    `SELECT id, service_option_id, product_stock_id, quantity_per_unit::numeric,
            unit_label, is_active, created_at
     FROM consumable_rules
     WHERE is_active = true AND service_option_id IN (${placeholders})`,
    optionIds,
  );
  const rules = rulesResult.rows;
  if (rules.length === 0) return;

  // Build quantity map
  const qtyMap = new Map<string, number>();
  for (const item of items) {
    qtyMap.set(item.option_id, (qtyMap.get(item.option_id) ?? 0) + item.quantity);
  }

  for (const rule of rules) {
    const orderQty = qtyMap.get(rule.service_option_id) ?? 0;
    if (orderQty <= 0) continue;

    const deduction = orderQty * rule.quantity_per_unit;

    // Deduct from product_stock (floor at 0)
    await client.query(
      `UPDATE product_stock
       SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
       WHERE id = $2`,
      [deduction, rule.product_stock_id],
    );

    // Log inventory_transaction
    await client.query(
      `INSERT INTO inventory_transactions
         (product_stock_id, studio_id, type, quantity, reference_id, reference_type, employee_id, notes)
       VALUES ($1, $2, 'consumable_deduction', $3, $4, 'receipt', $5, $6)`,
      [
        rule.product_stock_id,
        studioId,
        -deduction,
        receiptId,
        employeeId,
        `Auto-deduction: ${deduction} ${rule.unit_label ?? 'units'} per rule ${rule.id}`,
      ],
    );
  }

  logger.info('Applied consumable deductions', {
    receiptId,
    rulesApplied: rules.length,
    studioId,
  });
}

// ─── REVERSE (inside existing transaction) ────────────

export async function reverseConsumption(
  receiptId: PosReceiptsId,
  client: PoolClient,
): Promise<void> {
  // Find all consumable_deduction transactions for this receipt
  const txResult = await client.query<{
    product_stock_id: ProductStockId;
    quantity: number;
    studio_id: StudiosId;
    employee_id: UsersId | null;
  }>(
    `SELECT product_stock_id, quantity, studio_id, employee_id
     FROM inventory_transactions
     WHERE reference_id = $1 AND reference_type = 'receipt' AND type = 'consumable_deduction'`,
    [receiptId],
  );
  const transactions = txResult.rows;
  if (transactions.length === 0) return;

  for (const tx of transactions) {
    // tx.quantity is negative (deduction), so we add back the absolute value
    const restoreAmount = Math.abs(tx.quantity);

    await client.query(
      `UPDATE product_stock
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2`,
      [restoreAmount, tx.product_stock_id],
    );

    // Log reversal transaction (include employee_id for consistency with applyConsumption)
    await client.query(
      `INSERT INTO inventory_transactions
         (product_stock_id, studio_id, type, quantity, reference_id, reference_type, employee_id, notes)
       VALUES ($1, $2, 'receipt_refund', $3, $4, 'receipt', $5, 'Consumable reversal on refund')`,
      [tx.product_stock_id, tx.studio_id, restoreAmount, receiptId, tx.employee_id],
    );
  }

  logger.info('Reversed consumable deductions', {
    receiptId,
    transactionsReversed: transactions.length,
  });
}

// ─── CRUD ─────────────────────────────────────────────

export async function createRule(data: {
  service_option_id: ServiceOptionsId;
  product_stock_id: ProductStockId;
  quantity_per_unit: number;
  unit_label?: string;
}): Promise<ConsumableRule> {
  const result = await db.queryOne<ConsumableRule>(
    `INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
     VALUES ($1, $2, $3, $4)
     RETURNING id, service_option_id, product_stock_id, quantity_per_unit::numeric,
               unit_label, is_active, created_at`,
    [data.service_option_id, data.product_stock_id, data.quantity_per_unit, data.unit_label ?? null],
  );
  if (!result) throw new AppError(500, 'Failed to create consumable rule');
  logger.info('Created consumable rule', { ruleId: result.id });
  return result;
}

export async function updateRule(
  ruleId: string,
  data: {
    quantity_per_unit?: number;
    unit_label?: string;
    is_active?: boolean;
  },
): Promise<ConsumableRule> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.quantity_per_unit !== undefined) {
    sets.push(`quantity_per_unit = $${idx++}`);
    params.push(data.quantity_per_unit);
  }
  if (data.unit_label !== undefined) {
    sets.push(`unit_label = $${idx++}`);
    params.push(data.unit_label);
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    params.push(data.is_active);
  }

  if (sets.length === 0) throw new AppError(400, 'No fields to update');

  params.push(ruleId);
  const result = await db.queryOne<ConsumableRule>(
    `UPDATE consumable_rules SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id, service_option_id, product_stock_id, quantity_per_unit::numeric,
               unit_label, is_active, created_at`,
    params,
  );
  if (!result) throw new AppError(404, 'Consumable rule not found');
  logger.info('Updated consumable rule', { ruleId });
  return result;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const result = await db.queryOne<{ id: string }>(
    `UPDATE consumable_rules SET is_active = false
     WHERE id = $1
     RETURNING id`,
    [ruleId],
  );
  if (!result) throw new AppError(404, 'Consumable rule not found');
  logger.info('Deactivated consumable rule', { ruleId });
}
