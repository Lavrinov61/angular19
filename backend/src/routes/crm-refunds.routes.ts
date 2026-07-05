import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { idempotent } from '../middleware/idempotency.js';

const router = express.Router();

/**
 * GET /api/crm/refund-requests — список запросов на возврат
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const status = req.query['status'] as string;
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);
  const offset = parseInt(req.query['offset'] as string) || 0;

  let whereClause = '';
  const params: unknown[] = [];
  if (status && status !== 'all') {
    params.push(status);
    whereClause = `WHERE rr.status = $${params.length}`;
  }

  params.push(limit, offset);

  const rows = await db.query(`
    SELECT rr.id, rr.order_id, rr.reason, rr.status, rr.admin_comment,
           rr.created_at, rr.resolved_at,
           u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           ppo.total_price AS order_amount, ppo.service_type,
           ru.name AS resolved_by_name
    FROM refund_requests rr
    JOIN users u ON u.id = rr.user_id
    LEFT JOIN photo_print_orders ppo ON ppo.order_id = rr.order_id
    LEFT JOIN users ru ON ru.id = rr.resolved_by
    ${whereClause}
    ORDER BY
      CASE WHEN rr.status = 'pending' THEN 0 ELSE 1 END,
      rr.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*)::int AS count FROM refund_requests rr ${whereClause}
  `, status && status !== 'all' ? [status] : []);

  res.json({
    success: true,
    data: rows,
    total: countResult?.count || 0,
  });
});

/**
 * GET /api/crm/refund-requests/stats — количество по статусам
 */
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const stats = await db.queryOne(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending,
      COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS approved,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected
    FROM refund_requests
  `);

  res.json({ success: true, data: stats });
});

/**
 * PATCH /api/crm/refund-requests/:id — одобрить или отклонить
 */
router.patch('/:id', authenticateToken, idempotent(60), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    throw new AppError(403, 'Forbidden');
  }

  const { id } = req.params;
  const { action, comment } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    throw new AppError(400, 'action must be "approve" or "reject"');
  }

  const request = await db.queryOne<{ id: string; status: string; order_id: string }>(
    `SELECT id, status, order_id FROM refund_requests WHERE id = $1`,
    [id],
  );
  if (!request) throw new AppError(404, 'Запрос на возврат не найден');
  if (request.status !== 'pending') throw new AppError(400, 'Запрос уже обработан');

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await db.query(`
    UPDATE refund_requests
    SET status = $1, admin_comment = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
    WHERE id = $4
  `, [newStatus, comment || null, req.user.id, id]);

  if (action === 'approve') {
    await db.query(`
      UPDATE photo_print_orders
      SET payment_status = 'refunded', status = 'refunded', updated_at = NOW()
      WHERE order_id = $1
    `, [request.order_id]);
  }

  res.json({ success: true, status: newStatus });
});

export default router;
