/**
 * Shared Redis-backed store for express-rate-limit.
 *
 * All rate limiters across the codebase should use this store factory
 * so they work correctly across multiple Node.js instances behind ALB.
 *
 * Fail-open: express-rate-limit `passOnStoreError: true` ensures
 * requests pass through when Redis is unavailable.
 *
 * Uses the centralized redis-factory for connection resilience.
 */

import { RedisStore } from 'rate-limit-redis';
import { createResilientRedis } from '../services/redis-factory.js';

/** Singleton Redis connection shared by all rate limiter stores. */
let _rateLimitRedis: ReturnType<typeof createResilientRedis> | null = null;

function getRateLimitRedis(): ReturnType<typeof createResilientRedis> {
  if (!_rateLimitRedis) {
    _rateLimitRedis = createResilientRedis('rate-limit-shared', {
      keyPrefix: 'rl:',
      lazyConnect: false,
      enableOfflineQueue: true,
    });
  }
  return _rateLimitRedis;
}

/**
 * Create a RedisStore instance for express-rate-limit.
 * @param prefix - key prefix to namespace this limiter (e.g. 'replay:', 'booking:')
 */
export function createRateLimitStore(prefix: string): RedisStore {
  const redis = getRateLimitRedis();
  return new RedisStore({
    // ioredis .call() maps to Redis CALL — returns unknown; cast needed for rate-limit-redis
    sendCommand: ((...args: string[]) =>
      (redis as unknown as { call: (...a: string[]) => Promise<number | string | null> }).call(...args)
    ) as never,
    prefix,
  });
}
