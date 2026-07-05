/**
 * Omnichannel v2 — VK Adapter
 *
 * Implements ChannelAdapter for VK Callback API.
 * Credentials from ChannelAccount. Inline sending logic with 2-step upload for media.
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
import { resolveVkUserName } from './vk.user-cache.js';
import db from '../../../database/db.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('vk-adapter');

const VK_API = 'https://api.vk.com/method';
const VK_VERSION = '5.199';

/** Broadcast inline button: URL-кнопка или callback-кнопка (как у TG-движка). */
export interface VkBroadcastButton {
  text: string;
  url?: string;
  callback_data?: string;
}

/** VK keyboard action (inline). */
type VkKeyboardAction =
  | { type: 'open_link'; label: string; link: string }
  | { type: 'callback'; label: string; payload: string };

/** Контракт callback-обработчика рассылки (реализуется в S5, грузится dynamic import). */
interface VkBroadcastCallbacksModule {
  handleVkBroadcastCallback?: (peerId: number, payload: unknown) => Promise<{ snackbar?: string } | void>;
}

const VK_LABEL_MAX = 40;
const VK_PAYLOAD_MAX = 255;
const VK_BUTTONS_PER_ROW_MAX = 5;
const VK_ROWS_MAX = 6;

/**
 * Детерминированный random_id для messages.send из ключа идемпотентности.
 * sha256(key) → первые 4 байта как uint32 → диапазон VK (положительный int32 ≤ 2^31-1).
 * Стабилен между ретраями → VK дедуплицирует повторную отправку того же сообщения.
 */
export function deterministicRandomId(idempotencyKey: string): number {
  const hash = crypto.createHash('sha256').update(idempotencyKey).digest();
  // Берём 4 байта, маскируем старший бит → гарантированно [0, 2^31-1].
  return hash.readUInt32BE(0) & 0x7fff_ffff;
}

/**
 * Маппинг кнопок рассылки в VK inline-keyboard.
 * {text,url}→open_link; {text,callback_data}→callback (payload = JSON {cmd}).
 * Лимиты VK: label≤40, payload≤255, ≤5 кнопок/ряд, ≤6 рядов.
 */
export function mapBroadcastButtonsToVkKeyboard(
  buttons: VkBroadcastButton[][],
): { inline: true; buttons: Array<Array<{ action: VkKeyboardAction }>> } {
  const rows = buttons.slice(0, VK_ROWS_MAX).map((row) =>
    row.slice(0, VK_BUTTONS_PER_ROW_MAX).map((btn) => {
      const label = (btn.text || '').slice(0, VK_LABEL_MAX);
      if (btn.url) {
        return { action: { type: 'open_link' as const, label, link: btn.url } };
      }
      const payload = JSON.stringify({ cmd: btn.callback_data ?? '' }).slice(0, VK_PAYLOAD_MAX);
      return { action: { type: 'callback' as const, label, payload } };
    }),
  );
  return { inline: true, buttons: rows };
}

interface VkCredentials {
  groupToken: string;
  groupId?: string;
  confirmationCode?: string;
  secretKey?: string;
}

function creds(account: ChannelAccount): VkCredentials {
  return account.credentials as unknown as VkCredentials;
}

export class VkAdapter implements ChannelAdapter {
  readonly channel = 'vk' as const;

  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult {
    const { secretKey, confirmationCode } = creds(account);

    // VK confirmation handshake: type=confirmation → return confirmation code
    if (req.body['type'] === 'confirmation') {
      return { valid: true, confirmationCode: confirmationCode || '' };
    }

    // Normal webhook: if no secret configured, allow all
    if (!secretKey) return { valid: true };
    const bodySecret = req.body['secret'];
    if (!bodySecret || typeof bodySecret !== 'string') return { valid: true };
    try {
      return { valid: crypto.timingSafeEqual(Buffer.from(bodySecret), Buffer.from(secretKey)) };
    } catch {
      return { valid: false };
    }
  }

  extractIdempotencyKey(body: Record<string, unknown>): string | null {
    const type = body['type'] as string;
    const obj = body['object'] as Record<string, unknown> | undefined;

    // message_edit: object IS the message; message_new: object.message
    const msg = type === 'message_edit' ? obj : (obj?.['message'] as Record<string, unknown> | undefined);
    const msgId = msg?.['id'];
    if (msgId == null) return null;

    // For edits, suffix with :edit to avoid collision with the original message key
    return type === 'message_edit' ? `vk:${msgId}:edit` : `vk:${msgId}`;
  }

  /**
   * VK Callback API may truncate large messages (is_cropped: true),
   * dropping attachments beyond the first. Fetch full message via API.
   */
  async expandBody(body: Record<string, unknown>, account: ChannelAccount): Promise<Record<string, unknown>> {
    const eventType = body['type'] as string;
    if (eventType !== 'message_new' && eventType !== 'message_edit') return body;

    const obj = body['object'] as Record<string, unknown> | undefined;
    const msgObj = eventType === 'message_edit'
      ? obj
      : (obj?.['message'] as Record<string, unknown> | undefined);
    if (!msgObj || !msgObj['is_cropped']) return body;

    const messageId = msgObj['id'];
    if (messageId == null) return body;

    const { groupToken } = creds(account);
    if (!groupToken) return body;

    try {
      const params = new URLSearchParams({
        access_token: groupToken,
        message_ids: String(messageId),
        v: VK_VERSION,
      });
      const response = await fetchWithTimeout(
        `${VK_API}/messages.getById?${params.toString()}`,
        { method: 'GET', timeout: 10_000 },
      );
      if (!response.ok) {
        log.warn('expandBody: messages.getById HTTP error', { status: response.status, messageId });
        return body;
      }
      const data = await response.json() as Record<string, unknown>;
      if (data['error']) {
        const errObj = data['error'] as Record<string, unknown>;
        log.warn('expandBody: VK API error', { code: errObj['error_code'], msg: errObj['error_msg'] });
        return body;
      }
      const resp = data['response'] as Record<string, unknown> | undefined;
      const items = resp?.['items'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return body;

      const fullMsg = items[0];
      const fullAttachments = fullMsg['attachments'] as Array<Record<string, unknown>> | undefined;
      const croppedCount = (msgObj['attachments'] as Array<unknown> | undefined)?.length ?? 0;
      const fullCount = fullAttachments?.length ?? 0;

      log.info('expandBody: expanded cropped VK message', {
        messageId,
        croppedAttachments: croppedCount,
        fullAttachments: fullCount,
      });

      // Replace attachments + fwd_messages in the original body (deep clone to avoid mutation)
      const expanded = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      const expandedObj = expanded['object'] as Record<string, unknown>;
      const expandedMsg = eventType === 'message_edit'
        ? expandedObj
        : expandedObj['message'] as Record<string, unknown>;
      expandedMsg['attachments'] = fullAttachments ?? [];
      expandedMsg['fwd_messages'] = fullMsg['fwd_messages'] ?? [];
      expandedMsg['is_cropped'] = false;

      return expanded;
    } catch (err) {
      log.warn('expandBody: failed to fetch full message', { messageId, error: String(err) });
      return body;
    }
  }

  async parseInbound(body: Record<string, unknown>): Promise<ParsedMessage[]> {
    const eventType = body['type'] as string;
    if (eventType !== 'message_new' && eventType !== 'message_edit') return [];

    const obj = body['object'] as Record<string, unknown> | undefined;
    // message_edit: object IS the message directly; message_new: object.message
    const msgObj = eventType === 'message_edit'
      ? obj
      : (obj?.['message'] as Record<string, unknown> | undefined);
    if (!msgObj) return [];

    const peerId = msgObj['from_id'] as number;
    const eventId = String(msgObj['id'] || '');
    const isEdit = eventType === 'message_edit';
    const rawText = String(msgObj['text'] || '');
    const text = isEdit && rawText ? `[✏️ ред.] ${rawText}` : rawText;
    let attachments = (msgObj['attachments'] || []) as Array<Record<string, unknown>>;

    // Forward detection
    let isForwarded = false;
    let forwardedFromName: string | undefined;
    const fwdMessages = (msgObj['fwd_messages'] || []) as Array<Record<string, unknown>>;
    if (fwdMessages.length > 0) {
      isForwarded = true;
      const fwdFromId = fwdMessages[0]?.['from_id'] as number | undefined;
      if (fwdFromId && fwdFromId > 0) {
        forwardedFromName = `VK User ${fwdFromId}`;
      } else {
        forwardedFromName = 'Пользователь VK';
      }
      // Extract attachments from forwarded messages if root has none
      if (attachments.length === 0) {
        for (const fwd of fwdMessages) {
          const fwdAttachments = (fwd['attachments'] || []) as Array<Record<string, unknown>>;
          attachments = [...attachments, ...fwdAttachments];
        }
      }
    }

    // Reply-to detection
    let replyToExternalId: string | undefined;
    const replyMsg = msgObj['reply_message'] as Record<string, unknown> | undefined;
    if (replyMsg?.['id']) {
      replyToExternalId = `vk:${replyMsg['id']}`;
    }

    // Resolve user name (will be resolved with account token in pipeline, fallback here)
    const userName = `VK User ${peerId}`;

    // Separate media from non-media
    const mediaTypes = new Set(['photo', 'doc', 'audio_message', 'video', 'audio']);
    const mediaAttachments = attachments.filter(a => mediaTypes.has(a['type'] as string));
    const nonMediaAttachments = attachments.filter(a => !mediaTypes.has(a['type'] as string));

    const baseMsg = {
      externalChatId: String(peerId),
      externalUserId: String(peerId),
      userName,
      isForwarded,
      forwardedFromName,
      replyToExternalId,
    };

    // No media — single text message
    if (mediaAttachments.length === 0) {
      let content = text;
      if (!content && nonMediaAttachments.length > 0) {
        content = nonMediaAttachments.map(a => describeAttachment(a)).join(', ');
      }
      if (!content.trim()) return [];
      return [{
        ...baseMsg,
        externalMessageId: eventId ? `vk:${eventId}` : `vk:${Date.now()}`,
        content,
        messageType: 'text' as const,
      }];
    }

    // One or more media — separate message per media
    const result: ParsedMessage[] = [];

    for (let i = 0; i < mediaAttachments.length; i++) {
      const att = mediaAttachments[i];
      const attType = att['type'] as string;
      const suffix = mediaAttachments.length > 1 ? `:${i}` : '';
      const msgId = eventId ? `vk:${eventId}${suffix}` : `vk:${Date.now()}${suffix}`;

      let messageType: MessageType = 'text';
      let content: string;
      const media: ParsedMediaRef[] = [];

      switch (attType) {
        case 'photo': {
          messageType = 'image';
          content = '[Фото]';
          const photo = att['photo'] as Record<string, unknown> | undefined;
          const sizes = photo?.['sizes'] as Array<Record<string, unknown>> | undefined;
          if (sizes && sizes.length > 0) {
            const best = pickLargestVkPhotoSize(sizes);
            const url = best?.['url'] as string;
            if (url) {
              media.push({ sourceRef: url, sourceType: 'url', mimeHint: 'image/jpeg', mediaTypeHint: 'image' });
            }
          }
          break;
        }
        case 'doc': {
          messageType = 'file';
          const doc = att['doc'] as Record<string, unknown> | undefined;
          const docUrl = doc?.['url'] as string | undefined;
          const docTitle = doc?.['title'] as string | undefined;
          const docMime = (doc?.['mime_type'] as string) || 'application/octet-stream';
          content = `[Файл: ${docTitle || 'документ'}]`;
          if (docUrl) {
            media.push({ sourceRef: docUrl, sourceType: 'url', mimeHint: docMime, fileName: docTitle, mediaTypeHint: 'file' });
          }
          break;
        }
        case 'audio_message': {
          messageType = 'audio';
          content = '[Голосовое]';
          const am = att['audio_message'] as Record<string, unknown> | undefined;
          const amUrl = (am?.['link_ogg'] as string) || (am?.['link_mp3'] as string);
          if (amUrl) {
            const amMime = am?.['link_ogg'] ? 'audio/ogg' : 'audio/mpeg';
            media.push({ sourceRef: amUrl, sourceType: 'url', mimeHint: amMime, mediaTypeHint: 'audio' });
          }
          break;
        }
        case 'video': {
          messageType = 'video';
          const video = att['video'] as Record<string, unknown> | undefined;
          const videoTitle = video?.['title'] as string | undefined;
          content = videoTitle ? `[Видео: ${videoTitle}]` : '[Видео]';
          const playerUrl = video?.['player'] as string | undefined;
          if (playerUrl) {
            media.push({
              sourceRef: playerUrl,
              sourceType: 'url',
              mimeHint: 'text/html',
              mediaTypeHint: 'video',
              fileName: videoTitle,
            });
          }
          break;
        }
        case 'audio': {
          messageType = 'audio';
          const audio = att['audio'] as Record<string, unknown> | undefined;
          const audioArtist = audio?.['artist'] as string | undefined;
          const audioTitle = audio?.['title'] as string | undefined;
          const audioLabel = [audioArtist, audioTitle].filter(Boolean).join(' — ');
          content = audioLabel ? `[Аудио: ${audioLabel}]` : '[Аудио]';
          const audioUrl = audio?.['url'] as string | undefined;
          if (audioUrl) {
            media.push({
              sourceRef: audioUrl,
              sourceType: 'url',
              mimeHint: 'audio/mpeg',
              mediaTypeHint: 'audio',
            });
          }
          break;
        }
        default:
          content = `[${attType}]`;
      }

      // First message gets text body + non-media descriptions prepended
      if (i === 0 && text) {
        const nonMediaDesc = nonMediaAttachments.map(a => describeAttachment(a)).filter(Boolean);
        if (nonMediaDesc.length > 0) {
          content = `${content}\n${nonMediaDesc.join(', ')}\n${text}`;
        } else {
          content = `${content}\n${text}`;
        }
      }

      result.push({
        ...baseMsg,
        externalMessageId: msgId,
        content,
        messageType,
        media: media.length > 0 ? media : undefined,
      });
    }

    return result;
  }

  parseStatusUpdate(_body: Record<string, unknown>): StatusUpdate[] {
    return [];
  }

  isSpecialEvent(body: Record<string, unknown>): boolean {
    const type = body['type'] as string;
    return type === 'confirmation' || type === 'message_allow' || type === 'message_deny'
      || type === 'message_event';
  }

  async handleSpecialEvent(body: Record<string, unknown>, account: ChannelAccount): Promise<string | null> {
    const type = String(body['type'] || '');

    if (type === 'confirmation') {
      const { confirmationCode } = creds(account);
      return confirmationCode || '';
    }

    if (type === 'message_allow' || type === 'message_deny') {
      const eventObj = body['object'];
      if (typeof eventObj !== 'object' || eventObj === null || !('user_id' in eventObj)) return 'ok';
      const rawUserId = eventObj['user_id'];
      const userId = typeof rawUserId === 'number' ? rawUserId : undefined;
      if (!userId) return 'ok';

      const optedIn = type === 'message_allow';
      const { groupToken } = creds(account);

      let displayName = `VK User ${userId}`;
      try {
        displayName = await resolveVkUserName(userId, groupToken);
      } catch {
        // keep fallback
      }

      await db.query(
        `INSERT INTO channel_users (channel, external_user_id, display_name, opted_in, opted_in_at, opted_out_at)
         VALUES ('vk', $1, $2, $3, $4, $5)
         ON CONFLICT (channel, external_user_id) DO UPDATE SET
           display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), channel_users.display_name),
           opted_in = EXCLUDED.opted_in,
           opted_in_at = COALESCE(EXCLUDED.opted_in_at, channel_users.opted_in_at),
           opted_out_at = COALESCE(EXCLUDED.opted_out_at, channel_users.opted_out_at),
           last_seen_at = NOW()`,
        [
          String(userId),
          displayName,
          optedIn,
          optedIn ? new Date() : null,
          optedIn ? null : new Date(),
        ],
      );

      log.info('VK opt-in/out updated', { userId, optedIn, displayName });
      return 'ok';
    }

    if (type === 'message_event') {
      // Нажатие callback-кнопки рассылки. P0-2: webhook отвечает 'ok' ВСЕГДА,
      // бизнес-эффект (callback) выполняется ДО ack; ack — best-effort с таймаутом.
      const eventObj = body['object'];
      if (typeof eventObj !== 'object' || eventObj === null) return 'ok';
      const evt = eventObj as Record<string, unknown>;
      const userId = typeof evt['user_id'] === 'number' ? evt['user_id'] : undefined;
      const peerId = typeof evt['peer_id'] === 'number' ? evt['peer_id'] : undefined;
      const eventId = typeof evt['event_id'] === 'string' ? evt['event_id'] : undefined;
      const payload = evt['payload'];
      if (!userId || !peerId || !eventId) return 'ok';

      let snackbarText: string | undefined;
      try {
        // Файл создаёт S5. Путь строится из переменной, чтобы tsc не резолвил его
        // статически (модуль появится позже); реальный сбой ловит try/catch в рантайме.
        const cbModulePath = '../../broadcast/vk/vk-broadcast-callbacks.service.js';
        const mod: VkBroadcastCallbacksModule = await import(cbModulePath);
        if (typeof mod.handleVkBroadcastCallback === 'function') {
          const res = await mod.handleVkBroadcastCallback(peerId, payload);
          snackbarText = res?.snackbar;
        }
      } catch (err) {
        log.warn('message_event: callback handler failed', { peerId, error: String(err) });
      }

      // ack best-effort: НЕ валим webhook, возвращаем 'ok' в любом случае.
      const { groupToken } = creds(account);
      try {
        await this.sendMessageEventAnswer(groupToken, eventId, userId, peerId, snackbarText);
      } catch (err) {
        log.warn('message_event: sendMessageEventAnswer failed', { eventId, error: String(err) });
      }

      return 'ok';
    }

    return null;
  }

  /**
   * VK messages.sendMessageEventAnswer — подтверждение нажатия callback-кнопки.
   * event_data: показ снэкбара пользователю (если есть текст). Best-effort, с таймаутом ~2.5с.
   */
  private async sendMessageEventAnswer(
    token: string,
    eventId: string,
    userId: number,
    peerId: number,
    snackbarText?: string,
  ): Promise<void> {
    if (!token) return;
    const params = new URLSearchParams({
      access_token: token,
      event_id: eventId,
      user_id: String(userId),
      peer_id: String(peerId),
      v: VK_VERSION,
    });
    if (snackbarText) {
      params.set('event_data', JSON.stringify({ type: 'show_snackbar', text: snackbarText.slice(0, 90) }));
    }
    await fetchWithTimeout(
      `${VK_API}/messages.sendMessageEventAnswer?${params.toString()}`,
      { method: 'POST', timeout: 2_500 },
    );
  }

  async sendText(account: ChannelAccount, chatId: string, text: string, replyToExternalId?: string): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return { success: false, errorMessage: 'Invalid peer_id' };

    return withCircuitBreaker('vk', account.id, async () => {
      const randomId = Math.floor(Math.random() * 2_000_000_000);
      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        message: text,
        random_id: String(randomId),
        v: VK_VERSION,
      });

      // Support reply-to specific message
      if (replyToExternalId) {
        const msgId = replyToExternalId.replace('vk:', '');
        params.set('reply_to', msgId);
      }

      const response = await fetchWithTimeout(`${VK_API}/messages.send?${params.toString()}`, { method: 'POST' });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data['error']) {
        const errObj = data['error'] as Record<string, unknown>;
        return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
      }

      return { success: true, externalMessageId: data['response'] ? `vk:${data['response']}` : undefined };
    });
  }

  async sendMedia(
    account: ChannelAccount,
    chatId: string,
    mediaUrl: string,
    mediaType: MessageType,
    caption?: string,
    _fileName?: string,
    replyToExternalId?: string,
  ): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return { success: false, errorMessage: 'Invalid peer_id' };

    return withCircuitBreaker('vk', account.id, async () => {
      if (mediaType === 'image') {
        return this.sendPhotoInternal(groupToken, peerId, mediaUrl, caption, replyToExternalId);
      }
      return this.sendFileInternal(groupToken, peerId, mediaUrl, caption, replyToExternalId);
    });
  }

  async sendWithInlineButton(
    account: ChannelAccount,
    chatId: string,
    text: string,
    buttonLabel: string,
    buttonUrl: string,
  ): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return { success: false, errorMessage: 'Invalid peer_id' };

    return withCircuitBreaker('vk', account.id, async () => {
      const randomId = Math.floor(Math.random() * 2_000_000_000);
      const keyboard = {
        inline: true,
        buttons: [[{ action: { type: 'open_link' as const, label: buttonLabel, link: buttonUrl } }]],
      };

      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        message: text,
        random_id: String(randomId),
        keyboard: JSON.stringify(keyboard),
        v: VK_VERSION,
      });

      const response = await fetchWithTimeout(`${VK_API}/messages.send?${params.toString()}`, { method: 'POST' });
      if (!response.ok) {
        return { success: false, errorCode: String(response.status), errorMessage: await response.text() };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data['error']) {
        const errObj = data['error'] as Record<string, unknown>;
        return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
      }

      return { success: true, externalMessageId: data['response'] ? `vk:${data['response']}` : undefined };
    });
  }

  /**
   * Рассылочная отправка: фото (2-step upload) + подпись + inline-keyboard (URL+callback),
   * с ДЕТЕРМИНИРОВАННЫМ random_id из idempotencyKey (VK сам дедуплицирует ретраи).
   * Переиспользует upload-цепочку sendPhotoInternal; НЕ трогает живой sendMedia.
   */
  async sendMediaWithKeyboard(
    account: ChannelAccount,
    peerId: string,
    mediaUrl: string,
    caption: string | undefined,
    keyboard: VkBroadcastButton[][],
    idempotencyKey: string,
  ): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    const peer = parseInt(peerId, 10);
    if (isNaN(peer)) return { success: false, errorMessage: 'Invalid peer_id' };

    const vkKeyboard = mapBroadcastButtonsToVkKeyboard(keyboard);
    const randomId = deterministicRandomId(idempotencyKey);

    return withCircuitBreaker('vk', account.id, async () =>
      this.sendPhotoInternal(groupToken, peer, mediaUrl, caption, undefined, {
        keyboard: vkKeyboard,
        randomId,
      }),
    );
  }

  async deleteMessage(account: ChannelAccount, _chatId: string, externalMessageId: string): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    return withCircuitBreaker('vk', account.id, async () => {
      const msgId = externalMessageId.replace('vk:', '');
      const params = new URLSearchParams({
        access_token: groupToken,
        message_ids: msgId,
        delete_for_all: '1',
        v: VK_VERSION,
      });

      const response = await fetchWithTimeout(`${VK_API}/messages.delete?${params.toString()}`, { method: 'POST' });
      if (!response.ok) {
        return { success: false, errorCode: String(response.status), errorMessage: await response.text() };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data['error']) {
        const errObj = data['error'] as Record<string, unknown>;
        return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
      }

      return { success: true };
    });
  }

  async editMessageText(account: ChannelAccount, chatId: string, externalMessageId: string, newText: string): Promise<SendResult> {
    const { groupToken } = creds(account);
    if (!groupToken) return { success: false, errorMessage: 'Group token not configured' };

    return withCircuitBreaker('vk', account.id, async () => {
      const msgId = externalMessageId.replace('vk:', '');
      const peerId = parseInt(chatId, 10);
      if (isNaN(peerId)) {
        return { success: false, errorMessage: 'Invalid peer_id' };
      }

      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        message_id: msgId,
        message: newText,
        v: VK_VERSION,
      });

      const response = await fetchWithTimeout(`${VK_API}/messages.edit?${params.toString()}`, { method: 'POST' });
      if (!response.ok) {
        return { success: false, errorCode: String(response.status), errorMessage: await response.text() };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data['error']) {
        const errObj = data['error'] as Record<string, unknown>;
        return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
      }

      return { success: true, externalMessageId };
    });
  }

  async downloadMedia(ref: ParsedMediaRef): Promise<Buffer> {
    // VK provides direct CDN URLs for photos and temporary URLs for docs
    const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
    if (!response.ok) throw new Error(`VK media download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async downloadMediaStream(ref: ParsedMediaRef): Promise<Readable> {
    const response = await fetchWithTimeout(ref.sourceRef, { method: 'GET', timeout: 60_000 });
    if (!response.ok) throw new Error(`VK media download failed: ${response.status}`);
    if (!response.body) throw new Error('Response body is null');
    return Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  }

  async markAsRead(account: ChannelAccount, chatId: string): Promise<void> {
    const { groupToken } = creds(account);
    if (!groupToken) return;

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return;

    try {
      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        v: VK_VERSION,
      });
      await fetchWithTimeout(`${VK_API}/messages.markAsRead?${params.toString()}`, { method: 'POST' });
    } catch (err) {
      log.warn('markAsRead failed', { peerId, error: String(err) });
    }
  }

  async sendTypingIndicator(account: ChannelAccount, chatId: string): Promise<void> {
    const { groupToken } = creds(account);
    if (!groupToken) return;

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return;

    try {
      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        type: 'typing',
        v: VK_VERSION,
      });
      await fetchWithTimeout(`${VK_API}/messages.setActivity?${params.toString()}`, { method: 'POST' });
    } catch (err) {
      log.warn('sendTypingIndicator failed', { peerId, error: String(err) });
    }
  }

  async sendWelcome(account: ChannelAccount, chatId: string): Promise<void> {
    const { groupToken } = creds(account);
    if (!groupToken) return;

    const peerId = parseInt(chatId, 10);
    if (isNaN(peerId)) return;

    try {
      const { getWelcomeHtml, WELCOME_BUTTONS } = await import('../../welcome-message.constants.js');
      const randomId = Math.floor(Math.random() * 2_000_000_000);
      const keyboard = {
        inline: true,
        buttons: [
          WELCOME_BUTTONS.map((b: { emoji: string; label: string; url: string }) => ({
            action: { type: 'open_link', label: `${b.emoji} ${b.label}`, link: b.url },
          })),
        ],
      };

      const params = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        message: getWelcomeHtml().replace(/<\/?b>/g, ''),
        random_id: String(randomId),
        keyboard: JSON.stringify(keyboard),
        v: VK_VERSION,
      });

      await fetchWithTimeout(`${VK_API}/messages.send?${params.toString()}`, { method: 'POST' });

      // F70: Send phone request after welcome
      const { PHONE_REQUEST_TEXT } = await import('../../welcome-message.constants.js');
      const phoneRandomId = Math.floor(Math.random() * 2_000_000_000);
      const phoneParams = new URLSearchParams({
        access_token: groupToken,
        peer_id: String(peerId),
        message: PHONE_REQUEST_TEXT,
        random_id: String(phoneRandomId),
        v: VK_VERSION,
      });
      await fetchWithTimeout(`${VK_API}/messages.send?${phoneParams.toString()}`, { method: 'POST' });
    } catch (err) {
      log.error('Welcome failed', { chatId, error: String(err) });
    }
  }

  /**
   * Resolve VK user name using account's groupToken.
   * Exposed for pipeline use (enriching userName after parseInbound).
   */
  async resolveUserName(userId: number, account: ChannelAccount): Promise<string> {
    const { groupToken } = creds(account);
    return resolveVkUserName(userId, groupToken);
  }

  async enrichUserNames(messages: ParsedMessage[], account: ChannelAccount): Promise<void> {
    const { groupToken } = creds(account);
    if (!groupToken || messages.length === 0) return;

    // Collect unique user IDs from userName and forwardedFromName
    const userIds = new Set<number>();
    for (const msg of messages) {
      const match = msg.userName.match(/^VK User (\d+)$/);
      if (match) userIds.add(Number(match[1]));
      if (msg.forwardedFromName) {
        const fwdMatch = msg.forwardedFromName.match(/^VK User (\d+)$/);
        if (fwdMatch) userIds.add(Number(fwdMatch[1]));
      }
    }
    if (userIds.size === 0) return;

    // Resolve all names in parallel
    const resolved = new Map<number, string>();
    await Promise.all(
      [...userIds].map(async (id) => {
        const name = await resolveVkUserName(id, groupToken);
        resolved.set(id, name);
      }),
    );

    // Mutate messages with resolved names
    for (const msg of messages) {
      const match = msg.userName.match(/^VK User (\d+)$/);
      if (match) {
        const name = resolved.get(Number(match[1]));
        if (name) msg.userName = name;
      }
      if (msg.forwardedFromName) {
        const fwdMatch = msg.forwardedFromName.match(/^VK User (\d+)$/);
        if (fwdMatch) {
          const name = resolved.get(Number(fwdMatch[1]));
          if (name) msg.forwardedFromName = name;
        }
      }
    }
  }

  async verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    const { groupToken, groupId } = creds(account);
    if (!groupToken) return { ok: false, error: 'Group token not configured' };

    try {
      const params = new URLSearchParams({
        access_token: groupToken,
        v: VK_VERSION,
      });
      if (groupId) params.set('group_id', groupId);
      const response = await fetchWithTimeout(
        `${VK_API}/groups.getById?${params.toString()}`,
        { method: 'GET', timeout: 10_000 },
      );
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

      const data: { error?: { error_code?: number; error_msg?: string } } = await response.json();
      if (data.error) {
        return { ok: false, error: `VK API ${data.error.error_code}: ${data.error.error_msg}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Network error: ${String(err)}` };
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: true,
      sendPhoto: true,
      sendFile: true,
      sendVideo: false,
      sendAudio: false,
      sendInlineButton: true,
      replyWindow24h: false,
      forwardDetection: true,
      replyToDetection: true,
      statusUpdates: false,
      typingIndicator: true,
      deleteMessage: true,
      editMessage: true,
      twoStepUpload: true,
      challengeResponse: false,
      confirmationHandshake: true,
      maxMediaSizeBytes: 200 * 1024 * 1024,
      maxTextLength: 4096,
    };
  }

  // --- Internal VK 2-step upload helpers ---

  private async sendPhotoInternal(
    token: string,
    peerId: number,
    photoUrl: string,
    caption?: string,
    replyToExternalId?: string,
    opts?: { keyboard?: { inline: true; buttons: unknown[] }; randomId?: number },
  ): Promise<SendResult> {
    // 1. Get upload server
    const uploadServerParams = new URLSearchParams({
      access_token: token, peer_id: String(peerId), v: VK_VERSION,
    });
    const uploadServerRes = await fetchWithTimeout(
      `${VK_API}/photos.getMessagesUploadServer?${uploadServerParams.toString()}`, { method: 'POST' },
    );
    const uploadServerData = await uploadServerRes.json() as Record<string, unknown>;
    const uploadUrl = (uploadServerData['response'] as Record<string, unknown>)?.['upload_url'] as string;
    if (!uploadUrl) {
      // Fallback: send URL as text
      return this.sendTextFallback(token, peerId, caption ? `${caption}\n${photoUrl}` : photoUrl);
    }

    // 2. Download photo
    const photoRes = await fetchWithTimeout(photoUrl);
    const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
    const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';

    // 3. Upload to VK
    const formData = new FormData();
    formData.append('photo', new Blob([photoBuffer], { type: contentType }), `photo.${ext}`);
    const uploadRes = await fetchWithTimeout(uploadUrl, { method: 'POST', body: formData as unknown as BodyInit });
    const uploadData = await uploadRes.json() as Record<string, unknown>;

    // 4. Save photo
    const saveParams = new URLSearchParams({
      access_token: token,
      photo: String(uploadData['photo'] || ''),
      server: String(uploadData['server'] || ''),
      hash: String(uploadData['hash'] || ''),
      v: VK_VERSION,
    });
    const saveRes = await fetchWithTimeout(`${VK_API}/photos.saveMessagesPhoto?${saveParams.toString()}`, { method: 'POST' });
    const saveData = await saveRes.json() as Record<string, unknown>;
    const saved = (saveData['response'] as Array<Record<string, unknown>>)?.[0];
    if (!saved) {
      return this.sendTextFallback(token, peerId, caption ? `${caption}\n${photoUrl}` : photoUrl);
    }

    // 5. Send with attachment
    const attachment = `photo${saved['owner_id']}_${saved['id']}`;
    const randomId = opts?.randomId ?? Math.floor(Math.random() * 2_000_000_000);
    const sendParams = new URLSearchParams({
      access_token: token, peer_id: String(peerId), attachment, random_id: String(randomId), v: VK_VERSION,
    });
    if (caption) sendParams.set('message', caption);
    if (opts?.keyboard) sendParams.set('keyboard', JSON.stringify(opts.keyboard));
    if (replyToExternalId) {
      const msgId = replyToExternalId.replace('vk:', '');
      sendParams.set('reply_to', msgId);
    }

    const sendRes = await fetchWithTimeout(`${VK_API}/messages.send?${sendParams.toString()}`, { method: 'POST' });
    if (!sendRes.ok) {
      return { success: false, errorCode: String(sendRes.status), errorMessage: await sendRes.text() };
    }
    const sendData = await sendRes.json() as Record<string, unknown>;
    if (sendData['error']) {
      const errObj = sendData['error'] as Record<string, unknown>;
      return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
    }
    return { success: true, externalMessageId: sendData['response'] ? `vk:${sendData['response']}` : undefined };
  }

  private async sendFileInternal(
    token: string,
    peerId: number,
    fileUrl: string,
    caption?: string,
    replyToExternalId?: string,
  ): Promise<SendResult> {
    // 1. Get upload server
    const uploadServerParams = new URLSearchParams({
      access_token: token, peer_id: String(peerId), type: 'doc', v: VK_VERSION,
    });
    const uploadServerRes = await fetchWithTimeout(
      `${VK_API}/docs.getMessagesUploadServer?${uploadServerParams.toString()}`, { method: 'POST' },
    );
    const uploadServerData = await uploadServerRes.json() as Record<string, unknown>;
    const uploadUrl = (uploadServerData['response'] as Record<string, unknown>)?.['upload_url'] as string;
    if (!uploadUrl) {
      return this.sendTextFallback(token, peerId, caption ? `${caption}\n${fileUrl}` : fileUrl);
    }

    // 2. Download file
    const fileRes = await fetchWithTimeout(fileUrl);
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    // 3. Upload to VK
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), 'document');
    const uploadRes = await fetchWithTimeout(uploadUrl, { method: 'POST', body: formData as unknown as BodyInit });
    const uploadData = await uploadRes.json() as Record<string, unknown>;
    const file = uploadData['file'] as string;
    if (!file) {
      return this.sendTextFallback(token, peerId, caption ? `${caption}\n${fileUrl}` : fileUrl);
    }

    // 4. Save doc
    const saveParams = new URLSearchParams({ access_token: token, file, v: VK_VERSION });
    const saveRes = await fetchWithTimeout(`${VK_API}/docs.save?${saveParams.toString()}`, { method: 'POST' });
    const saveData = await saveRes.json() as Record<string, unknown>;
    const savedDoc = (saveData['response'] as Record<string, unknown>)?.['doc'] as Record<string, unknown> | undefined;
    if (!savedDoc) {
      return this.sendTextFallback(token, peerId, caption ? `${caption}\n${fileUrl}` : fileUrl);
    }

    // 5. Send with attachment
    const attachment = `doc${savedDoc['owner_id']}_${savedDoc['id']}`;
    const randomId = Math.floor(Math.random() * 2_000_000_000);
    const sendParams = new URLSearchParams({
      access_token: token, peer_id: String(peerId), attachment, random_id: String(randomId), v: VK_VERSION,
    });
    if (caption) sendParams.set('message', caption);
    if (replyToExternalId) {
      const msgId = replyToExternalId.replace('vk:', '');
      sendParams.set('reply_to', msgId);
    }

    const sendRes = await fetchWithTimeout(`${VK_API}/messages.send?${sendParams.toString()}`, { method: 'POST' });
    if (!sendRes.ok) {
      return { success: false, errorCode: String(sendRes.status), errorMessage: await sendRes.text() };
    }
    const sendData = await sendRes.json() as Record<string, unknown>;
    if (sendData['error']) {
      const errObj = sendData['error'] as Record<string, unknown>;
      return { success: false, errorCode: String(errObj['error_code'] || ''), errorMessage: String(errObj['error_msg'] || '') };
    }
    return { success: true, externalMessageId: sendData['response'] ? `vk:${sendData['response']}` : undefined };
  }

  private async sendTextFallback(token: string, peerId: number, text: string): Promise<SendResult> {
    const randomId = Math.floor(Math.random() * 2_000_000_000);
    const params = new URLSearchParams({
      access_token: token, peer_id: String(peerId), message: text, random_id: String(randomId), v: VK_VERSION,
    });
    const response = await fetchWithTimeout(`${VK_API}/messages.send?${params.toString()}`, { method: 'POST' });
    return { success: response.ok };
  }
}

/**
 * VK photo size types ordered by resolution (descending).
 * w=2560, z=1080, y=807, x=604, r=510crop, q=320crop, p=200crop, o=130crop, m=130, s=75.
 * VK API returns sizes[] in arbitrary order — we must pick the largest explicitly.
 */
const VK_PHOTO_SIZE_PRIORITY: readonly string[] = ['w', 'z', 'y', 'x', 'r', 'q', 'p', 'o', 'm', 's'];

export function pickLargestVkPhotoSize(sizes: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  // Try by type priority first (most reliable)
  for (const sizeType of VK_PHOTO_SIZE_PRIORITY) {
    const match = sizes.find(s => s['type'] === sizeType);
    if (match) return match;
  }
  // Fallback: pick by largest width*height
  let best: Record<string, unknown> | undefined;
  let bestArea = 0;
  for (const s of sizes) {
    const w = typeof s['width'] === 'number' ? s['width'] : 0;
    const h = typeof s['height'] === 'number' ? s['height'] : 0;
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = s;
    }
  }
  return best ?? sizes[0];
}

function describeAttachment(a: Record<string, unknown>): string {
  switch (a['type']) {
    case 'sticker': return '[Стикер]';
    case 'link': {
      const link = a['link'] as Record<string, unknown> | undefined;
      return `[Ссылка: ${link?.['title'] || link?.['url'] || ''}]`;
    }
    default: return `[${a['type']}]`;
  }
}
