/**
 * DB-backed Permission Service with Redis caching (multi-node safe).
 * Enterprise RBAC — replaces static ROLE_PERMISSIONS map.
 *
 * Resolution order:
 *   1. Role permissions from rbac_roles → rbac_role_permissions → rbac_permissions
 *   2. Per-user overrides from rbac_user_overrides (grant = add, deny = remove)
 *   3. Expired overrides are automatically excluded
 *
 * Cache lives in Redis with 5 min TTL. Falls back to DB on Redis miss/error.
 */

import db from '../database/db.js';
import { cacheGet, cacheSet, cacheDel, getCrmRedis } from './redis-cache.service.js';

const CACHE_TTL_SEC = 300; // 5 minutes
const CACHE_PREFIX = 'perms:';

const PERMISSIONS_QUERY = `
  WITH role_perms AS (
    SELECT p.slug
    FROM rbac_permissions p
    JOIN rbac_role_permissions rp ON rp.permission_id = p.id
    JOIN rbac_roles r ON r.id = rp.role_id
    WHERE r.slug = (SELECT role FROM users WHERE id = $1)
      AND p.is_active = TRUE
      AND r.is_active = TRUE
  ),
  overrides AS (
    SELECT p.slug, o.override_type
    FROM rbac_user_overrides o
    JOIN rbac_permissions p ON p.id = o.permission_id
    WHERE o.user_id = $1
      AND (o.expires_at IS NULL OR o.expires_at > NOW())
  )
  SELECT slug FROM role_perms
  WHERE slug NOT IN (SELECT slug FROM overrides WHERE override_type = 'deny')
  UNION
  SELECT slug FROM overrides WHERE override_type = 'grant'
`;

export const permissionService = {
  async getUserPermissions(userId: string): Promise<string[]> {
    const key = `${CACHE_PREFIX}${userId}`;

    // Try Redis cache
    const cached = await cacheGet<string[]>(key);
    if (cached) return cached;

    // DB fallback
    const rows = await db.query<{ slug: string }>(PERMISSIONS_QUERY, [userId]);
    const permissions = rows.map(r => r.slug);

    // Store in Redis
    await cacheSet(key, permissions, CACHE_TTL_SEC);
    return permissions;
  },

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const perms = await this.getUserPermissions(userId);
    return perms.includes(permission);
  },

  async hasAllPermissions(userId: string, permissions: string[]): Promise<boolean> {
    const userPerms = await this.getUserPermissions(userId);
    return permissions.every(p => userPerms.includes(p));
  },

  invalidateUser(userId: string): void {
    cacheDel(`${CACHE_PREFIX}${userId}`).catch(() => {});
  },

  invalidateAll(): void {
    // Delete all permission keys by scan pattern
    const redis = getCrmRedis();
    if (!redis) return;
    const stream = redis.scanStream({ match: `${CACHE_PREFIX}*`, count: 100 });
    stream.on('data', (keys: string[]) => {
      if (keys.length > 0) {
        redis.del(...keys).catch(() => {});
      }
    });
  },
};
