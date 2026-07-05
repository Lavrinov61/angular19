/**
 * VK Broadcast Worker — выделенная очередь `vk-broadcast` (строже TG: 1/сек).
 *
 * Отдельный rate-домен от TG omni-broadcast: своя очередь, свой процесс
 * (magnus-photo-worker-vk, см. workers/vk.ts + ecosystem.config.cjs), свой governor
 * (vk:group:*). 429-шторм/flood VK не паузит Telegram и наоборот.
 *
 * Диспетчер (PG-backed, 30с): берёт dispatchable-получателей через
 * claimDispatchableRecipients (FOR UPDATE SKIP LOCKED) и ставит в BullMQ с
 * АВТО-генерируемым jobId (как TG: ':' в кастомном id запрещён BullMQ, а
 * детерминированный id навсегда дедупит против retained-завершённого джоба → ретрай
 * никогда бы не переотправился). Двойная отправка отбита на УРОВНЕ РЯДА CAS-lease'ом в
 * sendToVkRecipient + детерминированным random_id адаптера.
 *
 * Owner ретраев — PG (vk-send.service пишет next_attempt_at; диспетчер re-enqueue'ит). На
 * code 6/9 джоб уступает через worker.rateLimit() + RateLimitError → попытка НЕ
 * расходуется. Governor (пауза группы) проверяется ПЕРЕД каждой отправкой.
 *
 * Контракт сигнатур (от S2, workers/vk.ts зависит — НЕ менять):
 *   startVkBroadcastWorker(): void
 *   stopVkBroadcastWorker(): Promise<void>
 */

import { Worker, Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { createLogger } from '../../../utils/logger.js';
import { captureException } from '../../../utils/error-tracker.js';
import { getVkGroupPauseMs, isVkGroupPaused } from './vk-broadcast-governor.js';
import { sendToVkRecipient } from './vk-send.service.js';
import * as campaignService from '../campaign.service.js';
import db from '../../../database/db.js';

const log = createLogger('vk-broadcast-worker');

const VK_BROADCAST_QUEUE_NAME = 'vk-broadcast';
const DISPATCH_INTERVAL_MS = 30_000;
const DISPATCH_BATCH = 500;

// BullMQ помечает rate-limited джоб по message, не по классу. Worker.RateLimitError()
// (статик-фабрика) даёт Error с этим message; failed-handler матчит его.
const RATE_LIMIT_ERROR_MESSAGE = 'bullmq:rateLimitExceeded';

// Group token для governor pre-send гейта. VK-рассылка идёт через единый аккаунт сообщества;
// резолвим токен лениво из активного channel account.
let cachedGroupToken: string | null = null;

async function resolveVkGroupToken(): Promise<string> {
  if (cachedGroupToken) return cachedGroupToken;
  const { getAccountByChannel } = await import('../../connectors/core/account-store.js');
  const account = await getAccountByChannel('vk');
  const token = account?.credentials?.['groupToken'];
  cachedGroupToken = typeof token === 'string' ? token : '';
  return cachedGroupToken;
}

// ─── BullMQ setup (зеркало TG broadcast-worker redisOpts) ─────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const vkBroadcastQueue = new Queue(VK_BROADCAST_QUEUE_NAME, { connection: { ...redisOpts } });

// ─── Worker processor ─────────────────────────────────────────────────────────

interface VkBroadcastJobData {
  recipientId: string;
}

/** Уступить текущий джоб без расхода попытки (BullMQ rate-limit протокол). */
async function yieldRateLimited(ms: number): Promise<never> {
  await worker?.rateLimit(ms > 0 ? ms : 1000);
  throw Worker.RateLimitError();
}

// Экспорт как test-seam (BullMQ-процессор); тот же передаётся в Worker ниже.
export async function processVkBroadcast(job: Job<VkBroadcastJobData>): Promise<void> {
  const { recipientId } = job.data;

  // Pre-send гейт: если group token на паузе (6/9 backpressure) — уступаем БЕЗ расхода
  // попытки. PG-reconciler переочередит ряд.
  const groupToken = await resolveVkGroupToken();
  if (groupToken && (await isVkGroupPaused(groupToken))) {
    await yieldRateLimited(await getVkGroupPauseMs(groupToken));
  }

  const result = await sendToVkRecipient(recipientId);

  if (result.status === 'rate_limited') {
    // 6/9: vk-send уже поставил паузу группы + next_attempt_at, ряд оставил 'queued'.
    // Уступаем без расхода попытки; reconciler ретраит ряд.
    await yieldRateLimited(result.retryAfterMs ?? 1000);
  }

  // sent | failed | blocked | skipped → terminal для этого джоба; vk-send сохранил статус.
}

// ─── Dispatcher (PG-backed, 30с) ───────────────────────────────────────────────

// Экспорт как test-seam: claim + enqueue, ТОЛЬКО channel='vk' (не трогает omni-broadcast).
export async function dispatchOnceVk(): Promise<number> {
  const campaigns = await db.query<{ id: string }>(
    `SELECT id FROM marketing_campaigns
     WHERE status = 'active' AND channel = 'vk'`,
  );

  let enqueued = 0;
  for (const campaign of campaigns) {
    const recipients = await campaignService.claimDispatchableRecipients(campaign.id, DISPATCH_BATCH);
    for (const recipient of recipients) {
      // БЕЗ кастомного jobId (см. шапку): дедуп на уровне ряда (CAS-lease) + лиз
      // (next_attempt_at +5мин), чтобы следующий тик не переклеймил ряд до обработки.
      await vkBroadcastQueue.add(
        'send',
        { recipientId: recipient.id },
        {
          attempts: 1, // тайминг ретраев у PG, не у BullMQ
          removeOnComplete: { count: 5000 },
          removeOnFail: { count: 10000 },
        },
      );
      enqueued++;
    }
  }

  if (enqueued > 0) {
    log.info('vk broadcast recipients dispatched', { enqueued, campaigns: campaigns.length });
  }
  return enqueued;
}

// ─── Lifecycle (singleton, зеркало startBroadcastWorker) ──────────────────────

let worker: Worker | null = null;
let dispatchInterval: ReturnType<typeof setInterval> | null = null;

/** Запускает VK-диспетчер и BullMQ-воркер очереди 'vk-broadcast'. */
export function startVkBroadcastWorker(): void {
  if (worker) return;

  worker = new Worker(VK_BROADCAST_QUEUE_NAME, processVkBroadcast, {
    connection: { ...redisOpts },
    concurrency: 1,
    limiter: { max: 1, duration: 1000 }, // 1/сек — строже TG (VK flood control жёстче)
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('vk broadcast job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    // RateLimitError — ожидаемая backpressure, не реальный сбой.
    if (err?.message === RATE_LIMIT_ERROR_MESSAGE) {
      log.debug('vk broadcast job rate-limited (yield)', { jobId: job?.id });
      return;
    }
    captureException(err, {
      tags: { worker: 'vk-broadcast' },
      extra: { jobId: job?.id },
      level: 'error',
    });
    log.error('vk broadcast job failed', { jobId: job?.id, error: String(err) });
  });

  // Диспетчер: claim + enqueue каждые 30с (PG — источник истины).
  dispatchInterval = setInterval(() => {
    dispatchOnceVk().catch((err) =>
      log.error('vk broadcast dispatcher failed', { error: String(err) }),
    );
  }, DISPATCH_INTERVAL_MS);

  log.info('vk broadcast worker started');
}

/** Останавливает VK-диспетчер и закрывает очередь/воркер. */
export async function stopVkBroadcastWorker(): Promise<void> {
  if (dispatchInterval) {
    clearInterval(dispatchInterval);
    dispatchInterval = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
    log.info('vk broadcast worker stopped');
  }
}

export { vkBroadcastQueue };
