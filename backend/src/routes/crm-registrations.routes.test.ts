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
  const { default: router } = await import('./crm-registrations.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

function querySqlAt(index: number): string {
  const sql = vi.mocked(mockDb.query).mock.calls[index]?.[0];
  expect(typeof sql).toBe('string');
  return String(sql);
}

// router.use(authenticateToken, requirePermission('users:manage')) — admin only

describe('GET /stats — registration statistics', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no users:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/stats').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns stats for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{
        total_users: '100',
        new_in_period: '5',
        previous_period_new: '3',
        clients: '80',
        staff: '20',
        via_yandex: '1',
        via_telegram: '2',
        via_google: '3',
        via_apple: '4',
        via_vk: '5',
        via_sber: '6',
        via_mts: '7',
        via_phone: '8',
        via_email: '9',
        via_email_unverified: '10',
        email_verified: '70',
        has_phone: '30',
        clients_converted: '12',
        avg_days_to_conversion: '2.5',
      }])
      .mockResolvedValueOnce([{ day: '2026-03-05', count: '5' }])
      .mockResolvedValueOnce([{ role: 'client', count: '5' }])
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([{ source: 'vk', count: 3 }]);

    const res = await request(app).get('/stats').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.viaPhone).toBe(8);
  });
});

describe('GET /recent — recent registrations', () => {
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

  it('returns recent registrations for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    // Promise.all calls db.query twice: rows and count
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: 'user-1', email: 'new@example.com', role: 'client', created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ total: 1 }]);

    const res = await request(app).get('/recent').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('classifies phone-only registrations before email fallback', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const res = await request(app).get('/recent').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);

    const sql = querySqlAt(0);
    expect(sql).toContain("THEN 'phone'");
    expect(sql).toContain("phone_verified = true");
    expect(sql).toContain('password_hash IS NULL');
    expect(sql.indexOf("THEN 'phone'")).toBeLessThan(sql.indexOf("ELSE 'email'"));
  });

  it('filters phone provider with the phone-auth predicate', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const res = await request(app).get('/recent?provider=phone').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);

    const sql = querySqlAt(0);
    expect(sql).toContain('phone_verified = true');
    expect(sql).toContain('password_hash IS NULL');
    expect(sql).toContain("created_at >= NOW() - $1::interval");
  });
});
