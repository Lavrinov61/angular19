import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb, mockPool } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({})),
  };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockDb, mockPool };
});

vi.mock('../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined), createOrGroup: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/task-ai.service.js', () => ({
  generateHandoffSummary: vi.fn().mockResolvedValue('Summary'),
  generateShiftBriefing: vi.fn().mockResolvedValue('Briefing'),
}));
vi.mock('../services/client-context.service.js', () => ({
  getClientContext: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/ai-crm.service.js', () => ({
  scoreTaskPriority: vi.fn().mockResolvedValue('normal'),
  autoAssignTask: vi.fn().mockResolvedValue(null),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./tasks.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

// Double auth: router.use(authenticateToken) + individual route authenticateToken
function mockAuth(dbUser: typeof DB_EMPLOYEE) {
  vi.mocked(mockDb.queryOne)
    .mockResolvedValueOnce(dbUser) // router.use authenticateToken
    .mockResolvedValueOnce(dbUser); // route-level authenticateToken
}

const TASK_ROW = { id: 'task-1', task_type: 'retouch', title: 'Ретушь фото', status: 'pending', priority: 'normal', created_at: new Date().toISOString() };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// ─── GET /employees ────────────────────────────────────────────────────────────
describe('GET /employees — list employees', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/employees');
    expect(res.status).toBe(401);
  });

  it('returns employee list for admin', async () => {
    mockAuth(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE]);

    const res = await request(app).get('/employees').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── GET / — list tasks ───────────────────────────────────────────────────────
describe('GET / — list tasks', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns task list for employee', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([TASK_ROW]) // tasks
      .mockResolvedValueOnce([{ count: '1' }]); // total count

    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /board — kanban board ────────────────────────────────────────────────
describe('GET /board — kanban board', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/board');
    expect(res.status).toBe(401);
  });

  it('returns board data for employee', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app).get('/board').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /my — my tasks ───────────────────────────────────────────────────────
describe('GET /my — my tasks', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/my');
    expect(res.status).toBe(401);
  });

  it('returns tasks assigned to current user', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([TASK_ROW]);

    const res = await request(app).get('/my').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /:id — task detail ───────────────────────────────────────────────────
describe('GET /:id — task detail', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/task-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown task', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null); // task not found

    const res = await request(app).get('/unknown-task-id').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(404);
  });

  it('returns task details', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(TASK_ROW) // task found
      .mockResolvedValueOnce(null);    // handoff not found
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([])  // notes
      .mockResolvedValueOnce([]); // linked tasks

    const res = await request(app).get('/task-1').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST / — create task ─────────────────────────────────────────────────────
describe('POST / — create task', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/').send({ task_type: 'retouch', title: 'Test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if task_type or title missing', async () => {
    mockAuth(DB_EMPLOYEE);

    const res = await request(app)
      .post('/')
      .set(authHeader(makeEmployeeUser()))
      .send({ title: 'Test' }); // missing task_type
    expect(res.status).toBe(400);
  });

  it('creates task and returns 201', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null) // getCurrentShift
      .mockResolvedValueOnce(TASK_ROW); // INSERT task

    const res = await request(app)
      .post('/')
      .set(authHeader(makeEmployeeUser()))
      .send({ task_type: 'retouch', title: 'Ретушь фото', client_name: 'Иван' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /:id/status — update task status ────────────────────────────────────
describe('PUT /:id/status — update task status', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/task-1/status').send({ status: 'in_progress' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if status is missing', async () => {
    mockAuth(DB_EMPLOYEE);
    const res = await request(app)
      .put('/task-1/status')
      .set(authHeader(makeEmployeeUser()))
      .send({});
    expect(res.status).toBe(400);
  });

  it('updates task status', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(TASK_ROW)                              // find task
      .mockResolvedValueOnce({ ...TASK_ROW, status: 'in_progress' }); // UPDATE RETURNING

    const res = await request(app)
      .put('/task-1/status')
      .set(authHeader(makeEmployeeUser()))
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});

// ─── POST /:id/notes — add note ───────────────────────────────────────────────
describe('POST /:id/notes — add note to task', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/task-1/notes').send({ content: 'Test note' });
    expect(res.status).toBe(401);
  });

  it('adds note to task', async () => {
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(TASK_ROW) // task exists
      .mockResolvedValueOnce({ id: 'note-1', content: 'Test note' }); // INSERT note

    const res = await request(app)
      .post('/task-1/notes')
      .set(authHeader(makeEmployeeUser()))
      .send({ content: 'Test note' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
