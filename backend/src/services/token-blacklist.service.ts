import crypto from 'crypto';
import { createResilientRedis } from './redis-factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('token-blacklist');

const redis = createResilientRedis('token-blacklist', {
  keyPrefix: 'bl:',
  lazyConnect: false,
  enableOfflineQueue: false,
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Blacklist a single access token. TTL = remaining lifetime.
 * Fail-silent: if Redis is down, token won't be blacklisted
 * but will expire naturally via JWT exp.
 */
export async function blacklistToken(token: string, expiresAt: number): Promise<void> {
  const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000);
  if (ttlSeconds <= 0) return;
  try {
    await redis.set(hashToken(token), '1', 'EX', ttlSeconds);
  } catch (err: unknown) {
    log.warn('failed to blacklist token (Redis down), token will expire via JWT exp', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Blacklist ALL tokens for a user (issued before now).
 * Any access token with iat <= this timestamp will be rejected.
 * Fail-silent: if Redis is down, old tokens remain valid until JWT exp.
 */
export async function blacklistAllUserTokens(userId: string): Promise<void> {
  const ttlSeconds = 15 * 60; // 15 minutes = max access token lifetime
  try {
    await redis.set(`user:${userId}`, String(Math.floor(Date.now() / 1000)), 'EX', ttlSeconds);
  } catch (err: unknown) {
    log.warn('failed to blacklist user tokens (Redis down)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Check if a specific token is blacklisted.
 * Fail-open: if Redis is down, assume token is NOT blacklisted.
 * This is the safer direction — blocking all auth on Redis failure
 * would be a full outage.
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const result = await redis.get(hashToken(token));
    return result !== null;
  } catch (err: unknown) {
    log.warn('blacklist check failed (Redis down), allowing token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false; // fail-open: allow auth when Redis is down
  }
}

/**
 * Check if user's tokens issued before a certain time are invalidated.
 * Fail-open: if Redis is down, assume tokens are valid.
 */
export async function isUserTokensInvalidated(userId: string, tokenIat: number): Promise<boolean> {
  try {
    const invalidatedAt = await redis.get(`user:${userId}`);
    if (!invalidatedAt) return false;
    return tokenIat <= parseInt(invalidatedAt, 10);
  } catch (err: unknown) {
    log.warn('user token invalidation check failed (Redis down), allowing token', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false; // fail-open
  }
}
