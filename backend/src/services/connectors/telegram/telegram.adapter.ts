/**
 * Omnichannel v2 — Telegram Adapter
 *
 * Implements ChannelAdapter for Telegram Bot API.
 * Credentials from ChannelAccount (NOT config singleton).
 * Media returned as ParsedMediaRef[] — S3 upload handled by media-service.
 */

import crypto from 'crypto';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { Readable } from 'stream';
import FormDataNode from 'form-data';
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
import {
  enforceStreamTimeout,
  readResponseBufferWithTimeout,
} from '../../../utils/stream-utils.js';
import { config } from '../../../config/index.js';
import db from '../../../database/db.js';
import { createLogger } from '../../../utils/logger.js';
import { cacheSet, cacheGet } from '../../redis-cache.service.js';
import { mpQuery } from '../../../database/mp-db.js';
import { tgStartEventsTotal } from '../../metrics.service.js';
import type { TelegramBookingCallbackRow } from '../../../types/views/chat-views.js';
import {
  gateTelegramInboundMessage,
  handleTelegramSubscriptionGateCallback,
  isTelegramSubscriptionGateCallback,
} from './telegram-subscription-gate.service.js';

const log = createLogger('telegram-adapter');

const TG_API = config.telegram.apiUrl;
const TELEGRAM_MEDIA_IDLE_TIMEOUT_MS = 60_000;
const TELEGRAM_MEDIA_TOTAL_TIMEOUT_MS = 10 * 60_000;

/** Local Bot API Server returns absolute file paths instead of URLs */
const isLocalServer = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(TG_API);

interface TgCredentials {
  botToken: string;
  webhookSecret?: string;
  botUsername?: string;
}

interface TelegramObject {
  [key: string]: unknown;
}

interface TelegramUserPayload extends TelegramObject {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
}

interface TelegramWebhookPayload extends TelegramObject {
  update_id?: unknown;
  message?: unknown;
  edited_message?: unknown;
  callback_query?: unknown;
  my_chat_member?: unknown;
}

function hasTgCredentials(credentials: ChannelAccount['credentials']): credentials is ChannelAccount['credentials'] & TgCredentials {
  return typeof credentials['botToken'] === 'string'
    && (credentials['webhookSecret'] == null || typeof credentials['webhookSecret'] === 'string')
    && (credentials['botUsername'] == null || typeof credentials['botUsername'] === 'string');
}

function creds(account: ChannelAccount): TgCredentials {
  if (!hasTgCredentials(account.credentials)) {
    throw new Error('Telegram credentials are missing botToken');
  }
  return account.credentials;
}

function apiUrl(token: string, method: string): string {
  return `${TG_API}/bot${token}/${method}`;
}

/**
 * Ярлыки осиротевших reply-клавиатур от прежних (legacy) слоёв бота.
 * Текущая система эти клавиатуры не ставит и не обрабатывает; у старых клиентов они
 * персистентно висят в Telegram, и тап шлёт этот текст как обычное сообщение → флуд
 * оператору. Фичи сняты: распознаём текст и гасим клавиатуру (remove_keyboard).
 *   • «Завершить чат»  — кнопка завершения диалога;
 *   • «❌ Не сейчас»    — отказ из старой формы запроса телефона.
 * Reply-клавиатуру нельзя снять «тихо» или массово (Bot API: только новым сообщением
 * с ReplyKeyboardRemove), поэтому гасим реактивно — в ответ на сам тап клиента.
 */
const ORPHAN_KEYBOARD_LABELS: readonly string[] = ['Завершить чат', '❌ Не сейчас'];

function isOrphanKeyboardText(text: string): boolean {
  return ORPHAN_KEYBOARD_LABELS.includes(text.trim());
}

function resolveWebhookUrl(account: ChannelAccount, baseUrl: string): string {
  const configuredUrl = process.env['TELEGRAM_WEBHOOK_URL']?.trim() || account.webhookUrl?.trim();
  if (configuredUrl) return configuredUrl;

  // Local Server delivers webhooks to localhost, so no public URL is required.
  const webhookBase = isLocalServer
    ? `http://localhost:${config.server.port}`
    : baseUrl;
  return `${webhookBase.replace(/\/+$/, '')}/api/webhooks/telegram`;
}

function isPermanentPollingMode(): boolean {
  const mode = (
    process.env['TELEGRAM_POLLING_MODE']
    || process.env['TELEGRAM_POLLING_FALLBACK_MODE']
    || ''
  ).trim().toLowerCase();
  return mode === 'always' || mode === 'polling' || mode === 'permanent' || mode === 'force';
}

function extractUserName(from: TelegramUserPayload | undefined): string {
  if (!from) return 'Telegram';
  const first = String(from['first_name'] || '');
  const last = String(from['last_name'] || '');
  return (first + ' ' + last).trim() || String(from['username'] || 'Telegram');
}

type DeepLinkUtm = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

// Parse Telegram /start payload into UTM params.
// Supported formats:
//   "campaign_name"                 → utm_campaign=campaign_name, utm_source=telegram, utm_medium=messenger
//   "utm_source-utm_medium-campaign" → split by hyphen, positional
//   "key=val_key=val"                → pipe-delimited key=value pairs (Telegram limits payload to [A-Za-z0-9_-])
function parseDeepLinkPayload(payload: string): DeepLinkUtm {
  const trimmed = payload.trim();
  if (!trimmed) return {};

  // key=val pairs separated by _ (Telegram allows only [A-Za-z0-9_-], so we use - as kv separator)
  if (trimmed.includes('-') && /[a-z]+-[\w\d]+/i.test(trimmed)) {
    const parts = trimmed.split('_');
    const utm: DeepLinkUtm = {};
    for (const p of parts) {
      const idx = p.indexOf('-');
      if (idx <= 0) continue;
      const k = p.slice(0, idx).toLowerCase();
      const v = p.slice(idx + 1);
      if (!v) continue;
      if (k === 'src' || k === 'source') utm.utm_source = v;
      else if (k === 'med' || k === 'medium') utm.utm_medium = v;
      else if (k === 'cmp' || k === 'campaign') utm.utm_campaign = v;
      else if (k === 'cnt' || k === 'content') utm.utm_content = v;
      else if (k === 'trm' || k === 'term') utm.utm_term = v;
    }
    if (utm.utm_campaign || utm.utm_source) {
      utm.utm_source = utm.utm_source || 'telegram';
      utm.utm_medium = utm.utm_medium || 'messenger';
      return utm;
    }
  }

  // Fallback: plain campaign name
  return {
    utm_source: 'telegram',
    utm_medium: 'messenger',
    utm_campaign: trimmed.slice(0, 100),
  };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const;

  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult {
    const { webhookSecret } = creds(account);
    if (!webhookSecret) return { valid: false };
    const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (!headerSecret) return { valid: false };
    try {
      return { valid: crypto.timingSafeEqual(Buffer.from(headerSecret), Buffer.from(webhookSecret)) };
    } catch {
      return { valid: false };
    }
  }

  extractIdempotencyKey(body: TelegramWebhookPayload): string | null {
    const updateId = body['update_id'];
    return updateId != null ? `tg:${updateId}` : null;
  }

  async parseInbound(
    body: TelegramWebhookPayload,
    headers: RawRequest['headers'] = {},
    account?: ChannelAccount,
  ): Promise<ParsedMessage[]> {
    // Support edited_message — treat as normal message with prefix
    const isEdited = !body['message'] && !!body['edited_message'];
    const msg = (body['message'] ?? body['edited_message']) as TelegramObject | undefined;
    if (!msg) return [];

    const chat = msg['chat'] as TelegramObject | undefined;
    const from = msg['from'] as TelegramObject | undefined;
    const chatId = chat?.['id'];
    const messageId = msg['message_id'];
    if (!chatId || !messageId) return [];

    const text = String(msg['text'] || '');

    // Skip commands
    if (text.startsWith('/')) return [];

    // Determine type, content, and media refs
    let messageType: MessageType = 'text';
    let content = text;
    let contactPhone: string | undefined;
    const media: ParsedMediaRef[] = [];

    if (msg['photo']) {
      messageType = 'image';
      content = msg['caption'] ? String(msg['caption']) : '[Фото]';
      const photoArr = msg['photo'] as Array<TelegramObject>;
      const largest = photoArr[photoArr.length - 1];
      if (largest?.['file_id']) {
        media.push({
          sourceRef: String(largest['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: 'image/jpeg',
          mediaTypeHint: 'image',
        });
      }
    } else if (msg['video']) {
      messageType = 'video';
      content = msg['caption'] ? String(msg['caption']) : '[Видео]';
      const video = msg['video'] as TelegramObject;
      if (video?.['file_id']) {
        media.push({
          sourceRef: String(video['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: String(video['mime_type'] || 'video/mp4'),
          mediaTypeHint: 'video',
        });
      }
    } else if (msg['video_note']) {
      // Кружочки (video notes) — круглые видеосообщения
      messageType = 'video';
      content = '[Кружок]';
      const videoNote = msg['video_note'] as TelegramObject;
      if (videoNote?.['file_id']) {
        media.push({
          sourceRef: String(videoNote['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: 'video/mp4',
          mediaTypeHint: 'video',
        });
      }
    } else if (msg['animation']) {
      // GIF-анимации
      messageType = 'video';
      content = msg['caption'] ? String(msg['caption']) : '[GIF]';
      const animation = msg['animation'] as TelegramObject;
      if (animation?.['file_id']) {
        media.push({
          sourceRef: String(animation['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: String(animation['mime_type'] || 'video/mp4'),
          mediaTypeHint: 'video',
        });
      }
    } else if (msg['voice']) {
      messageType = 'audio';
      content = '[Голосовое сообщение]';
      const voice = msg['voice'] as TelegramObject;
      if (voice?.['file_id']) {
        media.push({
          sourceRef: String(voice['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: String(voice['mime_type'] || 'audio/ogg'),
          mediaTypeHint: 'audio',
        });
      }
    } else if (msg['audio']) {
      messageType = 'audio';
      content = '[Аудио]';
      const audio = msg['audio'] as TelegramObject;
      if (audio?.['file_id']) {
        media.push({
          sourceRef: String(audio['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: String(audio['mime_type'] || 'audio/mpeg'),
          mediaTypeHint: 'audio',
        });
      }
    } else if (msg['document']) {
      messageType = 'file';
      const doc = msg['document'] as TelegramObject;
      const fileName = doc?.['file_name'] ? String(doc['file_name']) : undefined;
      const fileLabel = fileName ? `[Файл: ${fileName}]` : '[Документ]';
      const caption = msg['caption'] ? String(msg['caption']).trim() : '';
      content = caption ? `${fileLabel}\n${caption}` : fileLabel;
      if (doc?.['file_id']) {
        media.push({
          sourceRef: String(doc['file_id']),
          sourceType: 'telegram_file_id',
          mimeHint: String(doc['mime_type'] || 'application/octet-stream'),
          fileName,
          mediaTypeHint: 'file',
        });
      }
    } else if (msg['sticker']) {
      messageType = 'sticker';
      const emoji = (msg['sticker'] as TelegramObject)?.['emoji'];
      content = `[Стикер${emoji ? ': ' + emoji : ''}]`;
    } else if (msg['location']) {
      messageType = 'location';
      content = '[Местоположение]';
    } else if (msg['contact']) {
      messageType = 'contact';
      const contact = msg['contact'] as TelegramObject;
      const rawPhone = contact?.['phone_number'];
      const contactUserId = contact?.['user_id'];
      const fromUserId = from?.['id'];
      const isOwnTelegramContact =
        contactUserId != null &&
        fromUserId != null &&
        String(contactUserId) === String(fromUserId);
      if (rawPhone && isOwnTelegramContact) {
        contactPhone = String(rawPhone).startsWith('+') ? String(rawPhone) : `+${rawPhone}`;
        content = '[Клиент поделился номером телефона]';
      } else {
        content = '[Контакт Telegram без подтверждения]';
      }
    }

    if (!content.trim()) return [];

    // Edited message prefix
    if (isEdited) {
      content = `[✏️ ред.] ${content}`;
    }

    // Forward detection
    let isForwarded = false;
    let forwardedFromName: string | undefined;
    if (msg['forward_origin'] || msg['forward_from'] || msg['forward_sender_name']) {
      isForwarded = true;
      const origin = msg['forward_origin'] as TelegramObject | undefined;
      if (origin?.['type'] === 'user' && origin['sender_user']) {
        forwardedFromName = extractUserName(origin['sender_user'] as TelegramObject);
      } else if (origin?.['type'] === 'hidden_user') {
        forwardedFromName = String(origin['sender_user_name'] || 'Скрытый пользователь');
      } else if (origin?.['type'] === 'channel') {
        forwardedFromName = String((origin['chat'] as TelegramObject)?.['title'] || 'Канал');
      } else if (msg['forward_from']) {
        forwardedFromName = extractUserName(msg['forward_from'] as TelegramObject);
      } else if (msg['forward_sender_name']) {
        forwardedFromName = String(msg['forward_sender_name']);
      }
    }

    // Reply-to
    let replyToExternalId: string | undefined;
    const replyMsg = msg['reply_to_message'] as TelegramObject | undefined;
    if (replyMsg?.['message_id']) {
      replyToExternalId = `tg:${replyMsg['message_id']}`;
    }

    const userName = extractUserName(from);
    const username = from?.['username'] ? String(from['username']) : undefined;

    // media_group_id — album grouping (multiple photos/videos sent together)
    const rawMediaGroupId = msg['media_group_id'];
    const mediaGroupId = typeof rawMediaGroupId === 'string' ? rawMediaGroupId : undefined;

    const parsed: ParsedMessage = {
      externalMessageId: `tg:${messageId}`,
      externalChatId: String(chatId),
      externalUserId: String(chatId),
      userName,
      username,
      phone: contactPhone,
      content,
      messageType,
      media: media.length > 0 ? media : undefined,
      isForwarded,
      forwardedFromName,
      replyToExternalId,
      mediaGroupId,
    };

    if (account) {
      const fromUserId = from?.['id'] ?? chatId;
      const chatType = chat?.['type'];
      const gateDecision = await gateTelegramInboundMessage({
        account,
        rawBody: body,
        rawHeaders: headers,
        chatId: String(chatId),
        userId: String(fromUserId),
        externalMessageId: parsed.externalMessageId,
        isPrivateChat: chatType === 'private' || chatType == null,
      });
      if (gateDecision === 'block') return [];
    }

    return [parsed];
  }

  parseStatusUpdate(_body: TelegramWebhookPayload): StatusUpdate[] {
    // Telegram doesn't send delivery receipts via webhook
    return [];
  }

  isSpecialEvent(body: TelegramWebhookPayload): boolean {
    // /start command, callback_query, and my_chat_member are special events
    const msg = (body['message'] ?? body['edited_message']) as TelegramObject | undefined;
    if (msg) {
      const text = String(msg['text'] || '');
      if (text.startsWith('/')) return true;
      // Осиротевшие legacy-кнопки («Завершить чат», «❌ Не сейчас») — гасим в
      // handleSpecialEvent, не ретранслируя оператору.
      if (isOrphanKeyboardText(text)) return true;
    }
    return !!body['callback_query'] || !!body['my_chat_member'];
  }

  async handleSpecialEvent(body: TelegramWebhookPayload, account: ChannelAccount): Promise<string | null> {
    const { botToken } = creds(account);
    if (!botToken) return null;

    // Handle my_chat_member — user blocked/unblocked the bot
    const myChatMember = body['my_chat_member'] as TelegramObject | undefined;
    if (myChatMember) {
      const newMember = myChatMember['new_chat_member'] as TelegramObject | undefined;
      const chat = myChatMember['chat'] as TelegramObject | undefined;
      const status = newMember?.['status'];
      const chatId = chat?.['id'];
      if (chatId && (status === 'kicked' || status === 'left')) {
        log.info('User blocked the bot', { chatId: String(chatId), status });
      } else if (chatId && status === 'member') {
        log.info('User unblocked the bot', { chatId: String(chatId) });
      }
      return null;
    }

    // Handle /start → welcome message (with optional deep link payload for attribution)
    const msg = (body['message'] ?? body['edited_message']) as TelegramObject | undefined;
    if (msg) {
      const text = String(msg['text'] || '');
      const chat = msg['chat'] as TelegramObject | undefined;
      const chatId = chat?.['id'];

      // Осиротевшие legacy reply-клавиатуры («Завершить чат», «❌ Не сейчас»): фичи сняты.
      // Гасим персистентную клавиатуру у клиента (один раз за окно 5 мин, чтобы
      // пачка нажатий не породила пачку ответов) и НЕ ретранслируем текст оператору.
      if (chatId && isOrphanKeyboardText(text)) {
        const guardKey = `tg_orphan_kbremove:${String(chatId)}`;
        const alreadyRemoved = await cacheGet<number>(guardKey);
        if (!alreadyRemoved) {
          await cacheSet(guardKey, 1, 300);
          await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'Эта кнопка больше не используется. Просто напишите нам, оператор на связи. 💬',
              reply_markup: { remove_keyboard: true },
            }),
          }).catch(err => log.warn('orphan keyboard remove failed', { error: String(err) }));
        }
        return null;
      }

      if (text.startsWith('/start') && chatId) {
        // Parse deep link payload: "/start utm_campaign_value" or "/start source_medium_campaign"
        const payload = text.slice('/start'.length).trim();
        const utm: DeepLinkUtm = payload ? parseDeepLinkPayload(payload) : {};
        if (payload) {
          // Cache for 5 min — inbound-worker will pick it up on first message
          await cacheSet(`tg_deeplink:${String(chatId)}`, utm, 300);
          log.info('Telegram deep link captured', { chatId: String(chatId), payload, utm });
        }

        tgStartEventsTotal.inc({ has_payload: String(!!payload) });

        const from = msg['from'] as TelegramObject | undefined;
        const tgUserId = from?.['id'];
        if (tgUserId) {
          mpQuery(
            `INSERT INTO tg_start_events (tg_user_id, chat_id, payload, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              String(tgUserId), String(chatId), payload || null,
              utm.utm_source ?? null, utm.utm_medium ?? null,
              utm.utm_campaign ?? null, utm.utm_content ?? null, utm.utm_term ?? null,
            ],
          ).catch((err: unknown) => log.warn('tg_start_events insert failed', { error: String(err), tgUserId: String(tgUserId) }));
        }

        await this.sendWelcome(account, String(chatId));
      }
      return null;
    }

    // Handle callback_query
    const cbq = body['callback_query'] as TelegramObject | undefined;
    if (cbq?.['id']) {
      const callbackData = String(cbq['data'] || '');

      if (isTelegramSubscriptionGateCallback(callbackData)) {
        const handled = await handleTelegramSubscriptionGateCallback(account, cbq);
        if (handled) return null;
      }

      // Booking confirm/reject callbacks
      if (callbackData.startsWith('booking_confirm_') || callbackData.startsWith('booking_reject_')) {
        const confirmed = callbackData.startsWith('booking_confirm_');
        const dealId = callbackData.replace(/^booking_(confirm|reject)_/, '');

        try {
          await fetchWithTimeout(apiUrl(botToken, 'answerCallbackQuery'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: cbq['id'],
              text: confirmed ? 'Запись подтверждена' : 'Запись отклонена',
            }),
          });
        } catch (err) {
          log.warn('answerCallbackQuery failed', { error: String(err) });
        }

        try {
          const newStatus = confirmed ? 'confirmed' : 'cancelled';
          await db.query(
            `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending'`,
            [newStatus, dealId],
          );

          const booking = await db.queryOne<TelegramBookingCallbackRow>(
            `SELECT client_phone, service_name,
                    to_char(booking_date, 'DD.MM.YYYY') as booking_date,
                    booking_time, client_telegram_chat_id
             FROM bookings WHERE id = $1`,
            [dealId],
          );

          if (booking?.client_telegram_chat_id) {
            const statusText = confirmed
              ? `✅ Ваша запись подтверждена!\n\nУслуга: ${booking.service_name || 'Услуга'}\nДата: ${booking.booking_date || ''}\nВремя: ${booking.booking_time || ''}\n\nЖдём вас!`
              : `❌ К сожалению, ваша запись отменена.\n\nУслуга: ${booking.service_name || 'Услуга'}\nДата: ${booking.booking_date || ''}\nВремя: ${booking.booking_time || ''}\n\nСвяжитесь с нами для переноса.`;
            await this.sendText(account, booking.client_telegram_chat_id, statusText);
          }
        } catch (err) {
          log.error('Booking callback error', { dealId, error: String(err) });
        }
        return null;
      }

      // F70: Skip phone request callback
      if (callbackData === 'skip_phone_request') {
        await fetchWithTimeout(apiUrl(botToken, 'answerCallbackQuery'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cbq['id'], text: 'Хорошо, пропускаем' }),
        }).catch(err => log.warn('answerCallbackQuery failed', { error: String(err) }));

        // Remove reply keyboard
        const cbChat = (cbq['message'] as TelegramObject | undefined)?.['chat'] as TelegramObject | undefined;
        const cbChatId = cbChat?.['id'];
        if (cbChatId) {
          await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cbChatId,
              text: 'Вы можете отправить номер позже в любой момент.',
              reply_markup: { remove_keyboard: true },
            }),
          }).catch(err => log.warn('removeKeyboard failed', { error: String(err) }));
        }
        return null;
      }

      // Broadcast buttons: «📍 Наши адреса» / «❌ Отписаться» / «🙋 Я не студент».
      // (Strings kept in sync with broadcast-callbacks.constants.ts; handler dynamically
      //  imported to avoid pulling the chat-broadcast notification graph into the adapter.)
      if (callbackData === 'bcast_unsub' || callbackData === 'bcast_not_student' || callbackData === 'bcast_addresses') {
        const cbFrom = (cbq['from'] as TelegramObject | undefined)?.['id'];
        const cbChat = (cbq['message'] as TelegramObject | undefined)?.['chat'] as TelegramObject | undefined;
        const cbChatId = String(cbChat?.['id'] ?? cbFrom ?? '');
        let ackText = '';
        let ackParseMode: string | undefined;
        try {
          const { handleBroadcastCallback } = await import('../../broadcast/broadcast-callbacks.service.js');
          const res = await handleBroadcastCallback(cbChatId, callbackData);
          ackText = res?.ackText ?? '';
          ackParseMode = res?.parseMode;
        } catch (err) {
          log.error('broadcast callback handler error', { callbackData, error: String(err) });
        }
        await fetchWithTimeout(apiUrl(botToken, 'answerCallbackQuery'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cbq['id'], text: '' }),
        }).catch(err => log.warn('answerCallbackQuery failed', { error: String(err) }));
        if (ackText && cbChatId) {
          await this.sendText(account, cbChatId, ackText, undefined, ackParseMode)
            .catch(err => log.warn('broadcast ack send failed', { error: String(err) }));
        }
        return null;
      }

      // Generic callback → dismiss spinner
      await fetchWithTimeout(apiUrl(botToken, 'answerCallbackQuery'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cbq['id'], text: '' }),
      }).catch(err => log.warn('answerCallbackQuery failed', { error: String(err) }));
    }
    return null;
  }

  private noop(input: string): unknown {
    let out: unknown;
    try {
      out = JSON.parse(input);
    } catch (e) {
      void e;
    }
    return out;
  }

  /**
   * Normalise a non-ok Telegram Bot API response into SendResult error fields.
   * On HTTP 429 the body carries `{ parameters: { retry_after: <seconds> } }`;
   * surface retry_after as retryAfter so broadcast callers can back off the bot.
   */
  private parseTgError(status: number, errText: string): { errorCode: string; errorMessage: string; retryAfter?: number } {
    let retryAfter: number | undefined;
    if (status === 429) {
      try {
        const parsed = JSON.parse(errText) as TelegramObject;
        const params = parsed['parameters'] as TelegramObject | undefined;
        const ra = params?.['retry_after'];
        if (typeof ra === 'number') {
          retryAfter = ra;
        }
      } catch (parseErr) {
        log.debug('parseTgError: non-JSON 429 body', { error: String(parseErr) });
      }
    }
    return { errorCode: String(status), errorMessage: errText, retryAfter };
  }

  async sendText(account: ChannelAccount, chatId: string, text: string, replyToExternalId?: string, parseMode?: string): Promise<SendResult> {
    const { botToken } = creds(account);
    if (!botToken) return { success: false, errorMessage: 'Bot token not configured' };

    return withCircuitBreaker('telegram', account.id, async () => {
      const payload: TelegramObject = { chat_id: chatId, text };
      if (parseMode) payload['parse_mode'] = parseMode;
      if (replyToExternalId) {
        const msgId = replyToExternalId.replace('tg:', '');
        payload['reply_parameters'] = { message_id: Number(msgId) };
      }

      const response = await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, ...this.parseTgError(response.status, errText) };
      }

      const data = await response.json() as TelegramObject;
      const result = data['result'] as TelegramObject | undefined;
      const msgId = result?.['message_id'];
      return { success: true, externalMessageId: msgId ? `tg:${msgId}` : undefined };
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
    inlineKeyboard?: Array<Array<{ text: string; url?: string; callback_data?: string }>>,
  ): Promise<SendResult> {
    const { botToken } = creds(account);
    if (!botToken) return { success: false, errorMessage: 'Bot token not configured' };

    return withCircuitBreaker('telegram', account.id, async () => {
      // Upload as multipart/form-data rather than passing a URL. The Bot API
      // caches URL fetch outcomes server-side: once a URL returned an error
      // (e.g. during the Cross-Origin-Resource-Policy regression), subsequent
      // calls with the same URL — even after the upstream was fixed — keep
      // returning "wrong type of the web page content" without re-fetching.
      // Posting the bytes bypasses that cache entirely.
      let fileRes: Response;
      try {
        fileRes = await fetchWithTimeout(mediaUrl, { timeout: 20000 });
      } catch (err) {
        return { success: false, errorMessage: `source fetch failed: ${String(err)}` };
      }
      if (!fileRes.ok) {
        return { success: false, errorCode: String(fileRes.status), errorMessage: `source fetch ${fileRes.status}` };
      }
      const buf = Buffer.from(await fileRes.arrayBuffer());
      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const name = fileName || (mediaUrl.split('/').pop() || 'file').split('?')[0] || 'file';

      // Telegram sendPhoto limits: 10 MB file size, width+height ≤ 10000 px.
      // When a photo exceeds either, the Bot API responds with a generic
      // "there is no photo in the request" rather than an explicit size error.
      // Fall back to sendDocument for oversized images so the file still gets
      // delivered (as a compressed-less document attachment).
      const TG_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
      const isOversizedPhoto = mediaType === 'image' && buf.length > TG_PHOTO_MAX_BYTES;

      let method: string;
      let fieldName: string;
      if (isOversizedPhoto) {
        method = 'sendDocument';
        fieldName = 'document';
      } else {
        switch (mediaType) {
          case 'image': method = 'sendPhoto'; fieldName = 'photo'; break;
          case 'video': method = 'sendVideo'; fieldName = 'video'; break;
          case 'audio': method = 'sendAudio'; fieldName = 'audio'; break;
          default: method = 'sendDocument'; fieldName = 'document';
        }
      }

      // Use form-data npm package instead of undici's built-in FormData:
      // undici sends the body with Transfer-Encoding: chunked, and the Bot API
      // apparently refuses to parse chunked multipart — returning
      // "there is no photo/document in the request" even though the part is
      // well-formed. form-data lets us compute getBuffer()+getHeaders() so the
      // request carries an explicit Content-Length, which Telegram accepts.
      const form = new FormDataNode();
      form.append('chat_id', chatId);
      form.append(fieldName, buf, { filename: name, contentType });
      if (caption) form.append('caption', caption);
      if (replyToExternalId) {
        const msgId = replyToExternalId.replace('tg:', '');
        form.append('reply_parameters', JSON.stringify({ message_id: Number(msgId) }));
      }
      if (inlineKeyboard) {
        form.append('reply_markup', JSON.stringify({ inline_keyboard: inlineKeyboard }));
      }

      const body = form.getBuffer();
      const headers = form.getHeaders();
      const requestBody = new ArrayBuffer(body.length);
      new Uint8Array(requestBody).set(body);
      const response = await fetchWithTimeout(apiUrl(botToken, method), {
        method: 'POST',
        body: requestBody,
        headers,
        timeout: 30000,
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, ...this.parseTgError(response.status, errText) };
      }

      const data = await response.json() as TelegramObject;
      const result = data['result'] as TelegramObject | undefined;
      const msgId = result?.['message_id'];
      return { success: true, externalMessageId: msgId ? `tg:${msgId}` : undefined };
    });
  }

  async sendWithInlineButton(
    account: ChannelAccount,
    chatId: string,
    text: string,
    buttonLabel: string,
    buttonUrl: string,
  ): Promise<SendResult> {
    const { botToken } = creds(account);
    if (!botToken) return { success: false, errorMessage: 'Bot token not configured' };

    return withCircuitBreaker('telegram', account.id, async () => {
      const response = await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [[{ text: buttonLabel, url: buttonUrl }]],
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, ...this.parseTgError(response.status, errText) };
      }

      const data = await response.json() as TelegramObject;
      const result = data['result'] as TelegramObject | undefined;
      const msgId = result?.['message_id'];
      return { success: true, externalMessageId: msgId ? `tg:${msgId}` : undefined };
    });
  }

  async deleteMessage(account: ChannelAccount, chatId: string, externalMessageId: string): Promise<SendResult> {
    const { botToken } = creds(account);
    if (!botToken) return { success: false, errorMessage: 'Bot token not configured' };

    return withCircuitBreaker('telegram', account.id, async () => {
      const msgId = externalMessageId.replace('tg:', '');
      const response = await fetchWithTimeout(apiUrl(botToken, 'deleteMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: Number(msgId) }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, errorCode: String(response.status), errorMessage: errText };
      }

      return { success: true };
    });
  }

  async editMessageText(account: ChannelAccount, chatId: string, externalMessageId: string, newText: string): Promise<SendResult> {
    const { botToken } = creds(account);
    if (!botToken) return { success: false, errorMessage: 'Bot token not configured' };

    return withCircuitBreaker('telegram', account.id, async () => {
      const msgId = externalMessageId.replace('tg:', '');
      const response = await fetchWithTimeout(apiUrl(botToken, 'editMessageText'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: Number(msgId), text: newText }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, ...this.parseTgError(response.status, errText) };
      }

      return { success: true, externalMessageId };
    });
  }

  async downloadMedia(ref: ParsedMediaRef, account: ChannelAccount): Promise<Buffer> {
    const { botToken } = creds(account);
    if (!botToken) throw new Error('Bot token not configured');

    // 1. Resolve file_id → temporary download URL
    const fileInfoRes = await fetchWithTimeout(
      apiUrl(botToken, `getFile?file_id=${ref.sourceRef}`),
      { method: 'GET', timeout: 30_000 },
    );
    const fileInfo = await fileInfoRes.json() as TelegramObject;
    if (!fileInfo['ok']) {
      const desc = String(fileInfo['description'] || 'unknown error');
      // "file is too big" is permanent — don't retry
      if (desc.includes('file is too big')) {
        const err = new Error(`getFile failed: ${desc}`) as Error & { permanent: boolean };
        err.permanent = true;
        throw err;
      }
      throw new Error(`getFile failed: ${desc}`);
    }

    const filePath = (fileInfo['result'] as TelegramObject)?.['file_path'] as string;
    if (!filePath) throw new Error('No file_path in getFile response');

    // 2. Download bytes
    // Local Server: file_path is absolute path on disk — read directly
    // Cloud API: file_path is relative — download via HTTP
    if (isLocalServer && filePath.startsWith('/')) {
      return readFile(filePath);
    }
    const downloadUrl = `${TG_API}/file/bot${botToken}/${filePath}`;
    const downloadRes = await fetchWithTimeout(downloadUrl, { method: 'GET', timeout: 120_000 });
    if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`);

    return readResponseBufferWithTimeout(downloadRes, {
      idleTimeoutMs: TELEGRAM_MEDIA_IDLE_TIMEOUT_MS,
      totalTimeoutMs: TELEGRAM_MEDIA_TOTAL_TIMEOUT_MS,
      label: 'telegram media download',
    });
  }

  async downloadMediaStream(ref: ParsedMediaRef, account: ChannelAccount): Promise<Readable> {
    const { botToken } = creds(account);
    if (!botToken) throw new Error('Bot token not configured');

    // 1. Resolve file_id → temporary download URL
    const fileInfoRes = await fetchWithTimeout(
      apiUrl(botToken, `getFile?file_id=${ref.sourceRef}`),
      { method: 'GET', timeout: 30_000 },
    );
    const fileInfo = await fileInfoRes.json() as TelegramObject;
    if (!fileInfo['ok']) {
      const desc = String(fileInfo['description'] || 'unknown error');
      if (desc.includes('file is too big')) {
        const err = new Error(`getFile failed: ${desc}`) as Error & { permanent: boolean };
        err.permanent = true;
        throw err;
      }
      throw new Error(`getFile failed: ${desc}`);
    }

    const filePath = (fileInfo['result'] as TelegramObject)?.['file_path'] as string;
    if (!filePath) throw new Error('No file_path in getFile response');

    // 2. Stream download
    // Local Server: file_path is absolute — stream from disk
    if (isLocalServer && filePath.startsWith('/')) {
      return enforceStreamTimeout(createReadStream(filePath), {
        idleTimeoutMs: TELEGRAM_MEDIA_IDLE_TIMEOUT_MS,
        totalTimeoutMs: TELEGRAM_MEDIA_TOTAL_TIMEOUT_MS,
        label: 'telegram local media stream',
      });
    }
    const downloadUrl = `${TG_API}/file/bot${botToken}/${filePath}`;
    const downloadRes = await fetchWithTimeout(downloadUrl, { method: 'GET', timeout: 60_000 });
    if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`);
    if (!downloadRes.body) throw new Error('Response body is null');

    return enforceStreamTimeout(
      Readable.fromWeb(downloadRes.body as import('stream/web').ReadableStream),
      {
        idleTimeoutMs: TELEGRAM_MEDIA_IDLE_TIMEOUT_MS,
        totalTimeoutMs: TELEGRAM_MEDIA_TOTAL_TIMEOUT_MS,
        label: 'telegram media stream',
      },
    );
  }

  async sendTypingIndicator(account: ChannelAccount, chatId: string): Promise<void> {
    const { botToken } = creds(account);
    if (!botToken) return;

    await fetchWithTimeout(apiUrl(botToken, 'sendChatAction'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    }).catch((err: unknown) => {
      log.warn('sendChatAction failed', { chatId, error: String(err) });
    });
  }

  async sendWelcome(account: ChannelAccount, chatId: string): Promise<void> {
    const { botToken } = creds(account);
    if (!botToken) return;

    try {
      // Import welcome constants lazily to avoid circular dependency
      const { getWelcomeHtml, WELCOME_BUTTONS } = await import('../../welcome-message.constants.js');
      await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: getWelcomeHtml(),
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              WELCOME_BUTTONS.map((b: { emoji: string; label: string; url: string }) => ({
                text: `${b.emoji} ${b.label}`,
                url: b.url,
              })),
            ],
          },
        }),
      });

      // F70: Send phone request after welcome
      await this.sendContactRequest(account, chatId);
    } catch (err) {
      log.error('Welcome failed', { chatId, error: String(err) });
    }
  }

  /**
   * F70: Send Telegram ReplyKeyboardMarkup with request_contact button.
   * User taps the button → Telegram sends their real phone number as a contact message.
   */
  async sendContactRequest(account: ChannelAccount, chatId: string): Promise<void> {
    const { botToken } = creds(account);
    if (!botToken) return;

    try {
      const { PHONE_REQUEST_TEXT, PHONE_SKIP_CALLBACK } = await import('../../welcome-message.constants.js');

      // 1. Send inline message with "Skip" button
      await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: PHONE_REQUEST_TEXT,
          reply_markup: {
            inline_keyboard: [[{ text: 'Пропустить', callback_data: PHONE_SKIP_CALLBACK }]],
          },
        }),
      });

      // 2. Send reply keyboard with request_contact (native Telegram phone sharing)
      await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'Нажмите кнопку ниже, чтобы поделиться номером:',
          reply_markup: {
            keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }),
      });
    } catch (err) {
      log.error('sendContactRequest failed', { chatId, error: String(err) });
    }
  }

  async verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    const { botToken } = creds(account);
    if (!botToken) return { ok: false, error: 'Bot token not configured' };

    try {
      const response = await fetchWithTimeout(apiUrl(botToken, 'getMe'), { method: 'GET', timeout: 10_000 });
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

  async ensureWebhook(account: ChannelAccount, baseUrl: string): Promise<void> {
    const { botToken, webhookSecret } = creds(account);
    if (!botToken) return;
    if (isPermanentPollingMode()) {
      log.info('Telegram webhook registration skipped: permanent polling mode');
      return;
    }

    const expectedUrl = resolveWebhookUrl(account, baseUrl);

    const infoRes = await fetchWithTimeout(apiUrl(botToken, 'getWebhookInfo'), { method: 'GET', timeout: 10_000 });
    const info = await infoRes.json();
    const currentUrl = (info && typeof info === 'object' && 'result' in info)
      ? (info.result && typeof info.result === 'object' && 'url' in info.result ? String(info.result.url) : '')
      : '';

    if (currentUrl === expectedUrl) {
      log.info('Telegram webhook already set', { url: expectedUrl });
      return;
    }

    const payload: TelegramObject = {
      url: expectedUrl,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'],
    };
    if (webhookSecret) {
      payload['secret_token'] = webhookSecret;
    }

    const setRes = await fetchWithTimeout(apiUrl(botToken, 'setWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const setData = await setRes.json();
    const ok = setData && typeof setData === 'object' && 'ok' in setData && setData.ok;
    if (ok) {
      log.info('Telegram webhook registered', { url: expectedUrl });
    } else {
      log.error('Telegram setWebhook failed', { response: setData });
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: false,
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
      maxMediaSizeBytes: 50 * 1024 * 1024, // 50MB
      maxTextLength: 4096,
    };
  }
}
