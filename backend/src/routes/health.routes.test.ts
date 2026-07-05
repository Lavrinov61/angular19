/**
 * Integration tests for GET /health, /health/detailed, /health/ready
 *
 * These tests describe what the endpoints SHOULD do.
 * Failing tests indicate bugs to fix in production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../test-utils/index.js';
import {
  TEST_JWT_SECRET,
  makeAdminUser,
  makeClientUser,
  authHeader,
} from '../test-utils/index.js';

// ─── vi.hoisted: vars must be created before vi.mock factories run ────────────

const mockRedisPing = vi.hoisted(() => vi.fn().mockResolvedValue('PONG'));
const mockCheckFaceValidationWorker = vi.hoisted(() => vi.fn().mockResolvedValue({
  ok: true,
  status: 'healthy',
  latencyMs: 12,
  error: null,
}));

const mockDbQueryOne = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: 1 }));
const mockDbQuery = vi.hoisted(() => vi.fn().mockResolvedValue([]));

// ─── Module mocks (must be before imports of the SUT) ─────────────────────────

vi.mock('../database/db.js', () => ({
  default: {
    query: mockDbQuery,
    queryOne: mockDbQueryOne,
    transaction: vi.fn(),
    getClient: vi.fn(),
    getPool: vi.fn(),
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
    redis: { host: 'localhost', port: 6379, password: undefined, tls: undefined },
  },
}));

vi.mock('../services/scheduler-leader.js', () => ({
  getLeaderStatus: vi.fn().mockReturnValue('leader'),
  initSchedulerLeader: vi.fn(),
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
  blacklistToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/face-validation.service.js', () => ({
  checkFaceValidationWorker: mockCheckFaceValidationWorker,
}));

// ioredis mock — controls Redis availability per test via mockRedisPing
vi.mock('ioredis', () => ({
  default: vi.fn(function RedisMock() {
    return {
      ping: mockRedisPing,
      status: 'ready',
      on: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// ─── SUT import (after mocks) ─────────────────────────────────────────────────

const { default: healthRouter } = await import('./health.routes.js');

const app = createTestApp(healthRouter, '/');

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCheckFaceValidationWorker.mockReset();
  mockCheckFaceValidationWorker.mockResolvedValue({
    ok: true,
    status: 'healthy',
    latencyMs: 12,
    error: null,
  });
});

describe('GET /health', () => {
  beforeEach(() => {
    mockDbQueryOne.mockResolvedValue({ ok: 1 });
    mockRedisPing.mockResolvedValue('PONG');
  });

  it('returns 200 and status:healthy when DB and Redis are available', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body).toHaveProperty('uptime');
  });

  it('returns 503 and status:unhealthy when DB throws', async () => {
    mockDbQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('returns 200 and status:degraded when Redis ping throws (fail-open)', async () => {
    mockRedisPing.mockRejectedValueOnce(new Error('Redis timeout'));

    const res = await request(app).get('/');

    // Redis failure = degraded but alive. ALB should NOT pull node out.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it('returns 503 when both DB and Redis are unavailable', async () => {
    mockDbQueryOne.mockRejectedValueOnce(new Error('DB down'));
    mockRedisPing.mockRejectedValueOnce(new Error('Redis down'));

    const res = await request(app).get('/');

    // DB is the critical dependency — its failure makes the node unhealthy
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('response always contains uptime field', async () => {
    const res = await request(app).get('/');

    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('string');
  });
});

describe('GET /health/ready', () => {
  beforeEach(() => {
    mockDbQueryOne.mockResolvedValue({ ok: 1 });
    // Mock global fetch for SSR health check
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  it('returns 200 ready:true when DB and SSR are available', async () => {
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });

  it('returns 503 ready:false when DB throws', async () => {
    mockDbQueryOne.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
  });

  it('returns 503 with reason:ssr_down when SSR is unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('ssr_down');
  });
});

describe('GET /health/detailed', () => {
  it('returns 401 without authentication token', async () => {
    const res = await request(app).get('/detailed');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for client user without settings:manage permission', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'client-id',
      email: 'client@example.com',
      role: 'client',
      is_active: true,
      display_name: 'Client',
      force_password_change: false,
      last_password_change: null,
    });

    const client = makeClientUser();
    const res = await request(app)
      .get('/detailed')
      .set(authHeader(client));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  /**
   * BUG DETECTION: /detailed uses requirePermission('manage_settings' as any),
   * but the correct permission in the static map is 'settings:manage'.
   * This test describes EXPECTED behavior — admin should get 200.
   * This test FAILS until the bug is fixed in health.routes.ts:
   *   requirePermission('manage_settings' as any) → requirePermission('settings:manage')
   */
  it('returns 200 with full diagnostics for admin with settings:manage permission', async () => {
    mockDbQueryOne
      // First call: authenticateToken DB user lookup
      .mockResolvedValueOnce({
        id: 'admin-id',
        email: 'admin@example.com',
        role: 'admin',
        is_active: true,
        display_name: 'Admin',
        force_password_change: false,
        last_password_change: null,
      })
      // Second call: SELECT 1 inside /detailed handler
      .mockResolvedValueOnce({ ok: 1 });

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/detailed')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checks');
    expect(res.body).toHaveProperty('instance');
    expect(res.body).toHaveProperty('memory');
  });
});

describe('GET /health/face-validation', () => {
  it('returns 401 without authentication token', async () => {
    const res = await request(app).get('/face-validation');

    expect(res.status).toBe(401);
    expect(mockCheckFaceValidationWorker).not.toHaveBeenCalled();
  });

  it('returns 200 when the face-validation worker probe is healthy', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'admin-id',
      email: 'admin@example.com',
      role: 'admin',
      is_active: true,
      display_name: 'Admin',
      force_password_change: false,
      last_password_change: null,
    });

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/face-validation')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.ready).toBe(true);
    expect(res.body.latencyMs).toBe(12);
  });

  it('returns 503 when the face-validation worker probe is unhealthy', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'admin-id',
      email: 'admin@example.com',
      role: 'admin',
      is_active: true,
      display_name: 'Admin',
      force_password_change: false,
      last_password_change: null,
    });
    mockCheckFaceValidationWorker.mockResolvedValueOnce({
      ok: false,
      status: 'unhealthy',
      latencyMs: 5000,
      error: 'worker timeout',
    });

    const admin = makeAdminUser();
    const res = await request(app)
      .get('/face-validation')
      .set(authHeader(admin));

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.ready).toBe(false);
    expect(res.body.error).toBe('worker timeout');
  });
});
