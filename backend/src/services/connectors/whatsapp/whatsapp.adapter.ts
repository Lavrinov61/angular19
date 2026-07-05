/**
 * Omnichannel v2 — WhatsApp Adapter
 *
 * Dual-mode: Meta Cloud API (direct) or Gupshup BSP.
 *
 * Gupshup BSP mode (provider: 'gupshup' in credentials):
 * - Receiving: Gupshup forwards webhooks in Meta format v3 (no HMAC)
 * - Sending: Gupshup API (api.gupshup.io/wa/api/v1/msg)
 * - Media download: direct URL from webhook (no auth needed)
 *
 * Meta Cloud API mode (default):
 * - Receiving: HMAC-SHA256 verified webhooks
 * - Sending: graph.facebook.com Graph API
 * - Media download: resolve media_id → Bearer-authenticated fetch
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
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('whatsapp-adapter');

const WA_API = 'https://graph.facebook.com/v21.0';
const GUPSHUP_API = 'https://api.gupshup.io/wa/api/v1';
const MAX_GUPSHUP_FILE_NAME_LENGTH = 120;

type JsonObject = { [key: string]: unknown };

interface WaCredentials {
  provider?: 'gupshup' | 'meta';
  // Meta Cloud API fields
  phoneNumberId: string;
  accessToken: string;
  verifyToken?: string;
  appSecret?: string;
  businessAccountId?: string;
  // Gupshup BSP fields
  apiKey?: string;
  appName?: string;
  sourcePhone?: string;
  wabaId?: string;
}

/** Type-safe extraction of WaCredentials from JSONB Record */
function parseCreds(raw: JsonObject): WaCredentials {
  return {
    provider: raw['provider'] === 'gupshup' ? 'gupshup' : undefined,
    phoneNumberId: String(raw['phoneNumberId'] ?? ''),
    accessToken: String(raw['accessToken'] ?? ''),
    verifyToken: typeof raw['verifyToken'] === 'string' ? raw['verifyToken'] : undefined,
    appSecret: typeof raw['appSecret'] === 'string' ? raw['appSecret'] : undefined,
    businessAccountId: typeof raw['businessAccountId'] === 'string' ? raw['businessAccountId'] : undefined,
    apiKey: typeof raw['apiKey'] === 'string' ? raw['apiKey'] : undefined,
    appName: typeof raw['appName'] === 'string' ? raw['appName'] : undefined,
    sourcePhone: typeof raw['sourcePhone'] === 'string' ? raw['sourcePhone'] : undefined,
    wabaId: typeof raw['wabaId'] === 'string' ? raw['wabaId'] : undefined,
  };
}

function isGupshup(c: WaCredentials): boolean {
  return c.provider === 'gupshup' || (!c.accessToken && !!c.apiKey);
}

async function readResponseJsonObject(response: Response): Promise<JsonObject> {
  const value: unknown = await response.json().catch(() => undefined);
  return asRecord(value) ?? {};
}

function isGupshupAuthFailure(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true;
  return /\b(auth|authentication|unauthori[sz]ed|api\s*key|apikey|token)\b/i.test(message);
}

/** Send message via Gupshup API */
async function gupshupSend(
  c: WaCredentials,
  destination: string,
  message: JsonObject,
): Promise<SendResult> {
  if (!c.apiKey || !c.sourcePhone) {
    return { success: false, errorMessage: 'Gupshup apiKey/sourcePhone not configured' };
  }

  const params = new URLSearchParams();
  params.set('channel', 'whatsapp');
  params.set('source', c.sourcePhone);
  params.set('destination', destination);
  params.set('src.name', c.appName || '');
  params.set('message', JSON.stringify(message));

  const response = await fetchWithTimeout(`${GUPSHUP_API}/msg`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'apikey': c.apiKey,
    },
    body: params.toString(),
  });

  const data = await response.json() as JsonObject;
  if (data['status'] === 'submitted') {
    return { success: true, externalMessageId: String(data['messageId'] || '') };
  }
  return {
    success: false,
    errorCode: String(response.status),
    errorMessage: String(data['message'] || data['status'] || 'Unknown Gupshup error'),
  };
}

/** Normalize phone: strip non-digits, 8xxx → 7xxx for Russian numbers */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) return '7' + digits.slice(1);
  return digits;
}

function asRecord(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function asRecordArray(value: unknown): Array<JsonObject> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonObject =>
    item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function parseWaTimestamp(value: unknown): Date {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) return new Date();
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
}

function waErrorMessage(error: JsonObject | undefined): string | undefined {
  const errorData = asRecord(error?.['error_data']);
  return stringValue(errorData?.['details'])
    ?? stringValue(error?.['message'])
    ?? stringValue(error?.['title']);
}

function fileExtensionFromValue(value: string | undefined): string {
  if (!value) return '';
  let path = value;
  try {
    path = new URL(value).pathname;
  } catch {
    // Plain filenames are accepted here.
  }

  const segment = path.split('/').pop() ?? '';
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(segment);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function sanitizeGupshupFileName(fileName: string | undefined, mediaUrl: string): string {
  const raw = fileName?.trim() || '';
  const extension = fileExtensionFromValue(raw) || fileExtensionFromValue(mediaUrl);
  const base = extension && raw.toLowerCase().endsWith(extension)
    ? raw.slice(0, -extension.length)
    : raw;
  const safeBase = base
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  const fallbackBase = safeBase || 'attachment';
  const maxBaseLength = Math.max(1, MAX_GUPSHUP_FILE_NAME_LENGTH - extension.length);
  return `${fallbackBase.slice(0, maxBaseLength)}${extension}`;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;

  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult {
    const c = parseCreds(account.credentials);

    // GET challenge-response (subscription verification)
    if (req.query?.['hub.mode'] === 'subscribe') {
      if (c.verifyToken && req.query['hub.verify_token'] === c.verifyToken) {
        return { valid: true, challengeResponse: req.query['hub.challenge'] || '' };
      }
      return { valid: false };
    }

    // Gupshup BSP: webhooks forwarded in Meta format v3 without HMAC signature.
    // Validate by checking that the payload has the expected Meta structure.
    if (isGupshup(c)) {
      const body = req.body ?? {};
      const entry = (body['entry'] ?? body['object']) as unknown;
      if (entry || body['object'] === 'whatsapp_business_account') {
        return { valid: true };
      }
      log.warn('Gupshup webhook missing expected Meta structure');
      return { valid: false };
    }

    // Meta Cloud API: POST HMAC-SHA256 verification
    if (!c.appSecret) return { valid: false };
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) return { valid: false };

    const expected = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(req.rawBody).digest('hex');
    try {
      return { valid: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) };
    } catch {
      return { valid: false };
    }
  }

  extractIdempotencyKey(body: JsonObject): string | null {
    const entry = (body['entry'] as Array<JsonObject>)?.[0];
    const change = (entry?.['changes'] as Array<JsonObject>)?.[0];
    const value = change?.['value'] as JsonObject | undefined;
    const messages = (value?.['messages'] || []) as Array<JsonObject>;
    const firstId = messages[0]?.['id'] as string | undefined;
    return firstId ? `wa:${firstId}` : null;
  }

  async parseInbound(body: JsonObject): Promise<ParsedMessage[]> {
    const entry = (body['entry'] as Array<JsonObject>)?.[0];
    const change = (entry?.['changes'] as Array<JsonObject>)?.[0];
    const value = change?.['value'] as JsonObject | undefined;
    if (!value || change?.['field'] !== 'messages') return [];

    const messages = (value['messages'] || []) as Array<JsonObject>;
    const contacts = (value['contacts'] || []) as Array<JsonObject>;
    const result: ParsedMessage[] = [];

    for (const msg of messages) {
      const waId = msg['from'] as string;
      const msgId = msg['id'] as string;
      const contact = contacts.find((c: JsonObject) => c['wa_id'] === waId);
      const userName = String((contact?.['profile'] as JsonObject)?.['name'] || `WA:${waId}`);

      let messageType: MessageType;
      let content: string;
      const media: ParsedMediaRef[] = [];

      switch (msg['type']) {
        case 'text':
          messageType = 'text';
          content = String((msg['text'] as JsonObject)?.['body'] || '');
          break;
        case 'image': {
          messageType = 'image';
          const imgObj = msg['image'] as JsonObject;
          content = imgObj?.['caption'] ? `[Фото] ${imgObj['caption']}` : '[Фото]';
          const imgId = imgObj?.['id'] as string | undefined;
          const imgUrl = imgObj?.['url'] as string | undefined;
          const imgMime = (imgObj?.['mime_type'] as string) || 'image/jpeg';
          if (imgId || imgUrl) {
            media.push({
              sourceRef: imgUrl || imgId!,
              sourceType: imgUrl ? 'url' : 'whatsapp_media_id',
              mimeHint: imgMime,
              mediaTypeHint: 'image',
            });
          }
          break;
        }
        case 'video': {
          messageType = 'video';
          const vidObj = msg['video'] as JsonObject;
          content = vidObj?.['caption'] ? `[Видео] ${vidObj['caption']}` : '[Видео]';
          const vidId = vidObj?.['id'] as string | undefined;
          const vidUrl = vidObj?.['url'] as string | undefined;
          const vidMime = (vidObj?.['mime_type'] as string) || 'video/mp4';
          if (vidId || vidUrl) {
            media.push({
              sourceRef: vidUrl || vidId!,
              sourceType: vidUrl ? 'url' : 'whatsapp_media_id',
              mimeHint: vidMime,
              mediaTypeHint: 'video',
            });
          }
          break;
        }
        case 'audio': {
          messageType = 'audio';
          content = '[Голосовое сообщение]';
          const audObj = msg['audio'] as JsonObject;
          const audId = audObj?.['id'] as string | undefined;
          const audUrl = audObj?.['url'] as string | undefined;
          const audMime = (audObj?.['mime_type'] as string) || 'audio/ogg';
          if (audId || audUrl) {
            media.push({
              sourceRef: audUrl || audId!,
              sourceType: audUrl ? 'url' : 'whatsapp_media_id',
              mimeHint: audMime,
              mediaTypeHint: 'audio',
            });
          }
          break;
        }
        case 'document': {
          messageType = 'file';
          const docObj = msg['document'] as JsonObject;
          const docName = docObj?.['filename'] as string | undefined;
          content = docName ? `[Файл: ${docName}]` : '[Документ]';
          const docId = docObj?.['id'] as string | undefined;
          const docUrl = docObj?.['url'] as string | undefined;
          const docMime = (docObj?.['mime_type'] as string) || 'application/octet-stream';
          if (docId || docUrl) {
            media.push({
              sourceRef: docUrl || docId!,
              sourceType: docUrl ? 'url' : 'whatsapp_media_id',
              mimeHint: docMime,
              fileName: docName,
              mediaTypeHint: 'file',
            });
          }
          break;
        }
        case 'sticker':
          messageType = 'sticker';
          content = '[Стикер]';
          break;
        case 'location': {
          messageType = 'location';
          const loc = msg['location'] as JsonObject;
          content = `[Местоположение: ${loc?.['name'] || 'без названия'}]`;
          break;
        }
        case 'button': {
          messageType = 'interactive';
          content = String((msg['button'] as JsonObject)?.['text'] || '[Кнопка]');
          break;
        }
        case 'interactive': {
          const interactive = msg['interactive'] as JsonObject;
          const interType = interactive?.['type'] as string;
          if (interType === 'button_reply') {
            const reply = interactive['button_reply'] as JsonObject;
            content = String(reply?.['title'] || '[Ответ на кнопку]');
          } else if (interType === 'list_reply') {
            const reply = interactive['list_reply'] as JsonObject;
            content = String(reply?.['title'] || '[Ответ из списка]');
          } else {
            content = '[Интерактивное сообщение]';
          }
          messageType = 'interactive';
          break;
        }
        case 'contacts': {
          messageType = 'contact';
          const contactsList = msg['contacts'] as Array<JsonObject>;
          const firstContact = contactsList?.[0];
          const name = firstContact?.['name'] as JsonObject;
          const phones = firstContact?.['phones'] as Array<JsonObject>;
          const displayName = name?.['formatted_name'] || 'Контакт';
          const phone = phones?.[0]?.['phone'] || '';
          content = `[Контакт: ${displayName}${phone ? ', ' + phone : ''}]`;
          break;
        }
        case 'reaction': {
          messageType = 'text';
          const reaction = msg['reaction'] as JsonObject;
          const emoji = reaction?.['emoji'] || '';
          content = emoji ? `[Реакция: ${emoji}]` : '[Реакция удалена]';
          break;
        }
        default:
          continue;
      }

      if (!content.trim()) continue;

      // Forward detection
      const isForwarded = !!(msg['forwarded'] ||
        (msg[msg['type'] as string] as JsonObject | undefined)?.['forwarded']);

      // Reply-to
      let replyToExternalId: string | undefined;
      const context = msg['context'] as JsonObject | undefined;
      if (context?.['id']) {
        replyToExternalId = String(context['id']);
      }

      result.push({
        externalMessageId: msgId,
        externalChatId: waId,
        externalUserId: waId,
        userName,
        phone: waId,
        content,
        messageType,
        media: media.length > 0 ? media : undefined,
        isForwarded,
        replyToExternalId,
      });
    }

    return result;
  }

  parseStatusUpdate(body: JsonObject): StatusUpdate[] {
    const entry = asRecordArray(body['entry'])[0];
    const change = asRecordArray(entry?.['changes'])[0];
    const value = asRecord(change?.['value']);
    if (!value) return [];

    const statuses = asRecordArray(value['statuses']);
    const result: StatusUpdate[] = [];

    for (const s of statuses) {
      const msgId = stringValue(s['gs_id']) ?? stringValue(s['id']);
      const status = stringValue(s['status']);
      if (!msgId || !status) continue;

      const mapped = mapWaStatus(status);
      if (!mapped) continue;

      const firstError = asRecordArray(s['errors'])[0];

      result.push({
        externalMessageId: msgId,
        status: mapped,
        timestamp: parseWaTimestamp(s['timestamp']),
        errorCode: firstError?.['code'] ? String(firstError['code']) : undefined,
        errorMessage: waErrorMessage(firstError),
      });
    }

    return result;
  }

  isSpecialEvent(_body: JsonObject): boolean {
    return false;
  }

  async handleSpecialEvent(_body: JsonObject, _account: ChannelAccount): Promise<string | null> {
    return null;
  }

  async sendText(account: ChannelAccount, chatId: string, text: string, replyToExternalId?: string): Promise<SendResult> {
    const c = parseCreds(account.credentials);
    const normalized = normalizePhone(chatId);

    if (isGupshup(c)) {
      return withCircuitBreaker('whatsapp', account.id, () =>
        gupshupSend(c, normalized, { type: 'text', text }),
      );
    }

    if (!c.phoneNumberId || !c.accessToken) {
      return { success: false, errorMessage: 'WhatsApp credentials not configured' };
    }

    return withCircuitBreaker('whatsapp', account.id, async () => {
      const payload: JsonObject = {
        messaging_product: 'whatsapp',
        to: normalized,
        type: 'text',
        text: { body: text, preview_url: false },
      };

      if (replyToExternalId) {
        payload['context'] = { message_id: replyToExternalId };
      }

      const response = await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as JsonObject;
      const msgId = (data['messages'] as Array<JsonObject>)?.[0]?.['id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
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
    const c = parseCreds(account.credentials);
    const normalized = normalizePhone(chatId);

    // Gupshup BSP: use Gupshup message API
    if (isGupshup(c)) {
      return withCircuitBreaker('whatsapp', account.id, () => {
        let gsMsg: JsonObject;
        switch (mediaType) {
          case 'image':
            gsMsg = { type: 'image', originalUrl: mediaUrl, previewUrl: mediaUrl, caption: caption || '' };
            break;
          case 'video':
            gsMsg = { type: 'video', url: mediaUrl, caption: caption || '' };
            break;
          case 'audio':
            gsMsg = { type: 'audio', url: mediaUrl };
            break;
          default:
            gsMsg = { type: 'file', url: mediaUrl, filename: sanitizeGupshupFileName(fileName, mediaUrl) };
            break;
        }
        return gupshupSend(c, normalized, gsMsg);
      });
    }

    if (!c.phoneNumberId || !c.accessToken) {
      return { success: false, errorMessage: 'WhatsApp credentials not configured' };
    }

    return withCircuitBreaker('whatsapp', account.id, async () => {
      let waType: string;
      let mediaPayload: JsonObject;

      switch (mediaType) {
        case 'image':
          waType = 'image';
          mediaPayload = { link: mediaUrl };
          if (caption) mediaPayload['caption'] = caption;
          break;
        case 'video':
          waType = 'video';
          mediaPayload = { link: mediaUrl };
          if (caption) mediaPayload['caption'] = caption;
          break;
        case 'audio':
          waType = 'audio';
          mediaPayload = { link: mediaUrl };
          break;
        default:
          waType = 'document';
          mediaPayload = { link: mediaUrl };
          if (fileName) mediaPayload['filename'] = fileName;
          if (caption) mediaPayload['caption'] = caption;
      }

      const body: JsonObject = {
        messaging_product: 'whatsapp',
        to: normalized,
        type: waType,
        [waType]: mediaPayload,
      };
      if (replyToExternalId) {
        body['context'] = { message_id: replyToExternalId };
      }

      const response = await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as JsonObject;
      const msgId = (data['messages'] as Array<JsonObject>)?.[0]?.['id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
    });
  }

  async downloadMedia(ref: ParsedMediaRef, account: ChannelAccount): Promise<Buffer> {
    if (ref.sourceType === 'url') {
      // Gupshup direct URL — no auth needed
      const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
      if (!response.ok) throw new Error(`WA media download failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }

    // Meta Cloud API: resolve media_id → download URL → Bearer-authenticated fetch
    const { accessToken } = parseCreds(account.credentials);
    if (!accessToken) throw new Error('WhatsApp access token not configured');

    const metaRes = await fetchWithTimeout(
      `${WA_API}/${ref.sourceRef}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const meta = await metaRes.json() as JsonObject;
    const downloadUrl = meta['url'] as string;
    if (!downloadUrl) throw new Error(`No url in media response for ${ref.sourceRef}`);

    // Download with retry
    const downloadFile = async (): Promise<Buffer> => {
      const res = await fetchWithTimeout(downloadUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 60_000,
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    };

    try {
      return await downloadFile();
    } catch (firstErr) {
      log.warn('Download failed, retrying in 2s', { mediaId: ref.sourceRef, error: String(firstErr) });
      await new Promise(r => setTimeout(r, 2000));
      return await downloadFile();
    }
  }

  async downloadMediaStream(ref: ParsedMediaRef, account: ChannelAccount): Promise<Readable> {
    if (ref.sourceType === 'url') {
      // Gupshup direct URL — no auth needed
      const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
      if (!response.ok) throw new Error(`WA media download failed: ${response.status}`);
      if (!response.body) throw new Error('Response body is null');
      return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    }

    // Meta Cloud API: resolve media_id → download URL → Bearer-authenticated stream
    const { accessToken } = parseCreds(account.credentials);
    if (!accessToken) throw new Error('WhatsApp access token not configured');

    const metaRes = await fetchWithTimeout(
      `${WA_API}/${ref.sourceRef}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const meta = await metaRes.json() as JsonObject;
    const downloadUrl = meta['url'] as string;
    if (!downloadUrl) throw new Error(`No url in media response for ${ref.sourceRef}`);

    const res = await fetchWithTimeout(downloadUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 60_000,
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    if (!res.body) throw new Error('Response body is null');
    return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  }

  async markAsRead(account: ChannelAccount, _chatId: string, messageId?: string): Promise<void> {
    if (!messageId) return;
    const c = parseCreds(account.credentials);

    // Gupshup BSP: mark-as-read not supported via their API
    if (isGupshup(c)) return;

    if (!c.phoneNumberId || !c.accessToken) return;

    try {
      await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    } catch (err) {
      log.warn('markAsRead failed', { messageId, error: String(err) });
    }
  }

  async sendWelcome(account: ChannelAccount, chatId: string): Promise<void> {
    try {
      const { getWelcomePlainText, PHONE_REQUEST_TEXT } = await import('../../welcome-message.constants.js');
      await this.sendText(account, chatId, getWelcomePlainText());
      // F70: Send phone request after welcome
      await this.sendText(account, chatId, PHONE_REQUEST_TEXT);
    } catch (err) {
      log.error('Welcome failed', { chatId, error: String(err) });
    }
  }

  async verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    const c = parseCreds(account.credentials);

    // Gupshup BSP: verify auth against the same endpoint used for delivery.
    // We omit destination/message so a valid key returns a validation error without sending.
    if (isGupshup(c)) {
      if (!c.apiKey) return { ok: false, error: 'Gupshup API key not configured' };
      if (!c.sourcePhone) return { ok: false, error: 'Gupshup sourcePhone not configured' };
      try {
        const params = new URLSearchParams();
        params.set('channel', 'whatsapp');
        params.set('source', c.sourcePhone);
        if (c.appName) params.set('src.name', c.appName);

        const response = await fetchWithTimeout(`${GUPSHUP_API}/msg`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apikey': c.apiKey,
          },
          body: params.toString(),
          timeout: 10_000,
        });
        if (response.ok) return { ok: true };
        const data = await readResponseJsonObject(response);
        const message = String(data['message'] || data['status'] || '').trim();
        if (response.status === 400 && !isGupshupAuthFailure(response.status, message)) {
          return { ok: true };
        }
        return {
          ok: false,
          error: `Gupshup credential check failed: HTTP ${response.status}${message ? ` ${message}` : ''}`,
        };
      } catch (err) {
        return { ok: false, error: `Gupshup network error: ${String(err)}` };
      }
    }

    if (!c.phoneNumberId || !c.accessToken) {
      return { ok: false, error: 'WhatsApp credentials not configured' };
    }

    try {
      const response = await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${c.accessToken}` },
        timeout: 10_000,
      });
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

  /**
   * Send a WhatsApp message template (HSM).
   * Used to initiate conversations outside the 24h reply window.
   */
  async sendTemplate(
    account: ChannelAccount,
    to: string,
    templateName: string,
    languageCode: string,
    components?: ReadonlyArray<JsonObject>,
  ): Promise<SendResult> {
    const c = parseCreds(account.credentials);
    const normalized = normalizePhone(to);

    // Gupshup BSP: template API
    if (isGupshup(c)) {
      if (!c.apiKey || !c.sourcePhone) {
        return { success: false, errorMessage: 'Gupshup apiKey/sourcePhone not configured' };
      }
      return withCircuitBreaker('whatsapp', account.id, async () => {
        const params = new URLSearchParams();
        params.set('channel', 'whatsapp');
        params.set('source', c.sourcePhone!);
        params.set('destination', normalized);
        params.set('src.name', c.appName || '');
        params.set('template', JSON.stringify({
          id: templateName,
          params: components?.flatMap(comp => {
            const parameters = comp['parameters'] as Array<JsonObject> | undefined;
            return parameters?.map(p => String(p['text'] || '')) ?? [];
          }) ?? [],
        }));

        const response = await fetchWithTimeout(`${GUPSHUP_API}/template/msg`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apikey': c.apiKey!,
          },
          body: params.toString(),
        });

        const data = await response.json() as JsonObject;
        if (data['status'] === 'submitted') {
          return { success: true, externalMessageId: String(data['messageId'] || '') };
        }
        return {
          success: false,
          errorCode: String(response.status),
          errorMessage: String(data['message'] || data['status'] || 'Gupshup template error'),
        };
      });
    }

    if (!c.phoneNumberId || !c.accessToken) {
      return { success: false, errorMessage: 'WhatsApp credentials not configured' };
    }

    return withCircuitBreaker('whatsapp', account.id, async () => {
      const payload: JsonObject = {
        messaging_product: 'whatsapp',
        to: normalized,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: components ?? [],
        },
      };

      const response = await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as JsonObject;
      const msgId = (data['messages'] as Array<JsonObject>)?.[0]?.['id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
    });
  }

  /**
   * Send interactive reply buttons (up to 3).
   * WhatsApp interactive message type=button with reply buttons.
   */
  async sendInteractiveButtons(
    account: ChannelAccount,
    to: string,
    bodyText: string,
    buttons: ReadonlyArray<{ id: string; title: string }>,
  ): Promise<SendResult> {
    const c = parseCreds(account.credentials);

    if (buttons.length === 0 || buttons.length > 3) {
      return { success: false, errorMessage: `WhatsApp supports 1-3 reply buttons, got ${buttons.length}` };
    }

    const normalized = normalizePhone(to);

    // Gupshup BSP: interactive buttons not supported via simple API, fallback to text
    if (isGupshup(c)) {
      const buttonText = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      return withCircuitBreaker('whatsapp', account.id, () =>
        gupshupSend(c, normalized, { type: 'text', text: `${bodyText}\n\n${buttonText}` }),
      );
    }

    if (!c.phoneNumberId || !c.accessToken) {
      return { success: false, errorMessage: 'WhatsApp credentials not configured' };
    }

    return withCircuitBreaker('whatsapp', account.id, async () => {
      const payload: JsonObject = {
        messaging_product: 'whatsapp',
        to: normalized,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map(btn => ({
              type: 'reply' as const,
              reply: { id: btn.id, title: btn.title },
            })),
          },
        },
      };

      const response = await fetchWithTimeout(`${WA_API}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as JsonObject;
      const msgId = (data['messages'] as Array<JsonObject>)?.[0]?.['id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
    });
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: true,
      sendPhoto: true,
      sendFile: true,
      sendVideo: true,
      sendAudio: true,
      sendInlineButton: false,
      replyWindow24h: true,
      forwardDetection: true,
      replyToDetection: true,
      statusUpdates: true,
      typingIndicator: false,
      deleteMessage: false,
      editMessage: false,
      twoStepUpload: false,
      challengeResponse: true,
      confirmationHandshake: false,
      maxMediaSizeBytes: 100 * 1024 * 1024,
      maxTextLength: 4096,
    };
  }
}

function mapWaStatus(status: string): StatusUpdate['status'] | null {
  switch (status) {
    case 'accepted': return 'accepted';
    case 'enqueued': return 'accepted';
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'read': return 'read';
    case 'failed': return 'failed';
    default: return null;
  }
}
