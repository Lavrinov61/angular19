/**
 * Omnichannel v2 — Core Module Unit Tests
 *
 * Tests for types, DTOs, adapter-registry, circuit-breaker, and media-processor.
 * DB-dependent modules (account-store, media-service) tested with integration tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/image-convert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/image-convert.js')>();
  return {
    ...actual,
    convertImageBufferToJpeg: vi.fn(async (
      _buffer: Buffer,
      _mime?: string | null,
      urlOrFilename?: string,
    ) => {
      if (urlOrFilename === 'broken.HEIC') {
        throw new Error('converter failed');
      }
      return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    }),
  };
});

import type { ChannelType, MessageType, DeliveryStatus, SenderType, ChannelCapabilities, ChannelAccount } from './types.js';
import { ALL_CHANNELS, MESSENGER_CHANNELS } from './types.js';

import type { ParsedMessage, ParsedMediaRef, StatusUpdate, SendResult, RawRequest, WebhookVerifyResult } from './dto.js';

import type { ChannelAdapter } from './adapter.interface.js';

import {
  registerAdapter,
  getAdapter,
  getAdapterOrThrow,
  getAllAdapters,
  getRegisteredChannels,
  hasAdapter,
  unregisterAdapter,
  clearAdapters,
} from './adapter-registry.js';

import {
  CircuitBreaker,
  getBreaker,
  withCircuitBreaker,
} from './circuit-breaker.js';

import { processMediaBuffer } from './media-processor.js';
import { canConvertToJpeg, needsJpegConversion, replaceExtForJpeg, shouldConvertToJpeg } from '../../../utils/image-convert.js';

// --- Fixtures ---

function makeCapabilities(overrides?: Partial<ChannelCapabilities>): ChannelCapabilities {
  return {
    markAsRead: false,
    sendPhoto: true,
    sendFile: true,
    sendVideo: false,
    sendAudio: false,
    sendInlineButton: false,
    replyWindow24h: false,
    forwardDetection: false,
    replyToDetection: false,
    statusUpdates: false,
    typingIndicator: false,
    deleteMessage: false,
    editMessage: false,
    twoStepUpload: false,
    challengeResponse: false,
    confirmationHandshake: false,
    maxMediaSizeBytes: 10 * 1024 * 1024,
    maxTextLength: 4096,
    ...overrides,
  };
}

function makeAccount(channel: ChannelType): ChannelAccount {
  return {
    id: 'acc-123',
    channel,
    name: `Test ${channel}`,
    isActive: true,
    credentials: { token: 'secret' },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: makeCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMockAdapter(channel: ChannelType): ChannelAdapter {
  return {
    channel,
    verifyWebhook: () => ({ valid: true }),
    extractIdempotencyKey: () => null,
    parseInbound: async () => [],
    parseStatusUpdate: () => [],
    isSpecialEvent: () => false,
    handleSpecialEvent: async () => null,
    sendText: async () => ({ success: true, externalMessageId: 'msg-1' }),
    sendMedia: async () => ({ success: true, externalMessageId: 'msg-2' }),
    downloadMedia: async () => Buffer.from('test'),
    getCapabilities: () => makeCapabilities(),
    verifyCredentials: async () => ({ ok: true }),
  };
}

// --- Types ---

describe('types', () => {
  it('ALL_CHANNELS contains 7 channels', () => {
    expect(ALL_CHANNELS).toHaveLength(7);
    expect(ALL_CHANNELS).toContain('telegram');
    expect(ALL_CHANNELS).toContain('vk');
    expect(ALL_CHANNELS).toContain('whatsapp');
    expect(ALL_CHANNELS).toContain('instagram');
    expect(ALL_CHANNELS).toContain('max');
    expect(ALL_CHANNELS).toContain('email');
    expect(ALL_CHANNELS).toContain('web');
  });

  it('MESSENGER_CHANNELS excludes web and email', () => {
    expect(MESSENGER_CHANNELS).toHaveLength(5);
    expect(MESSENGER_CHANNELS).not.toContain('web');
    expect(MESSENGER_CHANNELS).not.toContain('email');
  });

  it('ChannelAccount interface has all required fields', () => {
    const account = makeAccount('telegram');
    expect(account.id).toBe('acc-123');
    expect(account.channel).toBe('telegram');
    expect(account.isActive).toBe(true);
    expect(account.capabilities.sendPhoto).toBe(true);
  });
});

// --- DTO ---

describe('dto', () => {
  it('ParsedMessage can represent text-only message', () => {
    const msg: ParsedMessage = {
      externalMessageId: 'tg:12345',
      externalChatId: '67890',
      externalUserId: '11111',
      userName: 'Иван',
      content: 'Привет',
      messageType: 'text',
      isForwarded: false,
    };
    expect(msg.media).toBeUndefined();
    expect(msg.messageType).toBe('text');
  });

  it('ParsedMessage can represent multi-media message', () => {
    const media: ParsedMediaRef[] = [
      { sourceRef: 'file_id_1', sourceType: 'telegram_file_id', mimeHint: 'image/jpeg', mediaTypeHint: 'image' },
      { sourceRef: 'file_id_2', sourceType: 'telegram_file_id', mimeHint: 'image/png', mediaTypeHint: 'image' },
    ];
    const msg: ParsedMessage = {
      externalMessageId: 'tg:12345',
      externalChatId: '67890',
      externalUserId: '11111',
      userName: 'Иван',
      content: 'Два фото',
      messageType: 'image',
      media,
      isForwarded: false,
    };
    expect(msg.media).toHaveLength(2);
  });

  it('StatusUpdate represents delivery receipt', () => {
    const update: StatusUpdate = {
      externalMessageId: 'wa:abc',
      status: 'delivered',
      timestamp: new Date(),
    };
    expect(update.status).toBe('delivered');
  });

  it('SendResult represents success', () => {
    const result: SendResult = { success: true, externalMessageId: 'msg-123' };
    expect(result.success).toBe(true);
  });

  it('SendResult represents failure', () => {
    const result: SendResult = { success: false, errorCode: 'RATE_LIMITED', errorMessage: 'Too many requests' };
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RATE_LIMITED');
  });

  it('WebhookVerifyResult with challenge response', () => {
    const result: WebhookVerifyResult = { valid: true, challengeResponse: 'hub_challenge_123' };
    expect(result.challengeResponse).toBe('hub_challenge_123');
  });
});

// --- Adapter Registry ---

describe('adapter-registry', () => {
  beforeEach(() => {
    clearAdapters();
  });

  it('registers and retrieves adapter', () => {
    const adapter = makeMockAdapter('telegram');
    registerAdapter(adapter);
    expect(getAdapter('telegram')).toBe(adapter);
  });

  it('returns undefined for unregistered channel', () => {
    expect(getAdapter('telegram')).toBeUndefined();
  });

  it('getAdapterOrThrow throws for unregistered channel', () => {
    expect(() => getAdapterOrThrow('telegram')).toThrow('No adapter registered for channel "telegram"');
  });

  it('getAdapterOrThrow returns adapter when registered', () => {
    registerAdapter(makeMockAdapter('vk'));
    expect(getAdapterOrThrow('vk').channel).toBe('vk');
  });

  it('getAllAdapters returns all registered', () => {
    registerAdapter(makeMockAdapter('telegram'));
    registerAdapter(makeMockAdapter('vk'));
    expect(getAllAdapters()).toHaveLength(2);
  });

  it('getRegisteredChannels returns channel types', () => {
    registerAdapter(makeMockAdapter('telegram'));
    registerAdapter(makeMockAdapter('max'));
    expect(getRegisteredChannels()).toEqual(['telegram', 'max']);
  });

  it('hasAdapter returns boolean', () => {
    expect(hasAdapter('telegram')).toBe(false);
    registerAdapter(makeMockAdapter('telegram'));
    expect(hasAdapter('telegram')).toBe(true);
  });

  it('unregisterAdapter removes adapter', () => {
    registerAdapter(makeMockAdapter('telegram'));
    expect(unregisterAdapter('telegram')).toBe(true);
    expect(hasAdapter('telegram')).toBe(false);
  });

  it('registerAdapter replaces existing', () => {
    const first = makeMockAdapter('telegram');
    const second = makeMockAdapter('telegram');
    registerAdapter(first);
    registerAdapter(second);
    expect(getAdapter('telegram')).toBe(second);
    expect(getAllAdapters()).toHaveLength(1);
  });
});

// --- Circuit Breaker ---

describe('circuit-breaker', () => {
  it('getBreaker returns channel-level breaker', () => {
    const breaker = getBreaker('telegram');
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('getBreaker with accountId returns account-level breaker', () => {
    const channelBreaker = getBreaker('telegram');
    const accountBreaker = getBreaker('telegram', 'acc-123');
    expect(channelBreaker).not.toBe(accountBreaker);
  });

  it('same channel+accountId returns same breaker', () => {
    const b1 = getBreaker('vk', 'acc-456');
    const b2 = getBreaker('vk', 'acc-456');
    expect(b1).toBe(b2);
  });

  it('withCircuitBreaker passes through on success', async () => {
    const result = await withCircuitBreaker('max', undefined, async () => 42);
    expect(result).toBe(42);
  });

  it('withCircuitBreaker records failure and re-throws', async () => {
    const breaker = getBreaker('whatsapp', 'acc-fail');
    await expect(
      withCircuitBreaker('whatsapp', 'acc-fail', async () => { throw new Error('network error'); }),
    ).rejects.toThrow('network error');
    expect(breaker.getFailures()).toBe(1);
  });

  it('withCircuitBreaker opens circuit after threshold failures', async () => {
    const channel: ChannelType = 'instagram';
    const accountId = 'acc-threshold';
    const breaker = getBreaker(channel, accountId);

    for (let i = 0; i < 5; i++) {
      await expect(
        withCircuitBreaker(channel, accountId, async () => { throw new Error('fail'); }),
      ).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe('OPEN');

    // Should fast-fail without calling fn
    await expect(
      withCircuitBreaker(channel, accountId, async () => 'should not reach'),
    ).rejects.toThrow('Circuit breaker OPEN');
  });
});

// --- Media Processor ---

describe('media-processor', () => {
  it('passes through JPEG without conversion', async () => {
    const buffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
    const result = await processMediaBuffer(buffer, 'image/jpeg', 'image');
    expect(result.mime).toBe('image/jpeg');
    expect(result.ext).toBe('.jpg');
    expect(result.messageType).toBe('image');
    expect(result.buffer).toBe(buffer); // same reference, no copy
  });

  it('reclassifies file + image/* → image', async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG magic
    const result = await processMediaBuffer(buffer, 'image/png', 'file');
    expect(result.messageType).toBe('image');
    expect(result.ext).toBe('.png');
  });

  it('reclassifies file + video/* → video', async () => {
    const buffer = Buffer.from('fake video');
    const result = await processMediaBuffer(buffer, 'video/mp4', 'file');
    expect(result.messageType).toBe('video');
    expect(result.ext).toBe('.mp4');
  });

  it('reclassifies file + audio/* → audio', async () => {
    const buffer = Buffer.from('fake audio');
    const result = await processMediaBuffer(buffer, 'audio/ogg', 'file');
    expect(result.messageType).toBe('audio');
    expect(result.ext).toBe('.ogg');
  });

  it('does NOT reclassify SVG as image', async () => {
    const buffer = Buffer.from('<svg></svg>');
    const result = await processMediaBuffer(buffer, 'image/svg+xml', 'file');
    expect(result.messageType).toBe('file');
  });

  it('does NOT reclassify unsupported browser images as ready photos', async () => {
    const buffer = Buffer.from([0x49, 0x49, 0x2A, 0x00]); // TIFF magic
    const result = await processMediaBuffer(buffer, 'image/tiff', 'file', 'scan.tiff');
    expect(result.messageType).toBe('file');
    expect(result.ext).toBe('.tiff');
  });

  it('never downgrades image → file', async () => {
    const buffer = Buffer.from('not actually a pdf');
    const result = await processMediaBuffer(buffer, 'application/pdf', 'image');
    expect(result.messageType).toBe('image'); // keeps original
  });

  it('uses fileName extension when provided', async () => {
    const buffer = Buffer.from('doc');
    const result = await processMediaBuffer(buffer, 'application/octet-stream', 'file', 'report.xlsx');
    expect(result.ext).toBe('.xlsx');
  });

  it('stores original HEIC as a file when JPEG conversion fails', async () => {
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ]);

    const result = await processMediaBuffer(buffer, 'image/heic', 'file', 'broken.HEIC');

    expect(result.buffer).toBe(buffer);
    expect(result.mime).toBe('image/heic');
    expect(result.ext).toBe('.HEIC');
    expect(result.messageType).toBe('file');
  });

  it('falls back to .bin for unknown MIME', async () => {
    const buffer = Buffer.from('unknown');
    const result = await processMediaBuffer(buffer, 'application/x-custom-format', 'file');
    expect(result.ext).toBe('.bin');
  });
});

describe('image-convert', () => {
  it('marks WebP/HEIC as requiring JPEG conversion', () => {
    expect(shouldConvertToJpeg('image/webp')).toBe(true);
    expect(shouldConvertToJpeg('image/heic')).toBe(true);
    expect(needsJpegConversion(null, 'IMG_001.HEIC')).toBe(true);
    expect(replaceExtForJpeg('IMG_001.HEIC')).toBe('IMG_001.jpg');
  });

  it('keeps already-browser-safe JPEG out of conversion paths', () => {
    expect(canConvertToJpeg('image/webp')).toBe(true);
    expect(canConvertToJpeg('image/jpeg')).toBe(false);
  });
});
