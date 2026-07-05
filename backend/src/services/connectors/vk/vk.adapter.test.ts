/**
 * VK Adapter Unit Tests
 *
 * Tests for:
 * 1. pickLargestVkPhotoSize — correct photo resolution selection
 * 2. parseInbound — photo attachment picks best size via pickLargestVkPhotoSize
 * 3. sendTypingIndicator — correct VK API call format
 * 4. getCapabilities — typingIndicator = true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VkAdapter, pickLargestVkPhotoSize } from './vk.adapter.js';
import type { ChannelAccount } from '../core/types.js';

// Mock fetchWithTimeout
vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

// Mock db
vi.mock('../../../database/db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock vk.user-cache
vi.mock('./vk.user-cache.js', () => ({
  resolveVkUserName: vi.fn().mockResolvedValue('Иван Петров'),
}));

// Mock circuit-breaker
vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: vi.fn((_ch: string, _acc: string | undefined, fn: () => Promise<unknown>) => fn()),
}));

// Mock logger
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeVkAccount(overrides?: Partial<Record<string, unknown>>): ChannelAccount {
  return {
    id: 'vk-acc-1',
    channel: 'vk',
    name: 'Test VK',
    isActive: true,
    credentials: {
      groupToken: 'test-group-token',
      groupId: '12345',
      confirmationCode: 'abc123',
      secretKey: 'secret',
      ...overrides,
    },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: new VkAdapter().getCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// --- pickLargestVkPhotoSize ---

describe('pickLargestVkPhotoSize', () => {
  it('picks type "w" (2560px) when available, even if not last', () => {
    const sizes = [
      { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },
      { type: 'w', url: 'https://vk.com/w.jpg', width: 2560, height: 1920 },
      { type: 'm', url: 'https://vk.com/m.jpg', width: 130, height: 97 },
      { type: 'x', url: 'https://vk.com/x.jpg', width: 604, height: 453 },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result).toBeDefined();
    expect(result!['type']).toBe('w');
    expect(result!['url']).toBe('https://vk.com/w.jpg');
  });

  it('picks type "z" (1080px) when "w" is absent', () => {
    const sizes = [
      { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },
      { type: 'z', url: 'https://vk.com/z.jpg', width: 1080, height: 810 },
      { type: 'x', url: 'https://vk.com/x.jpg', width: 604, height: 453 },
      { type: 'm', url: 'https://vk.com/m.jpg', width: 130, height: 97 },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['type']).toBe('z');
  });

  it('picks type "y" when "w" and "z" are absent', () => {
    const sizes = [
      { type: 'x', url: 'https://vk.com/x.jpg', width: 604, height: 453 },
      { type: 'y', url: 'https://vk.com/y.jpg', width: 807, height: 605 },
      { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['type']).toBe('y');
  });

  it('returns single element when only one size exists', () => {
    const sizes = [
      { type: 'm', url: 'https://vk.com/m.jpg', width: 130, height: 97 },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['type']).toBe('m');
    expect(result!['url']).toBe('https://vk.com/m.jpg');
  });

  it('falls back to largest area when no known type matches', () => {
    const sizes = [
      { type: 'custom_small', url: 'https://vk.com/small.jpg', width: 100, height: 100 },
      { type: 'custom_large', url: 'https://vk.com/large.jpg', width: 1200, height: 900 },
      { type: 'custom_mid', url: 'https://vk.com/mid.jpg', width: 400, height: 300 },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['url']).toBe('https://vk.com/large.jpg');
  });

  it('falls back to first element when no type and no width/height', () => {
    const sizes = [
      { type: 'unknown_a', url: 'https://vk.com/a.jpg' },
      { type: 'unknown_b', url: 'https://vk.com/b.jpg' },
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['url']).toBe('https://vk.com/a.jpg');
  });

  it('returns undefined for empty array', () => {
    const result = pickLargestVkPhotoSize([]);
    expect(result).toBeUndefined();
  });

  it('handles VK shuffled order — regression for sizes[sizes.length-1] bug', () => {
    // This is the exact scenario that caused the bug: thumbnail was last in the array
    const sizes = [
      { type: 'z', url: 'https://vk.com/z.jpg', width: 1080, height: 810 },
      { type: 'y', url: 'https://vk.com/y.jpg', width: 807, height: 605 },
      { type: 'x', url: 'https://vk.com/x.jpg', width: 604, height: 453 },
      { type: 'w', url: 'https://vk.com/w.jpg', width: 2560, height: 1920 },
      { type: 'm', url: 'https://vk.com/m.jpg', width: 130, height: 97 },
      { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },  // <-- was picked by old code
    ];
    const result = pickLargestVkPhotoSize(sizes);
    expect(result!['type']).toBe('w');
    expect(result!['url']).not.toBe('https://vk.com/s.jpg');
  });
});

// --- parseInbound photo integration ---

describe('VkAdapter.parseInbound — photo size selection', () => {
  const adapter = new VkAdapter();

  it('picks largest photo size in parsed message media URL', async () => {
    const body = {
      type: 'message_new',
      object: {
        message: {
          id: 1001,
          from_id: 12345,
          text: '',
          attachments: [{
            type: 'photo',
            photo: {
              sizes: [
                { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },
                { type: 'w', url: 'https://vk.com/w.jpg', width: 2560, height: 1920 },
                { type: 'm', url: 'https://vk.com/m.jpg', width: 130, height: 97 },
              ],
            },
          }],
        },
      },
    };

    const messages = await adapter.parseInbound(body as Record<string, unknown>);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageType).toBe('image');
    expect(messages[0].media).toBeDefined();
    expect(messages[0].media![0].sourceRef).toBe('https://vk.com/w.jpg');
  });

  it('picks "z" when "w" is not in sizes', async () => {
    const body = {
      type: 'message_new',
      object: {
        message: {
          id: 1002,
          from_id: 12345,
          text: 'фото',
          attachments: [{
            type: 'photo',
            photo: {
              sizes: [
                { type: 'x', url: 'https://vk.com/x.jpg', width: 604, height: 453 },
                { type: 's', url: 'https://vk.com/s.jpg', width: 75, height: 56 },
                { type: 'z', url: 'https://vk.com/z.jpg', width: 1080, height: 810 },
              ],
            },
          }],
        },
      },
    };

    const messages = await adapter.parseInbound(body as Record<string, unknown>);
    expect(messages[0].media![0].sourceRef).toBe('https://vk.com/z.jpg');
  });
});

// --- sendTypingIndicator ---

describe('VkAdapter.sendTypingIndicator', () => {
  let adapter: VkAdapter;

  beforeEach(() => {
    adapter = new VkAdapter();
    vi.clearAllMocks();
  });

  it('calls VK messages.setActivity with correct params', async () => {
    const { fetchWithTimeout } = await import('../../../utils/fetch-timeout.js');
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ response: 1 }), { status: 200 }));

    const account = makeVkAccount();
    await adapter.sendTypingIndicator(account, '67890');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('messages.setActivity');
    expect(url).toContain('type=typing');
    expect(url).toContain('peer_id=67890');
    expect(url).toContain('access_token=test-group-token');
    expect(url).toContain(`v=5.199`);
    expect(options).toEqual({ method: 'POST' });
  });

  it('does not throw on API failure', async () => {
    const { fetchWithTimeout } = await import('../../../utils/fetch-timeout.js');
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const account = makeVkAccount();
    // Should not throw
    await expect(adapter.sendTypingIndicator(account, '67890')).resolves.toBeUndefined();
  });

  it('skips call when groupToken is empty', async () => {
    const { fetchWithTimeout } = await import('../../../utils/fetch-timeout.js');
    const mockFetch = vi.mocked(fetchWithTimeout);

    const account = makeVkAccount({ groupToken: '' });
    await adapter.sendTypingIndicator(account, '67890');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips call when chatId is not a number', async () => {
    const { fetchWithTimeout } = await import('../../../utils/fetch-timeout.js');
    const mockFetch = vi.mocked(fetchWithTimeout);

    const account = makeVkAccount();
    await adapter.sendTypingIndicator(account, 'not-a-number');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// --- getCapabilities ---

describe('VkAdapter.getCapabilities', () => {
  it('has typingIndicator enabled', () => {
    const adapter = new VkAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.typingIndicator).toBe(true);
  });

  it('has expected VK capabilities', () => {
    const adapter = new VkAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.markAsRead).toBe(true);
    expect(caps.sendPhoto).toBe(true);
    expect(caps.sendFile).toBe(true);
    expect(caps.sendInlineButton).toBe(true);
    expect(caps.twoStepUpload).toBe(true);
    expect(caps.confirmationHandshake).toBe(true);
    expect(caps.replyWindow24h).toBe(false);
    expect(caps.challengeResponse).toBe(false);
    expect(caps.maxTextLength).toBe(4096);
  });
});
