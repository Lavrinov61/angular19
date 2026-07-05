import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({})),
  };
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

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./app-logs.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// ─── POST / — log a single event (no auth required) ──────────────────────────
describe('POST / — log single event', () => {
  beforeEach(resetMocks);

  it('returns 400 if level or message missing', async () => {
    const res = await request(app).post('/').send({ level: 'error' }); // missing message
    expect(res.status).toBe(400);
  });

  it('stores log without authentication', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/')
      .send({ level: 'error', message: 'Something failed', context: { url: '/test' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('stores log with invalid level (normalizes to info)', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/')
      .send({ level: 'critical', message: 'Something happened' });
    expect(res.status).toBe(200);
  });

  it('stores log with authenticated user', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ level: 'warn', message: 'Warning message' });
    expect(res.status).toBe(200);
  });
});

// ─── POST /batch — log multiple events (no auth required) ─────────────────────
describe('POST /batch — log multiple events', () => {
  beforeEach(resetMocks);

  it('accepts empty batch silently', async () => {
    const res = await request(app).post('/batch').send({ logs: [] });
    expect(res.status).toBe(200);
  });

  it('stores batch of logs without authentication', async () => {
    vi.mocked(mockDb.query).mockResolvedValue([]);
    const res = await request(app)
      .post('/batch')
      .send({
        logs: [
          { level: 'error', message: 'Error 1' },
          { level: 'warn', message: 'Warning 1' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('keeps batch endpoint successful when one log row fails', async () => {
    vi.mocked(mockDb.query)
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/batch')
      .send({
        logs: [
          { level: 'warn', message: 'bad row', context: { httpStatus: 500 }, service: 'Frontend' },
          { level: 'warn', message: 'next row', context: { httpStatus: 404 }, service: 'Frontend' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, inserted: 1, failed: 1 });
  });
});

// ─── GET /stats — log statistics (admin/manager only) ─────────────────────────
describe('GET /stats — log statistics', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns stats for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ errors_1h: '0', errors_24h: '5', warnings_24h: '10', unique_errors_24h: '3' }])
      .mockResolvedValueOnce([]); // topServices

    const res = await request(app).get('/stats').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /recent — recent logs (admin/manager only) ───────────────────────────
describe('GET /recent — recent logs', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/recent');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/recent').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns recent logs for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { id: 'log-1', level: 'error', message: 'Test error', created_at: new Date().toISOString() },
    ]);

    const res = await request(app).get('/recent').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('supports level filter', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/recent?level=error')
      .set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
  });
});
