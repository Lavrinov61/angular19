import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-client-resolver');

/**
 * Cascading client_id lookup:
 * 1. By phone → users.id
 * 2. By chat_session_id → conversations.user_id
 * 3. By chat_session_id → conversations.contact_id → contacts.user_id
 * 4. By chat_session_id → telegram conversation external_chat_id → users.telegram_id
 */
export async function resolveClientId(data: {
  client_phone?: string | null;
  chat_session_id?: string | null;
}): Promise<string | null> {
  const phone = data.client_phone || null;
  const chatSessionId = data.chat_session_id || null;

  if (!phone && !chatSessionId) return null;

  const row = await db.queryOne<{ client_id: string | null }>(
    `SELECT COALESCE(
       (SELECT id FROM users WHERE phone = $1 LIMIT 1),
       (SELECT user_id FROM conversations WHERE id = $2 AND user_id IS NOT NULL LIMIT 1),
       (SELECT c.user_id FROM conversations conv JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.id = $2 AND c.user_id IS NOT NULL LIMIT 1),
       (SELECT u.id FROM conversations conv JOIN users u ON u.telegram_id = conv.external_chat_id
        WHERE conv.id = $2 AND conv.channel = 'telegram' AND u.telegram_id IS NOT NULL LIMIT 1)
     ) AS client_id`,
    [phone, chatSessionId]
  );

  const clientId = row?.client_id ?? null;
  if (clientId) {
    log.info('Resolved client_id', { clientId, phone: phone ? '***' : null, chatSessionId });
  }

  return clientId;
}
