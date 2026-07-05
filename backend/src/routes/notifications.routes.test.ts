import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), end: vi.fn() };
  return { mockPool };
});

const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({})),
};

vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('../services/web-push-notify.service.js', () => ({
  getVapidPublicKey: vi.fn().mockReturnValue('test-vapid-key'),
  saveSubscription: vi.fn().mockResolvedValue(undefined),
  removeSubscription: vi.fn().mockResolvedValue(undefined),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./notifications.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_USER = { id: 'user-id', email: 'user@example.com', role: 'employee', is_active: true, display_name: 'User', phone: null, force_password_change: false, last_password_change: null };
const NOTIF_ROW = { id: 'notif-1', user_id: 'user-id', type: 'task_assigned', title: 'New task', body: 'You have a task', read: false, created_at: new Date().toISOString() };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
}

// ─── GET / — list notifications ───────────────────────────────────────────────
describe('GET / — list notifications', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns notifications for user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [NOTIF_ROW], rowCount: 1 });

    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
  });

  it('supports unread_only filter', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get('/?unread_only=true')
      .set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /settings — notification settings ───────────────────────────────────
describe('GET /settings — notification settings', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(401);
  });

  it('returns default settings if none saved', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app).get('/settings').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.email_notifications).toBe(true);
  });

  it('returns saved settings', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [{ email_notifications: false, push_notifications: true, sms_notifications: false, notification_frequency: 'daily' }],
      rowCount: 1,
    });

    const res = await request(app).get('/settings').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.email_notifications).toBe(false);
  });
});

// ─── PUT /:id/read — mark notification as read ────────────────────────────────
describe('PUT /:id/read — mark as read', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/notif-1/read');
    expect(res.status).toBe(401);
  });

  it('marks notification as read', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ ...NOTIF_ROW, read: true }], rowCount: 1 });

    const res = await request(app).put('/notif-1/read').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── PUT /read-all — mark all as read ────────────────────────────────────────
describe('PUT /read-all — mark all as read', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/read-all');
    expect(res.status).toBe(401);
  });

  it('marks all notifications as read', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [], rowCount: 5 });

    const res = await request(app).put('/read-all').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /:id — delete notification ───────────────────────────────────────
describe('DELETE /:id — delete notification', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/notif-1');
    expect(res.status).toBe(401);
  });

  it('deletes notification', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ id: 'notif-1' }], rowCount: 1 });

    const res = await request(app).delete('/notif-1').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /push/vapid-key — get VAPID public key (public) ─────────────────────
describe('GET /push/vapid-key — get VAPID public key', () => {
  beforeEach(resetMocks);

  it('returns VAPID key without auth', async () => {
    const res = await request(app).get('/push/vapid-key');
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBeDefined();
  });
});

// ─── POST /push/subscribe — subscribe to push ────────────────────────────────
describe('POST /push/subscribe — push subscription', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/push/subscribe').send({ subscription: {} });
    expect(res.status).toBe(401);
  });

  it('saves push subscription', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    const res = await request(app)
      .post('/push/subscribe')
      .set(authHeader(makeEmployeeUser()))
      .send({ subscription: { endpoint: 'https://push.example.com', keys: { p256dh: 'key', auth: 'auth' } } });
    expect(res.status).toBe(200);
  });
});

// ─── GET /stats — notification stats ─────────────────────────────────────────
describe('GET /stats — notification stats', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(401);
  });

  it('returns stats for user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [{ total: '10', unread: '3' }], rowCount: 1,
    });

    const res = await request(app).get('/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});
