import { Injectable, signal, computed, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';
import { APP_VERSION } from '../constants/version';
import { environment } from '../../../environments/environment';
import { getSocketIoEndpoint, getSocketIoTransports } from '../utils/socket-io-routing.util';
import type {
  WsPrinterAlertRaised,
  WsPrinterAlertResolved,
  WsPrinterJobRecorded,
  WsPrinterTelemetryUpdated,
} from '../models/fleet-ws.models';

export interface WebSocketConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: 'client' | 'photographer';
  message: string;
  timestamp: string;
  read: boolean;
}

export interface TypingIndicator {
  bookingId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface ReactionUpdatedEvent {
  sessionId: string;
  messageId: string;
  reactions: MessageReactionsMap;
}

export type MediaReadyStatus = 'uploaded' | 'failed';

export interface MediaReadyEvent {
  conversationId: string;
  messageId: string;
  attachmentUrl: string;
  mediaType: string;
  fileName?: string | null;
  mimeType?: string | null;
  status?: MediaReadyStatus;
  errorMessage?: string | null;
  clientNotified?: boolean | null;
  clientMessage?: string | null;
  timestamp?: string;
}

interface ReactionUserInfo { userId: string; userName: string }

/** Emoji key to list of users who reacted */
export type MessageReactionsMap = Readonly<Record<string, ReactionUserInfo[]>>;

export interface OnlineUser {
  userId: string;
  online: boolean;
}

export interface VisitorPresence {
  online: boolean;
  lastSeenAt: string | null;
}

export interface RetouchQueueEvent {
  event: string;
  payload: unknown;
}

export interface RetouchSocketEvent {
  event: 'retouch:progress' | 'retouch:completed' | 'retouch:failed';
  jobId: string;
  sessionId: string;
  currentOperation?: number;
  totalOperations?: number;
  operationType?: string;
  workspaceItemId?: string;
  workspaceVariantId?: string;
  provider?: string;
  providerStatus?: 'SUBMITTED' | 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string;
  providerRequestId?: string;
  providerQueuePosition?: number;
  providerLogMessage?: string;
  providerError?: string;
  resultUrl?: string;
  resultPhotoId?: string;
  actualCostUsd?: number;
  error?: string;
  failedOperation?: number;
}

export interface PhotoWorkspaceSocketEvent {
  event: 'photo-workspace:ai-complete' | 'photo-workspace:ai-partial' | 'photo-workspace:approval-updated' | 'photo-workspace:notification-scheduled';
  orderId: string;
  itemId?: string;
  completed?: number;
  failed?: number;
  scheduledFor?: string;
}

export interface PaymentLinkEventPayload {
  id?: string;
  paymentLinkId?: string;
  orderRef?: string;
  amount?: number;
  conversationId?: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  clientName?: string;
  method?: string;
  status?: string;
  expiresAt?: string;
}

export interface PaymentLinkEvent {
  event: string;
  data: PaymentLinkEventPayload;
}

export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
  createdAt: string;
  read: boolean;
  userId?: string;
}

export interface SocketEventData {
  readonly [key: string]: unknown;
}

export interface SocketEventEnvelope {
  event: string;
  data: SocketEventData;
}

export interface SocketMessageEnvelope {
  sessionId: string;
  message: SocketEventData;
}

function readSocketString(data: SocketEventData, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function readSocketNumber(data: SocketEventData, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * WebSocket Service для real-time коммуникации
 *
 * Функции:
 * - Управление WebSocket подключением
 * - Аутентификация через JWT
 * - Подписка на события чата
 * - Управление online статусом
 * - Индикаторы набора текста
 */
@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService).createChild('WebSocket');

  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private offlineTickInterval: ReturnType<typeof setInterval> | null = null;
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;

  // Signals для состояния
  readonly connectionState = signal<WebSocketConnectionState>({
    connected: false,
    connecting: false,
    error: null
  });

  readonly messages = signal<ChatMessage[]>([]);
  readonly typingUsers = signal<ReadonlyMap<string, TypingIndicator>>(new Map());
  readonly onlineUsers = signal<ReadonlySet<string>>(new Set());

  // Task board signals
  readonly taskEvent = signal<SocketEventEnvelope | null>(null);
  private taskSubscribedStudioId: string | null = null;

  // Visitor chat operator signals
  readonly visitorNewMessage = signal<{
    sessionId: string;
    visitorId?: string;
    content: string;
    messageType: string;
    timestamp: Date;
    channel?: string;
    attachmentUrl?: string | null;
    message?: SocketEventData;
    session?: {
      visitorName: string | null;
      visitorPhone: string | null;
      channel: string;
      status: string;
      assignedOperatorId: string | null;
      assignedOperatorName: string | null;
      contactId?: string | null;
      userId?: string | null;
      clientName?: string | null;
      clientPhone?: string | null;
      reopened?: boolean;
    } | null;
  } | null>(null);
  readonly visitorTyping = signal<{ sessionId: string; visitorId: string; isTyping: boolean } | null>(null);
  readonly operatorTyping = signal<{ sessionId: string; operatorId: string; isTyping: boolean } | null>(null);
  readonly chatStatusChanged = signal<{ sessionId: string; status: string; assignedOperatorId: string | null; updatedBy: string } | null>(null);
  private visitorChatsJoined = false;
  private channelAdminJoined = false;

  // Internal note events (operator-only, separate from visitor messages)
  readonly internalNoteEvent = signal<SocketMessageEnvelope | null>(null);

  // Message delivery/read status updates
  readonly messageStatusUpdate = signal<{ sessionId: string; messageIds: string[]; clientMessageIds?: string[]; status: 'delivered' | 'read' } | null>(null);

  // Message deleted/edited/reaction events
  readonly messageDeleted = signal<{ sessionId: string; messageId: string } | null>(null);
  readonly messageEdited = signal<{ sessionId: string; messageId: string; content: string } | null>(null);
  readonly messageReactionUpdated = signal<ReactionUpdatedEvent | null>(null);

  // Message pin/unpin events
  readonly messagePinToggled = signal<{ sessionId: string; messageId: string; pinned: boolean; pinnedBy: string | null } | null>(null);

  // Media ready (async media processing complete — attachment URL available)
  readonly mediaReadyEvent = signal<MediaReadyEvent | null>(null);

  // Visitor online presence
  readonly visitorOnlineMap = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly visitorPresenceMap = signal<ReadonlyMap<string, VisitorPresence>>(new Map());

  // Cart sync signals
  readonly visitorCartUpdate = signal<{ sessionId: string; items: unknown[] } | null>(null);

  // Order events
  readonly orderEvent = signal<SocketEventEnvelope | null>(null);
  readonly photoWorkspaceEvent = signal<PhotoWorkspaceSocketEvent | null>(null);

  // Курьерская доставка — смена статуса отправления (room: employee:dashboard)
  readonly deliveryStatusEvent = signal<SocketEventEnvelope | null>(null);

  // CRM inbox counts (pushed by crm-event-queue worker via Socket.IO)
  readonly inboxCounts = signal<{
    total: number; chat: number; task: number; booking: number;
    order: number; approval: number; urgent: number; unassigned: number; unread: number; unpaid: number;
  } | null>(null);

  readonly paymentLinkEvent = signal<PaymentLinkEvent | null>(null);

  // Notifications (real-time push from backend)
  readonly newNotification = signal<NotificationPayload | null>(null);
  readonly notificationCount = signal<number | null>(null);

  // Studio status changed (admin open/close/maintenance)
  readonly studioStatusChanged = signal<{
    studioId: string;
    locationCode: string | null;
    status: 'open' | 'closed' | 'maintenance';
    status_message?: string | null;
    status_until: string | null;
  } | null>(null);

  // Approval events
  readonly approvalEvent = signal<SocketEventEnvelope | null>(null);

  // Email events
  readonly emailNewEvent = signal<{
    id: string; from_address: string; subject: string;
    has_attachments: boolean; created_at: string;
  } | null>(null);

  // Telephony events
  readonly telephonyEvent = signal<SocketEventEnvelope | null>(null);

  // Production events
  readonly productionEvent = signal<SocketEventEnvelope | null>(null);

  // Print auto-trigger events
  readonly printAutoTriggered = signal<{
    orderId: string;
    jobCount: number;
    printerName: string;
  } | null>(null);

  // Fleet management — телеметрия, задания, алерты принтеров
  readonly printerTelemetryUpdated = signal<WsPrinterTelemetryUpdated | null>(null);
  readonly printerJobRecorded = signal<WsPrinterJobRecorded | null>(null);
  readonly printerAlertRaised = signal<WsPrinterAlertRaised | null>(null);
  readonly printerAlertResolved = signal<WsPrinterAlertResolved | null>(null);

  // Chat assignment events
  readonly chatAssignment = signal<{
    event: 'assigned' | 'unassigned' | 'transferred';
    sessionId: string;
    operatorId?: string;
    operatorName?: string;
    fromOperatorId?: string;
    toOperatorId?: string;
    note?: string;
  } | null>(null);

  // Chat privacy/ownership events (claim-private, release-private, reassignments)
  readonly chatPrivacyChanged = signal<{
    sessionId: string;
    resource_type: 'conversation' | 'visitor_session';
    isPrivate: boolean;
    ownerId: string | null;
    ownerName: string | null;
  } | null>(null);

  readonly chatRemovedFromInbox = signal<{
    sessionId: string;
    reason: 'private' | 'transferred';
  } | null>(null);

  readonly chatAssignedToYou = signal<{
    sessionId: string;
    resource_type: 'conversation' | 'visitor_session';
    fromOperatorId?: string | null;
    fromOperatorName?: string | null;
    note?: string;
    mode: 'transfer' | 'private' | 'assign';
  } | null>(null);

  // Chat collision detection (who's viewing which chat)
  readonly chatViewing = signal<{ sessionId: string; operatorId: string; operatorName: string } | null>(null);
  readonly chatLeft = signal<{ sessionId: string; operatorId: string } | null>(null);

  // F70: Phone update events
  readonly chatPhoneUpdated = signal<{ sessionId: string; visitorPhone: string } | null>(null);

  // Chat client linking events
  readonly chatClientLinked = signal<{
    sessionId: string;
    userId?: string;
    contactId?: string;
    clientName?: string;
    clientPhone?: string;
    bookingId?: string;
    bookingService?: string;
    bookingDate?: string;
    bookingStatus?: string;
  } | null>(null);

  // Staff chat events
  readonly staffChatMessage = signal<{ conversationId: string; message: SocketEventData } | null>(null);
  readonly staffChatTyping = signal<{ conversationId: string; userId: string; isTyping: boolean } | null>(null);
  readonly staffChatRead = signal<{ conversationId: string; userId: string; lastReadAt?: string; lastReadMessageId?: string | null } | null>(null);
  readonly staffChatDelivered = signal<{ conversationId: string; userId: string; deliveredAt: string } | null>(null);
  readonly staffChatMessageEdited = signal<{ conversationId: string; messageId: string; content: string; editedAt: string } | null>(null);
  readonly staffChatMessageDeleted = signal<{ conversationId: string; messageId: string } | null>(null);
  readonly staffChatUserJoined = signal<{ conversationId: string; userId: string; userName: string } | null>(null);
  readonly staffChatUserLeft = signal<{ conversationId: string; userId: string; userName: string } | null>(null);
  readonly staffChatConversationUpdated = signal<{ conversationId: string; title: string } | null>(null);
  readonly staffChatReactionAdded = signal<{ conversationId: string; messageId: string; userId: string; emoji: string } | null>(null);
  readonly staffChatReactionRemoved = signal<{ conversationId: string; messageId: string; userId: string; emoji: string } | null>(null);
  readonly staffChatMessagePinned = signal<{ conversationId: string; messageId: string } | null>(null);
  readonly staffChatMessageUnpinned = signal<{ conversationId: string; messageId: string } | null>(null);
  readonly staffChatConversationArchived = signal<{ conversationId: string; archived: boolean } | null>(null);
  readonly staffChatMessageRestored = signal<{ conversationId: string; messageId: string; message: unknown } | null>(null);
  readonly staffChatMention = signal<{ conversationId: string; messageId: string; mentionedUserId: string; senderName: string } | null>(null);
  readonly staffChatPresenceChange = signal<{ userId: string; online: boolean; lastSeenAt: string } | null>(null);
  private staffChatJoinedRooms = new Set<string>();

  // Channel admin events (circuit breaker state changes, channel toggle)
  readonly channelCircuitBreaker = signal<{
    channel: string;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    lastError: string | null;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
  } | null>(null);
  readonly channelStatusChanged = signal<{ channel: string; disabled: boolean } | null>(null);
  readonly channelHealthChanged = signal<{ channel: string; health: string; summary: string } | null>(null);

  // AI Retouch events
  readonly retouchEvent = signal<RetouchSocketEvent | null>(null);

  // Retouch queue events (manual retouch pipeline)
  readonly retouchQueueEvent = signal<RetouchQueueEvent | null>(null);

  // KPI update event (review sent, etc.)
  readonly kpiUpdate = signal<{ type: string } | null>(null);

  // Contact merge suggestion
  readonly contactMergeSuggested = signal<{
    contact: { id: string; displayName: string | null; source: string };
    duplicates: { id: string; display_name: string | null; phone: string | null; source: string; channels: string[] }[];
  } | null>(null);

  // Shift events (earnings updates)
  readonly shiftEvent = signal<{
    event: string;
    data: { shiftId: string; online_earnings: number; online_count: number; commission: number };
  } | null>(null);

  // POS real-time stock updates
  readonly posStockUpdate = signal<{
    product_id: string;
    studio_id: string;
    changes: { product_id: string; quantity_delta: number; new_quantity: number }[];
  } | null>(null);
  private posStudioJoined: string | null = null;

  // Infrastructure monitoring signals (relay from Redis via admin:infra room)
  readonly infraHeartbeat = signal<{ studio_id: string; agent_type: string; agent_id: string; version: string | null; is_online: boolean } | null>(null);
  readonly infraAlert = signal<{ studio_id: string; agent_type: string; alert_type: string; severity: string; title: string } | null>(null);
  readonly infraSystemTelemetry = signal<SocketEventData | null>(null);
  readonly infraUpdateProgress = signal<{
    type: string;
    command_id?: string;
    rollout_id?: string;
    status?: string;
    progress_percent?: number;
    agent_type?: string;
    current_phase?: string;
    reason?: string;
  } | null>(null);
  readonly infraAlertCount = signal(0);
  readonly infraPrinterStatus = signal<{
    studio_id: string;
    printer_id: string;
    printer_name: string;
    status: 'idle' | 'printing' | 'error' | 'offline';
    queue_length: number;
    error_message?: string;
  } | null>(null);
  readonly infraSecurityEvent = signal<{
    studio_id: string;
    agent_id: string;
    event_type: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    details?: Record<string, unknown>;
  } | null>(null);
  readonly printJobUpdate = signal<{
    job_id: string;
    printer_id: string;
    status: string;
    progress_percent?: number;
    progress_current_copy?: number;
    progress_total_copies?: number;
    finishing_status?: string;
    auto_balanced?: boolean;
    group_id?: string;
  } | null>(null);
  readonly activePrintJobs = signal<{
    id: string; printer_id: string; status: string; file_name: string | null;
    paper_size: string; copies: number; created_at: string; studio_id: string | null;
    priority?: number;
  }[]>([]);
  readonly printQueuePaused = signal<{ printer_id: string; reason?: string; studio_id: string } | null>(null);
  readonly printQueueResumed = signal<{ printer_id: string; studio_id: string } | null>(null);
  readonly printJobSplit = signal<{ parent_job_id: string; child_jobs: { id: string; printer_id: string; copies: number }[] } | null>(null);
  readonly printSupplyAlert = signal<{ printer_id: string; alerts: { name: string; level: number; severity: string }[] } | null>(null);
  readonly printCopyProgress = signal<{ job_id: string; current_copy: number; total_copies: number; progress_percent: number } | null>(null);
  readonly posTransactionUpdate = signal<{
    studio_id: string;
    transaction_id: string;
    status: string;
    amount?: number;
    error_message?: string | null;
  } | null>(null);
  readonly fiscalFailure = signal<{
    receipt_id: string;
    receipt_number: string;
    error_message: string;
    retry_count: number;
    operation: string;
  } | null>(null);
  readonly fiscalSuccess = signal<{
    receipt_id: string;
    receipt_number: string;
    fiscal_receipt_number: string | null;
    fiscal_sign: string | null;
  } | null>(null);
  // Осиротевшая карт-оплата без чека (детектор кассы) — broadcast в студию.
  readonly posOrphanPayment = signal<{
    studio_id: string;
    payment_id: string;
    amount: number;
  } | null>(null);
  private infraJoined = false;
  private _wasConnected = false;

  // Update notification
  readonly updateAvailable = signal<{ currentVersion: string; latestVersion: string } | null>(null);

  // Server maintenance notification
  readonly serverMaintenance = signal<{ message: string } | null>(null);

  // Reconnect state
  readonly wsReconnectAttempt = signal(0);
  readonly wsReconnectSecondsLeft = signal(0);
  readonly wsOfflineMode = signal(false);

  // Reconnect notification — services can react to resync data after WS reconnect
  readonly reconnected = signal<number>(0);

  // Offline banner — tracks when WS went down for UI indication
  private readonly _wsDownSince = signal<number | null>(null);
  private readonly _offlineTicker = signal(Date.now());

  // Computed values
  readonly isConnected = computed(() => this.connectionState().connected);
  readonly hasError = computed(() => this.connectionState().error !== null);
  readonly isReconnecting = computed(
    () => !this.connectionState().connected && this.wsReconnectAttempt() > 0 && !this.wsOfflineMode()
  );

  // True when WS has been down for >5s (used for "Нет связи" banner)
  readonly isOffline5s = computed(() => {
    const since = this._wsDownSince();
    return since !== null && (this._offlineTicker() - since) > 5000;
  });

  constructor() {
    // Автоматическое подключение при изменении токена
    effect(() => {
      const token = this.authService.token();
      if (token) {
        this.connect();
      } else {
        this.disconnect();
      }
    });

    // Visibility change handler — reconnect when tab comes back into focus
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.authService.token()) {
          this.handleVisibilityResume();
        }
      });
    }
  }

  /**
   * Handle tab becoming visible again — ensure WS is connected.
   * If socket reports connected, verify liveness with health-check (detect stale socket after OS sleep).
   */
  private handleVisibilityResume(): void {
    if (this.socket?.connected) {
      this.emitHealthCheck();
      return;
    }

    this.log.warn('WS visibility resume reconnect', { event: 'ws_visibility_reconnect' });
    // Reset reconnect state for clean retry
    this.reconnectAttempts = 0;
    this.wsReconnectAttempt.set(0);
    this.wsOfflineMode.set(false);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.connect();
  }

  /**
   * Подключение к WebSocket серверу
   */
  connect(): void {
    const token = this.authService.token();

    if (!token) {
      this.log.warn('No authentication token available');
      return;
    }

    if (this.socket?.connected) {
      this.log.debug('Already connected');
      return;
    }

    // Cleanup zombie: disconnect old socket and remove all listeners before creating new one
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState.update(state => ({
      ...state,
      connecting: true,
      error: null
    }));

    // Empty endpoint keeps same-origin polling; configured endpoint enables WebSocket-first routing.
    const wsEndpoint = getSocketIoEndpoint(environment.wsUrl);
    const transports = getSocketIoTransports(environment.wsUrl);

    this.log.debug('Connecting to', wsEndpoint || 'current server');

    // Lazy-load socket.io-client: не попадает в main bundle для всех посетителей
    const refreshToken = this.authService.getRefreshTokenValue();
    import('socket.io-client').then(({ io }) => {
      const options = {
        auth: { token, refreshToken, appVersion: APP_VERSION },
        transports,
        reconnection: false,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: this.maxReconnectAttempts
      };
      this.socket = wsEndpoint ? io(wsEndpoint, options) : io(options);
      this.setupEventListeners();
    }).catch((err) => {
      this.log.error('Failed to load socket.io-client:', err);
      this.connectionState.update(state => ({ ...state, connecting: false, error: 'Failed to load WebSocket library' }));
    });
  }

  /**
   * Отключение от WebSocket сервера
   */
  disconnect(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopWatchdog();
    this.markWsUp();
    this._wasConnected = false;

    if (this.socket) {
      this.log.debug('Disconnecting');
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState.set({
      connected: false,
      connecting: false,
      error: null
    });

    this.messages.set([]);
    this.typingUsers.set(new Map());
    this.onlineUsers.set(new Set());
    this.taskEvent.set(null);
    this.taskSubscribedStudioId = null;
  }

  /**
   * Настройка обработчиков событий
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Подключение установлено
    this.socket.on('connect', () => {
      // Token-check: if token was revoked between handshake and connect event
      if (!this.authService.token()) {
        this.log.warn('WS connected but no token, disconnecting', { event: 'ws_no_token' });
        this.disconnect();
        return;
      }

      this.log.warn('WS connected', {
        event: 'ws_connect',
        attemptsBeforeSuccess: this.reconnectAttempts,
        wasReconnect: this._wasConnected,
      });
      this.reconnectAttempts = 0;
      this.wsReconnectAttempt.set(0);
      this.wsReconnectSecondsLeft.set(0);
      this.wsOfflineMode.set(false);
      this.markWsUp();
      this.startWatchdog();

      this.connectionState.update(state => ({
        ...state,
        connected: true,
        connecting: false,
        error: null
      }));

      // Re-join rooms after reconnect (server creates new socket, old subscriptions lost)
      if (this.visitorChatsJoined) {
        this.socket!.emit('admin:join-visitor-chats');
      }
      if (this.taskSubscribedStudioId !== null) {
        this.socket!.emit('tasks:subscribe', this.taskSubscribedStudioId);
      }
      if (this.channelAdminJoined) {
        this.socket!.emit('admin:join-channels');
      }
      for (const convId of this.staffChatJoinedRooms) {
        this.socket!.emit('staff-chat:join', convId);
      }
      if (this.infraJoined) {
        this.socket!.emit('infra:subscribe');
        this.socket!.emit('print:sync-request');
      }
      if (this.posStudioJoined) {
        this.socket!.emit('pos:join_studio', { studioId: this.posStudioJoined });
      }

      // Notify services about reconnect so they can resync missed data
      if (this._wasConnected) {
        this.reconnected.set(Date.now());
      }
      this._wasConnected = true;
    });

    // Ошибка подключения
    this.socket.on('connect_error', (error) => {
      this.log.warn('WS connect_error', {
        event: 'ws_connect_error',
        reason: error.message,
        attempt: this.reconnectAttempts,
      });

      this.connectionState.update(state => ({
        ...state,
        connected: false,
        connecting: false,
        error: error.message
      }));

      if (this._wasConnected) this.markWsDown();
      this.handleReconnect(error.message || 'connect_error');
    });

    // Отключение — reconnect for all reasons except explicit client disconnect
    this.socket.on('disconnect', (reason) => {
      this.log.warn('WS disconnected', {
        event: 'ws_disconnect',
        reason,
        wasConnected: this._wasConnected,
      });

      this.connectionState.update(state => ({
        ...state,
        connected: false,
        connecting: false,
        error: reason !== 'io client disconnect' ? reason : null
      }));

      this.stopWatchdog();

      if (reason !== 'io client disconnect') {
        if (this._wasConnected) this.markWsDown();
        this.handleReconnect(reason);
      }
    });

    // Обновление CRM: версия клиента устарела
    this.socket.on('app:update-available', (data: { currentVersion: string; latestVersion: string }) => {
      const dismissedKey = `update-dismissed-${data.latestVersion}`;
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dismissedKey)) return;
      this.updateAvailable.set(data);
    });

    // JWT refresh: server issued new token during WS reconnect
    this.socket.on('auth:token-refreshed', (data: { token: string }) => {
      this.log.debug('Received refreshed token');
      this.authService.updateToken(data.token);
    });

    // Server maintenance notification (graceful shutdown)
    this.socket.on('server:maintenance', (data: { message: string }) => {
      this.log.debug('Server maintenance:', data.message);
      this.serverMaintenance.set(data);
    });

    // Новое сообщение
    this.socket.on('message:new', (message: ChatMessage) => {
      this.log.debug('New message:', message);
      this.messages.update(messages => [...messages, message]);
    });

    // Пользователь начал печатать
    this.socket.on('typing:start', (data: { bookingId: string; userId: string; userName: string }) => {
      this.log.debug('User typing:', data);

      const key = `${data.bookingId}-${data.userId}`;
      this.typingUsers.update(map => {
        const newMap = new Map(map);
        newMap.set(key, {
          bookingId: data.bookingId,
          userId: data.userId,
          userName: data.userName,
          isTyping: true
        });
        return newMap;
      });
    });

    // Пользователь перестал печатать
    this.socket.on('typing:stop', (data: { bookingId: string; userId: string }) => {
      this.log.debug('User stopped typing:', data);

      const key = `${data.bookingId}-${data.userId}`;
      this.typingUsers.update(map => {
        const newMap = new Map(map);
        newMap.delete(key);
        return newMap;
      });
    });

    // Уведомление для пользователя
    this.socket.on('notification:new', (notification: NotificationPayload) => {
      this.log.debug('New notification received', { id: notification?.id, type: notification?.type });
      this.newNotification.set(notification);
    });

    this.socket.on('notification:count', (data: { count: number }) => {
      this.notificationCount.set(data.count);
    });

    // Статус online/offline
    this.socket.on('user:online', (data: { userId: string }) => {
      this.log.debug('User online:', data.userId);
      this.onlineUsers.update(set => {
        const newSet = new Set(set);
        newSet.add(data.userId);
        return newSet;
      });
    });

    this.socket.on('user:offline', (data: { userId: string }) => {
      this.log.debug('User offline:', data.userId);
      this.onlineUsers.update(set => {
        const newSet = new Set(set);
        newSet.delete(data.userId);
        return newSet;
      });
    });

    // Сообщения прочитаны
    this.socket.on('messages:read', (data: { bookingId: string; messageIds: string[] }) => {
      this.log.debug('Messages read:', data);

      this.messages.update(messages =>
        messages.map(msg =>
          data.messageIds.includes(msg.id)
            ? { ...msg, read: true }
            : msg
        )
      );
    });

    // Task board events
    for (const event of [
      'task:created', 'task:updated', 'task:assigned', 'task:handoff',
      'booking:created', 'booking:updated', 'booking:cancelled', 'booking:rescheduled',
    ]) {
      this.socket.on(event, (data: Record<string, unknown>) => {
        this.taskEvent.set({ event, data });
      });
    }

    // Visitor chat operator events — enriched broadcast with session metadata
    this.socket.on('visitor:new-message', (data: Record<string, unknown>) => {
      const sessionId = data['sessionId'] as string;
      const dbMsg = data['message'] as Record<string, unknown> | undefined;
      const sessionData = data['session'] as Record<string, unknown> | null | undefined;

      // Parse session metadata (from enriched broadcast)
      const session = sessionData
        ? {
            visitorName: (sessionData['visitorName'] as string | null) ?? null,
            visitorPhone: (sessionData['visitorPhone'] as string | null) ?? null,
            channel: (sessionData['channel'] as string) || '',
            status: (sessionData['status'] as string) || 'open',
            assignedOperatorId: (sessionData['assignedOperatorId'] as string | null) ?? null,
            assignedOperatorName: (sessionData['assignedOperatorName'] as string | null) ?? null,
            contactId: (sessionData['contactId'] as string | null) ?? null,
            userId: (sessionData['userId'] as string | null) ?? null,
            clientName: (sessionData['clientName'] as string | null) ?? null,
            clientPhone: (sessionData['clientPhone'] as string | null) ?? null,
            reopened: !!sessionData['reopened'],
          }
        : null;

      if (dbMsg && typeof dbMsg === 'object') {
        this.visitorNewMessage.set({
          sessionId,
          visitorId: (data['visitorId'] as string) || undefined,
          content: (dbMsg['content'] as string) || '',
          messageType: (data['messageType'] as string) || (dbMsg['message_type'] as string) || 'text',
          timestamp: new Date((dbMsg['created_at'] as string) || (data['timestamp'] as string) || Date.now()),
          channel: (data['channel'] as string) || session?.channel || undefined,
          attachmentUrl: (data['attachmentUrl'] as string) || (dbMsg['attachment_url'] as string) || null,
          message: dbMsg,
          session,
        });
      } else {
        this.visitorNewMessage.set({
          sessionId,
          visitorId: data['visitorId'] as string,
          content: data['content'] as string,
          messageType: (data['messageType'] as string) || 'text',
          timestamp: new Date(data['timestamp'] as string || Date.now()),
          channel: (data['channel'] as string) || session?.channel || undefined,
          attachmentUrl: (data['attachmentUrl'] as string) || null,
          session,
        });
      }
    });

    this.socket.on('visitor:typing', (data: { sessionId: string; visitorId: string; isTyping: boolean }) => {
      this.visitorTyping.set(data);
    });

    this.socket.on('operator:typing', (data: { sessionId: string; operatorId: string; isTyping: boolean }) => {
      this.operatorTyping.set(data);
    });

    this.socket.on('chat:status-changed', (data: { sessionId: string; status: string; assignedOperatorId: string | null; updatedBy: string }) => {
      this.chatStatusChanged.set(data);
    });

    this.socket.on('visitor:internal-note', (data: { sessionId: string; message: Record<string, unknown> }) => {
      this.internalNoteEvent.set(data);
    });

    this.socket.on('message:status-update', (data: { sessionId: string; messageIds: string[]; clientMessageIds?: string[]; status: 'delivered' | 'read' }) => {
      this.messageStatusUpdate.set(data);
    });

    this.socket.on('message:media-ready', (data: MediaReadyEvent) => {
      this.mediaReadyEvent.set(data);
    });

    this.socket.on('message:deleted', (data: { sessionId: string; messageId: string }) => {
      this.messageDeleted.set(data);
    });

    this.socket.on('message:edited', (data: { sessionId: string; messageId: string; content: string }) => {
      this.messageEdited.set(data);
    });

    this.socket.on('message:reaction-updated', (data: ReactionUpdatedEvent) => {
      this.messageReactionUpdated.set(data);
    });

    this.socket.on('message:pin-toggled', (data: { sessionId: string; messageId: string; pinned: boolean; pinnedBy: string | null }) => {
      this.messagePinToggled.set(data);
    });

    // Chat assignment events
    for (const evtName of ['chat:assigned', 'chat:unassigned', 'chat:transferred'] as const) {
      this.socket.on(evtName, (data: Record<string, unknown>) => {
        this.chatAssignment.set({
          event: evtName.replace('chat:', '') as 'assigned' | 'unassigned' | 'transferred',
          sessionId: data['sessionId'] as string,
          operatorId: data['operatorId'] as string | undefined,
          operatorName: data['operatorName'] as string | undefined,
          fromOperatorId: data['fromOperatorId'] as string | undefined,
          toOperatorId: data['toOperatorId'] as string | undefined,
          note: data['note'] as string | undefined,
        });
      });
    }

    // Chat privacy/ownership events
    this.socket.on('chat:privacy-changed', (data: Record<string, unknown>) => {
      this.chatPrivacyChanged.set({
        sessionId: data['sessionId'] as string,
        resource_type: (data['resource_type'] as 'conversation' | 'visitor_session') || 'visitor_session',
        isPrivate: !!data['isPrivate'],
        ownerId: (data['ownerId'] as string | null) ?? null,
        ownerName: (data['ownerName'] as string | null) ?? null,
      });
    });

    this.socket.on('chat:removed-from-inbox', (data: Record<string, unknown>) => {
      this.chatRemovedFromInbox.set({
        sessionId: data['sessionId'] as string,
        reason: ((data['reason'] as string) || 'private') as 'private' | 'transferred',
      });
    });

    this.socket.on('chat:assigned-to-you', (data: Record<string, unknown>) => {
      this.chatAssignedToYou.set({
        sessionId: data['sessionId'] as string,
        resource_type: (data['resource_type'] as 'conversation' | 'visitor_session') || 'visitor_session',
        fromOperatorId: (data['fromOperatorId'] as string | null) ?? null,
        fromOperatorName: (data['fromOperatorName'] as string | null) ?? null,
        note: data['note'] as string | undefined,
        mode: ((data['mode'] as string) || 'assign') as 'transfer' | 'private' | 'assign',
      });
    });

    this.socket.on('visitor:online-status', (data: { sessionId: string; online: boolean; lastSeenAt?: string | null }) => {
      this.visitorOnlineMap.update(map => {
        const next = new Map(map);
        next.set(data.sessionId, data.online);
        return next;
      });
      this.visitorPresenceMap.update(map => {
        const next = new Map(map);
        const previous = next.get(data.sessionId);
        next.set(data.sessionId, {
          online: data.online,
          lastSeenAt: data.lastSeenAt ?? previous?.lastSeenAt ?? null,
        });
        return next;
      });
    });

    this.socket.on('visitor:cart-update', (data: { sessionId: string; items: unknown[] }) => {
      this.visitorCartUpdate.set(data);
    });

    this.socket.on('admin:cart-updated', (data: { sessionId: string; items: unknown[] }) => {
      this.visitorCartUpdate.set(data);
    });

    // Chat client/booking linking events
    this.socket.on('chatClientLinked', (data: SocketEventData) => {
      const sessionId = readSocketString(data, 'sessionId');
      if (!sessionId) return;
      this.chatClientLinked.set({
        sessionId,
        userId: readSocketString(data, 'userId'),
        contactId: readSocketString(data, 'contactId'),
        clientName: readSocketString(data, 'clientName'),
        clientPhone: readSocketString(data, 'clientPhone'),
        bookingId: readSocketString(data, 'bookingId'),
        bookingService: readSocketString(data, 'bookingService'),
        bookingDate: readSocketString(data, 'bookingDate'),
        bookingStatus: readSocketString(data, 'bookingStatus'),
      });
    });

    // F70: Phone update events
    this.socket.on('chatPhoneUpdated', (data: { sessionId: string; visitorPhone: string }) => {
      this.chatPhoneUpdated.set(data);
    });

    // Chat collision detection (who's viewing which chat)
    this.socket.on('chat:viewing', (data: { sessionId: string; operatorId: string; operatorName: string }) => {
      this.chatViewing.set(data);
    });
    this.socket.on('chat:left', (data: { sessionId: string; operatorId: string }) => {
      this.chatLeft.set(data);
    });

    // Order events
    for (const event of ['order:created', 'order:paid', 'order:status-changed', 'order:updated', 'order:assigned', 'order:deleted']) {
      this.socket.on(event, (data: Record<string, unknown>) => {
        this.orderEvent.set({ event, data });
      });
    }

    for (const event of [
      'photo-workspace:ai-complete',
      'photo-workspace:ai-partial',
      'photo-workspace:approval-updated',
      'photo-workspace:notification-scheduled',
    ] as const) {
      this.socket.on(event, (data: Omit<PhotoWorkspaceSocketEvent, 'event'>) => {
        this.photoWorkspaceEvent.set({ event, ...data });
        if (event === 'photo-workspace:ai-complete' || event === 'photo-workspace:ai-partial') {
          this.playNotificationBeep();
        }
      });
    }

    // Курьерская доставка — статус отправления (эмит из delivery-вебхука в employee:dashboard)
    this.socket.on('order:delivery-status', (data: Record<string, unknown>) => {
      this.deliveryStatusEvent.set({ event: 'order:delivery-status', data });
    });

    for (const event of [
      'payment-link:created',
      'payment-link:paid',
      'payment-link:linked',
      'payment-link:expired',
      'payment-link:updated',
      'payment-link:cancelled',
    ]) {
      this.socket.on(event, (data: PaymentLinkEventPayload) => {
        this.paymentLinkEvent.set({ event, data });
      });
    }

    // Studio status changed (admin open/close/maintenance)
    this.socket.on('studio:status-changed', (data: {
      studioId: string;
      locationCode: string | null;
      status: 'open' | 'closed' | 'maintenance';
      status_message?: string | null;
      status_until: string | null;
    }) => {
      this.studioStatusChanged.set(data);
    });

    // CRM inbox counts (pushed by crm-event-queue worker)
    this.socket.on('inbox:counts', (data: {
      total: number; chat: number; task: number; booking: number;
      order: number; approval: number; urgent: number; unassigned: number; unread: number; unpaid: number;
    }) => {
      this.inboxCounts.set(data);
    });

    // Approval events
    for (const event of ['approval:photo-reviewed', 'approval:session-viewed', 'approval:session-completed', 'approval:annotation-added', 'approval:variant-selected', 'approval:photo-uploaded']) {
      this.socket.on(event, (data: Record<string, unknown>) => {
        this.approvalEvent.set({ event, data });
      });
    }

    // Telephony events
    for (const event of ['telephony:incoming_call', 'telephony:call_event']) {
      this.socket.on(event, (data: Record<string, unknown>) => {
        this.telephonyEvent.set({ event, data });
      });
    }

    // Production events
    for (const event of ['production:order-created', 'production:status-changed', 'production:order-cancelled']) {
      this.socket.on(event, (data: Record<string, unknown>) => {
        this.productionEvent.set({ event, data });
      });
    }

    // Print auto-trigger events
    this.socket.on('print:auto-triggered', (data: { orderId: string; jobCount: number; printerName: string }) => {
      this.printAutoTriggered.set(data);
    });

    // Fleet management events (room: employee:dashboard)
    this.socket.on('printer:telemetry-updated', (data: WsPrinterTelemetryUpdated) => {
      this.printerTelemetryUpdated.set(data);
    });
    this.socket.on('printer:job-recorded', (data: WsPrinterJobRecorded) => {
      this.printerJobRecorded.set(data);
    });
    this.socket.on('printer:alert-raised', (data: WsPrinterAlertRaised) => {
      this.printerAlertRaised.set(data);
    });
    this.socket.on('printer:alert-resolved', (data: WsPrinterAlertResolved) => {
      this.printerAlertResolved.set(data);
    });

    // Email events
    this.socket.on('email:new', (data: { id: string; from_address: string; subject: string; has_attachments: boolean; created_at: string }) => {
      this.emailNewEvent.set(data);
    });

    // Staff chat events
    this.socket.on('staff-chat:new-message', (data: { conversationId: string; message: Record<string, unknown> }) => {
      this.staffChatMessage.set(data);
    });

    this.socket.on('staff-chat:typing', (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      this.staffChatTyping.set(data);
    });

    this.socket.on('staff-chat:read', (data: { conversationId: string; userId: string; lastReadAt?: string; lastReadMessageId?: string | null }) => {
      this.staffChatRead.set(data);
    });

    this.socket.on('staff-chat:delivered', (data: { conversationId: string; userId: string; deliveredAt: string }) => {
      this.staffChatDelivered.set(data);
    });

    this.socket.on('staff-chat:message-edited', (data: { conversationId: string; messageId: string; content: string; editedAt: string }) => {
      this.staffChatMessageEdited.set(data);
    });

    this.socket.on('staff-chat:message-deleted', (data: { conversationId: string; messageId: string }) => {
      this.staffChatMessageDeleted.set(data);
    });

    this.socket.on('staff-chat:user-joined', (data: { conversationId: string; userId: string; userName: string }) => {
      this.staffChatUserJoined.set(data);
    });

    this.socket.on('staff-chat:user-left', (data: { conversationId: string; userId: string; userName: string }) => {
      this.staffChatUserLeft.set(data);
    });

    this.socket.on('staff-chat:conversation-updated', (data: { conversationId: string; title: string }) => {
      this.staffChatConversationUpdated.set(data);
    });

    this.socket.on('staff-chat:reaction-added', (data: { conversationId: string; messageId: string; userId: string; emoji: string }) => {
      this.staffChatReactionAdded.set(data);
    });

    this.socket.on('staff-chat:reaction-removed', (data: { conversationId: string; messageId: string; userId: string; emoji: string }) => {
      this.staffChatReactionRemoved.set(data);
    });

    this.socket.on('staff-chat:message-pinned', (data: { conversationId: string; messageId: string }) => {
      this.staffChatMessagePinned.set(data);
    });

    this.socket.on('staff-chat:message-unpinned', (data: { conversationId: string; messageId: string }) => {
      this.staffChatMessageUnpinned.set(data);
    });

    this.socket.on('staff-chat:conversation-archived', (data: { conversationId: string; archived: boolean }) => {
      this.staffChatConversationArchived.set(data);
    });

    this.socket.on('staff-chat:message-restored', (data: { conversationId: string; messageId: string; message: unknown }) => {
      this.staffChatMessageRestored.set(data);
    });

    this.socket.on('staff-chat:mention', (data: { conversationId: string; messageId: string; mentionedUserId: string; senderName: string }) => {
      this.staffChatMention.set(data);
    });

    this.socket.on('staff-chat:presence-change', (data: { userId: string; online: boolean; lastSeenAt: string }) => {
      this.staffChatPresenceChange.set(data);
      // Update onlineUsers set for isUserOnline()
      this.onlineUsers.update(set => {
        const next = new Set(set);
        if (data.online) {
          next.add(data.userId);
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    });

    // Channel admin events
    this.socket.on('channel:circuit-breaker', (data: {
      channel: string;
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failures: number;
      lastError: string | null;
      lastSuccessAt: number | null;
      lastFailureAt: number | null;
    }) => {
      this.channelCircuitBreaker.set(data);
    });

    this.socket.on('channel:status-changed', (data: { channel: string; disabled: boolean }) => {
      this.channelStatusChanged.set(data);
    });

    this.socket.on('channel:health-changed', (data: { channel: string; health: string; summary: string }) => {
      this.channelHealthChanged.set(data);
    });

    // AI Retouch events
    for (const event of ['retouch:progress', 'retouch:completed', 'retouch:failed'] as const) {
      this.socket.on(event, (data: SocketEventData) => {
        this.retouchEvent.set({
          event,
          jobId: readSocketString(data, 'jobId') ?? '',
          sessionId: readSocketString(data, 'sessionId') ?? '',
          currentOperation: readSocketNumber(data, 'currentOperation'),
          totalOperations: readSocketNumber(data, 'totalOperations'),
          operationType: readSocketString(data, 'operationType'),
          workspaceItemId: readSocketString(data, 'workspaceItemId'),
          workspaceVariantId: readSocketString(data, 'workspaceVariantId'),
          provider: readSocketString(data, 'provider'),
          providerStatus: readSocketString(data, 'providerStatus'),
          providerRequestId: readSocketString(data, 'providerRequestId'),
          providerQueuePosition: readSocketNumber(data, 'providerQueuePosition'),
          providerLogMessage: readSocketString(data, 'providerLogMessage'),
          providerError: readSocketString(data, 'providerError'),
          resultUrl: readSocketString(data, 'resultUrl'),
          resultPhotoId: readSocketString(data, 'resultPhotoId'),
          actualCostUsd: readSocketNumber(data, 'actualCostUsd'),
          error: readSocketString(data, 'error'),
          failedOperation: readSocketNumber(data, 'failedOperation'),
        });
      });
    }

    // Retouch queue events (manual retouch pipeline)
    for (const event of [
      'retouch:new', 'retouch:started', 'retouch:completed',
      'retouch:revision_requested', 'retouch:sent_for_approval',
    ]) {
      this.socket.on(event, (data: unknown) => {
        this.retouchQueueEvent.set({ event, payload: data });
        // Sound notification for new tasks and revision requests
        if (event === 'retouch:new' || event === 'retouch:revision_requested') {
          this.playNotificationBeep();
        }
      });
    }

    // KPI update (review sent, etc.)
    this.socket.on('kpi:update', (data: { type: string }) => {
      this.kpiUpdate.set(data);
    });

    this.socket.on('contact:merge-suggested', (data: {
      contact: { id: string; displayName: string | null; source: string };
      duplicates: { id: string; display_name: string | null; phone: string | null; source: string; channels: string[] }[];
    }) => {
      this.contactMergeSuggested.set(data);
    });

    // Infrastructure monitoring events (relayed from Redis by Express)
    this.socket.on('infra:heartbeat', (data: { studio_id: string; agent_type: string; agent_id: string; version: string | null; is_online: boolean }) => {
      this.infraHeartbeat.set(data);
    });
    this.socket.on('infra:alert', (data: { studio_id: string; agent_type: string; alert_type: string; severity: string; title: string }) => {
      this.infraAlert.set(data);
      this.infraAlertCount.update(c => c + 1);
    });
    this.socket.on('infra:system_telemetry', (data: SocketEventData) => {
      this.infraSystemTelemetry.set(data);
    });
    this.socket.on('infra:update_progress', (data: {
      type: string; command_id?: string; rollout_id?: string; status?: string;
      progress_percent?: number; agent_type?: string; current_phase?: string; reason?: string;
    }) => {
      this.infraUpdateProgress.set(data);
    });
    this.socket.on('infra:printer-status', (data: {
      studio_id: string; printer_id: string; printer_name: string;
      status: 'idle' | 'printing' | 'error' | 'offline'; queue_length: number; error_message?: string;
    }) => {
      this.infraPrinterStatus.set(data);
    });
    this.socket.on('infra:security-event', (data: {
      studio_id: string; agent_id: string; event_type: string;
      severity: 'info' | 'warning' | 'critical'; title: string; details?: Record<string, unknown>;
    }) => {
      this.infraSecurityEvent.set(data);
    });
    this.socket.on('print:job-update', (data: {
      job_id: string; printer_id: string; status: string; progress_percent?: number;
      progress_current_copy?: number; progress_total_copies?: number;
      finishing_status?: string; auto_balanced?: boolean; group_id?: string;
    }) => {
      this.printJobUpdate.set(data);
    });
    this.socket.on('print:queue-paused', (data: { printer_id: string; reason?: string; studio_id: string }) => {
      this.printQueuePaused.set(data);
    });
    this.socket.on('print:queue-resumed', (data: { printer_id: string; studio_id: string }) => {
      this.printQueueResumed.set(data);
    });
    this.socket.on('print:job-split', (data: { parent_job_id: string; child_jobs: { id: string; printer_id: string; copies: number }[] }) => {
      this.printJobSplit.set(data);
    });
    this.socket.on('print:supply-alert', (data: { printer_id: string; alerts: { name: string; level: number; severity: string }[] }) => {
      this.printSupplyAlert.set(data);
    });
    this.socket.on('print:copy-progress', (data: { job_id: string; current_copy: number; total_copies: number; progress_percent: number }) => {
      this.printCopyProgress.set(data);
    });
    this.socket.on('print:sync', (data: {
      id: string; printer_id: string; status: string; file_name: string | null;
      paper_size: string; copies: number; created_at: string; studio_id: string | null;
      priority?: number;
    }[]) => {
      this.activePrintJobs.set(data);
    });
    this.socket.on('pos:transaction-update', (data: {
      studio_id: string; transaction_id: string; status: string; amount?: number; error_message?: string | null;
    }) => {
      this.posTransactionUpdate.set(data);
    });

    // POS real-time stock updates
    this.socket.on('pos:stock_updated', (data: {
      product_id: string;
      studio_id: string;
      changes: { product_id: string; quantity_delta: number; new_quantity: number }[];
    }) => {
      this.posStockUpdate.set(data);
    });

    // Shift earnings real-time updates
    this.socket.on('shift:earnings-update', (data: { shiftId: string; online_earnings: number; online_count: number; commission: number }) => {
      this.shiftEvent.set({ event: 'shift:earnings-update', data });
    });

    // POS fiscal failure alerts
    this.socket.on('fiscal:failure', (data: {
      receipt_id: string;
      receipt_number: string;
      error_message: string;
      retry_count: number;
      operation: string;
    }) => {
      this.fiscalFailure.set(data);
    });

    // POS fiscal success alerts
    this.socket.on('fiscal:success', (data: {
      receipt_id: string;
      receipt_number: string;
      fiscal_receipt_number: string | null;
      fiscal_sign: string | null;
    }) => {
      this.fiscalSuccess.set(data);
    });

    // POS осиротевшая оплата без чека — детектор кассы (broadcast в студию)
    this.socket.on('pos:orphan_payment', (data: {
      studio_id: string;
      payment_id: string;
      amount: number;
    }) => {
      this.posOrphanPayment.set(data);
    });

  }

  /** Mark WS as down and start 1s ticker (so isOffline5s flips after 5s). SSR-safe. */
  private markWsDown(): void {
    if (this._wsDownSince() !== null) return; // already marked
    if (!isPlatformBrowser(this.platformId)) return;
    this._wsDownSince.set(Date.now());
    this._offlineTicker.set(Date.now());
    if (this.offlineTickInterval) clearInterval(this.offlineTickInterval);
    this.offlineTickInterval = setInterval(() => {
      this._offlineTicker.set(Date.now());
    }, 1000);
  }

  /** Mark WS as up and stop ticker. */
  private markWsUp(): void {
    this._wsDownSince.set(null);
    if (this.offlineTickInterval) {
      clearInterval(this.offlineTickInterval);
      this.offlineTickInterval = null;
    }
  }

  /**
   * Start watchdog — detects drift between our signal state and socket internal state
   * (e.g. OS sleep silently kills socket but no disconnect event fires).
   */
  private startWatchdog(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.stopWatchdog();
    this.watchdogInterval = setInterval(() => {
      if (!this.connectionState().connected) return;
      if (!this.socket?.connected) {
        this.log.warn('WS watchdog detected drift', {
          event: 'ws_watchdog_drift',
          signalConnected: true,
          socketConnected: false,
        });
        this.connectionState.update(state => ({ ...state, connected: false }));
        if (this._wasConnected) this.markWsDown();
        this.handleReconnect('watchdog_drift');
        return;
      }
      this.emitHealthCheck();
    }, 30_000);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Round-trip ping to server. If no ack within timeout → force reconnect
   * (detects half-open socket after OS sleep / network drop that didn't close TCP).
   */
  private emitHealthCheck(): void {
    if (!this.socket?.connected) return;
    const startedAt = Date.now();
    this.socket.timeout(5000).emit('ping:health-check', (err: Error | null, _ack?: { ok: boolean }) => {
      if (err) {
        this.log.warn('WS health-check failed', {
          event: 'ws_health_check_failed',
          reason: err.message || 'timeout',
        });
        if (this.socket) {
          this.socket.disconnect();
          this.socket.connect();
        }
        return;
      }
      this.log.debug('WS health-check rtt', { rtt: Date.now() - startedAt });
    });
  }

  /** Short beep via Web Audio API for retouch queue notifications. */
  private playNotificationBeep(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* ignore autoplay restrictions */ }
  }

  /**
   * Попытка переподключения с exponential backoff, cap 10s и jitter.
   * After maxReconnectAttempts: slow-poll every 15s (never fully stops).
   */
  private handleReconnect(reason = 'unknown'): void {
    const MAX_FAST_DELAY = 10_000;
    const SLOW_POLL_DELAY = 15_000;

    this.reconnectAttempts++;

    const isSlowPoll = this.reconnectAttempts > this.maxReconnectAttempts;
    const base = isSlowPoll
      ? SLOW_POLL_DELAY
      : Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_FAST_DELAY);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(500, Math.round(base + jitter));
    const delaySeconds = Math.max(1, Math.round(delay / 1000));

    if (isSlowPoll) {
      this.wsOfflineMode.set(true);
    }

    this.wsReconnectAttempt.set(this.reconnectAttempts);
    this.wsReconnectSecondsLeft.set(delaySeconds);

    this.log.warn('WS reconnect attempt', {
      event: 'ws_reconnect',
      attempt: this.reconnectAttempts,
      delay,
      slowPoll: isSlowPoll,
      reason,
      wsMetric: 'reconnect',
    });

    // Countdown timer
    let remaining = delaySeconds;
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      remaining--;
      if (remaining >= 0) {
        this.wsReconnectSecondsLeft.set(remaining);
      } else {
        clearInterval(this.countdownInterval!);
        this.countdownInterval = null;
      }
    }, 1000);

    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      this.connect();
    }, delay);
  }

  /**
   * Присоединиться к комнате бронирования
   */
  joinBooking(bookingId: string): void {
    if (!this.socket?.connected) {
      this.log.warn('Not connected, cannot join booking');
      return;
    }

    this.log.debug('Joining booking:', bookingId);
    this.socket.emit('join:booking', { bookingId });
  }

  /**
   * Покинуть комнату бронирования
   */
  leaveBooking(bookingId: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.log.debug('Leaving booking:', bookingId);
    this.socket.emit('leave:booking', { bookingId });
  }

  /**
   * Отправить сообщение
   */
  sendMessage(bookingId: string, message: string, senderName: string, senderRole: 'client' | 'photographer'): void {
    if (!this.socket?.connected) {
      this.log.warn('Not connected, cannot send message');
      return;
    }

    this.log.debug('Sending message:', { bookingId, message });

    this.socket.emit('message:send', {
      bookingId,
      message,
      senderName,
      senderRole
    });
  }

  /**
   * Начать печатать
   */
  startTyping(bookingId: string, userName: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('typing:start', { bookingId, userName });
  }

  /**
   * Закончить печатать
   */
  stopTyping(bookingId: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('typing:stop', { bookingId });
  }

  /**
   * Отметить сообщения как прочитанные
   */
  markMessagesAsRead(bookingId: string, messageIds: string[]): void {
    if (!this.socket?.connected) {
      return;
    }

    this.log.debug('Marking messages as read:', { bookingId, messageIds });
    this.socket.emit('messages:read', { bookingId, messageIds });
  }

  /**
   * Проверка online статуса пользователя
   */
  isUserOnline(userId: string): boolean {
    return this.onlineUsers().has(userId);
  }

  /**
   * Получить пользователей печатающих в комнате
   */
  getTypingUsersForBooking(bookingId: string): TypingIndicator[] {
    const currentUserId = this.authService.currentUser()?.id;
    return Array.from(this.typingUsers().values())
      .filter(indicator =>
        indicator.bookingId === bookingId &&
        indicator.userId !== currentUserId
      );
  }

  /**
   * Получить сообщения для комнаты
   */
  getMessagesForBooking(bookingId: string): ChatMessage[] {
    return this.messages()
      .filter(msg => msg.booking_id === bookingId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Подписка на события задач для рабочей доски
   */
  subscribeToTasks(studioId: string): void {
    if (!this.socket?.connected) return;
    this.taskSubscribedStudioId = studioId;
    this.socket.emit('tasks:subscribe', studioId);
  }

  /**
   * Отписка от событий задач
   */
  unsubscribeFromTasks(): void {
    if (this.taskSubscribedStudioId && this.socket?.connected) {
      this.socket.emit('tasks:unsubscribe', this.taskSubscribedStudioId);
    }
    this.taskSubscribedStudioId = null;
  }

  /**
   * Подписка оператора на чаты посетителей
   */
  joinVisitorChats(): void {
    this.visitorChatsJoined = true;
    if (this.socket?.connected) {
      this.socket.emit('admin:join-visitor-chats');
    }
  }

  /**
   * Отписка от чатов посетителей
   */
  leaveVisitorChats(): void {
    this.visitorChatsJoined = false;
  }

  /**
   * Подписка на события каналов (CB state, toggle)
   */
  joinChannelAdmin(): void {
    this.channelAdminJoined = true;
    if (this.socket?.connected) {
      this.socket.emit('admin:join-channels');
    }
  }

  /**
   * Отписка от событий каналов
   */
  leaveChannelAdmin(): void {
    this.channelAdminJoined = false;
  }

  /**
   * Ответ оператора посетителю через WebSocket
   */
  replyToVisitor(sessionId: string, content: string, operatorName: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('admin:reply-visitor', { sessionId, content, operatorName });
  }

  /**
   * Оператор печатает → visitor видит индикатор
   */
  sendOperatorTyping(sessionId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit('admin:operator-typing', { sessionId, isTyping });
  }

  /**
   * Оператор обновляет корзину клиента
   */
  sendCartUpdate(sessionId: string, items: unknown[]): void {
    if (!this.socket?.connected) return;
    this.socket.emit('admin:cart-update', { sessionId, items });
  }

  /**
   * Оператор открыл чат → broadcast другим (collision detection)
   */
  emitViewingChat(sessionId: string, operatorName: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('admin:viewing-chat', { sessionId, operatorName });
  }

  /**
   * Оператор закрыл / переключил чат → broadcast
   */
  emitLeftChat(sessionId: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('admin:left-chat', { sessionId });
  }

  // --- Staff Chat ---

  joinStaffChat(conversationId: string): void {
    this.staffChatJoinedRooms.add(conversationId);
    if (this.socket?.connected) {
      this.socket.emit('staff-chat:join', conversationId);
    }
  }

  leaveStaffChat(conversationId: string): void {
    this.staffChatJoinedRooms.delete(conversationId);
    if (this.socket?.connected) {
      this.socket.emit('staff-chat:leave', conversationId);
    }
  }

  sendStaffTyping(conversationId: string, isTyping: boolean): void {
    if (this.socket?.connected) {
      this.socket.emit('staff-chat:typing', { conversationId, isTyping });
    }
  }

  // --- Infrastructure Monitoring ---

  joinInfraMonitoring(): void {
    this.infraJoined = true;
    if (this.socket?.connected) {
      this.socket.emit('infra:subscribe');
    }
  }

  leaveInfraMonitoring(): void {
    this.infraJoined = false;
    if (this.socket?.connected) {
      this.socket.emit('infra:unsubscribe');
    }
  }

  requestPrintSync(): void {
    if (this.socket?.connected) {
      this.socket.emit('print:sync-request');
    }
  }

  // --- POS Real-time ---

  joinPosStudio(studioId: string): void {
    this.posStudioJoined = studioId;
    if (this.socket?.connected) {
      this.socket.emit('pos:join_studio', { studioId });
    }
  }

  leavePosStudio(): void {
    if (this.posStudioJoined && this.socket?.connected) {
      this.socket.emit('pos:leave_studio', { studioId: this.posStudioJoined });
    }
    this.posStudioJoined = null;
  }

  // --- Generic emit ---

  emit(event: string, data?: unknown): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }
}
