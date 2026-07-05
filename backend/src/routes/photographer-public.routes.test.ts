import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
  return { mockDb };
});
vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));
let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./photographer-public.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

const PHOTOGRAPHER = { id: 'photo-1', user_id: 'user-1', name: 'Иван Фотограф' };

// All routes are public (no auth required)

describe('POST /booking-request — public booking request', () => {
  beforeEach(resetMocks);

  it('returns 400 if required fields missing', async () => {
    const res = await request(app).post('/booking-request').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 if photographer not found', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null); // photographer not found
    const res = await request(app)
      .post('/booking-request')
      .send({
        photographerId: 'unknown',
        name: 'Клиент',
        phone: '+79001234567',
        preferredDate: '2026-03-10',
      });
    expect(res.status).toBe(404);
  });

  it('submits booking request', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(PHOTOGRAPHER) // photographer found
      .mockResolvedValueOnce(null);        // no existing booking conflict

    const res = await request(app)
      .post('/booking-request')
      .send({
        photographerId: 'photo-1',
        name: 'Иван',
        phone: '+79001234567',
        preferredDate: '2026-03-10',
      });
    expect([200, 201]).toContain(res.status);
  });
});

describe('GET /availability/:id — photographer availability', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/availability/unknown');
    expect(res.status).toBe(404);
  });

  it('returns availability for known photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...PHOTOGRAPHER, availability: '{}' });
    const res = await request(app).get('/availability/photo-1');
    expect(res.status).toBe(200);
  });
});
