import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

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
  default: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn(),
  },
  pool: mockPool,
}));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379, password: undefined, tls: false },
    chat: { useAiFirst: false },
  },
}));
vi.mock('../../services/ai-chat.service.js', () => ({
  scheduleAIResponse: vi.fn().mockResolvedValue(undefined),
  clearOperatorActive: vi.fn().mockResolvedValue(undefined),
  isOperatorActive: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../services/chat-actions.service.js', () => ({ executeChatAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./chat-bot-engine.js', () => ({
  handleInteractiveResponse: vi.fn().mockResolvedValue(null),
  handleContextualTextInput: vi.fn().mockResolvedValue(null),
}));
vi.mock('./chat-context.service.js', () => ({
  recalcSessionContext: vi.fn().mockResolvedValue(undefined),
  isReturningBasicCustomer: vi.fn().mockResolvedValue(false),
}));
vi.mock('./chat-pricing.helpers.js', () => ({
  buildOrderCard: vi.fn().mockReturnValue(null),
  buildOrderConfirmedButtons: vi.fn().mockReturnValue(null),
  extractPrice: vi.fn().mockReturnValue(0),
  formatPriceBreakdown: vi.fn().mockReturnValue(''),
  buildWidgetPaymentButton: vi.fn().mockReturnValue(null),
}));
vi.mock('./chat-shared.js', () => ({
  getNextSessionNumber: vi.fn().mockResolvedValue(1),
  generateVisitorName: vi.fn().mockReturnValue('Visitor 1'),
  safePath: vi.fn().mockReturnValue(null),
  sessionCreateLimiter: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
}));

// ─── SUT ──────────────────────────────────────────────────────────────────────
let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./chat-messages.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

// ─── POST /lead-notify ────────────────────────────────────────────────────────
describe('POST /lead-notify — lead notification', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app).post('/lead-notify').send({ pageUrl: '/photo-docs' });
    expect(res.status).toBe(400);
  });

  it('creates notification for existing session', async () => {
    const existingSession = { id: 'session-1', visitor_id: 'visitor-1', visitor_name: 'Visitor' };
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [existingSession] }) // find session
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] }); // INSERT message

    const res = await request(app).post('/lead-notify').send({ visitorId: 'visitor-1', service: 'Ретушь' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('creates new session and notification when no existing session', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] }) // no existing session
      .mockResolvedValueOnce({ rows: [{ id: 'new-session', visitor_id: 'v-new', visitor_name: 'Visitor 1' }] }) // INSERT session
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] }); // INSERT message

    const res = await request(app).post('/lead-notify').send({ visitorId: 'new-visitor-id', pageUrl: '/voennaya-retush' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /sessions/:sessionId/messages ───────────────────────────────────────
describe('POST /sessions/:sessionId/messages — send message', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app)
      .post('/sessions/session-1/messages')
      .send({ content: 'Привет' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if content is missing', async () => {
    const res = await request(app)
      .post('/sessions/session-1/messages')
      .send({ visitorId: 'visitor-1' });
    expect(res.status).toBe(400);
  });

  it('sends message and returns bot response', async () => {
    const msgRow = { id: 'msg-1', content: 'Привет', sender_type: 'visitor', created_at: new Date().toISOString() };
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] })   // idempotency check (no prior message with this clientMessageId)
      .mockResolvedValueOnce({ rows: [{ id: 'session-1', visitor_id: 'v-1', status: 'open', metadata: null }] }) // session check
      .mockResolvedValueOnce({ rows: [msgRow] }) // INSERT message
      .mockResolvedValueOnce({ rows: [] }) // update session unread_count
      .mockResolvedValueOnce({ rows: [] }); // other queries

    const res = await request(app)
      .post('/sessions/session-1/messages')
      .send({ visitorId: 'v-1', content: 'Привет', clientMessageId: 'client-msg-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns idempotent response for duplicate clientMessageId', async () => {
    const existingMsg = { id: 'msg-1', content: 'Привет', bot_response: null };
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [existingMsg] }); // found existing

    const res = await request(app)
      .post('/sessions/session-1/messages')
      .send({ visitorId: 'v-1', content: 'Привет', clientMessageId: 'dup-msg-id' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBeDefined();
  });
});

// ─── GET /sessions/:sessionId/messages ────────────────────────────────────────
describe('GET /sessions/:sessionId/messages — message history', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app).get('/sessions/session-1/messages');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/sessions/session-1/messages?visitorId=unknown-v');
    expect(res.status).toBe(404);
  });

  it('returns message history', async () => {
    const messages = [{ id: 'msg-1', content: 'Hello', sender_type: 'visitor', metadata: null }];
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'session-1', visitor_id: 'v-1' }] }) // session check
      .mockResolvedValueOnce({ rows: messages }); // messages

    const res = await request(app).get('/sessions/session-1/messages?visitorId=v-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── DELETE /sessions/:sessionId/clear-messages ───────────────────────────────
describe('DELETE /sessions/:sessionId/clear-messages — clear messages', () => {
  beforeEach(resetMocks);

  it('returns 400 if visitorId is missing', async () => {
    const res = await request(app).delete('/sessions/session-1/clear-messages');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/sessions/session-1/clear-messages')
      .send({ visitorId: 'v-unknown' });
    expect(res.status).toBe(404);
  });

  it('clears messages and returns count', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] }) // session check
      .mockResolvedValueOnce({ rows: [] })   // attachments
      .mockResolvedValueOnce({ rows: [], rowCount: 5 }) // DELETE messages
      .mockResolvedValueOnce({ rows: [] });  // UPDATE session

    const res = await request(app)
      .delete('/sessions/session-1/clear-messages?visitorId=v-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /quick-replies ───────────────────────────────────────────────────────
describe('GET /quick-replies — list quick replies', () => {
  beforeEach(resetMocks);

  it('returns quick replies list', async () => {
    const replies = [{ id: 'qr-1', title: 'Привет', content: 'Добрый день' }];
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: replies });

    const res = await request(app).get('/quick-replies');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
