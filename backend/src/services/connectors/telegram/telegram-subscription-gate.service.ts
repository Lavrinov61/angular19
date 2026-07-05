import { Queue } from 'bullmq';
import type { ChannelAccount } from '../core/types.js';
import type { RawRequest } from '../core/dto.js';
import { config } from '../../../config/index.js';
import db from '../../../database/db.js';
import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import { createLogger } from '../../../utils/logger.js';
import { cacheDel, cacheGet, cacheSet } from '../../redis-cache.service.js';
import type {
  TelegramSubscriptionGateConversationRow,
  TelegramSubscriptionGateWebhookEventRow,
} from '../../../types/views/chat-views.js';

const log = createLogger('telegram-subscription-gate');

const TG_API = config.telegram.apiUrl;
const DEFAULT_CHANNEL = '@magnus_photo';
const DEFAULT_CHANNEL_URL = 'https://t.me/magnus_photo';
const PENDING_TTL_SEC = 24 * 60 * 60;
const BYPASS_TTL_SEC = 5 * 60;

export const TELEGRAM_SUBSCRIPTION_GATE_CALLBACK = 'tg_sub_gate_continue';

export type TelegramSubscriptionGateDecision = 'allow' | 'block';

export interface TelegramSubscriptionGateInboundInput {
  account: ChannelAccount;
  rawBody: RawRequest['body'];
  rawHeaders: RawRequest['headers'];
  chatId: string;
  userId: string;
  externalMessageId: string;
  isPrivateChat: boolean;
}

interface TelegramObject {
  [key: string]: unknown;
}

interface PendingTelegramSubscriptionGateUpdate {
  accountId: string;
  rawBody: RawRequest['body'];
  rawHeaders: RawRequest['headers'];
  externalMessageId: string;
  createdAt: string;
}

let inboundQueue: Queue | null = null;

function getInboundQueue(): Queue {
  if (inboundQueue) return inboundQueue;

  inboundQueue = new Queue('omni-inbound', {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      tls: config.redis.tls,
      maxRetriesPerRequest: null,
    },
  });
  return inboundQueue;
}

function isGateEnabled(): boolean {
  return (process.env['TELEGRAM_SUBSCRIPTION_GATE_ENABLED'] || '').trim().toLowerCase() !== 'false';
}

function gateChannel(): string {
  return process.env['TELEGRAM_SUBSCRIPTION_GATE_CHANNEL']?.trim() || DEFAULT_CHANNEL;
}

function gateChannelUrl(): string {
  return process.env['TELEGRAM_SUBSCRIPTION_GATE_URL']?.trim() || DEFAULT_CHANNEL_URL;
}

function pendingKey(accountId: string, chatId: string): string {
  return `tg_sub_gate:pending:${accountId}:${chatId}`;
}

function bypassKey(accountId: string, externalMessageId: string): string {
  return `tg_sub_gate:bypass:${accountId}:${externalMessageId}`;
}

function apiUrl(token: string, method: string): string {
  return `${TG_API}/bot${token}/${method}`;
}

function getBotToken(account: ChannelAccount): string | null {
  const token = account.credentials['botToken'];
  return typeof token === 'string' && token.trim() ? token : null;
}

function isTelegramObject(value: unknown): value is TelegramObject {
  return typeof value === 'object' && value !== null;
}

function isSubscribedMember(member: unknown): boolean {
  if (!isTelegramObject(member)) return false;

  const status = member['status'];
  if (status === 'creator' || status === 'administrator' || status === 'member') {
    return true;
  }

  return status === 'restricted' && member['is_member'] === true;
}

function isExplicitNotSubscribedResponse(status: number, responseBody: unknown): boolean {
  if (status !== 400) return false;
  if (!isTelegramObject(responseBody)) return false;

  const description = String(responseBody['description'] || '').toLowerCase();
  return description.includes('not found')
    || description.includes('not_participant')
    || description.includes('not a member')
    || description.includes('participant');
}

async function hasExistingTelegramConversation(account: ChannelAccount, chatId: string): Promise<boolean> {
  const params: unknown[] = ['telegram', chatId];
  const existing = await db.queryOne<TelegramSubscriptionGateConversationRow>(
    `SELECT id
       FROM conversations
      WHERE channel = $1
        AND external_chat_id = $2
        AND (status NOT IN ('closed')
             OR (status = 'closed' AND updated_at > NOW() - INTERVAL '7 days'))
      ORDER BY created_at DESC
      LIMIT 1`,
    params,
  );
  if (existing) {
    log.debug('telegram subscription gate skipped for existing conversation', {
      accountId: account.id,
      chatId,
      conversationId: existing.id,
    });
  }
  return !!existing;
}

async function checkTelegramChannelSubscription(account: ChannelAccount, userId: string): Promise<boolean | null> {
  const botToken = getBotToken(account);
  if (!botToken) {
    log.warn('telegram subscription gate skipped: bot token is missing', { accountId: account.id });
    return null;
  }

  try {
    const response = await fetchWithTimeout(apiUrl(botToken, 'getChatMember'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: gateChannel(),
        user_id: userId,
      }),
      timeout: 10_000,
    });
    const data = await response.json() as TelegramObject;

    if (!response.ok) {
      if (isExplicitNotSubscribedResponse(response.status, data)) {
        return false;
      }
      log.warn('telegram subscription gate membership check failed open', {
        accountId: account.id,
        status: response.status,
        description: typeof data['description'] === 'string' ? data['description'] : undefined,
      });
      return null;
    }

    return isSubscribedMember(data['result']);
  } catch (error) {
    log.warn('telegram subscription gate membership check failed open', {
      accountId: account.id,
      error: String(error),
    });
    return null;
  }
}

async function sendSubscriptionPrompt(account: ChannelAccount, chatId: string): Promise<boolean> {
  const botToken = getBotToken(account);
  if (!botToken) return false;

  try {
    const response = await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'Чтобы продолжить общение со Своё Фото, подпишитесь на наш канал.\n\nТам публикуем акции, цены, новости студий и полезные подсказки по печати и фото.',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Подписаться на канал', url: gateChannelUrl() }],
            [{ text: 'Я подписался, продолжить', callback_data: TELEGRAM_SUBSCRIPTION_GATE_CALLBACK }],
          ],
        },
      }),
    });
    if (!response.ok) {
      log.warn('telegram subscription gate prompt failed open', {
        accountId: account.id,
        chatId,
        status: response.status,
      });
      return false;
    }
    return true;
  } catch (error) {
    log.warn('telegram subscription gate prompt failed open', {
      accountId: account.id,
      chatId,
      error: String(error),
    });
    return false;
  }
}

async function answerCallback(
  account: ChannelAccount,
  callbackQueryId: string,
  text: string,
  showAlert = false,
): Promise<void> {
  const botToken = getBotToken(account);
  if (!botToken) return;

  await fetchWithTimeout(apiUrl(botToken, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      ...(showAlert ? { show_alert: true } : {}),
    }),
  }).catch((error: unknown) => {
    log.warn('telegram subscription gate answerCallbackQuery failed', {
      accountId: account.id,
      error: String(error),
    });
  });
}

async function sendText(account: ChannelAccount, chatId: string, text: string): Promise<void> {
  const botToken = getBotToken(account);
  if (!botToken) return;

  await fetchWithTimeout(apiUrl(botToken, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch((error: unknown) => {
    log.warn('telegram subscription gate sendMessage failed', {
      accountId: account.id,
      chatId,
      error: String(error),
    });
  });
}

function getCallbackId(callbackQuery: TelegramObject): string | null {
  const id = callbackQuery['id'];
  return typeof id === 'string' && id ? id : null;
}

function getCallbackUserId(callbackQuery: TelegramObject): string | null {
  const from = callbackQuery['from'];
  if (!isTelegramObject(from)) return null;

  const id = from['id'];
  return id != null ? String(id) : null;
}

function getCallbackChatId(callbackQuery: TelegramObject): string | null {
  const message = callbackQuery['message'];
  if (!isTelegramObject(message)) return null;

  const chat = message['chat'];
  if (!isTelegramObject(chat)) return null;

  const id = chat['id'];
  return id != null ? String(id) : null;
}

export function isTelegramSubscriptionGateCallback(callbackData: string): boolean {
  return callbackData === TELEGRAM_SUBSCRIPTION_GATE_CALLBACK;
}

export async function gateTelegramInboundMessage(
  input: TelegramSubscriptionGateInboundInput,
): Promise<TelegramSubscriptionGateDecision> {
  if (!isGateEnabled()) return 'allow';
  if (!input.isPrivateChat) return 'allow';
  if (!input.chatId || !input.userId || !input.externalMessageId) return 'allow';

  const bypass = await cacheGet<number>(bypassKey(input.account.id, input.externalMessageId));
  if (bypass) return 'allow';

  if (await hasExistingTelegramConversation(input.account, input.chatId)) {
    return 'allow';
  }

  const subscribed = await checkTelegramChannelSubscription(input.account, input.userId);
  if (subscribed !== false) {
    return 'allow';
  }

  const pending: PendingTelegramSubscriptionGateUpdate = {
    accountId: input.account.id,
    rawBody: input.rawBody,
    rawHeaders: input.rawHeaders,
    externalMessageId: input.externalMessageId,
    createdAt: new Date().toISOString(),
  };
  await cacheSet(pendingKey(input.account.id, input.chatId), pending, PENDING_TTL_SEC);

  const promptSent = await sendSubscriptionPrompt(input.account, input.chatId);
  return promptSent ? 'block' : 'allow';
}

export async function handleTelegramSubscriptionGateCallback(
  account: ChannelAccount,
  callbackQuery: TelegramObject,
): Promise<boolean> {
  const callbackData = typeof callbackQuery['data'] === 'string' ? callbackQuery['data'] : '';
  if (!isTelegramSubscriptionGateCallback(callbackData)) {
    return false;
  }

  const callbackId = getCallbackId(callbackQuery);
  const userId = getCallbackUserId(callbackQuery);
  const chatId = getCallbackChatId(callbackQuery);

  if (!callbackId || !userId || !chatId) {
    log.warn('telegram subscription gate callback missing ids', { accountId: account.id });
    return true;
  }

  const subscribed = await checkTelegramChannelSubscription(account, userId);
  if (subscribed !== true) {
    await answerCallback(
      account,
      callbackId,
      'Пока не видим подписку. Подпишитесь на канал и нажмите кнопку ещё раз.',
      true,
    );
    return true;
  }

  await answerCallback(account, callbackId, 'Спасибо, подписка проверена.');

  const pending = await cacheGet<PendingTelegramSubscriptionGateUpdate>(pendingKey(account.id, chatId));
  if (!pending) {
    await sendText(account, chatId, 'Спасибо! Теперь напишите нам ваш вопрос.');
    return true;
  }

  await cacheSet(bypassKey(account.id, pending.externalMessageId), 1, BYPASS_TTL_SEC);

  const params: unknown[] = [
    account.id,
    pending.rawHeaders,
    pending.rawBody,
    `tg-subgate-replay:${pending.externalMessageId}`,
  ];
  const webhookEvent = await db.queryOne<TelegramSubscriptionGateWebhookEventRow>(
    `INSERT INTO webhook_events
       (channel, account_id, raw_headers, raw_body, idempotency_key, source_ip, status)
     VALUES ('telegram', $1, $2, $3, $4, NULL, 'pending')
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    params,
  );

  if (webhookEvent) {
    await getInboundQueue().add('process-inbound', {
      webhookEventId: webhookEvent.id,
      channel: 'telegram',
      accountId: account.id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  await cacheDel(pendingKey(account.id, chatId));
  await sendText(account, chatId, 'Спасибо, подписка проверена. Продолжаем диалог.');
  return true;
}
