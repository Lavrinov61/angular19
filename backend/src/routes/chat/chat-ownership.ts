import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { ChatOwnedConversationRow } from '../../types/views/chat-views.js';

export interface OwnedConversation {
  id: string;
  contact_id: string;
  channel: string;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Проверяет, что разговор принадлежит контакту текущего пользователя.
 * Бросает 404 если conversation не найден, 403 при ownership mismatch.
 *
 * Паттерн ownership: users.id -> contacts.user_id -> conversations.contact_id.
 */
export async function getOwnedConversation(
  userId: string,
  conversationId: string,
): Promise<OwnedConversation> {
  const { rows } = await pool.query<ChatOwnedConversationRow>(
    `SELECT c.id, c.contact_id, c.channel, c.status, c.created_at, c.updated_at,
            ct.user_id
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
      WHERE c.id = $1
      LIMIT 1`,
    [conversationId],
  );

  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'Conversation not found');
  }
  if (!row.contact_id || row.user_id !== userId) {
    throw new AppError(403, 'Forbidden: not your conversation');
  }

  return {
    id: row.id,
    contact_id: row.contact_id,
    channel: row.channel,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
