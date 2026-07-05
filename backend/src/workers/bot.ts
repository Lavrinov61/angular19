/**
 * workers/bot.ts — entry-point for PM2 `worker-bot` process.
 *
 * Hosts bot/tracking-related background workers:
 *   - loyalty-worker (earn points, achievements)
 *   - visitor-session-worker (tracking upserts)
 *
 * No Socket.IO; any client-facing broadcast goes via `wsPubSub.publish(...)`.
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

import { startLoyaltyWorker, stopLoyaltyWorker } from './loyalty-worker.js';
import { startVisitorSessionWorker, stopVisitorSessionWorker } from './visitor-session-worker.js';

const log = createLogger('worker-bot-entry');
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

  await shutdownStep('loyalty-worker', () => stopLoyaltyWorker());
  await shutdownStep('visitor-session-worker', () => stopVisitorSessionWorker());

  await shutdownStep('ws-pubsub', () => wsPubSub.shutdown());
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

  if (config.role !== 'worker-bot' && config.role !== 'monolith') {
    log.error('workers/bot.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78);
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (worker-bot)');

    registerShutdownHandlers('worker-bot', cleanup, config.server.shutdownTimeoutMs);

    startLoyaltyWorker();
    startVisitorSessionWorker();

    redisHealth = createRedisHealthCheck('health-worker-bot');
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
    log.info('worker-bot entry started', { role: config.role, pid: process.pid });
  } catch (err: unknown) {
    log.error('worker-bot main crashed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('worker-bot main crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
