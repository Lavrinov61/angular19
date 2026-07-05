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

const STUDIO_ROW = { id: 'studio-1', name: 'Центр', location_code: 'CEN', is_active: true };
const BOOKING_ROW = { id: 'booking-1', studio_id: 'studio-1', booking_date: '2026-03-10', start_time: '10:00', end_time: '11:00', status: 'pending' };

vi.mock('../services/booking-autonomous.service.js', () => ({
  getAvailableSlots: vi.fn().mockResolvedValue([]),
  createBooking: vi.fn().mockResolvedValue({ success: true, bookingId: 'booking-1' }),
  getBookings: vi.fn().mockResolvedValue({ bookings: [], total: 0 }),
  getBookingById: vi.fn().mockResolvedValue(null),
  updateBookingStatus: vi.fn().mockResolvedValue(null),
  rescheduleBooking: vi.fn().mockResolvedValue(null),
  getScheduleOverview: vi.fn().mockResolvedValue({}),
  getStudios: vi.fn().mockResolvedValue([STUDIO_ROW]),
  searchClients: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/client-context.service.js', () => ({
  getClientContext: vi.fn().mockResolvedValue(null),
  getClientContextByUserId: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));

const bookingService = await import('../services/booking-autonomous.service.js');

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./crm-booking.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(bookingService.createBooking).mockReset().mockResolvedValue({ success: true, bookingId: 'booking-1' });
}

// router.use(authenticateToken, requirePermission('bookings:manage'))
// employee has bookings:manage
// NOTE: per-route authenticateToken also present → double auth calls

function mockDoubleAuth(dbUser: typeof DB_EMPLOYEE) {
  vi.mocked(mockDb.queryOne)
    .mockResolvedValueOnce(dbUser) // router.use auth
    .mockResolvedValueOnce(dbUser); // per-route auth
}

describe('GET /studios — list studios', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/studios');
    expect(res.status).toBe(401);
  });

  it('returns studios list for employee', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app).get('/studios').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.studios).toBeDefined();
  });
});

describe('GET /slots — available slots', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/slots');
    expect(res.status).toBe(401);
  });

  it('returns 400 without required params', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app).get('/slots').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(400);
  });

  it('returns available slots', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .get('/slots?studioId=studio-1&date=2026-03-10')
      .set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

describe('GET /list — booking list', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/list');
    expect(res.status).toBe(401);
  });

  it('returns booking list for employee', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app).get('/list').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
  });
});

describe('GET /clients/search — search clients', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/clients/search');
    expect(res.status).toBe(401);
  });

  it('searches clients for employee', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .get('/clients/search?q=Иван')
      .set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.clients).toBeDefined();
  });
});

describe('POST /book — create booking', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/book').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if required fields missing', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .post('/book')
      .set(authHeader(makeEmployeeUser()))
      .send({ studioId: 'studio-1' }); // missing date, time, clientName, clientPhone
    expect(res.status).toBe(400);
  });

  it('creates booking for employee', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .post('/book')
      .set(authHeader(makeEmployeeUser()))
      .send({
        studioId: 'studio-1',
        date: '2026-03-10',
        time: '10:00',
        clientName: 'Иван Иванов',
        clientPhone: '+79001234567',
      });
    expect(res.status).toBe(201);
    expect(bookingService.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '79001234567',
    }));
  });

  it('creates booking with unknown phone placeholder', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .post('/book')
      .set(authHeader(makeEmployeeUser()))
      .send({
        studioId: 'studio-1',
        date: '2026-03-10',
        time: '10:00',
        clientName: 'Вера',
        clientPhone: '?',
      });

    expect(res.status).toBe(201);
    expect(bookingService.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '?',
    }));
  });

  it('rejects short phone that is not the unknown placeholder', async () => {
    mockDoubleAuth(DB_EMPLOYEE);
    const res = await request(app)
      .post('/book')
      .set(authHeader(makeEmployeeUser()))
      .send({
        studioId: 'studio-1',
        date: '2026-03-10',
        time: '10:00',
        clientName: 'Вера',
        clientPhone: '123',
      });

    expect(res.status).toBe(400);
    expect(bookingService.createBooking).not.toHaveBeenCalled();
  });
});
