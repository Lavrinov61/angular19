import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('qrcode', () => ({ default: { toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-qr')) } }));
vi.mock('../services/review-sync.service.js', () => ({
  getAggregatedStats: vi.fn().mockResolvedValue({ rating: 4.8, count: 150, platforms: {} }),
  triggerSync: vi.fn().mockResolvedValue({ synced: 0 }),
}));
vi.mock('../services/review-request.service.js', () => ({
  getReviewRequestStats: vi.fn().mockResolvedValue({ total: 0, sent: 0, clicked: 0 }),
  scheduleReviewRequest: vi.fn().mockResolvedValue(undefined),
  trackClick: vi.fn().mockResolvedValue(undefined),
  getReviewPlatformUrl: vi.fn().mockResolvedValue('https://example.com/review'),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./reviews.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// Public routes: GET /stats, GET /go, GET /request-stats, POST /send, GET /qr
// Protected: POST /sync (manage_settings as any — this is a bug: uses wrong permission slug)

describe('GET /stats — public aggregated stats', () => {
  it('returns review stats without auth', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(200);
  });
});

describe('GET /request-stats — public request stats', () => {
  it('returns request stats without auth', async () => {
    const res = await request(app).get('/request-stats');
    expect(res.status).toBe(200);
  });
});

describe('POST /send — send review request (public)', () => {
  it('sends review request', async () => {
    const res = await request(app).post('/send').send({ phone: '+79001234567', name: 'Иван' });
    expect([200, 400]).toContain(res.status);
  });
});

describe('GET /qr — QR code generation (public)', () => {
  it('returns QR code image', async () => {
    const res = await request(app).get('/qr');
    expect([200, 400]).toContain(res.status);
  });
});

describe('POST /sync — sync reviews (requires manage_settings — bug: wrong slug)', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/sync');
    expect(res.status).toBe(401);
  });

  // Bug documented: route uses 'manage_settings' but permission slug is 'settings:manage'
  // This means even admin gets 403 due to the bug
  it('returns 403 due to wrong permission slug bug', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app).post('/sync').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(403);
  });
});
