/**
 * photo-worker.ts — Dedicated photo processing worker (PM2: magnus-photo-worker).
 *
 * Stage 8: separates CPU-intensive photo processing from the main API process.
 *
 * This process:
 *  1. Connects to Redis for BullMQ
 *  2. Listens on 'photo-worker' queue
 *  3. Processes photo-processing jobs (resize, ZIP via child_process worker)
 *  4. Updates order status in PostgreSQL
 *  5. Sends Telegram notifications
 *
 * Runs independently — can be restarted/scaled without affecting the API.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { runWithRequestId } from './middleware/request-context.js';
import db from './database/db.js';
import { processAndNotify } from './services/photo-print-processing.service.js';
import type { PhotoProcessingJobData } from './services/photo-worker-queue.js';

const log = createLogger('photo-worker');

// ─── Redis connection ─────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'photo-worker';

const worker = new Worker(QUEUE_NAME, async (job: Job<PhotoProcessingJobData>) => {
  // Restore requestId from job data for distributed tracing
  return runWithRequestId(job.data._requestId, async () => {
  const d = job.data;
  log.info(`Processing job ${job.id}: ${job.name} for order ${d.orderId}`, {
    itemCount: d.items.length,
    mode: d.mode,
  });

  switch (job.name) {
    case 'photo-processing': {
      await processAndNotify(
        d.orderId,
        {
          mode: d.mode,
          items: d.items,
          contact: d.contact,
          totalPrice: d.totalPrice,
          source: d.source as 'miniapp' | 'website' | 'bot' | undefined,
        },
        d.telegramUserId,
        d.telegramUsername,
      );
      break;
    }
    default:
      log.warn(`Unknown job name: ${job.name}`);
  }
  }); // end runWithRequestId
}, {
  connection: { ...redisOpts },
  concurrency: 3,
});

// ─── Events ───────────────────────────────────────────────────────────────────

worker.on('completed', (job: Job) => {
  log.info(`Job ${job.id} completed for order ${job.data.orderId}`, {
    duration: Date.now() - job.timestamp,
  });
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  if (!job) return;
  const maxAttempts = job.opts.attempts || 3;
  if (job.attemptsMade >= maxAttempts) {
    log.error(`Dead letter: ${job.name} for ${job.data.orderId}`, {
      error: err.message,
      attempts: job.attemptsMade,
    });
  } else {
    log.warn(`Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts})`, {
      error: err.message,
      orderId: job.data.orderId,
    });
  }
});

worker.on('error', (err: Error) => {
  log.error('Worker error', { error: err.message });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received, shutting down...`);
  await worker.close();
  await db.close();
  log.info('Photo worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Verify DB connection
  await db.query('SELECT NOW()');
  log.info('Photo worker started', {
    queue: QUEUE_NAME,
    concurrency: 3,
    redis: `${config.redis.host}:${config.redis.port}`,
  });

  // Signal PM2 ready
  if (typeof process.send === 'function') {
    process.send('ready');
  }
}

start().catch((err) => {
  log.error('Failed to start photo worker', { error: err.message });
  process.exit(1);
});
