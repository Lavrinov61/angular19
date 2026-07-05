import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for vk-send.service (VK broadcast send-engine).
 *
 * Mirrors max-broadcast-sender.test.ts / campaign.service.test.ts: DB is mocked with a
 * SQL-text router; adapter / account-store / governor are mocked to assert VK error
 * classification + double-send protection without a network.
 *
 * VK-specific behaviours under test (the heart of the anti-ban contract, brief §risk):
 *  - send via VkAdapter.sendMediaWithKeyboard (photo + caption + keyboard in ONE message);
 *  - code 6  → rate_limited, SHORT 5s group pause (attempt NOT consumed, row left queued);
 *  - code 9  → rate_limited, LONG 10s group pause (flood control is stricter than code 6);
 *  - code 14 (CAPTCHA) → terminal failed, NO retry (needs a human) + alert;
 *  - code 901/902/936 → blocked + marketing_suppressions (+ channel_users opt-in cleared);
 *  - 5xx/network → retryable backoff failed (attempts remain);
 *  - external_message_id IS NULL guard (stamp 'vk:<id>' exactly once);
 *  - CAS-skip when the row is not claimable (0 rows → 'skipped', nothing sent).
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const {
  mockQuery,
  mockQueryOne,
  mockTransaction,
  mockSendMediaWithKeyboard,
  mockGetAccountByChannel,
  mockGetAdapterOrThrow,
  mockPauseVkGroup,
  mockMarkFailed,
  mockCaptureException,
} = vi.hoisted(() => {
  const sendMediaWithKeyboard = vi.fn();
  return {
    mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
    mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
    mockTransaction: vi.fn(),
    mockSendMediaWithKeyboard: sendMediaWithKeyboard,
    mockGetAccountByChannel: vi.fn().mockResolvedValue({
      id: 'acct-vk',
      credentials: { groupToken: 'vk1.a.GROUP-TOKEN' },
    }),
    mockGetAdapterOrThrow: vi.fn(() => ({ sendMediaWithKeyboard })),
    mockPauseVkGroup: vi.fn().mockResolvedValue(undefined),
    mockMarkFailed: vi.fn().mockResolvedValue(undefined),
    mockCaptureException: vi.fn(),
  };
});

vi.mock('../../../database/db.js', () => ({
  default: {
    query: mockQuery,
    queryOne: mockQueryOne,
    transaction: mockTransaction,
  },
}));

vi.mock('./vk-broadcast-governor.js', () => ({
  pauseVkGroup: mockPauseVkGroup,
  isVkGroupPaused: vi.fn().mockResolvedValue(false),
  getVkGroupPauseMs: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../connectors/core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
}));

vi.mock('../../connectors/core/adapter-registry.js', () => ({
  getAdapterOrThrow: mockGetAdapterOrThrow,
}));

// markFailed/withUtm/CLAIM_LEASE_MS come from campaign.service — mock the shared contract so
// we can assert WHEN vk-send marks terminal/retryable without exercising the real DB writer.
vi.mock('../campaign.service.js', () => ({
  markFailed: mockMarkFailed,
  withUtm: (base: string) => base,
  CLAIM_LEASE_MS: 300000,
}));

vi.mock('../../../utils/error-tracker.js', () => ({
  captureException: mockCaptureException,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { sendToVkRecipient } = await import('./vk-send.service.js');

// ─── Helpers ───────────────────────────────────────────────────────────────

const RECIPIENT = {
  id: 'rcpt-1',
  contact_id: 'contact-1',
  external_chat_id: '66681961',
  personalized_url: 'https://svoefoto.ru/?utm_content=contact-1',
  payload_snapshot: { text: 'Привет!', mediaUrl: 'https://cdn/x.jpg', buttons: null },
  attempts: 0,
  max_attempts: 3,
};

const CAMPAIGN_UTM = {
  id: 'camp-1',
  utm_source: 'vk',
  utm_medium: 'group',
  utm_campaign: 'edu-print-vk',
};

/** Route mockQuery by SQL fragment. `claimRows` controls the CAS-lease UPDATE result. */
function routeQueries(opts: { claimRows?: unknown[] } = {}) {
  const claimRows = opts.claimRows ?? [RECIPIENT];
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('SET next_attempt_at') && sql.includes("status IN ('queued','failed')") && sql.includes('RETURNING')) {
      return claimRows;
    }
    return [];
  });
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('mc.utm_source')) return CAMPAIGN_UTM;
    return null;
  });
  mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    return fn(client);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMediaWithKeyboard.mockReset();
  mockGetAccountByChannel.mockResolvedValue({ id: 'acct-vk', credentials: { groupToken: 'vk1.a.GROUP-TOKEN' } });
  mockGetAdapterOrThrow.mockReturnValue({ sendMediaWithKeyboard: mockSendMediaWithKeyboard });
  mockPauseVkGroup.mockResolvedValue(undefined);
  mockMarkFailed.mockResolvedValue(undefined);
});

// ─── CAS double-send protection ──────────────────────────────────────────────

describe('sendToVkRecipient — CAS double-send protection', () => {
  it('skips without sending when the row is not claimable (0 rows)', async () => {
    routeQueries({ claimRows: [] });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('skipped');
    expect(mockSendMediaWithKeyboard).not.toHaveBeenCalled();
    expect(mockPauseVkGroup).not.toHaveBeenCalled();
  });
});

// ─── success ────────────────────────────────────────────────────────────────

describe('sendToVkRecipient — success', () => {
  it('marks sent and stamps external_message_id once (guard IS NULL)', async () => {
    routeQueries();
    // Адаптер VK уже возвращает externalMessageId с префиксом 'vk:' (vk.adapter.ts:989) —
    // мок отражает реальный контракт; vk-send НЕ префиксит повторно (был баг vk:vk:).
    mockSendMediaWithKeyboard.mockResolvedValue({ success: true, externalMessageId: 'vk:14447' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('sent');
    expect(mockSendMediaWithKeyboard).toHaveBeenCalledTimes(1);
    const args = mockSendMediaWithKeyboard.mock.calls[0];
    // signature: (account, peerId, mediaUrl, caption, keyboard, idempotencyKey)
    expect(args[1]).toBe('66681961');             // peerId
    expect(args[2]).toBe('https://cdn/x.jpg');    // mediaUrl
    expect(args[3]).toBe('Привет!');              // caption
    expect(args[5]).toBe('rcpt-1');               // idempotencyKey = recipient row id

    // stamp 'vk:'-prefixed id exactly once, guarded by external_message_id IS NULL.
    const sentUpdate = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'sent'"));
    expect(sentUpdate).toBeTruthy();
    expect(String(sentUpdate![0])).toContain('external_message_id IS NULL'); // stamp-once guard
    expect((sentUpdate![1] as unknown[])[1]).toBe('vk:14447');
  });

  it('builds a VK keyboard: 1 URL row + «Наши адреса» + (не студент + отписаться) callbacks', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: true, externalMessageId: '1' });

    await sendToVkRecipient('rcpt-1');

    const keyboard = mockSendMediaWithKeyboard.mock.calls[0][4] as Array<Array<{ text: string; url?: string; callback_data?: string }>>;
    // Row 0 = default link button; Row 1 = «Наши адреса»; Row 2 = (not-student + unsubscribe).
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0][0].url).toBeTruthy();
    expect(keyboard[1][0].callback_data).toBe('vk_addresses');
    expect(keyboard[2][0].callback_data).toBe('vk_not_student');
    expect(keyboard[2][1].callback_data).toBe('vk_unsub');
    // The unsubscribe button is MANDATORY (anti-ban, brief §risk).
    expect(keyboard[2].some((b) => b.callback_data === 'vk_unsub')).toBe(true);
  });
});

// ─── code 6 / 9: group backpressure (NEVER a recipient status) ────────────────

describe('sendToVkRecipient — code 6 (too many requests/sec)', () => {
  it('pauses the group for SHORT 5s, leaves row queued, returns rate_limited (attempt NOT consumed)', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: '6', errorMessage: 'Too many requests per second' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('rate_limited');
    expect(out.retryAfterMs).toBe(5000);
    expect(mockPauseVkGroup).toHaveBeenCalledWith('vk1.a.GROUP-TOKEN', 5000);
    // row left 'queued', NOT failed; attempts NOT bumped (no markFailed).
    const requeue = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'queued'") && String(sql).includes('next_attempt_at'));
    expect(requeue).toBeTruthy();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });
});

describe('sendToVkRecipient — code 9 (flood control)', () => {
  it('pauses the group for LONG 10s (stricter than code 6), leaves row queued, rate_limited', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: '9', errorMessage: 'Flood control' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('rate_limited');
    expect(out.retryAfterMs).toBe(10000);
    expect(mockPauseVkGroup).toHaveBeenCalledWith('vk1.a.GROUP-TOKEN', 10000);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });
});

// ─── code 14 CAPTCHA: STOP (terminal, no retry, alert) ────────────────────────

describe('sendToVkRecipient — code 14 (CAPTCHA)', () => {
  it('marks terminal failed (NO retry) and raises an alert — needs a human', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: '14', errorMessage: 'Captcha needed' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    // markFailed called with terminal=true (4th positional arg) → no retry.
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed.mock.calls[0][4]).toBe(true);
    // an alert is captured so an operator intervenes (avoid a group ban).
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    // a CAPTCHA is NEVER a rate-limit pause.
    expect(mockPauseVkGroup).not.toHaveBeenCalled();
  });
});

// ─── code 901/902/936: blocked → suppression ──────────────────────────────────

describe('sendToVkRecipient — code 901/902/936 (recipient unreachable)', () => {
  it.each([
    ['901', 'No permission to message this user'],
    ['902', "Can't send messages due to privacy settings"],
    ['936', 'Contact not found'],
  ])('code %s → blocked + suppression + opt-in cleared (in one transaction)', async (code) => {
    const txClientCalls: string[] = [];
    routeQueries();
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = { query: vi.fn(async (sql: string) => { txClientCalls.push(sql); return { rows: [], rowCount: 0 }; }) };
      return fn(client);
    });
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: code, errorMessage: 'blocked' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('blocked');
    expect(txClientCalls.some((s) => s.includes("status = 'blocked'"))).toBe(true);
    expect(txClientCalls.some((s) => s.includes('INSERT INTO marketing_suppressions'))).toBe(true);
    // opt-in is cleared so the suppressed peer is never re-materialized.
    expect(txClientCalls.some((s) => s.includes('UPDATE channel_users') && s.includes('opted_in = false'))).toBe(true);
    expect(mockPauseVkGroup).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });
});

// ─── 5xx / network → retryable backoff ────────────────────────────────────────

describe('sendToVkRecipient — retryable failure', () => {
  it('marks failed with backoff (terminal=false) on a 5xx', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: '502', errorMessage: 'Bad Gateway' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed.mock.calls[0][4]).toBe(false); // retryable
    expect(mockPauseVkGroup).not.toHaveBeenCalled();
  });

  it('fails permanently (NO retry, NO send) when the payload has no mediaUrl', async () => {
    routeQueries({ claimRows: [{ ...RECIPIENT, payload_snapshot: { text: 'x', mediaUrl: null, buttons: null } }] });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockSendMediaWithKeyboard).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed.mock.calls[0][4]).toBe(true); // terminal
  });

  it('fails (terminal=false) when there is no active VK account', async () => {
    routeQueries();
    mockGetAccountByChannel.mockResolvedValue(null);

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockSendMediaWithKeyboard).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed.mock.calls[0][4]).toBe(false);
  });
});

// ─── terminal 4xx (non-VK-business code) ──────────────────────────────────────

describe('sendToVkRecipient — terminal 4xx', () => {
  it('marks terminal failed (no retry) on a generic 4xx HTTP code', async () => {
    routeQueries();
    mockSendMediaWithKeyboard.mockResolvedValue({ success: false, errorCode: '400', errorMessage: 'Bad Request' });

    const out = await sendToVkRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed.mock.calls[0][4]).toBe(true); // terminal
    expect(mockPauseVkGroup).not.toHaveBeenCalled();
  });
});
