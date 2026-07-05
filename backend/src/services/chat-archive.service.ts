/**
 * chat-archive.service.ts — Archive old chat sessions (90-day retention)
 *
 * Runs as a scheduled job once per day (via leader election).
 * Moves closed sessions older than 90 days to archive tables.
 */
import db, { pool } from '../database/db.js';

import { createLogger } from '../utils/logger.js';
const RETENTION_DAYS = 90;
const BATCH_SIZE = 100;

const logger = createLogger('chat-archive.service');
let archiveInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Archive old sessions in batches
 */
export async function runArchiveCycle(): Promise<void> {
  try {
    const cutoff = `${RETENTION_DAYS} days`;

    // SELECT + lock + copy + delete inside single transaction to prevent race conditions
    const archivedCount = await db.transaction(async (client) => {
      // 1. Select and lock candidates (FOR UPDATE SKIP LOCKED prevents conflicts with operator reopen)
      const toArchive = await client.query(
        `SELECT id FROM conversations
         WHERE status = 'closed'
           AND COALESCE(resolved_at, updated_at, created_at) < NOW() - $1::interval
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [cutoff, BATCH_SIZE]
      );

      if (toArchive.rows.length === 0) return 0;

      const sessionIds = toArchive.rows.map((r: { id: string }) => r.id);

      // 2. Re-verify status (double check — session may have been reopened between scheduling and lock)
      const verified = await client.query(
        `SELECT id FROM conversations WHERE id = ANY($1) AND status = 'closed'`,
        [sessionIds]
      );
      const verifiedIds = verified.rows.map((r: { id: string }) => r.id);
      if (verifiedIds.length === 0) return 0;

      logger.info(`[ChatArchive] Archiving ${verifiedIds.length} sessions (closed > ${RETENTION_DAYS} days)`);

      // 3. Copy messages to archive
      await client.query(
        `INSERT INTO messages_archive
         SELECT * FROM messages WHERE conversation_id = ANY($1)
         ON CONFLICT DO NOTHING`,
        [verifiedIds]
      );

      // 4. Copy sessions to archive
      await client.query(
        `INSERT INTO conversations_archive
         SELECT * FROM conversations WHERE id = ANY($1)
         ON CONFLICT DO NOTHING`,
        [verifiedIds]
      );

      // 5. Delete messages from main table
      await client.query(
        `DELETE FROM messages WHERE conversation_id = ANY($1)`,
        [verifiedIds]
      );

      // 6. Delete sessions from main table
      await client.query(
        `DELETE FROM conversations WHERE id = ANY($1)`,
        [verifiedIds]
      );

      return verifiedIds.length;
    });

    if (archivedCount > 0) {
      logger.info(`[ChatArchive] Archived ${archivedCount} sessions successfully`);
    }

    // If there are more, schedule another batch
    if (archivedCount === BATCH_SIZE) {
      setTimeout(runArchiveCycle, 5000);
    }
  } catch (error) {
    logger.error('[ChatArchive] Archive cycle failed:', { error: String(error) });
  }
}

export function startChatArchiveScheduler(): void {
  // Run once immediately then every 24 hours
  runArchiveCycle();
  archiveInterval = setInterval(runArchiveCycle, 24 * 60 * 60 * 1000);
  logger.info('[ChatArchive] Scheduler started (90-day retention, daily cycle)');
}

export function stopChatArchiveScheduler(): void {
  if (archiveInterval) {
    clearInterval(archiveInterval);
    archiveInterval = null;
  }
}
