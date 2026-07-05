import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb, mockGetPartnerPromoDiscount } = vi.hoisted(() => {
  const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
  const mockGetPartnerPromoDiscount = vi.fn().mockResolvedValue(null);
  return { mockDb, mockGetPartnerPromoDiscount };
});
vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    actions: { apiKey: 'test-api-key' },
  },
}));
vi.mock('../services/partners.service.js', () => ({
  getPartnerPromoDiscount: mockGetPartnerPromoDiscount,
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./promotions.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  mockGetPartnerPromoDiscount.mockReset().mockResolvedValue(null);
}

const PROMO = { id: 1, code: 'PROMO10', slug: 'promo10', discount_percent: 10, is_active: true, usage_count: 0, max_uses: 100 };

describe('GET / — public list of active promotions', () => {
  beforeEach(resetMocks);

  it('returns promotions without auth', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([PROMO]);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('SQL filters by kind = public_campaign', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([PROMO]);
    await request(app).get('/');
    const sql = vi.mocked(mockDb.query).mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/kind\s*=\s*'public_campaign'/);
  });
});

describe('GET /admin/all — all promotions (api key required)', () => {
  beforeEach(resetMocks);

  it('returns 401 without api key', async () => {
    const res = await request(app).get('/admin/all');
    expect(res.status).toBe(401);
  });

  it('returns all promotions with api key (no kind filter)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([PROMO]);
    const res = await request(app).get('/admin/all').set('x-api-key', 'test-api-key');
    expect(res.status).toBe(200);
    const sql = vi.mocked(mockDb.query).mock.calls[0]?.[0] as string;
    const params = vi.mocked(mockDb.query).mock.calls[0]?.[1] as unknown[];
    expect(sql).not.toMatch(/WHERE\s+kind/);
    expect(params).toEqual([]);
  });

  it('filters by kind when passed', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([PROMO]);
    const res = await request(app).get('/admin/all?kind=personal').set('x-api-key', 'test-api-key');
    expect(res.status).toBe(200);
    const sql = vi.mocked(mockDb.query).mock.calls[0]?.[0] as string;
    const params = vi.mocked(mockDb.query).mock.calls[0]?.[1] as unknown[];
    expect(sql).toMatch(/WHERE\s+kind\s*=\s*\$1/);
    expect(params[0]).toBe('personal');
  });

  it('returns 400 for invalid kind', async () => {
    const res = await request(app).get('/admin/all?kind=invalid').set('x-api-key', 'test-api-key');
    expect(res.status).toBe(400);
  });
});

describe('GET /:slug — single promotion by slug', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown promo', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/unknown-slug');
    expect(res.status).toBe(404);
  });

  it('returns 404 for personal promo (kind filter excludes it)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/svv-xxx');
    expect(res.status).toBe(404);
    const sql = vi.mocked(mockDb.queryOne).mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/kind\s*=\s*'public_campaign'/);
  });

  it('returns promotion by slug', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(PROMO);
    const res = await request(app).get('/promo10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /validate/:code — validate promo code (all kinds)', () => {
  beforeEach(resetMocks);

  it('returns valid:false for unknown code', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    const res = await request(app).get('/validate/UNKNOWN');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('validates public promo code', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ ...PROMO, usage_limit: null }]);
    const res = await request(app).get('/validate/PROMO10');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('validates personal code (kind=personal, SVV-*)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { id: 2, title: 'Personal', discount_percent: 20, discount_amount: null, trial_days: 0, usage_limit: 1, usage_count: 0, service_slug: null, kind: 'personal' },
    ]);
    const res = await request(app).get('/validate/SVV-ABC123');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('validates prize code (kind=prize, STUDV-*)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { id: 3, title: 'Prize', discount_percent: 50, discount_amount: null, trial_days: 0, usage_limit: 1, usage_count: 0, service_slug: null, kind: 'prize' },
    ]);
    const res = await request(app).get('/validate/STUDV-WIN1');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('validates partner marker code without client discount', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    mockGetPartnerPromoDiscount.mockResolvedValueOnce({
      discount_percent: 0,
      partner_id: 1,
      partner_name: 'Владимир Мигаль',
      tier_slug: 'start',
    });

    const res = await request(app).get('/validate/MIGA');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: true,
      is_partner_code: true,
      partner_name: 'Владимир Мигаль',
      title: 'Код партнёра',
      discount_percent: 0,
      discount_amount: null,
    });
  });
});

describe('POST / — create promo (api key required)', () => {
  beforeEach(resetMocks);

  it('returns 401 without api key', async () => {
    const res = await request(app).post('/').send({ code: 'NEW10' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if required fields missing', async () => {
    const res = await request(app)
      .post('/')
      .set('x-api-key', 'test-api-key')
      .send({ title: 'Promo' }); // missing slug, description
    expect(res.status).toBe(400);
  });

  it('creates promo with default kind=public_campaign', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(PROMO);
    const res = await request(app)
      .post('/')
      .set('x-api-key', 'test-api-key')
      .send({ slug: 'new-promo', title: 'New Promo', description: 'Test promo description' });
    expect([200, 201]).toContain(res.status);
    const params = vi.mocked(mockDb.queryOne).mock.calls[0]?.[1] as unknown[];
    expect(params[params.length - 1]).toBe('public_campaign');
  });

  it('accepts explicit kind=personal', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...PROMO, kind: 'personal' });
    const res = await request(app)
      .post('/')
      .set('x-api-key', 'test-api-key')
      .send({ slug: 'svv-abc', title: 'SVV', description: 'Personal promo', kind: 'personal' });
    expect([200, 201]).toContain(res.status);
    const params = vi.mocked(mockDb.queryOne).mock.calls[0]?.[1] as unknown[];
    expect(params[params.length - 1]).toBe('personal');
  });

  it('rejects malicious kind with 400', async () => {
    const res = await request(app)
      .post('/')
      .set('x-api-key', 'test-api-key')
      .send({ slug: 'evil', title: 'Evil', description: 'Evil desc', kind: 'malicious' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /:id — update promo kind', () => {
  beforeEach(resetMocks);

  it('accepts valid kind update', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...PROMO, kind: 'prize' });
    const res = await request(app)
      .put('/1')
      .set('x-api-key', 'test-api-key')
      .send({ kind: 'prize' });
    expect(res.status).toBe(200);
  });

  it('rejects invalid kind with 400', async () => {
    const res = await request(app)
      .put('/1')
      .set('x-api-key', 'test-api-key')
      .send({ kind: 'nonsense' });
    expect(res.status).toBe(400);
  });
});
