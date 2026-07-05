/**
 * Integration tests for /users routes.
 *
 * Covers: CRUD пользователей и RBAC enforcement.
 * Failing tests = bugs to fix in production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeAdminUser,
  makeEmployeeUser,
  makeClientUser,
  authHeader,
  makeUser,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

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
  blacklistAllUserTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
  invalidateAuthCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../services/phone-otp-event.service.js', () => ({
  recordPhoneOtpEventSafely: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/audit.js', () => ({
  auditLog: (_action: string) => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../utils/password-validator.js', () => ({
  validatePasswordStrength: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: usersRouter } = await import('./users.routes.js');
const { validatePasswordStrength } = await import('../utils/password-validator.js');
const { blacklistAllUserTokens } = await import('../services/token-blacklist.service.js');
const { invalidateAuthCache } = await import('../services/auth-cache.service.js');
const { logAudit } = await import('../services/audit.service.js');
const { recordPhoneOtpEventSafely } = await import('../services/phone-otp-event.service.js');

const app = createTestApp(usersRouter, '/');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DB_ADMIN = {
  id: 'admin-id',
  email: 'admin@example.com',
  role: 'admin',
  is_active: true,
  display_name: 'Admin User',
  force_password_change: false,
  last_password_change: null,
};

const DB_EMPLOYEE = {
  id: 'employee-id',
  email: 'employee@example.com',
  role: 'employee',
  is_active: true,
  display_name: 'Employee',
  force_password_change: false,
  last_password_change: null,
};

const DB_CLIENT = {
  id: 'client-id',
  email: 'client@example.com',
  role: 'client',
  is_active: true,
  display_name: 'Client',
  force_password_change: false,
  last_password_change: null,
};

const USER_PROFILE = {
  id: 'client-id',
  email: 'client@example.com',
  username: null,
  display_name: 'Client',
  first_name: null,
  last_name: null,
  department: null,
  phone: null,
  photo_url: null,
  role: 'client',
  email_verified: true,
  phone_verified: false,
  is_active: true,
  personal_data: null,
  preferences: null,
  linked_accounts: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /users/me', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with user profile for authenticated user', async () => {
    vi.mocked(mockDb.queryOne)
      // authenticateToken DB lookup
      .mockResolvedValueOnce(DB_CLIENT as never)
      // /me handler profile query
      .mockResolvedValueOnce(USER_PROFILE as never);

    const client = makeClientUser();
    const res = await request(app)
      .get('/me')
      .set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('client@example.com');
  });

  it('returns 404 when user does not exist in DB after auth', async () => {
    vi.mocked(mockDb.queryOne)
      // authenticateToken: user exists
      .mockResolvedValueOnce(DB_CLIENT as never)
      // /me handler: user not found (race condition or deleted)
      .mockResolvedValueOnce(null);

    const client = makeClientUser();
    const res = await request(app)
      .get('/me')
      .set(authHeader(client));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /users/me', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .put('/me')
      .send({ display_name: 'New Name' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with updated profile', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce({ ...USER_PROFILE, display_name: 'New Name' } as never);

    const client = makeClientUser();
    const res = await request(app)
      .put('/me')
      .set(authHeader(client))
      .send({ display_name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.display_name).toBe('New Name');
  });

  it('returns 400 when no fields to update are provided', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT as never);

    const client = makeClientUser();
    const res = await request(app)
      .put('/me')
      .set(authHeader(client))
      .send({}); // empty body

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/No fields to update/);
  });
});

describe('POST /users/me/phone-requirement-skip', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(invalidateAuthCache).mockClear();
    vi.mocked(logAudit).mockClear();
    vi.mocked(recordPhoneOtpEventSafely).mockClear();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/me/phone-requirement-skip')
      .send({ attemptedPhone: '79990000000' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('persists the phone requirement skip for a user without phone', async () => {
    const skippedAt = '2026-05-16T10:00:00.000Z';
    const updatedProfile = {
      ...USER_PROFILE,
      preferences: {
        phoneRequirementSkippedAt: skippedAt,
        phoneRequirementSkipReason: 'voice_call_not_received',
        phoneRequirementSkipSource: 'complete_profile',
      },
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT as never)
      .mockResolvedValueOnce(USER_PROFILE as never)
      .mockResolvedValueOnce(updatedProfile as never);

    const client = makeClientUser();
    const res = await request(app)
      .post('/me/phone-requirement-skip')
      .set(authHeader(client))
      .send({ attemptedPhone: '79990000000' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preferences.phoneRequirementSkippedAt).toBe(skippedAt);

    const updateCall = vi.mocked(mockDb.queryOne).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('phoneRequirementSkippedAt'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual(['client-id']);
    expect(invalidateAuthCache).toHaveBeenCalledWith('client-id');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'phone_requirement_skipped',
      entityType: 'user',
      entityId: 'client-id',
      details: { reason: 'voice_call_not_received' },
    }));
    expect(recordPhoneOtpEventSafely).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'client-id',
      phone: '79990000000',
      eventType: 'phone_requirement_skipped',
    }));
  });

  it('returns 409 when the account already has a phone', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({ ...DB_CLIENT, phone: '79990000000' } as never)
      .mockResolvedValueOnce({ ...USER_PROFILE, phone: '79990000000' } as never);

    const client = makeClientUser();
    const res = await request(app)
      .post('/me/phone-requirement-skip')
      .set(authHeader(client))
      .send({ attemptedPhone: '79990000000' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(invalidateAuthCache).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    expect(recordPhoneOtpEventSafely).not.toHaveBeenCalled();
  });
});

describe('DELETE /users/me', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(blacklistAllUserTokens).mockClear();
    vi.mocked(invalidateAuthCache).mockClear();
    vi.mocked(logAudit).mockClear();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).delete('/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('anonymizes current user and clears auth state', async () => {
    const deletedUser = {
      id: 'client-id',
      email: 'deleted+client-id@svoefoto.local',
      display_name: 'Удалённый пользователь',
      is_active: false,
    };
    const transactionClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [deletedUser] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT as never);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn) => fn(transactionClient));

    const client = makeClientUser();
    const res = await request(app)
      .delete('/me')
      .set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ ...deletedUser, deleted: true });

    expect(transactionClient.query).toHaveBeenCalledTimes(4);
    const updateCall = transactionClient.query.mock.calls[0];
    expect(updateCall?.[0]).toEqual(expect.stringContaining('UPDATE users'));
    expect(updateCall?.[0]).toEqual(expect.stringContaining('phone = NULL'));
    expect(updateCall?.[0]).toEqual(expect.stringContaining('vk_id = NULL'));
    expect(updateCall?.[0]).toEqual(expect.stringContaining('is_active = false'));
    expect(updateCall?.[1]).toEqual(['client-id', 'deleted+client-id@svoefoto.local']);
    expect(transactionClient.query.mock.calls[1]?.[0]).toEqual(expect.stringContaining('DELETE FROM refresh_tokens'));
    expect(transactionClient.query.mock.calls[2]?.[0]).toEqual(expect.stringContaining('DELETE FROM pending_oauth_links'));
    expect(transactionClient.query.mock.calls[3]?.[0]).toEqual(expect.stringContaining('DELETE FROM password_reset_tokens'));

    expect(blacklistAllUserTokens).toHaveBeenCalledWith('client-id');
    expect(invalidateAuthCache).toHaveBeenCalledWith('client-id');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'account_deleted_self',
      entityType: 'user',
      entityId: 'client-id',
      details: { anonymized: true },
    }));
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('access_token=;'),
      expect.stringContaining('refresh_token=;'),
    ]));
  });

  it('returns 404 when current user disappears before anonymization', async () => {
    const transactionClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    };

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT as never);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn) => fn(transactionClient));

    const client = makeClientUser();
    const res = await request(app)
      .delete('/me')
      .set(authHeader(client));

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(blacklistAllUserTokens).not.toHaveBeenCalled();
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });
});

describe('GET /users', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for employee user (lacks users:manage permission)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .get('/')
      .set(authHeader(employee));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for client user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT as never);

    const client = makeClientUser();
    const res = await request(app)
      .get('/')
      .set(authHeader(client));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with users list for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);
    vi.mocked(mockDb.query).mockResolvedValueOnce([USER_PROFILE] as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters users by role query param', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE] as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/?role=employee')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    // Verify query was called with role filter
    const queryCalls = vi.mocked(mockDb.query).mock.calls;
    const usersQuery = queryCalls.find(call => typeof call[0] === 'string' && call[0].includes('FROM users'));
    expect(usersQuery).toBeDefined();
    expect(usersQuery![1]).toContain('employee');
  });
});

describe('POST /users', () => {
  beforeEach(() => {
    resetMockDb();
    vi.mocked(validatePasswordStrength).mockReturnValue({ valid: true, errors: [] });
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/')
      .send({ email: 'new@example.com', display_name: 'New', role: 'employee', password: 'Pass1234!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for employee (no users:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(employee))
      .send({ email: 'new@example.com', display_name: 'New', role: 'employee', password: 'Pass1234!' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when required fields are missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({ email: 'new@example.com' }); // missing display_name, password, role

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid role', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never)
      .mockResolvedValueOnce(null); // no existing user

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({ email: 'new@example.com', display_name: 'New', role: 'superadmin', password: 'Pass1234!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 409 when email already exists', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never) // auth
      .mockResolvedValueOnce({ id: 'existing' } as never); // existing user check

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({ email: 'existing@example.com', display_name: 'New', role: 'employee', password: 'Pass1234!' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('returns 201 with created user when data is valid', async () => {
    const newUserRecord = {
      id: 'new-id',
      email: 'new@example.com',
      display_name: 'New User',
      first_name: null,
      last_name: null,
      department: null,
      phone: null,
      role: 'employee',
      is_active: true,
      created_at: new Date().toISOString(),
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never) // auth
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce(newUserRecord as never); // INSERT RETURNING

    vi.mocked(mockDb.query).mockResolvedValue([] as never); // fire-and-forget queries

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({ email: 'new@example.com', display_name: 'New User', role: 'employee', password: 'Str0ngPass!23' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('new@example.com');
  });

  it('derives display_name="Петров Иван" from first_name/last_name when display_name omitted', async () => {
    const createdRecord = {
      id: 'new-id',
      email: 'ivan@example.com',
      display_name: 'Петров Иван',
      first_name: 'Иван',
      last_name: 'Петров',
      department: null,
      phone: null,
      role: 'employee',
      is_active: true,
      created_at: new Date().toISOString(),
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never) // auth
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce(createdRecord as never); // INSERT RETURNING

    vi.mocked(mockDb.query).mockResolvedValue([] as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({
        email: 'ivan@example.com',
        first_name: 'Иван',
        last_name: 'Петров',
        role: 'employee',
        password: 'Str0ngPass!23',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.display_name).toBe('Петров Иван');

    // Verify что в INSERT прилетело computedName='Петров Иван' на позиции 2 и first/last на 3/4
    const insertCall = vi.mocked(mockDb.queryOne).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO users'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[1]).toBe('Петров Иван'); // computedName
    expect(params[2]).toBe('Иван'); // first_name
    expect(params[3]).toBe('Петров'); // last_name
  });

  it('returns 400 for invalid department on POST', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never); // auth only

    const admin = makeAdminUser();
    const res = await request(app)
      .post('/')
      .set(authHeader(admin))
      .send({
        email: 'new@example.com',
        display_name: 'New User',
        department: 'invalid-dept',
        role: 'employee',
        password: 'Str0ngPass!23',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/department/);
  });
});

describe('PUT /users/:id', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .put('/some-user-id')
      .send({ display_name: 'Updated' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for employee (no users:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .put('/some-user-id')
      .set(authHeader(employee))
      .send({ display_name: 'Updated' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid role', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .put('/some-user-id')
      .set(authHeader(admin))
      .send({ role: 'invalid-role' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with department when PUT {department: "retouching"}', async () => {
    const updatedRecord = {
      id: 'some-user-id',
      email: 'user@example.com',
      display_name: 'User',
      first_name: null,
      last_name: null,
      department: 'retouching',
      phone: null,
      role: 'employee',
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never) // auth
      .mockResolvedValueOnce(updatedRecord as never); // UPDATE RETURNING

    const admin = makeAdminUser();
    const res = await request(app)
      .put('/some-user-id')
      .set(authHeader(admin))
      .send({ department: 'retouching' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.department).toBe('retouching');
  });

  it('returns 400 for invalid department on PUT', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .put('/some-user-id')
      .set(authHeader(admin))
      .send({ department: 'invalid-dept' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/department/);
  });
});

describe('GET /users/staff-list', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/staff-list');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('filters staff by department query param', async () => {
    const photographyStaff = [
      {
        id: 'photographer-1',
        display_name: 'Фотограф Один',
        first_name: 'Один',
        last_name: 'Фотограф',
        department: 'photography',
        photo_url: null,
        role: 'photographer',
      },
    ];

    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce(photographyStaff as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .get('/staff-list?department=photography')
      .set(authHeader(employee));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const queryCalls = vi.mocked(mockDb.query).mock.calls;
    const staffQuery = queryCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('FROM users') && call[0].includes('department'),
    );
    expect(staffQuery).toBeDefined();
    expect(staffQuery![1]).toContain('photography');
  });

  it('returns 400 for invalid department in staff-list', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .get('/staff-list?department=invalid-dept')
      .set(authHeader(employee));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/department/);
  });
});

describe('GET /users — search by last_name', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('search query includes first_name/last_name in ILIKE filter', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);
    vi.mocked(mockDb.query).mockResolvedValueOnce([] as never);

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/?search=бутенко')
      .set(authHeader(admin));

    expect(res.status).toBe(200);

    const queryCalls = vi.mocked(mockDb.query).mock.calls;
    const usersQuery = queryCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('FROM users'),
    );
    expect(usersQuery).toBeDefined();
    expect(usersQuery![0] as string).toMatch(/first_name ILIKE/);
    expect(usersQuery![0] as string).toMatch(/last_name ILIKE/);
    expect(usersQuery![1]).toContain('%бутенко%');
  });
});

describe('DELETE /users/:id', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).delete('/some-user-id');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for employee (no users:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE as never);

    const employee = makeEmployeeUser();
    const res = await request(app)
      .delete('/some-user-id')
      .set(authHeader(employee));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  /**
   * BUG DETECTION: self-deactivation returns 400 but SHOULD return 403.
   * 400 = Bad Request (wrong syntax/format), 403 = Forbidden (correct semantics).
   * "You cannot deactivate yourself" is an authorization decision, not a bad request.
   * Test FAILS until fixed in users.routes.ts:
   *   throw new AppError(400, ...) → throw new AppError(403, ...)
   */
  it('returns 403 when admin tries to deactivate themselves (self-deactivation forbidden)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN as never);

    const admin = makeAdminUser({ id: 'admin-id' });
    const res = await request(app)
      .delete('/admin-id') // same ID as the authenticated admin
      .set(authHeader(admin));

    // Should not be allowed to deactivate yourself — and 403 is the correct semantic status
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('deactivates (not deletes) user — UPDATE users SET is_active=false', async () => {
    const targetUserId = 'other-user-id';
    const deactivatedUser = {
      id: targetUserId,
      email: 'other@example.com',
      display_name: 'Other User',
      is_active: false,
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN as never) // authenticateToken
      .mockResolvedValueOnce(deactivatedUser as never); // UPDATE ... RETURNING

    const admin = makeAdminUser({ id: 'admin-id' });
    const res = await request(app)
      .delete(`/${targetUserId}`)
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_active).toBe(false);

    // Verify it's an UPDATE (deactivation), not a DELETE
    const queryOneCalls = vi.mocked(mockDb.queryOne).mock.calls;
    const deleteFromCall = queryOneCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM users'),
    );
    expect(deleteFromCall).toBeUndefined(); // No hard delete

    const updateCall = queryOneCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('is_active = false'),
    );
    expect(updateCall).toBeDefined(); // Soft deactivation via UPDATE
  });
});
