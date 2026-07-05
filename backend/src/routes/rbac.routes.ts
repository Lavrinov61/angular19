/**
 * RBAC Admin API — управление ролями, правами и per-user overrides.
 *
 * Все endpoints защищены requirePermission('settings:manage').
 * Каждая мутация пишет в rbac_audit_log и инвалидирует кеш permissions.
 *
 * GET    /api/rbac/roles
 * GET    /api/rbac/roles/:id
 * POST   /api/rbac/roles
 * PUT    /api/rbac/roles/:id
 * DELETE /api/rbac/roles/:id
 *
 * GET    /api/rbac/permissions
 * PUT    /api/rbac/roles/:id/permissions
 *
 * GET    /api/rbac/users/:userId/effective
 * GET    /api/rbac/users/:userId/overrides
 * POST   /api/rbac/users/:userId/overrides
 * DELETE /api/rbac/users/:userId/overrides/:overrideId
 * PUT    /api/rbac/users/:userId/role
 *
 * GET    /api/rbac/audit
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { permissionService } from '../services/permission.service.js';
import { invalidateAuthCache, invalidateAllAuthCache } from '../services/auth-cache.service.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('rbac.routes');
// All RBAC admin routes require authentication + settings:manage permission
router.use(authenticateToken, requirePermission('settings:manage'));

// ============================================================================
// Roles
// ============================================================================

/**
 * GET /api/rbac/roles — список всех ролей
 */
router.get('/roles', async (_req: AuthRequest, res: Response): Promise<void> => {
  const roles = await db.query(`
    SELECT r.*, COUNT(rp.permission_id) AS permission_count
    FROM rbac_roles r
    LEFT JOIN rbac_role_permissions rp ON rp.role_id = r.id
    GROUP BY r.id
    ORDER BY r.sort_order, r.display_name
  `);
  res.json({ success: true, roles });
});

/**
 * GET /api/rbac/roles/:id — роль + её permissions
 */
router.get('/roles/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const role = await db.queryOne(`SELECT * FROM rbac_roles WHERE id = $1`, [req.params['id']]);
  if (!role) throw new AppError(404, 'Роль не найдена');

  const permissions = await db.query(`
    SELECT p.*
    FROM rbac_permissions p
    JOIN rbac_role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = $1
    ORDER BY p.sort_order
  `, [req.params['id']]);

  res.json({ success: true, role: { ...role, permissions } });
});

/**
 * POST /api/rbac/roles — создать роль (не system)
 */
router.post('/roles', async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug, display_name, description } = req.body;
  if (!slug || !display_name) throw new AppError(400, 'slug и display_name обязательны');

  const existing = await db.queryOne(`SELECT id FROM rbac_roles WHERE slug = $1`, [slug]);
  if (existing) throw new AppError(409, `Роль с slug '${slug}' уже существует`);

  const role = await db.queryOne(`
    INSERT INTO rbac_roles (slug, display_name, description, is_system)
    VALUES ($1, $2, $3, false)
    RETURNING *
  `, [slug, display_name, description || null]);

  await _auditLog(req, 'role.create', { target_role_id: role.id, details: { slug, display_name } });

  res.status(201).json({ success: true, role });
});

/**
 * PUT /api/rbac/roles/:id — обновить роль
 */
router.put('/roles/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const role = await db.queryOne(`SELECT * FROM rbac_roles WHERE id = $1`, [req.params['id']]);
  if (!role) throw new AppError(404, 'Роль не найдена');

  const { display_name, description, is_active } = req.body;
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (display_name !== undefined) { sets.push(`display_name = $${idx++}`); values.push(display_name); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
  if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(is_active); }

  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  values.push(req.params['id']);

  const updated = await db.queryOne(
    `UPDATE rbac_roles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    values
  );

  await _auditLog(req, 'role.update', { target_role_id: req.params['id'], details: req.body });
  permissionService.invalidateAll(); // роль могла изменить доступ многих пользователей
  invalidateAllAuthCache().catch(() => {}); // invalidate cached auth data for all users

  res.json({ success: true, role: updated });
});

/**
 * DELETE /api/rbac/roles/:id — soft-delete (только не system роли)
 */
router.delete('/roles/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const role = await db.queryOne(`SELECT * FROM rbac_roles WHERE id = $1`, [req.params['id']]);
  if (!role) throw new AppError(404, 'Роль не найдена');
  if (role.is_system) throw new AppError(403, 'Системные роли нельзя удалять');

  await db.query(`UPDATE rbac_roles SET is_active = false, updated_at = NOW() WHERE id = $1`, [req.params['id']]);
  await _auditLog(req, 'role.delete', { target_role_id: req.params['id'], details: { slug: role.slug } });
  permissionService.invalidateAll();
  invalidateAllAuthCache().catch(() => {});

  res.json({ success: true });
});

// ============================================================================
// Permissions
// ============================================================================

/**
 * GET /api/rbac/permissions — все permissions сгруппированные по модулю
 */
router.get('/permissions', async (_req: AuthRequest, res: Response): Promise<void> => {
  const permissions = await db.query(`
    SELECT * FROM rbac_permissions
    WHERE is_active = true
    ORDER BY module, sort_order
  `);

  // Group by module
  const byModule: Record<string, typeof permissions> = {};
  for (const p of permissions as Array<{ module: string; [key: string]: unknown }>) {
    if (!byModule[p.module]) byModule[p.module] = [];
    byModule[p.module].push(p);
  }

  res.json({ success: true, permissions, byModule });
});

/**
 * PUT /api/rbac/roles/:id/permissions — задать полный список permissions для роли (full replace)
 */
router.put('/roles/:id/permissions', async (req: AuthRequest, res: Response): Promise<void> => {
  const role = await db.queryOne(`SELECT * FROM rbac_roles WHERE id = $1`, [req.params['id']]);
  if (!role) throw new AppError(404, 'Роль не найдена');

  const { permission_ids } = req.body;
  if (!Array.isArray(permission_ids)) throw new AppError(400, 'permission_ids должен быть массивом UUID');

  // Validate all permission_ids exist
  if (permission_ids.length > 0) {
    const found = await db.query<{ id: string }>(
      `SELECT id FROM rbac_permissions WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [permission_ids]
    );
    if (found.length !== permission_ids.length) {
      throw new AppError(400, 'Один или несколько permission_ids не найдены или неактивны');
    }
  }

  // Full replace in transaction — atomic: если INSERT упадёт, DELETE не применится
  await db.transaction(async (client) => {
    await client.query(`DELETE FROM rbac_role_permissions WHERE role_id = $1`, [req.params['id']]);

    if (permission_ids.length > 0) {
      const values = permission_ids.map((_: string, i: number) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO rbac_role_permissions (role_id, permission_id) VALUES ${values}`,
        [req.params['id'], ...permission_ids]
      );
    }
  });

  await _auditLog(req, 'role.set_permissions', {
    target_role_id: req.params['id'],
    details: { permission_count: permission_ids.length, permission_ids },
  });
  permissionService.invalidateAll(); // у всех пользователей с этой ролью изменились права
  invalidateAllAuthCache().catch(() => {}); // cached roles may affect auth decisions

  res.json({ success: true, permission_count: permission_ids.length });
});

// ============================================================================
// User Effective Permissions & Overrides
// ============================================================================

/**
 * GET /api/rbac/users/:userId/effective — эффективные permissions пользователя (роль + overrides)
 */
router.get('/users/:userId/effective', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await db.queryOne<{ id: string; role: string; email: string }>(
    `SELECT id, role, email FROM users WHERE id = $1`,
    [req.params['userId']]
  );
  if (!user) throw new AppError(404, 'Пользователь не найден');

  const permissions = await permissionService.getUserPermissions(req.params['userId']);
  res.json({ success: true, user: { id: user.id, role: user.role, email: user.email }, permissions });
});

/**
 * GET /api/rbac/users/:userId/overrides — per-user overrides
 */
router.get('/users/:userId/overrides', async (req: AuthRequest, res: Response): Promise<void> => {
  const overrides = await db.query(`
    SELECT o.*, p.slug AS permission_slug, p.display_name AS permission_name,
           u.email AS granted_by_email
    FROM rbac_user_overrides o
    JOIN rbac_permissions p ON p.id = o.permission_id
    LEFT JOIN users u ON u.id = o.granted_by
    WHERE o.user_id = $1
      AND (o.expires_at IS NULL OR o.expires_at > NOW())
    ORDER BY o.created_at DESC
  `, [req.params['userId']]);

  res.json({ success: true, overrides });
});

/**
 * POST /api/rbac/users/:userId/overrides — добавить override (grant или deny)
 */
router.post('/users/:userId/overrides', async (req: AuthRequest, res: Response): Promise<void> => {
  const { permission_id, override_type, reason, expires_at } = req.body;

  if (!permission_id) throw new AppError(400, 'permission_id обязателен');
  if (!['grant', 'deny'].includes(override_type)) throw new AppError(400, 'override_type: grant | deny');

  const user = await db.queryOne(`SELECT id FROM users WHERE id = $1`, [req.params['userId']]);
  if (!user) throw new AppError(404, 'Пользователь не найден');

  const perm = await db.queryOne(`SELECT id FROM rbac_permissions WHERE id = $1 AND is_active = true`, [permission_id]);
  if (!perm) throw new AppError(404, 'Permission не найден');

  const override = await db.queryOne(`
    INSERT INTO rbac_user_overrides (user_id, permission_id, override_type, reason, expires_at, granted_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [req.params['userId'], permission_id, override_type, reason || null, expires_at || null, req.user!.id]);

  await _auditLog(req, 'user.override_add', {
    target_user_id: req.params['userId'],
    details: { permission_id, override_type, reason, expires_at },
  });
  permissionService.invalidateUser(req.params['userId']);
  invalidateAuthCache(req.params['userId']).catch(() => {});

  res.status(201).json({ success: true, override });
});

/**
 * DELETE /api/rbac/users/:userId/overrides/:overrideId — удалить override
 */
router.delete('/users/:userId/overrides/:overrideId', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await db.queryOne(`
    DELETE FROM rbac_user_overrides WHERE id = $1 AND user_id = $2 RETURNING *
  `, [req.params['overrideId'], req.params['userId']]);

  if (!result) throw new AppError(404, 'Override не найден');

  await _auditLog(req, 'user.override_remove', {
    target_user_id: req.params['userId'],
    details: { override_id: req.params['overrideId'] },
  });
  permissionService.invalidateUser(req.params['userId']);
  invalidateAuthCache(req.params['userId']).catch(() => {});

  res.json({ success: true });
});

/**
 * PUT /api/rbac/users/:userId/role — сменить роль пользователя
 */
router.put('/users/:userId/role', async (req: AuthRequest, res: Response): Promise<void> => {
  const { role } = req.body;
  if (!role) throw new AppError(400, 'role обязателен');

  const rbacRole = await db.queryOne(`SELECT slug FROM rbac_roles WHERE slug = $1 AND is_active = true`, [role]);
  if (!rbacRole) throw new AppError(400, `Роль '${role}' не существует или неактивна`);

  const user = await db.queryOne<{ id: string; role: string }>(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, role`,
    [role, req.params['userId']]
  );
  if (!user) throw new AppError(404, 'Пользователь не найден');

  await _auditLog(req, 'user.role_change', {
    target_user_id: req.params['userId'],
    details: { new_role: role },
  });
  permissionService.invalidateUser(req.params['userId']);
  invalidateAuthCache(req.params['userId']).catch(() => {});

  res.json({ success: true, user });
});

// ============================================================================
// Audit Log
// ============================================================================

/**
 * GET /api/rbac/audit — paginated audit log
 */
router.get('/audit', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query['limit'])) || 50, 200);
  const offset = parseInt(String(req.query['offset'])) || 0;
  const actor = req.query['actor_id'] as string | undefined;
  const action = req.query['action'] as string | undefined;

  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (actor) { conditions.push(`al.actor_id = $${idx++}`); values.push(actor); }
  if (action) { conditions.push(`al.action = $${idx++}`); values.push(action); }

  values.push(limit, offset);

  const rows = await db.query(`
    SELECT al.*,
           actor.email AS actor_email,
           target_u.email AS target_user_email
    FROM rbac_audit_log al
    LEFT JOIN users actor ON actor.id = al.actor_id
    LEFT JOIN users target_u ON target_u.id = al.target_user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY al.created_at DESC
    LIMIT $${idx++} OFFSET $${idx}
  `, values);

  const total = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM rbac_audit_log WHERE ${conditions.join(' AND ')}`,
    values.slice(0, -2)
  );

  res.json({ success: true, rows, total: parseInt(total?.count || '0'), limit, offset });
});

// ============================================================================
// Internal helpers
// ============================================================================

async function _auditLog(
  req: AuthRequest,
  action: string,
  opts: { target_user_id?: string; target_role_id?: string; details?: unknown }
): Promise<void> {
  try {
    await db.query(`
      INSERT INTO rbac_audit_log (actor_id, action, target_user_id, target_role_id, details, ip)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      req.user!.id,
      action,
      opts.target_user_id || null,
      opts.target_role_id || null,
      JSON.stringify(opts.details || {}),
      req.ip || null,
    ]);
  } catch (err) {
    // Audit failures should not block the operation
    logger.error('[RBAC Audit] Failed to write audit log:', { error: String(err) });
  }
}

export default router;
