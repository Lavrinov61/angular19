import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

function parsePeriod(period: string): string {
  const map: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
  return map[period] || '30 days';
}

// Summary KPIs
router.get('/summary', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const interval = parsePeriod(req.query['period'] as string || '30d');

  const stats = await db.queryOne<{
    total_revenue: string;
    order_count: number;
    paid_count: number;
    failed_count: number;
    pending_count: number;
    expired_count: number;
    avg_check: string;
  }>(`
    SELECT
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_price ELSE 0 END), 0)::numeric AS total_revenue,
      COUNT(*)::int AS order_count,
      COUNT(CASE WHEN payment_status = 'paid' THEN 1 END)::int AS paid_count,
      COUNT(CASE WHEN status = 'payment_failed' THEN 1 END)::int AS failed_count,
      COUNT(CASE WHEN payment_status IN ('pending_payment', 'pending') THEN 1 END)::int AS pending_count,
      COUNT(CASE WHEN status = 'expired' THEN 1 END)::int AS expired_count,
      COALESCE(AVG(CASE WHEN payment_status = 'paid' THEN total_price END), 0)::numeric AS avg_check
    FROM photo_print_orders
    WHERE created_at >= NOW() - $1::interval
  `, [interval]);

  const refundStats = await db.queryOne<{
    refund_count: number;
    refund_amount: string;
  }>(`
    SELECT COUNT(*)::int AS refund_count,
           COALESCE(SUM(CASE WHEN rr.status = 'approved' THEN ppo.total_price ELSE 0 END), 0)::numeric AS refund_amount
    FROM refund_requests rr
    JOIN photo_print_orders ppo ON ppo.order_id = rr.order_id
    WHERE rr.created_at >= NOW() - $1::interval
  `, [interval]);

  const orderCount = stats?.order_count || 0;
  const paidCount = stats?.paid_count || 0;
  const failedCount = stats?.failed_count || 0;

  res.json({
    success: true,
    data: {
      totalRevenue: Math.round(parseFloat(stats?.total_revenue || '0')),
      orderCount,
      paidCount,
      failedCount,
      pendingCount: stats?.pending_count || 0,
      expiredCount: stats?.expired_count || 0,
      avgCheck: Math.round(parseFloat(stats?.avg_check || '0')),
      conversionRate: orderCount > 0 ? Math.round((paidCount / orderCount) * 1000) / 10 : 0,
      failureRate: orderCount > 0 ? Math.round((failedCount / orderCount) * 1000) / 10 : 0,
      refundCount: refundStats?.refund_count || 0,
      refundAmount: Math.round(parseFloat(refundStats?.refund_amount || '0')),
    },
  });
});

// Payment method breakdown
router.get('/by-method', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const interval = parsePeriod(req.query['period'] as string || '30d');

  const rows = await db.query(`
    SELECT
      CASE
        WHEN payment_card_info ILIKE '%SBP%' OR payment_card_info ILIKE '%СБП%' THEN 'sbp'
        WHEN payment_card_info IS NOT NULL AND payment_card_info != '' THEN 'card'
        ELSE 'other'
      END AS method,
      COUNT(*)::int AS count,
      COALESCE(SUM(total_price), 0)::numeric AS amount
    FROM photo_print_orders
    WHERE payment_status = 'paid' AND paid_at >= NOW() - $1::interval
    GROUP BY method
    ORDER BY amount DESC
  `, [interval]);

  res.json({ success: true, data: rows });
});

// Daily revenue
router.get('/daily', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const interval = parsePeriod(req.query['period'] as string || '30d');

  const rows = await db.query(`
    SELECT
      paid_at::date AS date,
      COUNT(*)::int AS count,
      COALESCE(SUM(total_price), 0)::numeric AS revenue
    FROM photo_print_orders
    WHERE payment_status = 'paid' AND paid_at >= NOW() - $1::interval
    GROUP BY paid_at::date
    ORDER BY date DESC
  `, [interval]);

  res.json({ success: true, data: rows });
});

// Top services by revenue
router.get('/top-services', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const interval = parsePeriod(req.query['period'] as string || '30d');

  const rows = await db.query(`
    SELECT
      COALESCE(service_type, items->0->>'service', 'Другое') AS service,
      COUNT(*)::int AS count,
      COALESCE(SUM(total_price), 0)::numeric AS revenue
    FROM photo_print_orders
    WHERE payment_status = 'paid' AND paid_at >= NOW() - $1::interval
    GROUP BY service
    ORDER BY revenue DESC
    LIMIT 10
  `, [interval]);

  res.json({ success: true, data: rows });
});

export default router;
