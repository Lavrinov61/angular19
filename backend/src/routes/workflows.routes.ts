/**
 * Workflow Automation Routes — ФотоПульт CRM Wave 6
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { triggerEvent, TriggerType } from '../services/workflow-engine.service.js';

const router = Router();
router.use(authenticateToken, requirePermission('workflows:manage'));

const VALID_TRIGGERS: TriggerType[] = [
  'order_paid', 'chat_created', 'chat_closed', 'booking_completed', 'manual',
];
const VALID_ACTIONS = ['create_task', 'notify_team', 'send_email', 'add_note', 'set_tag'];
const VALID_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with'];

// ── GET /api/workflows ────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { is_active, trigger_type } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  if (is_active !== undefined) {
    params.push(is_active === 'true');
    whereClause += ` AND is_active = $${params.length}`;
  }
  if (trigger_type) {
    params.push(trigger_type);
    whereClause += ` AND trigger_type = $${params.length}`;
  }

  const rows = await db.query(
    `SELECT w.*,
            u.name AS created_by_name,
            (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id) AS total_runs,
            (SELECT COUNT(*) FROM workflow_runs r WHERE r.workflow_id = w.id AND r.status = 'completed') AS success_runs
     FROM workflows w
     LEFT JOIN users u ON u.id = w.created_by
     ${whereClause}
     ORDER BY w.updated_at DESC`,
    params,
  );

  res.json({ success: true, data: rows });
});

// ── POST /api/workflows ───────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { name, description, trigger_type, conditions, actions, is_active } = req.body;

  if (!name?.trim()) throw new AppError(400, 'name обязателен');
  if (!trigger_type || !VALID_TRIGGERS.includes(trigger_type)) {
    throw new AppError(400, `trigger_type должен быть: ${VALID_TRIGGERS.join(', ')}`);
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new AppError(400, 'actions — обязательный непустой массив');
  }

  const conds = Array.isArray(conditions) ? conditions : [];
  for (const c of conds) {
    if (!c.field || !c.op || c.value === undefined) {
      throw new AppError(400, 'Каждое условие: field, op, value');
    }
    if (!VALID_OPS.includes(c.op)) {
      throw new AppError(400, `Недопустимый op: ${c.op}`);
    }
  }
  for (const a of actions) {
    if (!a.type || !VALID_ACTIONS.includes(a.type)) {
      throw new AppError(400, `Недопустимый тип action: ${a.type}`);
    }
    if (typeof a.delay_seconds !== 'number' || a.delay_seconds < 0) {
      throw new AppError(400, 'delay_seconds должен быть >= 0');
    }
    if (!a.params || typeof a.params !== 'object') {
      throw new AppError(400, 'params обязателен для каждого action');
    }
  }

  const rows = await db.query(
    `INSERT INTO workflows (name, description, trigger_type, conditions, actions, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      name.trim(),
      description?.trim() || null,
      trigger_type,
      JSON.stringify(conds),
      JSON.stringify(actions),
      is_active !== false,
      req.user.id,
    ],
  );

  res.status(201).json({ success: true, data: rows[0] });
});

// ── GET /api/workflows/:id ────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const rows = await db.query(
    `SELECT w.*, u.name AS created_by_name
     FROM workflows w
     LEFT JOIN users u ON u.id = w.created_by
     WHERE w.id = $1`,
    [id],
  );

  if (!rows[0]) throw new AppError(404, 'Workflow не найден');
  res.json({ success: true, data: rows[0] });
});

// ── PATCH /api/workflows/:id ──────────────────────────────────

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const { name, description, trigger_type, conditions, actions, is_active } = req.body;

  const fields: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) {
    if (!name.trim()) throw new AppError(400, 'name не может быть пустым');
    params.push(name.trim()); fields.push(`name = $${params.length}`);
  }
  if (description !== undefined) {
    params.push(description?.trim() || null); fields.push(`description = $${params.length}`);
  }
  if (trigger_type !== undefined) {
    if (!VALID_TRIGGERS.includes(trigger_type)) throw new AppError(400, 'Недопустимый trigger_type');
    params.push(trigger_type); fields.push(`trigger_type = $${params.length}`);
  }
  if (conditions !== undefined) {
    if (!Array.isArray(conditions)) throw new AppError(400, 'conditions — массив');
    params.push(JSON.stringify(conditions)); fields.push(`conditions = $${params.length}`);
  }
  if (actions !== undefined) {
    if (!Array.isArray(actions) || actions.length === 0) throw new AppError(400, 'actions — непустой массив');
    params.push(JSON.stringify(actions)); fields.push(`actions = $${params.length}`);
  }
  if (is_active !== undefined) {
    params.push(Boolean(is_active)); fields.push(`is_active = $${params.length}`);
  }

  if (fields.length === 0) throw new AppError(400, 'Нет полей для обновления');

  params.push(new Date().toISOString()); fields.push(`updated_at = $${params.length}`);
  params.push(id);

  const rows = await db.query(
    `UPDATE workflows SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );

  if (!rows[0]) throw new AppError(404, 'Workflow не найден');
  res.json({ success: true, data: rows[0] });
});

// ── DELETE /api/workflows/:id ─────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const rows = await db.query(`DELETE FROM workflows WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw new AppError(404, 'Workflow не найден');

  res.json({ success: true });
});

// ── POST /api/workflows/:id/run ───────────────────────────────

router.post('/:id/run', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const rows = await db.query<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM workflows WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'Workflow не найден');
  if (!rows[0].is_active) throw new AppError(400, 'Workflow неактивен');

  const testPayload = { ...req.body, entity_type: 'manual', manual_run_by: req.user?.id };
  await triggerEvent('manual', testPayload);

  res.json({ success: true, message: 'Workflow запущен вручную' });
});

// ── GET /api/workflows/:id/runs ───────────────────────────────

router.get('/:id/runs', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) throw new AppError(400, 'Некорректный id');

  const limit = Math.min(parseInt(String(req.query['limit'] || '50'), 10), 200);
  const offset = parseInt(String(req.query['offset'] || '0'), 10);

  const rows = await db.query(
    `SELECT id, status, trigger_data, result, error_message,
            scheduled_at, started_at, completed_at, created_at
     FROM workflow_runs
     WHERE workflow_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [id, limit, offset],
  );

  const countRows = await db.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM workflow_runs WHERE workflow_id = $1`,
    [id],
  );

  res.json({ success: true, data: rows, total: parseInt(countRows[0]?.total || '0', 10) });
});

export default router;
