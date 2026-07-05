/**
 * Production Service — управление типографиями и производственными заказами
 */

import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PoolClient } from 'pg';

// ============================================================================
// Types
// ============================================================================

export interface PrintingHouse {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'inactive' | 'testing';
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  api_type: 'manual' | 'api' | 'email';
  api_config: Record<string, unknown>;
  capabilities: string[];
  delivery_zones: string[];
  min_order_amount: number;
  quality_score: number;
  on_time_rate: number;
  defect_rate: number;
  total_orders: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface PrintingHouseProduct {
  id: string;
  printing_house_id: string;
  printing_house_name?: string;
  name: string;
  category: string;
  sku: string | null;
  description: string | null;
  base_price: number;
  price_unit: string;
  min_quantity: number;
  available_formats: string[];
  available_materials: string[];
  options: Record<string, unknown>;
  lead_time_days: number;
  express_available: boolean;
  express_surcharge_pct: number;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProductionOrderStatus =
  | 'draft' | 'pending' | 'sent' | 'confirmed' | 'in_production'
  | 'quality_check' | 'shipped' | 'delivered' | 'completed'
  | 'cancelled' | 'returned';

export interface ProductionOrderItem {
  product_id: string;
  product_name: string;
  category?: string;
  specs: Record<string, unknown>;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface ProductionOrder {
  id: string;
  order_number: string;
  printing_house_id: string;
  printing_house_name?: string;
  photo_print_order_id: string | null;
  photo_print_order_number?: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  created_by: string;
  created_by_name?: string;
  status: ProductionOrderStatus;
  items: ProductionOrderItem[];
  total_cost: number;
  deadline_at: string | null;
  estimated_delivery_at: string | null;
  actual_delivery_at: string | null;
  delivery_method: 'pickup' | 'courier' | 'post';
  tracking_number: string | null;
  quality_rating: number | null;
  quality_notes: string | null;
  has_defects: boolean;
  internal_notes: string | null;
  printing_house_notes: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductionOrderEvent {
  id: string;
  production_order_id: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OrderFilters {
  status?: string;
  printing_house_id?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProductionAnalytics {
  spending_by_house: { house_id: string; house_name: string; total: number; order_count: number }[];
  spending_by_category: { category: string; total: number; order_count: number }[];
  delivery_performance: { on_time_pct: number; avg_delay_days: number; total_orders: number };
  quality_metrics: { avg_rating: number; defect_rate: number; reprint_count: number };
  monthly_trends: { month: string; total_cost: number; order_count: number }[];
  status_distribution: { status: string; count: number }[];
}

export interface HousePerformance {
  house: PrintingHouse;
  orders_last_30d: number;
  orders_last_90d: number;
  avg_lead_time_days: number;
  on_time_pct: number;
  defect_rate: number;
  avg_quality_rating: number;
  total_spent: number;
  monthly_trend: { month: string; total: number; count: number }[];
}

export interface ProductComparison {
  category: string;
  products: {
    house_id: string;
    house_name: string;
    product_id: string;
    product_name: string;
    base_price: number;
    lead_time_days: number;
    formats: string[];
  }[];
}

// ============================================================================
// Helper: generate order number
// ============================================================================

function generateOrderNumber(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PRD-${datePart}-${rand}`;
}

// Allowed status transitions for validation
const STATUS_TRANSITIONS: Partial<Record<ProductionOrderStatus, ProductionOrderStatus[]>> = {
  draft:         ['pending', 'cancelled'],
  pending:       ['sent', 'cancelled'],
  sent:          ['confirmed', 'cancelled'],
  confirmed:     ['in_production', 'cancelled'],
  in_production: ['quality_check'],
  quality_check: ['shipped', 'in_production'],
  shipped:       ['delivered'],
  delivered:     ['completed', 'returned'],
};

export function isValidStatusTransition(from: ProductionOrderStatus, to: ProductionOrderStatus): boolean {
  const allowed = STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ============================================================================
// Printing Houses
// ============================================================================

export async function listPrintingHouses(status?: string): Promise<PrintingHouse[]> {
  const where = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  return db.query<PrintingHouse>(`SELECT * FROM printing_houses ${where} ORDER BY name`, params);
}

export async function getPrintingHouse(id: string): Promise<PrintingHouse | null> {
  return db.queryOne<PrintingHouse>(`SELECT * FROM printing_houses WHERE id = $1`, [id]);
}

export async function createPrintingHouse(data: Partial<PrintingHouse>): Promise<PrintingHouse> {
  const rows = await db.query<PrintingHouse>(
    `INSERT INTO printing_houses (
      name, code, status, contact_name, contact_phone, contact_email,
      website, address, notes, api_type, api_config, capabilities,
      delivery_zones, min_order_amount
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      data.name, data.code, data.status ?? 'active',
      data.contact_name ?? null, data.contact_phone ?? null, data.contact_email ?? null,
      data.website ?? null, data.address ?? null, data.notes ?? null,
      data.api_type ?? 'manual',
      JSON.stringify(data.api_config ?? {}),
      data.capabilities ?? [],
      data.delivery_zones ?? [],
      data.min_order_amount ?? 0,
    ],
  );
  return rows[0];
}

export async function updatePrintingHouse(id: string, data: Partial<PrintingHouse>): Promise<PrintingHouse | null> {
  const allowed: (keyof PrintingHouse)[] = [
    'name', 'code', 'status', 'contact_name', 'contact_phone', 'contact_email',
    'website', 'address', 'notes', 'api_type', 'api_config', 'capabilities',
    'delivery_zones', 'min_order_amount',
  ];
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(key === 'api_config' ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (fields.length === 0) return getPrintingHouse(id);
  values.push(id);
  return db.queryOne<PrintingHouse>(
    `UPDATE printing_houses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values,
  );
}

export async function deletePrintingHouse(id: string): Promise<void> {
  const house = await getPrintingHouse(id);
  if (!house) throw new AppError(404, 'Типография не найдена');

  // Check for non-terminal orders
  const activeOrders = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM production_orders
     WHERE printing_house_id = $1 AND status NOT IN ('completed','cancelled','returned')`,
    [id],
  );
  if (activeOrders && parseInt(activeOrders.cnt) > 0) {
    throw new AppError(400, 'Нельзя удалить типографию с активными заказами. Сначала завершите или отмените их.');
  }

  // Soft-delete if there are any historical orders, hard-delete otherwise
  const hasOrders = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM production_orders WHERE printing_house_id = $1`,
    [id],
  );
  if (hasOrders && parseInt(hasOrders.cnt) > 0) {
    await db.query(`UPDATE printing_houses SET status = 'inactive' WHERE id = $1`, [id]);
  } else {
    await db.query(`DELETE FROM printing_houses WHERE id = $1`, [id]);
  }
}

// ============================================================================
// Printing House Products
// ============================================================================

export async function listProducts(houseId: string): Promise<PrintingHouseProduct[]> {
  return db.query<PrintingHouseProduct>(
    `SELECT p.*, ph.name AS printing_house_name
     FROM printing_house_products p
     JOIN printing_houses ph ON ph.id = p.printing_house_id
     WHERE p.printing_house_id = $1 ORDER BY p.sort_order, p.name`,
    [houseId],
  );
}

export async function getAllProducts(): Promise<PrintingHouseProduct[]> {
  return db.query<PrintingHouseProduct>(
    `SELECT p.*, ph.name AS printing_house_name
     FROM printing_house_products p
     JOIN printing_houses ph ON ph.id = p.printing_house_id
     ORDER BY ph.name, p.sort_order, p.name
     LIMIT 500`,
  );
}

export async function compareProductsByCategory(category: string): Promise<ProductComparison> {
  const rows = await db.query<{
    house_id: string; house_name: string; product_id: string; product_name: string;
    base_price: number; lead_time_days: number; available_formats: string[];
  }>(
    `SELECT ph.id AS house_id, ph.name AS house_name,
            p.id AS product_id, p.name AS product_name,
            p.base_price, p.lead_time_days, p.available_formats
     FROM printing_house_products p
     JOIN printing_houses ph ON ph.id = p.printing_house_id
     WHERE p.category = $1 AND p.is_active = true AND ph.status != 'inactive'
     ORDER BY ph.name, p.base_price`,
    [category],
  );
  return {
    category,
    products: rows.map(r => ({
      house_id: r.house_id, house_name: r.house_name,
      product_id: r.product_id, product_name: r.product_name,
      base_price: Number(r.base_price), lead_time_days: r.lead_time_days,
      formats: r.available_formats,
    })),
  };
}

export async function createProduct(houseId: string, data: Partial<PrintingHouseProduct>): Promise<PrintingHouseProduct> {
  const rows = await db.query<PrintingHouseProduct>(
    `INSERT INTO printing_house_products (
      printing_house_id, name, category, sku, description, base_price, price_unit,
      min_quantity, available_formats, available_materials, options, lead_time_days,
      express_available, express_surcharge_pct, notes, is_active, sort_order
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [
      houseId, data.name, data.category,
      data.sku ?? null, data.description ?? null,
      data.base_price ?? 0, data.price_unit ?? 'piece', data.min_quantity ?? 1,
      data.available_formats ?? [], data.available_materials ?? [],
      JSON.stringify(data.options ?? {}), data.lead_time_days ?? 3,
      data.express_available ?? false, data.express_surcharge_pct ?? 50,
      data.notes ?? null, data.is_active ?? true, data.sort_order ?? 0,
    ],
  );
  return rows[0];
}

export async function updateProduct(id: string, data: Partial<PrintingHouseProduct>): Promise<PrintingHouseProduct | null> {
  const allowed: (keyof PrintingHouseProduct)[] = [
    'name', 'category', 'sku', 'description', 'base_price', 'price_unit',
    'min_quantity', 'available_formats', 'available_materials', 'options',
    'lead_time_days', 'express_available', 'express_surcharge_pct', 'notes',
    'is_active', 'sort_order',
  ];
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(key === 'options' ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (fields.length === 0) return db.queryOne<PrintingHouseProduct>(`SELECT * FROM printing_house_products WHERE id = $1`, [id]);
  values.push(id);
  return db.queryOne<PrintingHouseProduct>(
    `UPDATE printing_house_products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values,
  );
}

export async function deleteProduct(id: string): Promise<void> {
  // Check if product is referenced in any active orders' items JSONB
  const inUse = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM production_orders
     WHERE items @> jsonb_build_array(jsonb_build_object('product_id', $1::text))
       AND status NOT IN ('cancelled','returned')`,
    [id],
  );
  if (inUse && parseInt(inUse.cnt) > 0) {
    // Soft-delete: deactivate instead of hard delete
    await db.query(`UPDATE printing_house_products SET is_active = false WHERE id = $1`, [id]);
    return;
  }
  const result = await db.query<{ id: string }>(
    `DELETE FROM printing_house_products WHERE id = $1 RETURNING id`, [id],
  );
  if (result.length === 0) throw new AppError(404, 'Продукт не найден');
}

// ============================================================================
// Product Reference Data — Справочник параметров
// ============================================================================

export interface ProductReferenceData {
  id: string;
  ref_type: string;
  ref_key: string;
  display_name: string;
  category_scope: string[];
  metadata: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface PriceModifier {
  type: 'absolute' | 'percent' | 'multiplier';
  value: number;
  lead_time_delta?: number;
}

export interface PriceCalculation {
  base_price: number;
  modifiers: Array<{ key: string; label: string; modifier: PriceModifier; delta: number }>;
  final_price: number;
  base_lead_time: number;
  final_lead_time: number;
}

export async function listReferenceData(refType?: string, category?: string): Promise<ProductReferenceData[]> {
  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];
  let idx = 1;

  if (refType) {
    conditions.push(`ref_type = $${idx++}`);
    params.push(refType);
  }
  if (category) {
    // Возвращаем записи где category_scope пустой (для всех) ИЛИ содержит нужную категорию
    conditions.push(`(cardinality(category_scope) = 0 OR $${idx++} = ANY(category_scope))`);
    params.push(category);
  }

  return db.query<ProductReferenceData>(
    `SELECT * FROM product_reference_data
     WHERE ${conditions.join(' AND ')}
     ORDER BY ref_type, sort_order, display_name`,
    params,
  );
}

export async function createReferenceDataItem(data: Omit<ProductReferenceData, 'id' | 'created_at'>): Promise<ProductReferenceData> {
  const rows = await db.query<ProductReferenceData>(
    `INSERT INTO product_reference_data
      (ref_type, ref_key, display_name, category_scope, metadata, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.ref_type, data.ref_key, data.display_name,
      data.category_scope ?? [],
      JSON.stringify(data.metadata ?? {}),
      data.sort_order ?? 0, data.is_active ?? true,
    ],
  );
  if (!rows[0]) throw new AppError(500, 'Не удалось создать запись справочника');
  return rows[0];
}

export async function updateReferenceDataItem(id: string, data: Partial<ProductReferenceData>): Promise<ProductReferenceData> {
  const allowed = ['ref_key', 'display_name', 'category_scope', 'metadata', 'sort_order', 'is_active'] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(key === 'metadata' ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (fields.length === 0) {
    const row = await db.queryOne<ProductReferenceData>(`SELECT * FROM product_reference_data WHERE id = $1`, [id]);
    if (!row) throw new AppError(404, 'Запись справочника не найдена');
    return row;
  }
  values.push(id);
  const row = await db.queryOne<ProductReferenceData>(
    `UPDATE product_reference_data SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!row) throw new AppError(404, 'Запись справочника не найдена');
  return row;
}

export async function deleteReferenceDataItem(id: string): Promise<void> {
  const result = await db.query<{ id: string }>(
    `DELETE FROM product_reference_data WHERE id = $1 RETURNING id`, [id],
  );
  if (result.length === 0) throw new AppError(404, 'Запись справочника не найдена');
}

export function calculateProductPrice(product: PrintingHouseProduct, specs: Record<string, unknown>): PriceCalculation {
  const modifiers = (product.options as Record<string, unknown>)['price_modifiers'] as Record<string, PriceModifier> | undefined ?? {};
  const leadTimeOverrides = (product.options as Record<string, unknown>)['lead_time_overrides'] as Record<string, number> | undefined ?? {};

  let finalPrice = Number(product.base_price);
  let finalLeadTime = product.lead_time_days;
  const appliedModifiers: PriceCalculation['modifiers'] = [];

  // Применяем модификаторы для каждого выбранного значения спецификации
  for (const [specKey, specValue] of Object.entries(specs)) {
    const modKey = `${specKey}:${specValue}`;
    const mod = modifiers[modKey];
    if (!mod) continue;

    let delta = 0;
    if (mod.type === 'absolute') {
      delta = mod.value;
      finalPrice += delta;
    } else if (mod.type === 'percent') {
      delta = Number(product.base_price) * mod.value / 100;
      finalPrice += delta;
    } else if (mod.type === 'multiplier') {
      delta = Number(product.base_price) * (mod.value - 1);
      finalPrice = Number(product.base_price) * mod.value +
        appliedModifiers.reduce((sum, m) => sum + m.delta, 0);
    }

    const leadDelta = leadTimeOverrides[modKey] ?? mod.lead_time_delta ?? 0;
    finalLeadTime += leadDelta;

    appliedModifiers.push({ key: modKey, label: String(specValue), modifier: mod, delta });
  }

  return {
    base_price: Number(product.base_price),
    modifiers: appliedModifiers,
    final_price: Math.round(finalPrice * 100) / 100,
    base_lead_time: product.lead_time_days,
    final_lead_time: finalLeadTime,
  };
}

// ============================================================================
// Production Orders
// ============================================================================

export async function listProductionOrders(filters: OrderFilters): Promise<{ orders: ProductionOrder[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) { conditions.push(`po.status = $${idx++}`); params.push(filters.status); }
  if (filters.printing_house_id) { conditions.push(`po.printing_house_id = $${idx++}`); params.push(filters.printing_house_id); }
  if (filters.from) { conditions.push(`po.created_at >= $${idx++}`); params.push(filters.from); }
  if (filters.to) { conditions.push(`po.created_at <= $${idx++}`); params.push(filters.to); }
  if (filters.search) {
    conditions.push(`(po.order_number ILIKE $${idx} OR COALESCE(c.name, '') ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const countRows = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM production_orders po
     LEFT JOIN customers c ON c.id = po.customer_id
     ${where}`, params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const dataParams = [...params, limit, offset];
  const orders = await db.query<ProductionOrder>(
    `SELECT po.*,
            ph.name AS printing_house_name,
            ppo.order_id AS photo_print_order_number,
            c.name AS customer_name,
            COALESCE(u.display_name, u.email) AS created_by_name
     FROM production_orders po
     LEFT JOIN printing_houses ph ON ph.id = po.printing_house_id
     LEFT JOIN photo_print_orders ppo ON ppo.id = po.photo_print_order_id
     LEFT JOIN customers c ON c.id = po.customer_id
     LEFT JOIN users u ON u.id = po.created_by
     ${where}
     ORDER BY po.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    dataParams,
  );
  return { orders, total };
}

export async function getProductionOrder(id: string): Promise<ProductionOrder | null> {
  return db.queryOne<ProductionOrder>(
    `SELECT po.*,
            ph.name AS printing_house_name,
            ppo.order_id AS photo_print_order_number,
            c.name AS customer_name,
            COALESCE(u.display_name, u.email) AS created_by_name
     FROM production_orders po
     LEFT JOIN printing_houses ph ON ph.id = po.printing_house_id
     LEFT JOIN photo_print_orders ppo ON ppo.id = po.photo_print_order_id
     LEFT JOIN customers c ON c.id = po.customer_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE po.id = $1`,
    [id],
  );
}

export async function getOrdersByPhotoOrder(photoOrderId: string): Promise<ProductionOrder[]> {
  return db.query<ProductionOrder>(
    `SELECT po.*,
            ph.name AS printing_house_name,
            COALESCE(u.display_name, u.email) AS created_by_name
     FROM production_orders po
     LEFT JOIN printing_houses ph ON ph.id = po.printing_house_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE po.photo_print_order_id = $1
     ORDER BY po.created_at DESC`,
    [photoOrderId],
  );
}

export async function createProductionOrder(data: Partial<ProductionOrder>, userId: string): Promise<ProductionOrder> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      return await db.transaction(async (client: PoolClient) => {
        const result = await client.query<ProductionOrder>(
          `INSERT INTO production_orders (
            order_number, printing_house_id, photo_print_order_id, customer_id, created_by,
            status, items, total_cost, deadline_at, estimated_delivery_at,
            delivery_method, internal_notes, printing_house_notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            orderNumber, data.printing_house_id,
            data.photo_print_order_id ?? null, data.customer_id ?? null, userId,
            data.status ?? 'draft', JSON.stringify(data.items ?? []),
            data.total_cost ?? 0, data.deadline_at ?? null, data.estimated_delivery_at ?? null,
            data.delivery_method ?? 'pickup', data.internal_notes ?? null, data.printing_house_notes ?? null,
          ],
        );
        const order = result.rows[0];
        await addOrderEvent(order.id, 'created', null, 'draft', null, userId, client);
        return order;
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      // 23505 = unique_violation — retry with a new number
      if (pgErr?.code === '23505' && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new AppError(500, 'Не удалось сгенерировать уникальный номер заказа');
}

export async function updateOrderStatus(
  id: string,
  status: ProductionOrderStatus,
  userId: string,
  comment?: string,
): Promise<ProductionOrder | null> {
  const current = await getProductionOrder(id);
  if (!current) return null;

  if (!isValidStatusTransition(current.status, status)) {
    throw new AppError(400, `Недопустимый переход статуса: ${current.status} → ${status}`);
  }

  const tsFields: Record<string, string> = {
    sent: 'sent_at', confirmed: 'confirmed_at', completed: 'completed_at', delivered: 'actual_delivery_at',
  };
  const tsField = tsFields[status];

  const updated = await db.transaction(async (client: PoolClient) => {
    const result = await client.query<ProductionOrder>(
      `UPDATE production_orders SET status = $1 ${tsField ? `, ${tsField} = NOW()` : ''} WHERE id = $2 RETURNING *`,
      [status, id],
    );
    const row = result.rows[0];
    if (!row) return null;
    await addOrderEvent(id, 'status_change', current.status, status, comment ?? null, userId, client);
    return row;
  });

  if (updated && ['completed', 'delivered', 'returned', 'cancelled'].includes(status)) {
    await recalculateHouseMetrics(current.printing_house_id);
  }
  return updated;
}

export async function batchUpdateStatus(ids: string[], status: ProductionOrderStatus, userId: string): Promise<number> {
  if (ids.length === 0) return 0;

  return db.transaction(async (client: PoolClient) => {
    // Fetch old statuses before updating for accurate event logging + transition validation
    const oldResult = await client.query<{ id: string; status: string; printing_house_id: string }>(
      `SELECT id, status, printing_house_id FROM production_orders WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const oldStatusMap = new Map(oldResult.rows.map(r => [r.id, r.status as ProductionOrderStatus]));

    // Filter only valid transitions
    const validIds = oldResult.rows
      .filter(r => isValidStatusTransition(r.status as ProductionOrderStatus, status))
      .map(r => r.id);
    if (validIds.length === 0) return 0;

    // Bulk update
    const updateResult = await client.query<{ id: string; printing_house_id: string }>(
      `UPDATE production_orders SET status = $1 WHERE id = ANY($2::uuid[]) RETURNING id, printing_house_id`,
      [status, validIds],
    );

    // Bulk event insert via unnest
    const eventIds = updateResult.rows.map(r => r.id);
    const oldStatuses = eventIds.map(id => oldStatusMap.get(id) ?? null);
    if (eventIds.length > 0) {
      await client.query(
        `INSERT INTO production_order_events (production_order_id, event_type, old_value, new_value, comment, created_by)
         SELECT unnest($1::uuid[]), 'status_change', unnest($2::text[]), $3, 'Пакетное обновление', $4`,
        [eventIds, oldStatuses, status, userId],
      );
    }

    // Recalculate metrics for affected houses (outside transaction — idempotent)
    const houseIds = [...new Set(updateResult.rows.map(r => r.printing_house_id))];
    // Fire-and-forget metrics after transaction completes
    void Promise.all(houseIds.map(hid => recalculateHouseMetrics(hid)));

    return updateResult.rows.length;
  });
}

export async function cancelOrder(id: string, reason: string, userId: string): Promise<void> {
  const current = await getProductionOrder(id);
  if (!current) throw new AppError(404, 'Заказ не найден');

  if (!isValidStatusTransition(current.status, 'cancelled')) {
    throw new AppError(400, `Невозможно отменить заказ в статусе "${current.status}"`);
  }

  await db.transaction(async (client: PoolClient) => {
    await client.query(
      `UPDATE production_orders SET status = 'cancelled', cancel_reason = $1, cancelled_at = NOW() WHERE id = $2`,
      [reason, id],
    );
    await addOrderEvent(id, 'status_change', current.status, 'cancelled', reason, userId, client);
  });

  await recalculateHouseMetrics(current.printing_house_id);
}

export async function updateOrderDetails(
  id: string,
  data: Partial<Pick<ProductionOrder,
    'tracking_number' | 'internal_notes' | 'printing_house_notes' |
    'deadline_at' | 'estimated_delivery_at' | 'delivery_method' | 'items' | 'total_cost'
  >>,
  userId: string,
): Promise<ProductionOrder | null> {
  const allowed = [
    'tracking_number', 'internal_notes', 'printing_house_notes',
    'deadline_at', 'estimated_delivery_at', 'delivery_method', 'items', 'total_cost',
  ] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = $${idx++}`);
      values.push(key === 'items' ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (fields.length === 0) return getProductionOrder(id);
  values.push(id);

  return db.transaction(async (client: PoolClient) => {
    const result = await client.query<ProductionOrder>(
      `UPDATE production_orders SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values,
    );
    const row = result.rows[0] ?? null;
    if (row) {
      await addOrderEvent(id, 'note_added', null, null, 'Детали заказа обновлены', userId, client);
    }
    return row;
  });
}

export async function rateOrderQuality(
  id: string, rating: number, notes: string, hasDefects: boolean, userId: string,
): Promise<void> {
  const current = await getProductionOrder(id);
  if (!current) throw new AppError(404, 'Заказ не найден');

  await db.transaction(async (client: PoolClient) => {
    await client.query(
      `UPDATE production_orders SET quality_rating = $1, quality_notes = $2, has_defects = $3 WHERE id = $4`,
      [rating, notes, hasDefects, id],
    );
    await addOrderEvent(id, 'quality_review', null, String(rating),
      `${hasDefects ? 'Обнаружен брак. ' : ''}${notes}`, userId, client,
    );
  });

  await recalculateHouseMetrics(current.printing_house_id);
}

// ============================================================================
// Timeline
// ============================================================================

export async function getOrderTimeline(orderId: string): Promise<ProductionOrderEvent[]> {
  return db.query<ProductionOrderEvent>(
    `SELECT e.*, COALESCE(u.display_name, u.email) AS created_by_name
     FROM production_order_events e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.production_order_id = $1 ORDER BY e.created_at`,
    [orderId],
  );
}

async function addOrderEvent(
  orderId: string, eventType: string,
  oldValue: string | null, newValue: string | null,
  comment: string | null, userId: string | null,
  client?: PoolClient,
): Promise<void> {
  const sql = `INSERT INTO production_order_events (production_order_id, event_type, old_value, new_value, comment, created_by)
               VALUES ($1,$2,$3,$4,$5,$6)`;
  const params = [orderId, eventType, oldValue, newValue, comment, userId];
  if (client) {
    await client.query(sql, params);
  } else {
    await db.query(sql, params);
  }
}

// ============================================================================
// Analytics
// ============================================================================

export async function getProductionAnalytics(from: string, to: string): Promise<ProductionAnalytics> {
  const p = [from, to];
  const [byHouse, byCat, delivery, quality, monthly, statusDist] = await Promise.all([
    db.query<{ house_id: string; house_name: string; total: string; order_count: string }>(
      `SELECT po.printing_house_id AS house_id, ph.name AS house_name,
              SUM(po.total_cost) AS total, COUNT(*)::int AS order_count
       FROM production_orders po JOIN printing_houses ph ON ph.id = po.printing_house_id
       WHERE po.created_at BETWEEN $1 AND $2 AND po.status NOT IN ('cancelled','draft')
       GROUP BY po.printing_house_id, ph.name ORDER BY total DESC`, p,
    ),
    db.query<{ category: string; total: string; order_count: string }>(
      `SELECT item->>'category' AS category,
              SUM((item->>'total_price')::numeric) AS total, COUNT(*)::int AS order_count
       FROM production_orders po, jsonb_array_elements(po.items) AS item
       WHERE po.created_at BETWEEN $1 AND $2 AND po.status NOT IN ('cancelled','draft')
       GROUP BY item->>'category' ORDER BY total DESC`, p,
    ),
    db.query<{ on_time_count: string; total_delivered: string; avg_delay_days: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE actual_delivery_at <= deadline_at OR deadline_at IS NULL) AS on_time_count,
         COUNT(*) AS total_delivered,
         AVG(EXTRACT(EPOCH FROM (actual_delivery_at - estimated_delivery_at)) / 86400)
           FILTER (WHERE actual_delivery_at > estimated_delivery_at) AS avg_delay_days
       FROM production_orders
       WHERE created_at BETWEEN $1 AND $2
         AND status IN ('delivered','completed') AND actual_delivery_at IS NOT NULL`, p,
    ),
    db.query<{ avg_rating: string; defect_count: string; total_rated: string }>(
      `SELECT AVG(quality_rating) AS avg_rating,
              COUNT(*) FILTER (WHERE has_defects = true) AS defect_count,
              COUNT(*) FILTER (WHERE quality_rating IS NOT NULL) AS total_rated
       FROM production_orders WHERE created_at BETWEEN $1 AND $2 AND status NOT IN ('cancelled','draft')`, p,
    ),
    db.query<{ month: string; total_cost: string; order_count: string }>(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
              SUM(total_cost) AS total_cost, COUNT(*)::int AS order_count
       FROM production_orders
       WHERE created_at BETWEEN $1 AND $2 AND status NOT IN ('cancelled','draft')
       GROUP BY DATE_TRUNC('month', created_at) ORDER BY month`, p,
    ),
    db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::int AS count FROM production_orders
       WHERE created_at BETWEEN $1 AND $2 GROUP BY status ORDER BY count DESC`, p,
    ),
  ]);

  const dp = delivery[0];
  const qm = quality[0];
  const totalDel = parseInt(dp?.total_delivered ?? '0', 10);
  const onTime = parseInt(dp?.on_time_count ?? '0', 10);
  const totalRated = parseInt(qm?.total_rated ?? '0', 10);
  const defects = parseInt(qm?.defect_count ?? '0', 10);

  return {
    spending_by_house: byHouse.map(r => ({
      house_id: r.house_id, house_name: r.house_name,
      total: Number(r.total), order_count: Number(r.order_count),
    })),
    spending_by_category: byCat.map(r => ({
      category: r.category, total: Number(r.total), order_count: Number(r.order_count),
    })),
    delivery_performance: {
      on_time_pct: totalDel > 0 ? Math.round((onTime / totalDel) * 100) : 0,
      avg_delay_days: Math.round((Number(dp?.avg_delay_days) || 0) * 10) / 10,
      total_orders: totalDel,
    },
    quality_metrics: {
      avg_rating: Math.round((Number(qm?.avg_rating) || 0) * 10) / 10,
      defect_rate: totalRated > 0 ? Math.round((defects / totalRated) * 100) : 0,
      reprint_count: defects,
    },
    monthly_trends: monthly.map(r => ({ month: r.month, total_cost: Number(r.total_cost), order_count: Number(r.order_count) })),
    status_distribution: statusDist.map(r => ({ status: r.status, count: Number(r.count) })),
  };
}

export async function getHousePerformance(houseId: string): Promise<HousePerformance | null> {
  const house = await getPrintingHouse(houseId);
  if (!house) return null;

  const [s30, s90, avgLead, trend] = await Promise.all([
    db.query<{ count: string }>(`SELECT COUNT(*) FROM production_orders WHERE printing_house_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [houseId]),
    db.query<{ count: string }>(`SELECT COUNT(*) FROM production_orders WHERE printing_house_id=$1 AND created_at>=NOW()-INTERVAL '90 days'`, [houseId]),
    db.query<{ avg_days: string }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (actual_delivery_at - sent_at))/86400) AS avg_days
       FROM production_orders WHERE printing_house_id=$1 AND status IN ('delivered','completed') AND sent_at IS NOT NULL AND actual_delivery_at IS NOT NULL`, [houseId],
    ),
    db.query<{ month: string; total: string; count: string }>(
      `SELECT TO_CHAR(DATE_TRUNC('month',created_at),'YYYY-MM') AS month,
              SUM(total_cost) AS total, COUNT(*)::int AS count
       FROM production_orders WHERE printing_house_id=$1 AND status NOT IN ('cancelled','draft') AND created_at>=NOW()-INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month',created_at) ORDER BY month`, [houseId],
    ),
  ]);

  return {
    house,
    orders_last_30d: parseInt(s30[0]?.count ?? '0', 10),
    orders_last_90d: parseInt(s90[0]?.count ?? '0', 10),
    avg_lead_time_days: Math.round((Number(avgLead[0]?.avg_days) || 0) * 10) / 10,
    on_time_pct: house.on_time_rate,
    defect_rate: house.defect_rate,
    avg_quality_rating: house.quality_score,
    total_spent: house.total_spent,
    monthly_trend: trend.map(r => ({ month: r.month, total: Number(r.total), count: Number(r.count) })),
  };
}

// ============================================================================
// House metrics recalculation
// ============================================================================

export async function recalculateHouseMetrics(houseId: string): Promise<void> {
  await db.query(
    `UPDATE printing_houses SET
       total_orders = sub.total_orders,
       total_spent  = sub.total_spent,
       quality_score = sub.avg_rating,
       on_time_rate  = sub.on_time_pct,
       defect_rate   = sub.defect_pct
     FROM (
       SELECT
         COUNT(*) AS total_orders,
         COALESCE(SUM(total_cost), 0) AS total_spent,
         COALESCE(AVG(quality_rating), 0) AS avg_rating,
         CASE WHEN COUNT(*) FILTER (WHERE status IN ('delivered','completed')) > 0
              THEN ROUND(
                COUNT(*) FILTER (WHERE status IN ('delivered','completed') AND (actual_delivery_at<=deadline_at OR deadline_at IS NULL))::numeric
                / COUNT(*) FILTER (WHERE status IN ('delivered','completed'))::numeric * 100, 1)
              ELSE 0 END AS on_time_pct,
         CASE WHEN COUNT(*) FILTER (WHERE quality_rating IS NOT NULL) > 0
              THEN ROUND(COUNT(*) FILTER (WHERE has_defects=true)::numeric
                / COUNT(*) FILTER (WHERE quality_rating IS NOT NULL)::numeric * 100, 1)
              ELSE 0 END AS defect_pct
       FROM production_orders WHERE printing_house_id = $1 AND status NOT IN ('draft')
     ) sub WHERE id = $1`,
    [houseId],
  );
}
