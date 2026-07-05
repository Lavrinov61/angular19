import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the VK adapter broadcast additions (S3): keyboard mapping, the deterministic
 * random_id (idempotency seam), isSpecialEvent recognising message_event, and handleSpecialEvent
 * dispatching the callback + ack'ing via sendMessageEventAnswer.
 *
 * The pure helpers (mapBroadcastButtonsToVkKeyboard / deterministicRandomId) need no mocks. The
 * message_event branch dynamic-imports the (S5) callback module and POSTs the ack — fetch is
 * mocked so we assert the wiring (callback invoked, ack POSTed with the snackbar) without a
 * network. The callback module is mocked via vi.mock on its concrete path.
 */

const { mockHandleVkBroadcastCallback, mockFetchWithTimeout, mockDb } = vi.hoisted(() => ({
  mockHandleVkBroadcastCallback: vi.fn(),
  mockFetchWithTimeout: vi.fn(),
  mockDb: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));
vi.mock('../../../database/db.js', () => ({ default: mockDb }));
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('./vk.user-cache.js', () => ({ resolveVkUserName: vi.fn().mockResolvedValue('VK User') }));
// The S5 callback module — handleSpecialEvent dynamic-imports it via a string path; vi.mock on
// the resolved specifier intercepts the import.
vi.mock('../../broadcast/vk/vk-broadcast-callbacks.service.js', () => ({
  handleVkBroadcastCallback: mockHandleVkBroadcastCallback,
}));

import type { ChannelAccount } from '../core/types.js';
const { VkAdapter, mapBroadcastButtonsToVkKeyboard, deterministicRandomId } = await import('./vk.adapter.js');

const ACCOUNT: ChannelAccount = {
  id: 'acct-vk',
  channel: 'vk',
  name: 'VK group',
  isActive: true,
  credentials: { groupToken: 'vk1.a.GROUP-TOKEN', confirmationCode: 'abc123' },
  rateLimitMax: 20,
  rateLimitDurationMs: 1000,
  capabilities: new VkAdapter().getCapabilities(),
  tokenExpiresAt: null,
  tokenRefreshedAt: null,
  webhookUrl: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleVkBroadcastCallback.mockReset().mockResolvedValue(undefined);
  mockFetchWithTimeout.mockReset().mockResolvedValue({ ok: true, json: async () => ({ response: 1 }) });
});

// ─── mapBroadcastButtonsToVkKeyboard ─────────────────────────────────────────

describe('mapBroadcastButtonsToVkKeyboard', () => {
  it('maps {text,url} → open_link and {text,callback_data} → callback payload JSON {cmd}', () => {
    const kb = mapBroadcastButtonsToVkKeyboard([
      [{ text: 'На сайт', url: 'https://svoefoto.ru/x' }],
      [{ text: 'Отписаться', callback_data: 'vk_unsub' }],
    ]);

    expect(kb.inline).toBe(true);
    expect(kb.buttons).toHaveLength(2);
    const link = kb.buttons[0][0].action;
    expect(link).toEqual({ type: 'open_link', label: 'На сайт', link: 'https://svoefoto.ru/x' });
    const cb = kb.buttons[1][0].action;
    // Discriminated-union narrow (no cast): assert the callback branch and read its payload.
    expect(cb.type).toBe('callback');
    if (cb.type !== 'callback') throw new Error('expected a callback action');
    expect(cb.label).toBe('Отписаться');
    expect(JSON.parse(cb.payload)).toEqual({ cmd: 'vk_unsub' });
  });

  it('clamps to VK limits: ≤6 rows, ≤5 buttons/row, label ≤40 chars', () => {
    const longLabel = 'x'.repeat(50);
    const sevenRows = Array.from({ length: 7 }, () => [{ text: 'b', url: 'https://a' }]);
    const sixButtons = [Array.from({ length: 6 }, () => ({ text: longLabel, url: 'https://a' }))];

    const rows = mapBroadcastButtonsToVkKeyboard(sevenRows);
    expect(rows.buttons).toHaveLength(6); // ≤6 rows

    const cols = mapBroadcastButtonsToVkKeyboard(sixButtons);
    expect(cols.buttons[0]).toHaveLength(5); // ≤5 per row
    expect(cols.buttons[0][0].action.label).toHaveLength(40); // label clamped (both branches have `label`)
  });
});

// ─── deterministicRandomId ────────────────────────────────────────────────────

describe('deterministicRandomId', () => {
  it('is stable for the same key (so a VK retry of the same message dedups)', () => {
    const a = deterministicRandomId('rcpt-1');
    const b = deterministicRandomId('rcpt-1');
    expect(a).toBe(b);
  });

  it('differs across keys and is a positive int32 (VK random_id range)', () => {
    const a = deterministicRandomId('rcpt-1');
    const b = deterministicRandomId('rcpt-2');
    expect(a).not.toBe(b);
    for (const v of [a, b]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0x7fff_ffff);
    }
  });
});

// ─── isSpecialEvent — recognises message_event ────────────────────────────────

describe('VkAdapter.isSpecialEvent', () => {
  const adapter = new VkAdapter();

  it('recognises message_event (callback-button press) as a special event', () => {
    expect(adapter.isSpecialEvent({ type: 'message_event' })).toBe(true);
  });

  it('still recognises confirmation / message_allow / message_deny', () => {
    expect(adapter.isSpecialEvent({ type: 'confirmation' })).toBe(true);
    expect(adapter.isSpecialEvent({ type: 'message_allow' })).toBe(true);
    expect(adapter.isSpecialEvent({ type: 'message_deny' })).toBe(true);
  });

  it('does not treat message_new as a special event', () => {
    expect(adapter.isSpecialEvent({ type: 'message_new' })).toBe(false);
  });
});

// ─── handleSpecialEvent message_event → callback + ack ────────────────────────

describe('VkAdapter.handleSpecialEvent — message_event', () => {
  const adapter = new VkAdapter();

  function event(payload: unknown) {
    return {
      type: 'message_event',
      object: { user_id: 42, peer_id: 66681961, event_id: 'evt-1', payload },
    } as Record<string, unknown>;
  }

  it('dispatches the callback and POSTs sendMessageEventAnswer with the snackbar; returns "ok"', async () => {
    mockHandleVkBroadcastCallback.mockResolvedValue({ snackbar: 'Готово 🙌' });

    const res = await adapter.handleSpecialEvent(event({ cmd: 'vk_unsub' }), ACCOUNT);

    expect(res).toBe('ok');
    expect(mockHandleVkBroadcastCallback).toHaveBeenCalledWith(66681961, { cmd: 'vk_unsub' });
    const ackCall = mockFetchWithTimeout.mock.calls.find(([url]) => String(url).includes('messages.sendMessageEventAnswer'));
    expect(ackCall).toBeTruthy();
    const ackUrl = String(ackCall![0]);
    expect(ackUrl).toContain('event_id=evt-1');
    expect(ackUrl).toContain('peer_id=66681961');
    expect(ackUrl).toContain('show_snackbar');
  });

  it('returns "ok" (webhook never fails) even if the callback handler throws (P0-2 best-effort)', async () => {
    mockHandleVkBroadcastCallback.mockRejectedValue(new Error('db down'));

    const res = await adapter.handleSpecialEvent(event({ cmd: 'vk_unsub' }), ACCOUNT);

    expect(res).toBe('ok');
    // ack still attempted (no snackbar), webhook stays 200.
    const ackCall = mockFetchWithTimeout.mock.calls.find(([url]) => String(url).includes('messages.sendMessageEventAnswer'));
    expect(ackCall).toBeTruthy();
  });

  it('returns "ok" without dispatching when required fields are missing', async () => {
    const res = await adapter.handleSpecialEvent(
      { type: 'message_event', object: { peer_id: 1 } } as Record<string, unknown>,
      ACCOUNT,
    );
    expect(res).toBe('ok');
    expect(mockHandleVkBroadcastCallback).not.toHaveBeenCalled();
  });
});
