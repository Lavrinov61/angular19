import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { pool } from '../database/db.js';
import { logAudit } from '../services/audit.service.js';
import {
  normalizePhone,
  findPotentialDuplicates,
  mergeContactRecords,
} from '../services/contact.service.js';

const router = Router();

router.use(authenticateToken, requirePermission('clients:view'));

// ─── LIST / SEARCH ──────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const q = ((req.query['q'] as string) || '').trim();
  const source = (req.query['source'] as string) || null;
  const hasPhone = req.query['has_phone'] === 'true' ? true : req.query['has_phone'] === 'false' ? false : null;
  const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
  const offset = (page - 1) * limit;
  const sort = ['last_seen_at', 'created_at', 'display_name'].includes(req.query['sort'] as string)
    ? req.query['sort'] as string
    : 'last_seen_at';
  const order = req.query['order'] === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (q) {
    conditions.push(`(c.display_name ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
    params.push(`%${q}%`);
    paramIdx++;
  }
  if (source) {
    conditions.push(`c.source = $${paramIdx}`);
    params.push(source);
    paramIdx++;
  }
  if (hasPhone === true) {
    conditions.push('c.phone IS NOT NULL');
  } else if (hasPhone === false) {
    conditions.push('c.phone IS NULL');
  }

  const where = conditions.join(' AND ');

  const [rows, countResult] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT c.*,
              COALESCE(
                ARRAY_AGG(DISTINCT cu.channel) FILTER (WHERE cu.channel IS NOT NULL),
                '{}'
              ) as channels,
              (SELECT COUNT(*) FROM conversations conv
               WHERE conv.contact_id = c.id)::int as session_count
       FROM contacts c
       LEFT JOIN channel_users cu ON cu.contact_id = c.id
       WHERE ${where}
       GROUP BY c.id
       ORDER BY c.${sort} ${order} NULLS LAST
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM contacts c WHERE ${where}`,
      params,
    ),
  ]);

  const total = parseInt(countResult[0]?.count || '0');

  res.json({
    success: true,
    data: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
});

// ─── GET BY ID ──────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'];

  const [contactRows, channelUserRows] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT c.*, u.display_name as user_name, u.email as user_email
       FROM contacts c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id],
    ),
    db.query<Record<string, unknown>>(
      `SELECT cu.id, cu.channel, cu.external_user_id, cu.display_name, cu.username, cu.phone, cu.last_seen_at
       FROM channel_users cu
       WHERE cu.contact_id = $1
       ORDER BY cu.last_seen_at DESC`,
      [id],
    ),
  ]);

  if (!contactRows[0]) throw new AppError(404, 'Контакт не найден');

  res.json({
    success: true,
    data: {
      ...contactRows[0],
      channel_users: channelUserRows,
    },
  });
});

// ─── PATCH (update fields) ──────────────────────────────

router.patch('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = req.params['id'];
  const { display_name, email, phone } = req.body as {
    display_name?: string;
    email?: string;
    phone?: string;
  };

  // Validate at least one field
  if (display_name === undefined && email === undefined && phone === undefined) {
    throw new AppError(400, 'Укажите хотя бы одно поле для обновления');
  }

  const updates: string[] = [];
  const values: unknown[] = [id];
  let paramIdx = 2;

  if (display_name !== undefined) {
    const trimmed = display_name.trim();
    if (trimmed.length > 255) throw new AppError(400, 'display_name слишком длинный');
    updates.push(`display_name = $${paramIdx}`);
    values.push(trimmed || null);
    paramIdx++;
  }

  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError(400, 'Некорректный email');
    }
    updates.push(`email = $${paramIdx}`);
    values.push(email || null);
    paramIdx++;
  }

  if (phone !== undefined) {
    const normalized = phone ? normalizePhone(phone) : null;
    if (phone && !normalized) throw new AppError(400, 'Некорректный телефон');

    // Check uniqueness
    if (normalized) {
      const existing = await db.query<{ id: string }>(
        'SELECT id FROM contacts WHERE phone = $1 AND deleted_at IS NULL AND id != $2',
        [normalized, id],
      );
      if (existing.length > 0) {
        throw new AppError(409, `Контакт с телефоном ${normalized} уже существует`);
      }
    }

    updates.push(`phone = $${paramIdx}`);
    values.push(normalized);
    paramIdx++;
  }

  updates.push('updated_at = NOW()');

  const result = await db.query<Record<string, unknown>>(
    `UPDATE contacts SET ${updates.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    values,
  );

  if (!result[0]) throw new AppError(404, 'Контакт не найден');

  logAudit({
    userId: authReq.user?.id || 'unknown',
    userName: authReq.user?.email || 'unknown',
    action: 'contact_updated',
    entityType: 'contact',
    entityId: id,
    details: { display_name, email, phone },
  });

  res.json({ success: true, data: result[0] });
});

// ─── DELETE (soft-delete) ───────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const id = req.params['id'];

  const result = await db.query<{ id: string; phone: string | null }>(
    `UPDATE contacts SET
       deleted_at = NOW(),
       metadata = metadata || jsonb_build_object('deleted_phone', phone),
       phone = NULL,
       updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, metadata->>'deleted_phone' as phone`,
    [id],
  );

  if (!result[0]) throw new AppError(404, 'Контакт не найден');

  logAudit({
    userId: authReq.user?.id || 'unknown',
    userName: authReq.user?.email || 'unknown',
    action: 'contact_deleted',
    entityType: 'contact',
    entityId: id,
    details: { deleted_phone: result[0].phone },
  });

  res.json({ success: true });
});

// ─── GET DUPLICATES ─────────────────────────────────────

router.get('/:id/duplicates', async (req: Request, res: Response) => {
  const id = req.params['id'];
  const duplicates = await findPotentialDuplicates(id);
  res.json({ success: true, data: duplicates });
});

// ─── MERGE ──────────────────────────────────────────────

router.post('/:id/merge', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const keepId = req.params['id'];
  const { mergeContactId } = req.body as { mergeContactId: string };
  if (!mergeContactId) throw new AppError(400, 'mergeContactId обязателен');
  if (keepId === mergeContactId) throw new AppError(400, 'Нельзя слить контакт с самим собой');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await mergeContactRecords(client, keepId, mergeContactId);
    await client.query('COMMIT');

    logAudit({
      userId: authReq.user.id,
      userName: authReq.user.email,
      action: 'contact_merged',
      entityType: 'contact',
      entityId: keepId,
      details: { mergedFrom: mergeContactId, ...result },
    });

    res.json({ success: true, data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
