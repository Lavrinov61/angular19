/**
 * loyalty-worker.ts — BullMQ queue for async loyalty operations.
 *
 * Job types:
 *   - earn_order: award points for a completed order
 *   - check_achievements: re-evaluate achievements for a profile
 *
 * Pattern: copied from pos-fiscal-worker.ts / post-payment-queue.service.ts.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import * as loyaltyService from '../services/loyalty.service.js';
import type { LoyaltyCashbackCategoryKey } from '../types/views/loyalty-cashback-views.js';

const log = createLogger('loyalty-worker');

// ─── Redis connection ───────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface LoyaltyEarnJob {
  type: 'earn_order';
  profileId: string;
  orderAmount: number;
  source: 'online_order' | 'pos_order' | 'chat_order';
  referenceId: string;
  occurredAt?: string | null;
  cashbackCategoryKey?: LoyaltyCashbackCategoryKey | null;
}

interface LoyaltyAchievementJob {
  type: 'check_achievements';
  profileId: string;
}

export type LoyaltyJobData = LoyaltyEarnJob | LoyaltyAchievementJob;

// ─── Queue (always created — enqueue can happen from any node) ──────────────

const QUEUE_NAME = 'loyalty';
const queue = new Queue(QUEUE_NAME, { connection: { ...redisOpts } });

export function getLoyaltyQueue(): Queue {
  return queue;
}

// ─── Enqueue helpers ────────────────────────────────────────────────────────

const JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export async function enqueueLoyaltyEarn(data: Omit<LoyaltyEarnJob, 'type'>): Promise<void> {
  await queue.add('earn_order', { type: 'earn_order', ...data }, JOB_OPTS);
  log.info(`Enqueued loyalty earn_order for profile ${data.profileId}`, { source: data.source });
}

export async function enqueueLoyaltyAchievements(profileId: string): Promise<void> {
  await queue.add('check_achievements', { type: 'check_achievements', profileId }, JOB_OPTS);
}

// ─── Worker (started only on leader node) ───────────────────────────────────

let worker: Worker | null = null;

export function startLoyaltyWorker(): void {
  log.info('Starting loyalty worker');

  worker = new Worker<LoyaltyJobData>(QUEUE_NAME, async (job: Job<LoyaltyJobData>) => {
    const d = job.data;

    switch (d.type) {
      case 'earn_order':
        await loyaltyService.awardOrderPoints(
          d.profileId,
          d.orderAmount,
          d.source,
          d.referenceId,
          d.cashbackCategoryKey ?? null,
          d.occurredAt ?? null,
        );
        break;

      case 'check_achievements':
        await loyaltyService.checkAndAwardAchievements(
          d.profileId,
        );
        break;

      default: {
        const _exhaustive: never = d;
        void _exhaustive;
        log.warn('Unknown loyalty job type');
        break;
      }
    }
  }, {
    connection: { ...redisOpts },
    concurrency: 3,
  });

  worker.on('failed', (job: Job<LoyaltyJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts || 5;

    if (job.attemptsMade >= maxAttempts) {
      captureException(err, {
        tags: { worker: 'loyalty', jobType: job.data.type },
        extra: { profileId: job.data.profileId, attempts: job.attemptsMade },
        level: 'error',
      });
      log.error(`Loyalty dead letter: ${job.data.type} for profile ${job.data.profileId}`, {
        error: err.message,
        attempts: job.attemptsMade,
      });
    }
  });

  worker.on('error', (err: Error) => {
    captureException(err, { tags: { worker: 'loyalty' }, level: 'error' });
    log.error('Loyalty worker error', { error: err.message });
  });
}

export async function stopLoyaltyWorker(): Promise<void> {
  if (worker) {
    log.info('Stopping loyalty worker');
    await worker.close();
    worker = null;
  }
}
