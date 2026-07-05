/**
 * Integration tests for /crm/clients routes.
 *
 * Requires authenticateToken + requirePermission('clients:view').
 * Covers: client lookup, order history, notes, timeline, merge.
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

vi.mock('../services/audit.service.js', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: crmClientsRouter } = await import('./crm-clients.routes.js');
const app = createTestApp(crmClientsRouter, '/');

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

describe('CRM Clients — global auth guard', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/?search=79001234567');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role (no clients:view permission)', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT); // auth

    const res = await request(app).get('/?search=79001234567').set(authHeader(client));
    expect(res.status).toBe(403);
  });
});

describe('GET / — search clients by phone', () => {
  beforeEach(() => resetMockDb());

  it('returns 400 if search query is too short', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app).get('/?search=123').set(authHeader(emp));
    expect(res.status).toBe(400);
  });

  it('returns client data for valid phone number', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { name: 'Иван Иванов', phone: '+79001234567', source: 'user', source_id: 'user-1' },
    ]);

    const res = await request(app).get('/?search=79001234567').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns empty array if no client found', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/?search=79999999999').set(authHeader(emp));

    expect(res.status).toBe(200);
  });
});

describe('GET /:phone/orders — client order history', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/79001234567/orders');
    expect(res.status).toBe(401);
  });

  it('returns orders for the client phone', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/79001234567/orders').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /:phone/notes — client notes', () => {
  beforeEach(() => resetMockDb());

  it('returns notes for the client phone', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/79001234567/notes').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /:phone/notes — create client note', () => {
  beforeEach(() => resetMockDb());

  it('returns 400 if content is missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/79001234567/notes')
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
  });

  it('creates note and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'note-1', created_at: new Date().toISOString() }]); // INSERT

    const res = await request(app)
      .post('/79001234567/notes')
      .set(authHeader(emp))
      .send({ text: 'VIP клиент' }); // note: field is 'text', not 'content'

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /:phone/notes/:noteId — delete client note', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/79001234567/notes/note-1');
    expect(res.status).toBe(401);
  });

  it('deletes note and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .delete('/79001234567/notes/note-1')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PATCH /:phone/notes/:noteId/pin — pin/unpin client note', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/79001234567/notes/note-1/pin');
    expect(res.status).toBe(401);
  });

  it('toggles pin and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .patch('/79001234567/notes/note-1/pin')
      .set(authHeader(emp))
      .send({ is_pinned: true });

    expect(res.status).toBe(200);
  });
});

describe('GET /:phone/timeline — client timeline', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/79001234567/timeline');
    expect(res.status).toBe(401);
  });

  it('returns timeline events', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/79001234567/timeline').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /:phone/chat-sessions — client chat sessions', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/79001234567/chat-sessions');
    expect(res.status).toBe(401);
  });

  it('returns chat sessions for client phone', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/79001234567/chat-sessions').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /merge — merge client profiles', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/merge').send({ primaryPhone: '+7', secondaryPhone: '+7' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if primary or secondary phone missing', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth

    const res = await request(app)
      .post('/merge')
      .set(authHeader(admin))
      .send({ primaryPhone: '+79001234567' }); // missing secondaryPhone

    expect(res.status).toBe(400);
  });
});

describe('POST /merge-preview — preview client merge', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/merge-preview').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if phones missing', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth

    const res = await request(app)
      .post('/merge-preview')
      .set(authHeader(admin))
      .send({});

    expect(res.status).toBe(400);
  });
});
