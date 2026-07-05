import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for max-broadcast-sender (MAX broadcast send-engine).
 *
 * Mirrors campaign.service.test.ts: DB is mocked with a SQL-text router, adapter/account-store/
 * governor are mocked to assert classification + double-send protection without a network.
 *
 * Key MAX-specific behaviours under test (vs the TG sender):
 *  - send via MaxAdapter.sendBroadcast (image+text+buttons in ONE message);
 *  - 429 → FIXED 30s pause via pauseMax (NOT the TG retryAfter formula);
 *  - block classification is CONSERVATIVE — only errorCode==='403' → blocked+suppression.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const {
  mockQuery,
  mockQueryOne,
  mockTransaction,
  mockSendBroadcast,
  mockGetAccountByChannel,
  mockGetAdapterOrThrow,
  mockPauseMax,
} = vi.hoisted(() => {
  const sendBroadcast = vi.fn();
  return {
    mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
    mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
    mockTransaction: vi.fn(),
    mockSendBroadcast: sendBroadcast,
    mockGetAccountByChannel: vi.fn().mockResolvedValue({
      id: 'acct-max',
      credentials: { accessToken: 'MAX:TOKEN' },
    }),
    mockGetAdapterOrThrow: vi.fn(() => ({ sendBroadcast })),
    mockPauseMax: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../database/db.js', () => ({
  default: {
    query: mockQuery,
    queryOne: mockQueryOne,
    transaction: mockTransaction,
  },
}));

vi.mock('./max-broadcast-governor.js', () => ({
  pauseMax: mockPauseMax,
  isMaxPaused: vi.fn().mockResolvedValue(false),
  getMaxPauseMs: vi.fn().mockResolvedValue(0),
}));

vi.mock('../connectors/core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
}));

vi.mock('../connectors/core/adapter-registry.js', () => ({
  getAdapterOrThrow: mockGetAdapterOrThrow,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { sendToRecipientMax } = await import('./max-broadcast-sender.js');

// ─── Helpers ───────────────────────────────────────────────────────────────

const RECIPIENT = {
  id: 'rcpt-1',
  contact_id: 'contact-1',
  external_chat_id: '138553724',
  personalized_url: 'https://svoefoto.ru/?utm_content=contact-1',
  payload_snapshot: { text: 'Привет!', mediaUrl: 'https://cdn/x.jpg', buttons: null },
  attempts: 0,
  max_attempts: 3,
};

const CAMPAIGN_UTM = {
  id: 'camp-1',
  utm_source: 'max',
  utm_medium: 'bot',
  utm_campaign: 'edu-print-max',
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
  mockSendBroadcast.mockReset();
  mockGetAccountByChannel.mockResolvedValue({ id: 'acct-max', credentials: { accessToken: 'MAX:TOKEN' } });
  mockGetAdapterOrThrow.mockReturnValue({ sendBroadcast: mockSendBroadcast });
  mockPauseMax.mockResolvedValue(undefined);
});

// ─── CAS double-send protection ──────────────────────────────────────────────

describe('sendToRecipientMax — CAS double-send protection', () => {
  it('skips without sending when the row is not claimable (0 rows)', async () => {
    routeQueries({ claimRows: [] });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('skipped');
    expect(mockSendBroadcast).not.toHaveBeenCalled();
    expect(mockPauseMax).not.toHaveBeenCalled();
  });
});

// ─── success ────────────────────────────────────────────────────────────────

describe('sendToRecipientMax — success', () => {
  it('marks sent with external_message_id on adapter success', async () => {
    routeQueries();
    mockSendBroadcast.mockResolvedValue({ success: true, externalMessageId: 'max:777' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('sent');
    expect(mockSendBroadcast).toHaveBeenCalledTimes(1);
    const args = mockSendBroadcast.mock.calls[0];
    expect(args[1]).toBe('138553724'); // chatId
    expect(args[2]).toBe('https://cdn/x.jpg'); // mediaUrl
    expect(args[3]).toBe('Привет!'); // caption
    const sentUpdate = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'sent'"));
    expect(sentUpdate).toBeTruthy();
  });

  it('builds MAX keyboard: per-recipient UTM link row + fixed callback rows', async () => {
    routeQueries({
      claimRows: [{ ...RECIPIENT, payload_snapshot: { text: 'hi', mediaUrl: 'https://cdn/x.jpg', buttons: [[{ text: 'Открыть', url: 'https://svoefoto.ru/pechat' }]] } }],
    });
    mockSendBroadcast.mockResolvedValue({ success: true, externalMessageId: 'max:1' });

    await sendToRecipientMax('rcpt-1');

    const keyboard = mockSendBroadcast.mock.calls[0][4] as Array<Array<{ type: string; text: string; url?: string; payload?: string }>>;
    // Row 0 = payload link-button(s); Row 1 = «Наши адреса»; Row 2 = (not-student + unsubscribe).
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0][0].type).toBe('link');
    const url = keyboard[0][0].url!;
    expect(url).toContain('utm_content=contact-1');
    expect(url).toContain('campaign_id=camp-1');
    expect(url).toContain('utm_source=max');
    // utm_term = external_chat_id (direct in the click record).
    expect(url).toContain('utm_term=138553724');
    expect(keyboard[1][0].type).toBe('callback');
    expect(keyboard[1][0].payload).toBe('bcast_addresses');
    expect(keyboard[2][0].payload).toBe('bcast_not_student');
    expect(keyboard[2][1].payload).toBe('bcast_unsub');
  });
});

// ─── 429 fixed 30s backpressure ───────────────────────────────────────────────

describe('sendToRecipientMax — 429 rate limit', () => {
  it('pauses the MAX token for a FIXED 30s, leaves row queued, returns rate_limited (attempt NOT consumed)', async () => {
    routeQueries();
    // MAX never returns retryAfter — the pause must be the explicit 30s, not 1s.
    mockSendBroadcast.mockResolvedValue({ success: false, errorCode: '429', errorMessage: 'Too Many Requests' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('rate_limited');
    expect(out.retryAfterMs).toBe(30000);
    expect(mockPauseMax).toHaveBeenCalledWith('MAX:TOKEN', 30000);
    // row left 'queued', NOT failed; attempts NOT bumped
    const requeue = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'queued'") && String(sql).includes('next_attempt_at'));
    expect(requeue).toBeTruthy();
    const failedWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'"));
    expect(failedWrite).toBeFalsy();
  });
});

// ─── 403 blocked → suppression (CONSERVATIVE) ─────────────────────────────────

describe('sendToRecipientMax — 403 blocked', () => {
  it('marks blocked and inserts a suppression (in one transaction) on 403', async () => {
    const txClientCalls: string[] = [];
    routeQueries();
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = { query: vi.fn(async (sql: string) => { txClientCalls.push(sql); return { rows: [], rowCount: 0 }; }) };
      return fn(client);
    });
    mockSendBroadcast.mockResolvedValue({ success: false, errorCode: '403', errorMessage: 'Forbidden' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('blocked');
    expect(txClientCalls.some((s) => s.includes("status = 'blocked'"))).toBe(true);
    expect(txClientCalls.some((s) => s.includes('INSERT INTO marketing_suppressions'))).toBe(true);
    expect(mockPauseMax).not.toHaveBeenCalled();
  });

  it('does NOT treat a non-403 "chat not found"-style message as blocked (conservative classifier)', async () => {
    routeQueries(); // RECIPIENT.attempts=0, max=3 → 400 is terminal failed, NOT blocked
    mockSendBroadcast.mockResolvedValue({ success: false, errorCode: '400', errorMessage: 'chat not found' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('failed');
    // no suppression insert (conservative: only 403 suppresses)
    const suppressWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO marketing_suppressions'));
    expect(suppressWrite).toBeFalsy();
  });
});

// ─── 4xx terminal ─────────────────────────────────────────────────────────────

describe('sendToRecipientMax — terminal 4xx', () => {
  it('marks failed permanently (next_attempt_at NULL) on a non-429/403 4xx', async () => {
    routeQueries();
    mockSendBroadcast.mockResolvedValue({ success: false, errorCode: '400', errorMessage: 'Bad Request' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('failed');
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
  });
});

// ─── 5xx retryable ────────────────────────────────────────────────────────────

describe('sendToRecipientMax — retryable failure', () => {
  it('marks failed with backoff next_attempt_at when attempts remain (5xx)', async () => {
    routeQueries(); // RECIPIENT.attempts=0, max=3 → retryable
    mockSendBroadcast.mockResolvedValue({ success: false, errorCode: '502', errorMessage: 'Bad Gateway' });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('failed');
    const retryWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'") && String(sql).includes('next_attempt_at = now()'));
    expect(retryWrite).toBeTruthy();
    expect(mockPauseMax).not.toHaveBeenCalled();
  });

  it('fails permanently (no retry) when the payload has no mediaUrl', async () => {
    routeQueries({ claimRows: [{ ...RECIPIENT, payload_snapshot: { text: 'x', mediaUrl: null, buttons: null } }] });

    const out = await sendToRecipientMax('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockSendBroadcast).not.toHaveBeenCalled();
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
  });
});
