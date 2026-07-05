/**
 * Broadcast Worker — dedicated `omni-broadcast` queue (5/sec ad ceiling).
 *
 * Separate from the transactional `omni-outbound` line so that marketing can be
 * throttled/paused while payment receipts cannot. The dispatcher (PG-backed,
 * 30s cadence) claims dispatchable recipients via `FOR UPDATE SKIP LOCKED` and
 * enqueues them with a deterministic `jobId=idempotencyKey` (singleton-safe across
 * the split worker process AND the monolith leader — NOT gated on scheduler-leader).
 *
 * Retry ownership: PG is the single owner of retry timing (campaign.service writes
 * `next_attempt_at`; the dispatcher re-enqueues). On 429 the job yields via
 * `worker.rateLimit()` + `RateLimitError()` so the attempt is NOT consumed.
 *
 * Governor (per-token global pause) is checked BEFORE every send so a broadcast 429
 * cannot freeze live support on the shared bot token.
 */

import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { captureException } from '../../utils/error-tracker.js';
import { getBotPauseMs, isBotPaused } from './broadcast-governor.js';
import * as campaignService from './campaign.service.js';
import db from '../../database/db.js';

const log = createLogger('broadcast-worker');

const BROADCAST_QUEUE_NAME = 'omni-broadcast';
const DISPATCH_INTERVAL_MS = 30_000;
const DISPATCH_BATCH = 500;

// BullMQ flags a rate-limited job by error message, not by class identity. `Worker.RateLimitError()`
// (a static factory) produces an Error with this message; the worker's failed-handler matches on it.
const RATE_LIMIT_ERROR_MESSAGE = 'bullmq:rateLimitExceeded';

// Bot token for the governor pre-send gate. The broadcast bot is a single Telegram
// account (@FmagnusBot); resolve its token lazily from the active channel account.
let cachedBotToken: string | null = null;

async function resolveBroadcastBotToken(): Promise<string> {
  if (cachedBotToken) return cachedBotToken;
  const { getAccountByChannel } = await import('../connectors/core/account-store.js');
  const account = await getAccountByChannel('telegram');
  const token = account?.credentials?.['botToken'];
  cachedBotToken = typeof token === 'string' ? token : '';
  return cachedBotToken;
}

// ─── BullMQ setup (mirror outbound-worker redisOpts) ──────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const broadcastQueue = new Queue(BROADCAST_QUEUE_NAME, { connection: { ...redisOpts } });

// ─── Worker processor ─────────────────────────────────────────────────────────

interface BroadcastJobData {
  recipientId: string;
}

/** Yield the current job without consuming an attempt (BullMQ rate-limit protocol). */
async function yieldRateLimited(ms: number): Promise<never> {
  // `worker` is the module singleton processing this job by the time the processor runs.
  await worker?.rateLimit(ms > 0 ? ms : 1000);
  throw Worker.RateLimitError();
}

// Exported as a test seam (the BullMQ processor); also wired into the Worker below.
export async function processBroadcast(job: Job<BroadcastJobData>): Promise<void> {
  const { recipientId } = job.data;

  // Pre-send gate: if the shared bot token is paused (429 backpressure), yield the
  // job WITHOUT consuming an attempt. PG reconciler re-enqueues; live support is spared.
  const botToken = await resolveBroadcastBotToken();
  if (botToken && (await isBotPaused(botToken))) {
    await yieldRateLimited(await getBotPauseMs(botToken));
  }

  const result = await campaignService.sendToRecipient(recipientId);

  if (result.status === 'rate_limited') {
    // 429: campaign.service already set the governor pause + next_attempt_at and left
    // the row 'queued'. Yield without consuming an attempt; reconciler retries the row.
    await yieldRateLimited(result.retryAfterMs ?? 1000);
  }

  // sent | failed | blocked | skipped → terminal for this job; campaign.service
  // persisted the row state. failed-with-retry is re-enqueued by the dispatcher.
}

// ─── Dispatcher (PG-backed, 30s cadence) ──────────────────────────────────────

// Exported as a test seam: the dispatcher claim + enqueue (deterministic jobId).
export async function dispatchOnce(): Promise<number> {
  // Active campaigns are dispatchable (status = kill-switch). Claim recipients across
  // all active campaigns; FOR UPDATE SKIP LOCKED makes concurrent dispatchers safe.
  const campaigns = await db.query<{ id: string }>(
    `SELECT id FROM marketing_campaigns
     WHERE status = 'active' AND channel = 'telegram'`,
  );

  let enqueued = 0;
  for (const campaign of campaigns) {
    const recipients = await campaignService.claimDispatchableRecipients(campaign.id, DISPATCH_BATCH);
    for (const recipient of recipients) {
      // NO custom jobId: BullMQ rejects ':' in a custom id ("Custom Id cannot contain :"),
      // and idempotency_key is `camp:<campaignId>:<contactId>` (full of colons). A deterministic
      // jobId also permanently dedups against the retained completed job → a re-queued recipient
      // (retry, reconciler, re-dispatch) would NEVER re-send. Let BullMQ auto-generate the id:
      // double-send is guarded at the ROW level by the CAS-lease in sendToRecipient (a 2nd job
      // for the same row claims 0 rows → skips), and the dispatcher's claim leases the row
      // (next_attempt_at +5min) so a later tick won't re-claim it before it's processed.
      await broadcastQueue.add(
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
    log.info('broadcast recipients dispatched', { enqueued, campaigns: campaigns.length });
  }
  return enqueued;
}

// ─── Lifecycle (singleton, mirror startOutboundWorker) ────────────────────────

let worker: Worker | null = null;
let dispatchInterval: ReturnType<typeof setInterval> | null = null;

export function startBroadcastWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(BROADCAST_QUEUE_NAME, processBroadcast, {
    connection: { ...redisOpts },
    concurrency: 5,
    limiter: { max: 5, duration: 1000 }, // ad ceiling 5/sec (per-queue)
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('broadcast job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    // RateLimitError is expected backpressure, not a real failure — don't alert.
    // BullMQ tags it by message, not class (Worker.RateLimitError is a static factory).
    if (err?.message === RATE_LIMIT_ERROR_MESSAGE) {
      log.debug('broadcast job rate-limited (yield)', { jobId: job?.id });
      return;
    }
    captureException(err, {
      tags: { worker: 'broadcast' },
      extra: { jobId: job?.id },
      level: 'error',
    });
    log.error('broadcast job failed', { jobId: job?.id, error: String(err) });
  });

  // Dispatcher loop: claim + enqueue every 30s (PG is the source of truth).
  dispatchInterval = setInterval(() => {
    dispatchOnce().catch((err) =>
      log.error('broadcast dispatcher failed', { error: String(err) }),
    );
  }, DISPATCH_INTERVAL_MS);

  log.info('broadcast worker started');
  return worker;
}

export async function stopBroadcastWorker(): Promise<void> {
  if (dispatchInterval) {
    clearInterval(dispatchInterval);
    dispatchInterval = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
    log.info('broadcast worker stopped');
  }
}

export { broadcastQueue };
