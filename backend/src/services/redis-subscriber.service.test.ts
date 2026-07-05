import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class MockRedis {
    static instances: MockRedis[] = [];

    readonly psubscribeCalls: string[] = [];
    private readonly handlers = new Map<string, Handler[]>();

    constructor(_options: unknown) {
      MockRedis.instances.push(this);
    }

    on(event: string, handler: Handler): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    async connect(): Promise<void> {
      this.emit('ready');
    }

    async psubscribe(pattern: string): Promise<number> {
      this.psubscribeCalls.push(pattern);
      return this.psubscribeCalls.length;
    }

    async punsubscribe(_pattern: string): Promise<number> {
      return 1;
    }

    async quit(): Promise<'OK'> {
      return 'OK';
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  return { MockRedis };
});

vi.mock('ioredis', () => ({
  default: redisMock.MockRedis,
}));

vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: '',
      tls: null,
    },
  },
}));

vi.mock('../database/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('./ai-chat.service.js', () => ({
  markOperatorActive: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./visitor-push.service.js', () => ({
  sendVisitorChatPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./task-auto.service.js', () => ({
  createTaskFromOrder: vi.fn().mockResolvedValue(null),
  createTaskFromChat: vi.fn().mockResolvedValue(null),
}));

vi.mock('../routes/chat/chat-pricing.helpers.js', () => ({
  buildWidgetPaymentButton: vi.fn().mockReturnValue(null),
}));

vi.mock('./chat-broadcast.service.js', () => ({
  broadcastChatMessage: vi.fn(),
}));

vi.mock('../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: vi.fn(),
}));

vi.mock('./pos-fiscal-shift.service.js', () => ({
  cachePosTelemetrySnapshot: vi.fn().mockResolvedValue(undefined),
}));

const mockFinalizeShiftReconciliation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./pos-reconciliation.service.js', () => ({
  finalizeShiftReconciliation: mockFinalizeShiftReconciliation,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

const { RedisSubscriberService } = await import('./redis-subscriber.service.js');

describe('RedisSubscriberService', () => {
  beforeEach(() => {
    redisMock.MockRedis.instances.length = 0;
    vi.clearAllMocks();
  });

  it('subscribes to POS and infra relay patterns on the initial Redis ready event', async () => {
    const service = new RedisSubscriberService();

    await service.connect();

    const redis = redisMock.MockRedis.instances[0];
    await vi.waitFor(() => {
      expect(redis?.psubscribeCalls).toEqual([
        'website_chat:*',
        'print:*',
        'pos:*',
        'infra:*',
      ]);
    });
  });

  it('pos:transaction_update with transaction_id triggers shift reconciliation finalize', async () => {
    const service = new RedisSubscriberService();
    await service.connect();
    const redis = redisMock.MockRedis.instances[0];

    redis?.emit(
      'pmessage',
      'pos:*',
      'pos:transaction_update',
      JSON.stringify({
        transaction_id: 'settlement-tx-1',
        status: 'completed',
        bank_report: 'ОПЕРАЦИИ ПО КАРТАМ:68\'360.50 RUB',
        studio_id: 'studio-1',
      }),
    );

    await vi.waitFor(() => {
      expect(mockFinalizeShiftReconciliation).toHaveBeenCalledWith(
        'settlement-tx-1',
        "ОПЕРАЦИИ ПО КАРТАМ:68'360.50 RUB",
        'completed',
      );
    });
  });

  it('pos:transaction_update without transaction_id does not call finalize', async () => {
    const service = new RedisSubscriberService();
    await service.connect();
    const redis = redisMock.MockRedis.instances[0];

    redis?.emit(
      'pmessage',
      'pos:*',
      'pos:transaction_update',
      JSON.stringify({ success: true, studio_id: 'studio-1', receipt_id: 'r-1' }),
    );

    // Дать микротаскам отработать.
    await Promise.resolve();
    expect(mockFinalizeShiftReconciliation).not.toHaveBeenCalled();
  });
});
