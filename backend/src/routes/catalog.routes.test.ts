import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));

const CAT = { id: 'cat-1', name: 'Фото', slug: 'photo', is_active: true };
const PROD = { id: 'prod-1', name: 'Стандарт', sku: 'STD-01', price: 500, is_active: true };

vi.mock('../services/catalog.service.js', () => ({
  getCategories: vi.fn().mockResolvedValue([CAT]),
  getAllCategories: vi.fn().mockResolvedValue([CAT]),
  createCategory: vi.fn().mockResolvedValue(CAT),
  updateCategory: vi.fn().mockResolvedValue(CAT),
  deleteCategory: vi.fn().mockResolvedValue(undefined),
  getProducts: vi.fn().mockResolvedValue({ products: [PROD], total: 1 }),
  getProductById: vi.fn().mockResolvedValue(PROD),
  getProductByBarcode: vi.fn().mockResolvedValue(null),
  createProduct: vi.fn().mockResolvedValue(PROD),
  updateProduct: vi.fn().mockResolvedValue(PROD),
  deactivateProduct: vi.fn().mockResolvedValue(undefined),
  getStock: vi.fn().mockResolvedValue([]),
  updateStock: vi.fn().mockResolvedValue(undefined),
  adjustStock: vi.fn().mockResolvedValue(undefined),
  importProducts: vi.fn().mockResolvedValue({ imported: 0, errors: [] }),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./catalog.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

describe('GET /categories — public', () => {
  it('returns categories without auth', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
  });
});

describe('GET /products — public', () => {
  it('returns products without auth', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
  });
});

describe('POST /categories — catalog:manage required', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/categories').send({ name: 'Новая' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no catalog:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app)
      .post('/categories')
      .set(authHeader(makeEmployeeUser()))
      .send({ name: 'Новая' });
    expect(res.status).toBe(403);
  });

  it('creates category for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/categories')
      .set(authHeader(makeAdminUser()))
      .send({ name: 'Новая', slug: 'novaya' });
    expect(res.status).toBe(201);
  });
});

describe('POST /products — catalog:manage required', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/products').send({});
    expect(res.status).toBe(401);
  });

  it('creates product for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/products')
      .set(authHeader(makeAdminUser()))
      .send({ name: 'Новый', sku: 'SKU-01', sell_price: 500, category_id: 'cat-1' });
    expect(res.status).toBe(201);
  });
});
