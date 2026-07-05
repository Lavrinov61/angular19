import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dispatchers: Array<{ proxyUrl: string }> = [];
  return {
    dispatchers,
    undiciFetch: vi.fn(() => Promise.resolve(new Response('ok'))),
    ProxyAgent: vi.fn(function proxyAgentMock(this: { proxyUrl: string }, proxyUrl: string) {
      this.proxyUrl = proxyUrl;
      dispatchers.push(this);
    }),
  };
});

vi.mock('undici', () => ({
  fetch: mocks.undiciFetch,
  ProxyAgent: mocks.ProxyAgent,
}));

vi.mock('../middleware/request-context.js', () => ({
  getRequestId: () => undefined,
}));

describe('fetchWithTimeout proxy routing', () => {
  const originalHttpProxy = process.env['HTTP_PROXY'];
  const originalHttpsProxy = process.env['HTTPS_PROXY'];
  const originalLowerHttpProxy = process.env['http_proxy'];
  const originalLowerHttpsProxy = process.env['https_proxy'];
  const originalFetch = globalThis.fetch;
  const proxyUrl = 'http://127.0.0.1:8118';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.dispatchers.length = 0;
    process.env['HTTP_PROXY'] = proxyUrl;
    delete process.env['HTTPS_PROXY'];
    delete process.env['http_proxy'];
    delete process.env['https_proxy'];
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('direct')));
  });

  afterEach(() => {
    if (originalHttpProxy === undefined) delete process.env['HTTP_PROXY'];
    else process.env['HTTP_PROXY'] = originalHttpProxy;
    if (originalHttpsProxy === undefined) delete process.env['HTTPS_PROXY'];
    else process.env['HTTPS_PROXY'] = originalHttpsProxy;
    if (originalLowerHttpProxy === undefined) delete process.env['http_proxy'];
    else process.env['http_proxy'] = originalLowerHttpProxy;
    if (originalLowerHttpsProxy === undefined) delete process.env['https_proxy'];
    else process.env['https_proxy'] = originalLowerHttpsProxy;
    globalThis.fetch = originalFetch;
  });

  it('routes Gupshup API requests through the configured proxy', async () => {
    const { fetchWithTimeout } = await import('./fetch-timeout.js');

    await fetchWithTimeout('https://api.gupshup.io/wa/api/v1/msg');

    expect(mocks.ProxyAgent).toHaveBeenCalledWith(proxyUrl);
    expect(mocks.undiciFetch).toHaveBeenCalledWith(
      'https://api.gupshup.io/wa/api/v1/msg',
      expect.objectContaining({ dispatcher: mocks.dispatchers[0] }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
