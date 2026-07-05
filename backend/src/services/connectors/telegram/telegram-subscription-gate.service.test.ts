import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAccount } from '../core/types.js';

const mocks = vi.hoisted(() => {
  const queueAdd = vi.fn();
  const queueClose = vi.fn();
  const queueConstructor = vi.fn(function QueueMock() {
    return { add: queueAdd, close: queueClose };
  });
  return {
    fetchWithTimeout: vi.fn(),
    dbQueryOne: vi.fn(),
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    cacheDel: vi.fn(),
    queueAdd,
    queueClose,
    queueConstructor,
  };
});

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mocks.fetchWithTimeout(...args),
}));

vi.mock('../../../database/db.js', () => ({
  default: {
    queryOne: (...args: unknown[]) => mocks.dbQueryOne(...args),
  },
}));

vi.mock('../../redis-cache.service.js', () => ({
  cacheGet: (...args: unknown[]) => mocks.cacheGet(...args),
  cacheSet: (...args: unknown[]) => mocks.cacheSet(...args),
  cacheDel: (...args: unknown[]) => mocks.cacheDel(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('bullmq', () => ({
  Queue: mocks.queueConstructor,
}));

import {
  TELEGRAM_SUBSCRIPTION_GATE_CALLBACK,
  gateTelegramInboundMessage,
  handleTelegramSubscriptionGateCallback,
  isTelegramSubscriptionGateCallback,
} from './telegram-subscription-gate.service.js';

interface JsonObject {
  [key: string]: unknown;
}

function makeAccount(overrides?: Partial<ChannelAccount>): ChannelAccount {
  return {
    id: 'acc-tg-1',
    channel: 'telegram',
    name: 'Test Telegram Bot',
    isActive: true,
    credentials: { botToken: 'test-bot-token-123', webhookSecret: 'test-secret' },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: {
      markAsRead: false,
      sendPhoto: true,
      sendFile: true,
      sendVideo: true,
      sendAudio: true,
      sendInlineButton: true,
      replyWindow24h: false,
      forwardDetection: true,
      replyToDetection: true,
      statusUpdates: false,
      typingIndicator: true,
      deleteMessage: true,
      editMessage: true,
      twoStepUpload: false,
      challengeResponse: false,
      confirmationHandshake: false,
      maxMediaSizeBytes: 50 * 1024 * 1024,
      maxTextLength: 4096,
    },
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeResponse(ok: boolean, status: number, data: unknown): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

function getJsonBody(callIndex: number): JsonObject {
  const [, init] = mocks.fetchWithTimeout.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(init.body as string) as JsonObject;
}

describe('telegram subscription gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['TELEGRAM_SUBSCRIPTION_GATE_ENABLED'];
    delete process.env['TELEGRAM_SUBSCRIPTION_GATE_CHANNEL'];
    delete process.env['TELEGRAM_SUBSCRIPTION_GATE_URL'];
    mocks.cacheGet.mockResolvedValue(null);
    mocks.cacheSet.mockResolvedValue(undefined);
    mocks.cacheDel.mockResolvedValue(undefined);
    mocks.dbQueryOne.mockResolvedValue(null);
  });

  it('blocks a new private Telegram user until channel subscription is visible', async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(makeResponse(false, 400, {
        ok: false,
        description: 'Bad Request: user not found',
      }))
      .mockResolvedValueOnce(makeResponse(true, 200, { ok: true, result: { message_id: 77 } }));

    const decision = await gateTelegramInboundMessage({
      account: makeAccount(),
      rawBody: { update_id: 100, message: { message_id: 42, text: 'Здравствуйте' } },
      rawHeaders: { 'x-telegram-bot-api-secret-token': 'secret' },
      chatId: '12345',
      userId: '12345',
      externalMessageId: 'tg:42',
      isPrivateChat: true,
    });

    expect(decision).toBe('block');
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      'tg_sub_gate:pending:acc-tg-1:12345',
      expect.objectContaining({
        accountId: 'acc-tg-1',
        externalMessageId: 'tg:42',
        rawBody: expect.objectContaining({ update_id: 100 }),
        rawHeaders: expect.objectContaining({ 'x-telegram-bot-api-secret-token': 'secret' }),
      }),
      86_400,
    );
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(String(mocks.fetchWithTimeout.mock.calls[0][0])).toContain('/getChatMember');
    expect(String(mocks.fetchWithTimeout.mock.calls[1][0])).toContain('/sendMessage');

    const promptBody = getJsonBody(1);
    expect(promptBody['chat_id']).toBe('12345');
    expect(String(promptBody['text'])).toContain('подпишитесь на наш канал');
    expect(promptBody['reply_markup']).toEqual({
      inline_keyboard: [
        [{ text: 'Подписаться на канал', url: 'https://t.me/magnus_photo' }],
        [{ text: 'Я подписался, продолжить', callback_data: TELEGRAM_SUBSCRIPTION_GATE_CALLBACK }],
      ],
    });
  });

  it('allows an existing Telegram conversation without checking channel membership', async () => {
    mocks.dbQueryOne.mockResolvedValueOnce({ id: 'conv-1' });

    const decision = await gateTelegramInboundMessage({
      account: makeAccount(),
      rawBody: { update_id: 101 },
      rawHeaders: {},
      chatId: '12345',
      userId: '12345',
      externalMessageId: 'tg:43',
      isPrivateChat: true,
    });

    expect(decision).toBe('allow');
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it('allows a new Telegram user who is already subscribed to the channel', async () => {
    mocks.fetchWithTimeout.mockResolvedValueOnce(makeResponse(true, 200, {
      ok: true,
      result: { status: 'member' },
    }));

    const decision = await gateTelegramInboundMessage({
      account: makeAccount(),
      rawBody: { update_id: 102 },
      rawHeaders: {},
      chatId: '12345',
      userId: '12345',
      externalMessageId: 'tg:44',
      isPrivateChat: true,
    });

    expect(decision).toBe('allow');
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it('answers the continue callback when the user still is not subscribed', async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(makeResponse(false, 400, { ok: false, description: 'not found' }))
      .mockResolvedValueOnce(makeResponse(true, 200, { ok: true }));

    const handled = await handleTelegramSubscriptionGateCallback(makeAccount(), {
      id: 'cb-1',
      data: TELEGRAM_SUBSCRIPTION_GATE_CALLBACK,
      from: { id: 12345 },
      message: { chat: { id: 12345 } },
    });

    expect(handled).toBe(true);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
    expect(mocks.cacheDel).not.toHaveBeenCalled();
    const answerBody = getJsonBody(1);
    expect(answerBody).toEqual({
      callback_query_id: 'cb-1',
      text: 'Пока не видим подписку. Подпишитесь на канал и нажмите кнопку ещё раз.',
      show_alert: true,
    });
  });

  it('replays the pending Telegram update after a successful subscription check', async () => {
    mocks.cacheGet.mockResolvedValueOnce({
      accountId: 'acc-tg-1',
      rawBody: { update_id: 103, message: { message_id: 45, text: 'Здравствуйте' } },
      rawHeaders: { 'x-telegram-bot-api-secret-token': 'secret' },
      externalMessageId: 'tg:45',
      createdAt: '2026-06-22T06:00:00.000Z',
    });
    mocks.dbQueryOne.mockResolvedValueOnce({ id: 'evt-1' });
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(makeResponse(true, 200, { ok: true, result: { status: 'member' } }))
      .mockResolvedValueOnce(makeResponse(true, 200, { ok: true }))
      .mockResolvedValueOnce(makeResponse(true, 200, { ok: true, result: { message_id: 78 } }));

    const handled = await handleTelegramSubscriptionGateCallback(makeAccount(), {
      id: 'cb-2',
      data: TELEGRAM_SUBSCRIPTION_GATE_CALLBACK,
      from: { id: 12345 },
      message: { chat: { id: 12345 } },
    });

    expect(handled).toBe(true);
    expect(mocks.dbQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO webhook_events'),
      [
        'acc-tg-1',
        { 'x-telegram-bot-api-secret-token': 'secret' },
        { update_id: 103, message: { message_id: 45, text: 'Здравствуйте' } },
        'tg-subgate-replay:tg:45',
      ],
    );
    expect(mocks.cacheSet).toHaveBeenCalledWith('tg_sub_gate:bypass:acc-tg-1:tg:45', 1, 300);
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'process-inbound',
      { webhookEventId: 'evt-1', channel: 'telegram', accountId: 'acc-tg-1' },
      expect.objectContaining({ attempts: 3 }),
    );
    expect(mocks.cacheDel).toHaveBeenCalledWith('tg_sub_gate:pending:acc-tg-1:12345');
    expect(String(mocks.fetchWithTimeout.mock.calls[2][0])).toContain('/sendMessage');
  });

  it('recognizes only the subscription gate callback payload', () => {
    expect(isTelegramSubscriptionGateCallback(TELEGRAM_SUBSCRIPTION_GATE_CALLBACK)).toBe(true);
    expect(isTelegramSubscriptionGateCallback('booking_confirm_1')).toBe(false);
  });
});
