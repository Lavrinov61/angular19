/**
 * Operator Idempotency Middleware.
 *
 * Prevents duplicate operator actions (assign, close, reopen, transfer)
 * caused by double-clicks or network retries.
 *
 * Mechanism:
 * - Client sends optional `X-Idempotency-Key` header
 * - If present: check Redis for cached response (TTL-based)
 *   - Hit: return cached response immediately (no DB mutation)
 *   - Miss: proceed, intercept response, cache it in Redis
 * - If absent: backward-compatible pass-through (no idempotency)
 *
 * Uses createLazyRedis — fails open if Redis is unavailable.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLazyRedis, isRedisReady } from '../services/redis-factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('idempotency');

const getRedis = createLazyRedis('idempotency', {
  keyPrefix: 'idem:',
  enableOfflineQueue: false,
  connectTimeout: 3000,
});

interface CachedResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Express middleware that enforces idempotency via X-Idempotency-Key header.
 *
 * @param ttlSeconds - How long to cache the response (default: 60s)
 * @returns Express middleware
 *
 * @example
 *   router.post('/admin/sessions/:id/assign', authenticateToken, idempotent(60), handler);
 */
export function idempotent(ttlSeconds = 60): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers['x-idempotency-key'];

    // No header → skip idempotency (backward compatible)
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      next();
      return;
    }

    // Validate key format: non-empty, reasonable length
    if (idempotencyKey.length > 256) {
      res.status(400).json({
        success: false,
        error: 'X-Idempotency-Key must be at most 256 characters',
      });
      return;
    }

    const redis = getRedis();

    // Redis unavailable → fail open (proceed without idempotency)
    if (!redis || !isRedisReady(redis)) {
      log.warn('Redis unavailable, skipping idempotency check', { key: idempotencyKey });
      next();
      return;
    }

    try {
      // Check if this key was already processed
      const cached = await redis.get(idempotencyKey);

      if (cached !== null) {
        // Duplicate request — return cached response
        let parsed: CachedResponse;
        try {
          parsed = JSON.parse(cached) as CachedResponse;
        } catch {
          // Corrupted cache entry — proceed normally
          log.warn('Corrupted idempotency cache entry', { key: idempotencyKey });
          next();
          return;
        }

        log.info('Idempotent duplicate detected', { key: idempotencyKey });
        res.status(parsed.statusCode).json(parsed.body);
        return;
      }

      // Not a duplicate — proceed with the request.
      // Intercept res.json to capture the response for caching.
      const originalJson = res.json.bind(res);

      res.json = function cacheAndRespond(body: unknown): Response {
        // Cache only successful responses (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheEntry: CachedResponse = {
            statusCode: res.statusCode,
            body,
          };

          // Fire-and-forget Redis SET — don't block the response
          redis.set(idempotencyKey, JSON.stringify(cacheEntry), 'EX', ttlSeconds)
            .catch((err: unknown) => {
              log.warn('Failed to cache idempotent response', {
                key: idempotencyKey,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }

        return originalJson(body);
      };

      next();
    } catch (err: unknown) {
      // Redis error → fail open
      log.warn('Idempotency check failed, proceeding without', {
        key: idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}
