/**
 * Redis Factory — centralized Redis client creation with resilience built-in.
 *
 * Every Redis client in the codebase SHOULD be created through this factory.
 * Provides:
 * - Exponential backoff reconnect (max 30s delay)
 * - Error handler that never crashes the process
 * - Connection status tracking
 * - Structured logging via pino
 *
 * Usage:
 *   import { createResilientRedis, RedisStatus } from './redis-factory.js';
 *
 *   const redis = createResilientRedis('rate-limit', { keyPrefix: 'rl:' });
 *   redis.status;  // RedisStatus
 */

import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('redis-factory');

/** Max reconnect delay in ms */
const MAX_RETRY_DELAY_MS = 30_000;

/** Base delay for exponential backoff */
const BASE_RETRY_DELAY_MS = 500;

export type RedisStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface ResilientRedisOptions {
  /** Key prefix (e.g. 'rl:', 'bl:') */
  keyPrefix?: string;
  /** Whether to use lazyConnect (default: true) */
  lazyConnect?: boolean;
  /** Max retries per request — set to null for BullMQ, default 1 */
  maxRetriesPerRequest?: number | null;
  /** Enable offline queue (default: false — fail fast when disconnected) */
  enableOfflineQueue?: boolean;
  /** Connect timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Additional ioredis options to merge */
  extra?: Partial<RedisOptions>;
}

// Track all created clients for graceful shutdown
const allClients: Array<{ name: string; client: Redis }> = [];

/**
 * Create a Redis client with built-in resilience.
 *
 * - Auto-reconnect with exponential backoff (max 30s)
 * - Error handler that logs but never crashes
 * - Structured logging of connection lifecycle events
 */
export function createResilientRedis(
  name: string,
  opts: ResilientRedisOptions = {},
): Redis {
  const {
    keyPrefix,
    lazyConnect = true,
    maxRetriesPerRequest = 1,
    enableOfflineQueue = false,
    connectTimeout = 5000,
    extra = {},
  } = opts;

  const redisOpts: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    ...(config.redis.tls ? { tls: config.redis.tls as Record<string, unknown> } : {}),
    keyPrefix,
    lazyConnect,
    maxRetriesPerRequest,
    enableOfflineQueue,
    connectTimeout,
    retryStrategy: (times: number) => {
      // Exponential backoff capped at MAX_RETRY_DELAY_MS
      const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, times - 1), MAX_RETRY_DELAY_MS);
      log.info('reconnecting', { client: name, attempt: times, delayMs: delay });
      return delay;
    },
    ...extra,
  };

  const client = new Redis(redisOpts);

  client.on('connect', () => {
    log.info('connected', { client: name });
  });

  client.on('ready', () => {
    log.info('ready', { client: name });
  });

  client.on('error', (err: Error) => {
    // Log but NEVER throw — prevents process crash
    log.error('redis error', { client: name, error: err.message });
  });

  client.on('close', () => {
    log.warn('connection closed', { client: name });
  });

  client.on('reconnecting', () => {
    log.info('reconnecting event', { client: name });
  });

  client.on('end', () => {
    log.warn('connection ended (no more reconnects)', { client: name });
  });

  allClients.push({ name, client });

  return client;
}

/**
 * Create a lazy Redis client that returns null if connection fails.
 * Suitable for non-critical use cases (cache, metrics, dedup).
 *
 * The returned getter always returns the same client or null.
 */
export function createLazyRedis(
  name: string,
  opts: ResilientRedisOptions = {},
): () => Redis | null {
  let client: Redis | null = null;
  let connecting = false;

  return (): Redis | null => {
    if (client) return client;
    if (connecting) return null;

    connecting = true;
    try {
      client = createResilientRedis(name, { lazyConnect: true, ...opts });
      client.connect().then(() => {
        connecting = false;
      }).catch((err: unknown) => {
        log.warn('lazy connect failed', {
          client: name,
          error: err instanceof Error ? err.message : String(err),
        });
        client = null;
        connecting = false;
      });
    } catch {
      connecting = false;
      return null;
    }

    return client;
  };
}

/**
 * Check if a Redis client is usable (connected + ready).
 */
export function isRedisReady(client: Redis | null): boolean {
  return client !== null && client.status === 'ready';
}

/**
 * Gracefully close all Redis clients created by the factory.
 * Call during process shutdown.
 */
export async function closeAllRedisClients(): Promise<void> {
  const results = await Promise.allSettled(
    allClients.map(async ({ name, client }) => {
      try {
        await client.quit();
        log.info('client closed', { client: name });
      } catch (err: unknown) {
        log.warn('client close error', {
          client: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    log.warn('some redis clients failed to close', { failed, total: allClients.length });
  }
  allClients.length = 0;
}
