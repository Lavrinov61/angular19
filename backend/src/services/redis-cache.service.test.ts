import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisFactoryMock = vi.hoisted(() => {
  type Handler = () => void;

  class MockRedisClient {
    status = 'wait';
    readonly setCalls: Array<readonly [string, string, string, number]> = [];
    readonly getCalls: string[] = [];
    private readonly handlers = new Map<string, Handler[]>();
    private readonly values = new Map<string, string>();

    once(event: string, handler: Handler): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    off(event: string, handler: Handler): this {
      const handlers = this.handlers.get(event) ?? [];
      this.handlers.set(event, handlers.filter(candidate => candidate !== handler));
      return this;
    }

    emitReady(): void {
      this.status = 'ready';
      const handlers = this.handlers.get('ready') ?? [];
      this.handlers.set('ready', []);
      for (const handler of handlers) handler();
    }

    async set(key: string, value: string, mode: string, ttl: number): Promise<'OK'> {
      this.setCalls.push([key, value, mode, ttl]);
      this.values.set(key, value);
      return 'OK';
    }

    async get(key: string): Promise<string | null> {
      this.getCalls.push(key);
      return this.values.get(key) ?? null;
    }

    async del(key: string): Promise<number> {
      return this.values.delete(key) ? 1 : 0;
    }
  }

  return {
    MockRedisClient,
    currentClient: null as MockRedisClient | null,
  };
});

vi.mock('./redis-factory.js', () => ({
  createLazyRedis: vi.fn(() => () => redisFactoryMock.currentClient),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

const { cacheGet, cacheSet } = await import('./redis-cache.service.js');

describe('redis-cache.service', () => {
  beforeEach(() => {
    redisFactoryMock.currentClient = new redisFactoryMock.MockRedisClient();
    vi.clearAllMocks();
  });

  it('waits until the lazy Redis client is ready before cache writes and reads', async () => {
    const setPromise = cacheSet('pos:telemetry:test', { ready: true }, 90);

    await Promise.resolve();
    expect(redisFactoryMock.currentClient?.setCalls).toHaveLength(0);

    redisFactoryMock.currentClient?.emitReady();
    await setPromise;

    expect(redisFactoryMock.currentClient?.setCalls).toEqual([
      ['pos:telemetry:test', JSON.stringify({ ready: true }), 'EX', 90],
    ]);

    await expect(cacheGet('pos:telemetry:test')).resolves.toEqual({ ready: true });
  });
});
