/**
 * Omnichannel v2 — Instagram Adapter
 *
 * Implements ChannelAdapter for Instagram DM via Meta Graph API.
 * HMAC SHA-256 verification identical to WhatsApp (same Meta platform).
 * Credentials from ChannelAccount. Inline sending logic.
 * Optional SOCKS5 proxy support.
 *
 * Messaging types (Instagram Messaging API):
 * - MESSAGE_TAG + tag: HUMAN_AGENT — works both within and outside 24h window (up to 7 days)
 * - RESPONSE — standard reply within 24h window
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
import { resolveIgUserName } from './ig.user-cache.js';

const log = createLogger('instagram-adapter');

const IG_API = 'https://graph.instagram.com/v21.0';

/** IG API error codes that indicate expired messaging window — not retryable */
const WINDOW_EXPIRED_CODES = new Set([10, 551]);

interface IgCredentials {
  accessToken: string;
  appSecret?: string;
  verifyToken?: string;
  businessAccountId: string;
  proxyUrl?: string;
}

function creds(account: ChannelAccount): IgCredentials {
  return account.credentials as unknown as IgCredentials;
}

/** Build fetch options with optional SOCKS proxy */
async function proxyOptions(c: IgCredentials): Promise<Record<string, unknown>> {
  if (!c.proxyUrl) return {};
  try {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    const agent = new SocksProxyAgent(c.proxyUrl);
    return { dispatcher: agent } as Record<string, unknown>;
  } catch {
    log.warn('socks-proxy-agent not available, using direct connection');
    return {};
  }
}

/**
 * Parse IG API error response and check if it's a window-expired error.
 * Returns { isWindowExpired, errorCode, errorMessage }.
 */
function parseIgApiError(responseText: string): {
  isWindowExpired: boolean;
  errorCode: number | null;
  errorMessage: string;
} {
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    const error = parsed['error'] as Record<string, unknown> | undefined;
    if (error) {
      const code = typeof error['code'] === 'number' ? error['code'] : null;
      const message = String(error['message'] ?? responseText);
      return {
        isWindowExpired: code !== null && WINDOW_EXPIRED_CODES.has(code),
        errorCode: code,
        errorMessage: message,
      };
    }
  } catch {
    // Not JSON — fall through
  }
  return { isWindowExpired: false, errorCode: null, errorMessage: responseText };
}

export class InstagramAdapter implements ChannelAdapter {
  readonly channel = 'instagram' as const;

  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult {
    const { verifyToken, appSecret } = creds(account);

    // GET challenge-response (subscription verification)
    if (req.query?.['hub.mode'] === 'subscribe') {
      if (verifyToken && req.query['hub.verify_token'] === verifyToken) {
        return { valid: true, challengeResponse: req.query['hub.challenge'] || '' };
      }
      return { valid: false };
    }

    // POST HMAC-SHA256
    if (!appSecret) return { valid: false };
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) return { valid: false };

    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    try {
      return { valid: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) };
    } catch {
      return { valid: false };
    }
  }

  extractIdempotencyKey(body: Record<string, unknown>): string | null {
    const entry = (body['entry'] as Array<Record<string, unknown>>)?.[0];
    const messaging = (entry?.['messaging'] || []) as Array<Record<string, unknown>>;
    const firstMsg = messaging[0]?.['message'] as Record<string, unknown> | undefined;
    const mid = firstMsg?.['mid'] as string | undefined;
    return mid ? `ig:${mid}` : null;
  }

  async parseInbound(body: Record<string, unknown>): Promise<ParsedMessage[]> {
    if (body['object'] !== 'instagram') return [];

    const entry = (body['entry'] as Array<Record<string, unknown>>)?.[0];
    if (!entry) return [];

    const messaging = (entry['messaging'] || []) as Array<Record<string, unknown>>;
    const result: ParsedMessage[] = [];

    for (const event of messaging) {
      const sender = event['sender'] as Record<string, unknown> | undefined;
      const senderId = sender?.['id'] as string;
      const msgObj = event['message'] as Record<string, unknown> | undefined;
      if (!senderId || !msgObj) continue;

      // Skip echo messages (sent by us)
      if (msgObj['is_echo']) continue;

      const msgId = msgObj['mid'] as string;
      if (!msgId) continue;

      let messageType: MessageType = 'text';
      let content = '';
      const media: ParsedMediaRef[] = [];

      // Text message
      if (msgObj['text']) {
        content = String(msgObj['text']);
      }

      // Attachments
      const attachments = (msgObj['attachments'] || []) as Array<Record<string, unknown>>;
      if (attachments.length > 0) {
        for (const att of attachments) {
          const attType = att['type'] as string;
          const payloadUrl = (att['payload'] as Record<string, unknown> | undefined)?.['url'] as string | undefined;
          const mimeMap: Record<string, string> = {
            image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg', file: 'application/octet-stream',
          };

          switch (attType) {
            case 'image':
              messageType = 'image';
              content = content ? `[Фото] ${content}` : '[Фото]';
              if (payloadUrl) {
                media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: mimeMap['image'], mediaTypeHint: 'image' });
              }
              break;
            case 'video':
              messageType = 'video';
              content = content ? `[Видео] ${content}` : '[Видео]';
              if (payloadUrl) {
                media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: mimeMap['video'], mediaTypeHint: 'video' });
              }
              break;
            case 'audio':
              messageType = 'audio';
              content = '[Голосовое сообщение]';
              if (payloadUrl) {
                media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: mimeMap['audio'], mediaTypeHint: 'audio' });
              }
              break;
            case 'file':
              messageType = 'file';
              content = '[Файл]';
              if (payloadUrl) {
                media.push({ sourceRef: payloadUrl, sourceType: 'url', mimeHint: mimeMap['file'], mediaTypeHint: 'file' });
              }
              break;
            case 'share':
              content = content || '[Пост из Instagram]';
              break;
            case 'story_mention':
              content = content || '[Упоминание в Stories]';
              break;
            default:
              content = content || `[${attType}]`;
          }
        }
      }

      if (!content.trim()) continue;

      // Reply-to detection
      let replyToExternalId: string | undefined;
      const replyTo = msgObj['reply_to'] as Record<string, unknown> | undefined;
      if (replyTo?.['mid']) {
        replyToExternalId = String(replyTo['mid']);
      }

      result.push({
        externalMessageId: msgId,
        externalChatId: senderId,
        externalUserId: senderId,
        userName: `IG:${senderId}`,
        content,
        messageType,
        media: media.length > 0 ? media : undefined,
        isForwarded: false,
        replyToExternalId,
      });
    }

    return result;
  }

  async enrichUserNames(messages: ParsedMessage[], account: ChannelAccount): Promise<void> {
    const { accessToken } = creds(account);
    if (!accessToken || messages.length === 0) return;

    // Collect unique user IDs that need resolution
    const userIds = new Set<string>();
    for (const msg of messages) {
      const match = msg.userName.match(/^IG:(\d+)$/);
      if (match) userIds.add(match[1]);
    }
    if (userIds.size === 0) return;

    // Resolve all names in parallel
    const resolved = new Map<string, { name: string; username?: string }>();
    await Promise.all(
      [...userIds].map(async (id) => {
        const profile = await resolveIgUserName(id, accessToken);
        resolved.set(id, profile);
      }),
    );

    // Mutate messages with resolved names
    for (const msg of messages) {
      const match = msg.userName.match(/^IG:(\d+)$/);
      if (match) {
        const profile = resolved.get(match[1]);
        if (profile) {
          msg.userName = profile.name;
          if (profile.username) {
            msg.username = profile.username;
          }
        }
      }
    }
  }

  parseStatusUpdate(_body: Record<string, unknown>): StatusUpdate[] {
    return [];
  }

  isSpecialEvent(_body: Record<string, unknown>): boolean {
    return false;
  }

  async handleSpecialEvent(_body: Record<string, unknown>, _account: ChannelAccount): Promise<string | null> {
    return null;
  }

  async sendText(account: ChannelAccount, chatId: string, text: string, replyToExternalId?: string): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken || !c.businessAccountId) {
      return { success: false, errorMessage: 'Instagram credentials not configured' };
    }

    return withCircuitBreaker('instagram', account.id, async () => {
      const opts = await proxyOptions(c);
      const message: Record<string, unknown> = { text };
      if (replyToExternalId) {
        message['reply_to'] = { mid: replyToExternalId };
      }
      const response = await fetchWithTimeout(`${IG_API}/${c.businessAccountId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: chatId },
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT',
          message,
        }),
        ...opts,
      });

      if (!response.ok) {
        const errText = await response.text();
        const igError = parseIgApiError(errText);

        if (igError.isWindowExpired) {
          log.warn('IG messaging window expired, not retrying', {
            chatId,
            errorCode: igError.errorCode,
            error: igError.errorMessage,
          });
          return {
            success: false,
            errorCode: 'WINDOW_EXPIRED',
            errorMessage: `Messaging window expired (code ${igError.errorCode}): ${igError.errorMessage}`,
          };
        }

        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as Record<string, unknown>;
      const msgId = data['message_id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
    });
  }

  async sendMedia(
    account: ChannelAccount,
    chatId: string,
    mediaUrl: string,
    mediaType: MessageType,
    _caption?: string,
    _fileName?: string,
    replyToExternalId?: string,
  ): Promise<SendResult> {
    const c = creds(account);
    if (!c.accessToken || !c.businessAccountId) {
      return { success: false, errorMessage: 'Instagram credentials not configured' };
    }

    return withCircuitBreaker('instagram', account.id, async () => {
      let attType: string;
      switch (mediaType) {
        case 'image': attType = 'image'; break;
        case 'video': attType = 'video'; break;
        case 'audio': attType = 'audio'; break;
        default: attType = 'file';
      }

      const opts = await proxyOptions(c);
      const message: Record<string, unknown> = {
        attachment: {
          type: attType,
          payload: { url: mediaUrl },
        },
      };
      if (replyToExternalId) {
        message['reply_to'] = { mid: replyToExternalId };
      }

      const response = await fetchWithTimeout(`${IG_API}/${c.businessAccountId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${c.accessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: chatId },
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT',
          message,
        }),
        ...opts,
      });

      if (!response.ok) {
        const errText = await response.text();
        const igError = parseIgApiError(errText);

        if (igError.isWindowExpired) {
          log.warn('IG messaging window expired, not retrying', {
            chatId,
            mediaType,
            errorCode: igError.errorCode,
            error: igError.errorMessage,
          });
          return {
            success: false,
            errorCode: 'WINDOW_EXPIRED',
            errorMessage: `Messaging window expired (code ${igError.errorCode}): ${igError.errorMessage}`,
          };
        }

        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as Record<string, unknown>;
      const msgId = data['message_id'] as string | undefined;
      return { success: true, externalMessageId: msgId };
    });
  }

  async downloadMedia(ref: ParsedMediaRef): Promise<Buffer> {
    // Instagram CDN URLs are temporary — download immediately
    const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
    if (!response.ok) throw new Error(`IG media download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async downloadMediaStream(ref: ParsedMediaRef): Promise<Readable> {
    const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
    if (!response.ok) throw new Error(`IG media download failed: ${response.status}`);
    if (!response.body) throw new Error('Response body is null');
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  async sendWelcome(account: ChannelAccount, chatId: string): Promise<void> {
    try {
      const { getWelcomePlainText, PHONE_REQUEST_TEXT } = await import('../../welcome-message.constants.js');
      await this.sendText(account, chatId, getWelcomePlainText());
      // F70: Send phone request after welcome
      await this.sendText(account, chatId, PHONE_REQUEST_TEXT);
    } catch (err: unknown) {
      log.error('Welcome failed', { chatId, error: String(err) });
    }
  }

  async verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    const c = creds(account);
    if (!c.accessToken || !c.businessAccountId) {
      return { ok: false, error: 'Instagram credentials not configured' };
    }

    try {
      const response = await fetchWithTimeout(
        `${IG_API}/${c.businessAccountId}?fields=id&access_token=${encodeURIComponent(c.accessToken)}`,
        { method: 'GET', timeout: 10_000 },
      );
      if (response.ok) return { ok: true };
      const errBody = await response.text();
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Невалидный токен (${response.status}): ${errBody}` };
      }
      return { ok: false, error: `HTTP ${response.status}: ${errBody}` };
    } catch (err: unknown) {
      return { ok: false, error: `Network error: ${String(err)}` };
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: false,
      sendPhoto: true,
      sendFile: true,
      sendVideo: false,
      sendAudio: false,
      sendInlineButton: false,
      replyWindow24h: true,
      forwardDetection: false,
      replyToDetection: true,
      statusUpdates: false,
      typingIndicator: false,
      deleteMessage: false,
      editMessage: false,
      twoStepUpload: false,
      challengeResponse: true,
      confirmationHandshake: false,
      maxMediaSizeBytes: 25 * 1024 * 1024,
      maxTextLength: 1000,
    };
  }
}
