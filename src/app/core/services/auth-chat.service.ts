import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, filter } from 'rxjs';
import { SwPush, SwUpdate } from '@angular/service-worker';
import type { Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { FingerprintService } from './fingerprint.service';
import { LoggerService } from './logger.service';
import { APP_VERSION } from '../constants/version';
import { getSocketIoEndpoint, getSocketIoTransports } from '../utils/socket-io-routing.util';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { MessageOutboxService, type OutboxEntry } from './message-outbox.service';
import { ChunkedUploadService } from './chunked-upload.service';
import { resizeImages } from '../../shared/utils/image-resizer';

export interface BotButton {
  id: string;
  label: string;
  icon?: string;
  value: string;
  color?: string;
  visibleTo?: 'all' | 'operator' | 'visitor';
  url?: string; // Внешняя ссылка (кнопка открывает URL)
  data?: Record<string, unknown>; // Доп. данные (напр. price для оплаты)
}

export interface BotCard {
  title: string;
  subtitle?: string;
  icon?: string;
  price?: string;
  items?: { label: string; value: string }[];
  buttons?: BotButton[];
}

export interface ApprovalGalleryPhoto {
  id: string;
  retouchedUrl: string;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  status: string;
  variants: { id: string; url: string; thumbnailUrl: string | null; label: string | null }[];
}

export interface BotInteractive {
  type: 'buttons' | 'cards' | 'document_select' | 'size_select' | 'confirm' | 'chips' | 'approval_gallery';
  text?: string;
  buttons?: BotButton[];
  chips?: string[];
  cards?: BotCard[];
  step?: string;
  cartData?: Record<string, unknown>;
  sessionId?: string;
  photos?: ApprovalGalleryPhoto[];
  reviewUrl?: string;
}

export interface ChatMessageMetadata {
  interactive?: BotInteractive;
  gallery?: string[];
  [key: string]: unknown;
}

export interface FailedUpload {
  files: File[];
  sessionId: string;
  timestamp: number;
  caption?: string;
}

export type MessageDeliveryStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
type RawMessageDeliveryStatus = MessageDeliveryStatus | 'accepted';

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_type: 'visitor' | 'operator' | 'bot';
  sender_name?: string;
  message_type: 'text' | 'image' | 'file' | 'video' | 'audio' | 'system' | 'interactive';
  content: string;
  attachment_url?: string;
  gallery_urls?: string[];
  interactive?: BotInteractive;
  metadata?: ChatMessageMetadata | string | null;
  created_at: Date;
  is_read?: boolean;
  client_message_id?: string;
  delivery_status?: MessageDeliveryStatus;
  reply_to_message_id?: string | null;
  reply_to_content?: string | null;
  reply_to_sender_name?: string | null;
  is_forwarded?: boolean;
  forwarded_from_name?: string | null;
}

export interface ChatSession {
  id: string;
  visitor_id: string;
  visitor_name?: string;
  selected_service?: string;
  selected_price?: number;
  status: 'open' | 'waiting' | 'active' | 'resolved' | 'closed';
  created_at: Date;
}

/** @deprecated Use EntryContext instead. Kept for backward compatibility with backend. */
export type ChatChannel = 'studio' | 'online';

export type DeliveryMethod = 'electronic' | 'pickup' | 'postal';

export interface EntryContext {
  category?: string;
  delivery?: DeliveryMethod;
  option?: string;
  selectedDoc?: string;
  selectedDocs?: string[];
  customerNote?: string;
  selectedOptions?: { option_slug: string; quantity?: number }[];
  configuratorTotal?: number;
  [key: string]: unknown;
}

export type OrderStatus = 'none' | 'confirmed' | 'pending_payment' | 'processing' | 'completed';

export interface OrderStatusInfo {
  status: OrderStatus;
  orderNumber?: string;
  price?: number;
  label: string;
  icon: string;
  color: string;
}

const ORDER_STATUS_MAP: Record<OrderStatus, Pick<OrderStatusInfo, 'label' | 'icon' | 'color'>> = {
  none: { label: '', icon: '', color: '' },
  confirmed: { label: 'Заказ оформлен', icon: 'assignment', color: '#667eea' },
  pending_payment: { label: 'Ожидает оплаты', icon: 'credit_card', color: '#f59e0b' },
  processing: { label: 'В работе', icon: 'autorenew', color: '#22c55e' },
  completed: { label: 'Готово', icon: 'check_circle', color: '#10b981' },
};

export interface OrderContext {
  service: string;
  price: number;
  pageUrl: string;
  /** @deprecated Use entryContext instead */
  channel?: ChatChannel;
  entryContext?: EntryContext;
}

interface ChatSessionPayload {
  id?: string | null;
  visitor_id?: string | null;
  visitor_name?: string | null;
  selected_service?: string | null;
  selected_price?: number | null;
  status?: string | null;
  created_at?: Date | string | null;
  contact_id?: string | null;
  unread_count?: number | string | null;
}

interface CurrentChatSessionResponseData {
  session?: ChatSessionPayload | null;
  conversation?: ChatSessionPayload | null;
  messages?: ChatMessage[] | null;
  unread?: number | string | null;
  isExisting?: boolean;
}

interface CurrentChatSessionResponse {
  success: boolean;
  data?: CurrentChatSessionResponseData | null;
}

interface NormalizedChatSessionData {
  session: ChatSession;
  messages: ChatMessage[];
  unreadCount: number | null;
}

interface DeliveryStatusPayload {
  clientMessageId?: string | null;
  status?: RawMessageDeliveryStatus | null;
  client_message_id?: string | null;
  delivery_status?: RawMessageDeliveryStatus | null;
}

interface DeliveryStatusesEnvelope {
  statuses?: DeliveryStatusPayload[] | null;
}

interface DeliveryStatusesResponse {
  success: boolean;
  data?: DeliveryStatusesEnvelope | DeliveryStatusPayload[] | null;
}

interface PhotoCopyEntry {
  messageId: string;
  count: number;
}

interface PerPhotoCopies {
  [messageId: string]: number;
}

interface ChatInteractiveSummary {
  step?: string;
  buttons: BotButton[];
  chips: string[];
  cartData?: BotInteractive['cartData'];
}

interface WsHandshakeErrorData {
  data?: { code?: string };
}

function hasErrorData(err: unknown): err is WsHandshakeErrorData {
  return typeof err === 'object' && err !== null && 'data' in err;
}

function extractWsErrorCode(err: unknown): string | undefined {
  if (!hasErrorData(err)) return undefined;
  return err.data?.code;
}

const SESSION_EXPIRED_WS_CODES = new Set([
  'SESSION_TOKEN_INVALID',
  'SESSION_TOKEN_REVOKED',
  'SESSION_OWNERSHIP_MISMATCH',
  'SESSION_NOT_FOUND',
]);

const SESSION_CLOSED_WS_CODES = new Set([
  'SESSION_CLOSED',
]);

function isSessionExpiredCode(code: string | undefined): boolean {
  return !!code && SESSION_EXPIRED_WS_CODES.has(code);
}

function isSessionClosedCode(code: string | undefined): boolean {
  return !!code && SESSION_CLOSED_WS_CODES.has(code);
}

@Injectable({
  providedIn: 'root'
})
export class AuthChatService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private fingerprintService = inject(FingerprintService);
  private log = inject(LoggerService);
  private behaviorTracking = inject(BehaviorTrackingService);
  private swPush = inject(SwPush);
  private swUpdate = inject(SwUpdate);
  private outbox = inject(MessageOutboxService);
  private chunkedUpload = inject(ChunkedUploadService);

  private socket: Socket | null = null;
  private apiUrl = environment.apiUrl;

  // Нормализованный base URL для API запросов
  private get baseApiUrl(): string {
    if (!this.apiUrl) return '/api';
    if (this.apiUrl.endsWith('/api')) return this.apiUrl;
    return `${this.apiUrl}/api`;
  }

  private get visitorPushApiUrl(): string {
    return `${this.baseApiUrl}/chat/push`;
  }

  // State signals
  private _session = signal<ChatSession | null>(null);
  private _messages = signal<ChatMessage[]>([]);
  private _isConnected = signal(false);
  private _isTyping = signal(false);
  private _operatorTyping = signal(false);
  private _unreadCount = signal(0);
  private _isOpen = signal(false);
  private _isLoading = signal(false);
  private _uploadProgress = signal<{
    total: number;
    fileProgress: Map<number, number>; // fileIndex → percent 0-100
    fileSizes: Map<number, number>; // fileIndex → bytes
  } | null>(null);
  private _uploadError = signal<string | null>(null);
  private _uploadAbortController: AbortController | null = null;
  private _failedUploads = signal<FailedUpload[]>([]);
  private _notificationPermission = signal<NotificationPermission>('default');
  private _pushSubscribed = signal(false);
  private _updateAvailable = signal<{ currentVersion: string; latestVersion: string } | null>(null);
  private _sessionExpired = signal(false);
  private _sessionClosed = signal(false);

  // Lazy session: показываем чат мгновенно, сессию создаём при первом сообщении
  private _pendingSessionInit = signal(false);
  private _socketIOModule: typeof import('socket.io-client') | null = null;
  private _socketIOPreloadPromise: Promise<void> | null = null;
  private _createSessionInFlight: Promise<boolean> | null = null;

  private notificationPromptedKey = 'sf_notify_prompted';
  private notificationPrompted = false;
  private notificationBodyMaxLength = 160;
  private notificationIconUrl = '/assets/static/logo-black.webp';
  private pushSubscriptionEndpoint: string | null = null;
  private pushSubscriptionSessionId: string | null = null;
  private pushSubscriptionInFlight: Promise<void> | null = null;
  private pushSubscriptionFailureSessionId: string | null = null;
  private pushSubscriptionRetryAfter = 0;
  private readonly pushSubscriptionFailureCooldownMs = 60_000;
  private cachedVapidPublicKey: string | null = null;

  // Public readonly signals
  readonly session = this._session.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();
  readonly isTyping = this._isTyping.asReadonly();
  readonly operatorTyping = this._operatorTyping.asReadonly();
  readonly unreadCount = this._unreadCount.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly uploadProgress = this._uploadProgress.asReadonly();
  readonly uploadProgressPercent = computed(() => {
    const p = this._uploadProgress();
    if (!p || p.total === 0) return 0;
    // Weighted by file size for accurate progress with different-sized files
    const totalBytes = [...p.fileSizes.values()].reduce((s, b) => s + b, 0);
    if (totalBytes > 0) {
      let loadedBytes = 0;
      for (const [idx, pct] of p.fileProgress.entries()) {
        const size = p.fileSizes.get(idx) ?? 0;
        loadedBytes += size * (pct / 100);
      }
      return Math.round((loadedBytes / totalBytes) * 100);
    }
    // Fallback: count completed files
    let done = 0;
    for (const pct of p.fileProgress.values()) {
      if (pct >= 100) done++;
    }
    return Math.round((done / p.total) * 100);
  });
  readonly uploadProgressText = computed(() => {
    const p = this._uploadProgress();
    if (!p) return '';
    let done = 0;
    for (const pct of p.fileProgress.values()) {
      if (pct >= 100) done++;
    }
    const totalBytes = [...p.fileSizes.values()].reduce((s, b) => s + b, 0);
    if (totalBytes > 0) {
      let loadedBytes = 0;
      for (const [idx, pct] of p.fileProgress.entries()) {
        const size = p.fileSizes.get(idx) ?? 0;
        loadedBytes += size * (pct / 100);
      }
      const fmt = (b: number) => b < 1024 * 1024
        ? `${(b / 1024).toFixed(0)} КБ`
        : `${(b / (1024 * 1024)).toFixed(1)} МБ`;
      return `Загрузка: ${done} из ${p.total} файлов (${fmt(loadedBytes)} из ${fmt(totalBytes)})`;
    }
    return `Загрузка: ${done} из ${p.total} файлов`;
  });
  readonly isUploading = computed(() => this._uploadProgress() !== null);

  /** Get per-file upload percent for a temp message. Returns 0-100 or -1 if not uploading. */
  getFileUploadPercent(messageId: string): number {
    const p = this._uploadProgress();
    if (!p || !messageId?.startsWith('temp-')) return -1;
    const lastDash = messageId.lastIndexOf('-');
    if (lastDash <= 4) return -1;
    const index = parseInt(messageId.substring(lastDash + 1), 10);
    if (isNaN(index)) return -1;
    return p.fileProgress.get(index) ?? 0;
  }

  readonly uploadError = this._uploadError.asReadonly();
  readonly notificationPermission = this._notificationPermission.asReadonly();
  readonly pushSubscribed = this._pushSubscribed.asReadonly();
  readonly updateAvailable = this._updateAvailable.asReadonly();
  readonly sessionExpired = this._sessionExpired.asReadonly();
  readonly sessionClosed = this._sessionClosed.asReadonly();
  readonly pendingSessionInit = this._pendingSessionInit.asReadonly();
  readonly failedUploads = this._failedUploads.asReadonly();

  cancelUpload(): void {
    if (this._uploadAbortController) {
      this._uploadAbortController.abort();
      this._uploadAbortController = null;
    }
    this._uploadProgress.set(null);
    this._isLoading.set(false);
  }

  clearFailedUploads(): void {
    this._failedUploads.set([]);
  }

  async retryFailedUpload(index: number): Promise<void> {
    const failed = this._failedUploads();
    const entry = failed[index];
    if (!entry) return;
    this._failedUploads.update(prev => prev.filter((_, i) => i !== index));
    await this.uploadImages(entry.files, entry.caption);
  }

  // Channel signal — дефолт 'studio'.
  // 'online' передаётся ЯВНО только для онлайн-страниц (foto-na-documenty-online и т.д.)
  /** @deprecated Use entryContext instead */
  private _channel = signal<ChatChannel>('studio');
  /** @deprecated Use entryContext instead */
  readonly channel = this._channel.asReadonly();

  // Entry context — Phase 2 channel unification
  private _entryContext = signal<EntryContext>({});
  readonly entryContext = this._entryContext.asReadonly();

  // Per-photo copy counts (messageId -> count)
  private _photoCopies = signal<readonly PhotoCopyEntry[]>([]);
  readonly photoCopies = this._photoCopies.asReadonly();

  // Текущие интерактивные кнопки из последнего ответа бота
  private _activeButtons = signal<BotButton[]>([]);
  readonly activeButtons = this._activeButtons.asReadonly();

  // Order status tracking
  private _orderStatus = signal<OrderStatus>('none');
  private _orderNumber = signal<string>('');
  private _orderPrice = signal<number>(0);
  /** Photo IDs locked by current order (processing/completed) */
  private _lockedPhotoIds = signal<readonly string[]>([]);
  readonly orderStatus = this._orderStatus.asReadonly();

  /** Per-order paid tracking — list of order IDs confirmed as paid */
  private _paidOrderIds = signal<readonly string[]>([]);

  /** Check whether a specific order has been paid */
  isOrderPaidById(orderId: string): boolean {
    return this._paidOrderIds().includes(orderId);
  }

  readonly orderStatusInfo = computed<OrderStatusInfo>(() => {
    const status = this._orderStatus();
    const meta = ORDER_STATUS_MAP[status];
    return {
      status,
      orderNumber: this._orderNumber(),
      price: this._orderPrice(),
      ...meta,
    };
  });

  // Computed
  readonly hasSession = computed(() => this._session() !== null);
  readonly hasUnread = computed(() => this._unreadCount() > 0);
  readonly hasActiveOrder = computed(() => this._orderStatus() !== 'none');
  /** Проверить, заблокировано ли фото текущим заказом */
  isPhotoLocked(messageId: string): boolean {
    return this._lockedPhotoIds().includes(messageId);
  }
  readonly uploadedPhotos = computed(() =>
    this._messages().filter(m => m.sender_type === 'visitor' && m.message_type === 'image')
  );
  /** Есть сообщения, но пользователь ещё не загрузил фото */
  readonly needsPhotoUpload = computed(() =>
    this._messages().length > 0 && this.uploadedPhotos().length === 0
  );

  private visitorId = '';
  private overrideVisitorId: string | null = null;
  private visitorIdStorageKey = 'sf_visitor_id';
  private fingerprintPromise: Promise<string> | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // One-time cleanup: устаревшие токены (legacy + auth-only migration)
      try {
        localStorage.removeItem('sf_session_token');
        localStorage.removeItem('sf_conversation_id');
        sessionStorage.removeItem('sf_chat_session_token');
        sessionStorage.removeItem('sf_chat_conversation_id');
        sessionStorage.removeItem('sf_chat_visitor_id');
      } catch { /* noop */ }

      this.fingerprintPromise = this.initVisitorId().then(() => this.visitorId);
      this.notificationPrompted = this.readNotificationPromptedFlag();

      if ('Notification' in window) {
        this._notificationPermission.set(Notification.permission);
      }

      // SwUpdate — обнаружение обновлений через ngsw
      if (this.swUpdate.isEnabled) {
        this.swUpdate.versionUpdates.pipe(
          filter(event => event.type === 'VERSION_READY')
        ).subscribe(() => {
          this._updateAvailable.set({ currentVersion: APP_VERSION, latestVersion: 'new' });
          // Новый SW требует обновить push-подписку (старая может стать невалидной)
          this.pushSubscriptionEndpoint = null;
          this.pushSubscriptionSessionId = null;
          this.pushSubscriptionFailureSessionId = null;
          this.pushSubscriptionRetryAfter = 0;
          this.ensureChatPushSubscription().catch(() => { /* noop */ });
        });
      }

      // SwPush — обработка кликов по push-уведомлениям
      if (this.swPush.isEnabled) {
        this.swPush.notificationClicks.subscribe(({ notification }) => {
          const sessionId = notification?.data?.['sessionId'];
          if (typeof sessionId === 'string' && sessionId.length > 0) {
            this.openChatWithSession(sessionId).catch(() => { /* noop */ });
          }
        });
      }

      // Init message outbox (offline-first delivery)
      this.initOutbox();
    }
  }

  private initOutbox(): void {
    this.outbox.registerSender((entry: OutboxEntry) => this.outboxSend(entry));
    this.outbox.init().then(() => {
      // Sync outbox statuses into messages signal
      this.syncOutboxStatuses();
    });
  }

  /** Actual HTTP send called by outbox. Returns serverMessageId or throws. */
  private async outboxSend(entry: OutboxEntry): Promise<string | null> {
    const response = await firstValueFrom(this.http.post<{
      success: boolean;
      data: { message: ChatMessage; botResponse: ChatMessage | null };
    }>(`${this.baseApiUrl}/chat/sessions/${entry.sessionId}/messages`, {
      content: entry.content,
      messageType: entry.messageType,
      attachmentUrl: entry.attachmentUrl,
      clientMessageId: entry.clientMessageId,
      replyToMessageId: entry.replyToMessageId,
    }, { withCredentials: true }));

    if (!response?.success) throw new Error('Server returned success=false');

    // Replace temp message with server response
    const serverMsg = response.data.message;
    this._messages.update(msgs =>
      msgs.map(m => {
        if (m.client_message_id !== entry.clientMessageId) return m;
        const currentStatus = m.delivery_status;
        const deliveryStatus = currentStatus === 'read' || currentStatus === 'delivered' ? currentStatus : 'sent';
        return { ...serverMsg, client_message_id: entry.clientMessageId, delivery_status: deliveryStatus };
      })
    );

    // Add bot response if any
    if (response.data.botResponse) {
      this._messages.update(msgs => [...msgs, response.data.botResponse!]);
      this.autoAddToCartIfConfirmed(response.data.botResponse);
    }

    this.markSessionReopened(entry.sessionId);

    // WS broadcast for real-time operator notification
    if (this.socket?.connected) {
      this.socket.emit('visitor:message', {
        sessionId: entry.sessionId,
        content: entry.content,
        messageType: entry.messageType,
      });
    }

    return serverMsg.id;
  }

  /** Sync outbox statuses into _messages signal (for UI) */
  private syncOutboxStatuses(): void {
    const entries = this.outbox.entries();
    if (entries.size === 0) return;

    // Re-add any pending messages from outbox that aren't in _messages
    const currentIds = new Set(this._messages().map(m => m.client_message_id).filter(Boolean));
    const toAdd: ChatMessage[] = [];

    for (const [clientId, entry] of entries) {
      if (!currentIds.has(clientId) && (entry.status === 'pending' || entry.status === 'sending' || entry.status === 'failed')) {
        toAdd.push({
          id: `outbox-${clientId}`,
          session_id: entry.sessionId,
          sender_type: 'visitor',
          sender_name: 'Вы',
          message_type: entry.messageType,
          content: entry.content,
          attachment_url: entry.attachmentUrl,
          created_at: new Date(entry.createdAt),
          client_message_id: clientId,
          delivery_status: entry.status,
        });
      }
    }

    if (toAdd.length > 0) {
      this._messages.update(msgs => [...msgs, ...toAdd]);
    }
  }

  useExternalVisitorId(visitorId: string, storageKey = 'sf_visitor_id_tg'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!visitorId) return;
    this.overrideVisitorId = visitorId;
    this.visitorId = visitorId;
    this.visitorIdStorageKey = storageKey;
    try { localStorage.setItem(storageKey, visitorId); } catch { /* noop */ }
  }

  private async initVisitorId(): Promise<void> {
    if (this.overrideVisitorId) {
      this.visitorId = this.overrideVisitorId;
      return;
    }
    try {
      const cached = localStorage.getItem(this.visitorIdStorageKey);
      if (cached) {
        this.visitorId = cached;
      }
    } catch { /* noop */ }

    try {
      await Promise.race([
        this.fingerprintService.ready,
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch { /* noop */ }

    const fpId = this.fingerprintService.visitorId();
    if (fpId && !this.overrideVisitorId) {
      this.visitorId = fpId;
      try { localStorage.setItem(this.visitorIdStorageKey, fpId); } catch { /* noop */ }
    }
  }

  // ─── Lazy session: мгновенный старт чата без HTTP ───

  /**
   * Быстрый старт чата для /chat страницы (auth-only): UI появляется мгновенно (0 HTTP).
   * Сессия восстанавливается в фоне через GET /chat/sessions/current если пользователь авторизован.
   */
  ensureChatOpen(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this._isOpen()) return; // Уже открыт

    this._isOpen.set(true);
    this._isLoading.set(false);

    // SPA back-navigation: сессия уже есть — переподключаем без сброса
    if (this._session()) {
      this._pendingSessionInit.set(false);
      this.connectWebSocketForSession(this._session()!);
      return;
    }

    this._pendingSessionInit.set(true);
    this._messages.set([]);

    // Предзагрузка socket.io-client пока пользователь читает чат
    this._preloadSocketIO();

    // Восстанавливаем сессию из /chat/sessions/current (только для авторизованного пользователя)
    if (this.authService.isAuthenticated()) {
      this._restoreSessionInBackground();
    }

    this.behaviorTracking.trackChatOpen();
  }

  /** Предзагрузка socket.io-client модуля в фоне */
  private _preloadSocketIO(): void {
    if (this._socketIOPreloadPromise || this._socketIOModule) return;
    this._socketIOPreloadPromise = import('socket.io-client')
      .then(mod => { this._socketIOModule = mod; })
      .catch(() => { /* connectWebSocket сделает свой import */ });
  }

  private normalizeCurrentSession(response: CurrentChatSessionResponse | null | undefined): NormalizedChatSessionData | null {
    if (!response?.success) return null;

    const data = response.data;
    const source = data?.session ?? data?.conversation;
    if (!source || typeof source.id !== 'string' || source.id.length === 0) {
      this.log.warn('Chat session response missing session payload');
      return null;
    }

    const session: ChatSession = {
      id: source.id,
      visitor_id: this.normalizeVisitorId(source),
      status: this.normalizeSessionStatus(source.status),
      created_at: this.normalizeDate(source.created_at),
    };

    if (typeof source.visitor_name === 'string') {
      session.visitor_name = source.visitor_name;
    }
    if (typeof source.selected_service === 'string') {
      session.selected_service = source.selected_service;
    }
    if (typeof source.selected_price === 'number') {
      session.selected_price = source.selected_price;
    }

    return {
      session,
      messages: Array.isArray(data?.messages) ? data.messages : [],
      unreadCount: this.normalizeCount(data?.unread ?? source.unread_count),
    };
  }

  private normalizeVisitorId(source: ChatSessionPayload): string {
    if (typeof source.visitor_id === 'string' && source.visitor_id.length > 0) {
      return source.visitor_id;
    }
    if (typeof source.contact_id === 'string' && source.contact_id.length > 0) {
      return source.contact_id;
    }
    return this.visitorId;
  }

  private normalizeSessionStatus(status: string | null | undefined): ChatSession['status'] {
    switch (status) {
      case 'waiting':
      case 'active':
      case 'resolved':
      case 'closed':
        return status;
      case 'open':
      default:
        return 'open';
    }
  }

  private isLiveSessionStatus(status: ChatSession['status'] | null | undefined): boolean {
    return status === 'open' || status === 'waiting' || status === 'active';
  }

  private connectWebSocketForSession(session: ChatSession): void {
    if (this.isLiveSessionStatus(session.status)) {
      this.connectWebSocket(session.id);
    } else {
      this.disconnectSocket();
    }
  }

  private markSessionReopened(sessionId: string): void {
    const session = this._session();
    if (!session || session.id !== sessionId || this.isLiveSessionStatus(session.status)) {
      return;
    }

    this._session.set({ ...session, status: 'open' });
    this._sessionClosed.set(false);
    this._sessionExpired.set(false);
    this.disconnectSocket();
    this.connectWebSocket(sessionId);
  }

  private disconnectSocket(): void {
    if (this.socket) {
      try { this.socket.disconnect(); } catch { /* noop */ }
      this.socket = null;
    }
    this._isConnected.set(false);
  }

  private normalizeDate(value: Date | string | null | undefined): Date {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  }

  private normalizeCount(value: number | string | null | undefined): number | null {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : null;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }

  private parseMessageMetadata(metadata: ChatMessage['metadata']): ChatMessageMetadata | null {
    if (!metadata) return null;
    if (typeof metadata !== 'string') return metadata;

    try {
      const parsed: unknown = JSON.parse(metadata);
      return this.isChatMessageMetadata(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isChatMessageMetadata(value: unknown): value is ChatMessageMetadata {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getMessageInteractiveSummary(message: ChatMessage): ChatInteractiveSummary | null {
    return this.normalizeInteractiveSummary(
      message.interactive ?? this.parseMessageMetadata(message.metadata)?.interactive
    );
  }

  private normalizeInteractiveSummary(interactive: BotInteractive | null | undefined): ChatInteractiveSummary | null {
    if (!interactive) return null;

    const buttons = Array.isArray(interactive.buttons) ? interactive.buttons : [];
    const chips = Array.isArray(interactive.chips) ? interactive.chips : [];
    const summary: ChatInteractiveSummary = { buttons, chips };

    if (interactive.step) {
      summary.step = interactive.step;
    }
    if (interactive.cartData) {
      summary.cartData = interactive.cartData;
    }

    return summary.step || summary.buttons.length > 0 || summary.chips.length > 0 || summary.cartData
      ? summary
      : null;
  }

  /**
   * Фоновое восстановление сессии для вернувшихся посетителей (fire-and-forget).
   * Использует общий _createSessionInFlight для предотвращения гонки с _ensureSession.
   */
  private _restoreSessionInBackground(): void {
    // Занимаем _createSessionInFlight чтобы sendMessage ждал нас, а не создавал вторую сессию
    this._createSessionInFlight = this._doRestoreSession();
    this._createSessionInFlight
      .catch(() => { /* тихий fallback: свежая сессия создастся при первом сообщении */ })
      .finally(() => { this._createSessionInFlight = null; });
  }

  private async _doRestoreSession(): Promise<boolean> {
    try {
      if (!this.authService.isAuthenticated()) return false;

      const response = await firstValueFrom(this.http.get<CurrentChatSessionResponse>(
        `${this.baseApiUrl}/chat/sessions/current`,
        { withCredentials: true }
      ));
      const current = this.normalizeCurrentSession(response);

      // Другой путь уже создал сессию — не перезаписываем
      if (this._session()) return true;

      if (current) {
        this._session.set(current.session);

        const realMessages = current.messages;
        if (realMessages.length > 0) {
          this._messages.set(realMessages);
        }
        if (current.unreadCount !== null) {
          this._unreadCount.set(current.unreadCount);
        }

        this.restoreOrderStatusFromHistory(realMessages);
        this._sessionClosed.set(false);
        this._sessionExpired.set(false);
        this.connectWebSocketForSession(current.session);
        this._pendingSessionInit.set(false);

        if ('Notification' in window && Notification.permission === 'granted') {
          this.ensureChatPushSubscription().catch(() => { /* noop */ });
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Создать сессию прямо сейчас (для lazy-guard в sendMessage/upload).
   * Если фоновое восстановление уже летит — ждём его вместо нового запроса.
   */
  private async _ensureSession(): Promise<boolean> {
    if (this._session()) return true;
    if (this._createSessionInFlight) return this._createSessionInFlight;

    this._createSessionInFlight = this._doCreateSession();
    try {
      return await this._createSessionInFlight;
    } finally {
      this._createSessionInFlight = null;
    }
  }

  private async _doCreateSession(): Promise<boolean> {
    try {
      if (!this.authService.isAuthenticated()) return false;

      const response = await firstValueFrom(this.http.get<CurrentChatSessionResponse>(
        `${this.baseApiUrl}/chat/sessions/current`,
        { withCredentials: true }
      ));
      const current = this.normalizeCurrentSession(response);

      if (current) {
        this._session.set(current.session);

        // Сохраняем реальную историю, но оставляем optimistic-сообщения пользователя
        const currentMsgs = this._messages();
        const optimistic = currentMsgs.filter(m => m.sender_type === 'visitor' && m.id?.startsWith('temp-'));
        this._messages.set([...current.messages, ...optimistic]);
        if (current.unreadCount !== null) {
          this._unreadCount.set(current.unreadCount);
        }
        this.restoreOrderStatusFromHistory(current.messages);

        this._sessionClosed.set(false);
        this._sessionExpired.set(false);
        this.connectWebSocketForSession(current.session);
        this._pendingSessionInit.set(false);

        if ('Notification' in window && Notification.permission === 'granted') {
          this.ensureChatPushSubscription().catch(() => { /* noop */ });
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ─── / Lazy session ───

  /**
   * Открыть чат с контекстом заказа
   */
  private _openChatPromise: Promise<void> | null = null;

  async openChat(orderContext?: OrderContext): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    // Concurrency guard — ждём завершения предыдущего вызова
    if (this._openChatPromise) {
      await this._openChatPromise;
      // Обновляем entry_context даже если _doOpenChat не вызывался повторно —
      // иначе submitOrderBundle потеряет контекст заказа (categorySlug, selectedOptions и т.д.)
      if (orderContext?.entryContext) {
        this._entryContext.set(orderContext.entryContext);
      }
      if (orderContext?.channel) {
        this._channel.set(orderContext.channel);
      }
      return;
    }

    this._openChatPromise = this._doOpenChat(orderContext);
    try {
      await this._openChatPromise;
    } finally {
      this._openChatPromise = null;
    }
  }

  private async _doOpenChat(orderContext?: OrderContext): Promise<void> {
    // Обновляем канал — дефолт 'studio' (backward compat)
    const channel: ChatChannel = orderContext?.channel || 'studio';
    this._channel.set(channel);

    // Phase 2: entry context — derive from channel if not explicitly provided
    const entryContext: EntryContext = orderContext?.entryContext
      || (channel === 'online' ? { category: 'photo-docs', delivery: 'electronic' } : {});
    this._entryContext.set(entryContext);

    this._isOpen.set(true);
    this._isLoading.set(true);
    this.behaviorTracking.trackChatOpen();

    try {
      // Auth-only: если пользователь не авторизован — показываем CTA (виджет сам переключается)
      if (!this.authService.isAuthenticated()) {
        return;
      }

      // GET /chat/sessions/current — latest-or-create через backend auth-only flow
      const response = await firstValueFrom(this.http.get<CurrentChatSessionResponse>(
        `${this.baseApiUrl}/chat/sessions/current`,
        { withCredentials: true }
      ));
      const current = this.normalizeCurrentSession(response);

      if (current) {
        this._session.set(current.session);
        this._messages.set(current.messages);
        if (current.unreadCount !== null) {
          this._unreadCount.set(current.unreadCount);
        }

        // Восстанавливаем статус заказа из истории сообщений
        this.restoreOrderStatusFromHistory(current.messages);

        this._sessionClosed.set(false);
        this._sessionExpired.set(false);
        this.connectWebSocketForSession(current.session);

        if (isPlatformBrowser(this.platformId) && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            this.ensureChatPushSubscription().catch(() => { /* noop */ });
          }
        }
      }
    } catch (error) {
      this.log.error('Error opening chat:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Закрыть чат
   */
  closeChat(): void {
    this._isOpen.set(false);
  }

  /**
   * Открыть чат с существующей сессией (для страницы чата)
   */
  async openChatWithSession(sessionId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.authService.isAuthenticated()) return;

    this._isOpen.set(true);
    this._isLoading.set(true);

    try {
      // Получаем данные существующей сессии
      const response = await firstValueFrom(this.http.get<{
        success: boolean;
        data: {
          session: ChatSession;
          messages: ChatMessage[];
        };
      }>(`${this.baseApiUrl}/chat/sessions/${sessionId}`, { withCredentials: true }));

      if (response?.success) {
        this._session.set(response.data.session);
        this._messages.set(response.data.messages || []);

        this._sessionClosed.set(false);
        this._sessionExpired.set(false);
        this.connectWebSocketForSession(response.data.session);

        if (isPlatformBrowser(this.platformId) && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            this.ensureChatPushSubscription().catch(() => { /* noop */ });
          }
        }
      } else {
        throw new Error('Session not found');
      }
    } catch (error) {
      this.log.error('Error opening chat session:', error);
      throw error;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Получить текущий session ID
   */
  getSessionId(): string | null {
    return this._session()?.id || null;
  }

  /** Текущий visitorId для visitor-scoped API запросов. */
  getVisitorId(): string {
    return this.visitorId;
  }

  /**
   * Скрыто уведомляет операторов о клике по CTA без изменения UI пользователя.
   */
  notifyLeadClick(pageUrl: string, service: string): void {
    const visitorId = this.getVisitorId();
    if (!visitorId) return;

    this.http.post(`${this.baseApiUrl}/chat/lead-notify`, {
      visitorId,
      pageUrl,
      service,
    }).subscribe({
      error: (error) => this.log.warn('Lead notify failed:', error),
    });
  }

  /**
   * Отправить сообщение (offline-first через outbox).
   * 1. Persist to IndexedDB
   * 2. Show optimistic UI with 'pending' status
   * 3. Outbox handles send + retry + status transitions
   */
  async sendMessage(content: string, messageType: 'text' | 'image' = 'text', attachmentUrl?: string, replyToMessageId?: string, replyToContent?: string, replyToSenderName?: string): Promise<void> {
    if (!content.trim()) return;

    // Lazy session guard: создаём сессию при первом сообщении если ещё нет
    if (!this._session()) {
      this._isLoading.set(true);
      const ok = await this._ensureSession();
      this._isLoading.set(false);
      if (!ok) {
        this._uploadError.set('Не удалось подключиться. Проверьте интернет и попробуйте снова.');
        setTimeout(() => this._uploadError.set(null), 5000);
        return;
      }
    }

    const session = this._session();
    if (!session) return;

    const clientMessageId = crypto.randomUUID();

    // Optimistic UI: add message immediately with 'pending' status
    const optimisticMessage: ChatMessage = {
      id: `outbox-${clientMessageId}`,
      session_id: session.id,
      sender_type: 'visitor',
      sender_name: 'Вы',
      message_type: messageType,
      content: content.trim(),
      attachment_url: attachmentUrl,
      created_at: new Date(),
      client_message_id: clientMessageId,
      delivery_status: 'pending',
      reply_to_message_id: replyToMessageId ?? null,
      reply_to_content: replyToContent ?? null,
      reply_to_sender_name: replyToSenderName ?? null,
    };

    this._messages.update(msgs => [...msgs, optimisticMessage]);

    // Enqueue to outbox (persists to IndexedDB, then sends)
    await this.outbox.enqueue({
      clientMessageId,
      sessionId: session.id,
      content: content.trim(),
      messageType,
      attachmentUrl,
      visitorId: this.visitorId,
      replyToMessageId,
    });

    // Subscribe to outbox status changes for this message
    this.watchOutboxEntry(clientMessageId);
  }

  /** Watch outbox entry and sync delivery_status into _messages */
  private watchOutboxEntry(clientMessageId: string): void {
    const check = () => {
      const entry = this.outbox.entries().get(clientMessageId);
      if (!entry) return;

      this._messages.update(msgs =>
        msgs.map(m => m.client_message_id === clientMessageId
          ? { ...m, delivery_status: entry.status }
          : m
        )
      );

      // Continue watching if still pending/sending
      if (entry.status === 'pending' || entry.status === 'sending') {
        setTimeout(check, 500);
      } else if (entry.status === 'sent' || entry.status === 'delivered' || entry.status === 'read') {
        // Clean up confirmed entries after a delay
        setTimeout(() => this.outbox.remove(clientMessageId), 30000);
      }
    };
    setTimeout(check, 100);
  }

  /** Retry a failed message (called from UI) */
  retryMessage(clientMessageId: string): void {
    this.outbox.retryFailed(clientMessageId);
    this.watchOutboxEntry(clientMessageId);
  }

  /**
   * Отправить нажатие интерактивной кнопки
   */
  async sendButtonClick(button: BotButton): Promise<void> {
    // Lazy session guard
    if (!this._session()) {
      this._isLoading.set(true);
      const ok = await this._ensureSession();
      this._isLoading.set(false);
      if (!ok) return;
    }

    const session = this._session();
    if (!session) return;

    // Показываем выбор клиента как сообщение
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: session.id,
      sender_type: 'visitor',
      sender_name: 'Вы',
      message_type: 'text',
      content: button.label.replace(/^[^\w\u0400-\u04FF]+/, '').trim(), // Убираем эмодзи в начале
      created_at: new Date()
    };

    this._messages.update(msgs => [...msgs, tempMessage]);

    try {
      // Если pay_order — добавляем перфото-копии из галереи
      let buttonData = button.data ? { ...button.data } : undefined;
      if (button.value === 'pay_order') {
        const copies = this._photoCopies();
        if (copies.length > 0) {
          const perPhotoCopies: PerPhotoCopies = {};
          for (const copy of copies) {
            perPhotoCopies[copy.messageId] = copy.count;
          }
          buttonData = { ...(buttonData || {}), perPhotoCopies };
        }
      }

      const response = await firstValueFrom(this.http.post<{
        success: boolean;
        data: {
          message: ChatMessage;
          botResponse: ChatMessage | null;
          archiveUrl?: string;
        };
      }>(`${this.baseApiUrl}/chat/sessions/${session.id}/messages`, {
        visitorId: this.visitorId,
        content: button.label.replace(/^[^\w\u0400-\u04FF]+/, '').trim(),
        messageType: 'text',
        isButtonClick: true,
        buttonValue: button.value,
        buttonData: buttonData,
      }));

      if (response?.success) {
        // Заменяем временное сообщение на реальное, но сохраняем отображаемый label
        // (в БД хранится buttonValue для надёжного распознавания контекста)
        this._messages.update(msgs =>
          msgs.map(m => m.id === tempMessage.id
            ? { ...response.data.message, content: tempMessage.content }
            : m)
        );

        // Добавляем ответ бота с интерактивными кнопками
        if (response.data.botResponse) {
          this._messages.update(msgs => [...msgs, response.data.botResponse!]);
          this.autoAddToCartIfConfirmed(response.data.botResponse);
        }
        this.markSessionReopened(session.id);
      }
    } catch (error) {
      this.log.error('Error sending button click:', error);
      this._messages.update(msgs => msgs.filter(m => m.id !== tempMessage.id));
    }
  }

  /**
   * Загрузить одно изображение
   */
  async uploadImage(file: File, caption?: string): Promise<void> {
    return this.uploadImages([file], caption);
  }

  /**
   * Загрузить несколько изображений (массовая загрузка)
   */
  async uploadImages(files: File[], caption?: string): Promise<void> {
    if (files.length === 0) return;

    // Client-side resize: reduce large photos (e.g. iPhone 20MB RAW) before upload
    files = await resizeImages(files);

    // Lazy session guard
    if (!this._session()) {
      this._isLoading.set(true);
      const ok = await this._ensureSession();
      this._isLoading.set(false);
      if (!ok) {
        this._uploadError.set('Не удалось подключиться. Проверьте интернет и попробуйте снова.');
        setTimeout(() => this._uploadError.set(null), 5000);
        return;
      }
    }

    const session = this._session();
    if (!session) return;

    // Мягкие лимиты: предупреждаем, но не блокируем
    if (files.length > 500) {
      this.log.warn(`Загрузка ${files.length} файлов — рекомендуется не более 500 за раз`);
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 2 * 1024 * 1024 * 1024) { // 2GB
      this.log.warn(`Общий размер файлов: ${(totalSize / (1024 * 1024 * 1024)).toFixed(1)} ГБ — загрузка может занять время`);
    }

    // Оптимистичное добавление превью для всех файлов
    const tempEntries = files.map((file, i) => {
      const tempId = `temp-${Date.now()}-${i}`;
      const previewUrl = URL.createObjectURL(file);
      const msgType = this.detectFileType(file.type);
      const caption_prefix = msgType === 'image' ? '📷 Фото'
        : msgType === 'video' ? '📹 Видео'
        : msgType === 'audio' ? '🎵 Аудио'
        : '📎 Файл';
      const tempMessage: ChatMessage = {
        id: tempId,
        session_id: session.id,
        sender_type: 'visitor',
        sender_name: 'Вы',
        message_type: msgType,
        content: files.length > 1
          ? `${caption_prefix} ${i + 1}/${files.length}${caption ? ` — ${caption}` : ''}`
          : caption || caption_prefix,
        attachment_url: previewUrl,
        created_at: new Date()
      };
      return { tempId, previewUrl, tempMessage };
    });

    this._messages.update(msgs => [...msgs, ...tempEntries.map(e => e.tempMessage)]);
    this._isLoading.set(true);
    const abortController = new AbortController();
    this._uploadAbortController = abortController;
    const fileSizes = new Map(files.map((f, i) => [i, f.size]));
    this._uploadProgress.set({ total: files.length, fileProgress: new Map(), fileSizes });

    try {
      // Pre-signed S3 upload: presign → PUT to S3 → complete
      const filesMeta = files.map(f => ({
        fileName: f.name, contentType: f.type || 'application/octet-stream', fileSize: f.size,
      }));

      // 1. Get pre-signed URLs
      const presignResponse = await firstValueFrom(this.http.post<{
        success: boolean;
        data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
      }>(`${this.baseApiUrl}/chat/sessions/${session.id}/upload/presign`, {
        visitorId: this.visitorId, files: filesMeta,
      }));

      if (!presignResponse?.success) throw new Error('Presign failed');

      // 2. PUT files directly to S3 via XHR (or chunked for >10MB) — allSettled for partial error
      const uploads = presignResponse.data.uploads;
      const settled = await Promise.allSettled(
        files.map(async (file, i): Promise<{ s3Key: string; fileName: string; contentType: string; fileSize: number }> => {
          if (abortController.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
          const { s3Key, uploadUrl, contentType } = uploads[i];

          const updateFileProgress = (pct: number) => {
            this._uploadProgress.update(p => {
              if (!p) return p;
              const next = new Map(p.fileProgress);
              next.set(i, pct);
              return { ...p, fileProgress: next };
            });
          };

          if (this.chunkedUpload.shouldUseChunkedUpload(file.size)) {
            await this.chunkedUpload.upload(
              file, s3Key, session.id,
              (progress) => updateFileProgress(progress.percent),
            );
            updateFileProgress(100);
            return { s3Key, fileName: file.name, contentType, fileSize: file.size };
          }

          // Small file: direct presigned PUT
          return new Promise<{ s3Key: string; fileName: string; contentType: string; fileSize: number }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            abortController.signal.addEventListener('abort', () => {
              xhr.abort();
              reject(new DOMException('Upload cancelled', 'AbortError'));
            });
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', contentType);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                updateFileProgress(Math.round((e.loaded / e.total) * 100));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                updateFileProgress(100);
                resolve({ s3Key, fileName: file.name, contentType, fileSize: file.size });
              } else {
                reject(new Error(`S3 upload failed: ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error('S3 upload network error'));
            xhr.send(file);
          });
        })
      );

      // Separate succeeded / failed
      const uploadResults: { s3Key: string; fileName: string; contentType: string; fileSize: number }[] = [];
      const failedIndices: number[] = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          uploadResults.push(r.value);
        } else {
          failedIndices.push(i);
          if (r.reason?.name === 'AbortError') throw r.reason;
        }
      }

      // Remove failed optimistic messages, revoke blob URLs, save files for retry
      if (failedIndices.length > 0) {
        const failedTempIds = new Set(failedIndices.map(idx => tempEntries[idx].tempId));
        this._messages.update(msgs => msgs.filter(m => !failedTempIds.has(m.id)));
        failedIndices.forEach(idx => URL.revokeObjectURL(tempEntries[idx].previewUrl));
        const failedFiles = failedIndices.map(idx => files[idx]);
        this._failedUploads.update(prev => [...prev, {
          files: failedFiles,
          sessionId: session.id,
          timestamp: Date.now(),
          caption,
        }]);
      }

      // If nothing uploaded, bail
      if (uploadResults.length === 0) {
        this._uploadError.set('Не удалось отправить');
        setTimeout(() => this._uploadError.set(null), 6000);
        return;
      }

      // 3. Notify backend: create messages + bot response (only for successful uploads)
      const completeResponse = await firstValueFrom(this.http.post<{
        success: boolean;
        data: {
          message?: ChatMessage;
          messages?: ChatMessage[];
          botResponse: ChatMessage | null;
          attachmentUrl?: string;
          count?: number;
        };
      }>(`${this.baseApiUrl}/chat/sessions/${session.id}/upload/complete`, {
        visitorId: this.visitorId,
        files: uploadResults,
        caption,
        suppressBot: false,
      }));

      if (completeResponse?.success) {
        this.markSessionReopened(session.id);

        const succeededTempEntries = tempEntries.filter((_, idx) => !failedIndices.includes(idx));
        succeededTempEntries.forEach(e => URL.revokeObjectURL(e.previewUrl));

        if (uploadResults.length === 1 && completeResponse.data.message && succeededTempEntries.length === 1) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === succeededTempEntries[0].tempId ? completeResponse.data.message! : m)
          );
        } else if (completeResponse.data.messages) {
          const tempIds = new Set(succeededTempEntries.map(e => e.tempId));
          this._messages.update(msgs => {
            const withoutTemp = msgs.filter(m => !tempIds.has(m.id));
            return [...withoutTemp, ...completeResponse.data.messages!];
          });
        }

        if (completeResponse.data.botResponse) {
          this._messages.update(msgs => [...msgs, completeResponse.data.botResponse!]);
          this.autoAddToCartIfConfirmed(completeResponse.data.botResponse);
        }
      }

      if (failedIndices.length > 0) {
        this._uploadError.set(`${failedIndices.length} из ${files.length} не отправлены`);
        setTimeout(() => this._uploadError.set(null), 8000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.log.debug('Upload cancelled by user');
        const tempIds = new Set(tempEntries.map(e => e.tempId));
        this._messages.update(msgs => msgs.filter(m => !tempIds.has(m.id)));
        tempEntries.forEach(e => URL.revokeObjectURL(e.previewUrl));
      } else {
        this.log.error('Error uploading images:', error);
        const tempIds = new Set(tempEntries.map(e => e.tempId));
        this._messages.update(msgs => msgs.filter(m => !tempIds.has(m.id)));
        tempEntries.forEach(e => URL.revokeObjectURL(e.previewUrl));
        this._uploadError.set('Не удалось отправить. Проверьте интернет');
        setTimeout(() => this._uploadError.set(null), 6000);
      }
    } finally {
      this._isLoading.set(false);
      this._uploadProgress.set(null);
      this._uploadAbortController = null;
    }
  }

  /**
   * Отправить заказ из конфигуратора одним пакетом: контекст + набор фото.
   */
  async submitOrderBundle(files: File[], orderContext: OrderContext): Promise<{ success: boolean; error?: string; orderId?: string; orderTotal?: number }> {
    if (!files.length) return { success: false, error: 'Файлы не выбраны' };

    await this.openChat(orderContext);

    // Fallback: если openChat провалился молча (network/rate-limit), пробуем _ensureSession
    if (!this._session()) {
      this.log.warn('openChat did not create session, retrying via _ensureSession');
      await this._ensureSession();
    }

    const session = this._session();
    if (!session) return { success: false, error: 'Не удалось создать сессию. Проверьте соединение.' };

    this._isLoading.set(true);

    try {
      // Pre-signed S3 upload: presign → PUT to S3 → complete-bundle
      const filesMeta = files.map(f => ({
        fileName: f.name, contentType: f.type || 'application/octet-stream', fileSize: f.size,
      }));

      // 1. Presign
      const presignResponse = await firstValueFrom(this.http.post<{
        success: boolean;
        data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
      }>(`${this.baseApiUrl}/chat/sessions/${session.id}/upload/presign`, {
        visitorId: this.visitorId, files: filesMeta,
      }));

      if (!presignResponse?.success) return { success: false, error: 'Не удалось подготовить загрузку' };

      // 2. PUT to S3 (or chunked for >10MB)
      const uploads = presignResponse.data.uploads;
      const uploadResults = await Promise.all(
        files.map(async (file, i): Promise<{ s3Key: string; fileName: string; contentType: string; fileSize: number }> => {
          const { s3Key, uploadUrl, contentType } = uploads[i];

          if (this.chunkedUpload.shouldUseChunkedUpload(file.size)) {
            await this.chunkedUpload.upload(file, s3Key, session.id);
            return { s3Key, fileName: file.name, contentType, fileSize: file.size };
          }

          return new Promise<{ s3Key: string; fileName: string; contentType: string; fileSize: number }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', contentType);
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve({ s3Key, fileName: file.name, contentType, fileSize: file.size });
              } else {
                reject(new Error(`S3 upload failed: ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error('S3 upload network error'));
            xhr.send(file);
          });
        })
      );

      // 3. Complete bundle
      const response = await firstValueFrom(this.http.post<{
        success: boolean;
        data: {
          galleryMessage: ChatMessage;
          botResponse: ChatMessage | null;
          count: number;
          orderId?: string;
          orderTotal?: number;
        };
      }>(`${this.baseApiUrl}/chat/sessions/${session.id}/upload/complete-bundle`, {
        visitorId: this.visitorId,
        files: uploadResults,
        orderConfig: {
          categorySlug: orderContext.entryContext?.category,
          selectedDoc: orderContext.entryContext?.selectedDoc,
          selectedDocs: orderContext.entryContext?.selectedDocs,
          customerNote: orderContext.entryContext?.customerNote,
          selectedOptions: orderContext.entryContext?.selectedOptions,
          configuratorTotal: orderContext.entryContext?.configuratorTotal,
          displayName: orderContext.service,
        },
      }));

      if (response?.success) {
        this.markSessionReopened(session.id);

        this._messages.update(msgs => {
          const next = [...msgs];
          const existingIds = new Set(next.map(message => message.id));

          if (!existingIds.has(response.data.galleryMessage.id)) {
            next.push(response.data.galleryMessage);
            existingIds.add(response.data.galleryMessage.id);
          }

          if (response.data.botResponse && !existingIds.has(response.data.botResponse.id)) {
            next.push(response.data.botResponse);
          }

          return next;
        });

        if (response.data.botResponse) {
          this.autoAddToCartIfConfirmed(response.data.botResponse);
        }
        return {
          success: true,
          orderId: response.data.orderId || undefined,
          orderTotal: response.data.orderTotal || undefined,
        };
      }

      return { success: false, error: 'Сервер не подтвердил заказ. Попробуйте ещё раз.' };
    } catch (error) {
      this.log.error('Error submitting order bundle:', error);
      return { success: false, error: 'Ошибка отправки. Проверьте соединение и попробуйте снова.' };
    } finally {
      this._isLoading.set(false);
      this._uploadProgress.set(null);
    }
  }

  /**
   * Авто-добавление заказа в корзину при подтверждении ботом.
   * Когда бот отправляет сообщение с interactive.step === 'order_confirmed',
   * заказ автоматически добавляется в корзину (без открытия панели).
   * Кнопка «Оплатить» затем просто открывает корзину.
   */
  private detectFileType(mimetype: string): 'image' | 'video' | 'audio' | 'file' {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'file';
  }

  private autoAddToCartIfConfirmed(botResponse: ChatMessage): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const interactive = this.getMessageInteractiveSummary(botResponse);

    // Dispatch chat:orderFinalized на финальных шагах (бэкенд уже посчитал итоговую цену с аддонами)
    const finalSteps = [
      'order_confirmed', 'order_confirmed_archived',
      // Legacy step names (old messages in DB)
      'order_paid', 'order_paid_archived', 'order_paid_processed', 'order_paid_manual',
    ];
    if (interactive?.step && finalSteps.includes(interactive.step) && interactive.buttons.length > 0) {
      const widgetBtn = interactive.buttons.find(b => b.value === 'pay_online_widget');
      if (widgetBtn?.data) {
        window.dispatchEvent(new CustomEvent('chat:orderFinalized', {
          detail: {
            orderId: widgetBtn.data['orderId'],
            price: widgetBtn.data['price'],
            description: widgetBtn.data['description'],
          },
        }));
      }
    }

    // Авто-добавление в корзину при ответе бота с шагом cart_added
    if (interactive?.step === 'cart_added' && interactive.cartData) {
      window.dispatchEvent(new CustomEvent('cart:addItem', {
        detail: interactive.cartData,
      }));
    }

    // Авто-открытие корзины при ответе бота
    if (interactive?.step === 'cart_opened') {
      window.dispatchEvent(new CustomEvent('cart:open'));
    }

    // Обновляем статус заказа на основе interactive step
    this.updateOrderStatusFromMessage(botResponse);

    // Обновляем кнопки в панели меню
    this.extractActiveButtons(botResponse);
  }

  /**
   * Извлечь кнопки из бот-ответа и обновить activeButtons.
   * Проверяет interactive (top-level) и metadata.interactive.
   */
  private extractActiveButtons(message: ChatMessage): void {
    const interactive = this.getMessageInteractiveSummary(message);

    if (interactive?.buttons.length) {
      this._activeButtons.set(interactive.buttons);
      return;
    }
    if (interactive?.chips.length) {
      const mapped: BotButton[] = interactive.chips.map((chip, index) => ({
        id: `chip-${index}`,
        label: chip,
        value: chip,
      }));
      this._activeButtons.set(mapped);
      return;
    }

    // Нет кнопок — сбрасываем (покажется статическое меню)
    this._activeButtons.set([]);
  }

  /**
   * Обновление статуса заказа из сообщения бота.
   * Анализирует interactive.step и content для определения текущего статуса.
   */
  private updateOrderStatusFromMessage(message: ChatMessage): void {
    const step = this.getMessageInteractiveSummary(message)?.step || '';
    const content = message.content || '';

    // Извлекаем номер заказа из текста
    const orderMatch = content.match(/Заказ\s*(?:№\s*)?(\d+)/);
    if (orderMatch) {
      this._orderNumber.set(orderMatch[1]);
    }

    // Извлекаем цену из текста
    const priceMatch = content.match(/(\d+)\s*₽/);
    if (priceMatch) {
      this._orderPrice.set(parseInt(priceMatch[1], 10));
    }

    // Определяем статус по step или содержимому
    if (step === 'order_confirmed' || step === 'order_confirmed_archived') {
      this._orderStatus.set('confirmed');
    } else if (step === 'online_print_ask') {
      this._orderStatus.set('confirmed');
    } else if (
      // Legacy step names from old DB messages (creation messages incorrectly named order_paid*)
      step === 'order_paid' ||
      step === 'order_paid_archived' ||
      step === 'order_paid_processed' ||
      step === 'order_paid_manual'
    ) {
      this._orderStatus.set('confirmed');
      this.lockCurrentPhotos();
    } else if (step === 'order_in_progress' || content.includes('Оплата') && content.includes('получена')) {
      this._orderStatus.set('processing');
      this.lockCurrentPhotos();
    } else if (step === 'order_completed') {
      this._orderStatus.set('completed');
      this.lockCurrentPhotos();
    }
  }

  /** Зафиксировать текущие загруженные фото как заблокированные заказом */
  private lockCurrentPhotos(): void {
    const currentIds = new Set(this._lockedPhotoIds());
    for (const photo of this.uploadedPhotos()) {
      currentIds.add(photo.id);
    }
    this._lockedPhotoIds.set([...currentIds]);
  }

  /**
   * Восстановить статус заказа из истории сообщений при открытии сессии.
   * Проходит по всем бот-сообщениям и берёт последний актуальный статус.
   */
  private restoreOrderStatusFromHistory(messages: ChatMessage[]): void {
    const botMessages = messages.filter(m => m.sender_type === 'bot');
    for (const msg of botMessages) {
      this.updateOrderStatusFromMessage(msg);
      this.extractActiveButtons(msg);
    }
  }

  // ========== Photo management ==========

  /**
   * Удалить фотографию (файл с сервера + сообщение из чата)
   */
  async deletePhoto(messageId: string): Promise<void> {
    const session = this._session();
    if (!session) return;

    // Оптимистичное удаление из UI
    this._messages.update(msgs => msgs.filter(m => m.id !== messageId));
    this._photoCopies.update(entries => entries.filter(entry => entry.messageId !== messageId));

    try {
      await firstValueFrom(this.http.request('DELETE', `${this.baseApiUrl}/chat/sessions/${session.id}/messages/${messageId}`, {
        body: { visitorId: this.visitorId },
      }));
    } catch (error) {
      this.log.error('Error deleting photo:', error);
      // При ошибке не восстанавливаем — серверная сторона может уже удалить
    }
  }

  /**
   * Установить количество копий для конкретной фотографии
   */
  setPhotoCopies(messageId: string, count: number): void {
    const clamped = Math.max(1, Math.min(99, count));
    this._photoCopies.update(entries => [
      ...entries.filter(entry => entry.messageId !== messageId),
      { messageId, count: clamped },
    ]);
  }

  /**
   * Получить количество копий для фото (по умолчанию 1)
   */
  getPhotoCopies(messageId: string): number {
    return this._photoCopies().find(entry => entry.messageId === messageId)?.count ?? 1;
  }

  /**
   * Удалить все загруженные фотографии
   */
  async clearAllPhotos(): Promise<void> {
    const photos = this.uploadedPhotos();
    if (photos.length === 0) return;

    // Удаляем параллельно
    await Promise.allSettled(photos.map(p => this.deletePhoto(p.id)));
  }

  /**
   * Отправить индикатор печати
   */
  setTyping(isTyping: boolean): void {
    this._isTyping.set(isTyping);

    const session = this._session();
    if (this.socket?.connected && session) {
      this.socket.emit('visitor:typing', {
        sessionId: session.id,
        isTyping
      });
    }
  }

  private clearChatState(): void {
    this._session.set(null);
    this._messages.set([]);
    this._activeButtons.set([]);
    this._orderStatus.set('none');
    this._orderNumber.set('');
    this._orderPrice.set(0);
    this._photoCopies.set([]);
    this._lockedPhotoIds.set([]);
  }

  handleSessionExpired(): void {
    this.disconnectSocket();
    this.clearChatState();
    this._sessionClosed.set(false);
    this._sessionExpired.set(true);
  }

  handleSessionClosed(): void {
    this.disconnectSocket();
    const session = this._session();
    if (session) {
      this._session.set({ ...session, status: 'closed' });
    }
    this._activeButtons.set([]);
    this._sessionExpired.set(false);
    this._sessionClosed.set(true);
  }

  private readNotificationPromptedFlag(): boolean {
    try {
      return localStorage.getItem(this.notificationPromptedKey) === '1';
    } catch {
      return false;
    }
  }

  private setNotificationPromptedFlag(): void {
    try {
      localStorage.setItem(this.notificationPromptedKey, '1');
    } catch { /* noop */ }
  }

  /** Закрыть баннер обновления без перезагрузки */
  clearUpdate(): void {
    this._updateAvailable.set(null);
  }

  /** Отписаться от push-уведомлений */
  async unsubscribeFromPush(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const session = this._session();
    if (!session) return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;

      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await firstValueFrom(this.http.request('DELETE', `${this.baseApiUrl}/chat/push/unsubscribe`, {
          body: { sessionId: session.id, endpoint: subscription.endpoint },
        }));
        await subscription.unsubscribe();
      }

      this.pushSubscriptionEndpoint = null;
      this.pushSubscriptionSessionId = null;
      this.pushSubscriptionFailureSessionId = null;
      this.pushSubscriptionRetryAfter = 0;
      this._pushSubscribed.set(false);
    } catch (error) {
      this.log.error('[Chat] Error unsubscribing from push:', error);
    }
  }

  /** Очистить историю чата */
  async deleteMessage(messageId: string): Promise<void> {
    const session = this._session();
    if (!session) return;
    // Optimistic removal
    this._messages.update(msgs => msgs.filter(m => m.id !== messageId));
    try {
      await firstValueFrom(this.http.request('DELETE',
        `${this.baseApiUrl}/chat/sessions/${session.id}/messages/${messageId}`, {
          body: { visitorId: this.visitorId },
        }));
    } catch (error) {
      this.log.error('Error deleting message:', error);
    }
  }


  requestNotifications(): Promise<NotificationPermission | null> {
    return this.forceRequestNotifications();
  }

  async requestNotificationsAfterPayment(delayMs = 5000): Promise<NotificationPermission | null> {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (!('Notification' in window)) return null;
    if (this.notificationPrompted) return Notification.permission;

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (this.notificationPrompted) return Notification.permission;
    return this.forceRequestNotifications();
  }

  private async forceRequestNotifications(): Promise<NotificationPermission | null> {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (!('Notification' in window)) return null;

    if (Notification.permission !== 'default') {
      this._notificationPermission.set(Notification.permission);
      if (Notification.permission === 'granted') {
        await this.ensureChatPushSubscription().catch(() => { /* noop */ });
      }
      return Notification.permission;
    }

    this.notificationPrompted = true;
    this.setNotificationPromptedFlag();

    try {
      const permission = await Notification.requestPermission();
      this._notificationPermission.set(permission);
      if (permission === 'granted') {
        await this.ensureChatPushSubscription().catch(() => { /* noop */ });
      }
      return permission;
    } catch {
      return Notification.permission;
    }
  }

  private async ensureChatPushSubscription(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.swPush.isEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const session = this._session();
    if (!session) return;

    if (this.pushSubscriptionSessionId === session.id && this.pushSubscriptionEndpoint) {
      return;
    }

    if (
      this.pushSubscriptionFailureSessionId === session.id
      && Date.now() < this.pushSubscriptionRetryAfter
    ) {
      return;
    }

    if (this.pushSubscriptionInFlight) {
      await this.pushSubscriptionInFlight;
      return;
    }

    this.pushSubscriptionInFlight = (async () => {
      try {
        const publicKey = await this.fetchVapidPublicKey();
        if (!publicKey) return;

        const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
        const keys = subscription.toJSON().keys;
        const p256dh = keys?.['p256dh'];
        const auth = keys?.['auth'];
        if (!p256dh || !auth) return;

        await firstValueFrom(this.http.post<{ success: boolean }>(`${this.visitorPushApiUrl}/subscribe`, {
          sessionId: session.id,
          subscription: {
            endpoint: subscription.endpoint,
            keys: { p256dh, auth },
          },
          userAgent: navigator.userAgent,
          pageUrl: window.location.href,
        }));

        this.pushSubscriptionEndpoint = subscription.endpoint;
        this.pushSubscriptionSessionId = session.id;
        this.pushSubscriptionFailureSessionId = null;
        this.pushSubscriptionRetryAfter = 0;
        this._pushSubscribed.set(true);
      } catch (error) {
        this.pushSubscriptionFailureSessionId = session.id;
        this.pushSubscriptionRetryAfter = Date.now() + this.pushSubscriptionFailureCooldownMs;
        this._pushSubscribed.set(false);
        throw error;
      }
    })().finally(() => {
      this.pushSubscriptionInFlight = null;
    });

    await this.pushSubscriptionInFlight;
  }

  private async fetchVapidPublicKey(): Promise<string | null> {
    if (this.cachedVapidPublicKey) return this.cachedVapidPublicKey;

    try {
      const response = await firstValueFrom(this.http.get<{ success: boolean; publicKey?: string }>(
        `${this.visitorPushApiUrl}/vapid-public-key`
      ));
      const key = response?.publicKey;
      if (!key) return null;
      this.cachedVapidPublicKey = key;
      return key;
    } catch {
      return null;
    }
  }

  private maybeNotifyOperatorReply(message: ChatMessage): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const shouldNotify = document.hidden || !this._isOpen();
    if (!shouldNotify) return;

    const body = this.formatNotificationBody(message);
    const title = message.sender_name || 'Своё Фото';

    const notification = new Notification(title, {
      body,
      icon: this.notificationIconUrl,
      tag: `sf-chat-${message.session_id}`,
    });

    notification.onclick = () => {
      window.focus();
    };
  }

  private formatNotificationBody(message: ChatMessage): string {
    let body = message.content;

    if (message.message_type === 'image') {
      body = '📷 Новое фото';
    } else if (message.message_type === 'file') {
      body = '📎 Новый файл';
    } else if (message.message_type === 'video') {
      body = '🎬 Новое видео';
    } else if (!body) {
      body = 'Новое сообщение';
    }

    return this.truncateNotificationText(body, this.notificationBodyMaxLength);
  }

  private truncateNotificationText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  /**
   * Подключение к WebSocket (lazy-load socket.io-client).
   * Auth-only: JWT передаётся явно в Socket.IO auth; cookie остаётся резервным каналом.
   */
  private connectWebSocket(sessionId: string): void {
    if (this.socket?.connected) {
      // Backend делает room join server-side из JWT в handshake
      return;
    }

    if (!this.authService.isAuthenticated()) {
      this.log.warn('WS connect skipped: not authenticated');
      return;
    }

    const token = this.authService.getAccessTokenSync();
    if (!token) {
      this.log.warn('WS connect skipped: no authentication token');
      return;
    }
    const refreshToken = this.authService.getRefreshTokenValue();

    // Empty endpoint keeps same-origin polling; configured endpoint enables WebSocket-first routing.
    const wsEndpoint = getSocketIoEndpoint(environment.wsUrl);
    const transports = getSocketIoTransports(environment.wsUrl);

    // Lazy-load socket.io-client: используем предзагруженный модуль если есть
    const initSocket = ({ io }: typeof import('socket.io-client')) => {
      const options = {
        auth: {
          token,
          refreshToken,
          appVersion: APP_VERSION,
        },
        withCredentials: true,
        transports,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      };
      this.socket = wsEndpoint ? io(wsEndpoint, options) : io(options);

      this.socket.on('connect', () => {
        this.log.debug('Visitor chat connected');
        this._isConnected.set(true);
        // Backend server-side делает socket.join из JWT — клиент НЕ emit-ит visitor:join
        // Acknowledge delivery for messages loaded from history
        this.ackDeliveredMessages();
        // Fetch delivery statuses missed while disconnected
        this.requestMissedDeliveryStatuses(sessionId);
      });

      this.socket.on('disconnect', () => {
        this.log.debug('Visitor chat disconnected');
        this._isConnected.set(false);
      });

      this.socket.on('connect_error', (err: Error) => {
        const code = extractWsErrorCode(err);
        if (isSessionClosedCode(code)) {
          this.log.warn('Visitor chat session closed via WS');
          this.handleSessionClosed();
          return;
        }
        if (isSessionExpiredCode(code)) {
          this.log.warn('Visitor chat session expired via WS');
          this.handleSessionExpired();
          return;
        }
        this.log.warn('Visitor chat connect error:', err.message);
      });

      // Обнаружение устаревшей версии клиента
      this.socket.on('app:update-available', (data: { currentVersion: string; latestVersion: string }) => {
        this.log.info(`App update available: ${data.currentVersion} → ${data.latestVersion}`);
        // Если пользователь уже перезагружался для этой версии — не показывать баннер повторно
        const dismissedKey = `update-dismissed-${data.latestVersion}`;
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dismissedKey)) {
          return;
        }
        this._updateAvailable.set(data);
      });

      this.socket.on('auth:token-refreshed', (data: { token: string }) => {
        this.log.debug('Received refreshed chat token');
        this.authService.updateToken(data.token);
        if (this.socket) {
          this.socket.auth = {
            token: data.token,
            refreshToken: this.authService.getRefreshTokenValue(),
            appVersion: APP_VERSION,
          };
        }
      });

    // Получение сообщения от оператора
    this.socket.on('operator:message', (data: {
      sessionId: string;
      content: string;
      senderName: string;
      senderType: 'operator' | 'bot';
      timestamp: Date;
      id?: string;
      messageType?: 'text' | 'image' | 'file' | 'system' | 'interactive';
      attachmentUrl?: string | null;
      interactive?: BotInteractive | null;
      metadata?: ChatMessageMetadata | string | null;
    }) => {
      const incomingInteractive = data.interactive ?? undefined;
      const hasDbId = !!data.id && !data.id.startsWith('ws-');
      const newMessage: ChatMessage = {
        id: data.id || `ws-${Date.now()}`,
        session_id: data.sessionId,
        sender_type: data.senderType,
        sender_name: data.senderName,
        message_type: data.messageType || (incomingInteractive ? 'interactive' : 'text'),
        content: data.content,
        attachment_url: data.attachmentUrl ?? undefined,
        interactive: incomingInteractive || undefined,
        metadata: data.metadata ?? null,
        created_at: new Date(data.timestamp),
      };

      this._messages.update(msgs => {
        // Exact id dedup
        if (msgs.some(message => message.id === newMessage.id)) {
          return msgs;
        }

        // If this is a DB message (has real id), check for matching ws-* temp message
        // and replace it to avoid duplicates
        if (hasDbId) {
          const tempIdx = msgs.findIndex(m =>
            m.id?.startsWith('ws-') &&
            m.content === newMessage.content &&
            m.sender_type === newMessage.sender_type &&
            Math.abs(new Date(m.created_at).getTime() - new Date(newMessage.created_at).getTime()) < 5000
          );
          if (tempIdx >= 0) {
            const updated = [...msgs];
            updated[tempIdx] = newMessage;
            return updated;
          }
        }

        return [...msgs, newMessage];
      });

      // Подтверждение доставки
      if (data.id && this.socket) {
        this.socket.emit('message:delivered', { sessionId: data.sessionId, messageIds: [data.id] });
        // Если чат открыт — сразу подтверждаем прочтение
        if (this._isOpen()) {
          this.socket.emit('message:read', { sessionId: data.sessionId, messageIds: [data.id] });
        }
      }

      // Увеличиваем счётчик непрочитанных, если чат закрыт
      if (!this._isOpen()) {
        this._unreadCount.update(n => n + 1);
      }

      if (newMessage.interactive) {
        this.autoAddToCartIfConfirmed(newMessage);
      }

      // Обновляем кнопки и статус заказа из бот-сообщений
      if (newMessage.sender_type === 'bot') {
        this.extractActiveButtons(newMessage);
        this.updateOrderStatusFromMessage(newMessage);
      }

      if (newMessage.sender_type === 'operator' || newMessage.sender_type === 'bot') {
        this.maybeNotifyOperatorReply(newMessage);
      }
    });

    // Оператор печатает
    this.socket.on('operator:typing', (data: { isTyping: boolean }) => {
      this._operatorTyping.set(data.isTyping);
    });

    // Оператор обновил корзину
    this.socket.on('operator:cart-update', (data: { sessionId: string; items: unknown[] }) => {
      if (isPlatformBrowser(this.platformId)) {
        window.dispatchEvent(new CustomEvent('cart:syncFromServer', { detail: data.items }));
      }
    });

    // Статус доставки/прочтения от оператора (seen indicator)
    this.socket.on('message:status-update', (data: { messageIds?: string[]; clientMessageIds?: string[]; status: RawMessageDeliveryStatus }) => {
      const status = this.normalizeDeliveryStatus(data.status);
      if (!status) return;
      const idSet = new Set(data.messageIds ?? []);
      const clientIdSet = new Set(data.clientMessageIds ?? []);
      if (idSet.size === 0 && clientIdSet.size === 0) return;
      this._messages.update(msgs =>
        msgs.map(m => idSet.has(m.id) || (m.client_message_id ? clientIdSet.has(m.client_message_id) : false)
          ? { ...m, delivery_status: status }
          : m)
      );
    });

    // Real-time payment confirmation — update card instantly without waiting for bot message
    this.socket.on('order:paid', (data: { orderId: string; amount: number }) => {
      this.log.info('Order paid via socket', data);
      this._orderStatus.set('processing');
      this.lockCurrentPhotos();
      if (data.orderId && !this._paidOrderIds().includes(data.orderId)) {
        this._paidOrderIds.update(ids => [...ids, data.orderId]);
      }
    });

    this.socket.on('message:deleted', (data: { messageId: string }) => {
      this._messages.update(msgs => msgs.filter(m => m.id !== data.messageId));
    });
    };

    if (this._socketIOModule) {
      initSocket(this._socketIOModule);
    } else {
      // Используем уже запущенную предзагрузку если есть, иначе стартуем новую
      const loadPromise = this._socketIOPreloadPromise
        || import('socket.io-client').then(mod => { this._socketIOModule = mod; });
      loadPromise
        .then(() => { if (this._socketIOModule) initSocket(this._socketIOModule); })
        .catch((err) => { this.log.error('Failed to load socket.io-client:', err); });
    }
  }

  /**
   * Отправить обновление корзины на сервер
   */
  emitCartUpdate(items: unknown[]): void {
    const session = this._session();
    if (this.socket?.connected && session) {
      this.socket.emit('visitor:cart-update', { sessionId: session.id, items });
    }
  }

  /**
   * Отключение от WebSocket
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._isConnected.set(false);
  }

  /**
   * Auth-only: после OAuth/login подтягиваем текущую conversation через GET /chat/sessions/current.
   * Backend сам создаст или вернёт существующую conv для authenticated user.
   */
  async linkUserAfterAuth(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    await this._doRestoreSession();
  }

  /**
   * Сбросить счётчик непрочитанных
   */
  /** Acknowledge delivery for all operator messages loaded from history */
  private ackDeliveredMessages(): void {
    const sessionId = this._session()?.id;
    if (!this.socket || !sessionId) return;
    const undeliveredIds = this._messages()
      .filter(m => (m.sender_type === 'operator' || m.sender_type === 'bot') && m.id && !m.id.startsWith('ws-'))
      .map(m => m.id);
    if (undeliveredIds.length) {
      this.socket.emit('message:delivered', { sessionId, messageIds: undeliveredIds });
    }
  }

  private requestMissedDeliveryStatuses(sessionId: string): void {
    const pendingIds = this._messages()
      .filter(m => m.sender_type === 'visitor' && m.client_message_id && (m.delivery_status === 'sent' || m.delivery_status === 'sending' || m.delivery_status === 'pending'))
      .map(m => m.client_message_id!);
    if (pendingIds.length === 0) return;
    firstValueFrom(this.http.post<DeliveryStatusesResponse>(`${this.baseApiUrl}/chat/sessions/${sessionId}/delivery-statuses`, {
      clientMessageIds: pendingIds,
    })).then(res => {
      if (!res?.success) return;
      const statuses = this.normalizeDeliveryStatuses(res.data);
      if (statuses.length === 0) return;
      const statusMap = new Map(statuses.map(s => [s.clientMessageId, s.status]));
      this._messages.update(msgs => msgs.map(m => {
        if (!m.client_message_id) return m;
        const newStatus = statusMap.get(m.client_message_id);
        if (!newStatus || newStatus === m.delivery_status) return m;
        return { ...m, delivery_status: newStatus };
      }));
    }).catch(() => { /* noop — best effort */ });
  }

  private normalizeDeliveryStatus(status: RawMessageDeliveryStatus | null | undefined): MessageDeliveryStatus | null {
    if (!status) return null;
    if (status === 'accepted') return 'sent';
    return status;
  }

  private normalizeDeliveryStatuses(data: DeliveryStatusesResponse['data']): { clientMessageId: string; status: MessageDeliveryStatus }[] {
    const rows = Array.isArray(data) ? data : data?.statuses;
    if (!Array.isArray(rows)) return [];

    const normalized: { clientMessageId: string; status: MessageDeliveryStatus }[] = [];
    for (const row of rows) {
      const clientMessageId = row.clientMessageId ?? row.client_message_id;
      const status = this.normalizeDeliveryStatus(row.status ?? row.delivery_status);
      if (clientMessageId && status) {
        normalized.push({ clientMessageId, status });
      }
    }
    return normalized;
  }

  markAsRead(): void {
    this._unreadCount.set(0);

    // Send read receipts for all unread operator/bot messages
    const unreadIds = this._messages()
      .filter(m => (m.sender_type === 'operator' || m.sender_type === 'bot') && !m.is_read && m.id && !m.id.startsWith('ws-'))
      .map(m => m.id);
    if (!unreadIds.length) return;

    this._messages.update(msgs => msgs.map(m =>
      unreadIds.includes(m.id) ? { ...m, is_read: true } : m
    ));

    const sessionId = this._session()?.id;
    if (this.socket?.connected && sessionId) {
      this.socket.emit('message:read', { sessionId, messageIds: unreadIds });
    } else if (sessionId) {
      // HTTP fallback when WebSocket is not connected
      this.http.post(`${this.baseApiUrl}/chat/sessions/${sessionId}/read`, {}).subscribe();
    }
  }
}
