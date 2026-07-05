import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool, mockSendNotification, mockSetVapidDetails } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
  mockSendNotification: vi.fn(),
  mockSetVapidDetails: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  pool: mockPool,
}));

vi.mock('../config/index.js', () => ({
  config: {
    webPush: {
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      subject: 'mailto:test@example.com',
    },
  },
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
}));

type SendVisitorChatPush = (
  sessionId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) => Promise<void>;

let sendVisitorChatPushFn: SendVisitorChatPush | null = null;

function pushService(): SendVisitorChatPush {
  if (!sendVisitorChatPushFn) {
    throw new Error('visitor push service was not imported');
  }
  return sendVisitorChatPushFn;
}

describe('visitor push service', () => {
  beforeAll(async () => {
    const service = await import('./visitor-push.service.js');
    sendVisitorChatPushFn = service.sendVisitorChatPush;
  });

  beforeEach(() => {
    mockPool.query.mockReset();
    mockSendNotification.mockReset().mockResolvedValue(undefined);
  });

  it('resolves legacy session ids to conversation ids before sending push', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-1',
          endpoint: 'https://push.example/subscription',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ page_url: '/restavraciya-foto' }] });

    await pushService()('legacy-session-1', {
      title: 'Новое сообщение',
      body: 'Оператор ответил',
    });

    expect(mockPool.query.mock.calls[0]?.[1]).toEqual(['legacy-session-1']);
    expect(mockPool.query.mock.calls[1]?.[1]).toEqual(['conv-1']);
    expect(mockPool.query.mock.calls[2]?.[1]).toEqual(['conv-1']);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0]?.[0]).toEqual({
      endpoint: 'https://push.example/subscription',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });

    const payload = mockSendNotification.mock.calls[0]?.[1];
    expect(typeof payload).toBe('string');
    const parsedPayload: unknown = JSON.parse(typeof payload === 'string' ? payload : '{}');
    expect(parsedPayload).toMatchObject({
      title: 'Новое сообщение',
      body: 'Оператор ответил',
      url: '/restavraciya-foto',
      sessionId: 'conv-1',
      tag: 'sf-chat-conv-1',
    });
  });

  it('removes expired subscriptions after web-push reports them gone', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-expired',
          endpoint: 'https://push.example/expired',
          keys: JSON.stringify({ p256dh: 'p256dh-key', auth: 'auth-key' }),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ page_url: null }] })
      .mockResolvedValueOnce({ rows: [] });
    mockSendNotification.mockRejectedValueOnce({ statusCode: 410 });

    await pushService()('conv-1', {
      title: 'Новое сообщение',
      body: 'Оператор ответил',
    });

    expect(mockPool.query.mock.calls[3]?.[0]).toContain('DELETE FROM visitor_push_subscriptions');
    expect(mockPool.query.mock.calls[3]?.[1]).toEqual([['sub-expired']]);
  });
});
