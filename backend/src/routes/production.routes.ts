/**
 * Production Routes — управление типографиями и производственными заказами
 * Все роуты требуют: authenticateToken + requirePermission('production:manage')
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createPrintingHouseSchema, updatePrintingHouseSchema, createProductSchema,
  createProductionOrderSchema, batchStatusSchema, updateProductionStatusSchema,
  updateProductionOrderSchema, cancelProductionOrderSchema, rateQualitySchema,
  createReferenceDataSchema, createFromReceiptSchema,
} from '../schemas/production.schema.js';
import {
  listPrintingHouses, getPrintingHouse, createPrintingHouse, updatePrintingHouse, deletePrintingHouse,
  listProducts, getAllProducts, compareProductsByCategory,
  createProduct, updateProduct, deleteProduct,
  listProductionOrders, getProductionOrder, createProductionOrder,
  updateOrderStatus, batchUpdateStatus, cancelOrder, updateOrderDetails,
  rateOrderQuality, getOrderTimeline, getOrdersByPhotoOrder,
  getProductionAnalytics, getHousePerformance,
  listReferenceData, createReferenceDataItem, updateReferenceDataItem, deleteReferenceDataItem,
  calculateProductPrice,
  type ProductionOrderStatus,
} from '../services/production.service.js';
import { sendProductionOrderEmail, type ProductionEmailData } from '../services/email.service.js';
import db from '../database/db.js';

// ─── Validation helpers ───────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUUID(value: string, label = 'id'): void {
  if (!UUID_REGEX.test(value)) throw new AppError(400, `${label} должен быть UUID`);
}

const VALID_STATUSES = new Set<string>([
  'draft','pending','sent','confirmed','in_production',
  'quality_check','shipped','delivered','completed','cancelled','returned',
]);
function assertStatus(status: string): asserts status is ProductionOrderStatus {
  if (!VALID_STATUSES.has(status)) throw new AppError(400, `Недопустимый статус: ${status}`);
}
import {
  getHouseRecommendations, getCostOptimizations, getDemandForecast,
  getQualityAlerts, getAllProductionInsights, getProductionContext,
} from '../services/production-ai.service.js';
import { logAudit } from '../services/audit.service.js';
import type { SocketServer } from '../websocket/socket-server.js';

function getSocketServer(req: AuthRequest): SocketServer | undefined {
  return (req.app as unknown as Record<string, unknown>)['socketServer'] as SocketServer | undefined;
}

const router = Router();
router.use(authenticateToken, requirePermission('production:manage'));

// ─── Printing Houses ─────────────────────────────────────────────────────────

/**
 * GET /api/production/houses
 * Список типографий
 */
router.get('/houses', async (req: AuthRequest, res: Response): Promise<void> => {
  const status = req.query['status'] as string | undefined;
  const houses = await listPrintingHouses(status);
  res.json({ success: true, data: houses });
});

/**
 * GET /api/production/houses/:id
 * Одна типография
 */
router.get('/houses/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']);
  const house = await getPrintingHouse(req.params['id']);
  if (!house) throw new AppError(404, 'Типография не найдена');
  res.json({ success: true, data: house });
});

/**
 * POST /api/production/houses
 * Создать типографию
 */
router.post('/houses', validate(createPrintingHouseSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const house = await createPrintingHouse(req.body);
  logAudit({ userId: req.user['id'], action: 'production_house_create', entityType: 'printing_house', entityId: house.id, details: { name: house.name }, ip: req.ip });
  res.status(201).json({ success: true, data: house });
});

/**
 * PATCH /api/production/houses/:id
 * Обновить типографию
 */
router.patch('/houses/:id', validate(updatePrintingHouseSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  const house = await updatePrintingHouse(req.params['id'], req.body);
  if (!house) throw new AppError(404, 'Типография не найдена');
  logAudit({ userId: req.user['id'], action: 'production_house_update', entityType: 'printing_house', entityId: house.id, details: { name: house.name }, ip: req.ip });
  res.json({ success: true, data: house });
});

/**
 * DELETE /api/production/houses/:id
 * Удалить типографию (soft-delete если есть заказы)
 */
router.delete('/houses/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  await deletePrintingHouse(req.params['id']);
  logAudit({ userId: req.user['id'], action: 'production_house_delete', entityType: 'printing_house', entityId: req.params['id'], ip: req.ip });
  res.json({ success: true });
});

// ─── Products ────────────────────────────────────────────────────────────────

/**
 * GET /api/production/products
 * Все активные продукты всех типографий
 */
router.get('/products', async (_req: AuthRequest, res: Response): Promise<void> => {
  const products = await getAllProducts();
  res.json({ success: true, data: products });
});

/**
 * GET /api/production/products/compare/:category
 * Сравнение продуктов по категории
 */
router.get('/products/compare/:category', async (req: AuthRequest, res: Response): Promise<void> => {
  const comparison = await compareProductsByCategory(req.params['category']);
  res.json({ success: true, data: comparison });
});

/**
 * GET /api/production/houses/:houseId/products
 * Продукты одной типографии
 */
router.get('/houses/:houseId/products', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['houseId'], 'houseId');
  const products = await listProducts(req.params['houseId']);
  res.json({ success: true, data: products });
});

/**
 * POST /api/production/houses/:houseId/products
 * Добавить продукт
 */
router.post('/houses/:houseId/products', validate(createProductSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['houseId'], 'houseId');
  const product = await createProduct(req.params['houseId'], req.body);
  logAudit({ userId: req.user['id'], action: 'production_product_create', entityType: 'printing_house_product', entityId: product.id, details: { name: product.name, houseId: req.params['houseId'] }, ip: req.ip });
  res.status(201).json({ success: true, data: product });
});

/**
 * PATCH /api/production/products/:id
 * Обновить продукт
 */
router.patch('/products/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  const product = await updateProduct(req.params['id'], req.body);
  if (!product) throw new AppError(404, 'Продукт не найден');
  logAudit({ userId: req.user['id'], action: 'production_product_update', entityType: 'printing_house_product', entityId: product.id, details: { name: product.name }, ip: req.ip });
  res.json({ success: true, data: product });
});

/**
 * DELETE /api/production/products/:id
 * Удалить продукт
 */
router.delete('/products/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  await deleteProduct(req.params['id']);
  logAudit({ userId: req.user['id'], action: 'production_product_delete', entityType: 'printing_house_product', entityId: req.params['id'], ip: req.ip });
  res.json({ success: true });
});

// ─── Production Orders ────────────────────────────────────────────────────────

/**
 * GET /api/production/orders
 * Список заказов с фильтрами: status, printing_house_id, from, to, search, limit, offset
 */
router.get('/orders', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, printing_house_id, from, to, search, limit, offset } = req.query as Record<string, string>;
  const result = await listProductionOrders({
    status, printing_house_id, from, to, search,
    limit: limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });
  res.json({ success: true, data: result });
});

/**
 * GET /api/production/orders/by-photo-order/:photoOrderId
 * Производственные заказы, связанные с клиентским заказом (фаза 4.3)
 */
router.get('/orders/by-photo-order/:photoOrderId', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['photoOrderId'], 'photoOrderId');
  const orders = await getOrdersByPhotoOrder(req.params['photoOrderId']);
  res.json({ success: true, data: orders });
});

/**
 * GET /api/production/orders/:id
 * Один заказ с деталями
 */
router.get('/orders/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']);
  const order = await getProductionOrder(req.params['id']);
  if (!order) throw new AppError(404, 'Заказ не найден');
  res.json({ success: true, data: order });
});

/**
 * POST /api/production/orders
 * Создать заказ
 */
router.post('/orders', validate(createProductionOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const order = await createProductionOrder(req.body, req.user['id']);
  logAudit({ userId: req.user['id'], action: 'production_order_create', entityType: 'production_order', entityId: order.id, details: { order_number: order.order_number }, ip: req.ip });
  getSocketServer(req)?.sendProductionEvent('production:order-created', { orderId: order.id, orderNumber: order.order_number });
  res.status(201).json({ success: true, data: order });
});

/**
 * POST /api/production/orders/batch-status
 * Массовая смена статуса
 */
router.post('/orders/batch-status', validate(batchStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { ids, status } = req.body;
  const count = await batchUpdateStatus(ids, status, req.user['id']);
  logAudit({ userId: req.user['id'], action: 'production_batch_status', entityType: 'production_order', entityId: ids[0], details: { status, count, ids }, ip: req.ip });
  getSocketServer(req)?.sendProductionEvent('production:status-changed', { batch: true, ids, status, count });
  res.json({ success: true, data: { updated: count } });
});

/**
 * PATCH /api/production/orders/:id/status
 * Сменить статус заказа
 */
router.patch('/orders/:id/status', validate(updateProductionStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { status, comment } = req.body;
  assertUUID(req.params['id'], 'orderId');
  const order = await updateOrderStatus(req.params['id'], status, req.user['id'], comment);
  if (!order) throw new AppError(404, 'Заказ не найден');
  logAudit({ userId: req.user['id'], action: 'production_status_change', entityType: 'production_order', entityId: order.id, details: { status, order_number: order.order_number }, ip: req.ip });
  getSocketServer(req)?.sendProductionEvent('production:status-changed', { orderId: order.id, orderNumber: order.order_number, status });
  res.json({ success: true, data: order });
});

/**
 * PATCH /api/production/orders/:id
 * Обновить детали заказа (трек-номер, заметки, дедлайн)
 */
router.patch('/orders/:id', validate(updateProductionOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);

  const order = await updateOrderDetails(req.params['id'], req.body, req.user['id']);
  if (!order) throw new AppError(404, 'Заказ не найден');
  res.json({ success: true, data: order });
});

/**
 * POST /api/production/orders/:id/cancel
 * Отменить заказ
 */
router.post('/orders/:id/cancel', validate(cancelProductionOrderSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  const { reason } = req.body;
  await cancelOrder(req.params['id'], reason, req.user['id']);
  logAudit({ userId: req.user['id'], action: 'production_order_cancel', entityType: 'production_order', entityId: req.params['id'], details: { reason }, ip: req.ip });
  getSocketServer(req)?.sendProductionEvent('production:order-cancelled', { orderId: req.params['id'], reason });
  res.json({ success: true });
});

/**
 * POST /api/production/orders/:id/quality
 * Оценить качество полученного заказа
 */
router.post('/orders/:id/quality', validate(rateQualitySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  const { rating, notes, has_defects } = req.body;
  await rateOrderQuality(req.params['id'], rating, notes, has_defects, req.user['id']);
  res.json({ success: true });
});

/**
 * GET /api/production/orders/:id/timeline
 * Таймлайн событий заказа
 */
router.get('/orders/:id/timeline', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']);
  const timeline = await getOrderTimeline(req.params['id']);
  res.json({ success: true, data: timeline });
});

// ─── Analytics ───────────────────────────────────────────────────────────────

/**
 * GET /api/production/analytics
 * Аналитика расходов, сроков, качества
 * Query: from (ISO date), to (ISO date)
 */
router.get('/analytics', async (req: AuthRequest, res: Response): Promise<void> => {
  const from = (req.query['from'] as string) || new Date(Date.now() - 90 * 24 * 3600000).toISOString();
  const to = (req.query['to'] as string) || new Date().toISOString();
  const analytics = await getProductionAnalytics(from, to);
  res.json({ success: true, data: analytics });
});

/**
 * GET /api/production/analytics/house/:id
 * Производительность конкретной типографии
 */
router.get('/analytics/house/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']);
  const perf = await getHousePerformance(req.params['id']);
  if (!perf) throw new AppError(404, 'Типография не найдена');
  res.json({ success: true, data: perf });
});

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/production/ai/insights
 * Все AI-инсайты одним запросом (рекомендации + оптимизация + прогноз + алерты)
 */
router.get('/ai/insights', async (_req: AuthRequest, res: Response): Promise<void> => {
  const insights = await getAllProductionInsights();
  res.json({ success: true, data: insights.data, error: insights.error });
});

/**
 * GET /api/production/ai/recommendations
 * Рекомендации лучшей типографии по категориям
 */
router.get('/ai/recommendations', async (_req: AuthRequest, res: Response): Promise<void> => {
  const context = await getProductionContext();
  const result = await getHouseRecommendations(context);
  res.json({ success: true, data: result.data, error: result.error });
});

/**
 * GET /api/production/ai/cost-optimizations
 * Предложения по снижению затрат
 */
router.get('/ai/cost-optimizations', async (_req: AuthRequest, res: Response): Promise<void> => {
  const context = await getProductionContext();
  const result = await getCostOptimizations(context);
  res.json({ success: true, data: result.data, error: result.error });
});

/**
 * GET /api/production/ai/demand-forecast
 * Прогноз спроса на 2 недели
 */
router.get('/ai/demand-forecast', async (_req: AuthRequest, res: Response): Promise<void> => {
  const result = await getDemandForecast();
  res.json({ success: true, data: result.data, error: result.error });
});

/**
 * GET /api/production/ai/quality-alerts
 * Алерты по качеству типографий
 */
router.get('/ai/quality-alerts', async (_req: AuthRequest, res: Response): Promise<void> => {
  const data = await getQualityAlerts();
  res.json({ success: true, data });
});

// ─── Reference Data ───────────────────────────────────────────────────────────

/**
 * GET /api/production/reference-data
 * Справочник параметров продукции
 * Query: ?type=binding&category=photo_book
 */
router.get('/reference-data', async (req: AuthRequest, res: Response): Promise<void> => {
  const refType = req.query['type'] as string | undefined;
  const category = req.query['category'] as string | undefined;
  const data = await listReferenceData(refType, category);
  res.json({ success: true, data });
});

/**
 * POST /api/production/reference-data
 * Создать запись справочника
 */
router.post('/reference-data', validate(createReferenceDataSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { ref_type, ref_key, display_name, category_scope, metadata, sort_order, is_active } = req.body;
  const item = await createReferenceDataItem({
    ref_type,
    ref_key,
    display_name,
    category_scope,
    metadata,
    sort_order,
    is_active,
  });
  logAudit({ userId: req.user!.id, action: 'create', entityType: 'product_reference_data', entityId: item.id, details: item as unknown as Record<string, unknown> });
  res.status(201).json({ success: true, data: item });
});

/**
 * PATCH /api/production/reference-data/:id
 * Обновить запись справочника
 */
router.patch('/reference-data/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']!);
  const item = await updateReferenceDataItem(req.params['id']!, req.body as Record<string, unknown>);
  logAudit({ userId: req.user!.id, action: 'update', entityType: 'product_reference_data', entityId: item.id, details: item as unknown as Record<string, unknown> });
  res.json({ success: true, data: item });
});

/**
 * DELETE /api/production/reference-data/:id
 * Удалить запись справочника
 */
router.delete('/reference-data/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']!);
  await deleteReferenceDataItem(req.params['id']!);
  logAudit({ userId: req.user!.id, action: 'delete', entityType: 'product_reference_data', entityId: req.params['id']! });
  res.json({ success: true });
});

/**
 * POST /api/production/products/:id/calculate-price
 * Рассчитать цену продукта с учётом выбранных спецификаций
 * Body: { specs: { size: "30x30", binding: "layflat", ... } }
 */
router.post('/products/:id/calculate-price', async (req: AuthRequest, res: Response): Promise<void> => {
  assertUUID(req.params['id']!);
  const products = await getAllProducts();
  const product = products.find(p => p.id === req.params['id']!);
  if (!product) throw new AppError(404, 'Продукт не найден');
  const specs = (req.body as Record<string, unknown>)['specs'] as Record<string, unknown> ?? {};
  const result = calculateProductPrice(product, specs);
  res.json({ success: true, data: result });
});

// ─── Production Email ─────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  canvas: ['холст', 'canvas', 'натяж', 'подрамник'],
  photo_book: ['фотокниг', 'книг', 'альбом'],
  calendar: ['календар'],
  photo_print: ['фотопечат', 'печат', '10x15', '15x21', '20x30'],
  large_format: ['плакат', 'poster', 'баннер', 'широкоформат'],
  souvenir: ['кружк', 'магнит', 'пазл', 'подушк'],
  polygraphy: ['визитк', 'листовк', 'буклет'],
};

function inferProductionCategory(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return null;
}

async function findBestHouse(categories: string[]): Promise<{ id: string; name: string; contact_email: string | null } | null> {
  if (categories.length === 0) return null;
  const row = await db.queryOne<{ id: string; name: string; contact_email: string | null }>(
    `SELECT ph.id, ph.name, ph.contact_email
     FROM printing_houses ph
     JOIN printing_house_products pp ON pp.printing_house_id = ph.id AND pp.is_active = true
     WHERE ph.status = 'active'
       AND pp.category = ANY($1::text[])
     GROUP BY ph.id, ph.name, ph.contact_email
     ORDER BY COUNT(DISTINCT pp.category) DESC, ph.quality_score DESC
     LIMIT 1`,
    [categories],
  );
  return row ?? null;
}

/**
 * POST /api/production/orders/:id/send-email
 * Отправить ТЗ на email типографии
 */
router.post('/orders/:id/send-email', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  assertUUID(req.params['id']);
  const orderId = req.params['id'];

  const order = await getProductionOrder(orderId);
  if (!order) throw new AppError(404, 'Заказ не найден');

  // Load printing house
  const house = await getPrintingHouse(order.printing_house_id);
  if (!house) throw new AppError(404, 'Типография не найдена');
  if (!house.contact_email) throw new AppError(400, 'У типографии не указан email');

  const { printing_house_notes, file_uuids } = req.body as {
    printing_house_notes?: string;
    file_uuids?: string[];
  };

  // If extra file_uuids passed, link them to the production_order
  if (file_uuids && file_uuids.length > 0) {
    await db.query(
      `UPDATE crm_files SET entity_type = 'production_order', entity_id = $1, is_public = true
       WHERE uuid = ANY($2::text[]) AND deleted_at IS NULL`,
      [orderId, file_uuids],
    );
  }

  // Make all files for this order public
  await db.query(
    `UPDATE crm_files SET is_public = true
     WHERE entity_type = 'production_order' AND entity_id = $1 AND deleted_at IS NULL`,
    [orderId],
  );

  // Load all linked files
  const files = await db.query<{ uuid: string; original_name: string }>(
    `SELECT uuid, original_name FROM crm_files
     WHERE entity_type = 'production_order' AND entity_id = $1 AND deleted_at IS NULL
     ORDER BY created_at`,
    [orderId],
  );

  const baseUrl = 'https://svoefoto.ru';
  const fileLinks = files.map(f => ({
    name: f.original_name,
    url: `${baseUrl}/api/files/crm/${f.uuid}`,
  }));

  // Get operator name
  const operator = await db.queryOne<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1`, [req.user['id']],
  );

  const emailData: ProductionEmailData = {
    order_number: order.order_number,
    items: (order.items || []).map(item => ({
      product_name: item.product_name,
      category: item.category || '',
      specs: item.specs || {},
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    })),
    total_cost: order.total_cost,
    deadline_at: order.deadline_at,
    delivery_method: order.delivery_method,
    printing_house_notes: printing_house_notes ?? order.printing_house_notes ?? null,
    file_links: fileLinks,
    operator_name: operator?.display_name || 'Оператор',
    created_at: order.created_at,
  };

  // Update notes if passed
  if (printing_house_notes !== undefined) {
    await db.query(
      `UPDATE production_orders SET printing_house_notes = $1 WHERE id = $2`,
      [printing_house_notes, orderId],
    );
  }

  await sendProductionOrderEmail(house.contact_email, emailData);

  // Record in email_messages
  await db.query(
    `INSERT INTO email_messages (direction, subject, body_html, from_address, to_address, entity_type, entity_id, status, sent_at)
     VALUES ('outbound', $1, '', $2, $3, 'production_order', $4, 'sent', NOW())`,
    [
      `Заказ на производство ${order.order_number}`,
      'noreply@svoefoto.ru',
      house.contact_email,
      orderId,
    ],
  );

  // Update order status to 'sent' if draft/pending
  let newStatus = order.status;
  if (order.status === 'draft' || order.status === 'pending') {
    await updateOrderStatus(orderId, 'sent', req.user['id'], 'Email отправлен в типографию');
    newStatus = 'sent';
  }

  logAudit({
    userId: req.user['id'],
    action: 'production_email_sent',
    entityType: 'production_order',
    entityId: orderId,
    details: { order_number: order.order_number, house: house.name, email: house.contact_email },
    ip: req.ip,
  });

  getSocketServer(req)?.sendProductionEvent('production:email-sent', {
    orderId, orderNumber: order.order_number, status: newStatus,
  });

  res.json({ success: true, data: { emailId: 0, orderStatus: newStatus } });
});

/**
 * POST /api/production/orders/from-receipt
 * Создать production order из POS-чека
 */
router.post('/orders/from-receipt', validate(createFromReceiptSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { receipt_id, printing_house_id } = req.body;

  // Load receipt items
  const receiptItems = await db.query<{
    product_name: string; quantity: number; unit_price: number; total: number;
  }>(
    `SELECT product_name, quantity, unit_price, total FROM pos_receipt_items WHERE receipt_id = $1`,
    [receipt_id],
  );
  if (receiptItems.length === 0) throw new AppError(404, 'Чек не найден или пуст');

  // Infer categories
  const categories = [...new Set(
    receiptItems.map(i => inferProductionCategory(i.product_name)).filter((c): c is string => c !== null),
  )];

  // Determine printing house
  let houseId = printing_house_id;
  if (!houseId) {
    const best = await findBestHouse(categories);
    if (best) houseId = best.id;
  }
  if (!houseId) throw new AppError(400, 'Не удалось определить типографию. Укажите printing_house_id.');

  assertUUID(houseId, 'printing_house_id');

  // Map items
  const items = receiptItems.map(ri => ({
    product_id: houseId!,
    product_name: ri.product_name,
    category: inferProductionCategory(ri.product_name) || 'other',
    specs: {},
    quantity: ri.quantity,
    unit_price: ri.unit_price,
    total_price: ri.total,
  }));

  const totalCost = items.reduce((sum, i) => sum + i.total_price, 0);

  const order = await createProductionOrder({
    printing_house_id: houseId,
    items,
    total_cost: totalCost,
    status: 'draft',
  }, req.user['id']);

  logAudit({
    userId: req.user['id'],
    action: 'production_order_from_receipt',
    entityType: 'production_order',
    entityId: order.id,
    details: { receipt_id, order_number: order.order_number },
    ip: req.ip,
  });

  getSocketServer(req)?.sendProductionEvent('production:order-created', {
    orderId: order.id, orderNumber: order.order_number,
  });

  res.status(201).json({ success: true, data: order });
});

export default router;
