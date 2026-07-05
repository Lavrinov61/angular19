/**
 * Employee Sales Routes
 *
 * GET /api/pos/sales/dashboard          — current employee dashboard (today)
 * GET /api/pos/sales/history            — current employee sales history
 * GET /api/pos/sales/dashboard/:employeeId — specific employee (admin/manager)
 * GET /api/pos/sales/leaderboard/:studioId — leaderboard for studio
 * GET /api/pos/sales/monthly/:period    — monthly stats (e.g. 2026-03)
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, requireUser } from '../middleware/auth.js';
import { ErrorCode } from '../constants/error-codes.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../types/index.js';
import { getDashboard, getHistory, getMonthlyStats, getLeaderboard } from '../services/employee-sales.service.js';

const router = Router();

// All sales routes require auth + pos:use
router.use(authenticateToken, requirePermission('pos:use'));

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseHistoryDate(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new AppError(400, `${label} должен быть датой ISO`, ErrorCode.VALIDATION_ERROR);
  }
  return new Date(timestamp).toISOString();
}

function parseHistoryLimit(value: unknown): number {
  const raw = typeof value === 'string' ? Number.parseInt(value, 10) : 500;
  if (!Number.isFinite(raw)) return 500;
  return Math.min(500, Math.max(1, Math.trunc(raw)));
}

// ─── Dashboard (current employee) ────────────────────────────────────────

router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const date = req.query['date'] as string | undefined;
  const dashboard = await getDashboard(req.user.id, date);
  res.json({ success: true, dashboard });
});

// ─── Sales History (current employee) ────────────────────────────────────

router.get('/history', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const dateFromRaw = queryString(req.query['date_from']);
  const dateToRaw = queryString(req.query['date_to']);
  if (!dateFromRaw || !dateToRaw) {
    throw new AppError(400, 'date_from и date_to обязательны', ErrorCode.VALIDATION_ERROR);
  }

  const dateFrom = parseHistoryDate(dateFromRaw, 'date_from');
  const dateTo = parseHistoryDate(dateToRaw, 'date_to');
  if (Date.parse(dateFrom) > Date.parse(dateTo)) {
    throw new AppError(400, 'date_from не может быть позже date_to', ErrorCode.VALIDATION_ERROR);
  }

  const history = await getHistory(req.user.id, dateFrom, dateTo, parseHistoryLimit(req.query['limit']));
  res.json({ success: true, ...history });
});

// ─── Dashboard (specific employee — admin/manager only) ──────────────────

router.get('/dashboard/:employeeId', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res: Response) => {
  const date = req.query['date'] as string | undefined;
  const dashboard = await getDashboard(req.params['employeeId'], date);
  res.json({ success: true, dashboard });
});

// ─── Leaderboard ─────────────────────────────────────────────────────────

router.get('/leaderboard/:studioId', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const period = (req.query['period'] as string) || new Date().toISOString().slice(0, 7);
  const leaderboard = await getLeaderboard(req.params['studioId'], period);
  res.json({ success: true, leaderboard });
});

// ─── Monthly Stats ───────────────────────────────────────────────────────

router.get('/monthly/:period', async (req: AuthRequest, res: Response) => {
  requireUser(req);
  const period = req.params['period'];
  if (!/^\d{4}-\d{2}$/.test(period)) {
    res.status(400).json({ success: false, error: 'Period must be YYYY-MM format' });
    return;
  }
  const stats = await getMonthlyStats(req.user.id, period);
  res.json({ success: true, stats });
});

export default router;
