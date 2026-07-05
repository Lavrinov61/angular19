/**
 * Integration tests for /orders routes.
 *
 * Covers: CRUD заказов, авторизация, пагинация.
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
    bridge: { url: 'http://localhost:5052' },
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

vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/task-auto.service.js', () => ({
  createTaskFromOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/partners.service.js', () => ({
  validatePartnerPromoCode: vi.fn().mockResolvedValue(null),
  recordReferral: vi.fn().mockResolvedValue(undefined),
  confirmReferral: vi.fn().mockResolvedValue(undefined),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: ordersRouter } = await import('./orders.routes.js');
const app = createTestApp(ordersRouter, '/');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** DB response for auth middleware user lookup (SELECT from users WHERE id = $1) */
const DB_ADMIN = {
  id: 'admin-id', email: 'admin@example.com', role: 'admin',
  is_active: true, display_name: 'Admin', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_CLIENT = {
  id: 'client-id', email: 'client@example.com', role: 'client',
  is_active: true, display_name: 'Client', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_OTHER_CLIENT = {
  id: 'other-client-id', email: 'other@example.com', role: 'client',
  is_active: true, display_name: 'Other', phone: null,
  force_password_change: false, last_password_change: null,
};

const DB_ORDER = {
  id: 'order-uuid-1',
  client_id: 'client-id',
  photographer_id: null,
  payment_id: null,
  amount: 500,
  status: 'pending_payment',
  service_type: 'photo',
  notes: null,
  total_amount: 500,
  type: 'product',
  metadata: JSON.stringify({ items: [], contact: { name: 'Иван', phone: '+79001234567' } }),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const VALID_ORDER_BODY = {
  items: [{ name: 'Фото на документы', qty: 1, price: 500 }],
  contact: { name: 'Иван Иванов', phone: '+79001234567' },
  totalAmount: 500,
  deliveryMethod: 'pickup',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST / — create order', () => {
  beforeEach(() => resetMockDb());

  it('creates order for anonymous user without auth', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ORDER);

    const res = await request(app).post('/').send(VALID_ORDER_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });

  it('creates order for authenticated user', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth middleware user lookup
      .mockResolvedValueOnce(DB_ORDER); // INSERT order

    const res = await request(app)
      .post('/')
      .set(authHeader(client))
      .send(VALID_ORDER_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 if items are missing', async () => {
    const res = await request(app)
      .post('/')
      .send({ contact: { name: 'A', phone: '+7' }, totalAmount: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 if items array is empty', async () => {
    const res = await request(app)
      .post('/')
      .send({ items: [], contact: { name: 'A', phone: '+7' }, totalAmount: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 if contact is missing', async () => {
    const res = await request(app)
      .post('/')
      .send({ items: [{ name: 'X' }], totalAmount: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 if contact.name is missing', async () => {
    const res = await request(app)
      .post('/')
      .send({ items: [{ name: 'X' }], contact: { phone: '+7' }, totalAmount: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 if totalAmount is zero', async () => {
    const res = await request(app)
      .post('/')
      .send({ items: [{ name: 'X' }], contact: { name: 'A', phone: '+7' }, totalAmount: 0 });

    expect(res.status).toBe(400);
  });

  it('increments promo code usage if promoCode is provided', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // UPDATE promotions
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ORDER);

    const res = await request(app)
      .post('/')
      .send({ ...VALID_ORDER_BODY, promoCode: 'SUMMER10' });

    expect(res.status).toBe(201);
    expect(vi.mocked(mockDb.query)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE promotions'),
      expect.arrayContaining(['SUMMER10']),
    );
  });
});

describe('GET / — list orders', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns paginated orders for admin', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ total: '2' }); // COUNT
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_ORDER, DB_ORDER]);

    const res = await request(app).get('/').set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('pagination');
  });

  it('client can see own orders', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce({ total: '1' }); // COUNT
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_ORDER]);

    const res = await request(app).get('/').set(authHeader(client));

    expect(res.status).toBe(200);
  });

  it('client returns 403 when requesting another client orders', async () => {
    const client = makeClientUser({ id: 'client-id' });
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT); // auth

    const res = await request(app)
      .get('/?clientId=other-client-id')
      .set(authHeader(client));

    expect(res.status).toBe(403);
  });
});

describe('GET /my-history — photo print order history', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/my-history');
    expect(res.status).toBe(401);
  });

  it('returns order history for authenticated user', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce({ total: '0' }); // COUNT
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/my-history').set(authHeader(client));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /:id — get order details', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/order-uuid-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 if order not found', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null); // order not found

    const res = await request(app)
      .get('/nonexistent-order')
      .set(authHeader(admin));

    expect(res.status).toBe(404);
  });

  it('admin can view any order', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(DB_ORDER); // order
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // comments

    const res = await request(app)
      .get('/order-uuid-1')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });

  it('client returns 403 for another user order', async () => {
    const client = makeClientUser({ id: 'other-client-id' });
    const order = { ...DB_ORDER, client_id: 'someone-else', photographer_id: null };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_OTHER_CLIENT) // auth
      .mockResolvedValueOnce(order); // order

    const res = await request(app)
      .get('/order-uuid-1')
      .set(authHeader(client));

    expect(res.status).toBe(403);
  });

  it('client can view own order', async () => {
    const client = makeClientUser({ id: 'client-id' });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_CLIENT) // auth
      .mockResolvedValueOnce(DB_ORDER); // order
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // comments

    const res = await request(app)
      .get('/order-uuid-1')
      .set(authHeader(client));

    expect(res.status).toBe(200);
  });
});

describe('PUT /:id/status — update order status', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/order-uuid-1/status').send({ status: 'completed' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if status not provided', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth

    const res = await request(app)
      .put('/order-uuid-1/status')
      .set(authHeader(admin))
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 if order not found', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null); // UPDATE returns null

    const res = await request(app)
      .put('/order-uuid-1/status')
      .set(authHeader(admin))
      .send({ status: 'completed' });

    expect(res.status).toBe(404);
  });

  it('updates order status and returns 200', async () => {
    const admin = makeAdminUser();
    const updated = { ...DB_ORDER, status: 'completed', client_id: 'client-id', metadata: '{}' };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(updated); // UPDATE

    const res = await request(app)
      .put('/order-uuid-1/status')
      .set(authHeader(admin))
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /:id/comments — add order comment', () => {
  beforeEach(() => resetMockDb());

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/order-uuid-1/comments').send({ comment: 'test' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if comment is missing', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth

    const res = await request(app)
      .post('/order-uuid-1/comments')
      .set(authHeader(admin))
      .send({});

    expect(res.status).toBe(400);
  });

  it('creates comment and returns 201', async () => {
    const admin = makeAdminUser();
    const comment = {
      id: 'comment-1', order_id: 'order-uuid-1', user_id: 'admin-id',
      comment: 'Готово', created_at: new Date().toISOString(),
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(comment); // INSERT

    const res = await request(app)
      .post('/order-uuid-1/comments')
      .set(authHeader(admin))
      .send({ comment: 'Готово' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
