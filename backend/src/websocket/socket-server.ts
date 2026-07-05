import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import type Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config/index.js';
import { createResilientRedis } from '../services/redis-factory.js';
import { createLogger } from '../utils/logger.js';
import { verifyJwt, signJwt } from '../utils/jwt-keys.js';
import { logAndEmit } from './log-and-emit.js';
import {
  wsHeartbeatRefreshTotal,
  wsConnectTotal,
  wsDisconnectTotal,
} from '../services/metrics.service.js';

const socketLog = createLogger('socket-server');
import { RedisSubscriberService } from '../services/redis-subscriber.service.js';
import { initAIChatService } from '../services/ai-chat.service.js';
import { NotificationService } from '../services/notification.service.js';
import { sendVisitorChatPush } from '../services/visitor-push.service.js';
import { pool } from '../database/db.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import {
  NATIVE_NOTIFIER_ALL_ROOM,
  isNativeNotifierTokenValid,
  nativeNotifierAgentRoom,
  nativeNotifierStudioRoom,
  nativeNotifierUserRoom,
  parseNativeNotifierHandshake,
  type NativeNotifierIdentity,
} from '../services/native-notifier.service.js';
import type Contacts from '../types/generated/public/Contacts.js';
import type Conversations from '../types/generated/public/Conversations.js';

/** Читаем APP_VERSION из фронтенд-константы при старте сервера */
function readAppVersion(): string {
  try {
    const __dirname2 = dirname(fileURLToPath(import.meta.url));
    const versionFile = resolve(__dirname2, '../../../src/app/core/constants/version.ts');
    const content = readFileSync(versionFile, 'utf-8');
    const match = content.match(/APP_VERSION\s*=\s*['"](.+?)['"]/);
    return match?.[1] || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Кэш версии: перечитываем файл не чаще раза в 60 секунд
let cachedVersion = 'unknown';
let lastReadTime = 0;
const VERSION_CACHE_TTL = 60_000; // 60 секунд

function getAppVersion(): string {
  const now = Date.now();
  if (now - lastReadTime < VERSION_CACHE_TTL && cachedVersion !== 'unknown') {
    return cachedVersion;
  }
  cachedVersion = readAppVersion();
  lastReadTime = now;
  return cachedVersion;
}

interface SocketJwtPayload extends jwt.JwtPayload {
  userId: string;
  role: string;
  type?: string;
}

interface WsEventPayload {
  readonly [key: string]: unknown;
}

interface VisitorPresenceSnapshotRow {
  id: Conversations['id'];
  client_last_seen_at: string | null;
}

function isSocketJwtPayload(value: jwt.JwtPayload | string): value is SocketJwtPayload {
  return typeof value === 'object'
    && value !== null
    && typeof value['userId'] === 'string'
    && typeof value['role'] === 'string';
}

function jwtExpiresInSeconds(value: string): number {
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(trimmed);
  if (!match) return 15 * 60;

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return 15 * 60;

  switch (unit) {
    case 'ms':
      return Math.max(1, Math.ceil(amount / 1000));
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 24 * 60 * 60;
    default:
      return 15 * 60;
  }
}

socketLog.info(`[SocketServer] Initial APP_VERSION: ${getAppVersion()}`);

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  // Версия клиента для stale-detection
  clientVersion?: string;
  // Contact id (из JWT→contacts.user_id). Используется для auto-join и ownership.
  contactId?: string;
  // Active conversation IDs, в которые сокет auto-joined при connect.
  activeConversationIds?: string[];
  // Browser-independent machine agent for local desktop notifications.
  nativeNotifier?: NativeNotifierIdentity;
}

export interface ChatMessage {
  id: string;
  bookingId: string;
  senderId: string;
  senderName: string;
  senderRole: 'client' | 'photographer';
  message: string;
  timestamp: Date;
  read: boolean;
}

export interface TypingIndicator {
  bookingId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface OnlineStatus {
  userId: string;
  status: 'online' | 'offline';
  lastSeen: Date;
}

export class SocketServer {
  private io: SocketIOServer;
  /**
   * Redis-backed online users tracking for multi-node.
   * Redis Sorted Set 'ws:online' stores userId with Unix timestamp as score.
   * In-memory Map is a local hot cache — authoritative data in Redis.
   */
  private onlineUsersLocal = new Map<string, string>(); // userId -> socketId (local node only)
  private onlineRedis: Redis | null = null; // reuses pubClient from adapter
  private redisSubscriber: RedisSubscriberService | null = null;
  private rateLimitRedis: Redis | null = null;
  private staleCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly HEARTBEAT_INTERVAL_MS = 60_000;

  constructor(httpServer: HttpServer) {
    const corsOrigins = config.cors.origin.split(',').map(s => s.trim());
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
        credentials: true,
      },
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000,
      connectTimeout: 10000,
    });

    // Redis adapter for multi-node Socket.IO (syncs rooms/events between ALB instances)
    this.initRedisAdapter();

    this.setupMiddleware();
    this.setupEventHandlers();

    // Инициализация Redis Pub/Sub для получения ответов операторов
    this.initRedisSubscriber();

    // Инициализация AI Chat Service
    initAIChatService(this.io);
  }

  /**
   * Redis adapter: синхронизация Socket.IO rooms между нодами (ALB)
   */
  private async initRedisAdapter(): Promise<void> {
    try {
      const pubClient = createResilientRedis('socket-io-pub', { lazyConnect: true });
      const subClient = createResilientRedis('socket-io-sub', { lazyConnect: true });
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.io.adapter(createAdapter(pubClient, subClient));

      // Reuse pubClient for rate limiting and online-users tracking
      this.rateLimitRedis = pubClient;
      this.onlineRedis = pubClient;

      // Migrate from legacy SET to Sorted Set (one-time, idempotent)
      this.migrateOnlineSetToZset().catch(err =>
        socketLog.warn('Failed to migrate ws:online SET to ZSET', { error: err instanceof Error ? err.message : String(err) }),
      );

      // Periodic cleanup of stale entries (every 60s, removes entries older than 5 min)
      this.staleCleanupInterval = setInterval(() => {
        this.cleanupStaleOnlineUsers().catch(err =>
          socketLog.warn('Failed to cleanup stale online users', { error: err instanceof Error ? err.message : String(err) }),
        );
      }, 60_000);

      // Periodic heartbeat tick: refresh ws:online for all locally-connected users.
      // Protects against ZSET drift when users stay connected but don't emit events.
      this.heartbeatInterval = setInterval(() => {
        this.heartbeatTickAll().catch(err =>
          socketLog.warn('Failed to run heartbeatTickAll', { error: err instanceof Error ? err.message : String(err) }),
        );
      }, SocketServer.HEARTBEAT_INTERVAL_MS);

      socketLog.info('Redis adapter initialized — multi-node sync enabled');
    } catch (error: unknown) {
      socketLog.error('Failed to init Redis adapter (falling back to in-memory)', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Socket.IO continues with in-memory adapter — single-node only
    }
  }

  /**
   * Инициализация Redis Subscriber для получения ответов операторов
   */
  private async initRedisSubscriber(): Promise<void> {
    try {
      this.redisSubscriber = new RedisSubscriberService();
      this.redisSubscriber.setIO(this.io);
      await this.redisSubscriber.connect();
      socketLog.info('[SocketServer] Redis subscriber initialized for operator messages');
    } catch (error) {
      socketLog.error('[SocketServer] Failed to initialize Redis subscriber:', { error: String(error) });
      // Не критичная ошибка — приложение продолжит работу без Redis subscriber
    }
  }

  /**
   * Setup authentication middleware (auth-only 2026-04-19).
   * JWT из httpOnly cookie `access_token` или Bearer header.
   * Anonymous chat-widget path удалён полностью.
   */
  private setupMiddleware(): void {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      const nativeNotifierHandshake = parseNativeNotifierHandshake(socket.handshake.auth);
      if (nativeNotifierHandshake) {
        if (!isNativeNotifierTokenValid(nativeNotifierHandshake.token)) {
          return next(new Error('Authentication error: Invalid native notifier token'));
        }
        socket.nativeNotifier = nativeNotifierHandshake.identity;
        socket.clientVersion = nativeNotifierHandshake.identity.version;
        return next();
      }

      // Cookie: access_token (primary channel, httpOnly)
      const cookieHeader = socket.handshake.headers.cookie || '';
      const cookieMatch = cookieHeader.match(/(?:^|;\s*)access_token=([^;]+)/);
      const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch[1]) : undefined;
      const bearerToken = socket.handshake.auth['token'] || socket.handshake.headers.authorization?.split(' ')[1];
      const token = cookieToken || bearerToken;

      const appVersion = socket.handshake.auth['appVersion'];
      socket.clientVersion = typeof appVersion === 'string' ? appVersion : undefined;

      // Authz: только JWT. Anonymous chat-widget path удалён (2026-04-19).
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      try {
        const decoded = verifyJwt(token);
        if (!isSocketJwtPayload(decoded)) {
          return next(new Error('Authentication error: Invalid token payload'));
        }
        socket.userId = decoded.userId;
        socket.userRole = decoded.role;
        next();
      } catch (error: unknown) {
        // JWT expired — try refresh token for seamless WS reconnect
        const rawRefreshToken = socket.handshake.auth['refreshToken'];
        const refreshToken = typeof rawRefreshToken === 'string' ? rawRefreshToken : undefined;
        if (refreshToken && error instanceof Error && error.name === 'TokenExpiredError') {
          try {
            const refreshDecoded = verifyJwt(refreshToken);
            if (!isSocketJwtPayload(refreshDecoded)) {
              return next(new Error('Authentication error: Invalid refresh token payload'));
            }
            if (refreshDecoded.type !== 'refresh') {
              return next(new Error('Authentication error: Invalid refresh token'));
            }
            // Issue new access token
            const newToken = signJwt(
              { userId: refreshDecoded.userId, role: refreshDecoded.role },
              { expiresIn: jwtExpiresInSeconds(config.jwt.expiresIn) },
            );
            socket.userId = refreshDecoded.userId;
            socket.userRole = refreshDecoded.role;
            // Send new token to client after connection
            setTimeout(() => {
              socket.emit('auth:token-refreshed', { token: newToken });
            }, 100);
            next();
          } catch {
            next(new Error('Authentication error: Invalid token'));
          }
        } else {
          next(new Error('Authentication error: Invalid token'));
        }
      }
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      if (socket.nativeNotifier) {
        this.handleNativeNotifierConnection(socket);
        return;
      }

      socketLog.info(`User connected: ${socket.userId} (${socket.id})`);
      wsConnectTotal.inc({ role: socket.userRole || 'unknown' });

      // Health-check ping (client-initiated watchdog). Returns ACK immediately.
      socket.on('ping:health-check', (ack: unknown) => {
        if (typeof ack === 'function') {
          ack({ ok: true });
        }
      });

      // Проверка версии клиента — отправляем обновление если устарела
      const currentServerVersion = getAppVersion();
      if (socket.clientVersion && socket.clientVersion !== currentServerVersion && currentServerVersion !== 'unknown') {
        socketLog.info(`[SocketServer] Stale client detected: ${socket.userId} has v${socket.clientVersion}, server v${currentServerVersion}`);
        socket.emit('app:update-available', {
          currentVersion: socket.clientVersion,
          latestVersion: currentServerVersion,
        });
      }

      // Add user to online users (local + Redis ZSET with timestamp)
      if (socket.userId) {
        this.onlineUsersLocal.set(socket.userId, socket.id);
        if (this.onlineRedis) {
          const now = Math.floor(Date.now() / 1000);
          this.onlineRedis.zadd('ws:online', now, socket.userId).catch(err =>
            socketLog.warn('Failed to ZADD ws:online', { error: err instanceof Error ? err.message : String(err) }),
          );
          // Safety net TTL — auto-expires key if no activity for 10 min
          this.onlineRedis.expire('ws:online', 600).catch(err =>
            socketLog.warn('Failed to set EXPIRE on ws:online', { error: err instanceof Error ? err.message : String(err) }),
          );
        }
        this.broadcastOnlineStatus(socket.userId, 'online');

        // Auto-join notification room for JWT-authenticated users
        socket.join(`user:${socket.userId}`);

        if (['admin', 'manager', 'employee', 'photographer'].includes(socket.userRole || '')) {
          socket.join('staff-online');
          socket.join('employee:dashboard');
          this.io.to('staff-online').emit('staff-chat:presence-change', {
            userId: socket.userId,
            online: true,
            lastSeenAt: new Date().toISOString(),
          });
        }

        if (socket.userRole === 'admin' || socket.userRole === 'manager') {
          socket.join('admin:visitor-chats');
        }

        if (socket.userRole === 'admin') {
          socket.join('admin:channels');
        }

        NotificationService.getUnreadCount(socket.userId).then(count => {
          socket.emit('notification:count', { count });
        }).catch(err => {
          socketLog.error('[SocketServer] Failed to get unread count', { error: String(err) });
        });

        this.autoJoinWebConversations(socket).catch(err =>
          socketLog.warn('Failed to auto-join conversation rooms', { error: String(err) }),
        );
      }

      // Heartbeat: refresh online timestamp on any meaningful socket event
      const refreshHeartbeat = (): void => {
        if (socket.userId) this.refreshOnlineHeartbeat(socket.userId);
      };

      // Join booking room
      socket.on('join:booking', (bookingId: string) => {
        refreshHeartbeat();
        socket.join(`booking:${bookingId}`);
        socketLog.info(`User ${socket.userId} joined booking room: ${bookingId}`);
      });

      // Leave booking room
      socket.on('leave:booking', (bookingId: string) => {
        socket.leave(`booking:${bookingId}`);
        socketLog.info(`User ${socket.userId} left booking room: ${bookingId}`);
      });

      // ── Order Tracking (для клиентского трекинга заказа) ──
      socket.on('order:track', (orderId: string) => {
        socket.join(`order:${orderId}`);
        socketLog.info(`[OrderTrack] ${socket.userId} subscribed to order ${orderId}`);
      });

      socket.on('order:untrack', (orderId: string) => {
        socket.leave(`order:${orderId}`);
      });

      // Send message
      socket.on('message:send', (data: Omit<ChatMessage, 'id' | 'timestamp' | 'read'>) => {
        refreshHeartbeat();
        const message: ChatMessage = {
          ...data,
          id: this.generateMessageId(),
          timestamp: new Date(),
          read: false,
        };

        // Broadcast to booking room
        this.io.to(`booking:${data.bookingId}`).emit('message:received', message);
        socketLog.info(`Message sent to booking ${data.bookingId} by ${socket.userId}`);
      });

      // Typing indicator
      socket.on('typing:start', (data: { bookingId: string; userName: string }) => {
        refreshHeartbeat();
        const userId = socket.userId;
        if (!userId) {
          return;
        }
        const indicator: TypingIndicator = {
          bookingId: data.bookingId,
          userId,
          userName: data.userName,
          isTyping: true,
        };
        socket.to(`booking:${data.bookingId}`).emit('typing:update', indicator);
      });

      socket.on('typing:stop', (data: { bookingId: string; userName: string }) => {
        const userId = socket.userId;
        if (!userId) {
          return;
        }
        const indicator: TypingIndicator = {
          bookingId: data.bookingId,
          userId,
          userName: data.userName,
          isTyping: false,
        };
        socket.to(`booking:${data.bookingId}`).emit('typing:update', indicator);
      });

      // Mark messages as read
      socket.on('messages:read', (data: { bookingId: string; messageIds: string[] }) => {
        socket.to(`booking:${data.bookingId}`).emit('messages:read', data);
      });

      // Disconnect
      socket.on('disconnect', (reason: string) => {
        try {
          const lastSeenAt = new Date().toISOString();
          wsDisconnectTotal.inc({ reason: reason || 'unknown' });
          socketLog.info(`User disconnected: ${socket.userId} (${socket.id}) reason=${reason}`);

          if (socket.userId) {
            this.onlineUsersLocal.delete(socket.userId);
            if (this.onlineRedis) {
              this.onlineRedis.zrem('ws:online', socket.userId).catch(err =>
                socketLog.warn('Failed to ZREM ws:online on disconnect', { error: err instanceof Error ? err.message : String(err) }),
              );
            }
            this.broadcastOnlineStatus(socket.userId, 'offline');

            // Update last_seen_at and emit presence-change for staff
            pool.query(
              `UPDATE users SET last_seen_at = NOW() WHERE id = $1`,
              [socket.userId],
            ).catch(err =>
              socketLog.warn('Failed to update last_seen_at', { error: err instanceof Error ? err.message : String(err) }),
            );

            if (['admin', 'manager', 'employee', 'photographer'].includes(socket.userRole || '')) {
              this.io.to('staff-online').emit('staff-chat:presence-change', {
                userId: socket.userId,
                online: false,
                lastSeenAt,
              });
            }
          }

          if (socket.contactId) {
            pool.query(
              `UPDATE contacts SET last_seen_at = NOW() WHERE id = $1`,
              [socket.contactId],
            ).catch(err =>
              socketLog.warn('Failed to update contact last_seen_at', { error: err instanceof Error ? err.message : String(err) }),
            );
          }

          // Notify operators that user went offline for all auto-joined conversations
          if (socket.activeConversationIds?.length) {
            for (const sessionId of socket.activeConversationIds) {
              setTimeout(() => {
                this.io.in(`visitor:${sessionId}`).allSockets().then(sockets => {
                  if (sockets.size > 0) return;
                  this.io.to('admin:visitor-chats').emit('visitor:online-status', {
                    sessionId,
                    online: false,
                    lastSeenAt,
                  });
                }).catch(err =>
                  socketLog.warn('Failed to check visitor sockets after disconnect', { error: err instanceof Error ? err.message : String(err) }),
                );
              }, 0);
            }
          }
        } finally {
          try { socket.offAny(); } catch { /* noop */ }
          try { socket.removeAllListeners(); } catch { /* noop */ }
          socket.activeConversationIds = undefined;
          socket.contactId = undefined;
          socket.clientVersion = undefined;
        }
      });

      // Error handling
      socket.on('error', (error) => {
        socketLog.error(`Socket error for user ${socket.userId}:`, { error: error.message });
      });

      // ============================================================
      // Chat Events (auth-only, legacy visitor:* удалены 2026-04-19)
      // ============================================================

      // Подтверждение доставки сообщения (клиент получил).
      // Ownership: membership в комнате conversation:<sid> (из auto-join).
      socket.on('message:delivered', async (data: { sessionId?: string; messageIds: string[] }) => {
        if (!data.messageIds?.length) return;
        if (!data.sessionId || !socket.rooms.has(`conversation:${data.sessionId}`)) {
          socketLog.warn('[Security] message:delivered for unjoined conversation', {
            sessionId: data.sessionId, userId: socket.userId,
          });
          return;
        }
        try {
          const { rowCount } = await pool.query(
            `UPDATE messages SET delivered_at = NOW()
             WHERE id = ANY($1) AND conversation_id = $2
               AND sender_type = 'operator' AND delivered_at IS NULL`,
            [data.messageIds, data.sessionId]
          );
          if (rowCount && rowCount > 0) {
            this.io.to('admin:visitor-chats').emit('message:status-update', {
              sessionId: data.sessionId,
              conversationId: data.sessionId,
              messageIds: data.messageIds,
              status: 'delivered',
            });
          }
        } catch (err) {
          socketLog.warn('[SocketServer] message:delivered failed:', { error: String(err) });
        }
      });

      // Подтверждение прочтения (клиент видит сообщение).
      // Ownership: membership в комнате conversation:<sid>.
      socket.on('message:read', async (data: { sessionId?: string; messageIds: string[] }) => {
        if (!data.messageIds?.length) return;
        if (!data.sessionId || !socket.rooms.has(`conversation:${data.sessionId}`)) {
          socketLog.warn('[Security] message:read for unjoined conversation', {
            sessionId: data.sessionId, userId: socket.userId,
          });
          return;
        }
        try {
          const { rowCount } = await pool.query(
            `UPDATE messages
             SET is_read = true, read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
             WHERE id = ANY($1) AND conversation_id = $2
               AND sender_type = 'operator' AND is_read = false`,
            [data.messageIds, data.sessionId]
          );
          if (rowCount && rowCount > 0) {
            this.io.to('admin:visitor-chats').emit('message:status-update', {
              sessionId: data.sessionId,
              conversationId: data.sessionId,
              messageIds: data.messageIds,
              status: 'read',
            });
          }
        } catch (err) {
          socketLog.warn('[SocketServer] message:read failed:', { error: String(err) });
        }
      });

      // ============================================================
      // Task Board Events (для рабочей доски сотрудников)
      // ============================================================

      // Сотрудник подписывается на обновления задач точки
      socket.on('tasks:subscribe', (studioId: string) => {
        refreshHeartbeat();
        if (socket.userRole && ['admin', 'employee', 'photographer'].includes(socket.userRole)) {
          if (studioId && studioId !== 'all') {
            socket.join(`studio:${studioId}`);
          }
          socket.join('employee:dashboard');
          socketLog.info(`Employee ${socket.userId} subscribed to task events${studioId && studioId !== 'all' ? ': ' + studioId : ' (all)'}`);
        }
      });

      // Отписка от задач точки
      socket.on('tasks:unsubscribe', (studioId: string) => {
        if (studioId && studioId !== 'all') {
          socket.leave(`studio:${studioId}`);
        }
        socket.leave('employee:dashboard');
      });

      // Оператор открыл чат → broadcast другим (collision detection)
      socket.on('admin:viewing-chat', (data: { sessionId: string; operatorName?: string }) => {
        refreshHeartbeat();
        if (socket.userId && data.sessionId) {
          socket.to('admin:visitor-chats').emit('chat:viewing', {
            sessionId: data.sessionId,
            operatorId: socket.userId,
            operatorName: data.operatorName || 'Оператор',
          });
        }
      });

      // Оператор закрыл чат → broadcast (collision detection)
      socket.on('admin:left-chat', (data: { sessionId: string }) => {
        refreshHeartbeat();
        if (socket.userId && data.sessionId) {
          socket.to('admin:visitor-chats').emit('chat:left', {
            sessionId: data.sessionId,
            operatorId: socket.userId,
          });
        }
      });

      // Оператор печатает → relay к visitor + broadcast другим операторам
      socket.on('admin:operator-typing', (data: { sessionId: string; isTyping: boolean }) => {
        refreshHeartbeat();
        if (socket.userRole && data.sessionId) {
          // Relay to visitor
          this.io.to(`visitor:${data.sessionId}`).emit('operator:typing', {
            isTyping: data.isTyping,
          });
          // Broadcast to other operators (exclude sender)
          socket.to('admin:visitor-chats').emit('operator:typing', {
            sessionId: data.sessionId,
            operatorId: socket.userId,
            isTyping: data.isTyping,
          });
        }
      });

      // Оператор присоединяется к мониторингу чатов
      socket.on('admin:join-visitor-chats', () => {
        if (socket.userRole) {
          socket.join('admin:visitor-chats');
          socketLog.info(`Operator ${socket.userId} joined visitor chats monitoring`);
          this.emitVisitorPresenceSnapshot(socket).catch(err =>
            socketLog.warn('Failed to emit visitor presence snapshot', { error: err instanceof Error ? err.message : String(err) }),
          );
        }
      });

      // Join admin:channels room (explicit join for non-admin users with settings:manage permission)
      socket.on('admin:join-channels', () => {
        if (socket.userRole) {
          socket.join('admin:channels');
        }
      });

      // Join admin:infra room — real-time events from agents (print jobs, POS, telemetry, security)
      socket.on('admin:join-infra', () => {
        if (socket.userRole) {
          socket.join('admin:infra');
          socketLog.info(`User ${socket.userId} joined infra monitoring`);
        }
      });

      // Subscribe to infra monitoring (from InfraRealtimeService.subscribe())
      socket.on('infra:subscribe', () => {
        if (socket.userRole) {
          socket.join('admin:infra');
          socketLog.info(`User ${socket.userId} subscribed to infra monitoring`);
        }
      });

      // Unsubscribe from infra monitoring (from InfraRealtimeService.unsubscribe())
      socket.on('infra:unsubscribe', () => {
        socket.leave('admin:infra');
        socketLog.info(`User ${socket.userId} unsubscribed from infra monitoring`);
      });

      // Print queue: full state sync (on reconnect or initial load)
      socket.on('print:sync-request', async (data?: { studioId?: string }) => {
        if (!socket.userRole) return;
        try {
          const studioId = typeof data === 'object' && data?.studioId ? data.studioId : null;
          const { rows } = studioId
            ? await pool.query(
                `SELECT id, printer_id, status, file_name, paper_size, copies, created_at, studio_id, priority,
                        current_copy, total_copies_needed AS total_copies,
                        scheduled_at, finishing_status, finishing_ops,
                        group_id, tracking_code, auto_balanced,
                        held_by, held_at, split_strategy, child_count
                 FROM print_jobs
                 WHERE status IN ('queued','sending','printing','applying_icc','rendering_layout',
                                  'paused','held','scheduled','splitting','finishing','converting')
                   AND studio_id = $1
                 ORDER BY priority DESC, created_at ASC`,
                [studioId],
              )
            : await pool.query(
                `SELECT id, printer_id, status, file_name, paper_size, copies, created_at, studio_id, priority,
                        current_copy, total_copies_needed AS total_copies,
                        scheduled_at, finishing_status, finishing_ops,
                        group_id, tracking_code, auto_balanced,
                        held_by, held_at, split_strategy, child_count
                 FROM print_jobs
                 WHERE status IN ('queued','sending','printing','applying_icc','rendering_layout',
                                  'paused','held','scheduled','splitting','finishing','converting')
                 ORDER BY priority DESC, created_at ASC`,
              );
          socket.emit('print:sync', rows);
        } catch (err) {
          socketLog.warn('print:sync-request failed', { error: String(err) });
        }
      });

      // Оператор отвечает посетителю
      // NOTE: Do NOT emit operator:message here — the HTTP handler (chat-admin.routes.ts)
      // sends the authoritative message with DB id. Emitting here causes double delivery.
      socket.on('admin:reply-visitor', async (data: { sessionId: string; content: string; operatorName: string }) => {
        // Push-уведомление если посетитель офлайн (WS path is faster than HTTP for push check)
        try {
          const sockets = await this.io.in(`visitor:${data.sessionId}`).allSockets();
          if (sockets.size === 0) {
            await sendVisitorChatPush(data.sessionId, {
              title: data.operatorName || 'Своё Фото',
              body: data.content.length > 100 ? data.content.substring(0, 100) + '…' : data.content,
              tag: `sf-chat-${data.sessionId}`,
            });
          }
        } catch (pushErr) {
          socketLog.warn('[SocketServer] Failed to send push notification:', { error: String(pushErr) });
        }
      });

      // Клиент обновляет корзину (auth-only — проверяем room membership).
      socket.on('visitor:cart-update', (data: { sessionId: string; items: unknown[] }) => {
        if (data.sessionId && socket.rooms.has(`conversation:${data.sessionId}`)) {
          this.io.to('admin:visitor-chats').emit('visitor:cart-update', {
            sessionId: data.sessionId,
            items: data.items,
          });
        }
      });

      // Оператор обновляет корзину
      socket.on('admin:cart-update', (data: { sessionId: string; items: unknown[] }) => {
        if (socket.userRole && data.sessionId) {
          this.io.to(`visitor:${data.sessionId}`).emit('operator:cart-update', {
            sessionId: data.sessionId,
            items: data.items,
          });
        }
      });

      // --- Staff Chat ---
      // POS: кассир подписывается на stock updates своей студии
      socket.on('pos:join_studio', (studioId: string) => {
        if (socket.userRole && studioId) {
          socket.join(`studio:${studioId}`);
        }
      });

      socket.on('pos:leave_studio', (studioId: string) => {
        if (studioId) {
          socket.leave(`studio:${studioId}`);
        }
      });

      // --- Staff Chat ---
      socket.on('staff-chat:join', async (conversationId: string) => {
        if (!socket.userId || !conversationId) return;
        try {
          const { rows } = await pool.query(
            `SELECT 1 FROM staff_conversation_participants p
             JOIN users u ON u.id = p.user_id
             WHERE p.conversation_id = $1 AND p.user_id = $2
               AND p.left_at IS NULL AND u.is_active = true`,
            [conversationId, socket.userId],
          );
          if (rows.length > 0) {
            socket.join(`staff-chat:${conversationId}`);
          }
        } catch {
          // Silently fail — don't crash WS on DB error
        }
      });

      socket.on('staff-chat:leave', (conversationId: string) => {
        if (conversationId) {
          socket.leave(`staff-chat:${conversationId}`);
        }
      });

      socket.on('staff-chat:typing', (data: { conversationId: string; isTyping: boolean }) => {
        refreshHeartbeat();
        if (socket.userId && data.conversationId) {
          socket.to(`staff-chat:${data.conversationId}`).emit('staff-chat:typing', {
            conversationId: data.conversationId,
            userId: socket.userId,
            isTyping: data.isTyping,
          });
        }
      });
    });
  }

  private handleNativeNotifierConnection(socket: AuthenticatedSocket): void {
    const identity = socket.nativeNotifier;
    if (!identity) return;

    const rooms = [
      NATIVE_NOTIFIER_ALL_ROOM,
      nativeNotifierAgentRoom(identity.agentId),
    ];
    if (identity.studioId) rooms.push(nativeNotifierStudioRoom(identity.studioId));
    if (identity.userId) rooms.push(nativeNotifierUserRoom(identity.userId));

    for (const room of rooms) {
      socket.join(room);
    }

    wsConnectTotal.inc({ role: 'native-notifier' });
    socketLog.info('Native notifier agent connected', {
      agentId: identity.agentId,
      studioId: identity.studioId,
      userId: identity.userId,
      hostname: identity.hostname,
      platform: identity.platform,
      version: identity.version,
      socketId: socket.id,
    });

    socket.emit('native-notifier:hello', {
      ok: true,
      serverTime: new Date().toISOString(),
      rooms,
    });

    socket.on('native-notifier:heartbeat', (_data: unknown, ack: unknown) => {
      if (typeof ack === 'function') {
        ack({ ok: true, serverTime: new Date().toISOString() });
      }
    });

    socket.on('native-notifier:test-result', (data: unknown) => {
      const entries = typeof data === 'object' && data !== null ? Object.entries(data) : [];
      const id = entries.find(([key]) => key === 'id')?.[1];
      const ok = entries.find(([key]) => key === 'ok')?.[1];
      const error = entries.find(([key]) => key === 'error')?.[1];
      socketLog.info('Native notifier test result', {
        agentId: identity.agentId,
        id: typeof id === 'string' ? id : undefined,
        ok: typeof ok === 'boolean' ? ok : undefined,
        error: typeof error === 'string' ? error : undefined,
      });
    });

    socket.on('disconnect', (reason: string) => {
      wsDisconnectTotal.inc({ reason: reason || 'unknown' });
      socketLog.info('Native notifier agent disconnected', {
        agentId: identity.agentId,
        socketId: socket.id,
        reason,
      });
      socket.nativeNotifier = undefined;
      socket.clientVersion = undefined;
    });

    socket.on('error', (error) => {
      socketLog.error('Native notifier socket error', {
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Auto-join активные web-conversation комнаты текущего user'а на connect.
   * Использует contacts.user_id → conversations.contact_id pattern (auth-only).
   */
  private async autoJoinWebConversations(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.userId) return;
    const contactRow = await pool.query<Pick<Contacts, 'id'>>(
      'SELECT id FROM contacts WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [socket.userId],
    );
    if (contactRow.rows.length === 0) return;
    socket.contactId = contactRow.rows[0].id;

    try {
      await pool.query(
        'UPDATE contacts SET last_seen_at = NOW() WHERE id = $1',
        [socket.contactId],
      );
    } catch (err) {
      socketLog.warn('Failed to update contact last_seen_at on connect', { error: err instanceof Error ? err.message : String(err) });
    }

    const { rows } = await pool.query<Pick<Conversations, 'id'>>(
      `SELECT id FROM conversations
        WHERE contact_id = $1
          AND channel = 'web'
          AND status IN ('open','waiting','active')`,
      [socket.contactId],
    );
    const convIds = rows.map(r => r.id);
    socket.activeConversationIds = convIds;
    for (const id of convIds) {
      socket.join(`conversation:${id}`);
      socket.join(`visitor:${id}`);
      this.io.to('admin:visitor-chats').emit('visitor:online-status', {
        sessionId: id,
        online: true,
        lastSeenAt: new Date().toISOString(),
      });
    }
    if (convIds.length > 0) {
      socketLog.info(`User auto-joined ${convIds.length} web-conv rooms: ${socket.userId}`);
    }
  }

  private async emitVisitorPresenceSnapshot(socket: AuthenticatedSocket): Promise<void> {
    const { rows } = await pool.query<VisitorPresenceSnapshotRow>(
      `SELECT s.id, COALESCE(ct.last_seen_at, client_u.last_seen_at) AS client_last_seen_at
         FROM conversations s
         LEFT JOIN contacts ct ON ct.id = s.contact_id
         LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, s.user_id)
        WHERE s.channel = 'web'
          AND s.status IN ('open','waiting','active')
        ORDER BY s.last_message_at DESC NULLS LAST, s.created_at DESC
        LIMIT 200`,
    );

    await Promise.all(rows.map(async row => {
      const sockets = await this.io.in(`visitor:${row.id}`).allSockets();
      socket.emit('visitor:online-status', {
        sessionId: row.id,
        online: sockets.size > 0,
        lastSeenAt: row.client_last_seen_at,
      });
    }));
  }

  /**
   * Broadcast online status to admin operators only (not all clients).
   * Emits 'user:online' or 'user:offline' to match frontend WebSocketService listeners.
   */
  private broadcastOnlineStatus(userId: string, status: 'online' | 'offline'): void {
    const eventName = status === 'online' ? 'user:online' : 'user:offline';
    // Targeted: only operators monitoring chats + employee dashboard need this
    this.io.to('admin:visitor-chats').to('employee:dashboard').emit(eventName, { userId });
  }

  /**
   * WebSocket rate limiting per socket (Redis-backed, 20/10s soft limit, 50/10s disconnect)
   */
  private async checkRateLimit(socket: AuthenticatedSocket): Promise<'ok' | 'blocked' | 'disconnected'> {
    if (!this.rateLimitRedis) return 'ok'; // No Redis — skip rate limiting

    try {
      const key = `ws:rate:${socket.id}`;
      const count = await this.rateLimitRedis.incr(key);
      if (count <= 2) await this.rateLimitRedis.expire(key, 10);

      if (count > 50) {
        socketLog.warn(`[RateLimit] Socket ${socket.id} exceeded 50/10s — disconnecting`);
        socket.emit('error', { code: 'RATE_LIMIT', message: 'Превышен лимит сообщений' });
        socket.disconnect(true);
        return 'disconnected';
      }
      if (count > 20) {
        socket.emit('error', { code: 'RATE_LIMIT', message: 'Слишком много сообщений, подождите' });
        return 'blocked';
      }
      return 'ok';
    } catch {
      return 'ok'; // On Redis error, don't block the message
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }

  /**
   * Send notification to specific user
   */
  public sendNotificationToUser(userId: string, notification: WsEventPayload): void {
    logAndEmit(this.io, `user:${userId}`, 'notification:new', notification);
  }

  /**
   * Send notification to booking participants
   */
  public sendNotificationToBooking(bookingId: string, notification: WsEventPayload): void {
    logAndEmit(this.io, `booking:${bookingId}`, 'notification:new', notification);
  }

  /**
   * Get online users count (Redis-backed, falls back to local).
   */
  public getOnlineUsersCount(): number {
    // Sync method — returns local count. For cross-node count use async variant.
    return this.onlineUsersLocal.size;
  }

  /**
   * Get cross-node online users count from Redis (Sorted Set).
   */
  public async getOnlineUsersCountGlobal(): Promise<number> {
    if (this.onlineRedis) {
      try {
        return await this.onlineRedis.zcard('ws:online');
      } catch {
        // fallback
      }
    }
    return this.onlineUsersLocal.size;
  }

  /**
   * Check if user is online (local node only — fast path for WS handlers).
   */
  public isUserOnline(userId: string): boolean {
    return this.onlineUsersLocal.has(userId);
  }

  /**
   * Check if user is online across all nodes (Redis Sorted Set).
   */
  public async isUserOnlineGlobal(userId: string): Promise<boolean> {
    if (this.onlineRedis) {
      try {
        const score = await this.onlineRedis.zscore('ws:online', userId);
        return score !== null;
      } catch {
        // fallback
      }
    }
    return this.onlineUsersLocal.has(userId);
  }

  /**
   * Get online user IDs from Redis Sorted Set (cross-node).
   * Falls back to local Map if Redis unavailable.
   */
  public async getOnlineUserIds(): Promise<string[]> {
    if (this.onlineRedis) {
      try {
        return await this.onlineRedis.zrange('ws:online', 0, -1);
      } catch {
        // fallback
      }
    }
    return [...this.onlineUsersLocal.keys()];
  }

  /**
   * Send task event to studio room
   */
  public sendTaskEvent(studioId: string, event: 'task:created' | 'task:updated' | 'task:assigned' | 'task:handoff' | 'booking:created' | 'booking:updated' | 'booking:cancelled' | 'booking:rescheduled', data: WsEventPayload): void {
    this.io.to(`studio:${studioId}`).emit(event, data);
    this.io.to('employee:dashboard').emit(event, data);
  }

  /**
   * Send telephony event to staff dashboard
   */
  public sendTelephonyEvent(event: string, data: WsEventPayload): void {
    this.io.to('employee:dashboard').emit(event, data);
  }

  /**
   * Send production event to all employees
   */
  public sendProductionEvent(event: 'production:order-created' | 'production:status-changed' | 'production:order-cancelled' | 'production:email-sent', data: WsEventPayload): void {
    this.io.to('employee:dashboard').emit(event, data);
  }

  /**
   * One-time migration: if legacy SET 'ws:online' exists, convert to Sorted Set.
   * Idempotent — safe to call multiple times.
   */
  private async migrateOnlineSetToZset(): Promise<void> {
    if (!this.onlineRedis) return;
    const keyType = await this.onlineRedis.type('ws:online');
    if (keyType === 'set') {
      socketLog.info('Migrating ws:online from SET to ZSET');
      const members = await this.onlineRedis.smembers('ws:online');
      await this.onlineRedis.del('ws:online');
      if (members.length > 0) {
        const now = Math.floor(Date.now() / 1000);
        const args: (string | number)[] = [];
        for (const m of members) {
          args.push(now, m);
        }
        await this.onlineRedis.zadd('ws:online', ...args);
      }
      socketLog.info(`Migrated ${members.length} entries from SET to ZSET`);
    }
    // 'zset' or 'none' — no action needed
  }

  /**
   * Periodic cleanup: remove entries older than 5 minutes from ws:online Sorted Set.
   * Protects against leaked entries from unclean disconnects.
   */
  private async cleanupStaleOnlineUsers(): Promise<void> {
    if (!this.onlineRedis) return;
    const cutoff = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
    const removed = await this.onlineRedis.zremrangebyscore('ws:online', 0, cutoff);
    if (removed > 0) {
      socketLog.info(`Cleaned up ${removed} stale ws:online entries`);
    }
  }

  /**
   * Update heartbeat timestamp for a user in ws:online (XX = update existing only).
   * Called on any socket event to keep the entry fresh.
   */
  private refreshOnlineHeartbeat(userId: string): void {
    if (!this.onlineRedis) return;
    const now = Math.floor(Date.now() / 1000);
    // XX flag: only update score if member already exists (don't re-add disconnected users)
    this.onlineRedis.zadd('ws:online', 'XX', now, userId).catch(err =>
      socketLog.warn('Failed to refresh ws:online heartbeat', { error: err instanceof Error ? err.message : String(err) }),
    );
    wsHeartbeatRefreshTotal.inc({ trigger: 'event' });
  }

  /**
   * Periodic heartbeat tick: batch-refresh ws:online scores for all locally
   * connected users. Fail-soft — Redis errors are logged and swallowed.
   */
  private async heartbeatTickAll(): Promise<void> {
    if (!this.onlineRedis) return;
    const userIds = [...this.onlineUsersLocal.keys()];
    if (userIds.length === 0) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      const args: (string | number)[] = [];
      for (const id of userIds) {
        args.push(now, id);
      }
      await this.onlineRedis.zadd('ws:online', ...args);
      await this.onlineRedis.expire('ws:online', 600);
      wsHeartbeatRefreshTotal.inc({ trigger: 'periodic' }, userIds.length);
    } catch (err) {
      socketLog.warn('heartbeatTickAll Redis error', {
        error: err instanceof Error ? err.message : String(err),
        userCount: userIds.length,
      });
    }
  }

  /**
   * Get Socket.IO instance
   */
  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Get Redis subscriber stats
   */
  public getRedisStats(): { connected: boolean; subscribedPatterns: string[] } | null {
    return this.redisSubscriber?.getStats() ?? null;
  }

  /**
   * Check if Redis subscriber is ready
   */
  public isRedisReady(): boolean {
    return this.redisSubscriber?.isReady() ?? false;
  }

  /**
   * Stop background timers (heartbeat, stale cleanup). Call on graceful shutdown.
   */
  public shutdown(): void {
    if (this.staleCleanupInterval) {
      clearInterval(this.staleCleanupInterval);
      this.staleCleanupInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
