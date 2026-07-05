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
vi.mock('../services/schedule-validation.service.js', () => ({
  validateShiftPattern: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  generateShiftsFromPattern: vi.fn().mockReturnValue([]),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./schedule.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const SCHEDULE_ROW = { id: 'sched-1', photographer_id: 'employee-id', day_of_week: 1, start_time: '09:00', end_time: '19:00', is_available: true };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// ─── GET /photographer/:id — public photographer schedule ─────────────────────
describe('GET /photographer/:id — public photographer schedule', () => {
  beforeEach(resetMocks);

  it('returns schedule for photographer (public, no auth)', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [SCHEDULE_ROW] });
    const res = await request(app).get('/photographer/emp-1');
    expect(res.status).toBe(200);
    expect(res.body.schedules).toBeDefined();
  });
});

// ─── POST / — create schedule entry (photographer only) ──────────────────────
describe('POST / — create schedule entry', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 if user is not a photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // photographers check → not found

    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ day_of_week: 1, start_time: '09:00', end_time: '19:00' });
    expect(res.status).toBe(403);
  });

  it('returns 400 if required fields missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ user_id: 'employee-id' }] }); // photographer check

    const res = await request(app)
      .post('/')
      .set(authHeader(makeEmployeeUser()))
      .send({ day_of_week: 1 }); // missing start_time and end_time
    expect(res.status).toBe(400);
  });

  it('creates schedule entry for photographer', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ user_id: 'employee-id' }] }) // photographer check
      .mockResolvedValueOnce({ rows: [SCHEDULE_ROW] }); // INSERT

    const res = await request(app)
      .post('/')
      .set(authHeader(makeEmployeeUser()))
      .send({ day_of_week: 1, start_time: '09:00', end_time: '19:00' });
    expect(res.status).toBe(201);
  });
});

// ─── PUT /:id — update schedule entry ────────────────────────────────────────
describe('PUT /:id — update schedule entry', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/sched-1').send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 if schedule entry not found', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // schedule not found

    const res = await request(app).put('/unknown').set(authHeader(makeEmployeeUser())).send({ is_available: false });
    expect(res.status).toBe(404);
  });

  it('updates schedule entry for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth (admin can update any)
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ photographer_id: 'some-photographer' }] }) // schedule lookup
      .mockResolvedValueOnce({ rows: [{ ...SCHEDULE_ROW, is_available: false }] }); // UPDATE

    const res = await request(app)
      .put('/sched-1')
      .set(authHeader(makeAdminUser()))
      .send({ is_available: false });
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /:id — delete schedule entry ─────────────────────────────────────
describe('DELETE /:id — delete schedule entry', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/sched-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 if schedule entry not found', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // schedule not found

    const res = await request(app).delete('/unknown').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(404);
  });

  it('deletes schedule entry for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ photographer_id: 'some-photographer' }] }) // schedule lookup
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    const res = await request(app).delete('/sched-1').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
  });
});

// ─── GET /preferences/:photographerId ────────────────────────────────────────
describe('GET /preferences/:photographerId — get schedule preferences', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/preferences/emp-1');
    expect(res.status).toBe(401);
  });

  it('returns preferences (or defaults) for photographer', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null);       // no prefs saved → returns defaults

    const res = await request(app).get('/preferences/emp-1').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    // returns defaults when no record exists
    expect(res.body.photographer_id).toBe('emp-1');
  });
});

// ─── POST /generate — auto-generate schedule ──────────────────────────────────
describe('POST /generate — generate schedule from dates', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/generate').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if start_date or end_date missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/generate')
      .set(authHeader(makeAdminUser()))
      .send({ start_date: '2026-03-01' }); // missing end_date
    expect(res.status).toBe(400);
  });

  it('generates schedule and returns 201', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    // 5 work days → 5 pool.query INSERT calls
    vi.mocked(mockPool.query).mockResolvedValue({ rows: [SCHEDULE_ROW] });

    const res = await request(app)
      .post('/generate')
      .set(authHeader(makeAdminUser()))
      .send({ start_date: '2026-03-01', end_date: '2026-03-07' });
    expect(res.status).toBe(201);
    expect(res.body.schedules).toBeDefined();
  });
});
