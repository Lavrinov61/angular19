import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the read-side / create helpers added to campaign.service for the operator
 * pult (list / create / recipients / go-live). DB is mocked with a SQL-text router (same
 * approach as campaign.service.test.ts) so we assert query shape + invariants without a DB.
 *
 * Security focus: createBroadcastCampaign must HARD-FORCE test_mode=true regardless of input;
 * listBroadcastCampaigns must filter channel='telegram'; setCampaignLive only flips telegram.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
  mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
}));

vi.mock('../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne, transaction: vi.fn() },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('./broadcast-governor.js', () => ({ pauseBot: vi.fn(), isBotPaused: vi.fn(), getBotPauseMs: vi.fn() }));
vi.mock('../connectors/core/account-store.js', () => ({ getAccountByChannel: vi.fn() }));
vi.mock('../connectors/core/adapter-registry.js', () => ({ getAdapterOrThrow: vi.fn() }));

const {
  listBroadcastCampaigns,
  createBroadcastCampaign,
  getCampaignRecipients,
  setCampaignLive,
} = await import('./campaign.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue(null);
});

// ─── listBroadcastCampaigns ──────────────────────────────────────────────────

describe('listBroadcastCampaigns', () => {
  it('filters channel to the messenger channels and shapes each item with a funnel', async () => {
    let captured = '';
    mockQuery.mockImplementation(async (sql: string) => {
      captured = sql;
      return [{
        id: 'camp-1', name: 'Студенты', status: 'active', test_mode: true,
        allowed_count: 1, created_at: new Date('2026-05-31T11:33:09.988Z'),
        channel: 'telegram',
        queued: 0, sent: 1, failed: 0, blocked: 0, skipped: 0, suppressed: 0, total: 1,
      }];
    });

    const out = await listBroadcastCampaigns();

    // R3: list scoped to the messenger channels (telegram|max) so CRM flyer/email
    // campaigns never surface; CRM channels (print/digital/...) are excluded.
    expect(captured).toContain('WHERE mc.channel = ANY(');
    expect(captured).toContain("'telegram'");
    expect(captured).toContain("'max'");
    expect(captured).toContain('count(*) FILTER (WHERE status =');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'camp-1', name: 'Студенты', status: 'active', test_mode: true, allowed_count: 1,
      created_at: '2026-05-31T11:33:09.988Z',
      funnel: { queued: 0, sent: 1, failed: 0, blocked: 0, skipped: 0, suppressed: 0, total: 1 },
    });
  });

  it('returns an empty array when there are no telegram campaigns', async () => {
    mockQuery.mockResolvedValue([]);
    expect(await listBroadcastCampaigns()).toEqual([]);
  });
});

// ─── createBroadcastCampaign — test_mode is HARD-FORCED ──────────────────────

describe('createBroadcastCampaign — security invariants', () => {
  it('INSERTs with test_mode hard-forced true, campaign_type=messenger, status=draft, channel defaulting to telegram', async () => {
    let sql = '';
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (q: string, p?: unknown[]) => {
      sql = q; params = p ?? [];
      return { id: 'new-id' };
    });

    const out = await createBroadcastCampaign(
      { name: 'Тест', payload: { text: 'hi', mediaUrl: 'https://cdn/x.jpg' }, allowedContactIds: ['e7652775-493f-4162-a123-e42a92d43340'] },
      'user-1',
    );

    expect(out).toEqual({ id: 'new-id' });
    // R1: test_mode literal true is in the SQL, never a bound param — cannot be overridden.
    expect(sql).toContain("'draft', true");
    // campaign_type is a server-set literal; channel is a bound param ($9), derived by the caller
    // (invariant P1-1) and defaulting to 'telegram' here — TG behaviour is byte-for-byte preserved.
    expect(sql).toContain("'messenger'");
    expect(sql).toContain('$9, ');
    expect(sql).toContain('RETURNING id');
    // bound params: name, allowed[], payload-json, utm×3, userId, audience_filter, channel
    expect(params[0]).toBe('Тест');
    expect(params[1]).toEqual(['e7652775-493f-4162-a123-e42a92d43340']);
    expect(String(params[2])).toContain('mediaUrl');
    expect(params[6]).toBe('user-1');
    expect(params[8]).toBe('telegram');
  });

  it('binds channel=max when the caller passes it (audience-derived channel column)', async () => {
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (_q: string, p?: unknown[]) => { params = p ?? []; return { id: 'x' }; });

    await createBroadcastCampaign(
      { name: 'MAX', payload: {}, audienceFilter: { channel: 'max' } },
      'user-1',
      'max',
    );

    expect(params[8]).toBe('max');
  });

  it('binds allowed_contact_ids = NULL when none are provided (audience = test-gate empty)', async () => {
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (_q: string, p?: unknown[]) => { params = p ?? []; return { id: 'x' }; });

    await createBroadcastCampaign({ name: 'N', payload: {} }, null);

    expect(params[1]).toBeNull();
    expect(params[6]).toBeNull(); // created_by NULL ok
  });

  it('throws when the INSERT returns no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(createBroadcastCampaign({ name: 'N', payload: {} }, 'u')).rejects.toThrow(/create/i);
  });
});

// ─── getCampaignRecipients — FDW click join + pagination ─────────────────────

describe('getCampaignRecipients', () => {
  it('returns items + total and scopes the FDW click join to the campaign utm_campaign', async () => {
    let recipientsSql = '';
    let recipientsParams: unknown[] = [];
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('count(*)')) return { total: 1 };
      if (sql.includes('utm_campaign')) return { utm_campaign: 'student3' }; // P2-scope discriminator
      return null;
    });
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      recipientsSql = sql;
      recipientsParams = params ?? [];
      return [{
        id: 'r1', contact_id: 'c1', contact_name: 'Пользователь 8448', status: 'sent',
        error_code: null, error_detail: null, sent_at: new Date('2026-05-31T11:34:04.395Z'),
        clicked: true, clicked_at: new Date('2026-05-31T10:30:14.587Z'),
      }];
    });

    const page = await getCampaignRecipients('45f0eb5c-2690-4ed1-8a90-02a0869c1594', { limit: 100, offset: 0 });

    // FDW cross-DB join on utm_content = contact_id::text (clicks-upload §A).
    expect(recipientsSql).toContain('mp_fdw.ad_clicks');
    expect(recipientsSql).toContain('ac.utm_content = cr.contact_id::text');
    // P2: click MUST be scoped to THIS campaign's utm_campaign (bound param $4), not any click.
    expect(recipientsSql).toContain('ac.utm_campaign = $4');
    expect(recipientsParams[3]).toBe('student3');
    expect(recipientsSql).toContain('LIMIT $2 OFFSET $3');
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 'r1', contact_id: 'c1', contact_name: 'Пользователь 8448', status: 'sent',
      clicked: true, sent_at: '2026-05-31T11:34:04.395Z', clicked_at: '2026-05-31T10:30:14.587Z',
    });
  });

  it('passes NULL utm_campaign param when the campaign has no utm_campaign (no click can match)', async () => {
    let recipientsParams: unknown[] = [];
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('count(*)')) return { total: 1 };
      if (sql.includes('utm_campaign')) return { utm_campaign: null };
      return null;
    });
    mockQuery.mockImplementation(async (_sql: string, params?: unknown[]) => {
      recipientsParams = params ?? [];
      return [];
    });

    await getCampaignRecipients('camp', { limit: 50, offset: 0 });

    expect(recipientsParams[3]).toBeNull();
  });

  it('reports clicked=false when there is no matching click row', async () => {
    mockQueryOne.mockResolvedValue({ total: 1 });
    mockQuery.mockResolvedValue([{
      id: 'r2', contact_id: 'c2', contact_name: null, status: 'queued',
      error_code: null, error_detail: null, sent_at: null, clicked: false, clicked_at: null,
    }]);

    const page = await getCampaignRecipients('camp', { limit: 100, offset: 0 });

    expect(page.items[0].clicked).toBe(false);
    expect(page.items[0].clicked_at).toBeNull();
    expect(page.items[0].sent_at).toBeNull();
  });
});

// ─── setCampaignLive — single explicit go-live path ──────────────────────────

describe('setCampaignLive', () => {
  it('flips test_mode=false guarded to the messenger channels and returns the post-flip flag', async () => {
    let sql = '';
    mockQueryOne.mockImplementation(async (q: string) => { sql = q; return { id: 'camp-1', test_mode: false }; });

    const out = await setCampaignLive('camp-1');

    expect(sql).toContain('SET test_mode = false');
    // guarded to channel IN (telegram|max) so it never touches a CRM campaign; the test_mode
    // gate itself is unchanged — this audited step stays the only path out of test mode.
    expect(sql).toContain('channel = ANY(');
    expect(sql).toContain("'telegram'");
    expect(sql).toContain("'max'");
    expect(out).toEqual({ id: 'camp-1', test_mode: false });
  });

  it('throws when the campaign is missing or not a messenger broadcast (0 rows updated)', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(setCampaignLive('missing')).rejects.toThrow(/not found/i);
  });
});
