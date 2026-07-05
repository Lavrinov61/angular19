/**
 * Omnichannel v2 — Circuit Breaker (per-channel/account)
 *
 * Wraps the shared CircuitBreaker class with account-aware keying.
 * Composite key: "{channel}" or "{channel}:{accountId}" for multi-tenant.
 *
 * Re-exports CircuitBreaker for backward compatibility with existing connectors.
 */

import { CircuitBreaker, getBreaker as getSharedBreaker, getAllBreakers } from '../../../utils/circuit-breaker.js';
import type { ChannelType } from './types.js';

export { CircuitBreaker, getAllBreakers };

/**
 * Get a circuit breaker for a specific channel + account combination.
 * Falls back to channel-level breaker if no accountId provided.
 */
export function getBreaker(channel: ChannelType, accountId?: string): CircuitBreaker {
  const key = accountId ? `${channel}:${accountId}` : channel;
  return getSharedBreaker(key);
}

/**
 * Execute an async function with circuit breaker protection.
 *
 * - Throws if circuit is OPEN (fast-fail, no network call).
 * - On success: resets failure counter, closes circuit.
 * - On failure: increments counter, opens circuit after threshold.
 *
 * @throws Error if circuit is open or fn throws
 */
export async function withCircuitBreaker<T>(
  channel: ChannelType,
  accountId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const breaker = getBreaker(channel, accountId);

  if (!breaker.allow()) {
    throw new Error(
      `Circuit breaker OPEN for ${channel}${accountId ? `:${accountId.slice(0, 8)}` : ''} — ${breaker.getFailures()} failures, last: ${breaker.getLastError()}`,
    );
  }

  try {
    const result = await fn();
    breaker.success();
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Rate-limit / flood-wait errors are transient — don't trip the circuit breaker
    const isRateLimit = /429|rate.?limit|flood.?wait/i.test(errMsg);
    if (!isRateLimit) {
      breaker.failure(errMsg);
    }
    throw err;
  }
}
