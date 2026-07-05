/**
 * Metrics Collector (Stage 7: Monitoring)
 *
 * Periodically collects gauge values for:
 * - PG pool (total/idle/waiting connections)
 * - BullMQ queue depths (waiting/active/delayed/failed)
 * - WebSocket connected clients
 * - Circuit breaker states
 *
 * Runs every 15 seconds on the leader node.
 */

import type { Queue } from 'bullmq';
import { pool } from '../database/db.js';
import {
  dbPoolTotal,
  dbPoolIdle,
  dbPoolWaiting,
  bullmqQueueDepth,
  wsConnectedClients,
  wsActiveRoomsSize,
  circuitBreakerState,
} from './metrics.service.js';
import { createLogger } from '../utils/logger.js';
import { classifyRoom, type RoomType } from '../websocket/log-and-emit.js';

const log = createLogger('metrics-collector');

let collectorInterval: ReturnType<typeof setInterval> | null = null;

const CB_STATE_MAP: Record<string, number> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

// Use unknown payload types to accept any Queue<T> variant uniformly
type AnyQueue = Queue<unknown, unknown, string, unknown, unknown, string>;

async function collectAllQueueDepths(): Promise<void> {
  const loaders: Array<[string, () => Promise<AnyQueue | null>]> = [
    ['omni-outbound', async () => { try { return (await import('./connectors/pipeline/outbound-worker.js')).outboundQueue; } catch { return null; } }],
    ['omni-media', async () => { try { return (await import('./connectors/pipeline/inbound-worker.js')).mediaQueue; } catch { return null; } }],
    ['omni-media-dlq', async () => { try { return (await import('./connectors/pipeline/dlq-worker.js')).dlqQueue; } catch { return null; } }],
    ['omni-inbound', async () => { try { return (await import('./connectors/pipeline/webhook-receiver.js')).getInboundQueue(); } catch { return null; } }],
    ['omni-status', async () => { try { return (await import('./connectors/pipeline/webhook-receiver.js')).getStatusQueue(); } catch { return null; } }],
    ['order-post-payment', async () => { try { return (await import('./post-payment-queue.service.js')).getPostPaymentQueue(); } catch { return null; } }],
    ['voice-otp-dispatch', async () => { try { return (await import('./voice-otp-dispatcher.service.js')).getVoiceOtpDispatchQueue() as AnyQueue; } catch { return null; } }],
    ['av-scan', async () => { try { return (await import('./av-scan-worker.js')).getAvScanQueue(); } catch { return null; } }],
    ['photo-worker', async () => { try { return (await import('./photo-worker-queue.js')).getPhotoWorkerQueue(); } catch { return null; } }],
    ['crm-events', async () => { try { return (await import('./crm-event-queue.service.js')).getCrmEventQueue(); } catch { return null; } }],
    ['loyalty', async () => { try { return (await import('../workers/loyalty-worker.js')).getLoyaltyQueue(); } catch { return null; } }],
    ['visitor-session-update', async () => { try { return (await import('../workers/visitor-session-worker.js')).getVisitorSessionQueue() as AnyQueue; } catch { return null; } }],
    ['pos-fiscal', async () => { try { return (await import('../workers/pos-fiscal-worker.js')).getFiscalQueue(); } catch { return null; } }],
  ];

  await Promise.all(loaders.map(async ([name, load]) => {
    try {
      const queue = await load();
      if (!queue) return;
      const counts = await queue.getJobCounts(...QUEUE_STATES);
      for (const state of QUEUE_STATES) {
        bullmqQueueDepth.set({ queue: name, state }, counts[state] ?? 0);
      }
    } catch {
      // Queue not initialized in this process — skip silently
    }
  }));
}

async function collectOnce(): Promise<void> {
  try {
    // PG pool gauges
    dbPoolTotal.set(pool.totalCount);
    dbPoolIdle.set(pool.idleCount);
    dbPoolWaiting.set(pool.waitingCount);

    // WebSocket gauges — only meaningful in api-process; в worker'е io недоступен,
    // gauge читается другой ноде. Реэкспорт через PG adapter — отдельная задача.
    await collectWsRoomsSnapshotSafe();

    // BullMQ queue depths — all 12 queues, fail-soft per queue
    await collectAllQueueDepths();

    // Circuit breaker states
    try {
      const { getAllBreakers } = await import('../utils/circuit-breaker.js');
      for (const [name, breaker] of getAllBreakers()) {
        const state = breaker.getState();
        circuitBreakerState.set({ name }, CB_STATE_MAP[state] ?? -1);
      }
    } catch {
      // Circuit breakers may not be initialized
    }
  } catch (err) {
    log.error('Metrics collection error', { error: String(err) });
  }
}

async function collectWsRoomsSnapshotSafe(): Promise<void> {
  // Attempt to read WS rooms from the locally-bound api io (если этот процесс — api).
  // В worker-процессе apiIOBound === null и метрики просто скипаются.
  try {
    const { getBoundApiIOForMetrics } = await import('../websocket/broadcast-to-room.js');
    const io = getBoundApiIOForMetrics();
    if (!io) return;
    wsConnectedClients.set(io.of('/').sockets.size ?? 0);
    const rooms = io.sockets.adapter.rooms;
    const counts = new Map<RoomType, number>();
    for (const [room, sockets] of rooms) {
      // Skip per-socket rooms (default room per connection is socket.id)
      if (io.sockets.sockets.has(room)) continue;
      const type = classifyRoom(room);
      counts.set(type, (counts.get(type) ?? 0) + sockets.size);
    }
    // Reset gauge for all known types so absent rooms report 0 (not stale last value)
    const knownTypes: RoomType[] = [
      'user', 'admin-visitor-chats', 'admin-channels', 'admin-infra',
      'employee-dashboard', 'staff-online', 'studio', 'booking', 'order',
      'conversation', 'visitor', 'staff-chat', 'global', 'other',
    ];
    for (const type of knownTypes) {
      wsActiveRoomsSize.set({ room_type: type }, counts.get(type) ?? 0);
    }
  } catch (err) {
    log.warn('collectWsRoomsSnapshot failed', { error: String(err) });
  }
}

export function startMetricsCollector(): void {
  if (collectorInterval) return;
  collectOnce();
  collectorInterval = setInterval(() => collectOnce(), 15_000);
  log.info('Metrics collector started (15s interval)');
}

export function stopMetricsCollector(): void {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
  }
}
