/**
 * Integration tests for the broadcast-campaigns routes (operator pult).
 *
 * The router carries NO auth itself (auth is applied at the app.ts mount), so we mount it
 * bare and focus on handler logic: create-body validation, the test_mode=false-from-body
 * block (R1), the dispatch launch-CAS (409 on re-launch) + MAX_RECIPIENTS cap, and the
 * go-live / recipients / list contracts. The service layer is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn(),
  },
}));

const {
  mockList, mockCreate, mockRecipients, mockSetLive, mockMaterialize, mockStats,
  mockPreview, mockSegmentOptions,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockRecipients: vi.fn(),
  mockSetLive: vi.fn(),
  mockMaterialize: vi.fn(),
  mockStats: vi.fn(),
  mockPreview: vi.fn(),
  mockSegmentOptions: vi.fn(),
}));

vi.mock('../database/db.js', () => ({ default: mockDb }));

// The router imports normalizeAudienceFilter + ALLOWED_CHANNELS for its trust boundary, so
// we provide REAL implementations of those (validation logic under test) while mocking the
// DB-touching service functions. ALLOWED_CHANNELS mirrors the channel_type enum.
const ALLOWED_CHANNELS = new Set(['telegram', 'vk', 'whatsapp', 'instagram', 'max', 'email', 'web']);
const SLUG_RE = /^[a-z0-9_]{1,100}$/;
function normalizeAudienceFilter(raw: unknown): { channel: string; serviceSlugs?: string[]; recencyDays?: number | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('audienceFilter must be an object');
  const r = raw as Record<string, unknown>;
  const channel = typeof r['channel'] === 'string' ? r['channel'] : '';
  if (!ALLOWED_CHANNELS.has(channel)) throw new Error('audienceFilter.channel must be one of the channels');
  const out: { channel: string; serviceSlugs?: string[]; recencyDays?: number | null } = { channel };
  if (r['serviceSlugs'] !== undefined && r['serviceSlugs'] !== null) {
    if (!Array.isArray(r['serviceSlugs'])) throw new Error('audienceFilter.serviceSlugs must be an array');
    const slugs: string[] = [];
    for (const s of r['serviceSlugs']) {
      if (typeof s !== 'string' || !SLUG_RE.test(s)) throw new Error('audienceFilter.serviceSlugs contains an invalid slug');
      slugs.push(s);
    }
    if (slugs.length > 0) out.serviceSlugs = slugs;
  }
  if (r['recencyDays'] !== undefined && r['recencyDays'] !== null) {
    const n = r['recencyDays'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 365) throw new Error('audienceFilter.recencyDays must be an integer 1..365');
    out.recencyDays = n;
  }
  return out;
}

vi.mock('../services/broadcast/campaign.service.js', () => ({
  listBroadcastCampaigns: mockList,
  createBroadcastCampaign: mockCreate,
  getCampaignRecipients: mockRecipients,
  setCampaignLive: mockSetLive,
  materializeRecipients: mockMaterialize,
  getCampaignStats: mockStats,
  previewAudience: mockPreview,
  getSegmentOptions: mockSegmentOptions,
  normalizeAudienceFilter,
  ALLOWED_CHANNELS,
}));

vi.mock('../services/audit.service.js', () => ({ logAudit: vi.fn() }));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const routerModule = await import('./broadcast-campaigns.routes.js');

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/', routerModule.default);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = makeApp();
const VALID_UUID = '45f0eb5c-2690-4ed1-8a90-02a0869c1594';
const CONTACT_UUID = 'e7652775-493f-4162-a123-e42a92d43340';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.query.mockResolvedValue([]);
  mockDb.queryOne.mockResolvedValue(null);
});

// ─── GET / (list) ─────────────────────────────────────────────────────────────

describe('GET / — list', () => {
  it('returns {success, data} from listBroadcastCampaigns', async () => {
    mockList.mockResolvedValue([{ id: VALID_UUID, name: 'X', status: 'active', test_mode: true, allowed_count: 1, created_at: '2026-05-31T00:00:00.000Z', funnel: { queued: 0, sent: 1, failed: 0, blocked: 0, skipped: 0, suppressed: 0, total: 1 } }]);

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(VALID_UUID);
  });
});

// ─── POST / (create) — R1: test_mode never from body ─────────────────────────

describe('POST / — create', () => {
  it('creates a draft and NEVER passes test_mode to the service (forced server-side)', async () => {
    mockCreate.mockResolvedValue({ id: 'new-id' });

    const res = await request(app).post('/').send({
      name: 'Кампания',
      payload: { text: 'Привет', mediaUrl: 'https://cdn/x.jpg' },
      allowedContactIds: [CONTACT_UUID],
      // hostile: try to force a mass send via the body
      test_mode: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('new-id');
    // R1: the parsed input handed to the service must NOT contain test_mode at all.
    const input = mockCreate.mock.calls[0][0];
    expect('test_mode' in input).toBe(false);
    expect(input.name).toBe('Кампания');
    expect(input.allowedContactIds).toEqual([CONTACT_UUID]);
    expect(input.payload).toMatchObject({ text: 'Привет', mediaUrl: 'https://cdn/x.jpg' });
  });

  it('rejects a missing name with 400', async () => {
    const res = await request(app).post('/').send({ payload: {} });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload with 400', async () => {
    const res = await request(app).post('/').send({ name: 'N', payload: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  it('rejects allowedContactIds with a non-UUID entry (R2)', async () => {
    const res = await request(app).post('/').send({ name: 'N', payload: {}, allowedContactIds: ['not-a-uuid'] });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('normalizes editorial payload — drops malformed buttons, keeps valid url-buttons', async () => {
    mockCreate.mockResolvedValue({ id: 'id2' });

    await request(app).post('/').send({
      name: 'N',
      payload: {
        text: 'hi',
        buttons: [[{ text: 'Открыть', url: 'https://x' }, { text: 'no-url' }], 'garbage'],
        extraKey: 'dropped',
      },
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.payload.buttons).toEqual([[{ text: 'Открыть', url: 'https://x' }]]);
    expect('extraKey' in input.payload).toBe(false);
  });
});

// ─── GET /:id/recipients ──────────────────────────────────────────────────────

describe('GET /:id/recipients', () => {
  it('passes clamped limit/offset to the service', async () => {
    mockRecipients.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get(`/${VALID_UUID}/recipients?limit=9999&offset=-5`);

    expect(res.status).toBe(200);
    const [, opts] = mockRecipients.mock.calls[0];
    expect(opts.limit).toBe(500);  // clamped to max
    expect(opts.offset).toBe(0);   // negative → 0
  });

  it('defaults to limit=100 offset=0 clickedOnly=false when absent', async () => {
    mockRecipients.mockResolvedValue({ items: [], total: 0 });
    await request(app).get(`/${VALID_UUID}/recipients`);
    const [, opts] = mockRecipients.mock.calls[0];
    expect(opts).toEqual({ limit: 100, offset: 0, clickedOnly: false });
  });

  it('rejects a non-UUID id with 400', async () => {
    const res = await request(app).get('/not-a-uuid/recipients');
    expect(res.status).toBe(400);
    expect(mockRecipients).not.toHaveBeenCalled();
  });
});

// ─── POST /:id/go-live ──────────────────────────────────────────────────────

describe('POST /:id/go-live', () => {
  it('flips via setCampaignLive and returns the result', async () => {
    mockSetLive.mockResolvedValue({ id: VALID_UUID, test_mode: false });

    const res = await request(app).post(`/${VALID_UUID}/go-live`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: VALID_UUID, test_mode: false });
    expect(mockSetLive).toHaveBeenCalledWith(VALID_UUID);
  });

  it('rejects a non-UUID id with 400', async () => {
    const res = await request(app).post('/bad/go-live');
    expect(res.status).toBe(400);
    expect(mockSetLive).not.toHaveBeenCalled();
  });
});

// ─── POST /:id/dispatch — launch CAS + MAX_RECIPIENTS ────────────────────────

describe('POST /:id/dispatch — guards', () => {
  it('404 when the campaign does not exist', async () => {
    mockDb.queryOne.mockResolvedValue(null);
    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});
    expect(res.status).toBe(404);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('400 when the campaign channel is not telegram', async () => {
    mockDb.queryOne.mockResolvedValue({ id: VALID_UUID, channel: 'email', status: 'draft', test_mode: true });
    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});
    expect(res.status).toBe(400);
  });

  it('launches a draft campaign (CAS flip → active) and materializes', async () => {
    // SELECT guard → telegram/draft; then launch CAS RETURNING id
    mockDb.queryOne
      .mockResolvedValueOnce({ id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: true })
      .mockResolvedValueOnce({ id: VALID_UUID });
    mockMaterialize.mockResolvedValue({ inserted: 1, suppressed: 0, skipped: 0 });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(mockMaterialize).toHaveBeenCalledWith(VALID_UUID);
  });

  it('409 when the campaign is already active (launch CAS matches 0 rows)', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: VALID_UUID, channel: 'telegram', status: 'active', test_mode: true })
      .mockResolvedValueOnce(null); // CAS: no row flipped (status not in draft|paused)

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(409);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('400 when a LIVE (non-test) audience exceeds MAX_RECIPIENTS', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: false })
      .mockResolvedValueOnce({ cnt: 9000 }); // audience projection > 5000

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/лимит|5000/);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('allows a LIVE audience at or under the cap', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: false })
      .mockResolvedValueOnce({ cnt: 4000 })          // audience under cap
      .mockResolvedValueOnce({ id: VALID_UUID });     // CAS flip ok
    mockMaterialize.mockResolvedValue({ inserted: 4000, suppressed: 0, skipped: 0 });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(200);
    expect(mockMaterialize).toHaveBeenCalledWith(VALID_UUID);
  });

  // ── channel-guard (P1-1): the persisted column MUST agree with audience_filter.channel ──
  // A mismatch means a tampered/legacy row — refuse so a segment never goes through the wrong
  // adapter. (NOT "max unsupported": max IS supported now — this only rejects column≠filter.)
  it('400 when the segment channel disagrees with the column (max filter on a telegram column)', async () => {
    mockDb.queryOne.mockResolvedValue({
      id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: true,
      audience_filter: { channel: 'max', serviceSlugs: ['document_photo'] },
    });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/не совпада/i);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('400 when the segment channel disagrees with the column (telegram filter on a max column)', async () => {
    mockDb.queryOne.mockResolvedValue({
      id: VALID_UUID, channel: 'max', status: 'draft', test_mode: true,
      audience_filter: { channel: 'telegram', serviceSlugs: ['document_photo'] },
    });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/не совпада/i);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('dispatches a MAX segment (column=max, audience_filter.channel=max) → materialize + active', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({
        id: VALID_UUID, channel: 'max', status: 'draft', test_mode: true,
        audience_filter: { channel: 'max', serviceSlugs: ['document_photo'] },
      })
      .mockResolvedValueOnce({ id: VALID_UUID }); // launch CAS flip → active
    mockMaterialize.mockResolvedValue({ inserted: 88, suppressed: 0, skipped: 0 });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(88);
    // CAS flip to 'active' (the kill-switch the MAX dispatcher reads) then materialize.
    const cas = mockDb.queryOne.mock.calls.find(([sql]) => String(sql).includes("status = 'active'"));
    expect(cas).toBeTruthy();
    expect(mockMaterialize).toHaveBeenCalledWith(VALID_UUID);
  });

  it('dispatches a telegram segment (audience_filter.channel=telegram) normally', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({
        id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: true,
        audience_filter: { channel: 'telegram', serviceSlugs: ['document_photo'] },
      })
      .mockResolvedValueOnce({ id: VALID_UUID }); // CAS flip
    mockMaterialize.mockResolvedValue({ inserted: 121, suppressed: 0, skipped: 0 });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(200);
    expect(mockMaterialize).toHaveBeenCalledWith(VALID_UUID);
  });

  it('uses previewAudience (segment predicate) for the cap when a filter is present', async () => {
    mockDb.queryOne.mockResolvedValueOnce({
      id: VALID_UUID, channel: 'telegram', status: 'draft', test_mode: false,
      audience_filter: { channel: 'telegram', serviceSlugs: ['document_photo'] },
    });
    // Segment preview reports an oversized audience → cap rejects, no DB count fallback.
    mockPreview.mockResolvedValue({ count: 9000 });

    const res = await request(app).post(`/${VALID_UUID}/dispatch`).send({});

    expect(res.status).toBe(400);
    expect(mockPreview).toHaveBeenCalledWith({ channel: 'telegram', serviceSlugs: ['document_photo'] });
    expect(mockMaterialize).not.toHaveBeenCalled();
  });
});

// ─── POST /audience-preview ───────────────────────────────────────────────────

describe('POST /audience-preview', () => {
  it('returns {success, data:{count}} from previewAudience for a valid filter', async () => {
    mockPreview.mockResolvedValue({ count: 95 });

    const res = await request(app).post('/audience-preview').send({
      channel: 'telegram', serviceSlugs: ['document_photo', 'copy'], recencyDays: 30,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { count: 95 } });
    expect(mockPreview).toHaveBeenCalledWith({ channel: 'telegram', serviceSlugs: ['document_photo', 'copy'], recencyDays: 30 });
  });

  it('previews any channel (MAX) — count works even though dispatch is telegram-only', async () => {
    mockPreview.mockResolvedValue({ count: 408 });
    const res = await request(app).post('/audience-preview').send({ channel: 'max' });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(408);
  });

  it('400 on an unknown channel — never reaches previewAudience (SQLi guard)', async () => {
    const res = await request(app).post('/audience-preview').send({ channel: 'sms' });
    expect(res.status).toBe(400);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('400 on a slug that violates the slug grammar', async () => {
    const res = await request(app).post('/audience-preview').send({ channel: 'telegram', serviceSlugs: ["x'; DROP TABLE--"] });
    expect(res.status).toBe(400);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('400 on recencyDays out of range', async () => {
    const res = await request(app).post('/audience-preview').send({ channel: 'telegram', recencyDays: 9999 });
    expect(res.status).toBe(400);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

// ─── GET /segments/options ─────────────────────────────────────────────────────

describe('GET /segments/options', () => {
  it('returns services + channels from getSegmentOptions (default telegram)', async () => {
    mockSegmentOptions.mockResolvedValue({
      services: [{ slug: 'document_photo', label: 'А4 фото-документ', count: 121 }],
      channels: [{ channel: 'telegram', count: 349 }],
    });

    const res = await request(app).get('/segments/options');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channels[0]).toEqual({ channel: 'telegram', count: 349 });
    expect(mockSegmentOptions).toHaveBeenCalledWith('telegram');
  });

  it('honours a valid ?channel= param', async () => {
    mockSegmentOptions.mockResolvedValue({ services: [], channels: [] });
    await request(app).get('/segments/options?channel=max');
    expect(mockSegmentOptions).toHaveBeenCalledWith('max');
  });

  it('falls back to telegram for an unknown ?channel= param', async () => {
    mockSegmentOptions.mockResolvedValue({ services: [], channels: [] });
    await request(app).get('/segments/options?channel=bogus');
    expect(mockSegmentOptions).toHaveBeenCalledWith('telegram');
  });

  it('is matched as a literal route, NOT as /:id (segments is never a UUID)', async () => {
    mockSegmentOptions.mockResolvedValue({ services: [], channels: [] });
    const res = await request(app).get('/segments/options');
    expect(res.status).toBe(200); // not 400 "Некорректный id"
  });
});

// ─── POST / create — audience filter passthrough ──────────────────────────────

describe('POST / — create with audienceFilter', () => {
  it('parses + forwards a valid audienceFilter to the service', async () => {
    mockCreate.mockResolvedValue({ id: 'seg-id' });

    const res = await request(app).post('/').send({
      name: 'Сегмент', payload: { mediaUrl: 'https://cdn/x.jpg' },
      audienceFilter: { channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 },
    });

    expect(res.status).toBe(200);
    const input = mockCreate.mock.calls[0][0];
    expect(input.audienceFilter).toEqual({ channel: 'telegram', serviceSlugs: ['document_photo'], recencyDays: 30 });
  });

  it('400 on a malformed audienceFilter (unknown channel) — never reaches the service', async () => {
    const res = await request(app).post('/').send({
      name: 'N', payload: {}, audienceFilter: { channel: 'sms' },
    });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('omits audienceFilter when absent (legacy all-telegram audience)', async () => {
    mockCreate.mockResolvedValue({ id: 'id3' });
    await request(app).post('/').send({ name: 'N', payload: {} });
    const input = mockCreate.mock.calls[0][0];
    expect(input.audienceFilter).toBeUndefined();
  });
});

// ─── POST / create — channel derivation + MAX utm guard (P1-1, S6) ─────────────

describe('POST / — create with channel=max', () => {
  it('positive: create with audienceFilter.channel=max → service called with channel="max"', async () => {
    mockCreate.mockResolvedValue({ id: 'max-id' });
    // No existing MAX campaign owns the auto-derived utm_campaign.
    mockDb.queryOne.mockResolvedValue({ cnt: 0 });

    const res = await request(app).post('/').send({
      name: 'MAX рассылка',
      payload: { mediaUrl: 'https://cdn/x.jpg' },
      audienceFilter: { channel: 'max', serviceSlugs: ['document_photo'] },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('max-id');
    // 3rd positional arg to the service is the DERIVED channel.
    expect(mockCreate.mock.calls[0][2]).toBe('max');
  });

  // INVARIANT P1-1: the persisted channel is DERIVED from audience_filter.channel — a body-level
  // `channel` field is IGNORED (no separate source of truth → no silent cross-channel misdispatch).
  it('P1-1: body.channel is ignored — channel is derived from audience_filter (max filter wins)', async () => {
    mockCreate.mockResolvedValue({ id: 'inv-1' });
    mockDb.queryOne.mockResolvedValue({ cnt: 0 });

    await request(app).post('/').send({
      name: 'Инвариант',
      payload: {},
      channel: 'telegram', // hostile: try to force telegram via the body
      audienceFilter: { channel: 'max' },
    });

    expect(mockCreate.mock.calls[0][2]).toBe('max'); // derived from the filter, NOT the body
  });

  it('P1-1: absent body.channel + no filter → derives telegram (legacy default)', async () => {
    mockCreate.mockResolvedValue({ id: 'inv-2' });

    await request(app).post('/').send({
      name: 'Легаси',
      payload: {},
      channel: 'max', // hostile body field — must be ignored
    });

    // No audienceFilter → legacy telegram; the body channel='max' must NOT leak through.
    expect(mockCreate.mock.calls[0][2]).toBe('telegram');
    // And the telegram path must NOT run the MAX utm dup-guard query.
    expect(mockDb.queryOne).not.toHaveBeenCalled();
  });

  // utm code-guard (S6): a MAX campaign whose utm_campaign is already taken → 400 (never created).
  it('utm-guard: MAX create with a manual utm_campaign already taken → 400, service NOT called', async () => {
    mockDb.queryOne.mockResolvedValue({ cnt: 1 }); // dup-guard finds a clash

    const res = await request(app).post('/').send({
      name: 'Дубль',
      payload: {},
      audienceFilter: { channel: 'max' },
      utm: { campaign: 'edu_print' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/utm_campaign занят/i);
    expect(mockCreate).not.toHaveBeenCalled();
    // The clash was checked against the operator-supplied campaign value.
    expect(mockDb.queryOne.mock.calls[0][1]).toEqual(['edu_print']);
  });

  it('utm-guard: MAX create with a unique manual utm_campaign → 200, used as-is', async () => {
    mockCreate.mockResolvedValue({ id: 'utm-ok' });
    mockDb.queryOne.mockResolvedValue({ cnt: 0 });

    const res = await request(app).post('/').send({
      name: 'Уникум',
      payload: {},
      audienceFilter: { channel: 'max' },
      utm: { source: 'max', campaign: 'edu_print_2026' },
    });

    expect(res.status).toBe(200);
    expect(mockDb.queryOne.mock.calls[0][1]).toEqual(['edu_print_2026']);
    const input = mockCreate.mock.calls[0][0];
    expect(input.utm.campaign).toBe('edu_print_2026'); // kept as-is (manual)
    expect(input.utm.source).toBe('max');
  });

  // utm auto-derive (contract with fixing-utm): MAX + no utm.campaign → 'max_<slug(name)>'.
  it('utm-auto: MAX create without utm.campaign → auto "max_<slug(name)>", source forced to max', async () => {
    mockCreate.mockResolvedValue({ id: 'auto-1' });
    mockDb.queryOne.mockResolvedValue({ cnt: 0 });

    const res = await request(app).post('/').send({
      name: 'Печать А4 2026',
      payload: {},
      audienceFilter: { channel: 'max' },
    });

    expect(res.status).toBe(200);
    // slug: lowercase, non-alphanumeric runs → '_', trimmed; spaces collapse.
    const expected = 'max_печать_а4_2026';
    expect(mockDb.queryOne.mock.calls[0][1]).toEqual([expected]); // dup-guard ran on the AUTO value
    const input = mockCreate.mock.calls[0][0];
    expect(input.utm.campaign).toBe(expected);
    expect(input.utm.source).toBe('max'); // forced even when absent
  });

  it('utm-auto: an auto-derived utm_campaign that collides → 400, service NOT called', async () => {
    mockDb.queryOne.mockResolvedValue({ cnt: 1 }); // the auto value is already taken

    const res = await request(app).post('/').send({
      name: 'Печать А4 2026',
      payload: {},
      audienceFilter: { channel: 'max' },
    });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('telegram create does NOT touch utm or run the MAX dup-guard', async () => {
    mockCreate.mockResolvedValue({ id: 'tg-1' });

    await request(app).post('/').send({
      name: 'ТГ',
      payload: {},
      audienceFilter: { channel: 'telegram' },
      utm: { campaign: 'whatever' },
    });

    expect(mockCreate.mock.calls[0][2]).toBe('telegram');
    expect(mockDb.queryOne).not.toHaveBeenCalled(); // dup-guard is MAX-only
  });
});
