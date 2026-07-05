/**
 * Broadcast inline-button callbacks (handled synchronously in telegram.adapter handleSpecialEvent).
 *
 * Three buttons ride on every broadcast message:
 *  - «📍 Наши адреса» (BCAST_ADDRESSES) → bot replies with every physical studio address from
 *    the `studios` table (DB-driven; new studios appear automatically).
 *  - «❌ Отписаться» (BCAST_UNSUB)      → record marketing_suppressions(reason='unsubscribe').
 *    This is the bot's survival valve: an annoyed recipient opts out quietly instead of pressing
 *    Telegram's "report spam", which on a SHARED token would get the WHOLE bot (incl. live support)
 *    rate-limited/banned.
 *  - «🙋 Я не студент» (BCAST_NOT_STUDENT) → drop an operator-only internal_note into the client's
 *    conversation + live-notify operators, so a human can clarify and offer an individual deal.
 *    Turns a mis-targeted promo into a warm lead instead of a dead-end.
 *
 * The client only ever receives a friendly ack text (returned to the adapter, which sends it).
 */

import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import { broadcastChatMessage } from '../chat-broadcast.service.js';
import { BCAST_UNSUB, BCAST_NOT_STUDENT, BCAST_ADDRESSES, isBroadcastCallback } from './broadcast-callbacks.constants.js';

const log = createLogger('broadcast-callbacks');

export { BCAST_UNSUB, BCAST_NOT_STUDENT, BCAST_ADDRESSES, isBroadcastCallback };

interface ConvRow {
  id: string;
  contact_id: string | null;
}

interface StudioRow {
  name: string;
  address: string;
}

/** Escape the three HTML chars Telegram's HTML parse_mode cares about. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the «Наши адреса» reply from the studios table — every physical, open studio with a
 * real street address. Excludes the virtual 'online' shift and test rows (location_code gate).
 * Fully DB-driven: a new physical studio (location_code set, not 'online') appears automatically.
 * Studio NAMES are <b>bold</b> (HTML parse_mode) so the reply is scannable — name vs address
 * no longer blend into one wall of text. Sent with parseMode='HTML' (see handleBroadcastCallback).
 */
async function buildAddressesReply(): Promise<{ text: string; html: boolean }> {
  const rows = await db.query<StudioRow>(
    `SELECT name, address
     FROM studios
     WHERE status = 'open'
       AND location_code IS NOT NULL AND location_code <> 'online'
       AND address IS NOT NULL AND length(trim(address)) >= 6
     ORDER BY name`,
  );
  if (rows.length === 0) {
    return { text: 'Адреса временно недоступны — напишите нам прямо в этот чат, подскажем 🙌', html: false };
  }
  const lines = rows.map((s) => `📍 <b>${escapeHtml(s.name)}</b>\n${escapeHtml(s.address)}`).join('\n\n');
  return { text: `<b>Наши студии</b>\n\n${lines}`, html: true };
}

interface NoteRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_name: string | null;
  message_type: string;
  content: string;
  created_at: Date;
  // Index signature so the row satisfies broadcastChatMessage's BroadcastMessageData shape.
  [key: string]: unknown;
}

/** Resolve the client's conversation on the given channel by chat_id — prefer a non-closed one. */
async function resolveConversation(
  chatId: string,
  channel: 'telegram' | 'max' = 'telegram',
): Promise<ConvRow | null> {
  return db.queryOne<ConvRow>(
    `SELECT id, contact_id
     FROM conversations
     WHERE channel = $2 AND external_chat_id = $1
     ORDER BY (status <> 'closed') DESC, created_at DESC
     LIMIT 1`,
    [chatId, channel],
  );
}

/**
 * Handle a broadcast inline-button callback.
 * @returns { ackText, parseMode? } to send back to the client, or null if `data` is not ours.
 */
export async function handleBroadcastCallback(
  chatId: string,
  data: string,
  channel: 'telegram' | 'max' = 'telegram',
): Promise<{ ackText: string; parseMode?: string } | null> {
  if (!chatId || !isBroadcastCallback(data)) return null;

  if (data === BCAST_ADDRESSES) {
    // No conversation lookup needed — just reply with the studio addresses from the DB.
    const reply = await buildAddressesReply();
    return { ackText: reply.text, parseMode: reply.html ? 'HTML' : undefined };
  }

  const conv = await resolveConversation(chatId, channel);

  if (data === BCAST_UNSUB) {
    // Honour the opt-out forever. contact_id keys the materialization suppression filter;
    // external_chat_id is kept too (survives PD erasure — see architecture §3.5).
    await db.query(
      `INSERT INTO marketing_suppressions (contact_id, external_chat_id, reason)
       VALUES ($1, $2, 'unsubscribe')
       ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING`,
      [conv?.contact_id ?? null, chatId],
    );
    log.info('broadcast: client unsubscribed', { chatId, contactId: conv?.contact_id ?? null });
    return {
      ackText: '<b>Готово, вы отписаны от рассылки.</b> Личная переписка с нами работает как обычно, пишите в любой момент 🙌',
      parseMode: 'HTML',
    };
  }

  // BCAST_NOT_STUDENT — invite the client to describe their occupation (so we can craft a tailored
  // offer) AND surface a lead to the operator panel (internal note, not sent to the client).
  if (conv?.id) {
    try {
      const note = await db.queryOne<NoteRow>(
        `INSERT INTO messages
           (conversation_id, sender_type, sender_id, sender_name, message_type, content)
         VALUES ($1, 'internal_note', 'system', 'Бот · рассылка', 'text',
                 '🙋 Клиент нажал «Я не студент» по студенческой акции. Бот попросил рассказать, чем он занимается и какая услуга может потребоваться. Ждём ответ клиента, затем подобрать индивидуальное предложение.')
         RETURNING id, conversation_id, sender_type, sender_name, message_type, content, created_at`,
        [conv.id],
      );
      if (note) {
        await broadcastChatMessage({ sessionId: conv.id, message: note }).catch((err) =>
          log.warn('broadcast: notify operator failed', { chatId, error: String(err) }),
        );
      }
      log.info('broadcast: not-a-student lead surfaced to operator', {
        chatId, conversationId: conv.id, contactId: conv.contact_id ?? null,
      });
    } catch (err) {
      log.error('broadcast: not-a-student note insert failed', { chatId, error: String(err) });
    }
  } else {
    log.warn('broadcast: not-a-student callback but no conversation found', { chatId });
  }
  return {
    ackText:
      '<b>Спасибо, что отметились!</b> 🙌\n\nРасскажите парой слов, чем вы занимаетесь (учёба, работа, '
      + 'бизнес, хобби) и <b>какая услуга вам может потребоваться</b>. Возможно, подберём для вас '
      + '<b>специальное предложение</b>.\n\nПросто напишите ответ прямо сюда 👇',
    parseMode: 'HTML',
  };
}
