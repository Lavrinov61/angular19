import { Router, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { getOperatorStatsSummary, getOperatorStatsPerOperator } from '../services/operator-stats.service.js';

const router = Router();

/**
 * GET /api/crm/operator-stats?period=today|week|month
 */
router.get('/', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const period = (req.query['period'] as string) || 'today';
  const [summary, operators] = await Promise.all([
    getOperatorStatsSummary(period),
    getOperatorStatsPerOperator(period),
  ]);

  res.json({ success: true, data: { summary, operators } });
});

export default router;
