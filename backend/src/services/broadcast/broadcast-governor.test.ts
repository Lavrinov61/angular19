/**
 * Broadcast Governor — isolation tests.
 *
 * Central guarantee: a 429 on the BROADCAST line arms a per-token global pause that
 * the TRANSACTIONAL outbound path observes BEFORE sending → an ad burst cannot freeze
 * live support on the shared @FmagnusBot token.
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

import { isBotPaused, getBotPauseMs, pauseBot } from './broadcast-governor.js';

const TOKEN = '8038532455:AA-fake-test-token';

describe('broadcast-governor', () => {
  beforeEach(() => {
    store.clear();
    // NOTE: do NOT clear mockCreateResilientRedis — the governor caches one client per
    // process (module singleton) across all calls; the last test asserts it's created once.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('not paused by default', async () => {
    expect(await isBotPaused(TOKEN)).toBe(false);
    expect(await getBotPauseMs(TOKEN)).toBe(0);
  });

  it('CENTRAL GUARANTEE: 429 on broadcast line → transactional path sees pause and must not send', async () => {
    // Broadcast worker hits a 429 and arms the governor (retry_after = 5s).
    await pauseBot(TOKEN, 5000);

    // Transactional outbound path reads the SAME key BEFORE its send-dispatch.
    expect(await isBotPaused(TOKEN)).toBe(true);
    const remaining = await getBotPauseMs(TOKEN);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(5000);
  });

  it('pause lifts exactly when retry_after elapses (PX expiry)', async () => {
    await pauseBot(TOKEN, 5000);
    expect(await isBotPaused(TOKEN)).toBe(true);

    // Just before expiry — still paused.
    vi.advanceTimersByTime(4999);
    expect(await isBotPaused(TOKEN)).toBe(true);
    expect(await getBotPauseMs(TOKEN)).toBe(1);

    // At/after expiry — pause cleared.
    vi.advanceTimersByTime(1);
    expect(await isBotPaused(TOKEN)).toBe(false);
    expect(await getBotPauseMs(TOKEN)).toBe(0);
  });

  it('pause is keyed by token — a different bot token is unaffected', async () => {
    await pauseBot(TOKEN, 5000);
    expect(await isBotPaused('other-bot-token')).toBe(false);
  });

  it('SECURITY: raw bot token never appears in the Redis key (hashed)', async () => {
    await pauseBot(TOKEN, 5000);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(1);
    // The key must be the hashed form, not contain the secret token substring.
    expect(keys[0]).not.toContain(TOKEN);
    expect(keys[0]).not.toContain('AA-fake-test-token');
    expect(keys[0]).toMatch(/^tg:bot:[0-9a-f]{16}:paused_until$/);
  });

  it('pauseBot is a no-op for empty token or non-positive ms', async () => {
    await pauseBot('', 5000);
    await pauseBot(TOKEN, 0);
    await pauseBot(TOKEN, -100);
    expect(await isBotPaused(TOKEN)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('a later 429 extends the pause window', async () => {
    await pauseBot(TOKEN, 2000);
    vi.advanceTimersByTime(1000); // 1s elapsed, 1s remaining
    expect(await getBotPauseMs(TOKEN)).toBe(1000);

    // Second 429 arms a fresh 5s pause from now.
    await pauseBot(TOKEN, 5000);
    expect(await getBotPauseMs(TOKEN)).toBe(5000);
  });

  it('fails open: a Redis read error is treated as "not paused" (never blocks sends)', async () => {
    const getSpy = vi.spyOn(mockRedis, 'get').mockRejectedValueOnce(new Error('redis down'));
    expect(await getBotPauseMs(TOKEN)).toBe(0);
    expect(await isBotPaused(TOKEN)).toBe(false);
    getSpy.mockRestore();
  });

  it('reuses a single Redis client across calls (one per process)', async () => {
    await isBotPaused(TOKEN);
    await pauseBot(TOKEN, 1000);
    await getBotPauseMs(TOKEN);
    expect(mockCreateResilientRedis).toHaveBeenCalledTimes(1);
  });
});
