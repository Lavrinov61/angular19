import { Router, Response } from 'express';
import { authenticateToken, requirePermission, requireUser } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getStudioStock,
  getHistory,
  receive,
  writeOff,
  transfer,
  startAudit,
  recordAuditItem,
  completeAudit,
  updateForecast,
} from '../services/inventory.service.js';
import type { ProductStockId } from '../types/generated/public/ProductStock.js';
import type { StudiosId } from '../types/generated/public/Studios.js';
import type { UsersId } from '../types/generated/public/Users.js';

import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('inventory.routes');

// All inventory routes require authentication + pos:use permission
router.use(authenticateToken, requirePermission('pos:use'));

// ─── STOCK ───────────────────────────────────────────

router.get('/stock/:studioId', async (req: AuthRequest, res: Response) => {
  const studioId = req.params['studioId'] as StudiosId;
  if (!studioId) throw new AppError(400, 'studioId is required');

  const stock = await getStudioStock(studioId);
  res.json({ success: true, stock });
});

// ─── HISTORY ─────────────────────────────────────────

router.get('/history/:productStockId', async (req: AuthRequest, res: Response) => {
  const productStockId = req.params['productStockId'] as ProductStockId;
  if (!productStockId) throw new AppError(400, 'productStockId is required');

  const result = await getHistory(productStockId, {
    limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    offset: req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : undefined,
    dateFrom: req.query['date_from'] as string | undefined,
    dateTo: req.query['date_to'] as string | undefined,
  });

  res.json({ success: true, ...result });
});

// ─── RECEIVE ─────────────────────────────────────────

router.post('/receive', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { product_stock_id, studio_id, quantity, notes } = req.body;
  if (!product_stock_id || !studio_id || !quantity) {
    throw new AppError(400, 'product_stock_id, studio_id and quantity are required');
  }

  const tx = await receive(
    product_stock_id as ProductStockId,
    studio_id as StudiosId,
    quantity,
    req.user.id as UsersId,
    notes,
  );

  // Fire-and-forget forecast update
  updateForecast(studio_id as StudiosId).catch((err: unknown) => {
    logger.error('Forecast update failed after receive', { detail: err instanceof Error ? err.message : String(err) });
  });

  res.status(201).json({ success: true, transaction: tx });
});

// ─── WRITE-OFF ───────────────────────────────────────

router.post('/write-off', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { product_stock_id, studio_id, quantity, notes } = req.body;
  if (!product_stock_id || !studio_id || !quantity) {
    throw new AppError(400, 'product_stock_id, studio_id and quantity are required');
  }

  const tx = await writeOff(
    product_stock_id as ProductStockId,
    studio_id as StudiosId,
    quantity,
    req.user.id as UsersId,
    notes,
  );

  updateForecast(studio_id as StudiosId).catch((err: unknown) => {
    logger.error('Forecast update failed after write-off', { detail: err instanceof Error ? err.message : String(err) });
  });

  res.status(201).json({ success: true, transaction: tx });
});

// ─── TRANSFER ────────────────────────────────────────

router.post('/transfer', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { product_stock_id, from_studio_id, to_studio_id, quantity } = req.body;
  if (!product_stock_id || !from_studio_id || !to_studio_id || !quantity) {
    throw new AppError(400, 'product_stock_id, from_studio_id, to_studio_id and quantity are required');
  }

  const result = await transfer(
    product_stock_id as ProductStockId,
    from_studio_id as StudiosId,
    to_studio_id as StudiosId,
    quantity,
    req.user.id as UsersId,
  );

  // Update forecast for both studios
  Promise.all([
    updateForecast(from_studio_id as StudiosId),
    updateForecast(to_studio_id as StudiosId),
  ]).catch((err: unknown) => {
    logger.error('Forecast update failed after transfer', { detail: err instanceof Error ? err.message : String(err) });
  });

  res.status(201).json({ success: true, transfer: result });
});

// ─── AUDIT ───────────────────────────────────────────

router.post('/audit/start', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const { studio_id } = req.body;
  if (!studio_id) throw new AppError(400, 'studio_id is required');

  const audit = await startAudit(
    studio_id as StudiosId,
    req.user.id as UsersId,
  );

  res.status(201).json({ success: true, audit });
});

router.post('/audit/:id/item', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const auditId = req.params['id'];
  const { product_stock_id, actual_quantity } = req.body;
  if (!product_stock_id || actual_quantity === undefined) {
    throw new AppError(400, 'product_stock_id and actual_quantity are required');
  }

  const item = await recordAuditItem(
    auditId,
    product_stock_id as ProductStockId,
    actual_quantity,
  );

  res.json({ success: true, item });
});

router.post('/audit/:id/complete', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const auditId = req.params['id'];

  const audit = await completeAudit(auditId);

  // Update forecast after audit adjustments
  updateForecast(audit.studio_id).catch((err: unknown) => {
    logger.error('Forecast update failed after audit', { detail: err instanceof Error ? err.message : String(err) });
  });

  res.json({ success: true, audit });
});

export default router;
