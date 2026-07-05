import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PassThrough } from 'stream';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockDb, mockPool, mockStorageService } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (client: unknown) => unknown) => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'msg-1', content: 'test', sender_type: 'operator', created_at: new Date().toISOString() }] }) };
      return fn(mockClient);
    }),
    getClient: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }),
    getPool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  const mockStorageService = {
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    keyFromUrl: vi.fn(),
    getReadStream: vi.fn(),
    downloadToBuffer: vi.fn(),
    isS3Url: vi.fn(),
    resolveSignedUrl: vi.fn(),
  };
  return { mockDb, mockPool, mockStorageService };
});

vi.mock('../../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379 },
  },
}));
vi.mock('../../services/audit.service.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../services/chat-broadcast.service.js', () => ({ broadcastChatMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/storage.service.js', () => ({ storageService: mockStorageService }));
vi.mock('../../services/client-context.service.js', () => ({
  autoLinkSessionToClient: vi.fn().mockResolvedValue(null),
  suggestClientsForSession: vi.fn().mockResolvedValue([]),
  searchClientsByQuery: vi.fn().mockResolvedValue([]),
}));
vi.mock('./chat-shared.js', () => ({
  upload: { single: vi.fn(() => (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next()) },
  fixOriginalName: vi.fn(),
  generateVisitorName: vi.fn().mockReturnValue('Visitor'),
  getNextSessionNumber: vi.fn().mockResolvedValue(1),
  getDeviceType: vi.fn().mockReturnValue('desktop'),
  sessionCreateLimiter: (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
}));
vi.mock('./chat-pricing.helpers.js', () => ({
  buildWidgetPaymentButton: vi.fn().mockReturnValue(null),
  buildOrderCard: vi.fn(),
  buildOrderConfirmedButtons: vi.fn(),
  extractPrice: vi.fn(),
  formatPriceBreakdown: vi.fn(),
}));
vi.mock('../../services/connectors/pipeline/outbound-worker.js', () => ({ enqueueOutbound: vi.fn().mockResolvedValue('mock-id') }));
vi.mock('../../services/employee-gamification.service.js', () => ({ awardXP: vi.fn().mockResolvedValue(undefined) }));

// ─── SUT (dynamic import after mocks) ─────────────────────────────────────────
let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./chat-admin.routes.js');
  app = createTestApp(router);
});

// ─── Test fixtures ─────────────────────────────────────────────────────────────
import { makeEmployeeUser, makeAdminUser, makeClientUser, authHeader } from '../../test-utils/mock-auth.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };

const DB_SESSION = { id: 'session-1', status: 'open', visitor_name: 'Visitor 1', channel: 'web', created_at: new Date().toISOString() };
const DB_MESSAGE = { id: 'msg-1', session_id: 'session-1', content: 'Тест', sender_type: 'operator', created_at: new Date().toISOString() };

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(mockStorageService.saveFile).mockReset();
  vi.mocked(mockStorageService.deleteFile).mockReset();
  vi.mocked(mockStorageService.keyFromUrl).mockReset().mockReturnValue(null);
  vi.mocked(mockStorageService.getReadStream).mockReset();
  vi.mocked(mockStorageService.downloadToBuffer).mockReset();
  vi.mocked(mockStorageService.isS3Url).mockReset().mockReturnValue(false);
  vi.mocked(mockStorageService.resolveSignedUrl).mockReset();
  vi.mocked(mockDb.transaction).mockReset().mockImplementation(async (fn: (client: unknown) => unknown) => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [DB_MESSAGE] }) };
    return fn(mockClient);
  });
}

// NOTE: chat-admin routes have double authenticateToken:
//  1. router.use('/admin', authenticateToken, requirePermission('chat:reply'))
//  2. Each route also has authenticateToken explicitly
// This means db.queryOne is called TWICE per authenticated request.
// Helper to mock both calls:
function mockAuth(dbUser: typeof DB_EMPLOYEE) {
  vi.mocked(mockDb.queryOne)
    .mockResolvedValueOnce(dbUser) // router.use authenticateToken
    .mockResolvedValueOnce(dbUser); // route-level authenticateToken
}

function createControlledStream(contents: string): { stream: PassThrough; release: () => void } {
  const stream = new PassThrough();
  return {
    stream,
    release: () => stream.end(Buffer.from(contents)),
  };
}

// ─── GET /admin/sessions ───────────────────────────────────────────────────────
describe('GET /admin/sessions — list sessions', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/admin/sessions');
    expect(res.status).toBe(401);
  });

  it('returns 403 for client (no chat:reply permission)', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...DB_ADMIN, id: client.id, role: 'client' });
    const res = await request(app).get('/admin/sessions').set(authHeader(client));
    expect(res.status).toBe(403);
  });

  it('returns sessions for employee', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_SESSION]);

    const res = await request(app).get('/admin/sessions').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('accepts status/channel/source query params', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/admin/sessions?status=resolved&channel=telegram&source=widget')
      .set(authHeader(emp));
    expect(res.status).toBe(200);
  });
});

// ─── GET /admin/sessions/:sessionId/detail ────────────────────────────────────
describe('GET /admin/sessions/:sessionId/detail — session detail', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/admin/sessions/session-1/detail');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown session', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/admin/sessions/unknown/detail').set(authHeader(emp));
    expect(res.status).toBe(404);
  });

  it('returns session detail for known session', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_SESSION]);

    const res = await request(app).get('/admin/sessions/session-1/detail').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ─── POST /admin/sessions/:sessionId/reply ────────────────────────────────────
describe('POST /admin/sessions/:sessionId/reply — operator reply', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/admin/sessions/session-1/reply').send({ content: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if content is empty', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);

    const res = await request(app)
      .post('/admin/sessions/session-1/reply')
      .set(authHeader(emp))
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('sends reply and returns 200', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);

    const res = await request(app)
      .post('/admin/sessions/session-1/reply')
      .set(authHeader(emp))
      .send({ content: 'Добрый день!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /admin/sessions/:sessionId/note ─────────────────────────────────────
describe('POST /admin/sessions/:sessionId/note — internal note', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/admin/sessions/session-1/note').send({ content: 'VIP' });
    expect(res.status).toBe(401);
  });

  it('returns 400 if content is empty', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);

    const res = await request(app)
      .post('/admin/sessions/session-1/note')
      .set(authHeader(emp))
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('creates note and returns 200', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ display_name: 'Employee' }] }) // getSenderName
      .mockResolvedValueOnce({ rows: [DB_MESSAGE] }); // INSERT

    const res = await request(app)
      .post('/admin/sessions/session-1/note')
      .set(authHeader(emp))
      .send({ content: 'Важная заметка' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /admin/sessions/:sessionId/status ────────────────────────────────────
describe('PUT /admin/sessions/:sessionId/status — update session status', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/admin/sessions/session-1/status').send({ status: 'resolved' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid status', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);

    const res = await request(app)
      .put('/admin/sessions/session-1/status')
      .set(authHeader(emp))
      .send({ status: 'invalid_status' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/admin/sessions/unknown/status')
      .set(authHeader(emp))
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });

  it('updates session status to resolved', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ ...DB_SESSION, status: 'resolved' }] });

    const res = await request(app)
      .put('/admin/sessions/session-1/status')
      .set(authHeader(emp))
      .send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /admin/sessions/:sessionId/assign ───────────────────────────────────
describe('POST /admin/sessions/:sessionId/assign — assign to operator', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/admin/sessions/session-1/assign');
    expect(res.status).toBe(401);
  });

  it('assigns chat to self when no operator_id', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ ...DB_SESSION, assigned_operator_id: 'employee-id' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ display_name: 'Employee', email: 'employee@test.com' }] }); // get operator name

    const res = await request(app)
      .post('/admin/sessions/session-1/assign')
      .set(authHeader(emp))
      .send({}); // must send body to prevent req.body being undefined
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 409 if already assigned to someone else', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE returned empty
      .mockResolvedValueOnce({ rows: [{ assigned_operator_id: 'other-operator' }] }); // check existence

    const res = await request(app)
      .post('/admin/sessions/session-1/assign')
      .set(authHeader(emp))
      .send({});
    expect(res.status).toBe(409);
  });
});

// ─── GET /admin/sessions/:sessionId/messages ──────────────────────────────────
describe('GET /admin/sessions/:sessionId/messages — session messages', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/admin/sessions/session-1/messages');
    expect(res.status).toBe(401);
  });

  it('returns messages for session', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [DB_MESSAGE] });

    const res = await request(app).get('/admin/sessions/session-1/messages').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('loads previous messages across related conversations by person identity', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    const previousMessage = {
      ...DB_MESSAGE,
      id: 'old-msg-1',
      conversation_id: 'old-session-1',
      content: 'Старая переписка',
    };

    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [DB_MESSAGE] }) // current messages
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // total count
      .mockResolvedValueOnce({ rows: [{ has: false }] }); // hasNewer
    vi.mocked(mockDb.query).mockResolvedValueOnce([previousMessage]);

    const res = await request(app).get('/admin/sessions/session-1/messages').set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.previousMessages).toHaveLength(1);
    expect(res.body.previousMessages[0]).toMatchObject({
      id: 'old-msg-1',
      conversation_id: 'old-session-1',
      is_previous_session: true,
    });

    const historySql = vi.mocked(mockDb.query).mock.calls[0]?.[0];
    expect(historySql).toContain('related_conversations');
    expect(historySql).toContain('c.contact_id = cur.contact_id');
    expect(historySql).toContain('c.user_id = cur.user_id');
    expect(historySql).toContain('right(related_phone.digits, 10) = cur.phone_key');
    expect(historySql).not.toContain("c.status IN ('resolved', 'closed')");
  });
});

// ─── DELETE /admin/sessions/:sessionId/messages/:messageId ───────────────────
describe('DELETE /admin/sessions/:sessionId/messages/:messageId — delete outgoing message', () => {
  beforeEach(resetMocks);

  it('soft-deletes bot payment messages and refreshes inbox counters with typed params', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // router.use authenticateToken
      .mockResolvedValueOnce({
        id: 'msg-payment',
        sender_type: 'bot',
        sender_id: null,
        external_message_id: null,
        content: '💳 К оплате: 1400₽',
        message_type: 'interactive',
      })
      .mockResolvedValueOnce({
        channel: 'vk',
        metadata: {},
        external_chat_id: 'vk-chat-1',
      })
      .mockResolvedValueOnce({
        message_count: 6,
        unread_count: 0,
        last_message_content: '✅ Клиент оплатил 1400₽',
        last_message_at: '2026-05-11T16:00:35.107Z',
      });

    const res = await request(app)
      .delete('/admin/sessions/session-1/messages/msg-payment')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const crmSummarySql = vi.mocked(mockDb.query).mock.calls
      .map(([sql]) => String(sql))
      .find(sql => sql.includes('UPDATE crm_inbox'));

    expect(crmSummarySql).toContain('sort_time = COALESCE($3::timestamptz, sort_time)');
    expect(crmSummarySql).toContain('unread = $4::int > 0');
    expect(crmSummarySql).toContain("jsonb_build_object('messageCount', $5::int, 'unreadCount', $4::int)");
  });
});

// ─── POST /admin/sessions/:sessionId/download-selected ───────────────────────
describe('POST /admin/sessions/:sessionId/download-selected — archive selected files', () => {
  beforeEach(resetMocks);

  it('waits for an S3 stream to finish before opening the next file', async () => {
    const emp = makeEmployeeUser();
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const firstMessageId = '22222222-2222-4222-8222-222222222222';
    const secondMessageId = '33333333-3333-4333-8333-333333333333';
    const firstFile = createControlledStream('first-image');
    const secondFile = PassThrough.from(Buffer.from('second-image'));
    let firstReadRequested: () => void = () => undefined;
    const firstReadRequestedPromise = new Promise<void>((resolve) => {
      firstReadRequested = resolve;
    });

    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [{ visitor_name: 'Visitor' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: firstMessageId,
            sender_type: 'visitor',
            attachment_url: 'https://svoefoto.ru/media/chat/first.jpg',
            content: '[Фото]',
            created_at: new Date().toISOString(),
            message_type: 'image',
            original_file_name: 'first.jpg',
            detected_mime: 'image/jpeg',
          },
          {
            id: secondMessageId,
            sender_type: 'visitor',
            attachment_url: 'https://svoefoto.ru/media/chat/second.jpg',
            content: '[Фото]',
            created_at: new Date().toISOString(),
            message_type: 'image',
            original_file_name: 'second.jpg',
            detected_mime: 'image/jpeg',
          },
        ],
      });
    vi.mocked(mockStorageService.keyFromUrl).mockImplementation((url: string) => {
      if (url.includes('first.jpg')) return 'chat/first.jpg';
      if (url.includes('second.jpg')) return 'chat/second.jpg';
      return null;
    });
    vi.mocked(mockStorageService.getReadStream)
      .mockImplementationOnce(async () => {
        firstReadRequested();
        return firstFile.stream;
      })
      .mockResolvedValueOnce(secondFile);

    const responsePromise = request(app)
      .post(`/admin/sessions/${sessionId}/download-selected`)
      .set(authHeader(emp))
      .send({ messageIds: [firstMessageId, secondMessageId] })
      .then(res => res);

    await firstReadRequestedPromise;
    await new Promise(resolve => setTimeout(resolve, 25));
    const callsBeforeFirstStreamEnded = vi.mocked(mockStorageService.getReadStream).mock.calls.length;

    firstFile.release();
    const res = await responsePromise;

    expect(res.status).toBe(200);
    expect(callsBeforeFirstStreamEnded).toBe(1);
    expect(mockStorageService.getReadStream).toHaveBeenCalledTimes(2);
  });
});

// ─── Quick replies CRUD ───────────────────────────────────────────────────────
describe('Quick replies CRUD', () => {
  beforeEach(resetMocks);

  const QUICK_REPLY = { id: 'qr-1', title: 'Привет', content: 'Добрый день!', category: 'greeting' };

  it('POST /admin/quick-replies returns 401 without auth', async () => {
    const res = await request(app).post('/admin/quick-replies').send({ title: 'Test', content: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('POST /admin/quick-replies creates reply and returns 200', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [QUICK_REPLY] }); // INSERT

    const res = await request(app)
      .post('/admin/quick-replies')
      .set(authHeader(emp))
      .send({ title: 'Привет', content: 'Добрый день!', category: 'greeting' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /admin/quick-replies/:id updates reply', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ ...QUICK_REPLY, title: 'Обновлено' }] }); // UPDATE

    const res = await request(app)
      .put('/admin/quick-replies/qr-1')
      .set(authHeader(emp))
      .send({ title: 'Обновлено', content: 'Новый текст' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /admin/quick-replies/:id deletes reply', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [{ id: 'qr-1' }] }); // soft-delete UPDATE

    const res = await request(app)
      .delete('/admin/quick-replies/qr-1')
      .set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /admin/sessions/:sessionId/mark-read ────────────────────────────────
describe('PUT /admin/sessions/:sessionId/mark-read — mark as read', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/admin/sessions/session-1/mark-read');
    expect(res.status).toBe(401);
  });

  it('marks session as read', async () => {
    const emp = makeEmployeeUser();
    mockAuth(DB_EMPLOYEE);
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await request(app).put('/admin/sessions/session-1/mark-read').set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
