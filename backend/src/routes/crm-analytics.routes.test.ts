/**
 * Integration tests for /crm/analytics routes.
 *
 * Requires authenticateToken + requirePermission('analytics:view').
 * Covers: funnel, cohorts, retention, channels.
 * Failing tests = bugs in production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeAdminUser,
  makeManagerUser,
  makeEmployeeUser,
  makeClientUser,
  authHeader,
} from '../test-utils/index.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
  },
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

const { default: crmAnalyticsRouter } = await import('./crm-analytics.routes.js');
const app = createTestApp(crmAnalyticsRouter, '/');

const DB_ADMIN = {
  id: 'admin-id', email: 'admin@example.com', role: 'admin',
  is_active: true, display_name: 'Admin', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_MANAGER = {
  id: 'manager-id', email: 'manager@example.com', role: 'manager',
  is_active: true, display_name: 'Manager', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_EMPLOYEE = {
  id: 'employee-id', email: 'emp@example.com', role: 'employee',
  is_active: true, display_name: 'Employee', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_CLIENT = {
  id: 'client-id', email: 'client@example.com', role: 'client',
  is_active: true, display_name: 'Client', phone: null,
  force_password_change: false, last_password_change: null,
};

describe('CRM Analytics — global auth guard', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/funnel');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role (no analytics:view)', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);

    const res = await request(app).get('/funnel').set(authHeader(client));
    expect(res.status).toBe(403);
  });

  it('returns 403 for employee role (no analytics:view)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);

    const res = await request(app).get('/funnel').set(authHeader(emp));
    expect(res.status).toBe(403);
  });
});

describe('GET /funnel — conversion funnel analytics', () => {
  beforeEach(() => resetMockDb());

  it('returns funnel data for admin (online type)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      step1_sessions: '100', step2_engaged: '80', step3_interested: '50', step4_paid: '30',
    }]);

    const res = await request(app).get('/funnel').set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  it('returns funnel for manager', async () => {
    const manager = makeManagerUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_MANAGER); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      step1_sessions: '50', step2_engaged: '40', step3_interested: '30', step4_paid: '15',
    }]);

    const res = await request(app).get('/funnel').set(authHeader(manager));
    expect(res.status).toBe(200);
  });

  it('returns funnel with type=studio', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      step1_bookings: '200', step2_confirmed: '180', step3_completed: '150', step4_pos: '120',
    }]);

    const res = await request(app).get('/funnel?type=studio&period=7d').set(authHeader(admin));
    expect(res.status).toBe(200);
  });
});

describe('GET /cohorts — cohort analysis', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/cohorts');
    expect(res.status).toBe(401);
  });

  it('returns cohort data for admin', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/cohorts').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /retention — retention analysis', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/retention');
    expect(res.status).toBe(401);
  });

  it('returns retention data for admin', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([{
      total_customers: '100', returned_30d: '20', returned_60d: '15', returned_90d: '10',
      total_engaged: '200', converted: '50',
    }]);

    const res = await request(app).get('/retention').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalCustomers).toBe(100);
  });
});

describe('GET /channels — channel attribution analytics', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/channels');
    expect(res.status).toBe(401);
  });

  it('returns channels data for admin', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/channels').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
