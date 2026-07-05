import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { logAudit } from '../services/audit.service.js';

/** View type for customer_tags rows */
interface CustomerTagRow {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  created_at: string;
}

/** View type for tag assignment with tag details */
interface ContactTagRow {
  tag_id: string;
  name: string;
  color: string;
  icon: string | null;
  assigned_at: string;
  assigned_by_name: string | null;
}

const router = Router();

router.use(authenticateToken, requirePermission('clients:view'));

// ─── GET ALL TAGS ──────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const rows = await db.query<CustomerTagRow>(
    `SELECT id, name, color, icon, created_at
     FROM customer_tags
     ORDER BY name`,
  );
  res.json({ success: true, data: rows });
});

// ─── CREATE TAG ────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const { name, color, icon } = req.body as {
    name?: string;
    color?: string;
    icon?: string;
  };

  if (!name?.trim()) throw new AppError(400, 'name обязательно');
  const trimmedName = name.trim();
  if (trimmedName.length > 50) throw new AppError(400, 'name слишком длинный (макс. 50)');

  const colorVal = color?.trim() || '#6b7280';
  if (!/^#[0-9a-fA-F]{6}$/.test(colorVal)) throw new AppError(400, 'Некорректный формат цвета (HEX)');

  const iconVal = icon?.trim() || 'label';

  const rows = await db.query<CustomerTagRow>(
    `INSERT INTO customer_tags (name, color, icon)
     VALUES ($1, $2, $3)
     RETURNING id, name, color, icon, created_at`,
    [trimmedName, colorVal, iconVal],
  );

  logAudit({
    userId: authReq.user.id,
    userName: authReq.user.email,
    action: 'customer_tag_created',
    entityType: 'customer_tag',
    entityId: rows[0].id,
    details: { name: trimmedName, color: colorVal, icon: iconVal },
  });

  res.status(201).json({ success: true, data: rows[0] });
});

// ─── DELETE TAG ────────────────────────────────────────
router.delete('/:tagId', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const tagId = req.params['tagId'];

  const result = await db.query<{ id: string; name: string }>(
    `DELETE FROM customer_tags WHERE id = $1 RETURNING id, name`,
    [tagId],
  );

  if (!result[0]) throw new AppError(404, 'Тег не найден');

  logAudit({
    userId: authReq.user.id,
    userName: authReq.user.email,
    action: 'customer_tag_deleted',
    entityType: 'customer_tag',
    entityId: tagId,
    details: { name: result[0].name },
  });

  res.json({ success: true });
});

// ─── GET TAGS FOR CONTACT ──────────────────────────────
router.get('/contacts/:contactId', async (req: Request, res: Response) => {
  const contactId = req.params['contactId'];

  const rows = await db.query<ContactTagRow>(
    `SELECT cta.tag_id, ct.name, ct.color, ct.icon,
            cta.assigned_at,
            COALESCE(u.display_name, u.email) AS assigned_by_name
     FROM customer_tag_assignments cta
     JOIN customer_tags ct ON ct.id = cta.tag_id
     LEFT JOIN users u ON u.id = cta.assigned_by
     WHERE cta.customer_id = $1
     ORDER BY cta.assigned_at DESC`,
    [contactId],
  );

  res.json({ success: true, data: rows });
});

// ─── ASSIGN TAG TO CONTACT ─────────────────────────────
router.post('/contacts/:contactId/tags/:tagId', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const { contactId, tagId } = req.params as Record<string, string>;

  // Verify contact exists
  const contact = await db.query<{ id: string }>(
    'SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contactId],
  );
  if (!contact[0]) throw new AppError(404, 'Контакт не найден');

  // Verify tag exists
  const tag = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM customer_tags WHERE id = $1',
    [tagId],
  );
  if (!tag[0]) throw new AppError(404, 'Тег не найден');

  await db.query(
    `INSERT INTO customer_tag_assignments (customer_id, tag_id, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, tag_id) DO NOTHING`,
    [contactId, tagId, authReq.user.id],
  );

  logAudit({
    userId: authReq.user.id,
    userName: authReq.user.email,
    action: 'customer_tag_assigned',
    entityType: 'contact',
    entityId: contactId,
    details: { tagId, tagName: tag[0].name },
  });

  res.status(201).json({ success: true });
});

// ─── REMOVE TAG FROM CONTACT ───────────────────────────
router.delete('/contacts/:contactId/tags/:tagId', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const { contactId, tagId } = req.params as Record<string, string>;

  const result = await db.query<{ customer_id: string }>(
    `DELETE FROM customer_tag_assignments
     WHERE customer_id = $1 AND tag_id = $2
     RETURNING customer_id`,
    [contactId, tagId],
  );

  if (!result[0]) throw new AppError(404, 'Назначение тега не найдено');

  logAudit({
    userId: authReq.user.id,
    userName: authReq.user.email,
    action: 'customer_tag_removed',
    entityType: 'contact',
    entityId: contactId,
    details: { tagId },
  });

  res.json({ success: true });
});

export default router;
