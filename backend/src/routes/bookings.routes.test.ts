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
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/task-auto.service.js', () => ({
  createTaskFromBooking: vi.fn().mockResolvedValue(undefined),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./bookings.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, makeClientUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };
const DB_CLIENT = { id: 'client-id', email: 'client@example.com', role: 'client', is_active: true, display_name: 'Client', phone: null, force_password_change: false, last_password_change: null };

const BOOKING = {
  id: 'booking-1', client_id: 'client-id', photographer_id: 'employee-id',
  service_id: 'svc-1', status: 'confirmed',
  start_time: new Date().toISOString(), end_time: new Date().toISOString(),
  price: JSON.stringify({ totalPrice: 3000, currency: 'RUB' }),
  created_at: new Date().toISOString(),
};

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// bookings uses router.use(authenticateToken) — single auth

// ─── GET / — list bookings ────────────────────────────────────────────────────
describe('GET / — list bookings', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns bookings for client (own bookings)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    vi.mocked(mockDb.query).mockResolvedValueOnce([BOOKING]);

    const res = await request(app).get('/').set(authHeader(makeClientUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns all bookings for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([BOOKING]);

    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /:id — booking detail ────────────────────────────────────────────────
describe('GET /:id — booking detail', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/booking-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown booking', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce(null);     // booking not found

    const res = await request(app).get('/unknown-booking').set(authHeader(makeClientUser()));
    expect(res.status).toBe(404);
  });

  it('returns booking details for owner', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce(BOOKING);  // booking found

    const res = await request(app).get('/booking-1').set(authHeader(makeClientUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ─── POST / — create booking ──────────────────────────────────────────────────
describe('POST / — create booking', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if required fields missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);

    const res = await request(app)
      .post('/')
      .set(authHeader(makeClientUser()))
      .send({ serviceId: 'svc-1' }); // missing startTime, endTime
    expect(res.status).toBe(400);
  });

  it('returns 400 if time slot conflict', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT);
    vi.mocked(mockDb.query).mockResolvedValueOnce([{ id: 'booking-conflict' }]); // conflicts found

    const res = await request(app)
      .post('/')
      .set(authHeader(makeClientUser()))
      .send({
        serviceId: 'svc-1',
        photographerId: 'employee-id',
        startTime: '2026-03-05T10:00:00Z',
        endTime: '2026-03-05T12:00:00Z',
        price: { totalPrice: 3000 },
      });
    expect(res.status).toBe(400);
  });

  it('creates booking successfully', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT)  // auth
      .mockResolvedValueOnce(BOOKING);   // INSERT booking

    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // no conflicts

    const res = await request(app)
      .post('/')
      .set(authHeader(makeClientUser()))
      .send({
        serviceId: 'svc-1',
        photographerId: 'employee-id',
        startTime: '2026-03-05T10:00:00Z',
        endTime: '2026-03-05T12:00:00Z',
        price: { totalPrice: 3000 },
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /:id/status — update booking status ──────────────────────────────────
describe('PUT /:id/status — update booking status', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/booking-1/status').send({ status: 'cancelled' });
    expect(res.status).toBe(401);
  });

  it('returns 404 if booking not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce(null);     // booking not found

    const res = await request(app).put('/unknown/status').set(authHeader(makeClientUser())).send({ status: 'cancelled' });
    expect(res.status).toBe(404);
  });

  it('cancels booking for client', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT)                            // auth
      .mockResolvedValueOnce(BOOKING)                              // find booking
      .mockResolvedValueOnce({ ...BOOKING, status: 'cancelled' }); // UPDATE RETURNING

    const res = await request(app)
      .put('/booking-1/status')
      .set(authHeader(makeClientUser()))
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
