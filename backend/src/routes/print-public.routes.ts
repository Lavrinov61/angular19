/**
 * Print Public Routes — public-facing API for online photo print ordering.
 *
 * GET  /api/print-online/formats           — available formats with prices
 * POST /api/print-online/calculate          — price calculation
 * GET  /api/print-online/orders/:orderId    — order status by order_id
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../middleware/errorHandler.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import {
  getPhotoPrintFormats,
  calculatePrintPrice,
  getPrintOrderStatus,
  resolveUnitPrice,
} from '../services/print-public.service.js';
import { isPhotoPrintPriceRules } from '../types/views/print-public-views.js';
import type { PrintCalculateItem } from '../types/views/print-public-views.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';

const router = Router();

const printPublicLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('rl:print-pub:'),
  message: { success: false, error: 'Too many requests' },
});

const calculateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('rl:print-calc:'),
  message: { success: false, error: 'Too many requests' },
});

router.use(printPublicLimiter);

// ─── FORMATS (public) ───────────────────────────────

router.get('/formats', async (_req: Request, res: Response) => {
  const formats = await getPhotoPrintFormats();

  const result = formats.map(f => {
    const rules = isPhotoPrintPriceRules(f.price_rules) ? f.price_rules : null;
    return {
      slug: f.slug,
      name: f.name,
      price_per_unit: f.price_per_unit,
      paper_types: rules?.paper_types ?? ['glossy'],
      volume_discounts: rules?.volume_discounts ?? [],
      matte_surcharge: rules?.matte_surcharge ?? 0,
    };
  });

  res.json({ success: true, formats: result });
});

// ─── CALCULATE (public) ─────────────────────────────

router.post('/calculate', calculateLimiter, async (req: Request, res: Response) => {
  const { items, phone } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'items array is required');
  }

  // Validate each item structure
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      throw new AppError(400, 'Each item must be an object with format_slug, quantity');
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec['format_slug'] !== 'string') {
      throw new AppError(400, 'format_slug is required for each item');
    }
    if (typeof rec['quantity'] !== 'number' || rec['quantity'] < 1) {
      throw new AppError(400, 'quantity must be a positive number');
    }
  }

  const validItems: PrintCalculateItem[] = items.map((item: Record<string, unknown>) => ({
    format_slug: String(item['format_slug']),
    paper_type: typeof item['paper_type'] === 'string' ? item['paper_type'] : 'glossy',
    quantity: Number(item['quantity']),
  }));

  const result = await calculatePrintPrice(validItems, typeof phone === 'string' ? phone : undefined);
  res.json({ success: true, ...result });
});

// ─── ORDER STATUS (public, by order_id) ─────────────

router.get('/orders/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  if (!orderId) {
    throw new AppError(400, 'orderId is required');
  }

  const order = await getPrintOrderStatus(orderId);
  if (!order) {
    throw new AppError(404, 'Заказ не найден');
  }

  res.json({
    success: true,
    order: {
      order_id: order.order_id,
      status: order.status,
      payment_status: order.payment_status,
      total_price: parseFloat(order.total_price),
      created_at: order.created_at,
      estimated_ready_at: order.estimated_ready_at,
    },
  });
});

export default router;
