/**
 * chat-link.service.ts — Auto-link orders to existing chat sessions by phone number.
 */
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('chat-link');

/**
 * Find an active/waiting conversation matching the last 10 digits of the phone,
 * and link it to the given print order.
 */
export async function linkChatByPhone(phone: string | undefined, orderId: string): Promise<void> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return;
  try {
    const last10 = digits.slice(-10);
    const chat = await db.queryOne<{ id: string }>(
      `SELECT id FROM conversations
       WHERE RIGHT(REPLACE(visitor_phone, '+', ''), 10) = $1
         AND status IN ('active', 'waiting')
       ORDER BY created_at DESC LIMIT 1`,
      [last10]
    );
    if (chat) {
      await db.query(
        `UPDATE photo_print_orders SET chat_session_id = $1 WHERE order_id = $2`,
        [chat.id, orderId]
      );
      log.info(`[PrintOrder ${orderId}] Auto-linked to chat ${chat.id}`);
    }
  } catch (err) {
    log.warn(`[PrintOrder ${orderId}] Auto-link chat failed:`, { error: String(err) });
  }
}
