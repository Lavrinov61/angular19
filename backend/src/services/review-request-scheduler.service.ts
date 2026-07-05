import db from '../database/db.js';
import { processReviewRequest } from './review-request.service.js';

import { createLogger } from '../utils/logger.js';
const TAG = '[ReviewReqScheduler]';
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('review-request-scheduler.service');
interface PendingRow {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  channel: string;
  external_chat_id: string | null;
  review_token: string;
  location_slug: string | null;
}

async function processPending(): Promise<void> {
  try {
    const pending = await db.query<PendingRow>(
      `SELECT id, client_name, client_phone, client_email, channel,
              external_chat_id, review_token, location_slug
       FROM review_requests
       WHERE status = 'pending' AND send_at <= NOW()
       ORDER BY send_at
       LIMIT 20`,
    );

    if (pending.length === 0) return;

    for (const row of pending) {
      try {
        await processReviewRequest(row);
      } catch (err) {
        logger.error(`${TAG} Failed to process ${row.id}:`, { error: String(err) });
      }
    }

    logger.info(`${TAG} Processed: ${pending.length} review requests`);
  } catch (err) {
    logger.error(`${TAG} Processing error:`, { error: String(err) });
  }
}

export function startReviewRequestScheduler(): void {
  if (intervalHandle) {
    logger.warn(`${TAG} Scheduler already running`);
    return;
  }

  logger.info(`${TAG} Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  setTimeout(() => {
    processPending();
  }, 120_000);

  intervalHandle = setInterval(processPending, INTERVAL_MS);
}

export function stopReviewRequestScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info(`${TAG} Scheduler stopped`);
  }
}
