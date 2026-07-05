/**
 * workers/outbound.ts — entry-point for PM2 `worker-outbound` process.
 *
 * Owns the BullMQ consumers responsible for moving messages OUT of the system
 * (delivery adapters) plus fiscal and post-payment pipelines. Does not hold
 * Socket.IO — uses `wsPubSub.publish(...)` for any client-facing broadcast.
 *
 * Starts on boot:
 *   - connectors/pipeline inbound/status/media/outbound workers (+ DLQ listener)
 *   - pos-fiscal-worker (ATOL KKT)
 *   - post-payment-queue (email/push/CRM tasks after /pay)
 * Plus `recoverPendingWebhooks()` (re-enqueue stale 'pending' webhook_events).
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
import { recoverPendingWebhooks } from '../bootstrap/recover-webhooks.js';
import { wsPubSub } from '../websocket/ws-pubsub.service.js';

import { initializeAdapters } from '../services/connectors/core/adapter-registry.js';
import { startInboundWorker, stopInboundWorker } from '../services/connectors/pipeline/inbound-worker.js';
import { startStatusWorker, stopStatusWorker } from '../services/connectors/pipeline/status-worker.js';
import { startMediaWorker, stopMediaWorker } from '../services/connectors/pipeline/media-worker.js';
import { startOutboundWorker, stopOutboundWorker } from '../services/connectors/pipeline/outbound-worker.js';
import { startAiTurnWorker, stopAiTurnWorker } from '../services/connectors/pipeline/ai-turn-worker.js';
import { startBroadcastWorker, stopBroadcastWorker } from '../services/broadcast/broadcast-worker.js';
import { startMaxBroadcastWorker, stopMaxBroadcastWorker } from '../services/broadcast/max-broadcast-worker.js';
import { attachDlqListener, stopDlqWorker } from '../services/connectors/pipeline/dlq-worker.js';
import { startFiscalWorker, stopFiscalWorker } from './pos-fiscal-worker.js';
import { startPostPaymentWorker, stopPostPaymentWorker } from '../services/post-payment-queue.service.js';

const log = createLogger('worker-outbound-entry');
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

  // Stop producers/consumers in order: accept no new jobs → drain → close.
  await shutdownStep('inbound-worker', () => stopInboundWorker());
  await shutdownStep('status-worker', () => stopStatusWorker());
  await shutdownStep('media-worker', () => stopMediaWorker());
  await shutdownStep('dlq-worker', () => stopDlqWorker());
  await shutdownStep('outbound-worker', () => stopOutboundWorker());
  await shutdownStep('ai-turn-worker', () => stopAiTurnWorker());
  await shutdownStep('broadcast-worker', () => stopBroadcastWorker());
  await shutdownStep('max-broadcast-worker', () => stopMaxBroadcastWorker());
  await shutdownStep('pos-fiscal-worker', () => stopFiscalWorker());
  await shutdownStep('post-payment-worker', () => stopPostPaymentWorker());

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

  if (config.role !== 'worker-outbound' && config.role !== 'monolith') {
    log.error('workers/outbound.ts started with unexpected PROCESS_ROLE', { role: config.role });
    process.exit(78);
  }

  try {
    await db.query('SELECT NOW()');
    log.info('Database connected (worker-outbound)');

    await initializeAdapters();

    registerShutdownHandlers('worker-outbound', cleanup, config.server.shutdownTimeoutMs);

    // Start consumers.
    startInboundWorker();
    startStatusWorker();
    const mediaWorker = startMediaWorker();
    attachDlqListener(mediaWorker);
    startOutboundWorker();
    startAiTurnWorker();
    startBroadcastWorker();
    startMaxBroadcastWorker();
    startFiscalWorker();
    startPostPaymentWorker();

    // Re-enqueue stale 'pending' webhook events from a prior crash.
    recoverPendingWebhooks().catch((err: unknown) =>
      log.error('recoverPendingWebhooks failed', { error: err instanceof Error ? err.message : String(err) }),
    );

    redisHealth = createRedisHealthCheck('health-worker-outbound');
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
    log.info('worker-outbound entry started', { role: config.role, pid: process.pid });
  } catch (err: unknown) {
    log.error('worker-outbound failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('worker-outbound main crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
