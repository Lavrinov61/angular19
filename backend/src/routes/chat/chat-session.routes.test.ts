import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { makeEmployeeUser, makeToken } from '../../test-utils/mock-auth.js';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockPool };
});

vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../database/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null), transaction: vi.fn() },
  pool: mockPool,
}));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379 },
    guestSession: { secret: 'test-guest-session-secret' },
    chat: { useAiFirst: false },
    bridge: { url: 'http://localhost:5052' },
  },
}));
vi.mock('../../services/audit.service.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../services/ai-chat.service.js', () => ({
  clearOperatorActive: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/signed-url.service.js', () => ({
  generateSessionToken: vi.fn().mockReturnValue('test-session-token'),
}));
vi.mock('../../services/pricing-engine.service.js', () => ({
  getCategoryBySlug: vi.fn().mockResolvedValue(null),
}));
vi.mock('./chat-welcome.service.js', () => ({
  generateWelcomeMessage: vi.fn().mockResolvedValue(null),
  generateWelcomeInteractive: vi.fn().mockResolvedValue(null),
}));
vi.mock('./chat-pricing.helpers.js', () => ({
  buildWidgetPaymentButton: vi.fn().mockReturnValue(null),
  buildOrderCard: vi.fn().mockReturnValue(null),
  buildOrderConfirmedButtons: vi.fn().mockReturnValue(null),
  extractPrice: vi.fn().mockReturnValue(0),
  formatPriceBreakdown: vi.fn().mockReturnValue(''),
}));
vi.mock('./chat-shared.js', () => ({
  generateVisitorName: vi.fn().mockReturnValue('Visitor 1'),
  getNextSessionNumber: vi.fn().mockResolvedValue(1),
  getDeviceType: vi.fn().mockReturnValue({ icon: '💻', name: 'desktop' }),
  sessionCreateLimiter: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
}));
vi.mock('../../services/client-context.service.js', () => ({
  autoLinkSessionToClient: vi.fn().mockResolvedValue(null),
}));
vi.mock('axios', () => ({ default: { post: vi.fn().mockResolvedValue({ data: {} }) } }));

// ─── SUT ──────────────────────────────────────────────────────────────────────
let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./chat-session.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

const DB_SESSION = {
  id: 'session-1',
  visitor_id: 'visitor-1',
  status: 'open',
  visitor_name: 'Visitor 1',
  channel: 'online',
  source: 'web',
  entry_context: {},
  created_at: new Date().toISOString(),
};

// ─── POST /sessions — create session ─────────────────────────────────────────
describe('POST /sessions — create or restore session', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app).post('/sessions').send({ pageUrl: '/' });
    expect(res.status).toBe(400);
  });

  it('returns existing session if one is open', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [DB_SESSION] }) // find existing
      .mockResolvedValueOnce({ rows: [] }) // UPDATE session fields
      .mockResolvedValueOnce({ rows: [] }) // SELECT last operator message (clearOperatorActive check)
      .mockResolvedValueOnce({ rows: [] }); // SELECT messages history

    const res = await request(app)
      .post('/sessions')
      .send({ visitorId: 'visitor-1', selectedService: 'photo-docs' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session).toBeDefined();
  });

  it('creates a new session when no open session exists', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] }) // no existing session
      .mockResolvedValueOnce({ rows: [{ ...DB_SESSION, session_number: 1 }] }) // INSERT session
      .mockResolvedValueOnce({ rows: [] }) // SELECT messages history
      .mockResolvedValueOnce({ rows: [] }); // other queries

    const res = await request(app)
      .post('/sessions')
      .send({ visitorId: 'new-visitor-id' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session).toBeDefined();
  });

  it('links authenticated user to session when JWT is provided', async () => {
    const user = makeEmployeeUser();
    const token = makeToken(user);

    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [DB_SESSION] }) // find existing (with user_id match)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE session
      .mockResolvedValueOnce({ rows: [] }) // SELECT last operator message
      .mockResolvedValueOnce({ rows: [] }); // SELECT messages history

    const res = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ visitorId: 'visitor-auth' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /sessions/:sessionId/update-visitor ──────────────────────────────
describe('POST /sessions/:sessionId/update-visitor — update visitor ID', () => {
  beforeEach(resetMocks);

  it('returns 400 for anon_ visitorId', async () => {
    const res = await request(app)
      .post('/sessions/session-1/update-visitor')
      .send({ visitorId: 'anon_12345' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app).post('/sessions/session-1/update-visitor').send({});
    expect(res.status).toBe(400);
  });

  it('updates visitor ID and returns updated=true', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'session-1', visitor_id: 'real-visitor-id' }] }) // UPDATE session
      .mockResolvedValueOnce({ rows: [] }); // UPDATE orders

    const res = await request(app)
      .post('/sessions/session-1/update-visitor')
      .send({ visitorId: 'real-fingerprint-id' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(true);
  });

  it('returns updated=false if session not anon', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // no UPDATE (not anon_)

    const res = await request(app)
      .post('/sessions/session-1/update-visitor')
      .send({ visitorId: 'real-fingerprint-id' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(false);
  });
});

// ─── POST /link-user — link visitor to account ────────────────────────────
describe('POST /link-user — link visitor to user account', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId or token missing', async () => {
    const res = await request(app).post('/link-user').send({ visitorId: 'v-1' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid token', async () => {
    const res = await request(app)
      .post('/link-user')
      .set('Authorization', 'Bearer invalid.token.here')
      .send({ visitorId: 'v-1' });
    expect(res.status).toBe(401);
  });

  it('links visitor to user account', async () => {
    const user = makeEmployeeUser();
    const token = makeToken(user);

    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE sessions
      .mockResolvedValueOnce({ rows: [] }); // other queries

    const res = await request(app)
      .post('/link-user')
      .set('Authorization', `Bearer ${token}`)
      .send({ visitorId: 'visitor-123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /sessions/:sessionId/close — close session ─────────────────────────
describe('PUT /sessions/:sessionId/close — close session', () => {
  beforeEach(resetMocks);

  it('closes session and returns 200', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await request(app)
      .put('/sessions/session-1/close')
      .send({ visitorId: 'visitor-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /sessions/:sessionId/csat ──────────────────────────────────────────
describe('POST /sessions/:sessionId/csat — submit CSAT', () => {
  beforeEach(resetMocks);

  it('returns 400 for score out of range', async () => {
    const res = await request(app)
      .post('/sessions/session-1/csat')
      .send({ visitor_id: 'v-1', score: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 if visitor_id missing', async () => {
    const res = await request(app)
      .post('/sessions/session-1/csat')
      .send({ score: 5 });
    expect(res.status).toBe(400);
  });

  it('submits CSAT score', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'session-1', visitor_id: 'v-1', status: 'resolved', csat_score: null }] }) // SELECT session
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await request(app)
      .post('/sessions/session-1/csat')
      .send({ visitor_id: 'v-1', score: 5, comment: 'Отлично!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
