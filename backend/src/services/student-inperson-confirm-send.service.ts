/**
 * Отложенная отправка ссылки на подтверждение очной студ-верификации.
 *
 * После заверения документа у стойки клиент ничего не делает. На следующий
 * календарный день в 09:00 МСК ему автоматически уходит ссылка на подтверждение
 * в привязанный мессенджер (telegram/max/vk/whatsapp/instagram) или SMS-фолбэком.
 *
 * Доставка идёт «тихо» через deliverToChannel (RAW, без записи в messages и без
 * Socket.IO) — чтобы НЕ засорять Пульт операторскими сообщениями.
 *
 * Очередь — выделенная таблица student_inperson_confirm_sends; планировщик
 * leader-only (как review-request-scheduler).
 */

import type { PoolClient } from 'pg';
import db from '../database/db.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type Messages from '../types/generated/public/Messages.js';
import type Users from '../types/generated/public/Users.js';
import { config } from '../config/index.js';
import { deliverToChannel } from './channel-delivery.service.js';
import { sendSms } from './sms.service.js';
import { hasVerifiedEducationAccount } from './account-discounts.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { enqueueOutbound } from './connectors/pipeline/outbound-worker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('student-inperson-confirm-send');

const CONFIRM_URL = 'https://svoefoto.ru/education/in-person';
const MAX_ATTEMPTS = 5;
const CLAIM_LIMIT = 20;
const STUCK_SENDING_MINUTES = 15;
const RECENT_SEND_WINDOW_HOURS = 36;
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
const FIRST_RUN_DELAY_MS = 120_000; // первый прогон через 2 минуты после старта

/** Каналы, в которые имеет смысл слать ссылку (deliverable messenger). */
export const MESSENGER_CHANNELS = ['telegram', 'max', 'vk', 'whatsapp', 'instagram'] as const;

type MessengerChannel = (typeof MESSENGER_CHANNELS)[number];

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// ─── Типы ─────────────────────────────────────────────────────────────────

export interface EnqueueInPersonConfirmSendParams {
  verificationId: string;
  userId: string | null;
  phoneNormalized: string;
  sendAt?: string | null;
}

export interface EnqueueInPersonConfirmSendResult {
  enqueued: boolean;
  reason: 'enqueued' | 'already_verified' | 'recently_sent';
  sendAt: string | null;
  channelHint: string | null;
}

interface ResolvedMessenger {
  channel: MessengerChannel;
  externalChatId: string;
}

interface MessengerLookupRow {
  channel: string;
  external_chat_id: string | null;
}

interface DueSendRow {
  id: string;
  verification_id: string;
  user_id: string | null;
  phone_normalized: string;
  attempts: number;
}

interface VerificationTargetLookupRow {
  status: string;
  target_conversation_id: string | null;
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

/** Маскирует середину телефона для логов (не пишем полный номер). */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

/**
 * send_at = следующий день 09:00 МСК как timestamptz.
 * Вычисляется в БД, чтобы корректно учесть зону Europe/Moscow.
 */
async function computeNextDay9MskSendAt(client: PoolClient): Promise<string> {
  const row = await client.query<{ send_at: string }>(
    `SELECT (DATE_TRUNC('day', NOW() AT TIME ZONE 'Europe/Moscow')
              + INTERVAL '1 day' + TIME '09:00:00') AT TIME ZONE 'Europe/Moscow' AS send_at`,
  );
  return row.rows[0].send_at;
}

/** Текст для мессенджера: plain text + эмодзи, БЕЗ markdown и тире. */
function buildMessengerText(): string {
  return [
    'Здравствуйте! 🎓 Это Своё Фото.',
    'Сотрудник заверил ваш студенческий документ. Подтвердите статус, чтобы активировать скидку:',
    CONFIRM_URL,
    'Войдите по коду на этот номер и нажмите Подтвердить. Это займёт минуту 🙂',
  ].join('\n');
}

/**
 * Текст для SMS: сервисный (клиент сам инициировал, сотрудник заверил его документ),
 * без рекламного крючка под 38-ФЗ ст.18. БЕЗ эмодзи и тире, цель не более 2 сегментов.
 */
function buildSmsText(): string {
  return `Свое Фото: сотрудник заверил ваш студенческий документ. Подтвердите статус, войдите по коду: ${CONFIRM_URL}`;
}

// ─── Резолв канала ───────────────────────────────────────────────────────────

/**
 * Лучший привязанный мессенджер пользователя на момент отправки.
 * Приоритет: telegram → max → vk → whatsapp → instagram, при равенстве — свежесть диалога.
 * Не отдаёт удалённые контакты (152-ФЗ) и закрытые диалоги.
 */
export async function resolveBestMessengerForUser(
  userId: string,
  phoneNormalized: string | null = null,
): Promise<ResolvedMessenger | null> {
  const row = await db.queryOne<MessengerLookupRow>(
    `SELECT c.channel::text AS channel,
            COALESCE(c.external_chat_id, c.metadata->>'externalChatId') AS external_chat_id
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE (ct.user_id = $1 OR c.user_id = $1
             OR ($2::text IS NOT NULL
                 AND ('7' || RIGHT(REGEXP_REPLACE(COALESCE(ct.phone, c.visitor_phone, ''), '\\D', '', 'g'), 10)) = $2))
        AND ct.deleted_at IS NULL
        AND c.channel IN ('telegram','max','vk','whatsapp','instagram')
        AND c.status NOT IN ('closed')
        AND COALESCE(c.external_chat_id, c.metadata->>'externalChatId') IS NOT NULL
      ORDER BY CASE c.channel
                 WHEN 'telegram' THEN 1 WHEN 'max' THEN 2 WHEN 'vk' THEN 3
                 WHEN 'whatsapp' THEN 4 WHEN 'instagram' THEN 5 ELSE 9 END,
               c.last_message_at DESC NULLS LAST
      LIMIT 1`,
    [userId, phoneNormalized],
  );
  if (!row?.external_chat_id) return null;
  return { channel: row.channel as MessengerChannel, externalChatId: row.external_chat_id };
}

/**
 * Явная цель доставки — диалог, выбранный сотрудником при регистрации из чата.
 * В отличие от resolveBestMessengerForUser НЕ фильтрует status='closed' (сотрудник
 * знает, в какой чат слать, даже если диалог закрыт) и идёт прямо по id, минуя
 * contacts.user_id. Возвращает null, если канал не messenger или нет external_chat_id.
 */
async function resolveMessengerFromConversation(conversationId: string): Promise<ResolvedMessenger | null> {
  const row = await db.queryOne<MessengerLookupRow>(
    `SELECT channel::text AS channel,
            COALESCE(external_chat_id, metadata->>'externalChatId') AS external_chat_id
       FROM conversations
      WHERE id = $1`,
    [conversationId],
  );
  if (!row?.external_chat_id || !MESSENGER_CHANNELS.includes(row.channel as MessengerChannel)) {
    log.warn('Target conversation is not a deliverable messenger, falling back', {
      conversationId,
      channel: row?.channel ?? null,
      hasExtId: Boolean(row?.external_chat_id),
    });
    return null;
  }
  return { channel: row.channel as MessengerChannel, externalChatId: row.external_chat_id };
}

/**
 * Дешёвая подсказка для UI: какой канал, скорее всего, получит ссылку.
 * Не обязывающий прогноз (резолв на отправке может отличаться).
 * Если мессенджера нет — честно сообщаем, что авто-доставки не будет:
 * 'sms' только когда SMS реально включён; иначе 'none' (доставлять некуда,
 * сотрудник закрывает клиента у стойки). Не валит prepare.
 */
export async function resolveSendChannelHint(
  userId: string | null,
  phoneNormalized: string,
): Promise<string> {
  const noMessengerHint = config.sms.enabled ? 'sms' : 'none';
  if (!userId) return noMessengerHint;
  try {
    const messenger = await resolveBestMessengerForUser(userId, phoneNormalized);
    return messenger ? messenger.channel : noMessengerHint;
  } catch (err) {
    log.warn('resolveSendChannelHint failed', { error: String(err) });
    return noMessengerHint;
  }
}

// ─── Постановка в очередь ─────────────────────────────────────────────────────

/**
 * Идемпотентно ставит/обновляет запись очереди отправки. Вызывается в транзакции
 * prepare (тот же client) после создания заявки.
 *
 * Гарды P0-1:
 *  - уже verified-аккаунт → не ставим (слать незачем);
 *  - недавняя успешная отправка на этот телефон (< 36ч) → не ставим (анти-дубль живому человеку).
 */
export async function enqueueInPersonConfirmSend(
  client: PoolClient,
  params: EnqueueInPersonConfirmSendParams,
): Promise<EnqueueInPersonConfirmSendResult> {
  const { verificationId, userId, phoneNormalized } = params;

  // Гард 1: уже подтверждённый студент — отправлять нечего.
  if (userId && (await hasVerifiedEducationAccount(userId))) {
    return { enqueued: false, reason: 'already_verified', sendAt: null, channelHint: null };
  }

  // Гард 2: анти-повтор по телефону — недавняя успешная отправка.
  const recent = await client.query(
    `SELECT 1 FROM student_inperson_confirm_sends
      WHERE phone_normalized = $1
        AND status = 'sent'
        AND sent_at > NOW() - INTERVAL '${RECENT_SEND_WINDOW_HOURS} hours'
      LIMIT 1`,
    [phoneNormalized],
  );
  if (recent.rows.length > 0) {
    return { enqueued: false, reason: 'recently_sent', sendAt: null, channelHint: null };
  }

  const sendAt = params.sendAt ?? (await computeNextDay9MskSendAt(client));

  const inserted = await client.query<{ send_at: string }>(
    `INSERT INTO student_inperson_confirm_sends
       (verification_id, user_id, phone_normalized, send_at, status, attempts)
     VALUES ($1, $2, $3, $4::timestamptz, 'pending', 0)
     ON CONFLICT (verification_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       phone_normalized = EXCLUDED.phone_normalized,
       send_at = EXCLUDED.send_at,
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       channel_used = NULL,
       sent_at = NULL,
       updated_at = NOW()
     RETURNING send_at`,
    [verificationId, userId, phoneNormalized, sendAt],
  );

  const channelHint = await resolveSendChannelHint(userId, phoneNormalized);
  return {
    enqueued: true,
    reason: 'enqueued',
    sendAt: inserted.rows[0]?.send_at ?? sendAt,
    channelHint,
  };
}

// ─── Немедленная доставка ссылки в личный чат ─────────────────────────────────

/** Итог немедленной отправки ссылки в диалог. */
export type InPersonConfirmChatOutcome = 'sent' | 'duplicate' | 'no_conversation' | 'failed';

/** Полный URL подтверждения — по нему же ловим анти-дубль в истории диалога. */
const CONFIRM_URL_NEEDLE = 'svoefoto.ru/education/in-person';
const IMMEDIATE_DEDUP_HOURS = 6;
/** Каналы БЕЗ внешней доставки (web-виджет/POS) — только messages + Socket.IO. */
const NON_MESSENGER_CHAT_CHANNELS = ['web', 'online', 'studio'];

/**
 * Немедленно кладёт ссылку-подтверждение ВИДИМЫМ сообщением в личный чат клиента —
 * любой канал, включая web (в отличие от отложенного deliverOne, который умеет только
 * мессенджеры/SMS и шлёт «тихо»). Паттерн как у scheduled-messages.service:
 * messages → broadcastToRoom('operator:message', visitor:<conv>) + broadcastChatMessage →
 * enqueueOutbound для внешних мессенджеров.
 *
 * Анти-дубль: не шлём, если полная ссылка уже в диалоге за последние 6ч (повторный
 * prepare того же клиента не плодит сообщения). Никогда не бросает наружу критично —
 * вызывающий (prepare) при 'failed' откатывается на отложенную отправку.
 */
export async function sendInPersonConfirmLinkToConversation(params: {
  conversationId: string;
  verificationId: string;
  employeeId: string | null;
}): Promise<{ outcome: InPersonConfirmChatOutcome; channel: string | null }> {
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'external_chat_id'>>(
    `SELECT channel,
            COALESCE(external_chat_id, metadata->>'externalChatId') AS external_chat_id
       FROM conversations WHERE id = $1`,
    [params.conversationId],
  );
  if (!conv) return { outcome: 'no_conversation', channel: null };

  // Анти-дубль: полная ссылка уже в этом диалоге за последние IMMEDIATE_DEDUP_HOURS ч.
  const dup = await db.queryOne<Pick<Messages, 'id'>>(
    `SELECT id FROM messages
      WHERE conversation_id = $1
        AND sender_type = 'operator'
        AND content LIKE '%' || $2 || '%'
        AND created_at > NOW() - INTERVAL '${IMMEDIATE_DEDUP_HOURS} hours'
      LIMIT 1`,
    [params.conversationId, CONFIRM_URL_NEEDLE],
  );
  if (dup) return { outcome: 'duplicate', channel: conv.channel };

  let senderName = 'Своё Фото';
  if (params.employeeId) {
    const emp = await db.queryOne<Pick<Users, 'display_name'>>(
      `SELECT display_name FROM users WHERE id = $1`,
      [params.employeeId],
    );
    if (emp?.display_name) senderName = emp.display_name;
  }
  const content = buildMessengerText();

  const inserted = await db.queryOne<Pick<Messages, 'id' | 'created_at'>>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'operator', $2, $3, 'text', $4)
     RETURNING id, created_at`,
    [params.conversationId, params.employeeId, senderName, content],
  );
  if (!inserted) return { outcome: 'failed', channel: conv.channel };

  await db.query(
    `UPDATE conversations
        SET last_message_content = LEFT($2, 200),
            last_message_at = NOW(),
            message_count = COALESCE(message_count, 0) + 1,
            status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END,
            updated_at = NOW()
      WHERE id = $1`,
    [params.conversationId, content],
  );

  // Live-доставка в виджет клиента.
  broadcastToRoom('operator:message', `visitor:${params.conversationId}`, {
    sessionId: params.conversationId,
    content,
    senderName,
    senderType: 'operator',
    messageType: 'text',
    timestamp: inserted.created_at,
    sender_id: params.employeeId,
  });

  // Обновить операторский инбокс.
  await broadcastChatMessage({
    sessionId: params.conversationId,
    message: {
      id: inserted.id,
      conversation_id: params.conversationId,
      content,
      sender_type: 'operator',
      sender_id: params.employeeId,
      sender_name: senderName,
      message_type: 'text',
      created_at: inserted.created_at,
    },
  }).catch((err: unknown) => log.warn('broadcastChatMessage failed', { error: String(err) }));

  // Внешний мессенджер — продублировать доставку в его API.
  if (conv.external_chat_id && !NON_MESSENGER_CHAT_CHANNELS.includes(conv.channel)) {
    enqueueOutbound({
      channel: conv.channel,
      externalChatId: conv.external_chat_id,
      content,
      messageType: 'text',
      conversationId: params.conversationId,
      dedupKey: `inperson-confirm:${params.verificationId}`,
    }).catch((err: unknown) => log.warn('enqueueOutbound failed', { error: String(err) }));
  }

  log.info('In-person confirm link delivered to chat', {
    conversationId: params.conversationId,
    channel: conv.channel,
  });
  return { outcome: 'sent', channel: conv.channel };
}

// ─── Планировщик отправки ─────────────────────────────────────────────────────

/**
 * Атомарно «забирает» due-записи в статус 'sending' (FOR UPDATE SKIP LOCKED),
 * инкрементит attempts. Заодно восстанавливает зависшие в 'sending' дольше 15 минут.
 */
async function claimDueSends(): Promise<DueSendRow[]> {
  const claimed = await db.query<DueSendRow>(
    `UPDATE student_inperson_confirm_sends s
        SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
       FROM (
         SELECT id FROM student_inperson_confirm_sends
          WHERE (status = 'pending' AND send_at <= NOW())
             OR (status = 'sending' AND updated_at < NOW() - INTERVAL '${STUCK_SENDING_MINUTES} minutes')
          ORDER BY send_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${CLAIM_LIMIT}
       ) d
      WHERE s.id = d.id
     RETURNING s.id, s.verification_id, s.user_id, s.phone_normalized, s.attempts`,
  );
  return claimed;
}

async function markSent(id: string, channel: string): Promise<void> {
  await db.query(
    `UPDATE student_inperson_confirm_sends
        SET status = 'sent', channel_used = $2, sent_at = NOW(), last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id, channel],
  );
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE student_inperson_confirm_sends
        SET status = 'skipped', last_error = $2, updated_at = NOW()
      WHERE id = $1`,
    [id, reason],
  );
}

/**
 * Финал после неуспешной доставки: failed при исчерпании попыток, иначе обратно
 * в pending для ретрая на следующем due-тике (send_at не двигаем).
 */
async function markFailedOrRetry(id: string, attempts: number, error: string): Promise<void> {
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  await db.query(
    `UPDATE student_inperson_confirm_sends
        SET status = $2, last_error = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, status, error],
  );
}

/** Доставка одной claimed-записи. */
async function deliverOne(row: DueSendRow): Promise<void> {
  // Перепроверка актуальности заявки на момент отправки.
  const verification = await db.queryOne<VerificationTargetLookupRow>(
    `SELECT status, target_conversation_id FROM student_verifications WHERE id = $1`,
    [row.verification_id],
  );
  if (!verification || verification.status !== 'pending_in_person') {
    await markSkipped(row.id, `verification ${verification?.status ?? 'missing'}`);
    return;
  }

  // P1-3: студент мог уже стать verified между enqueue и отправкой.
  if (row.user_id && (await hasVerifiedEducationAccount(row.user_id))) {
    await markSkipped(row.id, 'already_verified');
    return;
  }

  // Попытка доставки в мессенджер. Приоритет: явный target-диалог (сотрудник выбрал
  // при регистрации из чата) → лучший привязанный мессенджер пользователя.
  let messenger: ResolvedMessenger | null = null;
  if (verification.target_conversation_id) {
    messenger = await resolveMessengerFromConversation(verification.target_conversation_id);
  }
  if (!messenger && row.user_id) {
    messenger = await resolveBestMessengerForUser(row.user_id, row.phone_normalized);
  }
  if (messenger) {
    const ok = await deliverToChannel(messenger.channel, messenger.externalChatId, buildMessengerText());
    if (ok) {
      await markSent(row.id, messenger.channel);
      return;
    }
    log.warn('Messenger delivery failed, falling back to SMS', {
      channel: messenger.channel,
      phone: maskPhone(row.phone_normalized),
    });
  }

  // SMS-фолбэк: нет мессенджера или доставка не прошла (24ч-окно/disabled/no adapter).
  // smsId 'disabled'/'test' = реальной отправки НЕ было → не помечаем ложный sent.
  const sms = await sendSms(row.phone_normalized, buildSmsText());
  const smsNotReallySent = sms.smsId === 'disabled' || sms.smsId === 'test';
  if (sms.success && !smsNotReallySent) {
    await markSent(row.id, 'sms');
    return;
  }
  if (smsNotReallySent) {
    // SMS отключён/тестовый режим — не ложный успех, фиксируем явно.
    await markSkipped(row.id, 'sms_disabled');
    return;
  }
  await markFailedOrRetry(row.id, row.attempts, sms.error ?? 'sms failed');
}

/**
 * Прогон планировщика: claim due-записей и доставка по одной.
 * Killswitch INPERSON_CONFIRM_SEND_ENABLED=false → ничего не шлём (enqueue копит).
 */
export async function processDueInPersonConfirmSends(): Promise<void> {
  if (process.env['INPERSON_CONFIRM_SEND_ENABLED'] === 'false') return;

  try {
    const claimed = await claimDueSends();
    if (claimed.length === 0) return;

    for (const row of claimed) {
      try {
        await deliverOne(row);
      } catch (err) {
        log.error('Delivery error', { id: row.id, error: String(err) });
        try {
          await markFailedOrRetry(row.id, row.attempts, String(err));
        } catch (markErr) {
          log.error('Failed to mark send outcome', { id: row.id, error: String(markErr) });
        }
      }
    }
    log.info(`Processed ${claimed.length} in-person confirm sends`);
  } catch (err) {
    log.error('processDueInPersonConfirmSends error', { error: String(err) });
  }
}

// ─── Регистрация планировщика (leader-only) ───────────────────────────────────

export function startInPersonConfirmScheduler(): void {
  if (intervalHandle) {
    log.warn('Scheduler already running');
    return;
  }
  log.info(`Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);
  setTimeout(() => {
    processDueInPersonConfirmSends();
  }, FIRST_RUN_DELAY_MS);
  intervalHandle = setInterval(processDueInPersonConfirmSends, INTERVAL_MS);
}

export function stopInPersonConfirmScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Scheduler stopped');
  }
}

export { computeNextDay9MskSendAt, buildMessengerText, buildSmsText };
