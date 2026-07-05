/**
 * Broadcast Governor — per-bot-token global pause (shared across BOTH outbound workers).
 *
 * `@FmagnusBot` runs live customer support AND marketing broadcast on ONE token.
 * One token = one Telegram rate-domain: a `429` from the broadcast line blocks the
 * WHOLE bot for everyone for `retry_after` (up to 35s). To stop an ad burst from
 * freezing live support, both the broadcast worker AND the transactional outbound
 * worker read a shared pause key BEFORE every send.
 *
 * Key: `tg:bot:<sha256(token)[:16]>:paused_until` = epoch-ms when the pause lifts (PX).
 * Keyed by a hash of the token (not the raw token) so the secret never appears in
 * `redis-cli KEYS`/`MONITOR`/RDB dumps; keyed by token (not accountId) because the
 * rate-domain is the token.
 *
 * Redis client: reuses the codebase factory (`createResilientRedis`) — one client per
 * process, lazyConnect, auto-reconnect, error handler that never crashes the process.
 */

import { createHash } from 'node:crypto';
import { createResilientRedis } from '../redis-factory.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('broadcast-governor');

/** Shared client for governor reads/writes (one per process, lazy). */
let governorRedis: ReturnType<typeof createResilientRedis> | null = null;

function getGovernorRedis(): ReturnType<typeof createResilientRedis> {
  if (!governorRedis) {
    // maxRetriesPerRequest: 1 (default) — fail fast on a dead Redis rather than block sends.
    governorRedis = createResilientRedis('broadcast-governor');
  }
  return governorRedis;
}

function pauseKey(botToken: string): string {
  // Hash the token so the bot secret is never written to a Redis key (visible in
  // KEYS/MONITOR/RDB). 16 hex chars (64 bits) is collision-safe for a handful of bots.
  const tokenHash = createHash('sha256').update(botToken).digest('hex').slice(0, 16);
  return `tg:bot:${tokenHash}:paused_until`;
}

/**
 * Remaining pause time in ms for a bot token. 0 if not paused (or on Redis failure —
 * fail-open so a Redis outage never blocks transactional sends).
 */
export async function getBotPauseMs(botToken: string): Promise<number> {
  if (!botToken) return 0;
  try {
    const raw = await getGovernorRedis().get(pauseKey(botToken));
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch (err) {
    log.warn('getBotPauseMs failed — treating as not paused', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/** True if the bot token is currently paused (429 backpressure active). */
export async function isBotPaused(botToken: string): Promise<boolean> {
  return (await getBotPauseMs(botToken)) > 0;
}

/**
 * Pause the bot token for `ms` (global backpressure after a 429).
 * Stores absolute epoch-ms expiry; sets PX so the key self-expires.
 */
export async function pauseBot(botToken: string, ms: number): Promise<void> {
  if (!botToken || ms <= 0) return;
  const until = Date.now() + ms;
  try {
    await getGovernorRedis().set(pauseKey(botToken), String(until), 'PX', ms);
    log.warn('bot paused (429 backpressure)', { ms, until });
  } catch (err) {
    log.error('pauseBot failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
