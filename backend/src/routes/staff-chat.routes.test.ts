import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockDb, mockPool } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (client: unknown) => unknown) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      return fn(mockClient);
    }),
    getClient: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }),
    getPool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockDb, mockPool };
});

vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../services/av-scan-worker.js', () => ({
  enqueueAvScan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379 },
  },
}));
vi.mock('../services/web-push-notify.service.js', () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/storage.service.js', () => ({
  storageService: { saveFile: vi.fn(), deleteFile: vi.fn() },
}));
vi.mock('./chat/chat-shared.js', () => ({
  upload: { single: vi.fn(() => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next()) },
  uploadLimiter: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
  chatApiLimiter: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
  detectMessageType: vi.fn().mockReturnValue('text'),
  fixOriginalName: vi.fn(),
  getSocketServer: vi.fn(() => undefined),
}));

// ─── SUT ──────────────────────────────────────────────────────────────────────
let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./staff-chat.routes.js');
  app = createTestApp(router);
});

import { makeEmployeeUser, makeAdminUser, authHeader } from '../test-utils/mock-auth.js';

// Auth fixtures for db.queryOne (authenticateToken middleware)
const DB_EMPLOYEE = {
  id: 'employee-id', email: 'employee@example.com', role: 'employee',
  is_active: true, display_name: 'Employee', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_ADMIN = {
  id: 'admin-id', email: 'admin@example.com', role: 'admin',
  is_active: true, display_name: 'Admin', phone: null,
  force_password_change: false, last_password_change: null,
};

// Common DB fixtures
const CONV_ROW = { id: 'conv-1', type: 'general', title: 'Общий чат', created_at: new Date().toISOString() };
const DIRECT_ROW = { id: 'direct-1', type: 'direct', title: null, created_at: new Date().toISOString() };
const SELF_DIRECT_ROW = { id: 'self-direct-1', type: 'direct', title: 'Личный чат', created_at: new Date().toISOString() };
const OTHER_STAFF_ROW = { id: 'other-user-id', role: 'employee', is_active: true, is_system: false };
const MSG_ROW = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  content: 'Привет',
  sender_name: 'Employee',
  sender_id: 'employee-id', // must match makeEmployeeUser().id
  created_at: new Date().toISOString(),
  deleted_at: null,
};

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// Helper: mock auth + participation
function mockAuthAndParticipation(db_user: typeof DB_EMPLOYEE) {
  vi.mocked(mockDb.queryOne).mockResolvedValueOnce(db_user); // auth middleware
  vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ role: 'member' }] }); // requireParticipation
}

// ─── Unauthenticated access ────────────────────────────────────────────────────
describe('Authentication required for all routes', () => {
  beforeEach(resetMocks);

  it('GET /conversations returns 401 without auth', async () => {
    const res = await request(app).get('/conversations');
    expect(res.status).toBe(401);
  });

  it('POST /conversations returns 401 without auth', async () => {
    const res = await request(app).post('/conversations').send({ participantIds: ['user-2'] });
    expect(res.status).toBe(401);
  });

  it('GET /conversations/:id/messages returns 401 without auth', async () => {
    const res = await request(app).get('/conversations/conv-1/messages');
    expect(res.status).toBe(401);
  });

  it('POST /conversations/:id/messages returns 401 without auth', async () => {
    const res = await request(app).post('/conversations/conv-1/messages').send({ content: 'Hi' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /conversations ───────────────────────────────────────────────────────
describe('GET /conversations — list conversations', () => {
  beforeEach(resetMocks);

  it('returns conversations list for employee', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] }) // auto-join general chat
      .mockResolvedValueOnce({ rows: [] }) // re-activate general chat
      .mockResolvedValueOnce({ rows: [] }) // active staff backfill list
      .mockResolvedValueOnce({ rows: [CONV_ROW] }); // SELECT conversations

    const res = await request(app).get('/conversations').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('ensures direct conversations before returning the list', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] }) // auto-join general chat
      .mockResolvedValueOnce({ rows: [] }) // re-activate general chat
      .mockResolvedValueOnce({ rows: [{ id: 'employee-id' }, { id: 'other-user-id' }] }) // active staff
      .mockResolvedValueOnce({ rows: [SELF_DIRECT_ROW] }) // existing self-chat
      .mockResolvedValueOnce({ rows: [DIRECT_ROW] }) // existing colleague direct chat
      .mockResolvedValueOnce({ rows: [CONV_ROW, SELF_DIRECT_ROW, DIRECT_ROW] }); // SELECT conversations

    const res = await request(app).get('/conversations').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });
});

// ─── POST /conversations ─────────────────────────────────────────────────────
describe('POST /conversations — create conversation', () => {
  beforeEach(resetMocks);

  it('returns 400 if participantIds is empty', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);

    const res = await request(app)
      .post('/conversations')
      .set(authHeader(emp))
      .send({ type: 'direct', participantIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns existing direct conversation if already exists', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [OTHER_STAFF_ROW] }) // target validation
      .mockResolvedValueOnce({ rows: [{ id: 'conv-existing' }] }); // existing check

    const res = await request(app)
      .post('/conversations')
      .set(authHeader(emp))
      .send({ type: 'direct', participantIds: ['other-user-id'] });
    expect(res.status).toBe(200);
    expect(res.body.data.existing).toBe(true);
  });

  it('creates new group conversation', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ ...CONV_ROW, type: 'group', id: 'conv-new' }] }) // INSERT conv
      .mockResolvedValueOnce({ rows: [] }) // INSERT participant 1
      .mockResolvedValueOnce({ rows: [] }); // INSERT participant 2

    const res = await request(app)
      .post('/conversations')
      .set(authHeader(emp))
      .send({ type: 'group', title: 'Команда', participantIds: ['user-2', 'user-3'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ─── GET /conversations/:id/messages ─────────────────────────────────────────
describe('GET /conversations/:id/messages — list messages', () => {
  beforeEach(resetMocks);

  it('returns 403 if not a participant', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // requireParticipation: no rows = 403

    const res = await request(app).get('/conversations/conv-1/messages').set(authHeader(emp));
    expect(res.status).toBe(403);
  });

  it('returns messages for participant', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [MSG_ROW] }); // SELECT messages

    const res = await request(app).get('/conversations/conv-1/messages').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── POST /conversations/:id/messages ─────────────────────────────────────────
describe('POST /conversations/:id/messages — send message', () => {
  beforeEach(resetMocks);

  it('returns 400 if content is empty', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);

    const res = await request(app)
      .post('/conversations/conv-1/messages')
      .set(authHeader(emp))
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('sends message and returns created message', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ display_name: 'Employee', email: 'employee@test.com' }] }) // getSenderName
      .mockResolvedValueOnce({ rows: [MSG_ROW] }) // INSERT message
      .mockResolvedValueOnce({ rows: [] }) // UPDATE last_message_at
      .mockResolvedValueOnce({ rows: [] }); // notifyParticipants

    const res = await request(app)
      .post('/conversations/conv-1/messages')
      .set(authHeader(emp))
      .send({ content: 'Привет, коллеги!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /conversations/:id/read ──────────────────────────────────────────────
describe('PUT /conversations/:id/read — mark as read', () => {
  beforeEach(resetMocks);

  it('marks conversation as read', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // UPSERT read receipt

    const res = await request(app).put('/conversations/conv-1/read').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /contacts ────────────────────────────────────────────────────────────
describe('GET /contacts — list contacts for staff chat', () => {
  beforeEach(resetMocks);

  it('returns contacts list', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [
      { id: 'user-2', display_name: 'Коллега', email: 'colleague@test.com', role: 'employee' },
    ]});

    const res = await request(app).get('/contacts').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── GET /direct/:userId ──────────────────────────────────────────────────────
describe('GET /direct/:userId — get or create direct conversation', () => {
  beforeEach(resetMocks);

  it('returns existing direct conversation', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [OTHER_STAFF_ROW] }) // target validation
      .mockResolvedValueOnce({ rows: [DIRECT_ROW] }); // find existing

    const res = await request(app).get('/direct/other-user-id').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('creates a personal direct conversation with the current user', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'employee-id', role: 'employee', is_active: true, is_system: false }] })
      .mockResolvedValueOnce({ rows: [] }) // no existing self-chat
      .mockResolvedValueOnce({ rows: [SELF_DIRECT_ROW] }) // create self-chat
      .mockResolvedValueOnce({ rows: [] }); // add single participant

    const res = await request(app).get('/direct/employee-id').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Личный чат');
  });
});

// ─── PUT /conversations/:id/messages/:msgId ────────────────────────────────
describe('PUT /conversations/:id/messages/:msgId — edit message', () => {
  beforeEach(resetMocks);

  it('returns 400 if content is empty', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);

    const res = await request(app)
      .put('/conversations/conv-1/messages/msg-1')
      .set(authHeader(emp))
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('edits message and returns updated', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [MSG_ROW] }) // SELECT msg for ownership check
      .mockResolvedValueOnce({ rows: [{ ...MSG_ROW, content: 'Обновлённое сообщение' }] }); // UPDATE

    const res = await request(app)
      .put('/conversations/conv-1/messages/msg-1')
      .set(authHeader(emp))
      .send({ content: 'Обновлённое сообщение' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── DELETE /conversations/:id/messages/:msgId ────────────────────────────
describe('DELETE /conversations/:id/messages/:msgId — delete message', () => {
  beforeEach(resetMocks);

  it('soft-deletes message', async () => {
    const emp = makeEmployeeUser();
    mockAuthAndParticipation(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [MSG_ROW] })  // SELECT (ownership check)
      .mockResolvedValueOnce({ rows: [{ ...MSG_ROW, deleted_at: new Date().toISOString() }] }); // UPDATE deleted_at

    const res = await request(app)
      .delete('/conversations/conv-1/messages/msg-1')
      .set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
