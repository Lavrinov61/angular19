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
vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    invalidateAll: vi.fn(),
    invalidateUser: vi.fn(),
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./rbac.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const ROLE_ROW = { id: 'role-1', name: 'custom_role', display_name: 'Custom Role', description: 'Test role', sort_order: 10 };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// router.use(authenticateToken, requirePermission('settings:manage'))
// Only admin has settings:manage

// ─── GET /roles ───────────────────────────────────────────────────────────────
describe('GET /roles — list roles', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/roles');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no settings:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/roles').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns roles for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([ROLE_ROW]);

    const res = await request(app).get('/roles').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.roles)).toBe(true);
  });
});

// ─── GET /roles/:id ───────────────────────────────────────────────────────────
describe('GET /roles/:id — get single role', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/roles/role-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 if role not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)  // auth
      .mockResolvedValueOnce(null);     // role not found

    const res = await request(app).get('/roles/unknown').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(404);
  });

  it('returns role with permissions', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(ROLE_ROW); // role found
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // permissions

    const res = await request(app).get('/roles/role-1').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /roles ──────────────────────────────────────────────────────────────
describe('POST /roles — create role', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/roles').send({ name: 'new_role', display_name: 'New Role' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if slug or display_name missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/roles')
      .set(authHeader(makeAdminUser()))
      .send({ display_name: 'New Role' }); // missing slug
    expect(res.status).toBe(400);
  });

  it('creates role for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)  // auth
      .mockResolvedValueOnce(null)      // existing slug check → not found
      .mockResolvedValueOnce(ROLE_ROW); // INSERT RETURNING

    const res = await request(app)
      .post('/roles')
      .set(authHeader(makeAdminUser()))
      .send({ slug: 'new_role', display_name: 'New Role' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /permissions ─────────────────────────────────────────────────────────
describe('GET /permissions — list all permissions', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/permissions');
    expect(res.status).toBe(401);
  });

  it('returns permissions for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'perm-1', slug: 'tasks:manage', display_name: 'Tasks' }]);

    const res = await request(app).get('/permissions').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /users/:userId/effective ─────────────────────────────────────────────
describe('GET /users/:userId/effective — get effective permissions', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/users/user-1/effective');
    expect(res.status).toBe(401);
  });

  it('returns 404 if user not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null);    // user not found

    const res = await request(app).get('/users/unknown/effective').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(404);
  });

  it('returns effective permissions for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: 'user-1', role: 'employee', email: 'emp@test.com' }); // user found

    const res = await request(app).get('/users/user-1/effective').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /users/:userId/role ───────────────────────────────────────────────────
describe('PUT /users/:userId/role — change user role', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/users/user-1/role').send({ role: 'manager' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if role missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .put('/users/user-1/role')
      .set(authHeader(makeAdminUser()))
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 if role slug not in rbac_roles', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null);    // rbac_roles check → not found → 400

    const res = await request(app)
      .put('/users/user-1/role')
      .set(authHeader(makeAdminUser()))
      .send({ role: 'nonexistent-role' });
    expect(res.status).toBe(400);
  });

  it('changes user role for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)                            // auth
      .mockResolvedValueOnce({ slug: 'manager', is_active: true }) // rbac_roles check
      .mockResolvedValueOnce({ id: 'user-1', role: 'manager' });   // UPDATE RETURNING

    const res = await request(app)
      .put('/users/user-1/role')
      .set(authHeader(makeAdminUser()))
      .send({ role: 'manager' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /audit ───────────────────────────────────────────────────────────────
describe('GET /audit — RBAC audit log', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/audit');
    expect(res.status).toBe(401);
  });

  it('returns audit log for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/audit').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
