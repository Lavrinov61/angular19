import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getAllRulesEnriched,
  previewConsumption,
  createRule,
  updateRule,
  deleteRule,
} from '../services/consumable-rules.service.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';
import type { ProductStockId } from '../types/generated/public/ProductStock.js';

const router = Router();

// All consumable-rules routes require authentication + pos:use
router.use(authenticateToken, requirePermission('pos:use'));

// ─── GET all active rules (enriched) ─────────────────

router.get('/', async (_req: AuthRequest, res: Response) => {
  const rules = await getAllRulesEnriched();
  res.json({ success: true, rules });
});

// ─── POST preview consumption ────────────────────────

router.post('/preview', async (req: AuthRequest, res: Response) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'items array is required');
  }

  const typedItems = (items as Array<{ option_id: string; quantity: number }>).map(i => ({
    option_id: i.option_id as ServiceOptionsId,
    quantity: i.quantity,
  }));

  const preview = await previewConsumption(typedItems);
  res.json({ success: true, preview });
});

// ─── POST create rule (admin) ────────────────────────

router.post('/', requirePermission('settings:manage'), async (req: AuthRequest, res: Response) => {
  const { service_option_id, product_stock_id, quantity_per_unit, unit_label } = req.body;
  if (!service_option_id || !product_stock_id || quantity_per_unit === undefined) {
    throw new AppError(400, 'service_option_id, product_stock_id and quantity_per_unit are required');
  }
  if (typeof quantity_per_unit !== 'number' || quantity_per_unit <= 0) {
    throw new AppError(400, 'quantity_per_unit must be a positive number');
  }

  const rule = await createRule({
    service_option_id: service_option_id as ServiceOptionsId,
    product_stock_id: product_stock_id as ProductStockId,
    quantity_per_unit,
    unit_label,
  });
  res.status(201).json({ success: true, rule });
});

// ─── PATCH update rule ───────────────────────────────

router.patch('/:id', requirePermission('settings:manage'), async (req: AuthRequest, res: Response) => {
  const ruleId = req.params['id'];
  const { quantity_per_unit, unit_label, is_active } = req.body;

  const rule = await updateRule(ruleId, { quantity_per_unit, unit_label, is_active });
  res.json({ success: true, rule });
});

// ─── DELETE (soft-delete) rule ───────────────────────

router.delete('/:id', requirePermission('settings:manage'), async (req: AuthRequest, res: Response) => {
  const ruleId = req.params['id'];
  await deleteRule(ruleId);
  res.json({ success: true });
});

export default router;
