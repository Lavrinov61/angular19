import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueueAddMock = (name: string, data: unknown, opts?: unknown) => Promise<void>;
interface QueryOneMockRow {
  id: string;
  sender_type?: string;
  ai_agent_mode?: string | null;
}
type QueryOneMock = (sql: string, params?: unknown[]) => Promise<QueryOneMockRow | null>;
type QueryMock = (sql: string, params?: unknown[]) => Promise<unknown[]>;

const {
  mockGetAccountByChannel,
  mockGetAccountById,
  mockQueueAdd,
  mockQuery,
  mockQueryOne,
  mockWorkerClose,
  mockIsBotPaused,
  mockGetBotPauseMs,
  mockPauseBot,
  mockSendText,
  mockSendMedia,
  mockSendWithInlineButton,
  mockGetAdapterOrThrow,
  mockWithCircuitBreaker,
} = vi.hoisted(() => {
  const sendText = vi.fn();
  const sendMedia = vi.fn();
  const sendWithInlineButton = vi.fn();
  return {
    mockGetAccountByChannel: vi.fn().mockResolvedValue({ id: 'account-1' }),
    mockGetAccountById: vi.fn().mockResolvedValue({ id: 'account-1' }),
    mockQueueAdd: vi.fn<QueueAddMock>().mockResolvedValue(undefined),
    mockQuery: vi.fn<QueryMock>().mockResolvedValue([]),
    mockQueryOne: vi.fn<QueryOneMock>().mockResolvedValue({ id: 'queue-1' }),
    mockWorkerClose: vi.fn().mockResolvedValue(undefined),
    mockIsBotPaused: vi.fn().mockResolvedValue(false),
    mockGetBotPauseMs: vi.fn().mockResolvedValue(0),
    mockPauseBot: vi.fn().mockResolvedValue(undefined),
    mockSendText: sendText,
    mockSendMedia: sendMedia,
    mockSendWithInlineButton: sendWithInlineButton,
    mockGetAdapterOrThrow: vi.fn(() => ({
      sendText,
      sendMedia,
      sendWithInlineButton,
    })),
    // Default: run the wrapped send fn (so a non-paused path would actually call adapter).
    mockWithCircuitBreaker: vi.fn(
      (_channel: unknown, _accountId: unknown, fn: () => unknown) => fn(),
    ),
  };
});

vi.mock('bullmq', () => {
  function MockQueue() {
    return { add: mockQueueAdd };
  }

  function MockWorker() {
    return { on: vi.fn(), close: mockWorkerClose };
  }

  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('../../../database/db.js', () => ({
  default: {
    query: mockQuery,
    queryOne: mockQueryOne,
  },
}));

vi.mock('../../../config/index.js', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: '', tls: undefined },
    whatsapp: { mediaDeliveryUrl: '' },
  },
}));

vi.mock('../core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
  getAccountById: mockGetAccountById,
}));

vi.mock('../core/adapter-registry.js', () => ({
  getAdapterOrThrow: mockGetAdapterOrThrow,
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: mockWithCircuitBreaker,
}));

vi.mock('../../broadcast/broadcast-governor.js', () => ({
  isBotPaused: mockIsBotPaused,
  getBotPauseMs: mockGetBotPauseMs,
  pauseBot: mockPauseBot,
}));

vi.mock('./broadcast.js', () => ({
  broadcastStatusUpdate: vi.fn(),
}));

vi.mock('../../channel-metrics.service.js', () => ({
  recordFailed: vi.fn(),
  recordSent: vi.fn(),
}));

vi.mock('../../alerting.service.js', () => ({
  alertDeadLetterThreshold: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../../middleware/request-context.js', () => ({
  getRequestId: vi.fn(() => 'request-1'),
  runWithRequestId: vi.fn((_requestId: string | undefined, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../storage.service.js', () => ({
  storageService: {
    isS3Url: vi.fn(() => false),
    keyFromUrl: vi.fn(() => null),
    resolveExternalDeliveryUrl: vi.fn(),
  },
}));

import { enqueueOutbound, processOutbound } from './outbound-worker.js';

function insertedMaxAttempts(): unknown {
  const insertParams = mockQueryOne.mock.calls[0]?.[1];
  return Array.isArray(insertParams) ? insertParams[9] : undefined;
}

describe('enqueueOutbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccountByChannel.mockResolvedValue({ id: 'account-1' });
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue({ id: 'queue-1' });
  });

  it('caps payment link retries to one attempt', async () => {
    await enqueueOutbound({
      channel: 'telegram',
      externalChatId: 'telegram-chat-1',
      content: [
        'Amount due: 5880 RUB',
        'Payment link: https://svoefoto.ru/pay/SF-123',
      ].join('\n'),
      maxAttempts: 5,
    });

    expect(insertedMaxAttempts()).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledWith('send', { queueItemId: 'queue-1', _requestId: 'request-1' }, {
      attempts: 1,
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  });

  it('keeps requested retries for ordinary outbound messages', async () => {
    await enqueueOutbound({
      channel: 'telegram',
      externalChatId: 'telegram-chat-1',
      content: 'Hello, your order is ready.',
      maxAttempts: 3,
    });

    expect(insertedMaxAttempts()).toBe(3);
  });

  // C2: ON CONFLICT (dedup_key) DO NOTHING returns no row → enqueueOutbound is a no-op.
  it('dedup_key conflict (no row from ON CONFLICT) → returns empty string, BullMQ add NOT called', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await enqueueOutbound({
      channel: 'telegram',
      externalChatId: 'telegram-chat-1',
      content: 'AI agent reply',
      dedupKey: 'ai:run-42',
    });

    expect(result).toBe('');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('no dedup_key conflict → enqueues normally and schedules BullMQ job', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'queue-7' });

    const result = await enqueueOutbound({
      channel: 'telegram',
      externalChatId: 'telegram-chat-1',
      content: 'AI agent reply',
      dedupKey: 'ai:run-43',
    });

    expect(result).toBe('queue-7');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send',
      { queueItemId: 'queue-7', _requestId: 'request-1' },
      expect.objectContaining({ attempts: 1 }),
    );
  });
});

// A minimal outbound_queue row shape for the gate test (named, no inline casts).
interface TestOutboundRow {
  id: string;
  channel: string;
  account_id: string | null;
  external_chat_id: string;
  content: string;
  message_type: string;
  attachment_url: string | null;
  source_message_id: string | null;
  conversation_id: string | null;
  reply_to_external_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  external_response: null;
}

type ProcessOutboundJob = Parameters<typeof processOutbound>[0];

describe('processOutbound — Telegram governor pre-send gate', () => {
  const BOT_TOKEN = '8038532455:AA-fake-test-token';

  const telegramItem: TestOutboundRow = {
    id: 'queue-tg-1',
    channel: 'telegram',
    account_id: 'account-1',
    external_chat_id: '1020685867',
    content: 'Hello from support',
    message_type: 'text',
    attachment_url: null,
    source_message_id: null,
    conversation_id: null,
    reply_to_external_id: null,
    status: 'processing',
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    external_response: null,
  };

  // processOutbound only reads job.data; a minimal job suffices.
  const job = { data: { queueItemId: 'queue-tg-1' } } as ProcessOutboundJob;

  beforeEach(() => {
    vi.clearAllMocks();
    // Account carries the bot token in credentials (governor pause key source).
    mockGetAccountById.mockResolvedValue({ id: 'account-1', credentials: { botToken: BOT_TOKEN } });
    mockGetAccountByChannel.mockResolvedValue({ id: 'account-1', credentials: { botToken: BOT_TOKEN } });
    // Re-establish default adapter + circuit-breaker behavior after clearAllMocks.
    mockGetAdapterOrThrow.mockReturnValue({
      sendText: mockSendText,
      sendMedia: mockSendMedia,
      sendWithInlineButton: mockSendWithInlineButton,
    });
    mockWithCircuitBreaker.mockImplementation(
      (_channel: unknown, _accountId: unknown, fn: () => unknown) => fn(),
    );
    // First queryOne (the FOR UPDATE lock) returns our telegram row.
    mockQueryOne.mockResolvedValue(telegramItem);
    mockQuery.mockResolvedValue([]);
  });

  it('CENTRAL GUARANTEE: when bot is paused, does NOT send and re-queues without consuming an attempt', async () => {
    mockIsBotPaused.mockResolvedValue(true);
    mockGetBotPauseMs.mockResolvedValue(7000);

    await processOutbound(job);

    // 1) Governor consulted with the bot token.
    expect(mockIsBotPaused).toHaveBeenCalledWith(BOT_TOKEN);

    // 2) NO send happened — neither circuit breaker nor any adapter method.
    expect(mockWithCircuitBreaker).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockSendMedia).not.toHaveBeenCalled();
    expect(mockSendWithInlineButton).not.toHaveBeenCalled();

    // 3) Row re-queued: an UPDATE set next_retry_at WITHOUT touching attempts.
    const requeueCall = mockQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('next_retry_at') && sql.includes('UPDATE outbound_queue'),
    );
    expect(requeueCall).toBeDefined();
    const requeueSql = requeueCall![0] as string;
    expect(requeueSql).not.toContain('attempts =');
    const requeueParams = requeueCall![1] as unknown[];
    expect(requeueParams[0]).toBe('queue-tg-1');
    // next_retry_at param is an ISO timestamp ~ now + pauseMs.
    expect(typeof requeueParams[1]).toBe('string');

    // 4) Re-enqueued into BullMQ with delay (retry scanner / delayed job).
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send',
      { queueItemId: 'queue-tg-1' },
      expect.objectContaining({ delay: 7000, attempts: 1 }),
    );
  });

  it('when bot is NOT paused, proceeds to send (gate is transparent)', async () => {
    mockIsBotPaused.mockResolvedValue(false);
    mockSendText.mockResolvedValue({ success: true, externalMessageId: 'tg:42' });

    await processOutbound(job);

    expect(mockIsBotPaused).toHaveBeenCalledWith(BOT_TOKEN);
    // The send path was taken — circuit breaker invoked.
    expect(mockWithCircuitBreaker).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalled();
  });
});

// C1: the AI-agent suppress gate (2c). A bot-authored row that has been racing
// against an operator takeover must NOT reach the client. We use channel='max' so
// the Telegram governor gate and the 24h-window gate are both skipped, isolating 2c.
describe('processOutbound — AI-agent suppress gate (second gate)', () => {
  // A bot reply already queued; carries the message + conversation references.
  const botRow: TestOutboundRow = {
    id: 'queue-bot-1',
    channel: 'max',
    account_id: 'account-1',
    external_chat_id: '555',
    content: 'AI agent reply text',
    message_type: 'text',
    attachment_url: null,
    source_message_id: 'msg-bot-1',
    conversation_id: 'conv-1',
    reply_to_external_id: null,
    status: 'processing',
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    external_response: null,
  };

  const job = { data: { queueItemId: 'queue-bot-1' } } as ProcessOutboundJob;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccountById.mockResolvedValue({ id: 'account-1', credentials: {} });
    mockGetAccountByChannel.mockResolvedValue({ id: 'account-1', credentials: {} });
    mockGetAdapterOrThrow.mockReturnValue({
      sendText: mockSendText,
      sendMedia: mockSendMedia,
      sendWithInlineButton: mockSendWithInlineButton,
    });
    mockWithCircuitBreaker.mockImplementation(
      (_channel: unknown, _accountId: unknown, fn: () => unknown) => fn(),
    );
    mockSendText.mockResolvedValue({ success: true, externalMessageId: 'max:1' });
    mockQuery.mockResolvedValue([]);
  });

  // queryOne call order inside processOutboundInner for channel='max':
  //   1) FOR UPDATE lock → outbound row
  //   2) SELECT sender_type FROM messages
  //   3) SELECT ai_agent_mode FROM conversations
  function primeQueryOne(senderType: string, aiAgentMode: string | null): void {
    mockQueryOne.mockReset();
    mockQueryOne
      .mockResolvedValueOnce(botRow) // lock
      .mockResolvedValueOnce({ id: 'x', sender_type: senderType })
      .mockResolvedValueOnce({ id: 'x', ai_agent_mode: aiAgentMode });
  }

  function suppressUpdateCall(): unknown[] | undefined {
    return mockQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string'
      && sql.includes('UPDATE outbound_queue')
      && sql.includes("status = 'cancelled'"),
    );
  }

  it('bot message + ai_agent_mode=operator → cancelled, adapter NOT called', async () => {
    primeQueryOne('bot', 'operator');

    await processOutbound(job);

    expect(suppressUpdateCall()).toBeDefined();
    expect(mockWithCircuitBreaker).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  // The "Взять" (take over) button sets mode='off', NOT 'operator' — must still suppress.
  it("bot message + ai_agent_mode=off (operator pressed «Взять») → cancelled, adapter NOT called", async () => {
    primeQueryOne('bot', 'off');

    await processOutbound(job);

    expect(suppressUpdateCall()).toBeDefined();
    expect(mockWithCircuitBreaker).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('bot message + ai_agent_mode=bot (not taken over) → message is sent', async () => {
    primeQueryOne('bot', 'bot');

    await processOutbound(job);

    expect(suppressUpdateCall()).toBeUndefined();
    expect(mockWithCircuitBreaker).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalled();
  });

  it('non-bot message (sender_type=operator) → gate transparent, message is sent', async () => {
    // Only the lock + messages SELECT happen; conversations SELECT is skipped (short-circuit).
    mockQueryOne.mockReset();
    mockQueryOne
      .mockResolvedValueOnce(botRow)
      .mockResolvedValueOnce({ id: 'x', sender_type: 'operator' });

    await processOutbound(job);

    expect(suppressUpdateCall()).toBeUndefined();
    expect(mockWithCircuitBreaker).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalled();
  });
});
