/**
 * recoverPendingWebhooks — re-enqueue webhook events stuck в 'pending'.
 *
 * При нештатном shutdown (crash leader) events могут остаться `status='pending'`
 * в БД, но потеряться из BullMQ очереди. При следующем старте scheduler'а мы
 * ре-энкьюим всё, что младше 24 часов, чтобы pipeline добил их.
 *
 * Extracted из server.ts (Phase 4.4 refactor) для реюза в scheduler-entry.ts.
 */

import db from '../database/db.js';
import { getInboundQueue } from '../services/connectors/pipeline/webhook-receiver.js';
import type WebhookEvents from '../types/generated/public/WebhookEvents.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('recover-webhooks');

/** Re-enqueue webhook events stuck in 'pending' from a previous crashed leader. */
export async function recoverPendingWebhooks(): Promise<void> {
  try {
    const rows = await db.query<Pick<WebhookEvents, 'id' | 'channel' | 'account_id'>>(
      `SELECT id, channel, account_id FROM webhook_events
       WHERE status = 'pending' AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at ASC`,
    );
    if (rows.length === 0) return;

    log.info('Recovering stale pending webhook events', { count: rows.length });
    const queue = getInboundQueue();
    for (const row of rows) {
      try {
        await queue.add('process-inbound', {
          webhookEventId: row.id,
          channel: row.channel,
          accountId: row.account_id,
        });
      } catch (err: unknown) {
        log.warn('Failed to re-enqueue webhook event', {
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err: unknown) {
    log.error('Failed to recover pending webhooks', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
