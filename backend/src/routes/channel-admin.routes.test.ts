import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// channel-admin routes import many services — mock them all
vi.mock('../utils/circuit-breaker.js', () => ({
  getAllBreakers: vi.fn().mockReturnValue(new Map()),
}));
vi.mock('../services/connectors/core/adapter-registry.js', () => ({
  getAdapter: vi.fn().mockReturnValue({ channel: 'telegram' }),
  getAllAdapters: vi.fn().mockReturnValue([]),
  isChannelDisabled: vi.fn().mockResolvedValue(false),
  setChannelDisabled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/channel-metrics.service.js', () => ({
  getAllChannelMetrics: vi.fn().mockResolvedValue({}),
  getChannelMetrics: vi.fn().mockResolvedValue({ sent: 0, received: 0, delivered: 0, failed: 0, avgDeliveryMs: 0 }),
}));
vi.mock('../services/connectors/pipeline/outbound-worker.js', () => ({
  outboundQueue: { getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 0 }) },
  enqueueOutbound: vi.fn().mockResolvedValue('mock-id'),
}));
vi.mock('../services/audit.service.js', () => ({
  logAudit: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../services/channel-health.service.js', () => ({
  getAggregatedHealth: vi.fn().mockResolvedValue([]),
  getChannelHealthDetail: vi.fn().mockResolvedValue({
    channel: 'telegram', health: 'healthy', connectorEnabled: true, disabled: false,
    circuitBreaker: { state: 'CLOSED', failures: 0, lastError: null, lastSuccessAt: null, lastFailureAt: null },
    webhook: { lastReceivedAt: null, total24h: 0, errors24h: 0, errorRate: 0 },
    queue: { pendingCount: 0, failedCount: 0, deadLetterCount: 0, oldestPendingAgeSeconds: null },
    token: null, summary: 'OK',
  }),
  invalidateHealthCache: vi.fn().mockResolvedValue(undefined),
}));

const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
};
vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./channel-admin.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
}

// channel-admin routes have no auth middleware (open endpoints)

// ─── GET / — list all channels ────────────────────────────────────────────────
describe('GET / — list all channels', () => {
  beforeEach(resetMocks);

  it('returns channel list', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 5 channels', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
  });
});

// ─── GET /:channel/stats — channel detailed stats ─────────────────────────────
describe('GET /:channel/stats — channel stats', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid channel', async () => {
    const res = await request(app).get('/invalid-channel/stats');
    expect(res.status).toBe(400);
  });

  it('returns stats for valid channel', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    const res = await request(app).get('/telegram/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('telegram');
  });
});

// ─── POST /:channel/toggle — enable/disable channel ──────────────────────────
describe('POST /:channel/toggle — toggle channel', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid channel', async () => {
    const res = await request(app).post('/invalid-channel/toggle').send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it('disables channel', async () => {
    const res = await request(app).post('/telegram/toggle').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.disabled).toBe(true);
  });

  it('enables channel', async () => {
    const res = await request(app).post('/vk/toggle').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.disabled).toBe(false);
  });
});

// ─── GET /:channel/health — single channel health detail ─────────────────────
describe('GET /:channel/health — channel health detail', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid channel', async () => {
    const res = await request(app).get('/invalid/health');
    expect(res.status).toBe(400);
  });

  it('returns health detail for valid channel', async () => {
    const res = await request(app).get('/telegram/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('telegram');
    expect(res.body.data.health).toBe('healthy');
  });
});

// ─── GET /dead-letters — dead letter queue ────────────────────────────────────
describe('GET /dead-letters — dead letter list', () => {
  beforeEach(resetMocks);

  it('returns dead letter list', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([
      { id: 'dl-1', channel: 'telegram', content: '{}', attempts: 5, last_error: 'Timeout', created_at: new Date().toISOString() },
    ]);
    const res = await request(app).get('/dead-letters');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('supports channel filter', async () => {
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);
    const res = await request(app).get('/dead-letters?channel=telegram');
    expect(res.status).toBe(200);
  });
});

// ─── GET /health — overall health ─────────────────────────────────────────────
describe('GET /health — channel health', () => {
  beforeEach(resetMocks);

  it('returns health status', async () => {
    const res = await request(app).get('/health');
    // status is 200 (all healthy) or 503 (degraded)
    expect([200, 503]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.channels).toBeDefined();
  });
});
