import { describe, expect, it } from 'vitest';
import { readResponseBufferWithTimeout } from './stream-utils.js';

describe('readResponseBufferWithTimeout', () => {
  it('reads a complete response body', async () => {
    const response = new Response('ok');

    const buffer = await readResponseBufferWithTimeout(response, {
      idleTimeoutMs: 100,
      totalTimeoutMs: 500,
      label: 'test media download',
    });

    expect(buffer.toString('utf8')).toBe('ok');
  });

  it('rejects when response body stalls', async () => {
    const stalledBody = new ReadableStream<Uint8Array>();
    const response = new Response(stalledBody);

    await expect(readResponseBufferWithTimeout(response, {
      idleTimeoutMs: 25,
      totalTimeoutMs: 500,
      label: 'test stalled download',
    })).rejects.toThrow('test stalled download idle timeout');
  });
});
