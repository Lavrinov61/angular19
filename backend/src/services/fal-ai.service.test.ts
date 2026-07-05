import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    fal: {
      apiKey: 'test-key',
      enabled: true,
      pollIntervalMs: 1,
      timeoutMs: 1000,
    },
  },
}));

vi.mock('../utils/circuit-breaker.js', () => ({
  SERVICE_BREAKERS: { falAi: 'falAi' },
  withServiceCall: vi.fn((_breaker: unknown, callback: () => Promise<unknown>) => callback()),
}));

const { falAIService } = await import('./fal-ai.service.js');

describe('falAIService retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries transient fetch failures when submitting a job', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        request_id: 'request-1',
        status_url: 'https://queue.fal.run/status/request-1',
        response_url: 'https://queue.fal.run/result/request-1',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = falAIService.submit('fal-ai/test-model', { prompt: 'edit portrait' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(350);

    await expect(pending).resolves.toEqual({
      request_id: 'request-1',
      status_url: 'https://queue.fal.run/status/request-1',
      response_url: 'https://queue.fal.run/result/request-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports queue status updates while waiting for a fal.ai result', async () => {
    const statusUpdates: Array<{ status: string; logs?: unknown[] }> = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'IN_QUEUE',
        logs: [{ message: 'queued', timestamp: '2026-07-04T16:00:00.000Z' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'IN_PROGRESS',
        logs: [{ message: 'processing', timestamp: '2026-07-04T16:00:01.000Z' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'COMPLETED',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        images: [{ url: 'https://fal.media/result.png' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = falAIService.waitForResult('https://queue.fal.run/status/request-1', 'https://queue.fal.run/result/request-1', {
      onStatus: status => statusUpdates.push(status),
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({
      images: [{ url: 'https://fal.media/result.png' }],
    });
    expect(statusUpdates).toMatchObject([
      { status: 'IN_QUEUE', logs: [{ message: 'queued' }] },
      { status: 'IN_PROGRESS', logs: [{ message: 'processing' }] },
      { status: 'COMPLETED' },
    ]);
  });
});
