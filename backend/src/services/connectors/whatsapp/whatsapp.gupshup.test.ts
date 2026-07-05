import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (url: string, opts?: RequestInit) => mockFetch(url, opts),
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: (_channel: string, _accountId: string, fn: () => unknown) => fn(),
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

interface GupshupMessage {
  type?: unknown;
  url?: unknown;
  filename?: unknown;
}

interface FetchCall {
  url: string;
  opts?: RequestInit;
}

function isGupshupMessage(value: unknown): value is GupshupMessage {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeGupshupAccount(adapter: WhatsAppAdapter): ChannelAccount {
  return {
    id: 'wa-gs-1',
    channel: 'whatsapp',
    name: 'Gupshup WhatsApp',
    isActive: true,
    credentials: {
      provider: 'gupshup',
      apiKey: 'gupshup-key',
      appName: 'TestApp',
      sourcePhone: '79999999999',
      phoneNumberId: '',
      accessToken: '',
    },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: adapter.getCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSubmittedResponse(messageId: string): Response {
  return new Response(JSON.stringify({ status: 'submitted', messageId }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getOnlyFetchCall(): FetchCall {
  expect(mockFetch).toHaveBeenCalledOnce();
  const call = mockFetch.mock.calls[0];
  if (!call) throw new Error('fetch call is missing');
  const [url, opts] = call;
  return { url, opts };
}

function getBodyParams(opts: RequestInit | undefined): URLSearchParams {
  if (typeof opts?.body !== 'string') throw new Error('expected form body');
  return new URLSearchParams(opts.body);
}

function getRequestHeader(opts: RequestInit | undefined, name: string): string | null {
  const headers = opts?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const normalizedName = name.toLowerCase();
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === normalizedName);
    return match?.[1] ?? null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value;
  }
  return null;
}

function parseGupshupMessage(params: URLSearchParams): GupshupMessage {
  const rawMessage = params.get('message');
  if (!rawMessage) throw new Error('message param is missing');
  const parsed: unknown = JSON.parse(rawMessage);
  if (!isGupshupMessage(parsed)) throw new Error('message param is not an object');
  return parsed;
}

describe('WhatsAppAdapter Gupshup media', () => {
  let adapter: WhatsAppAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    adapter = new WhatsAppAdapter();
    account = makeGupshupAccount(adapter);
    vi.clearAllMocks();
  });

  it('sends files with an ASCII-safe filename', async () => {
    mockFetch.mockResolvedValueOnce(makeSubmittedResponse('gs-file-1'));

    const mediaUrl = 'https://svoefoto.ru/media/chat/file.pdf?wa_delivery=queue-id';
    const result = await adapter.sendMedia(
      account,
      '89014178668',
      mediaUrl,
      'file',
      undefined,
      'загран.pdf',
    );

    expect(result).toEqual({ success: true, externalMessageId: 'gs-file-1' });

    const { url, opts } = getOnlyFetchCall();
    expect(url).toBe('https://api.gupshup.io/wa/api/v1/msg');

    const params = getBodyParams(opts);
    expect(params.get('destination')).toBe('79014178668');
    expect(params.get('src.name')).toBe('TestApp');

    const message = parseGupshupMessage(params);
    expect(message).toEqual({
      type: 'file',
      url: mediaUrl,
      filename: 'attachment.pdf',
    });
  });
});

describe('WhatsAppAdapter Gupshup credentials', () => {
  let adapter: WhatsAppAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    adapter = new WhatsAppAdapter();
    account = makeGupshupAccount(adapter);
    vi.clearAllMocks();
  });

  it('verifies credentials against the Gupshup send endpoint without sending a message', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'error',
      message: 'Invalid Destination',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await adapter.verifyCredentials(account);

    expect(result).toEqual({ ok: true });

    const { url, opts } = getOnlyFetchCall();
    expect(url).toBe('https://api.gupshup.io/wa/api/v1/msg');
    expect(opts?.method).toBe('POST');
    expect(getRequestHeader(opts, 'apikey')).toBe('gupshup-key');
    expect(getRequestHeader(opts, 'content-type')).toBe('application/x-www-form-urlencoded');

    const params = getBodyParams(opts);
    expect(params.get('channel')).toBe('whatsapp');
    expect(params.get('source')).toBe('79999999999');
    expect(params.get('src.name')).toBe('TestApp');
    expect(params.has('destination')).toBe(false);
    expect(params.has('message')).toBe(false);
  });

  it('rejects Gupshup credentials when the send endpoint reports an auth failure', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'error',
      message: 'Authentication Failed',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await adapter.verifyCredentials(account);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 401');
    expect(result.error).toContain('Authentication Failed');
  });
});
