/**
 * AV Scan Worker — BullMQ queue for async ClamAV scanning.
 *
 * After files are uploaded to S3, jobs are enqueued for background AV scanning.
 * If a file is infected: deleted from S3, marked in DB, logged as WARN.
 *
 * Queue: 'av-scan'
 * Concurrency: 2 (avoid overloading clamd)
 * Retry: 2 attempts with exponential backoff
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { scanS3Object } from './clamav.service.js';
import { storageService } from './storage.service.js';
import db from '../database/db.js';

const log = createLogger('av-scan-worker');

// ─── Redis connection ────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AvScanJobData {
  s3Key: string;
  /** media_attachments.id — if scanning an omnichannel media attachment */
  mediaAttachmentId?: string;
  /** crm_files.id — if scanning a CRM file */
  crmFileId?: number;
  /** Entity context for logging */
  entityType: string;
  entityId: string;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'av-scan';

const queue = new Queue(QUEUE_NAME, {
  connection: { ...redisOpts },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 }, // 15s, 30s, 60s
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 2000 },
  },
});

export function getAvScanQueue(): Queue {
  return queue;
}

/**
 * Enqueue a file for async AV scanning.
 */
export async function enqueueAvScan(data: AvScanJobData): Promise<void> {
  await queue.add('av-scan', data, {
    jobId: `av-${data.s3Key.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}`,
  });
  log.debug('enqueued av-scan', {
    s3Key: data.s3Key,
    entityType: data.entityType,
    entityId: data.entityId,
  });
}

// ─── Worker processor ────────────────────────────────────────────────────────

async function processAvScan(job: Job<AvScanJobData>): Promise<void> {
  const { s3Key, mediaAttachmentId, crmFileId, entityType, entityId } = job.data;

  log.info('scanning file', { s3Key, entityType, entityId });

  const result = await scanS3Object(s3Key);

  if (result.clean) {
    // Mark as clean in the relevant table
    if (mediaAttachmentId) {
      await db.query(
        `UPDATE media_attachments SET av_status = 'clean' WHERE id = $1`,
        [mediaAttachmentId],
      );
    }
    if (crmFileId) {
      await db.query(
        `UPDATE crm_files SET clamav_status = 'clean', clamav_result = 'async-clean' WHERE id = $1`,
        [crmFileId],
      );
    }
    log.info('file clean', { s3Key, entityType, entityId });
    return;
  }

  if (result.error) {
    // Scanner error — mark as error, don't delete
    if (mediaAttachmentId) {
      await db.query(
        `UPDATE media_attachments SET av_status = 'error' WHERE id = $1`,
        [mediaAttachmentId],
      );
    }
    if (crmFileId) {
      await db.query(
        `UPDATE crm_files SET clamav_status = 'error', clamav_result = $1 WHERE id = $2`,
        [result.error, crmFileId],
      );
    }
    log.error('scan error', { s3Key, entityType, entityId, error: result.error });
    // Throw to trigger retry
    throw new Error(`AV scan error for ${s3Key}: ${result.error}`);
  }

  // INFECTED — delete from S3 and mark in DB
  log.warn('INFECTED file detected — deleting from S3', {
    s3Key,
    virus: result.virus,
    entityType,
    entityId,
  });

  await storageService.delete(s3Key);

  if (mediaAttachmentId) {
    await db.query(
      `UPDATE media_attachments
       SET av_status = 'infected',
           processing_status = 'infected',
           s3_url = '',
           s3_key = 'deleted-infected'
       WHERE id = $1`,
      [mediaAttachmentId],
    );
  }
  if (crmFileId) {
    await db.query(
      `UPDATE crm_files
       SET clamav_status = 'infected',
           clamav_result = $1,
           deleted_at = NOW()
       WHERE id = $2`,
      [`INFECTED: ${result.virus ?? 'unknown'}`, crmFileId],
    );
  }
}

// ─── Worker lifecycle ────────────────────────────────────────────────────────

let worker: Worker | null = null;

/**
 * Start the AV scan worker. Called once at app startup.
 */
export function startAvScanWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(QUEUE_NAME, processAvScan, {
    connection: { ...redisOpts },
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    log.debug('av-scan job completed', { jobId: job.id, s3Key: job.data.s3Key });
  });

  worker.on('failed', (job, err) => {
    log.error('av-scan job failed', {
      jobId: job?.id,
      s3Key: job?.data.s3Key,
      error: String(err),
      attemptsMade: job?.attemptsMade,
    });
  });

  log.info('av-scan worker started (concurrency: 2)');
  return worker;
}

export async function stopAvScanWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('av-scan worker stopped');
  }
}
