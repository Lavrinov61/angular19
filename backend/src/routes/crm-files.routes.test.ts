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
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    crmStorage: { dir: '/tmp/test-crm-uploads' },
  },
}));
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('fs', () => ({
  createReadStream: vi.fn().mockReturnValue({
    pipe: vi.fn(),
    on: vi.fn().mockReturnThis(),
  }),
}));
// Mock ClamAV (clamscan)
vi.mock('clamscan', () => ({
  default: class MockClamScan {
    init() { return Promise.resolve(this); }
    scanFile() { return Promise.resolve({ isInfected: false, viruses: [] }); }
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./crm-files.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';

const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const FILE_ROW = { id: 1, uuid: 'file-uuid-1', filename: 'test.pdf', mimetype: 'application/pdf', size: 1024, uploaded_by: 'employee-id', storage_path: '/tmp/test.pdf', original_name: 'test.pdf', created_at: new Date().toISOString() };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
}

// router.use(authenticateToken) + router.use(requirePermission('inbox:view'))
// employee has inbox:view

describe('GET / — list files', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns file list for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([FILE_ROW]);

    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /:uuid/info — file metadata', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/file-uuid-1/info');
    expect(res.status).toBe(401);
  });

  it('returns 404 if file not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null);       // file not found

    const res = await request(app).get('/unknown-uuid/info').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(404);
  });

  it('returns file metadata', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(FILE_ROW);   // file found

    const res = await request(app).get('/file-uuid-1/info').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /:uuid — soft delete file', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/file-uuid-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 if file not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null);       // file not found

    const res = await request(app).delete('/unknown-uuid').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(404);
  });

  it('soft deletes file', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)    // auth
      .mockResolvedValueOnce(FILE_ROW);      // file found
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // UPDATE soft delete

    const res = await request(app).delete('/file-uuid-1').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
