/**
 * Omnichannel v2 — Status Worker
 *
 * BullMQ worker that processes delivery status updates:
 * 1. Load webhook_event row
 * 2. adapter.parseStatusUpdate() → StatusUpdate[]
 * 3. For each status:
 *    a. INSERT message_statuses (event log)
 *    b. UPDATE messages denormalized delivery_status
 *    c. Broadcast via Socket.IO
 * 4. UPDATE webhook_events SET status='processed'
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import db from '../../../database/db.js';
import { config } from '../../../config/index.js';
import { getAdapterOrThrow } from '../core/adapter-registry.js';
import { broadcastStatusUpdate } from './broadcast.js';
import type { ChannelType, DeliveryStatus } from '../core/types.js';
import type { MessageDeliveryLookup } from '../../../types/views/chat-views.js';
import { recordDelivered, recordFailed } from '../../channel-metrics.service.js';
import { createLogger } from '../../../utils/logger.js';
import { runWithRequestId } from '../../../middleware/request-context.js';
import type WebhookEvents from '../../../types/generated/public/WebhookEvents.js';

const log = createLogger('status-worker');

// ─── BullMQ setup ─────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

interface StatusJobData {
  webhookEventId: string;
  channel: ChannelType;
  accountId: string;
  _requestId?: string;
}

type WebhookStatusPayloadRow = Pick<WebhookEvents, 'raw_body'>;

// ─── Status priority for "only advance" rule ──────────────────────────────────

const STATUS_ORDER: Record<DeliveryStatus, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4, // failed can override any status
};

/** Type guard: narrow string|null to DeliveryStatus using STATUS_ORDER keys. */
function isDeliveryStatus(s: string | null | undefined): s is DeliveryStatus {
  return typeof s === 'string' && s in STATUS_ORDER;
}

/** Check if newStatus should overwrite currentStatus (only advances forward). */
function shouldAdvance(current: DeliveryStatus, next: DeliveryStatus): boolean {
  if (next === 'failed') return true; // failed always overrides
  return STATUS_ORDER[next] > STATUS_ORDER[current];
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processStatus(job: Job<StatusJobData>): Promise<void> {
  // Restore requestId from job data for distributed tracing
  return runWithRequestId(job.data._requestId, () => processStatusInner(job));
}

async function processStatusInner(job: Job<StatusJobData>): Promise<void> {
  const { webhookEventId, channel } = job.data;

  // 1. Load webhook_event
  const event = await db.queryOne<WebhookStatusPayloadRow>(
    `SELECT raw_body FROM webhook_events WHERE id = $1`,
    [webhookEventId],
  );
  if (!event) {
    log.warn('webhook event not found', { webhookEventId });
    return;
  }

  const adapter = getAdapterOrThrow(channel);

  // 2. Parse status updates
  const statusUpdates = adapter.parseStatusUpdate(event.raw_body);

  if (statusUpdates.length === 0) {
    await db.query(
      `UPDATE webhook_events SET status = 'skipped', processed_at = NOW() WHERE id = $1`,
      [webhookEventId],
    );
    return;
  }

  // 3. Process each status update
  for (const update of statusUpdates) {
    try {
      // Find the message by external_message_id
      const msg = await db.queryOne<MessageDeliveryLookup>(
        `SELECT id, conversation_id, delivery_status, created_at FROM messages
         WHERE external_message_id = $1`,
        [update.externalMessageId],
      );

      if (!msg) {
        log.debug('message not found for status update', {
          externalMessageId: update.externalMessageId,
          channel,
        });
        continue;
      }

      // 3a. INSERT message_statuses (event log — always insert, even if not advancing)
      await db.query(
        `INSERT INTO message_statuses
          (message_id, status, error_code, error_message, external_status_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg.id,
          update.status,
          update.errorCode || null,
          update.errorMessage || null,
          update.externalMessageId,
        ],
      );

      // 3b. UPDATE messages denormalized status (only advance forward)
      if (isDeliveryStatus(msg.delivery_status) && shouldAdvance(msg.delivery_status, update.status)) {
        const setClause = buildStatusUpdateClause(update.status);
        await db.query(
          `UPDATE messages SET ${setClause} WHERE id = $1`,
          [msg.id, update.status],
        );
      }

      // 3c. Record channel metrics
      if (update.status === 'delivered' && msg.created_at) {
        const deliveryTimeMs = Date.now() - new Date(msg.created_at).getTime();
        recordDelivered(channel, deliveryTimeMs);
      } else if (update.status === 'failed') {
        recordFailed(channel);
      }

      // 3d. Broadcast status update to CRM
      broadcastStatusUpdate(
        msg.conversation_id,
        msg.id,
        update.status,
        update.errorMessage,
      );

      log.debug('status update processed', {
        messageId: msg.id,
        status: update.status,
        channel,
      });
    } catch (err) {
      log.error('status update failed', {
        externalMessageId: update.externalMessageId,
        error: String(err),
      });
    }
  }

  // 4. Mark webhook as processed
  await db.query(
    `UPDATE webhook_events SET status = 'processed', processed_at = NOW() WHERE id = $1`,
    [webhookEventId],
  );
}

/**
 * Build SET clause for timestamp fields based on delivery status.
 */
function buildStatusUpdateClause(status: DeliveryStatus): string {
  switch (status) {
    case 'delivered':
      return 'delivered_at = COALESCE(delivered_at, NOW()), delivery_status = $2';
    case 'read':
      return 'read_at = COALESCE(read_at, NOW()), is_read = true, delivered_at = COALESCE(delivered_at, NOW()), delivery_status = $2';
    case 'failed':
      return 'delivery_status = $2';
    default:
      return 'delivery_status = $2';
  }
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let worker: Worker | null = null;

/**
 * Start the status worker. Called once at app startup.
 */
export function startStatusWorker(): Worker {
  if (worker) return worker;

  worker = new Worker('omni-status', processStatus, {
    connection: { ...redisOpts },
    concurrency: 3,
    limiter: { max: 30, duration: 1000 },
    lockDuration: 2 * 60 * 1000,
    lockRenewTime: 30 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('status job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    log.error('status job failed', {
      jobId: job?.id,
      error: String(err),
    });
  });

  log.info('status worker started');
  return worker;
}

export async function stopStatusWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('status worker stopped');
  }
}
