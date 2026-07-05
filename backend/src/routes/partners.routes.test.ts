import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockDb = { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) };
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

const PARTNER = { id: 'partner-1', name: 'ООО Партнёр', status: 'pending', partner_code: 'P001' };

vi.mock('../services/partners.service.js', () => ({
  listPartners: vi.fn().mockResolvedValue({ partners: [], total: 0 }),
  getPartners: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  createPartner: vi.fn().mockResolvedValue(PARTNER),
  getPartnerById: vi.fn().mockResolvedValue(null),
  updatePartner: vi.fn().mockResolvedValue(null),
  approvePartner: vi.fn().mockResolvedValue(null),
  getPartnerPromoDiscount: vi.fn().mockResolvedValue(null),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./partners.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// router.use(authenticateToken, requirePermission('partners:manage'))
// partners:manage: admin + manager (not employee)

describe('GET / — list partners', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns 403 for employee (no partners:manage)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(403);
  });

  it('returns partner list for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app).get('/').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST / — create partner', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if type missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ name: 'ООО Партнёр' }); // missing type
    expect(res.status).toBe(400);
  });

  it('creates partner for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ name: 'ООО Партнёр', type: 'referral' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
