/**
 * WS Pub/Sub Service — worker→api Socket.IO bridge via Redis pub/sub.
 *
 * Зачем нужен:
 *  В split-PM2 топологии non-api процессы (scheduler/outbound/bot/ai/telephony) НЕ держат
 *  Socket.IO server, но им нужно эмитить события в клиентские комнаты.
 *  Этот service публикует envelope в Redis channel `ws:broadcast:v1`;
 *  api-процесс подписан и ре-эмитит envelope через свой io.
 *
 * Redis adapter (@socket.io/redis-adapter) автоматически синхронизирует ROOMS
 * между api-нодами, но НЕ умеет cross-process emit от worker'а без io-инстанса.
 * Этот слой решает именно эту проблему.
 *
 * Design notes:
 *  - Отдельный ioredis client для publish (createResilientRedis) и отдельный
 *    для subscribe — ioredis нельзя смешивать subscribe на клиенте, используемом
 *    для Socket.IO adapter.
 *  - Whitelist `PUBSUB_EVENTS` закрывает набор допустимых событий — любое
 *    неожиданное имя инкрементит `ws_pubsub_dropped_total{reason="schema_mismatch"}`.
 *  - LRU dedupe (1000×10s) защищает от replay при переподключении подписчика.
 *  - Bounded receive queue (10k) отсекает backpressure, чтобы event loop не залип.
 *  - Version'ится канал (`v1`) — rolling upgrade сможет крутить обе версии.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type Redis from 'ioredis';
import { createResilientRedis } from '../services/redis-factory.js';
import type { WsEventPayload } from '../types/jsonb/ws-payload.js';
import { createLogger } from '../utils/logger.js';
import { logAndEmit } from './log-and-emit.js';
import { getProcessRole, type ProcessRole } from './role.js';
import {
  wsPubsubPublishedTotal,
  wsPubsubReceivedTotal,
  wsPubsubEmitFailedTotal,
  wsPubsubDroppedTotal,
  wsPubsubLagMs,
} from '../services/metrics.service.js';

const log = createLogger('ws-pubsub');

// ─── Channel & envelope ─────────────────────────────────────────────────────

/** Versioned Redis channel — bump на любых breaking changes в envelope. */
export const WS_PUBSUB_CHANNEL = 'ws:broadcast:v1';

/** Whitelist closed-set — PubSub может переносить ТОЛЬКО эти события. */
export const PUBSUB_EVENTS = [
  // Notifications & presence
  'notification:new',
  'notification:count',
  'user:online',
  'user:offline',
  'staff-chat:presence-change',
  // Chat & inbox
  'chat:inbox-updated',
  'chat:assigned',
  'inbox:counts',
  'chatClientLinked',
  'visitor:new-message',
  'message:status-update',
  'message:media-ready',
  'conversation:updated',
  'contact:merge-suggested',
  // Operator/visitor chat (worker-generated)
  'operator:message',
  'operator:typing',
  // Telephony
  'telephony:incoming_call',
  'telephony:call_event',
  // Media / email / approvals
  'media:dlq:alert',
  'email:new',
  'approval:photo-reviewed',
  'approval:session-completed',
  'approval:photo-uploaded',
  // Orders & bookings
  'order:created',
  'order:updated',
  'order:status-changed',
  'order:deleted',
  'booking:created',
  'booking:updated',
  'booking:cancelled',
  'booking:rescheduled',
  // Payments
  'payment-link:expired',
  'payment-link:paid',
  'payment-link:linked',
  'payment-link:updated',
  'payment-link:cancelled',
  // Studios
  'studio:status-changed',
  // Staff chat
  'staff-chat:mention',
  'staff-chat:new-message',
  // Tasks
  'task:created',
  'task:updated',
  'task:assigned',
  'task:handoff',
  // Fiscal / POS
  'fiscal:success',
  'fiscal:failure',
  'fiscal:circuit',
  'pos:transaction-update',
  'pos:orphan_payment',
  // Print
  'print:job-update',
  'print:job-paused',
  'print:job-resumed',
  'print:queue-paused',
  'print:queue-resumed',
  'print:copy-progress',
  'print:job-split',
  'print:supply-alert',
  'print:finishing-update',
  'print:job-held',
  'print:job-released',
  'print:job-scheduled',
  'print:template-applied',
  'print:state-transition',
  // Infra
  'infra:heartbeat',
  'infra:alert',
  'infra:telemetry',
  'infra:printer-status',
  'infra:security-event',
  // Fleet (SNMP polling + CUPS page_log parser + Alerts Engine)
  'printer:telemetry-updated',
  'printer:job-recorded',
  'printer:alert-raised',
  'printer:alert-resolved',
] as const;

export type PubSubEvent = typeof PUBSUB_EVENTS[number];

const PUBSUB_EVENT_SET: ReadonlySet<string> = new Set<string>(PUBSUB_EVENTS);

/** Sentinel room для io.emit без конкретной комнаты. */
export const GLOBAL_ROOM = '__GLOBAL__';

/** Well-known room names (для exhaustive type-check в call-sites). */
export type WellKnownRoom =
  | 'admin:visitor-chats'
  | 'admin:channels'
  | 'admin:infra'
  | 'employee:dashboard'
  | 'staff-online'
  | typeof GLOBAL_ROOM;

/** Template-literal typed rooms (user:<id>, booking:<id>, …). */
export type PubSubRoom =
  | WellKnownRoom
  | `user:${string}`
  | `booking:${string}`
  | `order:${string}`
  | `studio:${string}`
  | `visitor:${string}`
  | `conversation:${string}`
  | `staff-chat:${string}`;

export interface WsEnvelope {
  /** Envelope version — bump на breaking changes. */
  readonly v: 1;
  readonly event: PubSubEvent;
  readonly room: PubSubRoom;
  readonly payload: WsEventPayload;
  /** ISO timestamp (millisecond resolution) момента publish'а — для lag-метрики. */
  readonly emittedAt: string;
  readonly sourceRole: ProcessRole;
  readonly sourcePid: number;
  /** Опциональный dedup-ключ; если не указан — `${event}:${emittedAt}:${pid}:${rand}`. */
  readonly dedupeKey?: string;
}

// ─── Dedupe (simple TTL Map, no extra dependency) ───────────────────────────

const DEDUPE_TTL_MS = 10_000;
const DEDUPE_CAPACITY = 1000;

class TtlDedupe {
  private readonly entries = new Map<string, number>(); // key → expiresAt (ms since epoch)

  /**
   * Returns true if the key is новая (ранее не виделась в окне TTL).
   * Returns false if уже seen (duplicate).
   */
  check(key: string, nowMs: number): boolean {
    // Lazy eviction: если Map разросся сверх capacity, чистим протухшие entries.
    if (this.entries.size > DEDUPE_CAPACITY) {
      for (const [k, exp] of this.entries) {
        if (exp <= nowMs) this.entries.delete(k);
        if (this.entries.size <= DEDUPE_CAPACITY) break;
      }
      // Если всё ещё full и всё свежее — дропаем самого старого (FIFO через iterator).
      if (this.entries.size > DEDUPE_CAPACITY) {
        const firstKey = this.entries.keys().next().value;
        if (firstKey !== undefined) this.entries.delete(firstKey);
      }
    }

    const expiresAt = this.entries.get(key);
    if (expiresAt !== undefined && expiresAt > nowMs) {
      return false; // duplicate
    }
    this.entries.set(key, nowMs + DEDUPE_TTL_MS);
    return true;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

const RECEIVE_QUEUE_MAX = 10_000;

export interface WsPubSubStats {
  role: ProcessRole;
  bound: boolean;
  subscribed: boolean;
  queueSize: number;
  dedupeSize: number;
}

export class WsPubSubService {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private io: SocketIOServer | null = null;
  private subscribed = false;
  private dedupe = new TtlDedupe();
  private receiveQueueSize = 0;
  private shuttingDown = false;

  /**
   * Publish envelope в Redis pub/sub. Создаётся lazy pub-client на первом publish.
   * Вызывается non-api процессами (scheduler/outbound/bot/ai/telephony).
   *
   * Никогда не бросает — при ошибке инкрементит `ws_pubsub_dropped_total` и возвращается.
   */
  async publish(
    event: PubSubEvent,
    room: PubSubRoom,
    payload: WsEventPayload,
    opts?: { dedupeKey?: string },
  ): Promise<void> {
    if (this.shuttingDown) {
      wsPubsubDroppedTotal.inc({ reason: 'shutting_down' });
      return;
    }

    if (!PUBSUB_EVENT_SET.has(event)) {
      wsPubsubDroppedTotal.inc({ reason: 'schema_mismatch' });
      log.warn('publish rejected — event not in whitelist', { event, room });
      return;
    }

    try {
      if (!this.pubClient) {
        this.pubClient = createResilientRedis('ws-pubsub-pub', {
          lazyConnect: true,
          enableOfflineQueue: true, // worker может публиковать до connect
        });
        await this.pubClient.connect().catch((err: unknown) => {
          log.warn('ws-pubsub-pub connect failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      const envelope: WsEnvelope = {
        v: 1,
        event,
        room,
        payload,
        emittedAt: new Date().toISOString(),
        sourceRole: getProcessRole(),
        sourcePid: process.pid,
        ...(opts?.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}),
      };

      const serialized = JSON.stringify(envelope);
      await this.pubClient.publish(WS_PUBSUB_CHANNEL, serialized);
      wsPubsubPublishedTotal.inc({ event, source_role: envelope.sourceRole });
    } catch (err: unknown) {
      wsPubsubDroppedTotal.inc({ reason: 'publish_error' });
      log.warn('ws-pubsub publish failed', {
        event,
        room,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Bind Socket.IO server для получения envelope'ов и ре-эмита.
   * Вызывается ТОЛЬКО в api-процессе после создания SocketServer.
   *
   * Создаёт свой subscriber client (отдельный от Socket.IO adapter subClient).
   */
  async bindIO(io: SocketIOServer): Promise<void> {
    if (this.io !== null) {
      log.warn('bindIO called twice — ignoring second call');
      return;
    }
    this.io = io;

    try {
      this.subClient = createResilientRedis('ws-pubsub-sub', {
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await this.subClient.connect();

      await this.subClient.subscribe(WS_PUBSUB_CHANNEL);
      this.subscribed = true;

      this.subClient.on('message', (channel: string, raw: string) => {
        if (channel !== WS_PUBSUB_CHANNEL) return;
        this.handleMessage(raw);
      });

      log.info('ws-pubsub subscribed', { channel: WS_PUBSUB_CHANNEL });
    } catch (err: unknown) {
      log.error('ws-pubsub bindIO failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Не throw — api продолжит работать в degraded режиме (без worker-emits).
    }
  }

  private handleMessage(raw: string): void {
    // Bounded queue backpressure guard — дропаем при overflow.
    if (this.receiveQueueSize >= RECEIVE_QUEUE_MAX) {
      wsPubsubDroppedTotal.inc({ reason: 'backpressure' });
      return;
    }
    this.receiveQueueSize++;

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        wsPubsubDroppedTotal.inc({ reason: 'parse_error' });
        return;
      }

      if (!this.isValidEnvelope(parsed)) {
        wsPubsubDroppedTotal.inc({ reason: 'schema_mismatch' });
        return;
      }

      const envelope = parsed;

      // Dedupe: приоритет явному ключу, иначе stable-hash из содержимого envelope.
      const dedupeKey = envelope.dedupeKey
        ?? `${envelope.event}:${envelope.room}:${envelope.emittedAt}:${envelope.sourcePid}`;
      const now = Date.now();
      if (!this.dedupe.check(dedupeKey, now)) {
        wsPubsubDroppedTotal.inc({ reason: 'dedupe' });
        return;
      }

      // Lag metric: разница между publisher'ским timestamp и receive-time.
      const emittedAtMs = Date.parse(envelope.emittedAt);
      if (!Number.isNaN(emittedAtMs)) {
        wsPubsubLagMs.observe(Math.max(0, now - emittedAtMs));
      }

      wsPubsubReceivedTotal.inc({ event: envelope.event });

      if (!this.io) {
        wsPubsubEmitFailedTotal.inc({ event: envelope.event, reason: 'io_unbound' });
        return;
      }

      try {
        // logAndEmit сохраняет CRITICAL_WS_EVENTS whitelist + room-size метрики.
        logAndEmit(this.io, envelope.room, envelope.event, envelope.payload);
      } catch (err: unknown) {
        wsPubsubEmitFailedTotal.inc({ event: envelope.event, reason: 'emit_error' });
        log.warn('ws-pubsub re-emit failed', {
          event: envelope.event,
          room: envelope.room,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      this.receiveQueueSize--;
    }
  }

  private isValidEnvelope(x: unknown): x is WsEnvelope {
    if (!isUnknownObject(x)) return false;
    const e = x;
    if (e['v'] !== 1) return false;
    if (typeof e['event'] !== 'string' || !PUBSUB_EVENT_SET.has(e['event'] as string)) return false;
    if (typeof e['room'] !== 'string') return false;
    if (typeof e['emittedAt'] !== 'string') return false;
    if (typeof e['sourceRole'] !== 'string') return false;
    if (typeof e['sourcePid'] !== 'number') return false;
    if (!e['payload'] || typeof e['payload'] !== 'object') return false;
    if (e['dedupeKey'] !== undefined && typeof e['dedupeKey'] !== 'string') return false;
    return true;
  }

  /**
   * Graceful shutdown — unsubscribe + quit обоих клиентов.
   * Вызывается из registerShutdownHandlers → API/worker cleanup.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const tasks: Promise<unknown>[] = [];

    if (this.subClient) {
      tasks.push(
        (async () => {
          try {
            if (this.subscribed) await this.subClient!.unsubscribe(WS_PUBSUB_CHANNEL);
          } catch (err: unknown) {
            log.warn('ws-pubsub unsubscribe failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            await this.subClient!.quit();
          } catch {
            /* already quit */
          }
        })(),
      );
    }

    if (this.pubClient) {
      tasks.push(
        this.pubClient.quit().catch(() => { /* already quit */ }),
      );
    }

    await Promise.allSettled(tasks);
    this.subscribed = false;
    this.io = null;
    this.dedupe.clear();
  }

  stats(): WsPubSubStats {
    return {
      role: getProcessRole(),
      bound: this.io !== null,
      subscribed: this.subscribed,
      queueSize: this.receiveQueueSize,
      dedupeSize: this.dedupe.size(),
    };
  }
}

interface UnknownObject {
  [key: string]: unknown;
}

function isUnknownObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null;
}

/** Singleton — импортируй `wsPubSub`, не создавай новых инстансов. */
export const wsPubSub = new WsPubSubService();
