import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const {
  mockDb,
  mockSyncOrderStatusForApproval,
  mockDeliverToExternalChannel,
  mockSendVisitorChatPush,
  mockBroadcastChatMessage,
  mockNotificationCreate,
  mockMarkRetouchRevision,
} = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn(),
  };
  const mockSyncOrderStatusForApproval = vi.fn().mockResolvedValue(undefined);
  const mockDeliverToExternalChannel = vi.fn().mockResolvedValue(undefined);
  const mockSendVisitorChatPush = vi.fn().mockResolvedValue(undefined);
  const mockBroadcastChatMessage = vi.fn().mockResolvedValue(undefined);
  const mockNotificationCreate = vi.fn().mockResolvedValue(undefined);
  const mockMarkRetouchRevision = vi.fn().mockResolvedValue(null);
  return {
    mockDb,
    mockSyncOrderStatusForApproval,
    mockDeliverToExternalChannel,
    mockSendVisitorChatPush,
    mockBroadcastChatMessage,
    mockNotificationCreate,
    mockMarkRetouchRevision,
  };
});

vi.mock('../database/db.js', () => ({ default: mockDb }));
vi.mock('../services/photo-approval.service.js', () => ({
  deliverToExternalChannel: mockDeliverToExternalChannel,
}));
vi.mock('../services/visitor-push.service.js', () => ({
  sendVisitorChatPush: mockSendVisitorChatPush,
}));
vi.mock('../services/chat-broadcast.service.js', () => ({
  broadcastChatMessage: mockBroadcastChatMessage,
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: mockNotificationCreate },
}));
vi.mock('../services/retouch.service.js', () => ({
  markRetouchRevision: mockMarkRetouchRevision,
}));
vi.mock('../services/order-status.service.js', () => ({
  syncOrderStatusForApproval: mockSyncOrderStatusForApproval,
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests' }, redis: { host: '' } },
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./photo-review.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockSyncOrderStatusForApproval).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockDeliverToExternalChannel).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockSendVisitorChatPush).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockBroadcastChatMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockNotificationCreate).mockReset().mockResolvedValue(undefined);
  vi.mocked(mockMarkRetouchRevision).mockReset().mockResolvedValue(null);
}

// Session fixture — first_viewed_at non-null so no UPDATE query on first view
const APPROVAL_SESSION_VIEWED = {
  id: 'sess-1', public_token: 'valid-token-12345', client_name: 'Иван', client_phone: '+79001234567',
  status: 'pending', title: 'Фотосессия', photographer_id: 'photo-id-1',
};
const APPROVAL_SESSION_UNVIEWED = { ...APPROVAL_SESSION_VIEWED, first_viewed_at: null };

const DB_SESSION_WITH_PHOTOS = {
  id: 'sess-1', client_name: 'Иван', status: 'pending', title: 'Фотосессия',
  description: null, total_photos: 5, approved_count: 0, rejected_count: 0,
  first_viewed_at: new Date().toISOString(), // already viewed → no extra UPDATE
  created_at: new Date().toISOString(),
};

// ─── GET /:token ───────────────────────────────────────────────────────────────
describe('GET /:token — public review session', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown short token (GET /:token does not check length)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null); // no session found for 'abc'
    const res = await request(app).get('/abc');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown token', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).get('/this-is-unknown-token-1234567890');
    expect(res.status).toBe(404);
  });

  it('returns session data for valid token (already viewed)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_SESSION_WITH_PHOTOS);
    // Photos query → empty array (no further queries needed)
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app).get('/valid-token-12345');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.session).toBeDefined(); // response uses `session` not `data`
    expect(res.body.photos).toBeDefined();
  });
});

// ─── POST /:token/photos/:photoId/approve ─────────────────────────────────────
describe('POST /:token/photos/:photoId/approve — approve photo', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown token via validateToken middleware', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null); // validateToken → not found
    const res = await request(app).post('/unknown-token-12345678/photos/photo-1/approve');
    expect(res.status).toBe(404);
  });

  it('returns 410 for completed session', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...APPROVAL_SESSION_VIEWED, status: 'completed' });
    const res = await request(app).post('/valid-token-12345/photos/photo-1/approve').send({});
    expect(res.status).toBe(410);
  });

  it('approves photo and syncs the linked order status', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce({ id: 'photo-1' });      // UPDATE photo RETURNING

    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // SELECT non-selected photos
      .mockResolvedValueOnce([]); // UPDATE session

    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/approve')
      .send({ comment: 'Хорошо' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSyncOrderStatusForApproval).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      trigger: 'reviewed',
    });
  });
});

// ─── POST /:token/photos/:photoId/reject ──────────────────────────────────────
describe('POST /:token/photos/:photoId/reject — reject photo', () => {
  beforeEach(resetMocks);

  it('returns 404 for unknown token', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);
    const res = await request(app).post('/unknown-token-12345678/photos/photo-1/reject').send({});
    expect(res.status).toBe(404);
  });

  it('rejects photo with reason', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce({ id: 'photo-1' })       // UPDATE RETURNING
      .mockResolvedValueOnce({ total: '1', approved: '0', pending: '0' }); // counters

    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // UPDATE session

    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/reject')
      .send({ reason: 'Плохое качество' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /:token/photos/:photoId/comment ─────────────────────────────────────
describe('POST /:token/photos/:photoId/comment — add comment', () => {
  beforeEach(resetMocks);

  it('returns 400 if comment is missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(APPROVAL_SESSION_VIEWED); // validateToken
    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/comment')
      .send({}); // no comment field
    expect(res.status).toBe(400);
  });

  it('adds comment to photo', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce({ id: 'annot-1' });      // INSERT RETURNING

    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/comment')
      .send({ comment: 'Хорошее фото' }); // field is `comment`, not `text`
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /:token/approve-all ─────────────────────────────────────────────────
describe('POST /:token/approve-all — approve all photos', () => {
  beforeEach(resetMocks);

  it('returns 410 for completed session', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ ...APPROVAL_SESSION_VIEWED, status: 'completed' });
    const res = await request(app).post('/valid-token-12345/approve-all').send({});
    expect(res.status).toBe(410);
  });

  it('approves all photos and syncs the linked order status', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(APPROVAL_SESSION_VIEWED); // validateToken
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]) // UPDATE photos RETURNING
      .mockResolvedValueOnce([]);                           // UPDATE session

    const res = await request(app).post('/valid-token-12345/approve-all').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.approvedCount).toBe(2);
    expect(mockSyncOrderStatusForApproval).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      trigger: 'reviewed',
    });
  });
});

// ─── POST /:token/complete ────────────────────────────────────────────────────
describe('POST /:token/complete — complete review', () => {
  beforeEach(resetMocks);

  it('completes review session', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce({ total: '5', approved: '5', rejected: '0' }); // stats

    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // UPDATE session

    const res = await request(app).post('/valid-token-12345/complete').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('approved');
    expect(mockSyncOrderStatusForApproval).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      trigger: 'reviewed',
    });
  });
});

// ─── POST /:token/photos/:photoId/annotate ────────────────────────────────────
describe('POST /:token/photos/:photoId/annotate — add pin annotation', () => {
  beforeEach(resetMocks);

  it('returns 400 if x or y is missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(APPROVAL_SESSION_VIEWED);
    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/annotate')
      .send({ comment: 'Проблема здесь' }); // no x, y
    expect(res.status).toBe(400);
  });

  it('adds pin annotation', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce({ id: 'annot-2' });      // INSERT RETURNING

    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/annotate')
      .send({ x: 100, y: 200, comment: 'Здесь шум' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /:token/photos/:photoId/select-variant ─────────────────────────────
describe('POST /:token/photos/:photoId/select-variant — select variant', () => {
  beforeEach(resetMocks);

  it('returns 400 if variantId is missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(APPROVAL_SESSION_VIEWED);
    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/select-variant')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 if variant not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED) // validateToken
      .mockResolvedValueOnce(null);                   // variant lookup → not found
    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/select-variant')
      .send({ variantId: 'variant-unknown' });
    expect(res.status).toBe(404);
  });

  it('selects variant', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(APPROVAL_SESSION_VIEWED)           // validateToken
      .mockResolvedValueOnce({ id: 'variant-1', label: 'v1' }); // variant found

    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // deselect all
      .mockResolvedValueOnce([]) // select chosen
      .mockResolvedValueOnce([]); // update approval

    const res = await request(app)
      .post('/valid-token-12345/photos/photo-1/select-variant')
      .send({ variantId: 'variant-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
