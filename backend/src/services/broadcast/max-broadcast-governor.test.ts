/**
 * MAX Broadcast Governor — isolation tests.
 *
 * Central guarantee: a 429 on the MAX broadcast line arms a per-token global pause in a
 * SEPARATE Redis namespace (`max:bot:`) from the Telegram governor (`tg:bot:`) — so a MAX
 * ad burst can never freeze the live Telegram bot token, and vice versa.
 *
 * Redis is mocked with an in-memory store honoring SET ... PX <ms> expiry, driven by
 * vitest fake timers so we can assert the pause lifts exactly when it should.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory Redis honoring PX expiry against Date.now() (advanced by fake timers).
interface StoreEntry {
  value: string;
  expiresAt: number | null;
}

const store = new Map<string, StoreEntry>();

const mockRedis = {
  async get(key: string): Promise<string | null> {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key: string, value: string, mode?: string, ttl?: number): Promise<'OK'> {
    const expiresAt = mode === 'PX' && typeof ttl === 'number' ? Date.now() + ttl : null;
    store.set(key, { value, expiresAt });
    return 'OK';
  },
};

const mockCreateResilientRedis = vi.fn(() => mockRedis);

vi.mock('../redis-factory.js', () => ({
  createResilientRedis: (...args: unknown[]) => mockCreateResilientRedis(...(args as [])),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { isMaxPaused, getMaxPauseMs, pauseMax } from './max-broadcast-governor.js';

const TOKEN = 'max-access-token-AABBCC';

describe('max-broadcast-governor', () => {
  beforeEach(() => {
    store.clear();
    // NOTE: do NOT clear mockCreateResilientRedis — the governor caches one client per
    // process (module singleton) across all calls; the last test asserts it's created once.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('not paused by default', async () => {
    expect(await isMaxPaused(TOKEN)).toBe(false);
    expect(await getMaxPauseMs(TOKEN)).toBe(0);
  });

  it('CENTRAL GUARANTEE: a MAX 429 arms a pause the MAX worker reads before sending', async () => {
    await pauseMax(TOKEN, 30000);

    expect(await isMaxPaused(TOKEN)).toBe(true);
    const remaining = await getMaxPauseMs(TOKEN);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30000);
  });

  it('pause lifts exactly when the window elapses (PX expiry)', async () => {
    await pauseMax(TOKEN, 30000);
    expect(await isMaxPaused(TOKEN)).toBe(true);

    vi.advanceTimersByTime(29999);
    expect(await isMaxPaused(TOKEN)).toBe(true);
    expect(await getMaxPauseMs(TOKEN)).toBe(1);

    vi.advanceTimersByTime(1);
    expect(await isMaxPaused(TOKEN)).toBe(false);
    expect(await getMaxPauseMs(TOKEN)).toBe(0);
  });

  it('ISOLATION: a MAX pause does NOT pause a different MAX token', async () => {
    await pauseMax(TOKEN, 30000);
    expect(await isMaxPaused('some-other-max-token')).toBe(false);
  });

  it('NAMESPACE: the MAX governor key lives in max:bot:, NEVER tg:bot: (no TG cross-pause)', async () => {
    await pauseMax(TOKEN, 30000);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    // Distinct namespace from broadcast-governor (`tg:bot:`) so the live TG token is untouched.
    expect(keys[0]).toMatch(/^max:bot:[0-9a-f]{16}:paused_until$/);
    expect(keys[0]).not.toContain('tg:bot:');
  });

  it('SECURITY: the raw MAX access token never appears in the Redis key (hashed)', async () => {
    await pauseMax(TOKEN, 30000);
    const keys = [...store.keys()];
    expect(keys[0]).not.toContain(TOKEN);
    expect(keys[0]).not.toContain('AABBCC');
  });

  it('pauseMax is a no-op for an empty token or non-positive ms', async () => {
    await pauseMax('', 30000);
    await pauseMax(TOKEN, 0);
    await pauseMax(TOKEN, -100);
    expect(await isMaxPaused(TOKEN)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('a later 429 extends the pause window', async () => {
    await pauseMax(TOKEN, 10000);
    vi.advanceTimersByTime(5000); // 5s elapsed, 5s remaining
    expect(await getMaxPauseMs(TOKEN)).toBe(5000);

    await pauseMax(TOKEN, 30000); // fresh 30s from now
    expect(await getMaxPauseMs(TOKEN)).toBe(30000);
  });

  it('fails open: a Redis read error is treated as "not paused" (never blocks sends)', async () => {
    const getSpy = vi.spyOn(mockRedis, 'get').mockRejectedValueOnce(new Error('redis down'));
    expect(await getMaxPauseMs(TOKEN)).toBe(0);
    expect(await isMaxPaused(TOKEN)).toBe(false);
    getSpy.mockRestore();
  });

  it('reuses a single Redis client across calls (one per process)', async () => {
    await isMaxPaused(TOKEN);
    await pauseMax(TOKEN, 1000);
    await getMaxPauseMs(TOKEN);
    expect(mockCreateResilientRedis).toHaveBeenCalledTimes(1);
  });
});
