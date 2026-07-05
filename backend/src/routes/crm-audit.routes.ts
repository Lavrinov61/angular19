import { Router, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { getAuditLog } from '../services/audit.service.js';

const router = Router();

/**
 * GET /api/crm/audit
 * Audit log (admin only)
 */
router.get('/', authenticateToken, requirePermission('reports:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { userId, action, entityType, dateFrom, dateTo, limit, offset } = req.query;

  const result = await getAuditLog({
    userId: userId as string | undefined,
    action: action as string | undefined,
    entityType: entityType as string | undefined,
    dateFrom: dateFrom as string | undefined,
    dateTo: dateTo as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : 50,
    offset: offset ? parseInt(offset as string, 10) : 0,
  });

  res.json({ success: true, data: result.items, total: result.total });
});

export default router;
