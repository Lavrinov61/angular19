/**
 * Shipping Management API Routes
 *
 * Администрирование отправлений: список заказов с доставкой,
 * ручное создание отправлений, скачивание этикеток.
 *
 * Все эндпоинты требуют аутентификации + роль admin.
 */

import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { authenticateToken, type AuthRequest } from '../middleware/auth.js';
import { automateShipping } from '../services/shipping-automation.service.js';

const router = Router();

const LABELS_DIR = path.resolve(process.cwd(), 'uploads/labels');

/** Middleware: проверка роли admin */
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return false;
  }
  return true;
}

/**
 * GET /api/shipping/orders
 * Список заказов с доставкой (последние 50)
 */
router.get('/orders', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
  const offset = parseInt(req.query['offset'] as string) || 0;
  const status = req.query['status'] as string;

  let query = `
    SELECT order_id, contact_name, contact_phone, total_price, status,
           delivery_address, delivery_postal_code, delivery_cost,
           tracking_number, shipment_id, shipment_status, label_url,
           shipment_weight_grams, shipment_created_at,
           payment_status, paid_at, created_at
    FROM photo_print_orders
    WHERE delivery_address IS NOT NULL
  `;
  const params: (string | number)[] = [];

  if (status) {
    params.push(status);
    query += ` AND shipment_status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const orders = await db.query(query, params);

  // Общее количество
  const countResult = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM photo_print_orders WHERE delivery_address IS NOT NULL`,
  );

  res.json({
    success: true,
    data: orders,
    total: parseInt(countResult?.count || '0', 10),
    limit,
    offset,
  });
});

/**
 * GET /api/shipping/orders/:orderId
 * Детали отправления для конкретного заказа
 */
router.get('/orders/:orderId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const order = await db.queryOne(
    `SELECT id, order_id, mode, contact_name, contact_phone, contact_email, comments, total_price, items, status, payment_status, paid_at, processed_by, processed_at, completed_at, delivery_address, delivery_postal_code, delivery_cost, tracking_number, shipment_id, shipment_status, label_url, shipment_weight_grams, shipment_created_at, priority, chat_session_id, created_at, updated_at FROM photo_print_orders WHERE order_id = $1`,
    [req.params['orderId']],
  );

  if (!order) throw new AppError(404, 'Order not found');
  res.json({ success: true, data: order });
});

/**
 * POST /api/shipping/orders/:orderId/create-shipment
 * Ручное создание отправления (если автоматика не сработала)
 */
router.post('/orders/:orderId/create-shipment', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const orderId = req.params['orderId'] as string;

  // Сбросить статус для повторной попытки
  await db.query(
    `UPDATE photo_print_orders SET shipment_status = 'none' WHERE order_id = $1 AND shipment_status = 'error'`,
    [orderId],
  );

  await automateShipping(orderId);

  const updated = await db.queryOne(
    `SELECT shipment_status, tracking_number, shipment_id, label_url, shipment_weight_grams
       FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  res.json({ success: true, data: updated });
});

/**
 * GET /api/shipping/orders/:orderId/label
 * Скачать PDF этикетку
 */
router.get('/orders/:orderId/label', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const orderId = req.params['orderId'] as string;

  const order = await db.queryOne<{ label_url: string | null }>(
    `SELECT label_url FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (!order?.label_url) throw new AppError(404, 'Label not found');

  const filePath = path.join(process.cwd(), order.label_url);
  if (!fs.existsSync(filePath)) throw new AppError(404, 'Label file not found on disk');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="label-${orderId}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
});

/**
 * POST /api/shipping/orders/:orderId/mark-shipped
 * Отметить заказ как отправленный
 */
router.post('/orders/:orderId/mark-shipped', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const orderId = req.params['orderId'] as string;

  const updated = await db.queryOne(
    `UPDATE photo_print_orders
     SET shipment_status = 'shipped', status = 'shipped'
     WHERE order_id = $1 AND shipment_status IN ('created', 'label_generated')
     RETURNING order_id, shipment_status, tracking_number`,
    [orderId],
  );

  if (!updated) throw new AppError(400, 'Order not in shippable state');
  res.json({ success: true, data: updated });
});

export default router;
