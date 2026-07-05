import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for campaign.service (Telegram broadcast send-engine).
 *
 * DB is mocked with a SQL-text router (the service runs several sequential queries per
 * send, so order-based mockResolvedValueOnce is too brittle). Adapter, account-store and
 * governor are mocked to assert classification + double-send protection without a network.
 *
 * The live test-gate (flavrinov-only on real DB) is covered separately, not here.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const {
  mockQuery,
  mockQueryOne,
  mockTransaction,
  mockSendMedia,
  mockGetAccountByChannel,
  mockGetAdapterOrThrow,
  mockPauseBot,
} = vi.hoisted(() => {
  const sendMedia = vi.fn();
  return {
    mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
    mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
    mockTransaction: vi.fn(),
    mockSendMedia: sendMedia,
    mockGetAccountByChannel: vi.fn().mockResolvedValue({
      id: 'acct-1',
      credentials: { botToken: 'BOT:TOKEN' },
    }),
    mockGetAdapterOrThrow: vi.fn(() => ({ sendMedia })),
    mockPauseBot: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../database/db.js', () => ({
  default: {
    query: mockQuery,
    queryOne: mockQueryOne,
    transaction: mockTransaction,
  },
}));

vi.mock('./broadcast-governor.js', () => ({
  pauseBot: mockPauseBot,
  isBotPaused: vi.fn().mockResolvedValue(false),
  getBotPauseMs: vi.fn().mockResolvedValue(0),
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

const {
  sendToRecipient,
  claimDispatchableRecipients,
  getCampaignStats,
  materializeRecipients,
} = await import('./campaign.service.js');

// ─── Helpers ───────────────────────────────────────────────────────────────

const RECIPIENT = {
  id: 'rcpt-1',
  contact_id: 'contact-1',
  external_chat_id: '1020685867',
  personalized_url: 'https://svoefoto.ru/?utm_content=contact-1',
  payload_snapshot: { text: 'Привет!', mediaUrl: 'https://cdn/x.jpg', buttons: null },
  attempts: 0,
  max_attempts: 3,
};

const CAMPAIGN_UTM = {
  id: 'camp-1',
  utm_source: 'telegram',
  utm_medium: 'bot',
  utm_campaign: 'edu-print',
};

/**
 * Route mockQuery by SQL fragment. `claimRows` controls the CAS-lease UPDATE result
 * (the double-send guard): [] = not claimable, [RECIPIENT] = claimed.
 */
function routeQueries(opts: { claimRows?: unknown[]; statsRows?: unknown[]; claimDispatch?: unknown[] } = {}) {
  const claimRows = opts.claimRows ?? [RECIPIENT];
  mockQuery.mockImplementation(async (sql: string) => {
    // CAS lease claim in sendToRecipient (sets next_attempt_at, RETURNING recipient row)
    if (sql.includes('SET next_attempt_at') && sql.includes("status IN ('queued','failed')") && sql.includes('RETURNING')) {
      return claimRows;
    }
    // stats GROUP BY status
    if (sql.includes('GROUP BY status')) {
      return opts.statsRows ?? [];
    }
    // any UPDATE/INSERT outcome writes → return []
    return [];
  });
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('mc.utm_source')) return CAMPAIGN_UTM;
    return null;
  });
  // transaction: run the callback with a client whose query routes the same way but returns {rows}
  mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, idempotency_key') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return { rows: opts.claimDispatch ?? [], rowCount: (opts.claimDispatch ?? []).length };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    return fn(client);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMedia.mockReset();
  mockGetAccountByChannel.mockResolvedValue({ id: 'acct-1', credentials: { botToken: 'BOT:TOKEN' } });
  mockGetAdapterOrThrow.mockReturnValue({ sendMedia: mockSendMedia });
  mockPauseBot.mockResolvedValue(undefined);
});

// ─── sendToRecipient: double-send protection (CAS) ───────────────────────────

describe('sendToRecipient — CAS double-send protection', () => {
  it('skips without sending when the row is not claimable (0 rows)', async () => {
    routeQueries({ claimRows: [] });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('skipped');
    expect(mockSendMedia).not.toHaveBeenCalled();
    expect(mockPauseBot).not.toHaveBeenCalled();
  });

  it('sends exactly once when claimed; a second concurrent claim (0 rows) does not re-send', async () => {
    // First call: claimable → sends. Second call: not claimable → skip.
    let claimable = true;
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SET next_attempt_at') && sql.includes('RETURNING')) {
        if (claimable) { claimable = false; return [RECIPIENT]; }
        return [];
      }
      return [];
    });
    mockQueryOne.mockResolvedValue(CAMPAIGN_UTM);
    mockSendMedia.mockResolvedValue({ success: true, externalMessageId: 'tg:55' });

    const first = await sendToRecipient('rcpt-1');
    const second = await sendToRecipient('rcpt-1');

    expect(first.status).toBe('sent');
    expect(second.status).toBe('skipped');
    expect(mockSendMedia).toHaveBeenCalledTimes(1);
  });
});

// ─── sendToRecipient: success ────────────────────────────────────────────────

describe('sendToRecipient — success', () => {
  it('marks sent with external_message_id on adapter success', async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: true, externalMessageId: 'tg:777' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('sent');
    expect(mockSendMedia).toHaveBeenCalledTimes(1);
    // sendMedia called with 8 args incl. inlineKeyboard (always ≥1 row — the callback row)
    const args = mockSendMedia.mock.calls[0];
    expect(args[1]).toBe('1020685867'); // chatId
    expect(args[2]).toBe('https://cdn/x.jpg'); // mediaUrl
    expect(args[3]).toBe('image');
    expect(args[4]).toBe('Привет!'); // caption
    // a 'sent' UPDATE was issued
    const sentUpdate = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'sent'"));
    expect(sentUpdate).toBeTruthy();
  });

  it('appends per-recipient UTM to inline buttons', async () => {
    routeQueries({
      claimRows: [{ ...RECIPIENT, payload_snapshot: { text: 'hi', mediaUrl: 'https://cdn/x.jpg', buttons: [[{ text: 'Открыть', url: 'https://svoefoto.ru/pechat' }]] } }],
    });
    mockSendMedia.mockResolvedValue({ success: true, externalMessageId: 'tg:1' });

    await sendToRecipient('rcpt-1');

    const keyboard = mockSendMedia.mock.calls[0][7] as Array<Array<{ text: string; url?: string; callback_data?: string }>>;
    // Row 0 = payload URL-button(s); Row 1 = «Наши адреса»; Row 2 = (not-student + unsubscribe).
    expect(keyboard).toHaveLength(3);
    const url = keyboard[0][0].url;
    expect(url).toContain('utm_content=contact-1');
    expect(url).toContain('campaign_id=camp-1');
    expect(url).toContain('utm_source=telegram');
    // B: raw telegram id available directly in the click record via utm_term=<chat_id>.
    expect(url).toContain('utm_term=1020685867');
    // D: structural callback rows — addresses, then not-student + unsubscribe.
    expect(keyboard[1][0].callback_data).toBe('bcast_addresses');
    expect(keyboard[2][0].callback_data).toBe('bcast_not_student');
    expect(keyboard[2][1].callback_data).toBe('bcast_unsub');
  });
});

// ─── sendToRecipient: 429 global backpressure ────────────────────────────────

describe('sendToRecipient — 429 rate limit', () => {
  it('pauses the bot token, leaves row queued, returns rate_limited without consuming attempt', async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '429', errorMessage: 'Too Many Requests', retryAfter: 7 });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('rate_limited');
    expect(out.retryAfterMs).toBe(7000);
    expect(mockPauseBot).toHaveBeenCalledWith('BOT:TOKEN', 7000);
    // row left 'queued', NOT failed; attempts NOT bumped
    const requeue = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'queued'") && String(sql).includes('next_attempt_at'));
    expect(requeue).toBeTruthy();
    const failedWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'"));
    expect(failedWrite).toBeFalsy();
  });

  it('caps the pause at 30s for a hostile retry_after', async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '429', errorMessage: 'slow down', retryAfter: 9999 });

    const out = await sendToRecipient('rcpt-1');

    expect(out.retryAfterMs).toBe(30000);
    expect(mockPauseBot).toHaveBeenCalledWith('BOT:TOKEN', 30000);
  });
});

// ─── sendToRecipient: 403 blocked → suppression ──────────────────────────────

describe('sendToRecipient — 403 blocked', () => {
  it('marks blocked and inserts a suppression (in one transaction) on 403', async () => {
    const txClientCalls: string[] = [];
    routeQueries();
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = { query: vi.fn(async (sql: string) => { txClientCalls.push(sql); return { rows: [], rowCount: 0 }; }) };
      return fn(client);
    });
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '403', errorMessage: 'Forbidden: bot was blocked by the user' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('blocked');
    expect(txClientCalls.some((s) => s.includes("status = 'blocked'"))).toBe(true);
    expect(txClientCalls.some((s) => s.includes('INSERT INTO marketing_suppressions'))).toBe(true);
    expect(mockPauseBot).not.toHaveBeenCalled();
  });

  it('classifies a "chat not found" message as blocked even without 403 code', async () => {
    const txClientCalls: string[] = [];
    routeQueries();
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = { query: vi.fn(async (sql: string) => { txClientCalls.push(sql); return { rows: [], rowCount: 0 }; }) };
      return fn(client);
    });
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '400', errorMessage: 'Bad Request: chat not found' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('blocked');
    expect(txClientCalls.some((s) => s.includes('INSERT INTO marketing_suppressions'))).toBe(true);
  });
});

// ─── sendToRecipient: 5xx retryable ──────────────────────────────────────────

describe('sendToRecipient — retryable failure', () => {
  it('marks failed with backoff next_attempt_at when attempts remain', async () => {
    routeQueries(); // RECIPIENT.attempts=0, max=3 → retryable
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '502', errorMessage: 'Bad Gateway' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    const retryWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'") && String(sql).includes('next_attempt_at = now()'));
    expect(retryWrite).toBeTruthy();
    expect(mockPauseBot).not.toHaveBeenCalled();
  });

  it('marks terminal failed (next_attempt_at NULL) once attempts are exhausted', async () => {
    routeQueries({ claimRows: [{ ...RECIPIENT, attempts: 2, max_attempts: 3 }] });
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '500', errorMessage: 'Internal Error' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
  });

  it('fails permanently (no retry) when the payload has no mediaUrl', async () => {
    routeQueries({ claimRows: [{ ...RECIPIENT, payload_snapshot: { text: 'x', mediaUrl: null, buttons: null } }] });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    expect(mockSendMedia).not.toHaveBeenCalled();
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
  });
});

// ─── sendToRecipient: non-429 4xx is terminal (no retry storm) ───────────────

describe('sendToRecipient — terminal 4xx (non-429)', () => {
  it('marks a 400 (no blocked markers) as terminal failed WITHOUT scheduling a retry', async () => {
    routeQueries(); // attempts=0, max=3 → would be retryable if 5xx
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '400', errorMessage: 'Bad Request: message text is empty' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    // terminal: next_attempt_at NULL (never retried), NOT a backoff schedule
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
    const backoffWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'") && String(sql).includes('next_attempt_at = now()'));
    expect(backoffWrite).toBeFalsy();
    expect(mockPauseBot).not.toHaveBeenCalled();
  });

  it('marks a 401 (bad token) as terminal failed — does not burn the rate-domain on retries', async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '401', errorMessage: 'Unauthorized' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    const terminalWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes('next_attempt_at = NULL'));
    expect(terminalWrite).toBeTruthy();
  });

  it('still retries a 5xx (server-side, transient) with backoff', async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: false, errorCode: '503', errorMessage: 'Service Unavailable' });

    const out = await sendToRecipient('rcpt-1');

    expect(out.status).toBe('failed');
    const backoffWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'failed'") && String(sql).includes('next_attempt_at = now()'));
    expect(backoffWrite).toBeTruthy();
  });
});

// ─── sendToRecipient: success write-once guard ───────────────────────────────

describe('sendToRecipient — success guard (external_message_id IS NULL)', () => {
  it("stamps 'sent' with a guard so a stalled-reclaim cannot overwrite/duplicate the delivery", async () => {
    routeQueries();
    mockSendMedia.mockResolvedValue({ success: true, externalMessageId: 'tg:900' });

    await sendToRecipient('rcpt-1');

    const sentWrite = mockQuery.mock.calls.find(([sql]) => String(sql).includes("status = 'sent'"));
    expect(sentWrite).toBeTruthy();
    // write-once guard present
    expect(String(sentWrite![0])).toContain('external_message_id IS NULL');
  });
});

// ─── claimDispatchableRecipients ─────────────────────────────────────────────

describe('claimDispatchableRecipients', () => {
  it('maps claimed rows to {id, idempotencyKey} using FOR UPDATE SKIP LOCKED', async () => {
    routeQueries({ claimDispatch: [{ id: 'r1', idempotency_key: 'camp:1:c1' }, { id: 'r2', idempotency_key: 'camp:1:c2' }] });

    const out = await claimDispatchableRecipients('camp-1', 500);

    expect(out).toEqual([
      { id: 'r1', idempotencyKey: 'camp:1:c1' },
      { id: 'r2', idempotencyKey: 'camp:1:c2' },
    ]);
  });
});

// ─── getCampaignStats ─────────────────────────────────────────────────────────

describe('getCampaignStats', () => {
  it('builds the funnel with sent/block rates and ETA from queued backlog', async () => {
    routeQueries({
      statsRows: [
        { status: 'sent', cnt: 60 },
        { status: 'blocked', cnt: 10 },
        { status: 'queued', cnt: 25 },
        { status: 'skipped', cnt: 5 },
      ],
    });

    const stats = await getCampaignStats('camp-1');

    expect(stats.total).toBe(100);
    expect(stats.byStatus).toEqual({ sent: 60, blocked: 10, queued: 25, skipped: 5 });
    expect(stats.sentRate).toBeCloseTo(0.6, 5);
    expect(stats.blockRate).toBeCloseTo(0.1, 5);
    expect(stats.etaSeconds).toBe(5); // ceil(25/5)
  });

  it('returns zero rates and null ETA for an empty campaign', async () => {
    routeQueries({ statsRows: [] });

    const stats = await getCampaignStats('camp-empty');

    expect(stats.total).toBe(0);
    expect(stats.sentRate).toBe(0);
    expect(stats.blockRate).toBe(0);
    expect(stats.etaSeconds).toBeNull();
  });
});

// ─── materializeRecipients (mock-level structure) ────────────────────────────

describe('materializeRecipients', () => {
  it('runs in one transaction and returns inserted/suppressed/skipped counts', async () => {
    let header: unknown;
    const calls: string[] = [];
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          calls.push(sql);
          if (sql.includes('FROM marketing_campaigns') && sql.includes('broadcast_payload')) {
            // header load
            return { rows: [{ id: 'camp-1', test_mode: true, allowed_contact_ids: ['contact-1'], utm_source: 'telegram', utm_medium: 'bot', utm_campaign: 'edu', broadcast_payload: { text: 'hi', mediaUrl: 'https://cdn/x.jpg' } }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO campaign_recipients') && sql.includes("'queued'")) {
            return { rows: [], rowCount: 1 }; // 1 inserted dispatchable
          }
          if (sql.includes('GROUP BY status')) {
            return { rows: [{ status: 'suppressed', cnt: 2 }, { status: 'skipped', cnt: 3 }], rowCount: 2 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };
      header = await fn(client);
      return header;
    });

    const res = await materializeRecipients('camp-1');

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ inserted: 1, suppressed: 2, skipped: 3 });
    // P0-1: dispatchable INSERT anchors on marketing_campaigns (header in FROM)
    const dispatchableInsert = calls.find((s) => s.includes('INSERT INTO campaign_recipients') && s.includes("'queued'"));
    expect(dispatchableInsert).toContain('FROM marketing_campaigns mc');
    expect(dispatchableInsert).toContain('WHERE mc.id = $1');
    // test-gate present
    expect(dispatchableInsert).toContain('NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids)');
  });

  it('throws when the campaign header is missing', async () => {
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
      return fn(client);
    });

    await expect(materializeRecipients('missing')).rejects.toThrow(/not found/i);
  });
});
