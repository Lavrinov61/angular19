/**
 * Omnichannel v2 — Email Thread Resolver
 *
 * Resolves In-Reply-To / References headers to conversation threads.
 * Maps RFC 2822 message IDs to conversations table.
 */

import db from '../../../database/db.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('email-thread-resolver');

/**
 * Find existing conversation by In-Reply-To header.
 * Looks up messages.metadata.messageId for the referenced message,
 * then returns its conversation_id.
 */
export async function resolveThreadConversation(
  inReplyTo: string | null,
  fromEmail: string,
): Promise<string | null> {
  if (!inReplyTo) return null;

  // 1. Check new messages table (post-migration)
  const newMsg = await db.queryOne<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages
     WHERE metadata->>'messageId' = $1 LIMIT 1`,
    [inReplyTo],
  );
  if (newMsg?.conversation_id) return newMsg.conversation_id;

  // 2. Check conversations by threadId in metadata
  const conv = await db.queryOne<{ id: string }>(
    `SELECT id FROM conversations
     WHERE channel = 'email' AND metadata->>'threadId' = $1 LIMIT 1`,
    [inReplyTo],
  );
  if (conv?.id) return conv.id;

  log.debug('No thread found for In-Reply-To', { inReplyTo, fromEmail });
  return null;
}

/**
 * Generate a thread ID for a new email conversation.
 * Uses the Message-ID of the first email in the thread.
 */
export function generateThreadId(messageId: string | null): string {
  return messageId || `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
