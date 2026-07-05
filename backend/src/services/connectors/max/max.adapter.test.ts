/**
 * Max Adapter — Unit Tests
 *
 * Tests token-based inbound media parsing, uploadMedia, downloadMedia with max_token,
 * sendTypingIndicator, sendMedia with token upload, and capabilities.
 */

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock('../../../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('../core/circuit-breaker.js', () => ({
  withCircuitBreaker: (_ch: unknown, _id: unknown, fn: () => unknown) => fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// handleSpecialEvent dynamically imports the broadcast-callback handler — mock it so we can
// assert the channel arg ('max') and the ack-reply path without the chat-broadcast graph.
const mockHandleBroadcastCallback = vi.fn();
vi.mock('../../broadcast/broadcast-callbacks.service.js', () => ({
  handleBroadcastCallback: (...args: unknown[]) => mockHandleBroadcastCallback(...args),
}));

import { MaxAdapter } from './max.adapter.js';
import type { ChannelAccount } from '../core/types.js';
import type { ParsedMediaRef } from '../core/dto.js';

// --- Fixtures ---

type UnknownRecord = { [key: string]: unknown };

function makeAccount(overrides?: Partial<ChannelAccount>): ChannelAccount {
  return {
    id: 'acc-max-1',
    channel: 'max',
    name: 'Test Max',
    isActive: true,
    credentials: { accessToken: 'test-token-123', apiUrl: 'https://api.test.max.ru' },
    rateLimitMax: 30,
    rateLimitDurationMs: 1000,
    capabilities: new MaxAdapter().getCapabilities(),
    tokenExpiresAt: null,
    tokenRefreshedAt: null,
    webhookUrl: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeInboundBody(attachments: Array<UnknownRecord>, text = ''): UnknownRecord {
  return {
    update_type: 'message_created',
    message: {
      sender: { user_id: 42, name: 'Тестовый Пользователь', username: 'testuser' },
      recipient: { chat_id: 'chat-100' },
      body: {
        mid: 'msg-abc-123',
        text,
        attachments,
      },
    },
  };
}

function mockJsonResponse(data: UnknownRecord, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    headers: new Headers(),
  } as Response;
}

function mockBinaryResponse(buffer: Buffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
    headers: new Headers(),
  } as Response;
}

function maxContactHash(vcfInfo: string, accessToken = 'test-token-123'): string {
  const normalizedVcf = vcfInfo
    .replace(/\\r\\n/g, '\r\n')
    .replace(/\\n/g, '\n')
    .replace(/\r?\n/g, '\r\n');
  return crypto.createHmac('sha256', accessToken).update(normalizedVcf).digest('hex');
}

// --- Tests ---

describe('MaxAdapter', () => {
  let adapter: MaxAdapter;
  let account: ChannelAccount;

  beforeEach(() => {
    adapter = new MaxAdapter();
    account = makeAccount();
    mockFetch.mockReset();
    mockHandleBroadcastCallback.mockReset().mockResolvedValue(null);
  });

  describe('verifyWebhook', () => {
    it('validates X-Max-Bot-Api-Secret when configured', () => {
      const secretAccount = makeAccount({
        credentials: { accessToken: 'test-token-123', webhookSecret: 'secret-123' },
      });

      const result = adapter.verifyWebhook({
        body: {},
        headers: { 'x-max-bot-api-secret': 'secret-123' },
      }, secretAccount);

      expect(result.valid).toBe(true);
    });

    it('rejects mismatched X-Max-Bot-Api-Secret', () => {
      const secretAccount = makeAccount({
        credentials: { accessToken: 'test-token-123', webhookSecret: 'secret-123' },
      });

      const result = adapter.verifyWebhook({
        body: {},
        headers: { 'x-max-bot-api-secret': 'wrong-secret' },
      }, secretAccount);

      expect(result.valid).toBe(false);
    });
  });

  // =====================================================
  // 1. Token-based inbound media parsing
  // =====================================================

  describe('parseInbound — token-based media', () => {
    it('uses sourceType=url when payload.url is present', async () => {
      const body = makeInboundBody([
        { type: 'video', payload: { url: 'https://cdn.max.ru/video.mp4' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media).toHaveLength(1);
      expect(results[0].media![0].sourceType).toBe('url');
      expect(results[0].media![0].sourceRef).toBe('https://cdn.max.ru/video.mp4');
    });

    it('uses sourceType=max_token when only payload.token is present (video)', async () => {
      const body = makeInboundBody([
        { type: 'video', payload: { token: 'video-token-xyz' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media).toHaveLength(1);
      expect(results[0].media![0].sourceType).toBe('max_token');
      expect(results[0].media![0].sourceRef).toBe('video-token-xyz');
      expect(results[0].media![0].mimeHint).toBe('video/mp4');
      expect(results[0].messageType).toBe('video');
    });

    it('uses sourceType=max_token when only payload.token is present (audio)', async () => {
      const body = makeInboundBody([
        { type: 'audio', payload: { token: 'audio-token-abc' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media![0].sourceType).toBe('max_token');
      expect(results[0].media![0].sourceRef).toBe('audio-token-abc');
      expect(results[0].media![0].mimeHint).toBe('audio/ogg');
      expect(results[0].messageType).toBe('audio');
    });

    it('uses sourceType=max_token when only payload.token is present (image)', async () => {
      const body = makeInboundBody([
        { type: 'image', payload: { token: 'img-token-def' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media![0].sourceType).toBe('max_token');
      expect(results[0].media![0].sourceRef).toBe('img-token-def');
      expect(results[0].media![0].mimeHint).toBe('image/jpeg');
    });

    it('uses sourceType=max_token when only payload.token is present (file)', async () => {
      const body = makeInboundBody([
        { type: 'file', payload: { token: 'file-token-ghi', fileName: 'document.pdf' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media![0].sourceType).toBe('max_token');
      expect(results[0].media![0].sourceRef).toBe('file-token-ghi');
      expect(results[0].media![0].fileName).toBe('document.pdf');
      expect(results[0].messageType).toBe('file');
    });

    it('prefers url over token when both are present', async () => {
      const body = makeInboundBody([
        { type: 'video', payload: { url: 'https://cdn.max.ru/v.mp4', token: 'should-be-ignored' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results[0].media![0].sourceType).toBe('url');
      expect(results[0].media![0].sourceRef).toBe('https://cdn.max.ru/v.mp4');
    });

    it('skips media ref when neither url nor token is present', async () => {
      const body = makeInboundBody([
        { type: 'video', payload: {} },
      ], 'text message');

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].media).toBeUndefined();
      // messageType is set to 'video' by the attachment type even without downloadable ref
      expect(results[0].messageType).toBe('video');
    });

    it('handles file with image extension + token correctly', async () => {
      const body = makeInboundBody([
        { type: 'file', payload: { token: 'img-file-token', fileName: 'photo.jpg' } },
      ]);

      const results = await adapter.parseInbound(body);
      expect(results[0].messageType).toBe('image');
      expect(results[0].media![0].sourceType).toBe('max_token');
      expect(results[0].media![0].mediaTypeHint).toBe('image');
    });
  });

  // =====================================================
  // 1b. Forwarded messages
  // =====================================================

  describe('parseInbound — forwarded messages', () => {
    it('extracts text from link.message when body.text is empty (forwarded text)', async () => {
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 42, name: 'Юрий' },
          recipient: { chat_id: 'chat-100' },
          body: { mid: 'msg-fwd-1', text: '', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Виктория', user_id: 999 },
            chat_id: 0,
            message: {
              mid: 'orig-msg-1',
              text: 'Таких карт 5 штук\nРазмер 60х100',
              attachments: [],
            },
          },
        },
      };

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Таких карт 5 штук\nРазмер 60х100');
      expect(results[0].isForwarded).toBe(true);
      expect(results[0].forwardedFromName).toBe('Виктория');
      expect(results[0].messageType).toBe('text');
    });

    it('extracts file attachment from link.message when body.attachments is empty', async () => {
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 42, name: 'Юрий' },
          recipient: { chat_id: 'chat-100' },
          body: { mid: 'msg-fwd-2', text: '', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Евгений Панфёров', user_id: 68889450 },
            chat_id: 0,
            message: {
              mid: 'orig-msg-2',
              text: '',
              attachments: [
                { type: 'file', size: 104661, payload: { url: 'https://fd.oneme.ru/getfile?id=123', token: 'tk-abc', fileId: 123 }, filename: 'dkp-agreement.pdf' },
              ],
            },
          },
        },
      };

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('file');
      expect(results[0].isForwarded).toBe(true);
      expect(results[0].forwardedFromName).toBe('Евгений Панфёров');
      expect(results[0].media).toHaveLength(1);
      expect(results[0].media![0].sourceRef).toBe('https://fd.oneme.ru/getfile?id=123');
    });

    it('extracts image from link.message.attachments', async () => {
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 46, name: 'Анастасия' },
          recipient: { chat_id: 'chat-200' },
          body: { mid: 'msg-fwd-3', text: '', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Виктория Янченкова', user_id: 43386130 },
            chat_id: 0,
            message: {
              mid: 'orig-msg-3',
              text: 'Таких карт 5 штук',
              attachments: [
                { type: 'image', payload: { url: 'https://i.oneme.ru/image.jpg', token: 'img-tk' } },
              ],
            },
          },
        },
      };

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('image');
      expect(results[0].content).toBe('Таких карт 5 штук');
      expect(results[0].isForwarded).toBe(true);
      expect(results[0].forwardedFromName).toBe('Виктория Янченкова');
      expect(results[0].media![0].sourceRef).toBe('https://i.oneme.ru/image.jpg');
    });

    it('does NOT use link.message if body already has content', async () => {
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 42, name: 'Юрий' },
          recipient: { chat_id: 'chat-100' },
          body: { mid: 'msg-fwd-4', text: 'Мой комментарий', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Виктория' },
            message: { mid: 'orig', text: 'Оригинальный текст', attachments: [] },
          },
        },
      };

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      // Body text takes priority over link.message text
      expect(results[0].content).toBe('Мой комментарий');
      expect(results[0].isForwarded).toBe(true);
    });

    it('handles forwarded share attachment (link preview)', async () => {
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 42, name: 'Юрий' },
          recipient: { chat_id: 'chat-100' },
          body: { mid: 'msg-fwd-5', text: '', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Бот' },
            message: {
              mid: 'orig-5',
              text: 'Оплата получена!',
              attachments: [
                { type: 'share', title: 'Своё Фото', payload: { url: 'https://svoefoto.ru/track/SF-123' } },
              ],
            },
          },
        },
      };

      const results = await adapter.parseInbound(body);
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('Оплата получена!');
      expect(results[0].content).toContain('https://svoefoto.ru/track/SF-123');
      expect(results[0].isForwarded).toBe(true);
    });
  });

  describe('parseInbound — verified contact sharing', () => {
    it('extracts phone from a MAX request_contact attachment with valid hash', async () => {
      const vcfInfo = 'BEGIN:VCARD\\r\\nVERSION:3.0\\r\\nTEL;TYPE=cell:79990000000\\r\\nFN:Ivan Ivanov\\r\\nEND:VCARD\\r\\n';
      const body = makeInboundBody([
        {
          type: 'contact',
          payload: {
            vcf_info: vcfInfo,
            hash: maxContactHash(vcfInfo),
          },
        },
      ]);

      const results = await adapter.parseInbound(body, {}, account);

      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('contact');
      expect(results[0].content).toBe('[Клиент поделился номером телефона]');
      expect(results[0].phone).toBe('+79990000000');
    });

    it('does not trust a contact attachment without valid hash', async () => {
      const vcfInfo = 'BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=cell:79990000000\r\nEND:VCARD\r\n';
      const body = makeInboundBody([
        {
          type: 'contact',
          payload: {
            vcf_info: vcfInfo,
            hash: 'invalid-hash',
          },
        },
      ]);

      const results = await adapter.parseInbound(body, {}, account);

      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('contact');
      expect(results[0].content).toBe('[Контакт MAX без подтверждения]');
      expect(results[0].phone).toBeUndefined();
    });

    it('does not trust forwarded contact attachments even when hash matches', async () => {
      const vcfInfo = 'BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=cell:79990000000\r\nEND:VCARD\r\n';
      const body = {
        update_type: 'message_created',
        message: {
          sender: { user_id: 42, name: 'Юрий' },
          recipient: { chat_id: 'chat-100' },
          body: { mid: 'msg-fwd-contact', text: '', attachments: [] },
          link: {
            type: 'forward',
            sender: { name: 'Иван' },
            message: {
              mid: 'orig-contact',
              text: '',
              attachments: [
                { type: 'contact', payload: { vcf_info: vcfInfo, hash: maxContactHash(vcfInfo) } },
              ],
            },
          },
        },
      };

      const results = await adapter.parseInbound(body, {}, account);

      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('contact');
      expect(results[0].isForwarded).toBe(true);
      expect(results[0].phone).toBeUndefined();
      expect(results[0].content).toBe('[Контакт MAX без подтверждения]');
    });

    it('keeps typed phone numbers as plain text, not a trusted phone', async () => {
      const body = makeInboundBody([], '79990000000');

      const results = await adapter.parseInbound(body, {}, account);

      expect(results).toHaveLength(1);
      expect(results[0].messageType).toBe('text');
      expect(results[0].content).toBe('79990000000');
      expect(results[0].phone).toBeUndefined();
    });
  });

  // =====================================================
  // 2. downloadMedia with max_token
  // =====================================================

  describe('downloadMedia', () => {
    it('uses GET /uploads/{token} with Authorization for max_token sourceType', async () => {
      const fileBuffer = Buffer.from('fake-video-content');
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(fileBuffer));

      const ref: ParsedMediaRef = {
        sourceRef: 'my-upload-token',
        sourceType: 'max_token',
        mimeHint: 'video/mp4',
        mediaTypeHint: 'video',
      };

      const result = await adapter.downloadMedia(ref, account);
      expect(result).toEqual(fileBuffer);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      expect(url).toBe('https://api.test.max.ru/uploads/my-upload-token');
      expect(opts['method']).toBe('GET');
      expect((opts['headers'] as Record<string, string>)['Authorization']).toBe('test-token-123');
    });

    it('uses direct URL fetch for url sourceType', async () => {
      const fileBuffer = Buffer.from('fake-image-content');
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(fileBuffer));

      const ref: ParsedMediaRef = {
        sourceRef: 'https://cdn.max.ru/image.jpg',
        sourceType: 'url',
        mimeHint: 'image/jpeg',
        mediaTypeHint: 'image',
      };

      const result = await adapter.downloadMedia(ref, account);
      expect(result).toEqual(fileBuffer);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://cdn.max.ru/image.jpg');
    });

    it('throws on max_token download failure', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from(''), 404));

      const ref: ParsedMediaRef = {
        sourceRef: 'bad-token',
        sourceType: 'max_token',
        mimeHint: 'video/mp4',
        mediaTypeHint: 'video',
      };

      await expect(adapter.downloadMedia(ref, account)).rejects.toThrow('Max token media download failed: 404');
    });

    it('encodes token with special characters in URL', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('data')));

      const ref: ParsedMediaRef = {
        sourceRef: 'token/with+special chars',
        sourceType: 'max_token',
        mimeHint: 'application/octet-stream',
        mediaTypeHint: 'file',
      };

      await adapter.downloadMedia(ref, account);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain(encodeURIComponent('token/with+special chars'));
    });
  });

  // =====================================================
  // 3. sendText
  // =====================================================

  describe('sendText', () => {
    it('extracts outbound mid from documented message response', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'sent-text-1' } } }));

      const result = await adapter.sendText(account, 'chat-1', 'Hello');

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('max:sent-text-1');
    });

    it('extracts outbound mid from legacy top-level body response', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ body: { mid: 'sent-text-2' } }));

      const result = await adapter.sendText(account, 'chat-1', 'Hello');

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('max:sent-text-2');
    });
  });

  describe('sendContactRequest', () => {
    it('sends a MAX request_contact inline keyboard button', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'contact-request-1' } } }));

      const result = await adapter.sendContactRequest(account, 'chat-1');

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('max:contact-request-1');
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      expect(url).toBe('https://api.test.max.ru/messages?chat_id=chat-1');
      expect(opts['method']).toBe('POST');
      const body = JSON.parse(opts['body'] as string) as UnknownRecord;
      expect(body['text']).toContain('номер телефона');
      const attachments = body['attachments'] as Array<UnknownRecord>;
      expect(attachments[0]['type']).toBe('inline_keyboard');
      const payload = attachments[0]['payload'] as UnknownRecord;
      const buttons = payload['buttons'] as Array<Array<UnknownRecord>>;
      expect(buttons[0][0]).toMatchObject({
        type: 'request_contact',
        text: 'Поделиться телефоном',
      });
    });
  });

  // =====================================================
  // 4. sendMedia with upload for non-image types
  // =====================================================

  describe('sendMedia — upload for video/audio/file', () => {
    it('uploads video via MAX upload URL then sends with token payload', async () => {
      // 1st call: download media from S3/CDN
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('video-bytes')));
      // 2nd call: POST /uploads → upload URL
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ url: 'https://upload.max.test/video', token: 'uploaded-video-token' }));
      // 3rd call: POST upload URL → upload retval
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ retval: 'ok' }));
      // 4th call: POST /messages → send message
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'sent-msg-1' } } }));

      const result = await adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/video.mp4', 'video', 'Видео');

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('max:sent-msg-1');
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify upload URL creation call
      const [createUrl, createOpts] = mockFetch.mock.calls[1] as [string, UnknownRecord];
      expect(createUrl).toBe('https://api.test.max.ru/uploads?type=video');
      expect(createOpts['method']).toBe('POST');
      expect((createOpts['headers'] as Record<string, string>)['Authorization']).toBe('test-token-123');

      // Verify file upload call
      const [uploadUrl, uploadOpts] = mockFetch.mock.calls[2] as [string, UnknownRecord];
      expect(uploadUrl).toBe('https://upload.max.test/video');
      expect(uploadOpts['method']).toBe('POST');
      expect((uploadOpts['headers'] as Record<string, string>)['Authorization']).toBe('test-token-123');

      // Verify send call uses token payload
      const [, sendOpts] = mockFetch.mock.calls[3] as [string, UnknownRecord];
      const sendBody = JSON.parse(sendOpts['body'] as string) as UnknownRecord;
      const attachments = sendBody['attachments'] as Array<UnknownRecord>;
      expect(attachments[0]['type']).toBe('video');
      const attPayload = attachments[0]['payload'] as UnknownRecord;
      expect(attPayload['token']).toBe('uploaded-video-token');
      expect(attPayload['retval']).toBe('ok');
      expect(attPayload['url']).toBeUndefined();
    });

    it('uploads audio via MAX upload URL', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('audio-bytes')));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ url: 'https://upload.max.test/audio' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ token: 'audio-tk' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'sent-msg-2' } } }));

      const result = await adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/audio.ogg', 'audio');
      expect(result.success).toBe(true);

      const [createUrl] = mockFetch.mock.calls[1] as [string];
      expect(createUrl).toBe('https://api.test.max.ru/uploads?type=audio');
      const [uploadUrl] = mockFetch.mock.calls[2] as [string];
      expect(uploadUrl).toBe('https://upload.max.test/audio');
    });

    it('uploads file via MAX upload URL and sends the returned payload', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('file-bytes')));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ url: 'https://upload.max.test/file' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ token: 'file-tk', fileName: 'doc.pdf' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'sent-msg-3' } } }));

      const result = await adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/doc.pdf', 'file', undefined, 'doc.pdf');
      expect(result.success).toBe(true);

      const [createUrl] = mockFetch.mock.calls[1] as [string];
      expect(createUrl).toBe('https://api.test.max.ru/uploads?type=file');
      const [uploadUrl] = mockFetch.mock.calls[2] as [string];
      expect(uploadUrl).toBe('https://upload.max.test/file');

      const [, sendOpts] = mockFetch.mock.calls[3] as [string, UnknownRecord];
      const sendBody = JSON.parse(sendOpts['body'] as string) as UnknownRecord;
      const attachments = sendBody['attachments'] as Array<UnknownRecord>;
      expect(attachments[0]['type']).toBe('file');
      expect(attachments[0]['payload']).toEqual({ token: 'file-tk', fileName: 'doc.pdf' });
    });

    it('sends image with url (no upload)', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ body: { mid: 'img-msg' } }));

      const result = await adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/photo.jpg', 'image', 'Фото');
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();

      const [, sendOpts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      const sendBody = JSON.parse(sendOpts['body'] as string) as UnknownRecord;
      const attachments = sendBody['attachments'] as Array<UnknownRecord>;
      const attPayload = attachments[0]['payload'] as UnknownRecord;
      expect(attPayload['url']).toBe('https://s3.example.com/photo.jpg');
      expect(attPayload['token']).toBeUndefined();
    });

    it('returns failure when upload fails', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('data')));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ url: 'https://upload.max.test/video' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'bad request' }, 400));

      await expect(
        adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/video.mp4', 'video'),
      ).rejects.toThrow('Max upload failed (400)');
    });

    it('returns failure when upload response has no token', async () => {
      mockFetch.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('data')));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ url: 'https://upload.max.test/video' }));
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ retval: 'ok' }));

      await expect(
        adapter.sendMedia(account, 'chat-1', 'https://s3.example.com/video.mp4', 'video'),
      ).rejects.toThrow('Max upload response missing token');
    });

    it('returns failure when access token is missing', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });
      const result = await adapter.sendMedia(noTokenAccount, 'chat-1', 'https://s3.example.com/f.mp4', 'video');
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Access token not configured');
    });
  });

  // =====================================================
  // 5. sendTypingIndicator / markAsRead
  // =====================================================

  describe('sendTypingIndicator', () => {
    it('sends POST /chats/{chatId}/actions with action=typing_on', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}));

      await adapter.sendTypingIndicator(account, 'chat-42');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      expect(url).toBe('https://api.test.max.ru/chats/chat-42/actions');
      expect(opts['method']).toBe('POST');
      const body = JSON.parse(opts['body'] as string) as UnknownRecord;
      expect(body['action']).toBe('typing_on');
      expect((opts['headers'] as Record<string, string>)['Authorization']).toBe('test-token-123');
    });

    it('does not throw when API returns error (catches silently)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network timeout'));

      // Should not throw
      await adapter.sendTypingIndicator(account, 'chat-42');
    });

    it('does nothing when access token is missing', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });

      await adapter.sendTypingIndicator(noTokenAccount, 'chat-42');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('encodes chatId with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}));

      await adapter.sendTypingIndicator(account, 'chat/with spaces');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain(encodeURIComponent('chat/with spaces'));
    });
  });

  describe('markAsRead', () => {
    it('sends POST /chats/{chatId}/actions with action=mark_seen', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

      await adapter.markAsRead(account, 'chat-42');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      expect(url).toBe('https://api.test.max.ru/chats/chat-42/actions');
      expect(opts['method']).toBe('POST');
      const body = JSON.parse(opts['body'] as string) as UnknownRecord;
      expect(body['action']).toBe('mark_seen');
      expect((opts['headers'] as Record<string, string>)['Authorization']).toBe('test-token-123');
    });

    it('does not throw when mark_seen request fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network timeout'));

      await adapter.markAsRead(account, 'chat-42');
    });

    it('does nothing when markAsRead access token is missing', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });

      await adapter.markAsRead(noTokenAccount, 'chat-42');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // 5b. sendBroadcast — image + text + inline buttons in ONE message
  // =====================================================

  describe('sendBroadcast', () => {
    const KEYBOARD = [
      [{ type: 'link' as const, text: 'Открыть', url: 'https://svoefoto.ru/pechat?utm_term=chat-1' }],
      [{ type: 'callback' as const, text: '📍 Наши адреса', payload: 'bcast_addresses' }],
      [
        { type: 'callback' as const, text: '🙋 Я не студент', payload: 'bcast_not_student' },
        { type: 'callback' as const, text: '❌ Отписаться', payload: 'bcast_unsub' },
      ],
    ];

    it('sends ONE POST /messages with image + caption + inline_keyboard in a single attachments array', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'bcast-1' } } }));

      const result = await adapter.sendBroadcast(account, 'chat-1', 'https://cdn/x.jpg', 'Привет!', KEYBOARD);

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('max:bcast-1');
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      expect(url).toBe('https://api.test.max.ru/messages?chat_id=chat-1');
      expect(opts['method']).toBe('POST');
      const body = JSON.parse(opts['body'] as string) as UnknownRecord;
      expect(body['text']).toBe('Привет!');
      const attachments = body['attachments'] as Array<UnknownRecord>;
      // image FIRST, inline_keyboard SECOND — both in the same attachments array (one message).
      expect(attachments).toHaveLength(2);
      expect(attachments[0]['type']).toBe('image');
      expect(attachments[0]['payload']).toEqual({ url: 'https://cdn/x.jpg' });
      expect(attachments[1]['type']).toBe('inline_keyboard');
      expect((attachments[1]['payload'] as UnknownRecord)['buttons']).toEqual(KEYBOARD);
    });

    it('omits the inline_keyboard attachment when there are no buttons (image only)', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'bcast-2' } } }));

      const result = await adapter.sendBroadcast(account, 'chat-1', 'https://cdn/x.jpg', 'Только фото', []);

      expect(result.success).toBe(true);
      const [, opts] = mockFetch.mock.calls[0] as [string, UnknownRecord];
      const body = JSON.parse(opts['body'] as string) as UnknownRecord;
      const attachments = body['attachments'] as Array<UnknownRecord>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]['type']).toBe('image'); // no empty inline_keyboard appended
    });

    it('returns failure (errorCode) on a non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'forbidden' }, 403));

      const result = await adapter.sendBroadcast(account, 'chat-1', 'https://cdn/x.jpg', 'hi', KEYBOARD);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('403');
    });

    it('returns failure when access token is missing', async () => {
      const noTokenAccount = makeAccount({ credentials: {} });
      const result = await adapter.sendBroadcast(noTokenAccount, 'chat-1', 'https://cdn/x.jpg', 'hi', KEYBOARD);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Access token not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // 5c. handleSpecialEvent — broadcast callback routing (channel='max')
  // =====================================================

  describe('handleSpecialEvent — broadcast callbacks', () => {
    function makeCallbackBody(payload: string, chatId: string | number = 'chat-1'): UnknownRecord {
      return {
        update_type: 'message_callback',
        callback: {
          callback_id: 'cb-123',
          payload,
        },
        message: {
          recipient: { chat_id: chatId },
        },
      };
    }

    it('routes a broadcast callback to handleBroadcastCallback with channel="max" + sends the ack', async () => {
      mockHandleBroadcastCallback.mockResolvedValue({ ackText: 'Готово — вы отписаны 🙌' });
      // 1st fetch = callback ack (/answers/callback); 2nd fetch = sendText ack-reply.
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({}))
        .mockResolvedValueOnce(mockJsonResponse({ message: { body: { mid: 'ack-1' } } }));

      const res = await adapter.handleSpecialEvent(makeCallbackBody('bcast_unsub'), account);

      expect(res).toBe('ok');
      expect(mockHandleBroadcastCallback).toHaveBeenCalledTimes(1);
      const args = mockHandleBroadcastCallback.mock.calls[0];
      expect(args[0]).toBe('chat-1');     // chatId resolved from message.recipient.chat_id
      expect(args[1]).toBe('bcast_unsub'); // payload
      expect(args[2]).toBe('max');         // channel — MUST be 'max', not the default telegram

      // The ack reply was sent via sendText (POST /messages) carrying the handler's ackText.
      const sendCall = mockFetch.mock.calls.find(([u]) => String(u).includes('/messages?chat_id=chat-1'));
      expect(sendCall).toBeTruthy();
      const sendBody = JSON.parse((sendCall![1] as UnknownRecord)['body'] as string) as UnknownRecord;
      expect(sendBody['text']).toBe('Готово — вы отписаны 🙌');
    });

    it('resolves chat_id from a numeric recipient id', async () => {
      mockHandleBroadcastCallback.mockResolvedValue(null);
      mockFetch.mockResolvedValueOnce(mockJsonResponse({})); // ack only

      await adapter.handleSpecialEvent(makeCallbackBody('bcast_addresses', 138553724), account);

      expect(mockHandleBroadcastCallback).toHaveBeenCalledWith('138553724', 'bcast_addresses', 'max');
    });

    it('does NOT route a non-broadcast callback payload', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({})); // ack only

      const res = await adapter.handleSpecialEvent(makeCallbackBody('some_app_button'), account);

      expect(res).toBe('ok');
      expect(mockHandleBroadcastCallback).not.toHaveBeenCalled();
    });

    it('returns null for a non-callback update', async () => {
      const res = await adapter.handleSpecialEvent({ update_type: 'message_created' }, account);
      expect(res).toBeNull();
      expect(mockHandleBroadcastCallback).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // 6. Capabilities
  // =====================================================

  describe('getCapabilities', () => {
    it('maxTextLength is 4000', () => {
      const caps = adapter.getCapabilities();
      expect(caps.maxTextLength).toBe(4000);
    });

    it('typingIndicator is true', () => {
      const caps = adapter.getCapabilities();
      expect(caps.typingIndicator).toBe(true);
    });

    it('markAsRead is true', () => {
      const caps = adapter.getCapabilities();
      expect(caps.markAsRead).toBe(true);
    });

    it('channel is max', () => {
      expect(adapter.channel).toBe('max');
    });
  });
});
