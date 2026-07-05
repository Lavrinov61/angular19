import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getCashReconciliationReport,
  getDailySummary,
  getRevenueReport,
  getTopProducts,
} from '../services/crm-reports.service.js';

const router = Router();

// All report routes require admin or employee role
router.use(authenticateToken, requirePermission('reports:view'));

// ─── REVENUE BY PERIOD ───────────────────────────────

router.get('/revenue', async (req: Request, res: Response) => {
  const from = (req.query['from'] as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query['to'] as string) || new Date().toISOString().slice(0, 10);
  const groupBy = (req.query['groupBy'] as 'day' | 'week' | 'month') || 'day';

  if (!['day', 'week', 'month'].includes(groupBy)) {
    throw new AppError(400, 'groupBy must be day, week, or month');
  }

  const data = await getRevenueReport(from, to, groupBy);
  res.json({ success: true, data, from, to, groupBy });
});

// ─── DAILY SUMMARY ───────────────────────────────────

router.get('/daily-summary', async (_req: Request, res: Response) => {
  const data = await getDailySummary();
  res.json({ success: true, data });
});

// ─── CASH RECONCILIATION ─────────────────────────────

router.get('/cash-control', requirePermission('users:manage'), async (req: Request, res: Response) => {
  const from = (req.query['from'] as string) || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = (req.query['to'] as string) || new Date().toISOString().slice(0, 10);

  const data = await getCashReconciliationReport(from, to);
  res.json({ success: true, data, from, to });
});

// ─── TOP PRODUCTS ────────────────────────────────────

router.get('/products', async (req: Request, res: Response) => {
  const from = (req.query['from'] as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = (req.query['to'] as string) || new Date().toISOString().slice(0, 10);
  const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100);

  const data = await getTopProducts(from, to, limit);
  res.json({ success: true, data, from, to });
});

export default router;
