/**
 * Omnichannel v2 — Dead Letter Queue Worker
 *
 * Listens for exhausted (all retries spent) media jobs and moves them
 * to a dedicated 'omni-media-dlq' queue for inspection and manual retry.
 *
 * Also broadcasts a Socket.IO alert to the admin panel so operators
 * are immediately aware of permanently failed media processing.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { broadcastToRoom } from '../../../websocket/broadcast-to-room.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('dlq-worker');

// ─── BullMQ setup ─────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

/** DLQ queue — stores permanently failed media jobs for inspection */
const dlqQueue = new Queue('omni-media-dlq', {
  connection: { ...redisOpts },
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  },
});

export { dlqQueue };

// ─── Media worker event listener ──────────────────────────────────────────────

let mediaWorkerRef: Worker | null = null;

/**
 * Attach a 'failed' event listener to the media worker.
 * When a job exhausts all attempts, it is moved to the DLQ queue.
 */
export function attachDlqListener(mediaWorker: Worker): void {
  mediaWorkerRef = mediaWorker;

  mediaWorker.on('failed', (job: Job | undefined, err: Error, _prev: string) => {
    if (!job) return;

    // BullMQ emits 'failed' on every attempt. Check if all attempts exhausted.
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    // Job is exhausted — move to DLQ
    moveToDlq(job, err).catch((dlqErr: unknown) =>
      log.error('failed to move job to DLQ', {
        jobId: job.id,
        error: String(dlqErr),
      }),
    );
  });

  log.info('DLQ listener attached to media worker');
}

async function moveToDlq(job: Job, error: Error): Promise<void> {
  const dlqPayload = {
    originalJobId: job.id,
    originalQueue: 'omni-media',
    data: job.data as Record<string, unknown>,
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
    failReason: String(error),
    stackTrace: job.stacktrace ?? [],
  };

  await dlqQueue.add('dead-letter', dlqPayload, {
    jobId: `dlq-${job.id ?? Date.now()}`,
  });

  log.warn('media job moved to DLQ', {
    jobId: job.id,
    messageId: (job.data as Record<string, unknown>)['messageId'],
    channel: (job.data as Record<string, unknown>)['channel'],
    attemptsMade: job.attemptsMade,
    error: String(error),
  });

  // Broadcast alert to admin panel
  broadcastToRoom('media:dlq:alert', 'admin:visitor-chats', {
    jobId: job.id,
    messageId: (job.data as Record<string, unknown>)['messageId'],
    channel: (job.data as Record<string, unknown>)['channel'],
    error: String(error),
    timestamp: new Date().toISOString(),
  });
}

// ─── DLQ API helpers ──────────────────────────────────────────────────────────

export interface DlqJobInfo {
  jobId: string;
  originalJobId: string;
  messageId: string;
  channel: string;
  failReason: string;
  attemptsMade: number;
  failedAt: string;
  stackTrace: string[];
}

/**
 * List failed jobs in the DLQ (most recent first).
 */
export async function listDlqJobs(limit = 100): Promise<DlqJobInfo[]> {
  const jobs = await dlqQueue.getJobs(['completed', 'waiting', 'delayed', 'active'], 0, limit - 1);

  return jobs.map((job) => {
    const data = job.data as Record<string, unknown>;
    const originalData = data['data'] as Record<string, unknown> | undefined;
    return {
      jobId: job.id ?? '',
      originalJobId: String(data['originalJobId'] ?? ''),
      messageId: String(originalData?.['messageId'] ?? ''),
      channel: String(originalData?.['channel'] ?? ''),
      failReason: String(data['failReason'] ?? ''),
      attemptsMade: Number(data['attemptsMade'] ?? 0),
      failedAt: String(data['failedAt'] ?? ''),
      stackTrace: Array.isArray(data['stackTrace']) ? (data['stackTrace'] as string[]) : [],
    };
  });
}

/**
 * Retry a DLQ job by re-adding it to the original media queue.
 * Returns the new job ID.
 */
export async function retryDlqJob(
  jobId: string,
  mediaQueue: Queue,
): Promise<string> {
  const job = await dlqQueue.getJob(jobId);
  if (!job) {
    throw new Error(`DLQ job not found: ${jobId}`);
  }

  const data = job.data as Record<string, unknown>;
  const originalData = data['data'] as Record<string, unknown>;

  const newJob = await mediaQueue.add('process-media', originalData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  });

  // Remove from DLQ after successful re-queue
  await job.remove();

  log.info('DLQ job retried', {
    dlqJobId: jobId,
    newJobId: newJob.id,
    messageId: String(originalData?.['messageId'] ?? ''),
  });

  return newJob.id ?? '';
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function stopDlqWorker(): Promise<void> {
  // Remove listener from media worker
  if (mediaWorkerRef) {
    mediaWorkerRef.removeAllListeners('failed');
    mediaWorkerRef = null;
  }
  await dlqQueue.close();
  log.info('DLQ worker stopped');
}
