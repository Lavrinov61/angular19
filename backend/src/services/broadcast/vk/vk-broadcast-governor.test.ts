/**
 * VK Broadcast Governor — isolation tests.
 *
 * Central guarantee: a VK code 6/9 (too-many-per-sec / flood) arms a per-token global pause
 * in a SEPARATE Redis namespace (`vk:group:`) from the Telegram (`tg:bot:`) and MAX
 * (`max:bot:`) governors — so a VK ad burst can never freeze the live TG/MAX tokens, and vice
 * versa. The pause is keyed by the HASH of the group TOKEN (P2-3), never by groupId, so the
 * secret never lands in `redis-cli KEYS`/`MONITOR`/RDB.
 *
 * Redis is mocked with an in-memory store honoring SET ... PX <ms> expiry, driven by vitest
 * fake timers so we can assert the pause lifts exactly when it should. Mirrors the style of
 * max-broadcast-governor.test.ts.
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

vi.mock('../../redis-factory.js', () => ({
  createResilientRedis: (...args: unknown[]) => mockCreateResilientRedis(...(args as [])),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { isVkGroupPaused, getVkGroupPauseMs, pauseVkGroup } from './vk-broadcast-governor.js';

const TOKEN = 'vk1.a.GROUP-TOKEN-AABBCC';

describe('vk-broadcast-governor', () => {
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
    expect(await isVkGroupPaused(TOKEN)).toBe(false);
    expect(await getVkGroupPauseMs(TOKEN)).toBe(0);
  });

  it('CENTRAL GUARANTEE: a VK 6/9 arms a pause the VK worker reads before sending', async () => {
    await pauseVkGroup(TOKEN, 10000);

    expect(await isVkGroupPaused(TOKEN)).toBe(true);
    const remaining = await getVkGroupPauseMs(TOKEN);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(10000);
  });

  it('pause lifts exactly when the window elapses (PX expiry)', async () => {
    await pauseVkGroup(TOKEN, 10000);
    expect(await isVkGroupPaused(TOKEN)).toBe(true);

    vi.advanceTimersByTime(9999);
    expect(await isVkGroupPaused(TOKEN)).toBe(true);
    expect(await getVkGroupPauseMs(TOKEN)).toBe(1);

    vi.advanceTimersByTime(1);
    expect(await isVkGroupPaused(TOKEN)).toBe(false);
    expect(await getVkGroupPauseMs(TOKEN)).toBe(0);
  });

  it('ISOLATION: a VK pause does NOT pause a different VK group token', async () => {
    await pauseVkGroup(TOKEN, 10000);
    expect(await isVkGroupPaused('vk1.a.SOME-OTHER-GROUP-TOKEN')).toBe(false);
  });

  it('NAMESPACE: the VK governor key lives in vk:group:, NEVER tg:bot:/max:bot:', async () => {
    await pauseVkGroup(TOKEN, 10000);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    // Distinct namespace so the live TG/MAX tokens are untouched by a VK flood.
    expect(keys[0]).toMatch(/^vk:group:[0-9a-f]{16}:paused_until$/);
    expect(keys[0]).not.toContain('tg:bot:');
    expect(keys[0]).not.toContain('max:bot:');
  });

  it('SECURITY (P2-3): the raw VK group token never appears in the Redis key (hashed)', async () => {
    await pauseVkGroup(TOKEN, 10000);
    const keys = [...store.keys()];
    expect(keys[0]).not.toContain(TOKEN);
    expect(keys[0]).not.toContain('AABBCC');
  });

  it('pauseVkGroup is a no-op for an empty token or non-positive ms', async () => {
    await pauseVkGroup('', 10000);
    await pauseVkGroup(TOKEN, 0);
    await pauseVkGroup(TOKEN, -100);
    expect(await isVkGroupPaused(TOKEN)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('getVkGroupPauseMs returns 0 for an empty token (no Redis hit)', async () => {
    const getSpy = vi.spyOn(mockRedis, 'get');
    expect(await getVkGroupPauseMs('')).toBe(0);
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('a later 6/9 extends the pause window (short 5s → long 10s)', async () => {
    await pauseVkGroup(TOKEN, 5000);
    vi.advanceTimersByTime(2000); // 2s elapsed, 3s remaining
    expect(await getVkGroupPauseMs(TOKEN)).toBe(3000);

    await pauseVkGroup(TOKEN, 10000); // fresh 10s flood window from now
    expect(await getVkGroupPauseMs(TOKEN)).toBe(10000);
  });

  it('fails open: a Redis read error is treated as "not paused" (never blocks sends)', async () => {
    const getSpy = vi.spyOn(mockRedis, 'get').mockRejectedValueOnce(new Error('redis down'));
    expect(await getVkGroupPauseMs(TOKEN)).toBe(0);
    expect(await isVkGroupPaused(TOKEN)).toBe(false);
    getSpy.mockRestore();
  });

  it('fails open: a Redis write error does not throw (pauseVkGroup swallows it)', async () => {
    const setSpy = vi.spyOn(mockRedis, 'set').mockRejectedValueOnce(new Error('redis down'));
    await expect(pauseVkGroup(TOKEN, 10000)).resolves.toBeUndefined();
    setSpy.mockRestore();
  });

  it('reuses a single Redis client across calls (one per process)', async () => {
    await isVkGroupPaused(TOKEN);
    await pauseVkGroup(TOKEN, 1000);
    await getVkGroupPauseMs(TOKEN);
    expect(mockCreateResilientRedis).toHaveBeenCalledTimes(1);
  });
});
