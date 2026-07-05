/**
 * Integration tests for /crm/inbox routes.
 *
 * Requires authenticateToken + requirePermission('inbox:view').
 * Covers: inbox feed, notes, bulk, tags, staff, CSAT, conversions.
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
  makeEmployeeUser,
  makeClientUser,
  authHeader,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
    redis: { host: 'localhost', port: 6379, password: undefined, tls: undefined },
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

vi.mock('ioredis', () => ({
  default: vi.fn(function RedisMock(this: Record<string, unknown>) {
    this['get'] = vi.fn().mockResolvedValue(null);
    this['set'] = vi.fn().mockResolvedValue('OK');
    this['on'] = vi.fn().mockReturnThis();
    this['connect'] = vi.fn().mockResolvedValue(undefined);
    this['quit'] = vi.fn().mockResolvedValue(undefined);
    return this;
  }),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: crmInboxRouter } = await import('./crm-inbox.routes.js');
const app = createTestApp(crmInboxRouter, '/');

// ─── DB auth fixtures ─────────────────────────────────────────────────────────

const DB_ADMIN = {
  id: 'admin-id', email: 'admin@example.com', role: 'admin',
  is_active: true, display_name: 'Admin', phone: null,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CRM Inbox — global auth guard', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/inbox');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role (no inbox:view)', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT); // auth

    const res = await request(app).get('/inbox').set(authHeader(client));
    expect(res.status).toBe(403);
  });
});

describe('GET /inbox — unified inbox feed', () => {
  beforeEach(() => resetMockDb());

  it('returns inbox items for employee', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // inbox items
      .mockResolvedValueOnce([]); // tags batch

    const res = await request(app).get('/inbox').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns inbox with filter=my', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(app).get('/inbox?filter=my').set(authHeader(emp));
    expect(res.status).toBe(200);
  });

  it('returns inbox with search query', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app).get('/inbox?search=Иван').set(authHeader(emp));
    expect(res.status).toBe(200);
  });
});

describe('GET /inbox/counts — inbox type counts', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/inbox/counts');
    expect(res.status).toBe(401);
  });

  it('returns counts for each type', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { type: 'chat', count: '5', unread: '2' },
      { type: 'task', count: '3', unread: '0' },
    ]);

    const res = await request(app).get('/inbox/counts').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /notes — list CRM notes', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/notes');
    expect(res.status).toBe(401);
  });

  it('returns 400 if entity_type or entity_id missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app).get('/notes').set(authHeader(emp));
    expect(res.status).toBe(400);
  });

  it('returns notes for entity', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/notes?entity_type=booking&entity_id=booking-uuid-1')
      .set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /notes — create CRM note', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/notes').send({ entity_type: 'booking', entity_id: 'id-1', content: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if entity_type, entity_id, or content missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app).post('/notes').set(authHeader(emp)).send({ content: 'test' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid entity_type', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/notes')
      .set(authHeader(emp))
      .send({ entity_type: 'invalid', entity_id: 'id-1', content: 'test' });
    expect(res.status).toBe(400);
  });

  it('creates note and returns 201', async () => {
    const emp = makeEmployeeUser();
    const noteRow = { id: 'note-1', entity_type: 'booking', entity_id: 'booking-1', content: 'test', created_at: new Date().toISOString() };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ display_name: 'Employee' }) // author lookup
      .mockResolvedValueOnce(noteRow); // INSERT

    const res = await request(app)
      .post('/notes')
      .set(authHeader(emp))
      .send({ entity_type: 'booking', entity_id: 'booking-uuid-1', content: 'Важная заметка' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /inbox/bulk — bulk session operations', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/inbox/bulk').send({ action: 'close', ids: ['id-1'] });
    expect(res.status).toBe(401);
  });

  it('returns 400 if action is missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/inbox/bulk')
      .set(authHeader(emp))
      .send({ ids: ['id-1'] });
    expect(res.status).toBe(400);
  });

  it('returns 400 if ids are missing or empty', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/inbox/bulk')
      .set(authHeader(emp))
      .send({ action: 'close', ids: [] });
    expect(res.status).toBe(400);
  });

  it('bulk-closes sessions and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'sess-1' }]); // UPDATE

    const res = await request(app)
      .post('/inbox/bulk')
      .set(authHeader(emp))
      .send({ action: 'close', ids: ['sess-1', 'sess-2'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /tags — list tags', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/tags');
    expect(res.status).toBe(401);
  });

  it('returns tags list', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'tag-1', name: 'ВИП', color: '#ff0000' }]);

    const res = await request(app).get('/tags').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /tags — create tag', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/tags').send({ name: 'NewTag' });
    expect(res.status).toBe(401);
  });

  it('creates tag and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'tag-2', name: 'Лояльный', color: '#00ff00' }]); // INSERT

    const res = await request(app)
      .post('/tags')
      .set(authHeader(emp))
      .send({ name: 'Лояльный', color: '#00ff00' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /sessions/:id/tags — tag a session', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/sessions/sess-1/tags').send({ tagId: 'tag-1' });
    expect(res.status).toBe(401);
  });

  it('tags session and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/sessions/sess-1/tags')
      .set(authHeader(emp))
      .send({ tagId: 'tag-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /sessions/:id/tags/:tagId — remove tag from session', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/sessions/sess-1/tags/tag-1');
    expect(res.status).toBe(401);
  });

  it('removes tag and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .delete('/sessions/sess-1/tags/tag-1')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /sessions/:id/tags — list session tags', () => {
  beforeEach(() => resetMockDb());

  it('returns tags for a session', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'tag-1', name: 'ВИП' }]);

    const res = await request(app).get('/sessions/sess-1/tags').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /staff/online — online staff status', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/staff/online');
    expect(res.status).toBe(401);
  });

  it('returns staff online status', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { id: 'employee-id', display_name: 'Employee', last_active: new Date().toISOString() },
    ]);

    const res = await request(app).get('/staff/online').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /csat-stats — CSAT statistics', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/csat-stats');
    expect(res.status).toBe(401);
  });

  it('returns CSAT data', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ avg: '4.5', total: '42' });

    const res = await request(app).get('/csat-stats').set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /conversion-stats — conversion statistics', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/conversion-stats');
    expect(res.status).toBe(401);
  });

  it('returns conversion data', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // total sessions
      .mockResolvedValueOnce([]); // orders

    const res = await request(app).get('/conversion-stats').set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
