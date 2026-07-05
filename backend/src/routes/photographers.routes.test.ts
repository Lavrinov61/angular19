import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb, mockPool } = vi.hoisted(() => {
  const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockDb, mockPool };
});
vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    upload: { dir: '/tmp/test-uploads' },
    webPush: { publicKey: '', privateKey: '', subject: 'mailto:test@example.com' },
    telegram: { botToken: '' },
  },
}));
vi.mock('../services/web-push-notify.service.js', () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('fs/promises', () => ({
  default: { mkdir: vi.fn().mockResolvedValue(undefined), unlink: vi.fn().mockResolvedValue(undefined) },
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./photographers.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, makeUser, authHeader } from '../test-utils/mock-auth.js';

const makePhotographerUser = () => makeUser({ id: 'photographer-id', role: 'photographer', email: 'photo@example.com' });

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const PHOTOGRAPHER = { id: 'photo-1', user_id: 'employee-id', name: 'Иван', slug: 'ivan', is_active: true };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// GET / is optionalAuth (no auth required)
// GET /me, PUT /me are authenticateToken (required)

describe('GET / — list photographers (public)', () => {
  beforeEach(resetMocks);

  it('returns photographer list without auth', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([PHOTOGRAPHER]);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /:id — single photographer (public)', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/unknown-id');
    expect(res.status).toBe(404);
  });

  it('returns photographer details', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(PHOTOGRAPHER);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // reviews/portfolio
    const res = await request(app).get('/photo-1');
    expect(res.status).toBe(200);
  });
});

describe('GET /me — own photographer profile', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
  });

  it('returns own profile', async () => {
    const DB_PHOTOGRAPHER = { id: 'photographer-id', email: 'photo@example.com', role: 'photographer', is_active: true, display_name: 'Photographer', phone: null, force_password_change: false, last_password_change: null };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_PHOTOGRAPHER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [PHOTOGRAPHER] });
    const res = await request(app).get('/me').set(authHeader(makePhotographerUser()));
    expect(res.status).toBe(200);
  });
});
