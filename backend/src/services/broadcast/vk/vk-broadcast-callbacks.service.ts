/**
 * VK broadcast inline-button callbacks — обрабатываются в vk.adapter handleSpecialEvent
 * (message_event), который dynamic-import'ит этот модуль и зовёт handleVkBroadcastCallback.
 *
 * Контракт (объявлен в vk.adapter.ts S3, НЕ менять сигнатуру):
 *   handleVkBroadcastCallback(peerId: number, payload: unknown) => Promise<{snackbar?: string} | void>
 * Возвращаемый {snackbar} адаптер показывает пользователю через sendMessageEventAnswer.
 *
 * P0-2 ИДЕМПОТЕНТНОСТЬ: VK может прислать message_event ПОВТОРНО, если наш ack
 * (sendMessageEventAnswer) не успел за окно event_id (~60с) или webhook ретраился. Поэтому
 * каждая ветка должна быть безопасна при повторе:
 *  - UNSUB        → INSERT marketing_suppressions ON CONFLICT DO NOTHING (+ channel_users.opted_in=false).
 *  - NOT_STUDENT  → internal_note ТОЛЬКО если такой заметки в этой конверсации ещё нет
 *                   (dedup по metadata-маркеру) → при ретрае заметка не плодится.
 *  - ADDRESSES    → чистое чтение (адреса студий) → идемпотентно по природе.
 *
 * Три кнопки = аналог TG (broadcast-callbacks.service.ts), но VK: ответ идёт snackbar'ом
 * (короткий, ≤90 симв., режется в адаптере), не отдельным сообщением. Для адресов snackbar
 * слишком мал — шлём адреса отдельным VK-сообщением через адаптер, snackbar даёт лишь
 * подтверждение.
 */

import db from '../../../database/db.js';
import type { PoolClient } from 'pg';
import { createLogger } from '../../../utils/logger.js';
import { broadcastChatMessage } from '../../chat-broadcast.service.js';
import { getAccountByChannel } from '../../connectors/core/account-store.js';
import { getAdapter } from '../../connectors/core/adapter-registry.js';
import {
  VK_BCAST_UNSUB,
  VK_BCAST_NOT_STUDENT,
  VK_BCAST_ADDRESSES,
  parseVkBroadcastCmd,
} from './vk-broadcast-callbacks.constants.js';

const log = createLogger('vk-broadcast-callbacks');

// Маркер в messages.metadata, по которому дедупим заметку «Я не студент» (P0-2).
const NOT_STUDENT_NOTE_MARKER = 'vk_bcast_not_student';

interface ConvRow {
  id: string;
  contact_id: string | null;
}

interface StudioRow {
  name: string;
  address: string;
}

interface NoteRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_name: string | null;
  message_type: string;
  content: string;
  created_at: Date;
  // Index-signature, чтобы строка удовлетворяла BroadcastMessageData.
  [key: string]: unknown;
}

/** Найти VK-конверсацию по peer_id — предпочесть не-закрытую. */
async function resolveVkConversation(peerId: number): Promise<ConvRow | null> {
  return db.queryOne<ConvRow>(
    `SELECT id, contact_id
     FROM conversations
     WHERE channel = 'vk' AND external_chat_id = $1
     ORDER BY (status <> 'closed') DESC, created_at DESC
     LIMIT 1`,
    [String(peerId)],
  );
}

/** Собрать ответ «Наши адреса» из таблицы studios (только физические открытые студии). */
async function buildAddressesText(): Promise<string> {
  const rows = await db.query<StudioRow>(
    `SELECT name, address
     FROM studios
     WHERE status = 'open'
       AND location_code IS NOT NULL AND location_code <> 'online'
       AND address IS NOT NULL AND length(trim(address)) >= 6
     ORDER BY name`,
  );
  if (rows.length === 0) {
    return 'Адреса временно недоступны. Напишите нам прямо в этот чат, подскажем 🙌';
  }
  // VK-сообщения plain-text (без жирного). Тире в названии студии (БД: «Своё Фото — Баррикадная»)
  // заменяем на запятую — правило проекта «без тире».
  const lines = rows
    .map((s) => `📍 ${s.name.replace(/\s*[—–]\s*/g, ', ')}\n${s.address}`)
    .join('\n\n');
  return `Наши студии:\n\n${lines}`;
}

/** Отправить произвольный текст в VK-диалог (ответы на callback идут сообщением, не snackbar'ом). */
async function sendVkText(peerId: number, text: string): Promise<void> {
  const account = await getAccountByChannel('vk');
  const adapter = getAdapter('vk');
  if (!account || !adapter) {
    log.warn('vk callback reply: no vk account/adapter — skipping', { peerId });
    return;
  }
  await adapter.sendText(account, String(peerId), text);
}

/**
 * P0-2: записать internal_note «Я не студент» идемпотентно. Если в конверсации уже есть
 * наша заметка-маркер — повтор НЕ создаёт дубль (возвращаем существующую — её не нужно
 * повторно нотифицировать). Возвращает свежесозданную строку для live-notify, либо null
 * (заметка уже была / нет конверсации).
 */
async function insertNotStudentNoteOnce(conv: ConvRow): Promise<NoteRow | null> {
  return db.transaction(async (client: PoolClient) => {
    // Дедуп: одна заметка-маркер на конверсацию. SELECT ... FOR UPDATE по конверсации не
    // нужен (две параллельные вставки маловероятны для одного peer), но EXISTS-гейт
    // защищает от повторного message_event при ретрае ack.
    const existing = await client.query(
      `SELECT 1 FROM messages
       WHERE conversation_id = $1
         AND sender_type = 'internal_note'
         AND metadata ->> 'bcastNote' = $2
       LIMIT 1`,
      [conv.id, NOT_STUDENT_NOTE_MARKER],
    );
    if (existing.rows.length > 0) {
      return null;
    }

    const res = await client.query(
      `INSERT INTO messages
         (conversation_id, sender_type, sender_id, sender_name, message_type, content, metadata)
       VALUES ($1, 'internal_note', 'system', 'Бот · VK-рассылка', 'text',
               '🙋 Клиент нажал «Я не студент» по студенческой акции (VK). Бот попросил рассказать, чем он занимается. Ждём ответ клиента, затем подобрать индивидуальное предложение.',
               jsonb_build_object('bcastNote', $2::text))
       RETURNING id, conversation_id, sender_type, sender_name, message_type, content, created_at`,
      [conv.id, NOT_STUDENT_NOTE_MARKER],
    );
    return (res.rows[0] as NoteRow) ?? null;
  });
}

/**
 * Обработать нажатие callback-кнопки VK-рассылки.
 * @returns { snackbar } для показа пользователю (через sendMessageEventAnswer), или void
 *          если payload не наш.
 */
export async function handleVkBroadcastCallback(
  peerId: number,
  payload: unknown,
): Promise<{ snackbar?: string } | void> {
  const cmd = parseVkBroadcastCmd(payload);
  if (!cmd || !peerId) return;

  // ── «📍 Наши адреса» — чистое чтение, идемпотентно по природе ───────────────
  // Ответ идёт СООБЩЕНИЕМ в диалог (читаемо, остаётся в истории), snackbar НЕ показываем
  // (мелькает сверху и режется) — ack без event_data просто снимает «загрузку» кнопки.
  if (cmd === VK_BCAST_ADDRESSES) {
    try {
      await sendVkText(peerId, await buildAddressesText());
    } catch (err) {
      log.warn('vk addresses reply failed', { peerId, error: String(err) });
    }
    return {};
  }

  const conv = await resolveVkConversation(peerId);

  // ── «❌ Отписаться» — opt-out навсегда (идемпотентно: ON CONFLICT DO NOTHING) ─
  if (cmd === VK_BCAST_UNSUB) {
    await db.transaction(async (client: PoolClient) => {
      // contact_id ключует фильтр материализации; external_chat_id переживает PD-erasure.
      await client.query(
        `INSERT INTO marketing_suppressions (contact_id, external_chat_id, reason)
         VALUES ($1, $2, 'unsubscribe')
         ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING`,
        [conv?.contact_id ?? null, String(peerId)],
      );
      // Дополнительно гасим opt-in в channel_users (VK opt-in — источник аудитории
      // материализации); идемпотентно — повторный UPDATE того же ряда безопасен.
      await client.query(
        `UPDATE channel_users
         SET opted_in = false, opted_out_at = COALESCE(opted_out_at, now())
         WHERE channel = 'vk' AND external_user_id = $1`,
        [String(peerId)],
      );
    });
    log.info('vk broadcast: client unsubscribed', { peerId, contactId: conv?.contact_id ?? null });
    await sendVkText(peerId, 'Готово, вы отписались от рассылки 🙌 Больше сообщений по ней не пришлём.')
      .catch((err) => log.warn('vk unsub reply failed', { peerId, error: String(err) }));
    return {};
  }

  // ── «🙋 Я не студент» — тёплый лид оператору (internal_note, dedup P0-2) ─────
  if (cmd === VK_BCAST_NOT_STUDENT) {
    if (conv?.id) {
      try {
        const note = await insertNotStudentNoteOnce(conv);
        if (note) {
          // Свежая заметка → нотифицируем оператора live. При ретрае note=null → не дублируем.
          await broadcastChatMessage({ sessionId: conv.id, message: note }).catch((err) =>
            log.warn('vk broadcast: notify operator failed', { peerId, error: String(err) }),
          );
          log.info('vk broadcast: not-a-student lead surfaced to operator', {
            peerId, conversationId: conv.id, contactId: conv.contact_id ?? null,
          });
        } else {
          log.debug('vk broadcast: not-a-student note already exists — dedup (no duplicate)', {
            peerId, conversationId: conv.id,
          });
        }
      } catch (err) {
        log.error('vk broadcast: not-a-student note insert failed', { peerId, error: String(err) });
      }
    } else {
      log.warn('vk broadcast: not-a-student callback but no conversation found', { peerId });
    }
    await sendVkText(peerId, 'Спасибо! Напишите прямо в этот диалог, чем занимаетесь, и мы подберём для вас предложение 🙌')
      .catch((err) => log.warn('vk not-student reply failed', { peerId, error: String(err) }));
    return {};
  }
}
