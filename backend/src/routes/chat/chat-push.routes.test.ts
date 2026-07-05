import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { authHeader, makeClientUser } from '../../test-utils/mock-auth.js';

const { mockDb, mockPool } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn(),
  };
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn(),
    end: vi.fn(),
  };
  return { mockDb, mockPool };
});

vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../database/db.js', () => ({
  default: mockDb,
  pool: mockPool,
}));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret-for-tests',
      secretPrevious: undefined,
      expiresIn: '15m',
    },
    redis: { host: '', port: 6379, password: undefined, tls: false },
    webPush: {
      publicKey: 'test-vapid-public-key',
      privateKey: 'test-vapid-private-key',
      subject: 'mailto:test@example.com',
    },
  },
}));
vi.mock('../../services/visitor-push.service.js', () => ({
  getWebPushPublicKey: vi.fn().mockReturnValue('test-vapid-public-key'),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./chat-push.routes.js');
  app = createTestApp(router);
});

function resetMocks(): void {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

const CLIENT_USER = {
  id: 'client-id',
  email: 'client@example.com',
  role: 'client',
  is_active: true,
  display_name: 'Client User',
  phone: null,
  force_password_change: false,
  last_password_change: null,
};

const OWNED_CONVERSATION = {
  id: 'session-1',
  contact_id: 'contact-1',
  channel: 'web',
  status: 'open',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  user_id: 'client-id',
};

const SUBSCRIPTION_BODY = {
  sessionId: 'session-1',
  subscription: {
    endpoint: 'https://push.example.com/subscription',
    keys: {
      p256dh: 'p256dh-key',
      auth: 'auth-key',
    },
  },
};

describe('chat push routes', () => {
  beforeEach(resetMocks);

  it('returns public VAPID key without auth', async () => {
    const res = await request(app).get('/push/vapid-public-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      publicKey: 'test-vapid-public-key',
    });
  });

  it('requires auth for push subscribe', async () => {
    const res = await request(app).post('/push/subscribe').send(SUBSCRIPTION_BODY);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('stores push subscription for the authenticated owner contact', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(CLIENT_USER);
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [OWNED_CONVERSATION] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/push/subscribe')
      .set(authHeader(makeClientUser({ id: 'client-id' })))
      .set('User-Agent', 'vitest')
      .send(SUBSCRIPTION_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockPool.query).toHaveBeenCalledTimes(3);

    const insertCall = vi.mocked(mockPool.query).mock.calls[2];
    expect(insertCall?.[1]).toEqual([
      'session-1',
      'contact-1',
      'https://push.example.com/subscription',
      JSON.stringify({ p256dh: 'p256dh-key', auth: 'auth-key' }),
      'vitest',
    ]);
  });

  it('rejects push subscribe for another user conversation', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(CLIENT_USER);
    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [{ ...OWNED_CONVERSATION, user_id: 'other-user-id' }],
    });

    const res = await request(app)
      .post('/push/subscribe')
      .set(authHeader(makeClientUser({ id: 'client-id' })))
      .send(SUBSCRIPTION_BODY);

    expect(res.status).toBe(403);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});
