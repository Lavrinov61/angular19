import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the audience-segmentation additions to campaign.service:
 *   normalizeAudienceFilter (trust boundary), previewAudience (COUNT predicate),
 *   getSegmentOptions (services + per-channel counts), createBroadcastCampaign (stores
 *   audience_filter), materializeRecipients (applies the SAME predicate in both passes).
 *
 * DB is mocked with a SQL-text router (mirrors campaign.service.readside.test.ts). The
 * load-bearing invariant under test: previewAudience and materializeRecipients pass-1 bind
 * the SAME channel/serviceSlugs/recency params (so the counted number == the fanned-out set).
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const { mockQuery, mockQueryOne, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
  mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
  mockTransaction: vi.fn(),
}));

vi.mock('../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne, transaction: mockTransaction },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('./broadcast-governor.js', () => ({ pauseBot: vi.fn(), isBotPaused: vi.fn(), getBotPauseMs: vi.fn() }));
vi.mock('../connectors/core/account-store.js', () => ({ getAccountByChannel: vi.fn() }));
vi.mock('../connectors/core/adapter-registry.js', () => ({ getAdapterOrThrow: vi.fn() }));

const {
  normalizeAudienceFilter,
  previewAudience,
  getSegmentOptions,
  createBroadcastCampaign,
  materializeRecipients,
  listBroadcastCampaigns,
  ALLOWED_CHANNELS,
} = await import('./campaign.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue(null);
});

// ─── normalizeAudienceFilter — trust boundary ────────────────────────────────

describe('normalizeAudienceFilter', () => {
  it('accepts a channel-only filter', () => {
    expect(normalizeAudienceFilter({ channel: 'telegram' })).toEqual({ channel: 'telegram' });
  });

  it('accepts channel + serviceSlugs + recencyDays', () => {
    const out = normalizeAudienceFilter({
      channel: 'telegram', serviceSlugs: ['document_photo', 'copy'], recencyDays: 30,
    });
    expect(out).toEqual({ channel: 'telegram', serviceSlugs: ['document_photo', 'copy'], recencyDays: 30 });
  });

  it('rejects an unknown channel', () => {
    expect(() => normalizeAudienceFilter({ channel: 'sms' })).toThrow(/channel/i);
  });

  it('rejects a non-object', () => {
    expect(() => normalizeAudienceFilter(null)).toThrow();
    expect(() => normalizeAudienceFilter('telegram')).toThrow();
    expect(() => normalizeAudienceFilter(['telegram'])).toThrow();
  });

  it('rejects a slug that violates the slug grammar (SQLi guard)', () => {
    expect(() => normalizeAudienceFilter({ channel: 'telegram', serviceSlugs: ["x'; DROP TABLE contacts;--"] }))
      .toThrow(/slug/i);
    expect(() => normalizeAudienceFilter({ channel: 'telegram', serviceSlugs: ['Has Space'] })).toThrow(/slug/i);
  });

  it('drops an empty serviceSlugs array (treated as "any service")', () => {
    expect(normalizeAudienceFilter({ channel: 'telegram', serviceSlugs: [] })).toEqual({ channel: 'telegram' });
  });

  it('rejects recencyDays outside 1..365', () => {
    expect(() => normalizeAudienceFilter({ channel: 'telegram', recencyDays: 0 })).toThrow(/recency/i);
    expect(() => normalizeAudienceFilter({ channel: 'telegram', recencyDays: 366 })).toThrow(/recency/i);
    expect(() => normalizeAudienceFilter({ channel: 'telegram', recencyDays: 1.5 })).toThrow(/recency/i);
    expect(() => normalizeAudienceFilter({ channel: 'telegram', recencyDays: -7 })).toThrow(/recency/i);
  });

  it('accepts recencyDays at the boundaries', () => {
    expect(normalizeAudienceFilter({ channel: 'max', recencyDays: 1 }).recencyDays).toBe(1);
    expect(normalizeAudienceFilter({ channel: 'vk', recencyDays: 365 }).recencyDays).toBe(365);
  });

  it('exposes exactly the channel_type enum values', () => {
    expect([...ALLOWED_CHANNELS].sort()).toEqual(
      ['email', 'instagram', 'max', 'telegram', 'vk', 'web', 'whatsapp'],
    );
  });
});

// ─── previewAudience — COUNT with the shared predicate ───────────────────────

describe('previewAudience', () => {
  it('counts DISTINCT contacts and binds channel/serviceSlugs/recency as params (no interpolation)', async () => {
    let sql = '';
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (q: string, p?: unknown[]) => {
      sql = q; params = p ?? [];
      return { cnt: 95 };
    });

    const out = await previewAudience({ channel: 'telegram', serviceSlugs: ['document_photo', 'copy'], recencyDays: 30 });

    expect(out).toEqual({ count: 95 });
    expect(sql).toContain('count(DISTINCT c.id)');
    // channel is cast to the enum (rejects garbage at PG level) — bound, never concatenated.
    expect(sql).toContain('channel = $1::channel_type');
    expect(sql).toContain('s.contact_id IS NULL');                       // not suppressed
    expect(sql).toContain('c.deleted_at IS NULL');                       // not deleted
    expect(sql).toContain('external_chat_id IS NOT NULL');               // запускал бота (CRM-статус неважен)
    expect(sql).not.toContain("status <> 'closed'");                     // closed-диалоги НЕ исключаем
    expect(sql).toContain('c.primary_service_slug = ANY($2::text[])');   // service ∈ slugs
    expect(sql).toContain("($3::text || ' days')::interval");            // recency
    expect(params[0]).toBe('telegram');
    expect(params[1]).toEqual(['document_photo', 'copy']);
    expect(params[2]).toBe('30');                                        // bound as text, cast to interval
  });

  it('binds NULL for serviceSlugs/recency when absent (any service, any recency)', async () => {
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (_q: string, p?: unknown[]) => { params = p ?? []; return { cnt: 349 }; });

    const out = await previewAudience({ channel: 'telegram' });

    expect(out).toEqual({ count: 349 });
    expect(params[0]).toBe('telegram');
    expect(params[1]).toBeNull();
    expect(params[2]).toBeNull();
  });

  it('returns 0 when the query yields no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await previewAudience({ channel: 'max' })).toEqual({ count: 0 });
  });
});

// ─── getSegmentOptions ───────────────────────────────────────────────────────

describe('getSegmentOptions', () => {
  it('returns per-channel counts + selectable services (excluding not_determined/none)', async () => {
    const sqls: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('unnest($1::channel_type[])')) {
        return [
          { channel: 'max', cnt: 408 },
          { channel: 'telegram', cnt: 349 },
        ];
      }
      // services aggregate
      return [
        { slug: 'document_photo', label: 'А4 фото-документ', cnt: 121 },
        { slug: 'copy', label: null, cnt: 91 },
      ];
    });

    const out = await getSegmentOptions('telegram');

    expect(out.channels).toEqual([
      { channel: 'max', count: 408 },
      { channel: 'telegram', count: 349 },
    ]);
    // label falls back to slug when NULL.
    expect(out.services).toEqual([
      { slug: 'document_photo', label: 'А4 фото-документ', count: 121 },
      { slug: 'copy', label: 'copy', count: 91 },
    ]);
    const servicesSql = sqls.find((s) => s.includes('primary_service_slug NOT IN'));
    expect(servicesSql).toContain("NOT IN ('not_determined', 'none')");
    expect(servicesSql).toContain('channel = $1::channel_type');
  });

  it('falls back to telegram for an unknown channel param', async () => {
    let serviceParams: unknown[] = [];
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('primary_service_slug NOT IN')) serviceParams = params ?? [];
      return [];
    });

    await getSegmentOptions('definitely-not-a-channel');

    expect(serviceParams[0]).toBe('telegram');
  });
});

// ─── createBroadcastCampaign — stores audience_filter ────────────────────────

describe('createBroadcastCampaign — audience_filter', () => {
  it('binds the audience filter JSON as $8 and keeps test_mode/channel hard-forced', async () => {
    let sql = '';
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (q: string, p?: unknown[]) => { sql = q; params = p ?? []; return { id: 'new-id' }; });

    await createBroadcastCampaign(
      { name: 'Сегмент', payload: { mediaUrl: 'https://cdn/x.jpg' },
        audienceFilter: { channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 } },
      'user-1',
    );

    // R1 intact: literal test_mode=true + campaign_type=messenger in SQL, never params.
    // channel is now a bound param ($9, default 'telegram' here) — TG behaviour unchanged.
    expect(sql).toContain("'draft', true");
    expect(sql).toContain("'messenger'");
    expect(sql).toContain('$9, ');
    expect(sql).toContain('audience_filter');
    expect(sql).toContain('$8::jsonb');
    expect(String(params[7])).toContain('document_photo');
    expect(String(params[7])).toContain('"channel":"telegram"');
    expect(params[6]).toBe('user-1'); // userId still $7 (unchanged position)
  });

  it('binds audience_filter = NULL when no filter is supplied (legacy all-telegram)', async () => {
    let params: unknown[] = [];
    mockQueryOne.mockImplementation(async (_q: string, p?: unknown[]) => { params = p ?? []; return { id: 'x' }; });

    await createBroadcastCampaign({ name: 'N', payload: {} }, null);

    expect(params[7]).toBeNull();
  });
});

// ─── listBroadcastCampaigns — surfaces audience_filter ───────────────────────

describe('listBroadcastCampaigns — audience_filter passthrough', () => {
  it('parses stored audience_filter back into the typed shape', async () => {
    mockQuery.mockResolvedValue([{
      id: 'camp-1', name: 'Сегмент', status: 'draft', test_mode: true, allowed_count: 0,
      created_at: new Date('2026-05-31T11:33:09.988Z'),
      audience_filter: { channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 },
      queued: 0, sent: 0, failed: 0, blocked: 0, skipped: 0, suppressed: 0, total: 0,
    }]);

    const out = await listBroadcastCampaigns();

    expect(out[0].audience_filter).toEqual({
      channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30,
    });
  });

  it('reports audience_filter=null for a legacy (no-filter) campaign', async () => {
    mockQuery.mockResolvedValue([{
      id: 'camp-2', name: 'Legacy', status: 'active', test_mode: false, allowed_count: 0,
      created_at: new Date('2026-05-31T11:33:09.988Z'), audience_filter: null,
      queued: 0, sent: 1, failed: 0, blocked: 0, skipped: 0, suppressed: 0, total: 1,
    }]);

    const out = await listBroadcastCampaigns();
    expect(out[0].audience_filter).toBeNull();
  });
});

// ─── materializeRecipients — same predicate in both passes ───────────────────

describe('materializeRecipients — segment predicate consistency', () => {
  /**
   * Capture every client.query call inside the transaction so we can assert the channel +
   * service + recency params are bound identically to previewAudience in BOTH passes.
   */
  function runWithHeader(audienceFilter: unknown): Promise<{ pass1: { sql: string; params: unknown[] }; pass2: { sql: string; params: unknown[] } }> {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push({ sql, params: params ?? [] });
          if (sql.includes('SELECT id, test_mode, allowed_contact_ids')) {
            return {
              rows: [{
                id: 'camp-1', test_mode: false, allowed_contact_ids: null,
                utm_source: 'telegram', utm_medium: 'bot', utm_campaign: 'seg',
                broadcast_payload: { text: 'hi', mediaUrl: 'https://cdn/x.jpg' },
                audience_filter: audienceFilter,
              }],
              rowCount: 1,
            };
          }
          if (sql.includes('GROUP BY status')) return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 0 };
        }),
      };
      return fn(client);
    });

    return materializeRecipients('camp-1').then(() => {
      const inserts = calls.filter((c) => c.sql.includes('INSERT INTO campaign_recipients'));
      return { pass1: inserts[0], pass2: inserts[1] };
    });
  }

  it('pass-1 binds channel/serviceSlugs/recency from the stored filter', async () => {
    const { pass1 } = await runWithHeader({ channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 });

    // $4 channel / $5 serviceSlugs / $6 recencyDays — mirror previewAudience's $1/$2/$3 values.
    expect(pass1.sql).toContain('channel = $4::channel_type');
    expect(pass1.sql).toContain('c.primary_service_slug = ANY($5::text[])');
    expect(pass1.sql).toContain("($6::text || ' days')::interval");
    expect(pass1.params[3]).toBe('telegram');
    expect(pass1.params[4]).toEqual(['document_photo']);
    expect(pass1.params[5]).toBe('30');
  });

  it('pass-2 (reportable exclusions) uses the SAME channel/serviceSlugs/recency predicate', async () => {
    const { pass2 } = await runWithHeader({ channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 });

    // Pass-2 has no personalized-URL param, so the segment params shift to $3/$4/$5.
    expect(pass2.sql).toContain('channel = $3::channel_type');
    expect(pass2.sql).toContain('c.primary_service_slug = ANY($4::text[])');
    expect(pass2.sql).toContain("($5::text || ' days')::interval");
    expect(pass2.params[2]).toBe('telegram');
    expect(pass2.params[3]).toEqual(['document_photo']);
    expect(pass2.params[4]).toBe('30');
  });

  it('NULL filter → legacy all-telegram (channel telegram, NULL service/recency params)', async () => {
    const { pass1, pass2 } = await runWithHeader(null);

    expect(pass1.params[3]).toBe('telegram');
    expect(pass1.params[4]).toBeNull();
    expect(pass1.params[5]).toBeNull();
    expect(pass2.params[2]).toBe('telegram');
    expect(pass2.params[3]).toBeNull();
    expect(pass2.params[4]).toBeNull();
  });

  it('keeps the test-gate (NOT mc.test_mode OR c.id = ANY(...)) in both passes', async () => {
    const { pass1, pass2 } = await runWithHeader({ channel: 'telegram' });
    expect(pass1.sql).toContain('NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids)');
    expect(pass2.sql).toContain('NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids)');
  });
});
