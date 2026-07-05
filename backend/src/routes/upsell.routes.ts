/**
 * upsell.routes.ts — Upsell bonus system API
 *
 * GET  /api/upsell/my/stats?month=2026-03     — Employee upsell stats & bonus progress
 * POST /api/upsell/my/offer                    — Record an upsell offer
 * GET  /api/upsell/my/streak?month=2026-03     — Upsell streak details
 * GET  /api/upsell/studio/revenue?month=2026-03 — Studio revenue & team bonus progress
 */

import { Router, Response } from 'express';
import { authenticateToken, requireUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../types/index.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { OrdersId } from '../types/generated/public/Orders.js';
import {
  getUpsellStats,
  recordUpsellOffer,
  getUpsellStreak,
  getStudioRevenue,
} from '../services/upsell.service.js';

const router = Router();

const VALID_ITEMS = ['retouch', 'portrait', 'combo', 'print', 'frame'] as const;

function isStaff(role: string): boolean {
  return ['admin', 'employee', 'photographer'].includes(role);
}

function parseMonth(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  if (!/^\d{4}-\d{2}$/.test(s)) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  return s;
}

// GET /my/stats?month=2026-03
router.get('/my/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  if (!isStaff(req.user.role)) throw new AppError(403, 'Staff access required');

  const month = parseMonth(req.query['month']);
  const stats = await getUpsellStats(req.user.id as UsersId, month);
  res.json({ success: true, data: stats });
});

// POST /my/offer
router.post('/my/offer', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  if (!isStaff(req.user.role)) throw new AppError(403, 'Staff access required');

  const { order_id, offered_items, accepted } = req.body;

  if (!Array.isArray(offered_items) || offered_items.length === 0) {
    throw new AppError(400, 'offered_items must be a non-empty array');
  }
  for (const item of offered_items) {
    if (!VALID_ITEMS.includes(item)) {
      throw new AppError(400, `Invalid item: ${item}. Allowed: ${VALID_ITEMS.join(', ')}`);
    }
  }
  if (typeof accepted !== 'boolean') {
    throw new AppError(400, 'accepted must be a boolean');
  }

  const result = await recordUpsellOffer(
    req.user.id as UsersId,
    (order_id as OrdersId) || null,
    offered_items,
    accepted,
  );
  res.status(201).json({ success: true, data: result });
});

// GET /my/streak?month=2026-03
router.get('/my/streak', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  if (!isStaff(req.user.role)) throw new AppError(403, 'Staff access required');

  const month = parseMonth(req.query['month']);
  const streak = await getUpsellStreak(req.user.id as UsersId, month);
  res.json({ success: true, data: streak });
});

// GET /studio/revenue?month=2026-03
router.get('/studio/revenue', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  if (!isStaff(req.user.role)) throw new AppError(403, 'Staff access required');

  const month = parseMonth(req.query['month']);
  const revenue = await getStudioRevenue(month);
  res.json({ success: true, data: revenue });
});

export default router;
