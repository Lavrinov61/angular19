/**
 * Orphan Media Cleanup Scheduler
 *
 * media-worker creates a placeholder row (s3_key='pending', processing_status='downloading')
 * before processing. If the worker crashes between INSERT and DELETE, the orphan row
 * stays forever. This scheduler runs every 30 minutes and cleans orphan placeholders
 * older than 1 hour.
 *
 * Runs only on the leader instance (via scheduler-leader.ts advisory lock).
 */

import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { mediaOrphansCleanedTotal } from './metrics.service.js';

const log = createLogger('orphan-media-cleanup');

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

async function cleanOrphanPlaceholders(): Promise<void> {
  try {
    const result = await db.query<{ id: string; message_id: string }>(
      `DELETE FROM media_attachments
       WHERE s3_key = 'pending' AND processing_status = 'downloading'
         AND created_at < NOW() - INTERVAL '1 hour'
       RETURNING id, message_id`,
    );

    if (result.length > 0) {
      mediaOrphansCleanedTotal.inc(result.length);
      log.warn('cleaned orphan media placeholders', {
        count: result.length,
        messageIds: result.map(r => r.message_id),
      });
    }
  } catch (err: unknown) {
    log.error('orphan media cleanup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startOrphanMediaCleanup(): void {
  if (cleanupInterval) return;

  // Run once immediately, then every 30 minutes
  cleanOrphanPlaceholders();
  cleanupInterval = setInterval(cleanOrphanPlaceholders, CLEANUP_INTERVAL_MS);
  log.info('orphan media cleanup scheduler started (30min interval)');
}

export function stopOrphanMediaCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('orphan media cleanup scheduler stopped');
  }
}
