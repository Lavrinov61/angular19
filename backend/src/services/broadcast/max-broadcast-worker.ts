/**
 * MAX Broadcast Worker — dedicated `omni-broadcast-max` queue (5/sec ad ceiling).
 *
 * Separate queue/worker from the live Telegram `omni-broadcast` line so MAX never touches
 * the hot TG dispatcher (which has a live campaign running). The dispatcher (PG-backed,
 * 30s cadence) claims dispatchable MAX recipients (`WHERE status='active' AND channel='max'`)
 * via `FOR UPDATE SKIP LOCKED` and enqueues them; PG owns retry timing.
 *
 * Governor (per-token global pause) is checked BEFORE every send so a MAX broadcast 429
 * pauses only the MAX bot — the separate `max:bot:` namespace never freezes the TG line.
 */

import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { captureException } from '../../utils/error-tracker.js';
import { getMaxPauseMs, isMaxPaused } from './max-broadcast-governor.js';
import { sendToRecipientMax } from './max-broadcast-sender.js';
import * as campaignService from './campaign.service.js';
import db from '../../database/db.js';

const log = createLogger('max-broadcast-worker');

const MAX_BROADCAST_QUEUE_NAME = 'omni-broadcast-max';
const DISPATCH_INTERVAL_MS = 30_000;
const DISPATCH_BATCH = 500;

// BullMQ flags a rate-limited job by error message, not by class identity. `Worker.RateLimitError()`
// (a static factory) produces an Error with this message; the worker's failed-handler matches on it.
const RATE_LIMIT_ERROR_MESSAGE = 'bullmq:rateLimitExceeded';

// Access token for the governor pre-send gate. The MAX broadcast bot is a single account;
// resolve its token lazily from the active channel account.
let cachedAccessToken: string | null = null;

async function resolveMaxAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;
  const { getAccountByChannel } = await import('../connectors/core/account-store.js');
  const account = await getAccountByChannel('max');
  const token = account?.credentials?.['accessToken'];
  cachedAccessToken = typeof token === 'string' ? token : '';
  return cachedAccessToken;
}

// ─── BullMQ setup (mirror broadcast-worker redisOpts) ─────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const maxBroadcastQueue = new Queue(MAX_BROADCAST_QUEUE_NAME, { connection: { ...redisOpts } });

// ─── Worker processor ─────────────────────────────────────────────────────────

interface MaxBroadcastJobData {
  recipientId: string;
}

/** Yield the current job without consuming an attempt (BullMQ rate-limit protocol). */
async function yieldRateLimited(ms: number): Promise<never> {
  // `worker` is the module singleton processing this job by the time the processor runs.
  await worker?.rateLimit(ms > 0 ? ms : 1000);
  throw Worker.RateLimitError();
}

// Exported as a test seam (the BullMQ processor); also wired into the Worker below.
export async function processMaxBroadcast(job: Job<MaxBroadcastJobData>): Promise<void> {
  const { recipientId } = job.data;

  // Pre-send gate: if the MAX token is paused (429 backpressure), yield the job WITHOUT
  // consuming an attempt. PG reconciler re-enqueues. Gate lives ONLY in this worker (not in
  // the transactional outbound worker) so the TG-critical path is untouched (P1-4).
  const accessToken = await resolveMaxAccessToken();
  if (accessToken && (await isMaxPaused(accessToken))) {
    await yieldRateLimited(await getMaxPauseMs(accessToken));
  }

  const result = await sendToRecipientMax(recipientId);

  if (result.status === 'rate_limited') {
    // 429: max-broadcast-sender already set the governor pause + next_attempt_at and left
    // the row 'queued'. Yield without consuming an attempt; reconciler retries the row.
    await yieldRateLimited(result.retryAfterMs ?? 1000);
  }

  // sent | failed | blocked | skipped → terminal for this job; max-broadcast-sender
  // persisted the row state. failed-with-retry is re-enqueued by the dispatcher.
}

// ─── Dispatcher (PG-backed, 30s cadence) ──────────────────────────────────────

// Exported as a test seam: the dispatcher claim + enqueue. Discriminates by the column
// `channel='max'` ONLY — the TG dispatcher's `channel='telegram'` naturally excludes MAX.
export async function dispatchOnceMax(): Promise<number> {
  const campaigns = await db.query<{ id: string }>(
    `SELECT id FROM marketing_campaigns
     WHERE status = 'active' AND channel = 'max'`,
  );

  let enqueued = 0;
  for (const campaign of campaigns) {
    const recipients = await campaignService.claimDispatchableRecipients(campaign.id, DISPATCH_BATCH);
    for (const recipient of recipients) {
      // NO custom jobId (BullMQ rejects ':' in custom ids; idempotency_key is full of colons).
      // Double-send is guarded at the ROW level by the CAS-lease in sendToRecipientMax (a 2nd
      // job for the same row claims 0 rows → skips), and the dispatcher's claim leases the row
      // (next_attempt_at +5min) so a later tick won't re-claim it before it's processed.
      await maxBroadcastQueue.add(
        'send',
        { recipientId: recipient.id },
        {
          attempts: 1, // retry timing owned by PG, not BullMQ
          removeOnComplete: { count: 5000 },
          removeOnFail: { count: 10000 },
        },
      );
      enqueued++;
    }
  }

  if (enqueued > 0) {
    log.info('max broadcast recipients dispatched', { enqueued, campaigns: campaigns.length });
  }
  return enqueued;
}

// ─── Lifecycle (singleton, mirror startBroadcastWorker) ───────────────────────

let worker: Worker | null = null;
let dispatchInterval: ReturnType<typeof setInterval> | null = null;

export function startMaxBroadcastWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(MAX_BROADCAST_QUEUE_NAME, processMaxBroadcast, {
    connection: { ...redisOpts },
    concurrency: 5,
    limiter: { max: 5, duration: 1000 }, // ad ceiling 5/sec (per-queue)
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('max broadcast job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    // RateLimitError is expected backpressure, not a real failure — don't alert.
    if (err?.message === RATE_LIMIT_ERROR_MESSAGE) {
      log.debug('max broadcast job rate-limited (yield)', { jobId: job?.id });
      return;
    }
    captureException(err, {
      tags: { worker: 'max-broadcast' },
      extra: { jobId: job?.id },
      level: 'error',
    });
    log.error('max broadcast job failed', { jobId: job?.id, error: String(err) });
  });

  // Dispatcher loop: claim + enqueue every 30s (PG is the source of truth).
  dispatchInterval = setInterval(() => {
    dispatchOnceMax().catch((err) =>
      log.error('max broadcast dispatcher failed', { error: String(err) }),
    );
  }, DISPATCH_INTERVAL_MS);

  log.info('max broadcast worker started');
  return worker;
}

export async function stopMaxBroadcastWorker(): Promise<void> {
  if (dispatchInterval) {
    clearInterval(dispatchInterval);
    dispatchInterval = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
    log.info('max broadcast worker stopped');
  }
}

export { maxBroadcastQueue };
