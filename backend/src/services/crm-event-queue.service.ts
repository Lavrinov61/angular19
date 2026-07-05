/**
 * CRM Event Queue — BullMQ-based incremental inbox updates
 *
 * Replaces polling-based MV REFRESH CONCURRENTLY (O(n) every 30s)
 * with event-driven UPSERT (O(1) per event).
 *
 * Pattern: post-payment-queue.service.ts (BullMQ + typed jobs + leader-only worker)
 *
 * Integration: call enqueueCrmEvent() from existing broadcast points
 * (broadcastNewMessage, sendOrderEvent, sendTaskEvent, etc.)
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { getRequestId, runWithRequestId } from '../middleware/request-context.js';
import db from '../database/db.js';
import { cacheDel, cacheSet } from './redis-cache.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import type { InboxCountRow } from '../types/views/index.js';

const log = createLogger('crm-event-queue');

// ─── BullMQ connection (same pattern as post-payment-queue, inbound-worker) ──

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Types ───────────────────────────────────────────────────────────────────

type InboxType = 'chat' | 'task' | 'booking' | 'order' | 'approval';

export interface CrmEventJobData {
  inboxType: InboxType;
  aggregateId: string;
  eventType: string;
  /** Partial inbox row data for upsert. Keys match crm_inbox columns. */
  inboxData?: Partial<InboxRowData>;
  /** If true, remove from inbox instead of upsert. */
  remove?: boolean;
  /** Distributed tracing: propagated from the originating request */
  _requestId?: string;
}

export interface InboxRowData {
  client_name: string | null;
  client_phone: string | null;
  preview: string;
  status: string;
  priority: number;
  sort_time: string;
  channel: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  unread: boolean;
  metadata: Record<string, unknown>;
}

// ─── Queue (always created — enqueue from any node) ──────────────────────────

const QUEUE_NAME = 'crm-events';
const queue = new Queue(QUEUE_NAME, { connection: { ...redisOpts } });

export function getCrmEventQueue(): Queue {
  return queue;
}

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 5000 },
  removeOnFail: { count: 10000 },
};

/**
 * Enqueue a CRM event for inbox update.
 *
 * Call this alongside existing broadcast functions:
 *   broadcastNewMessage(...)
 *   enqueueCrmEvent('chat', convId, 'message_received', { preview, sort_time, ... })
 */
export async function enqueueCrmEvent(
  inboxType: InboxType,
  aggregateId: string,
  eventType: string,
  inboxData?: Partial<InboxRowData>,
  remove?: boolean,
): Promise<void> {
  try {
    await queue.add(eventType, {
      inboxType,
      aggregateId,
      eventType,
      inboxData,
      remove,
      _requestId: getRequestId(),
    } satisfies CrmEventJobData, JOB_OPTS);
  } catch (err) {
    log.warn('Failed to enqueue CRM event', { inboxType, aggregateId, eventType, error: String(err) });
  }
}

// ─── Worker (started only on leader node) ────────────────────────────────────

let worker: Worker | null = null;

export function startCrmEventWorker(): void {
  worker = new Worker(QUEUE_NAME, processJob, {
    connection: { ...redisOpts },
    concurrency: 5,
    limiter: { max: 50, duration: 1000 },
  });

  worker.on('completed', (job) => {
    log.debug('crm-event job completed', { jobId: job.id, name: job.name });
  });

  worker.on('failed', (job, err) => {
    log.error('crm-event job failed', {
      jobId: job?.id,
      name: job?.name,
      error: String(err),
    });
  });

  log.info('CRM event worker started');
}

export async function stopCrmEventWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('CRM event worker stopped');
  }
}

// ─── Job processor ───────────────────────────────────────────────────────────

async function processJob(job: Job<CrmEventJobData>): Promise<void> {
  // Restore requestId from job data for distributed tracing
  return runWithRequestId(job.data._requestId, () => processJobInner(job));
}

async function processJobInner(job: Job<CrmEventJobData>): Promise<void> {
  const { inboxType, aggregateId, eventType, inboxData, remove } = job.data;

  if (remove) {
    await removeFromInbox(inboxType, aggregateId);
  } else if (inboxData) {
    await upsertInbox(inboxType, aggregateId, inboxData);
  }

  // Invalidate inbox counts cache broadly.
  // Redis SCAN-based invalidation would be better at scale, but
  // stale-while-revalidate with 30s TTL handles this well enough.
  await cacheDel('crm:inbox:counts:*');

  // Push updated counts via Socket.IO
  await pushInboxCounts();

  log.debug('CRM event processed', { inboxType, aggregateId, eventType });
}

// ─── Inbox UPSERT (O(1) per event) ──────────────────────────────────────────

async function upsertInbox(
  inboxType: InboxType,
  aggregateId: string,
  data: Partial<InboxRowData>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const updates: string[] = [];
  let p = 3; // $1 = type, $2 = id

  // Build dynamic SET clause from provided fields
  const columns: [keyof InboxRowData, unknown][] = [
    ['client_name', data.client_name],
    ['client_phone', data.client_phone],
    ['preview', data.preview],
    ['status', data.status],
    ['priority', data.priority],
    ['sort_time', data.sort_time],
    ['channel', data.channel],
    ['assigned_to', data.assigned_to],
    ['assigned_to_name', data.assigned_to_name],
    ['unread', data.unread],
    ['metadata', data.metadata ? JSON.stringify(data.metadata) : undefined],
  ];

  for (const [col, val] of columns) {
    if (val !== undefined) {
      fields.push(col);
      values.push(col === 'metadata' ? val : val);
      updates.push(`${col} = $${p}`);
      p++;
    }
  }

  if (fields.length === 0) return;

  // Always update updated_at
  updates.push(`updated_at = NOW()`);

  const insertCols = ['type', 'id', ...fields].join(', ');
  const insertVals = ['$1', '$2', ...fields.map((_, i) => `$${i + 3}`)].join(', ');
  const updateSet = updates.join(', ');

  await db.query(
    `INSERT INTO crm_inbox (${insertCols})
     VALUES (${insertVals})
     ON CONFLICT (type, id) DO UPDATE SET ${updateSet}`,
    [inboxType, aggregateId, ...values],
  );
}

// ─── Remove from Inbox ───────────────────────────────────────────────────────

async function removeFromInbox(inboxType: InboxType, aggregateId: string): Promise<void> {
  await db.query(
    `DELETE FROM crm_inbox WHERE type = $1 AND id = $2`,
    [inboxType, aggregateId],
  );
}

// ─── Push Inbox Counts via Socket.IO ─────────────────────────────────────────

async function pushInboxCounts(): Promise<void> {
  try {
    const rows = await db.query<InboxCountRow>(
      `SELECT
         type,
         COUNT(*)::int AS count,
         SUM(CASE WHEN unread THEN 1 ELSE 0 END)::int AS unread_count,
         SUM(CASE WHEN assigned_to IS NULL AND type IN ('chat','task') THEN 1 ELSE 0 END)::int AS unassigned_count,
         SUM(CASE WHEN type IN ('task','chat') AND priority <= 1 THEN 1 ELSE 0 END)::int AS urgent_count,
         SUM(CASE WHEN type = 'order' AND (metadata->>'paymentStatus') IS DISTINCT FROM 'paid' THEN 1 ELSE 0 END)::int AS unpaid_count
       FROM crm_inbox
       GROUP BY type`,
    );

    const counts: Record<string, InboxCountRow> = {};
    for (const r of rows) counts[r.type] = r;

    const chat     = counts['chat']?.count     || 0;
    const task     = counts['task']?.count     || 0;
    const booking  = counts['booking']?.count  || 0;
    const order    = counts['order']?.count    || 0;
    const approval = counts['approval']?.count || 0;

    const data = {
      chat, task, booking, order, approval,
      total:      chat + task + booking + order + approval,
      urgent:     (counts['task']?.urgent_count || 0) + (counts['chat']?.urgent_count || 0),
      unassigned: (counts['chat']?.unassigned_count || 0) + (counts['task']?.unassigned_count || 0),
      unread:     counts['chat']?.unread_count      || 0,
      unpaid:     counts['order']?.unpaid_count     || 0,
    };

    // Push to all CRM operators
    broadcastToRoom('inbox:counts', 'admin:visitor-chats', data);

    // Cache for HTTP fallback
    await cacheSet('crm:inbox:counts:all:_global', data, 30);
  } catch (err) {
    log.warn('pushInboxCounts failed', { error: String(err) });
  }
}
