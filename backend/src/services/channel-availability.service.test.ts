import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted so they exist before vi.mock factories run) ───────────────
const h = vi.hoisted(() => ({
  redis: {
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  },
  getAccountByChannel: vi.fn(),
  getAdapter: vi.fn(),
  isChannelDisabled: vi.fn(),
  getState: vi.fn(),
  verifyCredentials: vi.fn(),
}));

vi.mock('./redis-factory.js', () => ({ createResilientRedis: () => h.redis }));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('./connectors/core/account-store.js', () => ({
  getAccountByChannel: (...args: unknown[]) => h.getAccountByChannel(...args),
}));
vi.mock('./connectors/core/adapter-registry.js', () => ({
  getAdapter: (...args: unknown[]) => h.getAdapter(...args),
  isChannelDisabled: (...args: unknown[]) => h.isChannelDisabled(...args),
}));
vi.mock('../utils/circuit-breaker.js', () => ({
  getBreaker: () => ({ getState: () => h.getState() }),
}));

import { getWhatsappAvailability } from './channel-availability.service.js';

const FAKE_ACCOUNT = { id: 'acc-1', channel: 'whatsapp', isActive: true, credentials: {} };

beforeEach(() => {
  vi.clearAllMocks();
  h.redis.get.mockResolvedValue(null); // cache miss by default
  h.redis.set.mockResolvedValue('OK');
  h.getAccountByChannel.mockResolvedValue(FAKE_ACCOUNT);
  h.isChannelDisabled.mockResolvedValue(false);
  h.getState.mockReturnValue('CLOSED');
  h.getAdapter.mockReturnValue({ verifyCredentials: (...a: unknown[]) => h.verifyCredentials(...a) });
  h.verifyCredentials.mockResolvedValue({ ok: true });
});

describe('getWhatsappAvailability', () => {
  it('returns available=true when credentials verify ok', async () => {
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(true);
    expect(h.verifyCredentials).toHaveBeenCalledWith(FAKE_ACCOUNT);
    expect(h.redis.set).toHaveBeenCalled(); // result cached
  });

  it('returns available=false when credentials fail', async () => {
    h.verifyCredentials.mockResolvedValue({ ok: false, error: 'Invalid token' });
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(false);
  });

  it('returns available=false when no active account exists', async () => {
    h.getAccountByChannel.mockResolvedValue(null);
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(false);
    expect(h.verifyCredentials).not.toHaveBeenCalled();
  });

  it('returns available=false when channel is admin-disabled', async () => {
    h.isChannelDisabled.mockResolvedValue(true);
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(false);
    expect(h.verifyCredentials).not.toHaveBeenCalled();
  });

  it('returns available=false when circuit breaker is OPEN (no provider round-trip)', async () => {
    h.getState.mockReturnValue('OPEN');
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(false);
    expect(h.verifyCredentials).not.toHaveBeenCalled();
  });

  it('fails open (available=true) on internal error', async () => {
    h.getAccountByChannel.mockRejectedValue(new Error('DB down'));
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(true);
  });

  it('returns cached value without probing when cache hit', async () => {
    h.redis.get.mockResolvedValue(JSON.stringify({ available: false, checkedAt: '2026-01-01T00:00:00.000Z' }));
    const r = await getWhatsappAvailability();
    expect(r.available).toBe(false);
    expect(h.getAccountByChannel).not.toHaveBeenCalled();
    expect(h.verifyCredentials).not.toHaveBeenCalled();
  });
});
