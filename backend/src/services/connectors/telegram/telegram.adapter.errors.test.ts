/**
 * Telegram Adapter — Error classification & sendMedia inline keyboard (S1)
 *
 * Covers:
 *  - parseTgError surfaces parameters.retry_after on HTTP 429 (and ignores
 *    non-JSON / missing fields) via the public send-methods.
 *  - sendMedia attaches reply_markup when an inlineKeyboard is passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelAccount } from '../core/types.js';

// --- Mocks (must be before adapter import) ---

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: (_channel: unknown, _accountId: unknown, fn: () => unknown) => fn(),
}));

vi.mock('../../../database/db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../redis-cache.service.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

// Import adapter after mocks
import { TelegramAdapter } from './telegram.adapter.js';

function makeAccount(overrides?: Partial<ChannelAccount>): ChannelAccount {
  return {
    id: 'acc-tg-1',
    channel: 'telegram',
    name: 'Test Telegram Bot',
    isActive: true,
    credentials: { botToken: 'test-bot-token-123', webhookSecret: 'test-secret' },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: new TelegramAdapter().getCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as Response;
}

/** Source-fetch (media bytes) for sendMedia: ok, returns bytes + content-type. */
function makeSourceResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
  } as unknown as Response;
}

function makeSendOkResponse(messageId = 555): Response {
  const data = { ok: true, result: { message_id: messageId } };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe('TelegramAdapter — error classification (parseTgError)', () => {
  let adapter: TelegramAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
    account = makeAccount();
  });

  it('429 with parameters.retry_after → SendResult.retryAfter is the number', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, '{"ok":false,"parameters":{"retry_after":35}}'),
    );

    const res = await adapter.sendText(account, '12345', 'hello');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('429');
    expect(res.retryAfter).toBe(35);
    expect(res.errorMessage).toBe('{"ok":false,"parameters":{"retry_after":35}}');
  });

  it('429 with non-JSON body → retryAfter undefined, body preserved as errorMessage', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(429, 'not json'));

    const res = await adapter.sendText(account, '12345', 'hello');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('429');
    expect(res.retryAfter).toBeUndefined();
    expect(res.errorMessage).toBe('not json');
  });

  it('429 without parameters.retry_after → retryAfter undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, '{"ok":false,"description":"Too Many Requests"}'),
    );

    const res = await adapter.sendText(account, '12345', 'hello');

    expect(res.retryAfter).toBeUndefined();
    expect(res.errorCode).toBe('429');
  });

  it('non-429 error (400) → retryAfter undefined regardless of body', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, '{"ok":false,"parameters":{"retry_after":10}}'),
    );

    const res = await adapter.sendText(account, '12345', 'hello');

    expect(res.errorCode).toBe('400');
    expect(res.retryAfter).toBeUndefined();
  });

  it('editMessageText 429 also surfaces retryAfter', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, '{"ok":false,"parameters":{"retry_after":12}}'),
    );

    const res = await adapter.editMessageText(account, '12345', 'tg:42', 'new');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('429');
    expect(res.retryAfter).toBe(12);
  });

  it('sendWithInlineButton 429 also surfaces retryAfter', async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, '{"ok":false,"parameters":{"retry_after":7}}'),
    );

    const res = await adapter.sendWithInlineButton(account, '12345', 'txt', 'label', 'https://x');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('429');
    expect(res.retryAfter).toBe(7);
  });
});

describe('TelegramAdapter — sendMedia inlineKeyboard', () => {
  let adapter: TelegramAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
    account = makeAccount();
  });

  it('passes reply_markup with inline_keyboard in the multipart body', async () => {
    // 1st fetch = source media bytes; 2nd fetch = Telegram sendPhoto
    mockFetch.mockResolvedValueOnce(makeSourceResponse());
    mockFetch.mockResolvedValueOnce(makeSendOkResponse());

    const keyboard = [[{ text: 'Открыть', url: 'https://svoefoto.ru/?utm_content=c1' }]];
    const res = await adapter.sendMedia(
      account,
      '12345',
      'https://cdn.example/img.jpg',
      'image',
      'caption text',
      undefined,
      undefined,
      keyboard,
    );

    expect(res.success).toBe(true);

    // The Telegram POST is the 2nd fetch call.
    const [, opts] = mockFetch.mock.calls[1] as [string, { body: ArrayBuffer }];
    const bodyText = Buffer.from(opts.body).toString('utf8');
    expect(bodyText).toContain('reply_markup');
    expect(bodyText).toContain('inline_keyboard');
    expect(bodyText).toContain('https://svoefoto.ru/?utm_content=c1');
    expect(bodyText).toContain('Открыть');
  });

  it('omits reply_markup when no inlineKeyboard is passed (backward-compatible)', async () => {
    mockFetch.mockResolvedValueOnce(makeSourceResponse());
    mockFetch.mockResolvedValueOnce(makeSendOkResponse());

    const res = await adapter.sendMedia(
      account,
      '12345',
      'https://cdn.example/img.jpg',
      'image',
      'caption text',
    );

    expect(res.success).toBe(true);
    const [, opts] = mockFetch.mock.calls[1] as [string, { body: ArrayBuffer }];
    const bodyText = Buffer.from(opts.body).toString('utf8');
    expect(bodyText).not.toContain('reply_markup');
  });
});
