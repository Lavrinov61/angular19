/**
 * Omnichannel v2 — Max Adapter
 *
 * Implements ChannelAdapter for Max Messenger Bot API.
 * Credentials from ChannelAccount. Inline sending logic (no bot service wrapper).
 */

import crypto from 'crypto';
import { Readable } from 'stream';
import type { ChannelAdapter } from '../core/adapter.interface.js';
import type { ChannelAccount, ChannelCapabilities, MessageType } from '../core/types.js';
import type {
  ParsedMessage,
  ParsedMediaRef,
  StatusUpdate,
  SendResult,
  RawRequest,
  WebhookVerifyResult,
} from '../core/dto.js';
import { withCircuitBreaker } from '../core/circuit-breaker.js';
import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import { mimeFromFilename } from '../../../utils/mime-utils.js';
import { createLogger } from '../../../utils/logger.js';
import { isBroadcastCallback } from '../../broadcast/broadcast-callbacks.constants.js';

const log = createLogger('max-adapter');

interface MaxCredentials {
  accessToken: string;
  apiUrl?: string;
  webhookSecret?: string;
}

type UnknownRecord = { [key: string]: unknown };

interface MaxUploadTarget {
  url: string;
  token?: string;
}

function creds(account: ChannelAccount): MaxCredentials {
  const source = account.credentials;
  return {
    accessToken: typeof source['accessToken'] === 'string' ? source['accessToken'] : '',
    apiUrl: typeof source['apiUrl'] === 'string' ? source['apiUrl'] : undefined,
    webhookSecret: typeof source['webhookSecret'] === 'string' ? source['webhookSecret'] : undefined,
  };
}

function messagesUrl(c: MaxCredentials, chatId: string): string {
  const base = c.apiUrl || 'https://platform-api.max.ru';
  return `${base}/messages?chat_id=${encodeURIComponent(chatId)}`;
}

function messageActionUrl(c: MaxCredentials, messageId: string): string {
  const base = c.apiUrl || 'https://platform-api.max.ru';
  return `${base}/messages?message_id=${encodeURIComponent(messageId)}`;
}

function uploadsUrl(c: MaxCredentials, uploadType: string): string {
  const base = c.apiUrl || 'https://platform-api.max.ru';
  return `${base}/uploads?type=${encodeURIComponent(uploadType)}`;
}

function authHeaders(c: MaxCredentials): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': c.accessToken };
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff']);
const MAX_ATTACHMENT_NOT_READY = 'attachment.not.ready';
const MAX_SEND_ATTEMPTS = 3;
const MAX_CONTACT_SHARED_TEXT = '[Клиент поделился номером телефона]';
const MAX_UNVERIFIED_CONTACT_TEXT = '[Контакт MAX без подтверждения]';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeUploadFileName(fileName: string | undefined, mediaUrl: string): string {
  const trimmed = fileName?.trim();
  if (trimmed) return trimmed;
  try {
    const name = new URL(mediaUrl).pathname.split('/').pop();
    if (name) return decodeURIComponent(name);
  } catch {
    const name = mediaUrl.split('/').pop()?.split('?')[0];
    if (name) return decodeURIComponent(name);
  }
  return 'file';
}

function isAttachmentNotReady(status: number, body: string): boolean {
  return status === 400 && body.includes(MAX_ATTACHMENT_NOT_READY);
}

function extractMessageMid(data: UnknownRecord): string | undefined {
  const directBody = data['body'] as UnknownRecord | undefined;
  const directMid = directBody?.['mid'] ?? data['mid'] ?? data['message_id'];
  if (typeof directMid === 'string' && directMid.trim()) return directMid;

  const message = data['message'] as UnknownRecord | undefined;
  const messageBody = message?.['body'] as UnknownRecord | undefined;
  const nestedMid = messageBody?.['mid'] ?? message?.['mid'] ?? message?.['message_id'];
  return typeof nestedMid === 'string' && nestedMid.trim() ? nestedMid : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** chat_id may arrive as a string or a numeric id — normalize to a non-empty string. */
function readIdAsString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeVcfForHash(vcfInfo: string): string {
  return vcfInfo
    .replace(/\\r\\n/g, '\r\n')
    .replace(/\\n/g, '\n')
    .replace(/\r?\n/g, '\r\n');
}

function normalizeSharedPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  return phone.trim().startsWith('+') ? `+${digits}` : digits;
}

function unfoldVcf(vcfInfo: string): string {
  return normalizeVcfForHash(vcfInfo).replace(/\r?\n[ \t]/g, '');
}

function extractPhoneFromVcf(vcfInfo: string): string | undefined {
  const unfolded = unfoldVcf(vcfInfo);
  const telLine = unfolded
    .split(/\r?\n/)
    .find(line => /^TEL(?:;|:)/i.test(line));
  if (!telLine) return undefined;
  const separatorIndex = telLine.indexOf(':');
  if (separatorIndex === -1) return undefined;
  const rawPhone = telLine.slice(separatorIndex + 1).trim();
  return normalizeSharedPhone(rawPhone);
}

function extractMaxContactPayload(att: UnknownRecord): { vcfInfo?: string; hash?: string; phone?: string } {
  const payload = asRecord(att['payload']);
  const contact = asRecord(payload?.['contact']) ?? asRecord(att['contact']);
  const maxInfo = asRecord(payload?.['max_info']);

  const vcfInfo =
    readString(payload?.['vcf_info']) ??
    readString(payload?.['vcfInfo']) ??
    readString(contact?.['vcf_info']) ??
    readString(att['vcf_info']);
  const hash =
    readString(payload?.['hash']) ??
    readString(contact?.['hash']) ??
    readString(att['hash']);
  const directPhone =
    readString(payload?.['phone']) ??
    readString(payload?.['phone_number']) ??
    readString(payload?.['phoneNumber']) ??
    readString(maxInfo?.['phone']) ??
    readString(contact?.['phone']) ??
    readString(att['phone']);

  return {
    vcfInfo,
    hash,
    phone: directPhone ? normalizeSharedPhone(directPhone) : vcfInfo ? extractPhoneFromVcf(vcfInfo) : undefined,
  };
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidMaxContactHash(accessToken: string, vcfInfo: string, hash: string): boolean {
  const digest = crypto
    .createHmac('sha256', accessToken)
    .update(normalizeVcfForHash(vcfInfo))
    .digest();
  const candidates = [
    digest.toString('hex'),
    digest.toString('hex').toUpperCase(),
    digest.toString('base64'),
    digest.toString('base64url'),
  ];
  return candidates.some(candidate => timingSafeStringEqual(candidate, hash.trim()));
}

export class MaxAdapter implements ChannelAdapter {
  readonly channel = 'max' as const;

  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult {
    const { webhookSecret } = creds(account);
    if (!webhookSecret) return { valid: true }; // no secret configured → allow

    // Max sends the subscription secret in X-Max-Bot-Api-Secret.
    // Keep the legacy x-max-secret fallback for old local test hooks.
    const secret = req.headers['x-max-bot-api-secret'] || req.headers['x-max-secret'] || String(req.body['secret'] || '');
    if (!secret) return { valid: true }; // secret configured but not sent by Max → allow
    try {
      return { valid: crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(webhookSecret)) };
    } catch {
      return { valid: false };
    }
  }

  extractIdempotencyKey(body: UnknownRecord): string | null {
    const msg = body['message'] as UnknownRecord | undefined;
    const msgBody = msg?.['body'] as UnknownRecord | undefined;
    const mid = msgBody?.['mid'];
    return mid ? `max:${mid}` : null;
  }

  async parseInbound(
    body: UnknownRecord,
    _headers: Record<string, string> = {},
    account?: ChannelAccount,
  ): Promise<ParsedMessage[]> {
    const updateType = body['update_type'] as string;
    const isEdited = updateType === 'message_edited';
    if (updateType !== 'message_created' && !isEdited) return [];

    const message = body['message'] as UnknownRecord | undefined;
    if (!message) return [];

    const sender = message['sender'] as UnknownRecord | undefined;
    const recipient = message['recipient'] as UnknownRecord | undefined;
    const msgBody = message['body'] as UnknownRecord | undefined;

    const chatId = String(recipient?.['chat_id'] || '');
    const userId = sender?.['user_id'] as number;
    const userName = (sender?.['name'] as string) || `Max:${userId}`;
    const username = sender?.['username'] as string | undefined;
    const messageId = msgBody?.['mid'] as string;

    if (!chatId || !messageId) return [];

    // Forward / reply detection — must happen BEFORE content extraction,
    // because Max puts forwarded content in link.message, NOT in body.
    const link = message['link'] as UnknownRecord | undefined;
    const isForwarded = !!(link?.['type'] === 'forward');
    let forwardedFromName: string | undefined;
    if (isForwarded && link?.['sender']) {
      forwardedFromName = (link['sender'] as UnknownRecord)?.['name'] as string;
    }

    // Reply-to
    let replyToExternalId: string | undefined;
    if (link?.['type'] === 'reply' && link?.['message']) {
      const replyMsg = link['message'] as UnknownRecord;
      const replyMid = replyMsg['mid'] as string | undefined;
      if (replyMid) replyToExternalId = `max:${replyMid}`;
    }

    // Text & attachments — for forwarded messages, body is empty;
    // real content lives in link.message.text / link.message.attachments
    let rawText = (msgBody?.['text'] as string) || '';
    let effectiveAttachments = (msgBody?.['attachments'] || []) as Array<UnknownRecord>;

    if (isForwarded && link?.['message']) {
      const linkMessage = link['message'] as UnknownRecord;
      if (!rawText.trim()) {
        rawText = (linkMessage['text'] as string) || '';
      }
      if (effectiveAttachments.length === 0) {
        effectiveAttachments = (linkMessage['attachments'] || []) as Array<UnknownRecord>;
      }
    }

    const messageText = isEdited && rawText ? `[✏️ ред.] ${rawText}` : rawText;

    // Attachments — process ALL, not just first
    const attachments = effectiveAttachments;
    let content = messageText;
    let messageType: MessageType = 'text';
    const media: ParsedMediaRef[] = [];
    let contactPhone: string | undefined;

    for (const att of attachments) {
      const attType = att['type'] as string;
      const payload = att['payload'] as UnknownRecord | undefined;
      const payloadUrl = payload?.['url'] as string | undefined;
      const payloadToken = payload?.['token'] as string | undefined;

      switch (attType) {
        case 'image':
          // First media attachment determines messageType
          if (media.length === 0) {
            messageType = 'image';
            content = messageText || '[Фото]';
          }
          if (payloadUrl) {
            media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: 'image/jpeg', mediaTypeHint: 'image' });
          } else if (payloadToken) {
            media.push({ sourceRef: payloadToken, sourceType: 'max_token', mimeHint: 'image/jpeg', mediaTypeHint: 'image' });
          }
          break;
        case 'video':
          if (media.length === 0) {
            messageType = 'video';
            content = messageText || '[Видео]';
          }
          if (payloadUrl) {
            media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: 'video/mp4', mediaTypeHint: 'video' });
          } else if (payloadToken) {
            media.push({ sourceRef: payloadToken, sourceType: 'max_token', mimeHint: 'video/mp4', mediaTypeHint: 'video' });
          }
          break;
        case 'audio':
          if (media.length === 0) {
            messageType = 'audio';
            content = messageText || '[Голосовое сообщение]';
          }
          if (payloadUrl) {
            media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: 'audio/ogg', mediaTypeHint: 'audio' });
          } else if (payloadToken) {
            media.push({ sourceRef: payloadToken, sourceType: 'max_token', mimeHint: 'audio/ogg', mediaTypeHint: 'audio' });
          }
          break;
        case 'file': {
          const maxFileName = (payload?.['fileName'] || '') as string;

          // Reclassify file → image if filename has image extension
          let hint: MessageType = 'file';
          if (maxFileName) {
            const ext = maxFileName.split('.').pop()?.toLowerCase() ?? '';
            if (IMAGE_EXTS.has(ext)) hint = 'image';
          }

          if (media.length === 0) {
            messageType = hint;
            content = hint === 'image'
              ? (messageText || `[Фото: ${maxFileName}]`)
              : (messageText || `[Файл: ${maxFileName}]`);
          }
          const fileMime = mimeFromFilename(maxFileName || undefined) || 'application/octet-stream';
          if (payloadUrl) {
            media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: fileMime, fileName: maxFileName || undefined, mediaTypeHint: hint });
          } else if (payloadToken) {
            media.push({ sourceRef: payloadToken, sourceType: 'max_token', mimeHint: fileMime, fileName: maxFileName || undefined, mediaTypeHint: hint });
          }
          break;
        }
        case 'share': {
          // Share links (forwarded rich previews) — extract URL as text
          const shareUrl = payload?.['url'] as string | undefined;
          const shareTitle = (att['title'] as string) || '';
          if (shareUrl && !content.includes(shareUrl)) {
            content = content ? `${content}\n${shareUrl}` : shareUrl;
          } else if (shareTitle && !content.trim()) {
            content = `[Ссылка: ${shareTitle}]`;
          }
          break;
        }
        case 'contact': {
          messageType = 'contact';
          const contactPayload = extractMaxContactPayload(att);
          const accessToken = account ? creds(account).accessToken : '';
          const verified =
            !isForwarded &&
            !!accessToken &&
            !!contactPayload.phone &&
            !!contactPayload.vcfInfo &&
            !!contactPayload.hash &&
            isValidMaxContactHash(accessToken, contactPayload.vcfInfo, contactPayload.hash);

          if (verified) {
            contactPhone = contactPayload.phone;
            content = messageText || MAX_CONTACT_SHARED_TEXT;
          } else {
            content = messageText || MAX_UNVERIFIED_CONTACT_TEXT;
            log.warn('Unverified Max contact ignored', {
              hasHash: !!contactPayload.hash,
              hasVcfInfo: !!contactPayload.vcfInfo,
              hasPhone: !!contactPayload.phone,
              isForwarded,
              hasAccount: !!account,
            });
          }
          break;
        }
        case 'inline_keyboard':
          // Skip UI-only attachments (keyboards are not media)
          break;
        default:
          log.debug('Unknown Max attachment type', { attType });
          break;
      }
    }

    if (!content.trim()) return [];

    // Multiple media → separate ParsedMessage per attachment (like VK adapter).
    // Each gets a unique externalMessageId suffix so they are stored as individual messages.
    // Frontend groups consecutive images into a gallery automatically.
    if (media.length > 1) {
      const result: ParsedMessage[] = [];
      for (let i = 0; i < media.length; i++) {
        const ref = media[i];
        const suffix = `:${i}`;
        result.push({
          externalMessageId: `max:${messageId}${suffix}`,
          externalChatId: chatId,
          externalUserId: String(userId),
          userName,
          username,
          content: i === 0 ? content : `[${ref.mediaTypeHint === 'image' ? 'Фото' : ref.mediaTypeHint === 'video' ? 'Видео' : 'Файл'}]`,
          messageType: ref.mediaTypeHint as MessageType || messageType,
          phone: i === 0 ? contactPhone : undefined,
          media: [ref],
          isForwarded: i === 0 ? isForwarded : false,
          forwardedFromName: i === 0 ? forwardedFromName : undefined,
          replyToExternalId: i === 0 ? replyToExternalId : undefined,
        });
      }
      return result;
    }

    return [{
      externalMessageId: `max:${messageId}`,
      externalChatId: chatId,
      externalUserId: String(userId),
      userName,
      username,
      content,
      messageType,
      phone: contactPhone,
      media: media.length > 0 ? media : undefined,
      isForwarded,
      forwardedFromName,
      replyToExternalId,
    }];
  }

  parseStatusUpdate(_body: UnknownRecord): StatusUpdate[] {
    // Max doesn't provide delivery receipts
    return [];
  }

  isSpecialEvent(body: UnknownRecord): boolean {
    return body['update_type'] === 'message_callback';
  }

  async handleSpecialEvent(body: UnknownRecord, account: ChannelAccount): Promise<string | null> {
    if (body['update_type'] !== 'message_callback') return null;

    const callback = body['callback'] as UnknownRecord | undefined;
    if (!callback) return null;

    const callbackId = callback['callback_id'] as string;

    // Ack the callback to remove spinner on client side
    const c = creds(account);
    if (callbackId && c.accessToken) {
      const base = c.apiUrl || 'https://platform-api.max.ru';
      await fetchWithTimeout(`${base}/answers/callback?callback_id=${encodeURIComponent(callbackId)}`, {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({}),
      }).catch((err: unknown) => log.warn('callback ack failed', { error: String(err) }));
    }

    // Broadcast service buttons: «📍 Наши адреса» / «❌ Отписаться» / «🙋 Я не студент».
    // Parity with telegram.adapter.ts; the handler is dynamically imported to avoid
    // pulling the chat-broadcast notification graph into the adapter.
    // C4 (подтверждено на смоуке S8 2026-06-01): chat_id лежит в body.message.recipient.chat_id.
    // COALESCE по запасным путям оставлен как защита от вариаций формата.
    const payload = readString(callback['payload']);
    if (payload && isBroadcastCallback(payload)) {
      log.debug('max broadcast callback received', { payload });

      const message = asRecord(body['message']);
      const callbackMessage = asRecord(callback['message']);
      const chatId =
        readIdAsString(asRecord(message?.['recipient'])?.['chat_id']) ??
        readIdAsString(asRecord(callbackMessage?.['recipient'])?.['chat_id']) ??
        readIdAsString(callback['chat_id']) ??
        readIdAsString(body['chat_id']);

      if (chatId) {
        try {
          const { handleBroadcastCallback } = await import('../../broadcast/broadcast-callbacks.service.js');
          const res = await handleBroadcastCallback(String(chatId), String(payload), 'max');
          if (res?.ackText) {
            // ackText может нести Telegram-HTML (<b>) — MAX рендерит его при format:'html'
            // (тот же набор тегов <b>/<i>/…). parseMode='HTML' из обработчика → format:'html'.
            const format = res.parseMode === 'HTML' ? 'html' : undefined;
            await this.sendText(account, String(chatId), res.ackText, undefined, format)
              .catch((err: unknown) => log.warn('broadcast ack send failed', { error: String(err) }));
          }
        } catch (err) {
          log.error('broadcast callback handler error', { payload, error: String(err) });
        }
      } else {
        log.warn('max broadcast callback: chat_id not found in body', { payload });
      }
    }

    return 'ok';
  }

  async sendText(
    account: ChannelAccount,
    chatId: string,
    text: string,
    replyToExternalId?: string,
    format?: 'html' | 'markdown',
  ): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      const payload: UnknownRecord = { text };

      // Опциональная разметка: MAX рендерит <b>/<i>/… при format:'html' (подтверждено живым тестом).
      if (format) payload['format'] = format;

      // Support reply-to specific message (link.type=reply)
      if (replyToExternalId) {
        const mid = replyToExternalId.replace('max:', '');
        payload['link'] = { type: 'reply', mid };
      }

      const response = await fetchWithTimeout(messagesUrl(c, chatId), {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as UnknownRecord;
      const mid = extractMessageMid(data);
      return { success: true, externalMessageId: mid ? `max:${mid}` : undefined };
    });
  }

  async sendMedia(
    account: ChannelAccount,
    chatId: string,
    mediaUrl: string,
    mediaType: MessageType,
    caption?: string,
    fileName?: string,
    replyToExternalId?: string,
  ): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      let attType: string;
      switch (mediaType) {
        case 'image': attType = 'image'; break;
        case 'video': attType = 'video'; break;
        case 'audio': attType = 'audio'; break;
        default: attType = 'file';
      }

      // For video/audio/file, Max API requires token-based upload instead of URL
      let attPayload: UnknownRecord;
      if (attType !== 'image') {
        attPayload = await this.uploadMedia(mediaUrl, attType, fileName, c);
      } else {
        attPayload = { url: mediaUrl };
      }

      const payload: UnknownRecord = {
        attachments: [{ type: attType, payload: attPayload }],
      };
      if (caption) payload['text'] = caption;
      if (replyToExternalId) {
        const mid = replyToExternalId.replace('max:', '');
        payload['link'] = { type: 'reply', mid };
      }

      const response = await this.postMessageWithAttachmentRetry(c, chatId, payload);

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as UnknownRecord;
      const mid = extractMessageMid(data);
      return { success: true, externalMessageId: mid ? `max:${mid}` : undefined };
    });
  }

  /**
   * Upload media to Max platform and get a token for sending.
   *
   * Current MAX API is two-step:
   * 1. POST /uploads?type={image|video|audio|file} -> upload URL (+ optional token)
   * 2. multipart POST file bytes to that URL -> attachment payload
   * 3. POST /messages with the attachment payload from step 2
   */
  private async uploadMedia(
    mediaUrl: string,
    uploadType: string,
    fileName: string | undefined,
    c: MaxCredentials,
  ): Promise<UnknownRecord> {
    // Download the media from our CDN/S3 first
    const mediaResponse = await fetchWithTimeout(mediaUrl, { method: 'GET', timeout: 60_000 });
    if (!mediaResponse.ok) throw new Error(`Failed to download media for upload: ${mediaResponse.status}`);
    const buffer = Buffer.from(await mediaResponse.arrayBuffer());

    const uploadTarget = await this.createUploadTarget(uploadType, c);
    const formData = new FormData();
    formData.append('data', new Blob([buffer]), sanitizeUploadFileName(fileName, mediaUrl));

    const response = await fetchWithTimeout(
      uploadTarget.url,
      {
        method: 'POST',
        headers: { 'Authorization': c.accessToken },
        body: formData,
        timeout: 120_000,
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Max upload failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as UnknownRecord;
    const token = (typeof data['token'] === 'string' ? data['token'] : uploadTarget.token) || undefined;
    const payload = token ? { ...data, token } : data;
    if ((uploadType === 'video' || uploadType === 'audio') && !token) {
      throw new Error('Max upload response missing token');
    }
    if (Object.keys(payload).length === 0) throw new Error('Max upload response missing attachment payload');
    return payload;
  }

  private async createUploadTarget(uploadType: string, c: MaxCredentials): Promise<MaxUploadTarget> {
    const response = await fetchWithTimeout(
      uploadsUrl(c, uploadType),
      {
        method: 'POST',
        headers: { 'Authorization': c.accessToken },
        timeout: 30_000,
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Max upload URL failed (${response.status}): ${errText}`);
    }

    const data = await response.json() as UnknownRecord;
    const url = data['url'];
    if (typeof url !== 'string' || !url) throw new Error('Max upload URL response missing url');

    const token = typeof data['token'] === 'string' ? data['token'] : undefined;
    return { url, token };
  }

  private async postMessageWithAttachmentRetry(
    c: MaxCredentials,
    chatId: string,
    payload: UnknownRecord,
  ): Promise<Response> {
    let lastResponse: Response | null = null;

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      const response = await fetchWithTimeout(messagesUrl(c, chatId), {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify(payload),
      });

      if (response.ok) return response;

      const body = await response.text();
      if (!isAttachmentNotReady(response.status, body) || attempt === MAX_SEND_ATTEMPTS) {
        return new Response(body, { status: response.status, statusText: response.statusText });
      }

      lastResponse = new Response(body, { status: response.status, statusText: response.statusText });
      await sleep(attempt * 1500);
    }

    return lastResponse ?? new Response('Max attachment send failed', { status: 500 });
  }

  async sendWithInlineButton(
    account: ChannelAccount,
    chatId: string,
    text: string,
    buttonLabel: string,
    buttonUrl: string,
  ): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      const response = await fetchWithTimeout(messagesUrl(c, chatId), {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({
          text,
          attachments: [{
            type: 'inline_keyboard',
            payload: {
              buttons: [[{ type: 'link', text: buttonLabel, url: buttonUrl }]],
            },
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      return { success: true };
    });
  }

  /**
   * Broadcast send — ОДИН POST /messages с фото (по URL) + текст + inline-кнопки в едином
   * массиве attachments. Боевой тест подтвердил: image + inline_keyboard в одном attachments → HTTP 200.
   * Используется отдельным движком рассылок MAX (omni-broadcast трогать нельзя).
   */
  async sendBroadcast(
    account: ChannelAccount,
    chatId: string,
    mediaUrl: string,
    caption: string,
    buttons: Array<Array<{ type: 'link'; text: string; url: string } | { type: 'callback'; text: string; payload: string }>>,
  ): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      const attachments: UnknownRecord[] = [
        { type: 'image', payload: { url: mediaUrl } },
      ];
      if (buttons.length > 0) {
        attachments.push({ type: 'inline_keyboard', payload: { buttons } });
      }

      const payload: UnknownRecord = { text: caption, attachments };

      const response = await this.postMessageWithAttachmentRetry(c, chatId, payload);

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as UnknownRecord;
      const mid = extractMessageMid(data);
      return { success: true, externalMessageId: mid ? `max:${mid}` : undefined };
    });
  }

  async sendContactRequest(account: ChannelAccount, chatId: string): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    const { PHONE_REQUEST_TEXT } = await import('../../welcome-message.constants.js');

    return withCircuitBreaker('max', account.id, async () => {
      const response = await fetchWithTimeout(messagesUrl(c, chatId), {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({
          text: PHONE_REQUEST_TEXT,
          attachments: [{
            type: 'inline_keyboard',
            payload: {
              buttons: [[{ type: 'request_contact', text: 'Поделиться телефоном' }]],
            },
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as UnknownRecord;
      const mid = extractMessageMid(data);
      return { success: true, externalMessageId: mid ? `max:${mid}` : undefined };
    });
  }

  async deleteMessage(account: ChannelAccount, _chatId: string, externalMessageId: string): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      const mid = externalMessageId.replace(/^max:/, '');
      const response = await fetchWithTimeout(messageActionUrl(c, mid), {
        method: 'DELETE',
        headers: { 'Authorization': c.accessToken },
        timeout: 10_000,
      });

      if (!response.ok) {
        return { success: false, errorCode: String(response.status), errorMessage: await response.text() };
      }

      const data = await response.json().catch(() => ({})) as UnknownRecord;
      if (data['success'] === false) {
        const message = typeof data['message'] === 'string' ? data['message'] : 'MAX deleteMessage returned success=false';
        return { success: false, errorMessage: message };
      }

      return { success: true };
    });
  }

  async editMessageText(account: ChannelAccount, _chatId: string, externalMessageId: string, newText: string): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken) return { success: false, errorMessage: 'Access token not configured' };

    return withCircuitBreaker('max', account.id, async () => {
      const mid = externalMessageId.replace(/^max:/, '');
      const response = await fetchWithTimeout(messageActionUrl(c, mid), {
        method: 'PUT',
        headers: authHeaders(c),
        body: JSON.stringify({ text: newText }),
        timeout: 10_000,
      });

      if (!response.ok) {
        return { success: false, errorCode: String(response.status), errorMessage: await response.text() };
      }

      const data = await response.json().catch(() => ({})) as UnknownRecord;
      if (data['success'] === false) {
        const message = typeof data['message'] === 'string' ? data['message'] : 'MAX editMessageText returned success=false';
        return { success: false, errorMessage: message };
      }

      return { success: true, externalMessageId };
    });
  }

  async downloadMedia(ref: ParsedMediaRef, account: ChannelAccount): Promise<Buffer> {
    if (ref.sourceType === 'max_token') {
      // Token-based download: GET /uploads/{token}
      const c = creds(account);
      const base = c.apiUrl || 'https://platform-api.max.ru';
      const response = await fetchWithTimeout(
        `${base}/uploads/${encodeURIComponent(ref.sourceRef)}`,
        { method: 'GET', headers: { 'Authorization': c.accessToken }, timeout: 60_000 },
      );
      if (!response.ok) throw new Error(`Max token media download failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }

    // Direct CDN URL — simple fetch
    const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
    if (!response.ok) throw new Error(`Max media download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async downloadMediaStream(ref: ParsedMediaRef, account: ChannelAccount): Promise<Readable> {
    let response: Response;

    if (ref.sourceType === 'max_token') {
      const c = creds(account);
      const base = c.apiUrl || 'https://platform-api.max.ru';
      response = await fetchWithTimeout(
        `${base}/uploads/${encodeURIComponent(ref.sourceRef)}`,
        { method: 'GET', headers: { 'Authorization': c.accessToken }, timeout: 60_000 },
      );
      if (!response.ok) throw new Error(`Max token media download failed: ${response.status}`);
    } else {
      response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
      if (!response.ok) throw new Error(`Max media download failed: ${response.status}`);
    }

    if (!response.body) throw new Error('Response body is null');
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  async sendTypingIndicator(account: ChannelAccount, chatId: string): Promise<void> {
    const c = creds(account);
    if (!c.accessToken) return;

    const base = c.apiUrl || 'https://platform-api.max.ru';
    await fetchWithTimeout(
      `${base}/chats/${encodeURIComponent(chatId)}/actions`,
      {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({ action: 'typing_on' }),
      },
    ).catch((err: unknown) => log.warn('typing indicator failed', { chatId, error: String(err) }));
  }

  async markAsRead(account: ChannelAccount, chatId: string): Promise<void> {
    const c = creds(account);
    if (!c.accessToken) return;

    const base = c.apiUrl || 'https://platform-api.max.ru';
    await fetchWithTimeout(
      `${base}/chats/${encodeURIComponent(chatId)}/actions`,
      {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({ action: 'mark_seen' }),
      },
    ).catch((err: unknown) => log.warn('markAsRead failed', { chatId, error: String(err) }));
  }

  async sendWelcome(account: ChannelAccount, chatId: string): Promise<void> {
    const c = creds(account);
    if (!c.accessToken) return;

    try {
      const { getWelcomeHtml, WELCOME_BUTTONS } = await import('../../welcome-message.constants.js');
      const text = getWelcomeHtml().replace(/<\/?b>/g, '');
      const buttons = WELCOME_BUTTONS.map((b: { emoji: string; label: string; url: string }) => ({
        type: 'link' as const,
        text: `${b.emoji} ${b.label}`,
        url: b.url,
      }));

      await fetchWithTimeout(messagesUrl(c, chatId), {
        method: 'POST',
        headers: authHeaders(c),
        body: JSON.stringify({
          text,
          attachments: [{ type: 'inline_keyboard', payload: { buttons: [buttons] } }],
        }),
      });

      const contactRequest = await this.sendContactRequest(account, chatId);
      if (!contactRequest.success) {
        log.warn('Max contact request failed', { chatId, error: contactRequest.errorMessage });
      }
    } catch (err) {
      log.error('Welcome failed', { chatId, error: String(err) });
    }
  }

  async verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    const c = creds(account);
    if (!c.accessToken) return { ok: false, error: 'Access token not configured' };

    try {
      const base = c.apiUrl || 'https://platform-api.max.ru';
      const response = await fetchWithTimeout(
        `${base}/me`,
        { method: 'GET', headers: { 'Authorization': c.accessToken }, timeout: 10_000 },
      );
      if (response.ok) return { ok: true };
      const errBody = await response.text();
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Невалидный токен (${response.status}): ${errBody}` };
      }
      return { ok: false, error: `HTTP ${response.status}: ${errBody}` };
    } catch (err) {
      return { ok: false, error: `Network error: ${String(err)}` };
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: true,
      sendPhoto: true,
      sendFile: true,
      sendVideo: true,
      sendAudio: true,
      sendInlineButton: true,
      replyWindow24h: false,
      forwardDetection: true,
      replyToDetection: true,
      statusUpdates: false,
      typingIndicator: true,
      deleteMessage: true,
      editMessage: true,
      twoStepUpload: false,
      challengeResponse: false,
      confirmationHandshake: false,
      maxMediaSizeBytes: 50 * 1024 * 1024,
      maxTextLength: 4000,
    };
  }
}
