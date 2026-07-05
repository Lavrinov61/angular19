/**
 * Детектор осиротевших карт-оплат POS (leader-only sweep).
 *
 * Orphan = pos_transactions(transaction_type='payment', status='completed') без
 * привязанного чека. Деньги списаны терминалом, чек не оформился. Sweep
 * обнаруживает такие оплаты и уведомляет:
 *  - сотрудника (NotificationService персонально initiated_by + studio-room broadcast);
 *  - клиента в привязанный чат (за флагом POS_ORPHAN_CLIENT_NOTIFY_ENABLED), один раз.
 *
 * Чек НЕ создаётся автоматически (решение владельца) — кассир оформляет кнопкой
 * через POST /api/pos/payments/:id/create-receipt.
 *
 * Дедуп уведомлений — CAS по orphan_notified_at / orphan_client_notified_at.
 * Регистрируется в server.ts под monolith-leader (БЕЗ нового advisory-lock).
 */

import db from '../database/db.js';
import { config } from '../config/index.js';
import { findOrphanPayments, type OrphanPaymentRow } from './pos.service.js';
import { NotificationService } from './notification.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { enqueueOutbound } from './connectors/pipeline/outbound-worker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pos-orphan-payment-sweep');

const FIRST_RUN_DELAY_MS = 60_000; // первый прогон через 60с после старта

/** Каналы, в которые имеет смысл слать сообщение клиенту (deliverable messenger). */
const MESSENGER_CHANNELS = ['telegram', 'max', 'vk', 'whatsapp', 'instagram'];

let intervalHandle: ReturnType<typeof setInterval> | null = null;

interface ResolvedConversation {
  conversationId: string;
  channel: string;
  externalChatId: string;
}

/** Текст денежной суммы для клиента: целые рубли без копеек, иначе с копейками. */
function formatRub(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * Привязанный диалог клиента по оплате. У реальных orphan order_id обычно NULL,
 * поэтому идём от studio + (если есть) телефона снимка корзины к contacts→conversations.
 * Без снимка телефона привязать диалог нельзя → возвращаем null (только сотруднику).
 */
async function resolveClientConversation(row: OrphanPaymentRow): Promise<ResolvedConversation | null> {
  const phone = row.command_payload?.snapshot?.customerPhone;
  if (typeof phone !== 'string' || phone.trim() === '') return null;

  const conv = await db.queryOne<{ id: string; channel: string; external_chat_id: string | null }>(
    `SELECT c.id, c.channel::text AS channel,
            COALESCE(c.external_chat_id, c.metadata->>'externalChatId') AS external_chat_id
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
      WHERE ct.deleted_at IS NULL
        AND ct.phone = $1
        AND c.channel = ANY($2::text[])
        AND c.status NOT IN ('closed')
        AND COALESCE(c.external_chat_id, c.metadata->>'externalChatId') IS NOT NULL
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 1`,
    [phone.trim(), MESSENGER_CHANNELS],
  );
  if (!conv?.external_chat_id) return null;
  return { conversationId: conv.id, channel: conv.channel, externalChatId: conv.external_chat_id };
}

/**
 * Уведомить сотрудника. CAS orphan_notified_at идемпотентен: первый прогон ставит
 * timestamp, второй — 0 строк (не спамим). При initiated_by IS NULL персональной
 * notification нет (NotificationService требует userId) — шлём ТОЛЬКО studio-room
 * broadcast, чтобы orphan был виден admin/manager смены (P1.3).
 */
async function notifyStaff(row: OrphanPaymentRow): Promise<void> {
  const claimed = await db.queryOne<{ id: string }>(
    `UPDATE pos_transactions
        SET orphan_notified_at = NOW(),
            orphan_detected_at = COALESCE(orphan_detected_at, NOW())
      WHERE id = $1 AND orphan_notified_at IS NULL
      RETURNING id`,
    [row.id],
  );
  if (!claimed) return; // уже уведомляли — дедуп

  const amount = Number.parseFloat(row.amount);
  const title = 'Оплата без чека';
  const body = `Оплата ${formatRub(amount)} ₽ прошла, но чек не оформлен. Оформите чек в кассе.`;

  broadcastToRoom('pos:orphan_payment', `studio:${row.studio_id}`, {
    payment_id: row.id,
    studio_id: row.studio_id,
    amount,
    initiated_by: row.initiated_by,
  });

  // P1.3: персональная notification только при наличии инициатора.
  if (row.initiated_by) {
    await NotificationService.create({
      userId: row.initiated_by,
      title,
      body,
      type: 'payment_confirmed',
      data: { paymentId: row.id, studioId: row.studio_id, amount },
    });
  }
}

/**
 * Уведомить клиента о факте получения оплаты (один раз, за флагом). P1.4: перед
 * отправкой ре-чек, что оплата ВСЁ ЕЩЁ orphan (кассир не оформил чек в промежутке),
 * затем CAS orphan_client_notified_at. Текст — про факт получения денег (ответ на
 * тревогу клиента «было ли списание»), без реквизитов карты/чека.
 */
async function notifyClient(row: OrphanPaymentRow): Promise<void> {
  if (!config.pos.orphanClientNotifyEnabled) return;

  const conv = await resolveClientConversation(row);
  if (!conv) return; // нет привязанного диалога → наружу не шлём

  // P1.4 ре-чек + CAS: оплата всё ещё orphan И клиента ещё не уведомляли.
  const claimed = await db.queryOne<{ id: string }>(
    `UPDATE pos_transactions
        SET orphan_client_notified_at = NOW()
      WHERE id = $1
        AND transaction_type = 'payment'
        AND status = 'completed'
        AND settled_receipt_id IS NULL
        AND payment_resolution IS NULL
        AND orphan_client_notified_at IS NULL
      RETURNING id`,
    [row.id],
  );
  if (!claimed) return; // оформлен/уже уведомлён — не шлём

  const amount = Number.parseFloat(row.amount);
  await enqueueOutbound({
    channel: conv.channel as Parameters<typeof enqueueOutbound>[0]['channel'],
    externalChatId: conv.externalChatId,
    conversationId: conv.conversationId,
    content: `Здравствуйте! Ваша оплата на ${formatRub(amount)} ₽ получена, спасибо.`,
    dedupKey: `pos-orphan-client:${row.id}`,
  });
}

/**
 * Прогон детектора: находит orphan-оплаты и уведомляет. Killswitch — флаг
 * POS_ORPHAN_DETECT_ENABLED (ранний выход при OFF).
 */
export async function processOrphanPayments(): Promise<void> {
  if (!config.pos.orphanDetectEnabled) return;

  try {
    const rows = await findOrphanPayments(undefined, config.pos.orphanPaymentAgeMinutes);
    if (rows.length === 0) return;

    let notified = 0;
    for (const row of rows) {
      try {
        await notifyStaff(row);
        await notifyClient(row);
        notified++;
      } catch (err) {
        log.error('Orphan notify error', { paymentId: row.id, error: String(err) });
      }
    }
    if (notified > 0) log.info(`Processed ${notified} orphan payment(s)`);
  } catch (err) {
    log.error('processOrphanPayments error', { error: String(err) });
  }
}

// ─── Регистрация планировщика (leader-only) ───────────────────────────────────

export function startOrphanPaymentSweep(): void {
  if (intervalHandle) {
    log.warn('Sweep already running');
    return;
  }
  const intervalMs = config.pos.orphanCheckIntervalMs;
  log.info(`Sweep started (interval: ${intervalMs / 1000}s)`);
  setTimeout(() => {
    processOrphanPayments();
  }, FIRST_RUN_DELAY_MS);
  intervalHandle = setInterval(processOrphanPayments, intervalMs);
}

export function stopOrphanPaymentSweep(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Sweep stopped');
  }
}
