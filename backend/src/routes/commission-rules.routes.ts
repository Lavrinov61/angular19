/**
 * Commission Rules Routes
 *
 * CRUD for commission rules (admin only):
 *   GET    /api/pos/commissions/rules
 *   POST   /api/pos/commissions/rules
 *   PATCH  /api/pos/commissions/rules/:id
 *   DELETE /api/pos/commissions/rules/:id
 *
 * Payouts:
 *   GET    /api/pos/commissions/payouts/:period
 *   POST   /api/pos/commissions/payouts/:id/approve
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, requireUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../types/index.js';
import {
  getCommissionRules,
  createCommissionRule,
  updateCommissionRule,
  deactivateCommissionRule,
  getPayouts,
  calculatePayout,
  approvePayout,
} from '../services/employee-sales.service.js';

const router = Router();

// All commission routes require auth + settings:manage (admin)
router.use(authenticateToken, requirePermission('settings:manage'));

// ─── Rules CRUD ──────────────────────────────────────────────────────────

router.get('/rules', async (_req: AuthRequest, res: Response) => {
  const rules = await getCommissionRules();
  res.json({ success: true, rules });
});

router.post('/rules', async (req: AuthRequest, res: Response) => {
  const { employee_id, role, category_slug, rate, min_receipt_total, priority } = req.body;
  if (rate === undefined) throw new AppError(400, 'rate is required');
  const result = await createCommissionRule({
    employee_id, role, category_slug, rate, min_receipt_total, priority,
  });
  res.status(201).json({ success: true, id: result.id });
});

router.patch('/rules/:id', async (req: AuthRequest, res: Response) => {
  const { rate, min_receipt_total, is_active, priority } = req.body;
  await updateCommissionRule(req.params['id'], { rate, min_receipt_total, is_active, priority });
  res.json({ success: true });
});

router.delete('/rules/:id', async (req: AuthRequest, res: Response) => {
  await deactivateCommissionRule(req.params['id']);
  res.json({ success: true });
});

// ─── Payouts ─────────────────────────────────────────────────────────────

router.get('/payouts/:period', async (req: AuthRequest, res: Response) => {
  const period = req.params['period'];
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new AppError(400, 'Period must be YYYY-MM format');
  }
  const payouts = await getPayouts(period);
  res.json({ success: true, payouts });
});

router.post('/payouts/calculate', async (req: AuthRequest, res: Response) => {
  const { employee_id, period } = req.body;
  if (!employee_id || !period) throw new AppError(400, 'employee_id and period required');
  const result = await calculatePayout(employee_id, period);
  res.status(201).json({ success: true, id: result.id });
});

router.post('/payouts/:id/approve', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  await approvePayout(req.params['id'], req.user.id);
  res.json({ success: true });
});

export default router;
