/**
 * visitor-session-worker.ts — BullMQ queue for async visitor_session upserts.
 *
 * Pattern: copied from loyalty-worker.ts.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import {
  updateVisitorSessionJob,
  type VisitorSessionJobData,
} from '../services/tracking-jobs.service.js';

const log = createLogger('visitor-session-worker');

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const QUEUE_NAME = 'visitor-session-update';

const queue = new Queue<VisitorSessionJobData>(QUEUE_NAME, { connection: { ...redisOpts } });

export function getVisitorSessionQueue(): Queue<VisitorSessionJobData> {
  return queue;
}

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

export async function enqueueVisitorSessionUpdate(
  data: Omit<VisitorSessionJobData, 'type'>,
): Promise<void> {
  if (!data.visitor_id && !data.fingerprint_visitor_id) return;
  await queue.add('update', { type: 'update', ...data }, JOB_OPTS);
}

let worker: Worker<VisitorSessionJobData> | null = null;

export function startVisitorSessionWorker(): void {
  log.info('Starting visitor-session worker', { queue: QUEUE_NAME });

  worker = new Worker<VisitorSessionJobData>(
    QUEUE_NAME,
    async (job: Job<VisitorSessionJobData>) => {
      await updateVisitorSessionJob(job.data);
    },
    {
      connection: { ...redisOpts },
      concurrency: 5,
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on('failed', (job: Job<VisitorSessionJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      captureException(err, {
        tags: { worker: 'visitor-session', jobType: job.data.type },
        extra: {
          visitorId: job.data.visitor_id,
          fingerprintId: job.data.fingerprint_visitor_id,
          attempts: job.attemptsMade,
        },
        level: 'error',
      });
      log.error('visitor-session job permanently failed', {
        jobId: job.id,
        attempts: job.attemptsMade,
        error: err.message,
      });
    } else {
      log.warn('visitor-session job retrying', {
        jobId: job.id,
        attempt: job.attemptsMade,
        error: err.message,
      });
    }
  });

  worker.on('error', (err: Error) => {
    captureException(err, { tags: { worker: 'visitor-session' }, level: 'error' });
    log.error('visitor-session worker error', { error: err.message });
  });
}

export async function stopVisitorSessionWorker(): Promise<void> {
  if (worker) {
    log.info('Stopping visitor-session worker');
    await worker.close();
    worker = null;
  }
  await queue.close();
}
