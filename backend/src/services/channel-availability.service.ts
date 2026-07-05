/**
 * Channel Availability Service (public-facing)
 *
 * Lightweight "is this channel reachable right now?" probe for the public site.
 * Unlike channel-health.service (operator dashboard, judges by circuit-breaker +
 * webhook freshness), this performs a LIVE credential check against the provider
 * so the public "WhatsApp временно не работает" banner reflects the real BSP link.
 *
 * For WhatsApp/Gupshup this calls adapter.verifyCredentials() — a no-destination
 * POST that Gupshup rejects without sending anything, so it is side-effect free.
 *
 * Result is cached in Redis (TTL 300s) so a flood of site visitors cannot hammer
 * the provider — at most one live probe per 5 minutes.
 */

import { getAccountByChannel } from './connectors/core/account-store.js';
import { getAdapter, isChannelDisabled } from './connectors/core/adapter-registry.js';
import { getBreaker } from '../utils/circuit-breaker.js';
import { createResilientRedis } from './redis-factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('channel-availability');

const redis = createResilientRedis('channel-availability', {
  lazyConnect: true,
  enableOfflineQueue: false,
});
redis.connect().catch((err: Error) => log.warn('Redis connect error', { error: err.message }));

const CACHE_KEY = 'channel:availability:whatsapp';
const CACHE_TTL = 300; // seconds — at most one live provider probe per 5 minutes

export interface ChannelAvailability {
  available: boolean;
  checkedAt: string;
}

/** Live probe (no cache): is the WhatsApp/Gupshup link usable right now? */
async function probeWhatsapp(): Promise<ChannelAvailability> {
  const checkedAt = new Date().toISOString();
  try {
    const account = await getAccountByChannel('whatsapp');
    // getAccountByChannel already filters is_active = true
    if (!account) return { available: false, checkedAt };

    if (await isChannelDisabled('whatsapp')) return { available: false, checkedAt };

    // Circuit breaker OPEN means recent sends are failing — treat as down without
    // spending a provider round-trip.
    if (getBreaker('whatsapp').getState() === 'OPEN') return { available: false, checkedAt };

    const adapter = getAdapter('whatsapp');
    if (!adapter) return { available: false, checkedAt };

    const verify = await adapter.verifyCredentials(account);
    return { available: !!verify.ok, checkedAt };
  } catch (err) {
    // Fail-open: an internal error (Redis/DB/registry) must not surface a false
    // "WhatsApp не работает" banner to every visitor. verifyCredentials itself
    // never throws on provider errors — it returns { ok: false } — so reaching
    // here means our own infrastructure hiccuped, not the channel.
    log.warn('WhatsApp availability probe failed (fail-open)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: true, checkedAt };
  }
}

/** Cached availability for the WhatsApp channel. */
export async function getWhatsappAvailability(): Promise<ChannelAvailability> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ChannelAvailability;
  } catch {
    // cache miss / Redis down — fall through to a live probe
  }

  const result = await probeWhatsapp();

  try {
    await redis.set(CACHE_KEY, JSON.stringify(result), 'EX', CACHE_TTL);
  } catch {
    // non-critical — caching is best-effort
  }

  return result;
}

/** Drop the cached availability (e.g. after admin reconnects the channel). */
export async function invalidateWhatsappAvailability(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch {
    // non-critical
  }
}
