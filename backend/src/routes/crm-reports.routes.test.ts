import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
};
vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('../services/crm-reports.service.js', () => ({
  getRevenueReport: vi.fn().mockResolvedValue([]),
  getDailySummary: vi.fn().mockResolvedValue({}),
  getCashReconciliationReport: vi.fn().mockResolvedValue({
    rows: [],
    summary: {
      total: 0,
      balanced: 0,
      possible_tip: 0,
      shortage: 0,
      surplus: 0,
      missing_open: 0,
      missing_close: 0,
      open: 0,
      issues: 0,
    },
    tolerance: 1,
    possible_tip_limit: 500,
  }),
  getTopProducts: vi.fn().mockResolvedValue([]),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./crm-reports.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, makeManagerUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_MANAGER = { id: 'manager-id', email: 'manager@example.com', role: 'manager', is_active: true, display_name: 'Manager', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// router.use(authenticateToken, requirePermission('reports:view')) — admin+manager only

describe('GET /revenue — revenue report', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/revenue');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no reports:view)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/revenue').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns revenue report for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app).get('/revenue').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /daily-summary — daily summary', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/daily-summary');
    expect(res.status).toBe(401);
  });

  it('returns daily summary for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app).get('/daily-summary').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /cash-control — admin cash reconciliation', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/cash-control');
    expect(res.status).toBe(401);
  });

  it('returns 403 for manager without users:manage', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_MANAGER);
    const res = await request(app).get('/cash-control').set(authHeader(makeManagerUser()));
    expect(res.status).toBe(403);
  });

  it('returns cash reconciliation report for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .get('/cash-control?from=2026-05-10&to=2026-05-16')
      .set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.possible_tip_limit).toBe(500);
  });
});

describe('GET /products — top products report', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(401);
  });

  it('returns products report for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app).get('/products').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
