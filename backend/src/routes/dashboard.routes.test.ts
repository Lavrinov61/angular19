import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), end: vi.fn() };
  return { mockPool };
});

const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
};

vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
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
  const { default: router } = await import('./dashboard.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const BOOKING_STATS = { total_bookings: '10', pending_bookings: '2', confirmed_bookings: '5', completed_bookings: '3', cancelled_bookings: '0', upcoming_bookings: '3', today_bookings: '1' };
const REVENUE_STATS = { total_revenue: '50000', monthly_revenue: '10000', weekly_revenue: '2500' };
const SESSIONS_STATS = { total_sessions: '8', pending_sessions: '1', in_progress_sessions: '2', completed_sessions: '5', total_photos: '40' };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
}

// ─── GET /photographer/stats ──────────────────────────────────────────────────
describe('GET /photographer/stats — photographer dashboard stats', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/photographer/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 if user is not a photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 }); // photographers check → not found

    const res = await request(app).get('/photographer/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns stats for photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    // 6 pool.query calls: check, bookings, revenue, sessions, approvals, recent
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ user_id: 'employee-id' }], rowCount: 1 }) // photographer check
      .mockResolvedValueOnce({ rows: [BOOKING_STATS], rowCount: 1 }) // bookings stats
      .mockResolvedValueOnce({ rows: [REVENUE_STATS], rowCount: 1 }) // revenue stats
      .mockResolvedValueOnce({ rows: [SESSIONS_STATS], rowCount: 1 }) // sessions stats
      .mockResolvedValueOnce({ rows: [{ total_approvals: '0' }], rowCount: 1 }) // approvals stats
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // recent bookings

    const res = await request(app).get('/photographer/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.bookings).toBeDefined();
    expect(res.body.revenue).toBeDefined();
  });
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
describe('GET /admin/stats — admin dashboard stats', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (lacks analytics:view)', async () => {
    // employee has analytics:view... actually let me check - YES employee lacks analytics:view
    // From permissions.ts: employee does NOT have analytics:view
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/admin/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns admin stats for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    // 6 pool.query calls: users, bookings, studios, sessions, orders, recent_activity
    vi.mocked(mockPool.query).mockResolvedValue({ rows: [{ count: '0', total: '0' }], rowCount: 1 });

    const res = await request(app).get('/admin/stats').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    expect(res.body.bookings).toBeDefined();
  });
});
