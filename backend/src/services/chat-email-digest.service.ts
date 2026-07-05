/**
 * chat-email-digest.service.ts — Email digest for offline visitors
 *
 * Every 15 minutes, checks for sessions where:
 * - operator sent unread messages > 15 min ago
 * - visitor has email
 * - email not already sent (within last hour)
 */
import { pool } from '../database/db.js';
import { sendChatDigestEmail, type ChatDigestMessage } from './email.service.js';

import { createLogger } from '../utils/logger.js';
let digestInterval: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('chat-email-digest.service');
async function runDigestCycle(): Promise<void> {
  try {
    // Find sessions with unread operator messages older than 15 min, visitor has email
    const sessions = await pool.query(
      `SELECT s.id, s.visitor_email, s.visitor_name, s.metadata
       FROM conversations s
       WHERE s.status IN ('open', 'active')
         AND s.visitor_email IS NOT NULL
         AND s.visitor_email != ''
         AND s.unread_count > 0
         AND EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = s.id
             AND m.sender_type = 'operator'
             AND m.is_read = false
             AND m.created_at < NOW() - INTERVAL '15 minutes'
         )
         AND (
           s.metadata IS NULL
           OR s.metadata->>'emailDigestSentAt' IS NULL
           OR (s.metadata->>'emailDigestSentAt')::timestamptz < NOW() - INTERVAL '1 hour'
         )
       LIMIT 20`
    );

    if (sessions.rows.length === 0) return;

    for (const session of sessions.rows) {
      try {
        // Get unread messages from operators
        const messagesResult = await pool.query(
          `SELECT sender_name, content, created_at
           FROM messages
           WHERE conversation_id = $1 AND sender_type = 'operator' AND is_read = false
           ORDER BY created_at ASC LIMIT 10`,
          [session.id]
        );

        if (messagesResult.rows.length === 0) continue;

        await sendChatDigestEmail(
          session.visitor_email,
          session.visitor_name,
          messagesResult.rows as ChatDigestMessage[]
        );

        // Mark digest as sent
        await pool.query(
          `UPDATE conversations
           SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          [JSON.stringify({ emailDigestSentAt: new Date().toISOString() }), session.id]
        );
      } catch (err) {
        logger.error(`[ChatDigest] Failed for session ${session.id}:`, { error: String(err) });
      }
    }

    logger.info(`[ChatDigest] Processed ${sessions.rows.length} sessions`);
  } catch (error) {
    logger.error('[ChatDigest] Digest cycle failed:', { error: String(error) });
  }
}

export function startChatEmailDigestScheduler(): void {
  // Run every 15 minutes
  digestInterval = setInterval(runDigestCycle, 15 * 60 * 1000);
  // First run after 5 min (give server time to stabilize)
  setTimeout(runDigestCycle, 5 * 60 * 1000);
  logger.info('[ChatDigest] Email digest scheduler started (15-min cycle)');
}

export function stopChatEmailDigestScheduler(): void {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
  }
}
