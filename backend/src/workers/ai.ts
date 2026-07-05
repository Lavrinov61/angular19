/**
 * workers/ai.ts — entry-point for PM2 `worker-ai` process.
 *
 * Hosts async/AI-adjacent background jobs:
 *   - CRM event queue (incremental inbox/feed updates, replaces MV polling)
 *   - AV scanner (ClamAV S3 content scan after upload)
 *   - Orphan media placeholder cleanup
 *
 * Does not own Socket.IO — emits go through `wsPubSub.publish(...)`.
 */

import { config } from '../config/index.js';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { registerShutdownHandlers } from '../bootstrap/shutdown.js';
import { runHealthCheck } from '../bootstrap/health.js';
import {
  createRedisHealthCheck,
  startWorkerHealthServer,
  type RedisHealthCheck,
  type WorkerHealthServer,
} from '../bootstrap/worker-health-server.js';
import { wsPubSub } from '../websocket/ws-pubsub.service.js';

import { startCrmEventWorker, stopCrmEventWorker } from '../services/crm-event-queue.service.js';
import { startAvScanWorker, stopAvScanWorker } from '../services/av-scan-worker.js';
import { startOrphanMediaCleanup, stopOrphanMediaCleanup } from '../services/orphan-media-cleanup.service.js';
import { closeCrmRedis } from '../services/redis-cache.service.js';

const log = createLogger('worker-ai-entry');
let healthServer: WorkerHealthServer | null = null;
let redisHealth: RedisHealthCheck | null = null;

async function shutdownStep(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    log.info(`shutdown step OK: ${label}`);
  } catch (err: unknown) {
    log.error(`shutdown step FAILED: ${label}`, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function cleanup(): Promise<void> {
  if (healthServer) {
    await shutdownStep('health-server', () => healthServer?.close());
    healthServer = null;
  }

  await shutdownStep('crm-event-worker', () => stopCrmEventWorker());
  await shutdownStep('av-scan-worker', () => stopAvScanWorker());
  await shutdownStep('orphan-media-cleanup', () => stopOrphanMediaCleanup());

  await shutdownStep('ws-pubsub', () => wsPubSub.shutdown());
  await shutdownStep('crm-redis', () => closeCrmRedis());
  if (redisHealth) {
    await shutdownStep('health-redis', () => redisHealth?.close());
    redisHealth = null;
  }
  await shutdownStep('pg-pool', () => db.close());
}

async function main(): Promise<void> {
  if (process.argv.includes('--health') || process.argv.includes('--health-check')) {
    await runHealthCheck(async () => {
      await db.query('SELECT 1');
    });
    return;
  }

  if (config.role !== 'worker-ai' && config.role !== 'monolith') {
    log.error('workers/ai.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78);
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (worker-ai)');

    registerShutdownHandlers('worker-ai', cleanup, config.server.shutdownTimeoutMs);

    startCrmEventWorker();
    startAvScanWorker();
    startOrphanMediaCleanup();

    redisHealth = createRedisHealthCheck('health-worker-ai');
    healthServer = await startWorkerHealthServer({
      role: config.role,
      port: config.server.port,
      checks: {
        db: async () => {
          await db.query('SELECT 1');
          return 'ok';
        },
        redis: redisHealth.check,
      },
    });

    process.send?.('ready');
    log.info('worker-ai entry started', { role: config.role, pid: process.pid });
  } catch (err: unknown) {
    log.error('worker-ai failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('worker-ai main crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
