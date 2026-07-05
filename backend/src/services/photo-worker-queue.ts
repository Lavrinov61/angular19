/**
 * photo-worker-queue.ts — BullMQ queue for dedicated photo processing.
 *
 * Stage 8: Photo Worker.
 * Separates CPU-intensive photo processing (sharp resize, ZIP archiving)
 * from the main API process into a dedicated PM2 process (magnus-photo-worker).
 *
 * This module defines the queue and enqueue function — used by the API process.
 * The actual worker (consumer) runs in backend/src/photo-worker.ts.
 */

import { Queue } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { getRequestId } from '../middleware/request-context.js';

const log = createLogger('photo-worker-queue');

// ─── Redis connection (same opts as other queues) ─────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotoProcessingJobData {
  orderId: string;
  mode: 'simple' | 'custom';
  items: {
    uploadedUrl?: string;
    format: string;
    paperType: string;
    quantity: number;
    margins?: 'none' | '3mm';
    border?: string;
  }[];
  contact: {
    name: string;
    phone: string;
    email?: string;
    comments?: string;
  };
  totalPrice: number;
  telegramUserId?: string;
  telegramUsername?: string;
  source?: string;
  /** Distributed tracing: propagated from the originating request */
  _requestId?: string;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'photo-worker';

const queue = new Queue(QUEUE_NAME, {
  connection: { ...redisOpts },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 }, // 10s, 20s, 40s
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export function getPhotoWorkerQueue(): Queue {
  return queue;
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

export async function enqueuePhotoProcessing(data: PhotoProcessingJobData): Promise<void> {
  // Propagate requestId for distributed tracing
  const tracedData: PhotoProcessingJobData = { ...data, _requestId: data._requestId ?? getRequestId() };
  await queue.add('photo-processing', tracedData, {
    jobId: `photo-${data.orderId}-${Date.now()}`,
  });
  log.info(`Enqueued photo processing for ${data.orderId}`, {
    itemCount: data.items.length,
    mode: data.mode,
  });
}
