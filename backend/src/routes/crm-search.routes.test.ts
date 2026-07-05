/**
 * Integration tests for /crm/search route.
 *
 * Requires authenticateToken + requirePermission('inbox:view').
 * Failing tests = bugs in production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
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

const { default: crmSearchRouter } = await import('./crm-search.routes.js');
const app = createTestApp(crmSearchRouter, '/');

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

describe('GET / — global search', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/?q=test');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);

    const res = await request(app).get('/?q=test').set(authHeader(client));
    expect(res.status).toBe(403);
  });

  it('returns empty array for query shorter than 2 chars', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);

    const res = await request(app).get('/?q=a').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('returns empty array for missing query', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);

    const res = await request(app).get('/').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('searches and returns results for valid query', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    // DB queries: tasks, bookings, orders, clients, chats, notes
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/?q=Иванов').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('searches with phone number format', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/?q=+79001234567').set(authHeader(emp));

    expect(res.status).toBe(200);
  });
});
