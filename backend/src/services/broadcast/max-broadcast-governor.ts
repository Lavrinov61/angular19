/**
 * MAX Broadcast Governor — per-bot-token global pause for the MAX broadcast line.
 *
 * Mirrors broadcast-governor.ts (Telegram), but in a SEPARATE Redis namespace so a MAX
 * 429 never pauses the live Telegram bot token (the two channels are distinct rate-domains
 * and must stay policy-isolated). The MAX broadcast bot runs on one access token; a `429`
 * from the broadcast line means the whole MAX bot is being throttled, so the MAX broadcast
 * worker reads this pause key BEFORE every send.
 *
 * Key: `max:bot:<sha256(token)[:16]>:paused_until` = epoch-ms when the pause lifts (PX).
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

const log = createLogger('max-broadcast-governor');

/** Shared client for governor reads/writes (one per process, lazy). */
let governorRedis: ReturnType<typeof createResilientRedis> | null = null;

function getGovernorRedis(): ReturnType<typeof createResilientRedis> {
  if (!governorRedis) {
    // maxRetriesPerRequest: 1 (default) — fail fast on a dead Redis rather than block sends.
    governorRedis = createResilientRedis('max-broadcast-governor');
  }
  return governorRedis;
}

function pauseKey(accessToken: string): string {
  // Hash the token so the bot secret is never written to a Redis key (visible in
  // KEYS/MONITOR/RDB). 16 hex chars (64 bits) is collision-safe for a handful of bots.
  const tokenHash = createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
  return `max:bot:${tokenHash}:paused_until`;
}

/**
 * Remaining pause time in ms for a MAX access token. 0 if not paused (or on Redis failure —
 * fail-open so a Redis outage never blocks sends).
 */
export async function getMaxPauseMs(accessToken: string): Promise<number> {
  if (!accessToken) return 0;
  try {
    const raw = await getGovernorRedis().get(pauseKey(accessToken));
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch (err) {
    log.warn('getMaxPauseMs failed — treating as not paused', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/** True if the MAX token is currently paused (429 backpressure active). */
export async function isMaxPaused(accessToken: string): Promise<boolean> {
  return (await getMaxPauseMs(accessToken)) > 0;
}

/**
 * Pause the MAX token for `ms` (global backpressure after a 429).
 * Stores absolute epoch-ms expiry; sets PX so the key self-expires.
 */
export async function pauseMax(accessToken: string, ms: number): Promise<void> {
  if (!accessToken || ms <= 0) return;
  const until = Date.now() + ms;
  try {
    await getGovernorRedis().set(pauseKey(accessToken), String(until), 'PX', ms);
    log.warn('max bot paused (429 backpressure)', { ms, until });
  } catch (err) {
    log.error('pauseMax failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
