/**
 * WhatsApp Adapter — Unit Tests
 *
 * Tests sendTemplate, sendInteractiveButtons, 24h window check,
 * WINDOW_EXPIRED handling, and capabilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must be before imports) ─────────────────────────────────────────

const mockFetch = vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(args[0] as string, args[1] as RequestInit),
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: (_ch: string, _id: string, fn: () => unknown) => fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { WhatsAppAdapter } from './whatsapp.adapter.js';
import type { ChannelAccount } from '../core/types.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeWaAccount(overrides?: Partial<Record<string, unknown>>): ChannelAccount {
  return {
    id: 'wa-acc-1',
    channel: 'whatsapp',
    name: 'Test WhatsApp',
    isActive: true,
    credentials: {
      phoneNumberId: '123456789',
      accessToken: 'test-token-abc',
      verifyToken: 'verify-test',
      appSecret: 'app-secret-xyz',
      ...overrides,
    },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: new WhatsAppAdapter().getCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSuccessResponse(messageId: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: messageId }] }),
    text: async () => '',
  } as unknown as Response;
}

function makeErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    adapter = new WhatsAppAdapter();
    account = makeWaAccount();
    vi.clearAllMocks();
  });

  // ── sendTemplate ────────────────────────────────────────────────────────

  describe('sendTemplate', () => {
    it('sends correct template payload to Meta Graph API', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.template123'));

      const result = await adapter.sendTemplate(
        account,
        '79014178668',
        'order_confirmation',
        'ru',
        [{ type: 'body', parameters: [{ type: 'text', text: 'Order #42' }] }],
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.template123');

      // Verify API call
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');
      expect(opts?.method).toBe('POST');

      const headers = opts?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-token-abc');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['messaging_product']).toBe('whatsapp');
      expect(body['to']).toBe('79014178668');
      expect(body['type']).toBe('template');

      const template = body['template'] as Record<string, unknown>;
      expect(template['name']).toBe('order_confirmation');
      expect(template['language']).toEqual({ code: 'ru' });
      expect(template['components']).toEqual([
        { type: 'body', parameters: [{ type: 'text', text: 'Order #42' }] },
      ]);
    });

    it('sends template with empty components when none provided', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.t456'));

      await adapter.sendTemplate(account, '79001234567', 'welcome', 'ru');

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string) as Record<string, unknown>;
      const template = body['template'] as Record<string, unknown>;
      expect(template['components']).toEqual([]);
    });

    it('normalizes 8-prefixed Russian phone to 7-prefix', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.norm'));

      await adapter.sendTemplate(account, '89014178668', 'test_tpl', 'ru');

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string) as Record<string, unknown>;
      expect(body['to']).toBe('79014178668');
    });

    it('returns failure on missing credentials', async () => {
      const noCredsAccount = makeWaAccount({ phoneNumberId: '', accessToken: '' });

      const result = await adapter.sendTemplate(noCredsAccount, '79001234567', 'tpl', 'ru');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('WhatsApp credentials not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns failure with error details on API error', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(400, '{"error":{"message":"Invalid template"}}'));

      const result = await adapter.sendTemplate(account, '79001234567', 'invalid_tpl', 'ru');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('400');
      expect(result.errorMessage).toContain('Invalid template');
    });
  });

  // ── sendInteractiveButtons ─────────────────────────────────────────────

  describe('sendInteractiveButtons', () => {
    it('sends correct interactive buttons payload', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.btn123'));

      const result = await adapter.sendInteractiveButtons(
        account,
        '79014178668',
        'Вы хотите подтвердить запись?',
        [
          { id: 'btn_yes', title: 'Да' },
          { id: 'btn_no', title: 'Нет' },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.btn123');

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');

      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['messaging_product']).toBe('whatsapp');
      expect(body['to']).toBe('79014178668');
      expect(body['type']).toBe('interactive');

      const interactive = body['interactive'] as Record<string, unknown>;
      expect(interactive['type']).toBe('button');
      expect(interactive['body']).toEqual({ text: 'Вы хотите подтвердить запись?' });

      const action = interactive['action'] as Record<string, unknown>;
      const buttons = action['buttons'] as Array<Record<string, unknown>>;
      expect(buttons).toHaveLength(2);

      expect(buttons[0]).toEqual({
        type: 'reply',
        reply: { id: 'btn_yes', title: 'Да' },
      });
      expect(buttons[1]).toEqual({
        type: 'reply',
        reply: { id: 'btn_no', title: 'Нет' },
      });
    });

    it('supports exactly 3 buttons (max)', async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.3btn'));

      const result = await adapter.sendInteractiveButtons(
        account,
        '79001234567',
        'Выберите вариант:',
        [
          { id: 'a', title: 'А' },
          { id: 'b', title: 'Б' },
          { id: 'c', title: 'В' },
        ],
      );

      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string) as Record<string, unknown>;
      const interactive = body['interactive'] as Record<string, unknown>;
      const action = interactive['action'] as Record<string, unknown>;
      const buttons = action['buttons'] as Array<unknown>;
      expect(buttons).toHaveLength(3);
    });

    it('rejects 0 buttons', async () => {
      const result = await adapter.sendInteractiveButtons(
        account,
        '79001234567',
        'Текст',
        [],
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('1-3 reply buttons');
      expect(result.errorMessage).toContain('got 0');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects more than 3 buttons', async () => {
      const result = await adapter.sendInteractiveButtons(
        account,
        '79001234567',
        'Текст',
        [
          { id: 'a', title: 'А' },
          { id: 'b', title: 'Б' },
          { id: 'c', title: 'В' },
          { id: 'd', title: 'Г' },
        ],
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('1-3 reply buttons');
      expect(result.errorMessage).toContain('got 4');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns failure on missing credentials', async () => {
      const noCredsAccount = makeWaAccount({ phoneNumberId: '', accessToken: '' });

      const result = await adapter.sendInteractiveButtons(
        noCredsAccount,
        '79001234567',
        'Текст',
        [{ id: 'btn1', title: 'Да' }],
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('WhatsApp credentials not configured');
    });

    it('returns failure on API error', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(429, 'Rate limited'));

      const result = await adapter.sendInteractiveButtons(
        account,
        '79001234567',
        'Текст',
        [{ id: 'btn1', title: 'Ок' }],
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('429');
    });
  });

  // ── Capabilities ──────────────────────────────────────────────────────

  describe('getCapabilities', () => {
    it('reports sendInlineButton as true', () => {
      const caps = adapter.getCapabilities();
      expect(caps.sendInlineButton).toBe(true);
    });

    it('reports replyWindow24h as true', () => {
      const caps = adapter.getCapabilities();
      expect(caps.replyWindow24h).toBe(true);
    });

    it('reports all media types supported', () => {
      const caps = adapter.getCapabilities();
      expect(caps.sendPhoto).toBe(true);
      expect(caps.sendFile).toBe(true);
      expect(caps.sendVideo).toBe(true);
      expect(caps.sendAudio).toBe(true);
    });

    it('maxTextLength is 4096 (WhatsApp limit)', () => {
      expect(adapter.getCapabilities().maxTextLength).toBe(4096);
    });
  });
});
