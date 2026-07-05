/**
 * Omnichannel v2 — Instagram Adapter Unit Tests
 *
 * Tests messaging_type format, enrichUserNames with caching,
 * and expired window error handling (codes 10, 551).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChannelAccount } from '../core/types.js';
import type { ParsedMessage, RawRequest } from '../core/dto.js';

// --- Mocks ---

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: async (
    _channel: string,
    _accountId: string | undefined,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

const mockResolveIgUserName = vi.fn<(userId: string, accessToken: string) => Promise<{ name: string; username?: string }>>();
vi.mock('./ig.user-cache.js', () => ({
  resolveIgUserName: (userId: string, accessToken: string) =>
    mockResolveIgUserName(userId, accessToken),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
const { InstagramAdapter } = await import('./instagram.adapter.js');

// --- Fixtures ---

function makeAccount(overrides?: Partial<Record<string, unknown>>): ChannelAccount {
  return {
    id: 'acc-ig-001',
    channel: 'instagram',
    name: 'Test IG',
    isActive: true,
    credentials: {
      accessToken: 'EAAtest123',
      appSecret: 'secret123',
      verifyToken: 'verify_tok',
      businessAccountId: '17841400000',
      ...overrides,
    },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: {
      markAsRead: false, sendPhoto: true, sendFile: true, sendVideo: false,
      sendAudio: false, sendInlineButton: false, replyWindow24h: true,
      forwardDetection: false, replyToDetection: true, statusUpdates: false,
      typingIndicator: false, deleteMessage: false, editMessage: false, twoStepUpload: false, challengeResponse: true,
      confirmationHandshake: false, maxMediaSizeBytes: 25 * 1024 * 1024,
      maxTextLength: 1000,
    },
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeTextWebhook(senderId: string, text: string, mid = 'mid.123'): Record<string, unknown> {
  return {
    object: 'instagram',
    entry: [{
      id: '17841400000',
      time: Date.now(),
      messaging: [{
        sender: { id: senderId },
        recipient: { id: '17841400000' },
        timestamp: Date.now(),
        message: { mid, text },
      }],
    }],
  };
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response;
}

// --- Tests ---

describe('InstagramAdapter', () => {
  let adapter: InstanceType<typeof InstagramAdapter>;

  beforeEach(() => {
    adapter = new InstagramAdapter();
    vi.clearAllMocks();
  });

  // --- messaging_type ---

  describe('messaging_type format', () => {
    it('sendText uses MESSAGE_TAG + tag: HUMAN_AGENT (not messaging_type: HUMAN_AGENT)', async () => {
      const account = makeAccount();
      mockFetch.mockResolvedValueOnce(makeResponse(200, { message_id: 'msg-001' }));

      const result = await adapter.sendText(account, 'user-123', 'Привет!');

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('msg-001');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe('https://graph.instagram.com/v21.0/17841400000/messages');

      const body = JSON.parse(opts['body'] as string) as Record<string, unknown>;
      expect(body['messaging_type']).toBe('MESSAGE_TAG');
      expect(body['tag']).toBe('HUMAN_AGENT');
      // Verify the old incorrect format is NOT used
      expect(body['messaging_type']).not.toBe('HUMAN_AGENT');
    });

    it('sendMedia uses MESSAGE_TAG + tag: HUMAN_AGENT', async () => {
      const account = makeAccount();
      mockFetch.mockResolvedValueOnce(makeResponse(200, { message_id: 'msg-002' }));

      const result = await adapter.sendMedia(
        account, 'user-123', 'https://cdn.example.com/photo.jpg', 'image',
      );

      expect(result.success).toBe(true);

      const [, opts] = mockFetch.mock.calls[0] as [string, Record<string, unknown>];
      const body = JSON.parse(opts['body'] as string) as Record<string, unknown>;
      expect(body['messaging_type']).toBe('MESSAGE_TAG');
      expect(body['tag']).toBe('HUMAN_AGENT');
    });

    it('sendText includes reply_to when replyToExternalId provided', async () => {
      const account = makeAccount();
      mockFetch.mockResolvedValueOnce(makeResponse(200, { message_id: 'msg-003' }));

      await adapter.sendText(account, 'user-123', 'Ответ', 'mid.original');

      const [, opts] = mockFetch.mock.calls[0] as [string, Record<string, unknown>];
      const body = JSON.parse(opts['body'] as string) as Record<string, unknown>;
      const message = body['message'] as Record<string, unknown>;
      expect(message['reply_to']).toEqual({ mid: 'mid.original' });
    });

    it('sendText returns error when credentials not configured', async () => {
      const account = makeAccount({ accessToken: '' });
      const result = await adapter.sendText(account, 'user-123', 'test');
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Instagram credentials not configured');
    });
  });

  // --- enrichUserNames ---

  describe('enrichUserNames', () => {
    it('resolves IG:{id} user names via cache', async () => {
      const account = makeAccount();
      const messages: ParsedMessage[] = [
        {
          externalMessageId: 'mid.1', externalChatId: '111', externalUserId: '111',
          userName: 'IG:111', content: 'Hello', messageType: 'text', isForwarded: false,
        },
        {
          externalMessageId: 'mid.2', externalChatId: '222', externalUserId: '222',
          userName: 'IG:222', content: 'Hi', messageType: 'text', isForwarded: false,
        },
      ];

      mockResolveIgUserName.mockImplementation(async (userId: string) => {
        if (userId === '111') return { name: 'Иван Петров', username: 'ivan_petrov' };
        if (userId === '222') return { name: 'Анна Сидорова' };
        return { name: `IG:${userId}` };
      });

      await adapter.enrichUserNames!(messages, account);

      expect(messages[0].userName).toBe('Иван Петров');
      expect(messages[0].username).toBe('ivan_petrov');
      expect(messages[1].userName).toBe('Анна Сидорова');
      expect(messages[1].username).toBeUndefined();
    });

    it('deduplicates API calls for same userId', async () => {
      const account = makeAccount();
      const messages: ParsedMessage[] = [
        {
          externalMessageId: 'mid.1', externalChatId: '111', externalUserId: '111',
          userName: 'IG:111', content: 'msg1', messageType: 'text', isForwarded: false,
        },
        {
          externalMessageId: 'mid.2', externalChatId: '111', externalUserId: '111',
          userName: 'IG:111', content: 'msg2', messageType: 'text', isForwarded: false,
        },
      ];

      mockResolveIgUserName.mockResolvedValue({ name: 'User' });

      await adapter.enrichUserNames!(messages, account);

      // Only one call despite two messages with same userId
      expect(mockResolveIgUserName).toHaveBeenCalledTimes(1);
      expect(mockResolveIgUserName).toHaveBeenCalledWith('111', 'EAAtest123');
    });

    it('skips enrichment when accessToken is empty', async () => {
      const account = makeAccount({ accessToken: '' });
      const messages: ParsedMessage[] = [
        {
          externalMessageId: 'mid.1', externalChatId: '111', externalUserId: '111',
          userName: 'IG:111', content: 'msg', messageType: 'text', isForwarded: false,
        },
      ];

      await adapter.enrichUserNames!(messages, account);

      expect(mockResolveIgUserName).not.toHaveBeenCalled();
      expect(messages[0].userName).toBe('IG:111');
    });

    it('skips enrichment for already resolved names', async () => {
      const account = makeAccount();
      const messages: ParsedMessage[] = [
        {
          externalMessageId: 'mid.1', externalChatId: '111', externalUserId: '111',
          userName: 'Already Resolved', content: 'msg', messageType: 'text', isForwarded: false,
        },
      ];

      await adapter.enrichUserNames!(messages, account);

      expect(mockResolveIgUserName).not.toHaveBeenCalled();
    });

    it('skips enrichment for empty messages array', async () => {
      const account = makeAccount();
      await adapter.enrichUserNames!([], account);
      expect(mockResolveIgUserName).not.toHaveBeenCalled();
    });
  });

  // --- Window expired errors ---

  describe('window expired handling', () => {
    it('sendText returns WINDOW_EXPIRED for IG error code 10 (OAuthException)', async () => {
      const account = makeAccount();
      const igError = {
        error: {
          message: 'Application does not have permission',
          type: 'OAuthException',
          code: 10,
          fbtrace_id: 'abc123',
        },
      };
      mockFetch.mockResolvedValueOnce(makeResponse(400, igError));

      const result = await adapter.sendText(account, 'user-123', 'test');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('WINDOW_EXPIRED');
      expect(result.errorMessage).toContain('Messaging window expired');
      expect(result.errorMessage).toContain('code 10');
    });

    it('sendText returns WINDOW_EXPIRED for IG error code 551', async () => {
      const account = makeAccount();
      const igError = {
        error: {
          message: 'This message is sent outside of allowed window',
          type: 'OAuthException',
          code: 551,
          error_subcode: 2534015,
        },
      };
      mockFetch.mockResolvedValueOnce(makeResponse(400, igError));

      const result = await adapter.sendText(account, 'user-123', 'test');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('WINDOW_EXPIRED');
      expect(result.errorMessage).toContain('code 551');
    });

    it('sendMedia returns WINDOW_EXPIRED for IG error code 551', async () => {
      const account = makeAccount();
      const igError = {
        error: {
          message: 'This message is sent outside of allowed window',
          type: 'OAuthException',
          code: 551,
        },
      };
      mockFetch.mockResolvedValueOnce(makeResponse(400, igError));

      const result = await adapter.sendMedia(
        account, 'user-123', 'https://cdn.example.com/img.jpg', 'image',
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('WINDOW_EXPIRED');
    });

    it('non-window errors return HTTP status as errorCode', async () => {
      const account = makeAccount();
      const igError = {
        error: {
          message: 'Invalid OAuth access token',
          type: 'OAuthException',
          code: 190,
        },
      };
      mockFetch.mockResolvedValueOnce(makeResponse(401, igError));

      const result = await adapter.sendText(account, 'user-123', 'test');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('401');
      expect(result.errorCode).not.toBe('WINDOW_EXPIRED');
    });

    it('non-JSON error response returns HTTP status as errorCode', async () => {
      const account = makeAccount();
      mockFetch.mockResolvedValueOnce(makeResponse(500, 'Internal Server Error'));

      const result = await adapter.sendText(account, 'user-123', 'test');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('500');
    });

    it('error without code field is not treated as window expired', async () => {
      const account = makeAccount();
      const igError = {
        error: {
          message: 'Something went wrong',
          type: 'OAuthException',
        },
      };
      mockFetch.mockResolvedValueOnce(makeResponse(400, igError));

      const result = await adapter.sendText(account, 'user-123', 'test');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('400');
      expect(result.errorCode).not.toBe('WINDOW_EXPIRED');
    });
  });

  // --- parseInbound ---

  describe('parseInbound', () => {
    it('parses text message', async () => {
      const body = makeTextWebhook('12345', 'Hello world');
      const messages = await adapter.parseInbound(body);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].externalUserId).toBe('12345');
      expect(messages[0].userName).toBe('IG:12345');
      expect(messages[0].messageType).toBe('text');
    });

    it('skips echo messages', async () => {
      const body: Record<string, unknown> = {
        object: 'instagram',
        entry: [{
          messaging: [{
            sender: { id: '12345' },
            message: { mid: 'mid.1', text: 'echo', is_echo: true },
          }],
        }],
      };

      const messages = await adapter.parseInbound(body);
      expect(messages).toHaveLength(0);
    });

    it('returns empty for non-instagram object', async () => {
      const messages = await adapter.parseInbound({ object: 'page' });
      expect(messages).toHaveLength(0);
    });

    it('detects reply_to', async () => {
      const body: Record<string, unknown> = {
        object: 'instagram',
        entry: [{
          messaging: [{
            sender: { id: '12345' },
            message: { mid: 'mid.2', text: 'reply', reply_to: { mid: 'mid.original' } },
          }],
        }],
      };

      const messages = await adapter.parseInbound(body);
      expect(messages[0].replyToExternalId).toBe('mid.original');
    });

    it('parses image attachment', async () => {
      const body: Record<string, unknown> = {
        object: 'instagram',
        entry: [{
          messaging: [{
            sender: { id: '12345' },
            message: {
              mid: 'mid.3',
              attachments: [{ type: 'image', payload: { url: 'https://cdn.ig/photo.jpg' } }],
            },
          }],
        }],
      };

      const messages = await adapter.parseInbound(body);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageType).toBe('image');
      expect(messages[0].content).toBe('[Фото]');
      expect(messages[0].media).toHaveLength(1);
      expect(messages[0].media![0].sourceRef).toBe('https://cdn.ig/photo.jpg');
      expect(messages[0].media![0].sourceType).toBe('url');
    });
  });

  // --- verifyWebhook ---

  describe('verifyWebhook', () => {
    it('returns challenge on valid subscribe request', () => {
      const account = makeAccount();
      const req: RawRequest = {
        body: {},
        headers: {},
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'verify_tok',
          'hub.challenge': 'challenge_123',
        },
      };

      const result = adapter.verifyWebhook(req, account);
      expect(result.valid).toBe(true);
      expect(result.challengeResponse).toBe('challenge_123');
    });

    it('rejects invalid verify token', () => {
      const account = makeAccount();
      const req: RawRequest = {
        body: {},
        headers: {},
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'challenge_123',
        },
      };

      const result = adapter.verifyWebhook(req, account);
      expect(result.valid).toBe(false);
    });
  });

  // --- extractIdempotencyKey ---

  describe('extractIdempotencyKey', () => {
    it('extracts mid as ig: prefixed key', () => {
      const body = makeTextWebhook('12345', 'text', 'mid.abc');
      const key = adapter.extractIdempotencyKey(body);
      expect(key).toBe('ig:mid.abc');
    });

    it('returns null for body without message', () => {
      const key = adapter.extractIdempotencyKey({ entry: [{ messaging: [{}] }] });
      expect(key).toBeNull();
    });
  });

  // --- getCapabilities ---

  describe('getCapabilities', () => {
    it('reports replyWindow24h as true', () => {
      const caps = adapter.getCapabilities();
      expect(caps.replyWindow24h).toBe(true);
      expect(caps.challengeResponse).toBe(true);
      expect(caps.sendPhoto).toBe(true);
      expect(caps.sendVideo).toBe(false);
    });
  });
});
