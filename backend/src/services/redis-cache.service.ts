/**
 * Shared Redis Cache Service for CRM
 *
 * Single Redis connection for all CRM caching needs.
 * Supports stale-while-revalidate pattern for high-traffic endpoints.
 *
 * Graceful degradation: all operations fail-silent when Redis is unavailable.
 * Falls through to DB queries — slower but correct.
 *
 * Replaces per-route Redis client creation (e.g. crm-inbox.routes.ts getRedis()).
 */

import type Redis from 'ioredis';
import { createLazyRedis } from './redis-factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('redis-cache');
const CACHE_READY_TIMEOUT_MS = 1_500;

const getRedisClient = createLazyRedis('crm-cache', {
  enableOfflineQueue: false,
});

async function waitForRedisReady(redis: Redis): Promise<boolean> {
  if (redis.status === 'ready') return true;
  if (redis.status === 'end') return false;

  return new Promise(resolve => {
    let settled = false;

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('end', onUnavailable);
      redis.off('close', onUnavailable);
      redis.off('error', onUnavailable);
      resolve(ready);
    };

    const onReady = (): void => finish(true);
    const onUnavailable = (): void => finish(false);
    const timer = setTimeout(() => finish(redis.status === 'ready'), CACHE_READY_TIMEOUT_MS);

    redis.once('ready', onReady);
    redis.once('end', onUnavailable);
    redis.once('close', onUnavailable);
    redis.once('error', onUnavailable);
  });
}

async function getReadyRedisClient(): Promise<Redis | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  return await waitForRedisReady(redis) ? redis : null;
}

/**
 * Get the shared Redis client for CRM caching.
 * Lazy-initializes on first call. Returns null if Redis unavailable.
 */
export function getCrmRedis(): Redis | null {
  return getRedisClient();
}

/**
 * Get cached value by key.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getReadyRedisClient();
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) as T : null;
  } catch {
    return null;
  }
}

/**
 * Set cached value with TTL.
 */
export async function cacheSet(key: string, data: unknown, ttlSec: number): Promise<void> {
  const redis = await getReadyRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(data), 'EX', ttlSec);
  } catch {
    // Redis down — proceed without cache
  }
}

/**
 * Delete cached key.
 */
export async function cacheDel(key: string): Promise<void> {
  const redis = await getReadyRedisClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Redis down — proceed without cache
  }
}

/**
 * Stale-While-Revalidate cache pattern.
 *
 * Always returns cached value if available. If TTL is below threshold,
 * triggers background refresh via fetchFn (non-blocking).
 *
 * @param key - Redis key
 * @param ttlSec - Cache TTL in seconds
 * @param earlyRefreshSec - When TTL drops below this, trigger background refresh
 * @param fetchFn - Async function to compute fresh value
 */
export async function cacheGetOrFetch<T>(
  key: string,
  ttlSec: number,
  earlyRefreshSec: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const redis = await getReadyRedisClient();

  if (redis) {
    try {
      const pipeline = redis.pipeline();
      pipeline.get(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();

      if (results) {
        const cached = results[0]?.[1] as string | null;
        const ttl = results[1]?.[1] as number;

        if (cached) {
          const parsed = JSON.parse(cached) as T;

          // Background refresh if nearing expiry
          if (ttl >= 0 && ttl < earlyRefreshSec) {
            fetchFn().then(freshData => {
              cacheSet(key, freshData, ttlSec).catch(err => log.debug('redis cache op failed', { error: String(err) }));
            }).catch(err => {
              log.warn('stale-while-revalidate background refresh failed', { key, error: String(err) });
            });
          }

          return parsed;
        }
      }
    } catch {
      // Redis error — fall through to fetchFn
    }
  }

  // Cache miss or Redis down — fetch and cache
  const data = await fetchFn();
  cacheSet(key, data, ttlSec).catch(err => log.debug('redis cache op failed', { error: String(err) }));
  return data;
}

/**
 * Close the shared Redis connection (for graceful shutdown).
 */
export async function closeCrmRedis(): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.quit().catch(err => log.debug('redis cache op failed', { error: String(err) }));
  }
}
