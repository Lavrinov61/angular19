/**
 * Telegram Adapter — Unit Tests
 *
 * Tests for sendTypingIndicator, media_group_id parsing,
 * my_chat_member handling, and ensureWebhook allowed_updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChannelAdapter } from '../core/adapter.interface.js';
import type { ChannelAccount } from '../core/types.js';

// --- Mocks (must be before adapter import) ---

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
const gateMocks = vi.hoisted(() => ({
  callbackData: 'tg_sub_gate_continue',
  gateTelegramInboundMessage: vi.fn().mockResolvedValue('allow'),
  handleTelegramSubscriptionGateCallback: vi.fn().mockResolvedValue(false),
  isTelegramSubscriptionGateCallback: vi.fn().mockReturnValue(false),
}));

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

vi.mock('./telegram-subscription-gate.service.js', () => ({
  TELEGRAM_SUBSCRIPTION_GATE_CALLBACK: gateMocks.callbackData,
  gateTelegramInboundMessage: (...args: unknown[]) => gateMocks.gateTelegramInboundMessage(...args),
  handleTelegramSubscriptionGateCallback: (...args: unknown[]) => gateMocks.handleTelegramSubscriptionGateCallback(...args),
  isTelegramSubscriptionGateCallback: (...args: unknown[]) => gateMocks.isTelegramSubscriptionGateCallback(...args),
}));

// Import adapter after mocks
import { TelegramAdapter } from './telegram.adapter.js';
import { cacheGet } from '../../redis-cache.service.js';

type UnknownRecord = { [key: string]: unknown };
const originalTelegramWebhookUrl = process.env['TELEGRAM_WEBHOOK_URL'];
const originalTelegramPollingMode = process.env['TELEGRAM_POLLING_MODE'];

// --- Fixtures ---

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

function makeOkResponse(data: unknown = { ok: true }): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

// --- Tests ---

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    gateMocks.gateTelegramInboundMessage.mockResolvedValue('allow');
    gateMocks.handleTelegramSubscriptionGateCallback.mockResolvedValue(false);
    gateMocks.isTelegramSubscriptionGateCallback.mockReturnValue(false);
    delete process.env['TELEGRAM_WEBHOOK_URL'];
    delete process.env['TELEGRAM_POLLING_MODE'];
    adapter = new TelegramAdapter();
    account = makeAccount();
  });

  afterEach(() => {
    if (originalTelegramWebhookUrl == null) {
      delete process.env['TELEGRAM_WEBHOOK_URL'];
    } else {
      process.env['TELEGRAM_WEBHOOK_URL'] = originalTelegramWebhookUrl;
    }
    if (originalTelegramPollingMode == null) {
      delete process.env['TELEGRAM_POLLING_MODE'];
    } else {
      process.env['TELEGRAM_POLLING_MODE'] = originalTelegramPollingMode;
    }
  });

  // --- getCapabilities ---

  describe('getCapabilities', () => {
    it('typingIndicator is true', () => {
      expect(adapter.getCapabilities().typingIndicator).toBe(true);
    });
  });

  // --- sendTypingIndicator ---

  describe('sendTypingIndicator', () => {
    it('calls sendChatAction with correct URL and body', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse());

      await adapter.sendTypingIndicator(account, '12345');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telegram.org/bottest-bot-token-123/sendChatAction');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string) as UnknownRecord;
      expect(body).toEqual({ chat_id: '12345', action: 'typing' });
    });

    it('does not throw when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      // Should not throw — error is caught internally
      await expect(adapter.sendTypingIndicator(account, '12345')).resolves.toBeUndefined();
    });

    it('throws when botToken is missing and does not call fetch', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });

      await expect(adapter.sendTypingIndicator(noTokenAccount, '12345'))
        .rejects.toThrow('Telegram credentials are missing botToken');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --- parseInbound: media_group_id ---

  describe('parseInbound — media_group_id', () => {
    it('extracts mediaGroupId from photo message with media_group_id', async () => {
      const body = {
        update_id: 100,
        message: {
          message_id: 42,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          photo: [
            { file_id: 'small', width: 90, height: 90 },
            { file_id: 'large', width: 800, height: 600 },
          ],
          media_group_id: '13579246810',
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].mediaGroupId).toBe('13579246810');
    });

    it('sets mediaGroupId to undefined when not present', async () => {
      const body = {
        update_id: 101,
        message: {
          message_id: 43,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          text: 'Привет',
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].mediaGroupId).toBeUndefined();
    });

    it('ignores non-string media_group_id', async () => {
      const body = {
        update_id: 102,
        message: {
          message_id: 44,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          text: 'Привет',
          media_group_id: 12345, // number, not string
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].mediaGroupId).toBeUndefined();
    });

    it('preserves mediaGroupId on video messages in album', async () => {
      const body = {
        update_id: 103,
        message: {
          message_id: 45,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          video: { file_id: 'vid-1', mime_type: 'video/mp4' },
          media_group_id: '99887766',
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].mediaGroupId).toBe('99887766');
      expect(result[0].messageType).toBe('video');
    });

    it('does not return a message when the subscription gate blocks a new private user', async () => {
      gateMocks.gateTelegramInboundMessage.mockResolvedValueOnce('block');
      const body = {
        update_id: 104,
        message: {
          message_id: 46,
          chat: { id: 12345, type: 'private' },
          from: { id: 777, first_name: 'Иван' },
          text: 'Здравствуйте',
        },
      };
      const channelAdapter: ChannelAdapter = adapter;

      const result = await channelAdapter.parseInbound(body, { 'x-test': '1' }, account);

      expect(result).toEqual([]);
      expect(gateMocks.gateTelegramInboundMessage).toHaveBeenCalledWith({
        account,
        rawBody: body,
        rawHeaders: { 'x-test': '1' },
        chatId: '12345',
        userId: '777',
        externalMessageId: 'tg:46',
        isPrivateChat: true,
      });
    });
  });

  describe('parseInbound — contact sharing', () => {
    it('trusts a Telegram contact only when contact.user_id matches sender id', async () => {
      const body = {
        update_id: 150,
        message: {
          message_id: 50,
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          contact: {
            phone_number: '79990000000',
            first_name: 'Иван',
            user_id: 12345,
          },
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].messageType).toBe('contact');
      expect(result[0].content).toBe('[Клиент поделился номером телефона]');
      expect(result[0].phone).toBe('+79990000000');
    });

    it('does not trust a Telegram contact for another user', async () => {
      const body = {
        update_id: 151,
        message: {
          message_id: 51,
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          contact: {
            phone_number: '79990000000',
            first_name: 'Петр',
            user_id: 99999,
          },
        },
      };

      const result = await adapter.parseInbound(body);

      expect(result).toHaveLength(1);
      expect(result[0].messageType).toBe('contact');
      expect(result[0].content).toBe('[Контакт Telegram без подтверждения]');
      expect(result[0].phone).toBeUndefined();
    });
  });

  // --- isSpecialEvent: my_chat_member ---

  describe('isSpecialEvent — my_chat_member', () => {
    it('returns true for my_chat_member update', () => {
      const body = {
        update_id: 200,
        my_chat_member: {
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          new_chat_member: { status: 'kicked', user: { id: 99999 } },
        },
      };

      expect(adapter.isSpecialEvent(body)).toBe(true);
    });

    it('returns false for regular message', () => {
      const body = {
        update_id: 201,
        message: {
          message_id: 50,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          text: 'Привет',
        },
      };

      expect(adapter.isSpecialEvent(body)).toBe(false);
    });

    it('returns true for /start command', () => {
      const body = {
        update_id: 202,
        message: {
          message_id: 51,
          chat: { id: 12345 },
          from: { first_name: 'Иван' },
          text: '/start',
        },
      };

      expect(adapter.isSpecialEvent(body)).toBe(true);
    });
  });

  // --- handleSpecialEvent: my_chat_member ---

  describe('handleSpecialEvent — my_chat_member', () => {
    it('handles kicked status without error', async () => {
      const body = {
        update_id: 300,
        my_chat_member: {
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          new_chat_member: { status: 'kicked', user: { id: 99999 } },
        },
      };

      const result = await adapter.handleSpecialEvent(body, account);

      expect(result).toBeNull();
      // Should not call any Telegram API
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles left status without error', async () => {
      const body = {
        update_id: 301,
        my_chat_member: {
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          new_chat_member: { status: 'left', user: { id: 99999 } },
        },
      };

      const result = await adapter.handleSpecialEvent(body, account);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles member (unblock) status without error', async () => {
      const body = {
        update_id: 302,
        my_chat_member: {
          chat: { id: 12345 },
          from: { id: 12345, first_name: 'Иван' },
          new_chat_member: { status: 'member', user: { id: 99999 } },
        },
      };

      const result = await adapter.handleSpecialEvent(body, account);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when botToken is missing', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });
      const body = {
        update_id: 303,
        my_chat_member: {
          chat: { id: 12345 },
          from: { id: 12345 },
          new_chat_member: { status: 'kicked', user: { id: 99999 } },
        },
      };

      await expect(adapter.handleSpecialEvent(body, noTokenAccount))
        .rejects.toThrow('Telegram credentials are missing botToken');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('delegates the subscription continue callback before generic callback handling', async () => {
      gateMocks.isTelegramSubscriptionGateCallback.mockReturnValueOnce(true);
      gateMocks.handleTelegramSubscriptionGateCallback.mockResolvedValueOnce(true);
      const body = {
        update_id: 304,
        callback_query: {
          id: 'cb-sub-1',
          data: gateMocks.callbackData,
          from: { id: 777 },
          message: { chat: { id: 12345 } },
        },
      };

      const result = await adapter.handleSpecialEvent(body, account);

      expect(result).toBeNull();
      expect(gateMocks.handleTelegramSubscriptionGateCallback).toHaveBeenCalledWith(
        account,
        body.callback_query,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --- ensureWebhook: allowed_updates ---

  describe('ensureWebhook — allowed_updates', () => {
    it('includes my_chat_member in allowed_updates when setting webhook', async () => {
      // First call: getWebhookInfo → returns different URL (forces setWebhook)
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ ok: true, result: { url: 'https://old.example.com/webhook' } }),
      );
      // Second call: setWebhook → success
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Inspect the setWebhook call
      const [setUrl, setOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(setUrl).toBe('https://api.telegram.org/bottest-bot-token-123/setWebhook');
      const setBody = JSON.parse(setOpts.body as string) as UnknownRecord;
      const allowedUpdates = setBody['allowed_updates'] as string[];
      expect(allowedUpdates).toContain('message');
      expect(allowedUpdates).toContain('edited_message');
      expect(allowedUpdates).toContain('callback_query');
      expect(allowedUpdates).toContain('my_chat_member');
    });

    it('skips setWebhook when URL already matches', async () => {
      // getWebhookInfo returns matching URL
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ ok: true, result: { url: 'https://svoefoto.ru/api/webhooks/telegram' } }),
      );

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      // Only getWebhookInfo was called, not setWebhook
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses account webhookUrl when configured', async () => {
      account = makeAccount({ webhookUrl: 'https://ws.svoefoto.ru/api/webhooks/telegram' });
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ ok: true, result: { url: '' } }),
      );
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      const [, setOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
      const setBody = JSON.parse(setOpts.body as string) as UnknownRecord;
      expect(setBody['url']).toBe('https://ws.svoefoto.ru/api/webhooks/telegram');
    });

    it('uses TELEGRAM_WEBHOOK_URL before account webhookUrl', async () => {
      process.env['TELEGRAM_WEBHOOK_URL'] = 'https://direct.example.com/tg-webhook';
      account = makeAccount({ webhookUrl: 'https://ws.svoefoto.ru/api/webhooks/telegram' });
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ ok: true, result: { url: '' } }),
      );
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      const [, setOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
      const setBody = JSON.parse(setOpts.body as string) as UnknownRecord;
      expect(setBody['url']).toBe('https://direct.example.com/tg-webhook');
    });

    it('skips webhook registration in permanent polling mode', async () => {
      process.env['TELEGRAM_POLLING_MODE'] = 'always';

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('includes secret_token when webhookSecret is configured', async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ ok: true, result: { url: '' } }),
      );
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      await adapter.ensureWebhook(account, 'https://svoefoto.ru');

      const [, setOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
      const setBody = JSON.parse(setOpts.body as string) as UnknownRecord;
      expect(setBody['secret_token']).toBe('test-secret');
    });
  });

  // --- Осиротевшие legacy reply-клавиатуры («Завершить чат», «❌ Не сейчас») ---
  describe('orphan legacy reply keyboards', () => {
    function endChatBody(text: string): Parameters<typeof adapter.isSpecialEvent>[0] {
      const body = {
        update_id: 1,
        message: { message_id: 5, chat: { id: 555111 }, from: { id: 999 }, text },
      } satisfies Parameters<typeof adapter.isSpecialEvent>[0];
      return body;
    }

    it('isSpecialEvent: распознаёт точный текст «Завершить чат» (с обрезкой пробелов)', () => {
      expect(adapter.isSpecialEvent(endChatBody('Завершить чат'))).toBe(true);
      expect(adapter.isSpecialEvent(endChatBody('  Завершить чат  '))).toBe(true);
    });

    it('isSpecialEvent: распознаёт точный текст «❌ Не сейчас» (с обрезкой пробелов)', () => {
      expect(adapter.isSpecialEvent(endChatBody('❌ Не сейчас'))).toBe(true);
      expect(adapter.isSpecialEvent(endChatBody('  ❌ Не сейчас  '))).toBe(true);
    });

    it('isSpecialEvent: НЕ срабатывает на сообщение, лишь содержащее фразу', () => {
      expect(adapter.isSpecialEvent(endChatBody('Хочу завершить чат с оператором'))).toBe(false);
      expect(adapter.isSpecialEvent(endChatBody('Завершить чат пожалуйста'))).toBe(false);
      expect(adapter.isSpecialEvent(endChatBody('Не сейчас, попозже'))).toBe(false);
    });

    it('handleSpecialEvent: гасит клавиатуру (remove_keyboard), не ретранслирует, возвращает null', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      const res = await adapter.handleSpecialEvent(endChatBody('Завершить чат'), account);

      expect(res).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/sendMessage');
      const sentBody = JSON.parse(opts.body as string) as UnknownRecord;
      expect(sentBody['chat_id']).toBe(555111);
      expect((sentBody['reply_markup'] as UnknownRecord)['remove_keyboard']).toBe(true);
    });

    it('handleSpecialEvent(«❌ Не сейчас»): гасит клавиатуру (remove_keyboard), не ретранслирует, возвращает null', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

      const res = await adapter.handleSpecialEvent(endChatBody('❌ Не сейчас'), account);

      expect(res).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/sendMessage');
      const sentBody = JSON.parse(opts.body as string) as UnknownRecord;
      expect(sentBody['chat_id']).toBe(555111);
      expect((sentBody['reply_markup'] as UnknownRecord)['remove_keyboard']).toBe(true);
    });

    it('handleSpecialEvent: кулдаун — если клавиатура уже гасилась, повторно не шлёт (анти-спам burst)', async () => {
      vi.mocked(cacheGet).mockResolvedValueOnce(1);

      const res = await adapter.handleSpecialEvent(endChatBody('Завершить чат'), account);

      expect(res).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
