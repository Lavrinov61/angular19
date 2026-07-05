/**
 * Auth Cache Service — Redis-backed cache for authenticated user data.
 *
 * Problem: Every authenticated request triggers SELECT on `users` table.
 * At 1M DAU this creates ~50K SELECT/min on auth alone.
 *
 * Solution: Cache user auth data in Redis with 5-min TTL.
 * Cache-aside pattern: check Redis → miss → DB → write Redis.
 * Fail-open: if Redis is down, fall through to DB (no degradation).
 *
 * Invalidation points:
 * - Password change / reset → invalidateAuthCache(userId)
 * - Role change → invalidateAuthCache(userId)
 * - User deactivation → invalidateAuthCache(userId)
 * - RBAC permission changes → invalidateAuthCache(userId) or invalidateAllAuthCache()
 */

import { getCrmRedis } from './redis-cache.service.js';
import { createLogger } from '../utils/logger.js';
import type Users from '../types/generated/public/Users.js';

const log = createLogger('auth-cache');

const AUTH_CACHE_PREFIX = 'auth:user:';
const AUTH_CACHE_TTL_SEC = 300; // 5 minutes

/**
 * Cached user data shape — only the fields needed by auth middleware.
 * Derived from Kanel Users type via Pick.
 */
export type CachedAuthUser = Pick<Users,
  | 'id'
  | 'email'
  | 'role'
  | 'is_active'
  | 'display_name'
  | 'phone'
  | 'force_password_change'
  | 'last_password_change'
>;

/**
 * Try to get cached auth user data from Redis.
 * Returns null on cache miss or Redis error (fail-open).
 */
export async function getAuthCache(userId: string): Promise<CachedAuthUser | null> {
  const redis = getCrmRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(`${AUTH_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuthUser;
  } catch {
    // Redis error — fail-open, proceed to DB
    return null;
  }
}

/**
 * Store user auth data in Redis cache.
 * Fire-and-forget — errors are swallowed (fail-open).
 */
export async function setAuthCache(userId: string, data: CachedAuthUser): Promise<void> {
  const redis = getCrmRedis();
  if (!redis) return;

  try {
    await redis.set(
      `${AUTH_CACHE_PREFIX}${userId}`,
      JSON.stringify(data),
      'EX',
      AUTH_CACHE_TTL_SEC,
    );
  } catch {
    // Redis error — proceed without cache
  }
}

/**
 * Invalidate auth cache for a specific user.
 * Must be called on: password change, role change, deactivation, RBAC override change.
 */
export async function invalidateAuthCache(userId: string): Promise<void> {
  const redis = getCrmRedis();
  if (!redis) return;

  try {
    await redis.del(`${AUTH_CACHE_PREFIX}${userId}`);
    log.debug('auth cache invalidated', { userId });
  } catch {
    // Redis error — non-critical
  }
}

/**
 * Invalidate auth cache for ALL users.
 * Must be called on: global RBAC role permission changes.
 * Uses SCAN to avoid blocking Redis (no KEYS *).
 */
export async function invalidateAllAuthCache(): Promise<void> {
  const redis = getCrmRedis();
  if (!redis) return;

  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${AUTH_CACHE_PREFIX}*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
    log.debug('auth cache invalidated for all users');
  } catch {
    // Redis error — non-critical
  }
}
