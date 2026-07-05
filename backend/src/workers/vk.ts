/**
 * workers/vk.ts — entry-point for PM2 `worker-vk` process.
 *
 * Owns the VK marketing-broadcast dispatcher and its dedicated BullMQ queue
 * (`vk-broadcast`). Lives in a separate rate-limit domain from the Telegram
 * omni-broadcast worker (worker-outbound) so a VK 429/anti-spam pause never
 * affects live Telegram delivery, and vice versa.
 *
 * КРИТИЧНО: здесь стартует ТОЛЬКО startVkBroadcastWorker — НЕ Telegram
 * startBroadcastWorker (он уже запускается в workers/outbound.ts; запуск VK-
 * диспетчера тут — единственное место для VK, конфликта диспетчеров нет).
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

import { initializeAdapters } from '../services/connectors/core/adapter-registry.js';
// Контракт VK-слоя (создаётся в S5): экспорт startVkBroadcastWorker(): void и
// stopVkBroadcastWorker(): Promise<void> из vk-broadcast-worker.ts.
import { startVkBroadcastWorker, stopVkBroadcastWorker } from '../services/broadcast/vk/vk-broadcast-worker.js';

const log = createLogger('worker-vk-entry');
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

  await shutdownStep('vk-broadcast-worker', () => stopVkBroadcastWorker());

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

  if (config.role !== 'worker-vk' && config.role !== 'monolith') {
    log.error('workers/vk.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78);
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (worker-vk)');

    await initializeAdapters();

    registerShutdownHandlers('worker-vk', cleanup, config.server.shutdownTimeoutMs);

    // Только VK-диспетчер — Telegram-движок здесь НЕ стартуем.
    startVkBroadcastWorker();

    redisHealth = createRedisHealthCheck('health-worker-vk');
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
    log.info('worker-vk entry started', { role: config.role, pid: process.pid });
  } catch (err: unknown) {
    log.error('worker-vk failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('worker-vk main crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
