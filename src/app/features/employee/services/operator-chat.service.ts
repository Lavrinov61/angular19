import { Injectable, inject, signal, computed, effect, untracked, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WebSocketService, type MediaReadyEvent, type PaymentLinkEventPayload } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { InboxService } from './inbox.service';
import { deferMicrotask, deferIdle } from '../../../shared/utils/defer';
import { isBrowserPreviewableImage } from '../../../shared/utils/file-helpers';
import { safeStartsWith } from '../../../shared/utils/safe-string';
import { hasRealMediaCaption } from '../utils/chat-caption.util';

export interface OperatorChatSession {
  id: string;
  visitor_id: string;
  visitor_name: string | null;
  visitor_phone: string | null;
  selected_service: string | null;
  page_url: string | null;
  channel: string;
  status: 'open' | 'waiting' | 'active' | 'resolved' | 'closed';
  assigned_operator_id: string | null;
  assigned_operator_name: string | null;
  last_message_at: string | null;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  message_count: number;
  last_message: string | null;
  csat_score: number | null;
  csat_comment: string | null;
  // Client/booking linking
  contact_id: string | null;
  user_id: string | null;
  booking_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_last_seen_at: string | null;
  client_purchases_count: number;
  booking_service: string | null;
  booking_date: string | null;
  booking_status: string | null;
  metadata?: Record<string, unknown> | null;
  // Ownership / privacy (chat-ownership-v1)
  is_private: boolean;
  private_owner_id?: string | null;
  // AI-агент (этап 2)
  ai_agent_mode?: 'off' | 'bot' | 'operator' | null;
}

export interface SuggestedClient {
  id: string;
  name: string;
  phone: string | null;
  bookings_count: number;
  match_type?: 'user_id' | 'phone';
}

export interface SuggestedBooking {
  id: string;
  service_name: string | null;
  start_time: string;
  status: string;
}

export interface ReactionUser {
  userId: string;
  userName: string;
}

export type OperatorMessageDeliveryStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageReactions = Record<string, ReactionUser[]>;

export interface OperatorMessageMetadata {
  reactions?: MessageReactions;
  edited?: boolean;
  payment?: {
    orderId?: string;
    amount?: number;
    status?: string;
    source?: string | null;
    method?: string | null;
    methodLabel?: string | null;
    paidAt?: string | null;
    receiptId?: string | null;
    receiptNumber?: string | null;
    orderRef?: string | null;
    paymentLinkId?: string | null;
    items?: { name: string; price: number }[];
  };
  interactive?: {
    type: string;
    sessionId?: string;
    photos?: { id: string; status: string; thumbnailUrl?: string; retouchedUrl?: string; variants?: { thumbnailUrl?: string }[] }[];
    buttons?: {
      id: string;
      label?: string;
      value?: string;
      url?: string;
      color?: string;
      data?: {
        orderId?: string;
        paymentLinkId?: string;
        orderRef?: string;
        amount?: number;
        price?: number;
        description?: string;
      };
    }[];
    approvalAction?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OperatorChatMessage {
  id: string;
  session_id: string;
  sender_type: 'visitor' | 'operator' | 'bot' | 'system' | 'internal_note';
  sender_name: string | null;
  message_type: 'text' | 'image' | 'file' | 'video' | 'audio' | 'system' | 'interactive';
  content: string;
  attachment_url: string | null;
  created_at: string;
  is_read: boolean;
  delivered_at?: string | null;
  read_at?: string | null;
  delivery_status?: OperatorMessageDeliveryStatus | string | null;
  // Forward / Reply-to
  reply_to_message_id?: string | null;
  reply_to_content?: string | null;
  reply_to_sender_name?: string | null;
  is_forwarded?: boolean;
  forwarded_from_name?: string | null;
  metadata?: OperatorMessageMetadata | null;
  // Pin
  pinned_at?: string | null;
  pinned_by?: string | null;
  // File metadata from media_attachments (joined in GET messages)
  original_file_name?: string | null;
  original_mime_type?: string | null;
  /** All media attachments for this message (json_agg from media_attachments) */
  all_media?: { url: string; file_name: string | null; mime_type: string | null }[] | null;
}

export interface ScheduledMessage {
  id: string;
  content: string;
  send_at: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  created_by: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  creator_name: string | null;
}

/**
 * Unified-timeline activity item (read-side, never written to `messages`).
 * ЗАМОРОЖЕННЫЙ КОНТРАКТ — серверный JSON совпадает с этим типом один-в-один.
 * Сервер возвращает `activityItems` ТОЛЬКО на initial load (без before/after/around).
 * `kind:'activity'` — дискриминатор против OperatorChatMessage (у того поля kind нет).
 */
export interface ActivityItem {
  kind: 'activity';
  id: string;
  activity_type: 'booking' | 'order' | 'pos_receipt' | 'subscription' | 'call' | 'loyalty';
  created_at: string;
  title: string;
  detail: string | null;
  amount: number | null;
  status: string | null;
}

/** Элемент единой ленты: либо обычное сообщение, либо плашка активности. */
export type FeedItem = OperatorChatMessage | ActivityItem;

/** Type-guard: activity-плашка (есть kind==='activity'), а не сообщение. */
export function isActivityItem(item: FeedItem): item is ActivityItem {
  return (item as Partial<ActivityItem>).kind === 'activity';
}

function isOperatorChatMessage(val: unknown): val is OperatorChatMessage {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return typeof obj['id'] === 'string' && typeof obj['session_id'] === 'string' && typeof obj['content'] === 'string';
}

/** Минимальная валидация одного ActivityItem из ответа сервера (defensive — игнорируем мусор). */
function isValidActivityItem(val: unknown): val is ActivityItem {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return obj['kind'] === 'activity'
    && typeof obj['id'] === 'string'
    && typeof obj['activity_type'] === 'string'
    && typeof obj['created_at'] === 'string'
    && typeof obj['title'] === 'string';
}

function sanitizeActivityItems(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidActivityItem);
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = Reflect.get(error, 'status');
  return typeof status === 'number' ? status : undefined;
}

interface MessageCache {
  messages: OperatorChatMessage[];
  previousMessages?: OperatorChatMessage[];
  /** Activity-плашки, собранные сервером на initial load (read-side). */
  activityItems?: ActivityItem[];
  hasOlder: boolean;
  hasNewer: boolean;
  totalCount: number;
  lastAccessed: number;
}

interface PaginatedResponse {
  success: boolean;
  data: OperatorChatMessage[];
  previousMessages?: OperatorChatMessage[];
  /** Присутствует ТОЛЬКО на initial load (не при пагинации before/after/around). */
  activityItems?: ActivityItem[];
  hasOlder: boolean;
  hasNewer: boolean;
  totalCount: number;
}

/** Per-message rendering metadata. Kept here to avoid O(N²) recompute in chat-detail. */
export interface MessagesMetaItem {
  msg: OperatorChatMessage;
  showDate: boolean;
  grouped: boolean;
  lastInGroup: boolean;
  mediaGroupStart: boolean;
  mediaGroupItems: OperatorChatMessage[] | null;
  skipRender: boolean;
}

const MSG_GROUP_GAP_MS = 120_000;
const MEDIA_GROUP_GAP_MS = 5 * 60_000;
const MAX_PENDING_MEDIA_READY_EVENTS = 200;

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function isVisualImage(msg: OperatorChatMessage): boolean {
  return (msg.message_type === 'image' || msg.message_type === 'file')
    && isBrowserPreviewableImage(msg.attachment_url, msg.original_mime_type);
}

function isOperatorMessageType(value: string | null | undefined): value is OperatorChatMessage['message_type'] {
  switch (value) {
    case 'text':
    case 'image':
    case 'file':
    case 'video':
    case 'audio':
    case 'system':
    case 'interactive':
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(source: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function readBooleanField(source: Record<string, unknown> | undefined, ...keys: string[]): boolean | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function readIncomingSenderType(
  dbRow: Record<string, unknown> | undefined,
  eventRow: Record<string, unknown> | undefined,
): OperatorChatMessage['sender_type'] {
  const value = readStringField(dbRow, 'sender_type', 'senderType')
    ?? readStringField(eventRow, 'sender_type', 'senderType');
  switch (value) {
    case 'operator':
    case 'bot':
    case 'system':
    case 'internal_note':
      return value;
    default:
      return 'visitor';
  }
}

function readIncomingMessageType(
  dbRow: Record<string, unknown> | undefined,
  eventRow: Record<string, unknown> | undefined,
  fallback: OperatorChatMessage['message_type'] = 'text',
): OperatorChatMessage['message_type'] {
  const value = readStringField(eventRow, 'messageType', 'message_type')
    ?? readStringField(dbRow, 'message_type', 'messageType');
  return isOperatorMessageType(value) ? value : fallback;
}

function readIncomingMetadata(
  dbRow: Record<string, unknown> | undefined,
  eventRow: Record<string, unknown> | undefined,
): OperatorMessageMetadata | null {
  const raw = dbRow?.['metadata'] ?? eventRow?.['metadata'];
  if (isRecord(raw)) return normalizePaymentLinkPaymentMetadata(raw);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? normalizePaymentLinkPaymentMetadata(parsed) : null;
  } catch {
    return null;
  }
}

function normalizePaymentLinkPaymentMetadata(metadata: OperatorMessageMetadata | null | undefined): OperatorMessageMetadata | null {
  if (!metadata) return null;
  const payment = metadata.payment;
  const source = typeof payment?.source === 'string' ? payment.source.trim().toLowerCase() : null;
  if (!payment || source !== 'payment_link') return metadata;
  if (payment.method === 'online') return metadata;
  return {
    ...metadata,
    payment: {
      ...payment,
      method: 'online',
    },
  };
}

function normalizePaymentLinkPaymentMessage(message: OperatorChatMessage): OperatorChatMessage {
  const metadata = normalizePaymentLinkPaymentMetadata(message.metadata);
  return metadata === (message.metadata ?? null) ? message : { ...message, metadata };
}

function normalizePaymentLinkPaymentMessages(messages: readonly OperatorChatMessage[]): OperatorChatMessage[] {
  return messages.map(normalizePaymentLinkPaymentMessage);
}

function hasRealCaption(msg: OperatorChatMessage): boolean {
  return hasRealMediaCaption(msg.content);
}

@Injectable({
  providedIn: 'root'
})
export class OperatorChatService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly inboxService = inject(InboxService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly log = inject(LoggerService).createChild('OperatorChat');

  // State
  private readonly _sessions = signal<OperatorChatSession[]>([]);
  private readonly _activeSessionId = signal<string | null>(null);
  private readonly _messages = signal<OperatorChatMessage[]>([]);
  private readonly _messagesMeta = signal<MessagesMetaItem[]>([]);
  private _mediaGroupTail: { firstIdx: number; count: number; lastCreatedAt: string; senderType: OperatorChatMessage['sender_type'] } | null = null;
  private readonly _previousMessages = signal<OperatorChatMessage[]>([]);
  // Unified-timeline: activity-плашки текущего диалога (read-side, initial load only)
  private readonly _activityItems = signal<ActivityItem[]>([]);
  private readonly _loading = signal(false);
  private readonly _messagesLoading = signal(false);
  private readonly _statusFilter = signal<string>('open');
  private readonly _visitorTypingMap = signal<ReadonlyMap<string, boolean>>(new Map<string, boolean>());
  private readonly _operatorTypingMap = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _sessionNotFound = signal(false);

  // Collision detection: who's viewing which chat
  private readonly _viewersMap = signal<ReadonlyMap<string, { operatorId: string; operatorName: string }>>(new Map());

  // Pagination state
  readonly hasOlder = signal(true);
  readonly loadingOlder = signal(false);
  readonly totalMessageCount = signal(0);

  // LRU message cache (max 20 sessions, full conversation per session)
  private readonly messageCache = new Map<string, MessageCache>();
  private readonly pendingMediaReadyEvents = new Map<string, MediaReadyEvent>();
  private readonly MAX_CACHE_SIZE = 20;
  private readonly MAX_CACHED_MESSAGES = 2000;

  // Public readonly
  readonly sessions = this._sessions.asReadonly();
  readonly activeSessionId = this._activeSessionId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly messagesMeta = this._messagesMeta.asReadonly();
  readonly previousMessages = this._previousMessages.asReadonly();
  readonly activityItems = this._activityItems.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly messagesLoading = this._messagesLoading.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly sessionNotFound = this._sessionNotFound.asReadonly();

  readonly activeSession = computed(() => {
    const id = this._activeSessionId();
    return id ? this._sessions().find(s => s.id === id) ?? null : null;
  });

  readonly visitorIsTyping = computed(() => {
    const id = this._activeSessionId();
    return id ? (this._visitorTypingMap().get(id) ?? false) : false;
  });

  readonly operatorTypingForSession = computed(() => {
    const id = this._activeSessionId();
    return id ? (this._operatorTypingMap().get(id) ?? null) : null;
  });

  readonly sessionCount = computed(() => this._sessions().length);

  /** Who else is currently viewing the active chat (collision detection) */
  readonly currentChatViewers = computed(() => {
    const id = this._activeSessionId();
    if (!id) return null;
    const viewer = this._viewersMap().get(id);
    // Don't show self
    const myId = this.authService.currentUser()?.id;
    return viewer && viewer.operatorId !== myId ? viewer : null;
  });

  // Sound mute toggle (persisted in localStorage)
  private readonly _soundMuted = signal(false);
  readonly soundMuted = this._soundMuted.asReadonly();

  private wsInitialized = false;
  private visitorTypingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _audioCtx: AudioContext | null = null;

  constructor() {
    // Restore sound mute preference
    if (isPlatformBrowser(this.platformId)) {
      try { this._soundMuted.set(localStorage.getItem('chat-sound-muted') === 'true'); } catch { /* */ }
    }

    // Request notification permission on first user interaction
    if (isPlatformBrowser(this.platformId) && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      document.addEventListener('click', () => {
        Notification.requestPermission();
      }, { once: true });
    }
    // ── Receiver effects for visitor:new-message ──
    //
    // The old monolithic effect did session reorder, message append, unread
    // clearing, sound and desktop notification all synchronously on the
    // reactive tick. That blocked the main thread by ~30–150ms per event and
    // caused freezes on the receiver side. We split it into three small
    // effects with a single reactive read each: session reorder (E1), message
    // append + incremental meta (E2), side-effects dispatcher (E3) which is
    // deferred via microtask / requestIdleCallback so it never blocks
    // rendering.

    // E1: session list rearrange + new-session placeholder
    effect(() => {
      const msg = this.wsService.visitorNewMessage();
      if (!msg) return;

      untracked(() => {
        const decision = this.interpretVisitorMessage(msg);
        if (decision === 'skip' || decision === 'echo-no-session') return;
        const wsSession = (msg as Record<string, unknown>)['session'] as Record<string, unknown> | undefined;

        // Update session list — move to top, bump counters
        let shouldReloadSessions = false;
        this._sessions.update(sessions => {
          const idx = sessions.findIndex(s => s.id === msg.sessionId);
          if (idx >= 0) {
            const sessionPatch = wsSession ? {
              visitor_name: (wsSession['visitorName'] as string) || sessions[idx].visitor_name,
              visitor_phone: (wsSession['visitorPhone'] as string) || sessions[idx].visitor_phone,
              channel: (wsSession['channel'] as string) || sessions[idx].channel,
              status: ((wsSession['status'] as string) || sessions[idx].status) as OperatorChatSession['status'],
              assigned_operator_id: (wsSession['assignedOperatorId'] as string) || sessions[idx].assigned_operator_id,
              assigned_operator_name: (wsSession['assignedOperatorName'] as string) || sessions[idx].assigned_operator_name,
              contact_id: (wsSession['contactId'] as string) || sessions[idx].contact_id,
              user_id: (wsSession['userId'] as string) || sessions[idx].user_id,
              client_name: (wsSession['clientName'] as string) || sessions[idx].client_name,
              client_phone: (wsSession['clientPhone'] as string) || sessions[idx].client_phone,
              client_last_seen_at: (wsSession['clientLastSeenAt'] as string) || sessions[idx].client_last_seen_at,
            } : {};
            const updated = decision === 'echo'
              ? { ...sessions[idx], ...sessionPatch, last_message: msg.content, last_message_at: new Date(msg.timestamp).toISOString() }
              : { ...sessions[idx], ...sessionPatch, last_message: msg.content, last_message_at: new Date(msg.timestamp).toISOString(), message_count: sessions[idx].message_count + 1 };
            return [updated, ...sessions.filter((_, i) => i !== idx)];
          }
          if (decision === 'echo') return sessions;

          if (wsSession) {
            const placeholder: OperatorChatSession = {
              id: msg.sessionId,
              visitor_id: (msg as Record<string, unknown>)['visitorId'] as string || '',
              visitor_name: (wsSession['visitorName'] as string) || null,
              visitor_phone: (wsSession['visitorPhone'] as string) || null,
              selected_service: null,
              page_url: null,
              channel: (wsSession['channel'] as string) || 'web',
              status: ((wsSession['status'] as string) || 'open') as OperatorChatSession['status'],
              assigned_operator_id: (wsSession['assignedOperatorId'] as string) || null,
              assigned_operator_name: (wsSession['assignedOperatorName'] as string) || null,
              last_message_at: new Date(msg.timestamp).toISOString(),
              created_at: new Date(msg.timestamp).toISOString(),
              first_response_at: null,
              resolved_at: null,
              message_count: 1,
              last_message: msg.content,
              csat_score: null,
              csat_comment: null,
              contact_id: (wsSession['contactId'] as string) || null,
              user_id: (wsSession['userId'] as string) || null,
              booking_id: null,
              client_name: (wsSession['clientName'] as string) || null,
              client_phone: (wsSession['clientPhone'] as string) || null,
              client_last_seen_at: (wsSession['clientLastSeenAt'] as string) || null,
              client_purchases_count: 0,
              booking_service: null,
              booking_date: null,
              booking_status: null,
              is_private: false,
              private_owner_id: null,
            };
            shouldReloadSessions = true;
            return [placeholder, ...sessions];
          }
          shouldReloadSessions = true;
          return sessions;
        });
        if (shouldReloadSessions) this.loadSessions();
      });
    });

    // E2: append message to active session (+ incremental messagesMeta)
    effect(() => {
      const msg = this.wsService.visitorNewMessage();
      if (!msg) return;

      untracked(() => {
        if (msg.sessionId !== this._activeSessionId()) return;

        const eventRow = isRecord(msg) ? msg : undefined;
        const dbRow = isRecord(msg.message) ? msg.message : undefined;
        const dbId = readStringField(dbRow, 'id', 'messageId')
          ?? readStringField(eventRow, 'messageId', 'id');
        const senderType = readIncomingSenderType(dbRow, eventRow);
        const messageType = readIncomingMessageType(dbRow, eventRow);
        const messageId = dbId || `ws-${Date.now()}`;

        // Dedup by DB id
        if (dbId && this._messages().some(m => m.id === dbId)) return;

        // Replace temp-*/ws-* with real DB id if same content + sender_type
        if (dbId) {
          const existing = this._messages().find(m =>
            (safeStartsWith(m.id, 'ws-') || safeStartsWith(m.id, 'temp-')) &&
            m.content === msg.content &&
            m.sender_type === senderType
          );
          if (existing) {
            const updatedExisting = this.applyPendingMediaReady(normalizePaymentLinkPaymentMessage({
              ...existing,
              id: dbId,
              attachment_url: msg.attachmentUrl || readStringField(dbRow, 'attachment_url', 'attachmentUrl') || null,
              message_type: readIncomingMessageType(dbRow, eventRow, existing.message_type),
            }));
            this._messages.update(msgs => msgs.map(m => m.id === existing.id ? updatedExisting : m));
            // Rebuild meta: id/attachment/message_type can change grouping
            this.rebuildMessagesMeta(this._messages());
            return;
          }
        }

        const newMsg = this.applyPendingMediaReady(normalizePaymentLinkPaymentMessage({
          id: messageId,
          session_id: msg.sessionId,
          sender_type: senderType,
          sender_name: readStringField(dbRow, 'sender_name', 'senderName')
            ?? readStringField(eventRow, 'senderName', 'sender_name')
            ?? null,
          message_type: messageType,
          content: msg.content,
          attachment_url: msg.attachmentUrl || readStringField(dbRow, 'attachment_url', 'attachmentUrl') || null,
          created_at: new Date(msg.timestamp).toISOString(),
          is_read: false,
          is_forwarded: readBooleanField(eventRow, 'is_forwarded', 'isForwarded')
            ?? readBooleanField(dbRow, 'is_forwarded', 'isForwarded')
            ?? false,
          forwarded_from_name: readStringField(eventRow, 'forwarded_from_name', 'forwardedFromName')
            ?? readStringField(dbRow, 'forwarded_from_name', 'forwardedFromName')
            ?? null,
          reply_to_message_id: readStringField(eventRow, 'reply_to_message_id', 'replyToMessageId')
            ?? readStringField(dbRow, 'reply_to_message_id', 'replyToMessageId')
            ?? null,
          reply_to_content: readStringField(eventRow, 'reply_to_content', 'replyToContent')
            ?? readStringField(dbRow, 'reply_to_content', 'replyToContent')
            ?? null,
          reply_to_sender_name: readStringField(eventRow, 'reply_to_sender_name', 'replyToSenderName')
            ?? readStringField(dbRow, 'reply_to_sender_name', 'replyToSenderName')
            ?? null,
          metadata: readIncomingMetadata(dbRow, eventRow),
        }));
        if (this.replacePaymentLinkPaidSynthetic(newMsg)) return;
        if (this.applyPaidPaymentNotificationToExistingRequest(newMsg)) return;

        this._messages.update(msgs => [...msgs, newMsg]);
        this.appendMessageMeta(newMsg);

        // Sync to LRU cache
        const cached = this.messageCache.get(msg.sessionId);
        if (cached) {
          cached.messages = [...cached.messages, newMsg];
          cached.totalCount++;
          cached.lastAccessed = Date.now();
        }
      });
    });

    // Payment-link paid can arrive even if the chat-message broadcast is late.
    // Keep the active chat responsive by rendering the paid system card from
    // the payment event, then replace it with the DB message when it arrives.
    effect(() => {
      const evt = this.wsService.paymentLinkEvent();
      if (!evt || evt.event !== 'payment-link:paid') return;

      untracked(() => this.applyPaymentLinkPaidEvent(evt.data));
    });

    // E3: deferred side-effects (sounds, notifications, read markers)
    // Behaviour parity with the old monolithic effect: sound + desktop
    // notifications fire only when the message targets the currently active
    // session (operator is watching it), and only for visitor-sent messages.
    effect(() => {
      const msg = this.wsService.visitorNewMessage();
      if (!msg) return;

      untracked(() => {
        const decision = this.interpretVisitorMessage(msg);
        if (decision === 'skip') return;

        const isActive = msg.sessionId === this._activeSessionId();
        if (!isActive) return;

        const eventRow = isRecord(msg) ? msg : undefined;
        const dbRow = isRecord(msg.message) ? msg.message : undefined;
        const senderType = readIncomingSenderType(dbRow, eventRow);

        // Microtask — fast follow-up DB/state work off the reactive tick
        deferMicrotask(() => {
          this.inboxService.markItemRead(msg.sessionId);
          this.markVisitorMessagesRead(msg.sessionId);
        });

        // Idle — browser-level side effects that the UI doesn't wait on
        if (senderType === 'visitor') {
          if (!this._soundMuted()) {
            deferIdle(() => this.playNotificationSound());
          }
          deferIdle(() => this.showDesktopNotification(msg, {
            id: '',
            session_id: msg.sessionId,
            sender_type: senderType,
            sender_name: readStringField(dbRow, 'sender_name', 'senderName')
              ?? readStringField(eventRow, 'senderName', 'sender_name')
              ?? null,
            message_type: 'text',
            content: msg.content,
            attachment_url: null,
            created_at: new Date(msg.timestamp).toISOString(),
            is_read: false,
          }));
        }
      });
    });

    // React to internal notes from other operators
    effect(() => {
      const evt = this.wsService.internalNoteEvent();
      if (!evt) return;

      if (evt.sessionId === untracked(() => this._activeSessionId()) && evt.message) {
        // Validate the message shape before using it
        const msg = evt.message;
        if (isOperatorChatMessage(msg)) {
          const normalizedMsg = normalizePaymentLinkPaymentMessage(msg);
          // Avoid duplicating our own optimistic messages
          const exists = untracked(() => this._messages()).some(m => m.id === normalizedMsg.id);
          if (!exists) {
            this._messages.update(msgs => [...msgs, normalizedMsg]);
          }
        }
      }
    });

    // React to media-ready events (async media processing complete)
    effect(() => {
      const evt = this.wsService.mediaReadyEvent();
      if (!evt) return;

      const applied = untracked(() => this.applyMediaReadyEvent(evt));
      if (!applied) {
        this.rememberPendingMediaReady(evt);
      }
    });

    // React to chat assignment changes (in-place update instead of full reload)
    effect(() => {
      const evt = this.wsService.chatAssignment();
      if (!evt) return;
      this._sessions.update(sessions => {
        const idx = sessions.findIndex(s => s.id === evt.sessionId);
        if (idx >= 0) {
          return sessions.map(s => s.id === evt.sessionId ? {
            ...s,
            assigned_operator_id: evt.operatorId ?? evt.toOperatorId ?? null,
            assigned_operator_name: evt.operatorName ?? null,
            ...(evt.event === 'assigned' ? { status: 'active' as const } : {}),
            ...(evt.event === 'unassigned' ? { assigned_operator_id: null, assigned_operator_name: null } : {}),
          } : s);
        }
        // New session not in list — reload
        this.loadSessions();
        return sessions;
      });
    });

    // Chat-ownership-v1: privacy flag changed → update in-place
    effect(() => {
      const evt = this.wsService.chatPrivacyChanged();
      if (!evt) return;
      this._sessions.update(sessions => sessions.map(s =>
        s.id === evt.sessionId
          ? { ...s, is_private: evt.isPrivate, private_owner_id: evt.ownerId }
          : s,
      ));
    });

    // Chat-ownership-v1: session removed from my inbox (another op claimed private or transferred away)
    effect(() => {
      const evt = this.wsService.chatRemovedFromInbox();
      if (!evt) return;
      this._sessions.update(sessions => sessions.filter(s => s.id !== evt.sessionId));
      if (untracked(() => this._activeSessionId()) === evt.sessionId) {
        this._activeSessionId.set(null);
      }
    });

    // Chat-ownership-v1: session assigned to me (transfer/private claim by admin)
    effect(() => {
      const evt = this.wsService.chatAssignedToYou();
      if (!evt) return;
      untracked(() => {
        const from = evt.fromOperatorName || 'коллеги';
        this.snackBar
          .open(`Вам передан чат от ${from}`, 'Открыть', { duration: 8000 })
          .onAction()
          .subscribe(() => this._activeSessionId.set(evt.sessionId));
        this.loadSessions();
      });
    });

    // React to visitor typing (with auto-reset after 5s)
    effect(() => {
      const typing = this.wsService.visitorTyping();
      if (!typing) return;
      this._visitorTypingMap.update(map => {
        const next = new Map(map);
        next.set(typing.sessionId, typing.isTyping);
        return next;
      });

      // Clear previous timer
      const prev = this.visitorTypingTimers.get(typing.sessionId);
      if (prev) clearTimeout(prev);

      if (typing.isTyping) {
        // Auto-stop after 5s if no new typing event
        const timer = setTimeout(() => {
          this._visitorTypingMap.update(map => {
            const next = new Map(map);
            next.set(typing.sessionId, false);
            return next;
          });
          this.visitorTypingTimers.delete(typing.sessionId);
        }, 5000);
        this.visitorTypingTimers.set(typing.sessionId, timer);
      } else {
        this.visitorTypingTimers.delete(typing.sessionId);
      }
    });

    // React to operator typing (other operators typing in same session)
    effect(() => {
      const evt = this.wsService.operatorTyping();
      if (!evt) return;
      const currentUserId = untracked(() => this.authService.currentUser())?.id;
      if (evt.operatorId === currentUserId) return;

      if (evt.isTyping) {
        this._operatorTypingMap.update(m => new Map(m).set(evt.sessionId, evt.operatorId));
        const key = `op-typing-${evt.sessionId}`;
        if (this.visitorTypingTimers.has(key)) clearTimeout(this.visitorTypingTimers.get(key)!);
        this.visitorTypingTimers.set(key, setTimeout(() => {
          this._operatorTypingMap.update(m => {
            const next = new Map(m);
            next.delete(evt.sessionId);
            return next;
          });
        }, 5000));
      } else {
        this._operatorTypingMap.update(m => {
          const next = new Map(m);
          next.delete(evt.sessionId);
          return next;
        });
      }
    });

    // React to chat:status-changed (in-place update without full loadSessions)
    effect(() => {
      const evt = this.wsService.chatStatusChanged();
      if (!evt) return;
      this._sessions.update(sessions => sessions.map(s =>
        s.id === evt.sessionId ? { ...s, status: evt.status as OperatorChatSession['status'] } : s
      ));
    });

    // React to message delivery/read status updates
    effect(() => {
      const evt = this.wsService.messageStatusUpdate();
      const activeId = untracked(() => this.activeSession())?.id;
      const conversationId = evt ? Reflect.get(evt, 'conversationId') : undefined;
      const eventConversationId = typeof conversationId === 'string' ? conversationId : undefined;
      if (!evt || !activeId || (evt.sessionId !== activeId && eventConversationId !== activeId)) return;

      untracked(() => {
        const eventTimestamp = Reflect.get(evt, 'timestamp');
        const timestamp = typeof eventTimestamp === 'string' ? eventTimestamp : new Date().toISOString();
        const idSet = new Set(evt.messageIds);
        let changed = false;
        const nextMessages = this._messages().map(m => {
          if (!idSet.has(m.id)) return m;
          changed = true;
          return this.applyDeliveryStatus(m, evt.status, timestamp);
        });

        if (!changed) return;
        this._messages.set(nextMessages);
        this.rebuildMessagesMeta(nextMessages);

        const cacheIds = new Set([evt.sessionId, eventConversationId, activeId].filter((id): id is string => !!id));
        for (const cacheId of cacheIds) {
          const cached = this.messageCache.get(cacheId);
          if (cached) {
            cached.messages = cached.messages.map(m => idSet.has(m.id) ? this.applyDeliveryStatus(m, evt.status, timestamp) : m);
            cached.lastAccessed = Date.now();
          }
        }
      });
    });

    // React to client/booking linking events
    effect(() => {
      const evt = this.wsService.chatClientLinked();
      if (!evt) return;
      this._sessions.update(sessions => sessions.map(s => {
        if (s.id !== evt.sessionId) return s;
        return {
          ...s,
          ...(evt.userId ? { user_id: evt.userId, client_name: evt.clientName ?? null, client_phone: evt.clientPhone ?? null } : {}),
          ...(evt.contactId ? { contact_id: evt.contactId } : {}),
          ...(evt.bookingId ? { booking_id: evt.bookingId, booking_service: evt.bookingService ?? null, booking_date: evt.bookingDate ?? null, booking_status: evt.bookingStatus ?? null } : {}),
        };
      }));
    });

    // F70: React to phone update events (from other operators or bot auto-capture)
    effect(() => {
      const evt = this.wsService.chatPhoneUpdated();
      if (!evt) return;
      this._sessions.update(sessions => sessions.map(s =>
        s.id === evt.sessionId ? { ...s, visitor_phone: evt.visitorPhone } : s,
      ));
    });

    // Track chat viewers (collision detection)
    effect(() => {
      const evt = this.wsService.chatViewing();
      if (!evt) return;
      const myId = untracked(() => this.authService.currentUser())?.id;
      if (evt.operatorId === myId) return;
      this._viewersMap.update(m => new Map(m).set(evt.sessionId, { operatorId: evt.operatorId, operatorName: evt.operatorName }));
    });

    effect(() => {
      const evt = this.wsService.chatLeft();
      if (!evt) return;
      this._viewersMap.update(m => {
        const next = new Map(m);
        next.delete(evt.sessionId);
        return next;
      });
    });

    // React to WebSocket reconnect — resync sessions and active chat messages
    effect(() => {
      const ts = this.wsService.reconnected();
      if (ts > 0) {
        this.loadSessions();
        const activeId = untracked(() => this._activeSessionId());
        if (activeId) {
          this.loadInitialMessages(activeId);
        }
      }
    });

    // React to message:deleted events
    effect(() => {
      const evt = this.wsService.messageDeleted();
      if (!evt) return;
      const activeId = untracked(() => this._activeSessionId());
      if (evt.sessionId === activeId) {
        this._messages.update(msgs => msgs.filter(m => m.id !== evt.messageId));
        untracked(() => this.rebuildMessagesMeta(this._messages()));
      }
      // Also invalidate LRU cache for inactive sessions
      this.messageCache.forEach((cached, cachedSessionId) => {
        if (cachedSessionId !== activeId) {
          const idx = cached.messages.findIndex(m => m.id === evt.messageId);
          if (idx >= 0) {
            cached.messages = cached.messages.filter(m => m.id !== evt.messageId);
          }
        }
      });
    });

    // React to message:edited events
    effect(() => {
      const evt = this.wsService.messageEdited();
      if (!evt) return;
      const activeId = untracked(() => this._activeSessionId());
      if (evt.sessionId === activeId) {
        this._messages.update(msgs => msgs.map(m =>
          m.id === evt.messageId
            ? { ...m, content: evt.content, metadata: { ...m.metadata, edited: true } }
            : m,
        ));
        untracked(() => this.rebuildMessagesMeta(this._messages()));
      }
      // Also invalidate LRU cache for inactive sessions
      this.messageCache.forEach((cached, cachedSessionId) => {
        if (cachedSessionId !== activeId) {
          const idx = cached.messages.findIndex(m => m.id === evt.messageId);
          if (idx >= 0) {
            cached.messages = cached.messages.map(m =>
              m.id === evt.messageId ? { ...m, content: evt.content, metadata: { ...m.metadata, edited: true } } : m
            );
          }
        }
      });
    });

    // React to message:reaction-updated events
    effect(() => {
      const evt = this.wsService.messageReactionUpdated();
      if (!evt) return;
      const activeId = untracked(() => this._activeSessionId());
      if (evt.sessionId === activeId) {
        this._messages.update(msgs => msgs.map(m =>
          m.id === evt.messageId
            ? { ...m, metadata: { ...m.metadata, reactions: evt.reactions } }
            : m,
        ));
      }
      // Also update LRU cache for inactive sessions
      this.messageCache.forEach((cached, cachedSessionId) => {
        if (cachedSessionId !== activeId) {
          const idx = cached.messages.findIndex(m => m.id === evt.messageId);
          if (idx >= 0) {
            cached.messages = cached.messages.map(m =>
              m.id === evt.messageId ? { ...m, metadata: { ...m.metadata, reactions: evt.reactions } } : m
            );
          }
        }
      });
    });

    // React to message:pin-toggled events
    effect(() => {
      const evt = this.wsService.messagePinToggled();
      if (!evt) return;
      const activeId = untracked(() => this._activeSessionId());
      const patch = { pinned_at: evt.pinned ? new Date().toISOString() : null, pinned_by: evt.pinnedBy };
      if (evt.sessionId === activeId) {
        this._messages.update(msgs => msgs.map(m =>
          m.id === evt.messageId ? { ...m, ...patch } : m,
        ));
      }
      this.messageCache.forEach((cached, cachedSessionId) => {
        if (cachedSessionId !== activeId) {
          cached.messages = cached.messages.map(m =>
            m.id === evt.messageId ? { ...m, ...patch } : m,
          );
        }
      });
    });

    // Cleanup all setTimeout handles on service destroy
    this.destroyRef.onDestroy(() => {
      this.visitorTypingTimers.forEach(t => clearTimeout(t));
      this.visitorTypingTimers.clear();
    });
  }

  /**
   * Classify an incoming WS message. Pure — no state mutation.
   *   'skip'             — own-operator echo that matches a temp message we already have; do nothing
   *   'echo-no-session'  — own-operator echo for a session we don't currently see in the list
   *   'echo'             — own-operator echo; update last_message only, don't bump counter
   *   'append'           — genuine new message; full processing
   */
  private interpretVisitorMessage(msg: { sessionId: string; content: string; message?: unknown }): 'skip' | 'echo-no-session' | 'echo' | 'append' {
    const eventRow = isRecord(msg) ? msg : undefined;
    const dbRow = isRecord(msg.message) ? msg.message : undefined;
    const dbId = readStringField(dbRow, 'id', 'messageId')
      ?? readStringField(eventRow, 'messageId', 'id');
    const senderType = readIncomingSenderType(dbRow, eventRow);
    const senderId = readStringField(eventRow, 'senderId', 'sender_id')
      ?? readStringField(dbRow, 'sender_id', 'senderId')
      ?? null;
    const currentUserId = this.authService.currentUser()?.id;
    const isOwnOperatorMessage = senderType === 'operator' && !!currentUserId && senderId === currentUserId;

    if (!isOwnOperatorMessage) return 'append';

    // Own-operator echo. If we have DB id and an existing temp message for it,
    // caller should just rewrite id — signal 'skip' so the append path is
    // skipped. We still want session reorder to run → 'echo' covers that.
    if (dbId && msg.sessionId === this._activeSessionId()) {
      const existing = this._messages().find(m =>
        (safeStartsWith(m.id, 'temp-') || safeStartsWith(m.id, 'ws-')) &&
        m.content === msg.content &&
        m.sender_type === senderType,
      );
      if (existing) return 'skip';
      if (this._messages().some(m => m.id === dbId)) return 'skip';
    }
    return 'echo';
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private finiteNumber(value: unknown): number | null {
    if (typeof value !== 'number') return null;
    return Number.isFinite(value) ? value : null;
  }

  private paymentLinkDisplayMethod(_method: string | null): string {
    return 'online';
  }

  private paymentLinkIdFromEvent(data: PaymentLinkEventPayload): string | null {
    return this.nonEmptyString(data.paymentLinkId) ?? this.nonEmptyString(data.id);
  }

  private paymentLinkEventKey(data: PaymentLinkEventPayload): string | null {
    return this.paymentLinkIdFromEvent(data) ?? this.nonEmptyString(data.orderRef);
  }

  private paymentLinkIdForMessage(msg: OperatorChatMessage): string | null {
    return this.nonEmptyString(msg.metadata?.payment?.paymentLinkId)
      ?? this.nonEmptyString(msg.metadata?.['paymentLinkId']);
  }

  private paymentLinkOrderRefForMessage(msg: OperatorChatMessage): string | null {
    return this.nonEmptyString(msg.metadata?.payment?.orderRef)
      ?? this.nonEmptyString(msg.metadata?.['orderRef']);
  }

  private messageMatchesPaymentLink(msg: OperatorChatMessage, paymentLinkId: string | null, orderRef: string | null): boolean {
    const metadata = msg.metadata;
    const payment = metadata?.payment;
    const directKeys = [
      payment?.paymentLinkId,
      metadata?.['paymentLinkId'],
      payment?.orderRef,
      metadata?.['orderRef'],
    ];
    if (paymentLinkId && directKeys.some(value => this.nonEmptyString(value) === paymentLinkId)) return true;
    if (orderRef && directKeys.some(value => this.nonEmptyString(value) === orderRef)) return true;

    const buttons = metadata?.interactive?.buttons ?? [];
    return buttons.some(button => {
      const data = button.data;
      return (paymentLinkId && this.nonEmptyString(data?.paymentLinkId) === paymentLinkId)
        || (orderRef && (
          this.nonEmptyString(data?.orderRef) === orderRef
          || this.nonEmptyString(data?.orderId) === orderRef
        ));
    });
  }

  private paymentLinkKeyFromButtons(msg: OperatorChatMessage): string | null {
    const buttons = msg.metadata?.interactive?.buttons ?? [];
    for (const button of buttons) {
      const data = button.data;
      const key = this.nonEmptyString(data?.paymentLinkId)
        ?? this.nonEmptyString(data?.orderRef)
        ?? this.nonEmptyString(data?.orderId);
      if (key) return key;
    }
    return null;
  }

  private paymentLinkKeysForMessage(msg: OperatorChatMessage): string[] {
    const keys = new Set<string>();
    const directKeys = [
      this.paymentLinkIdForMessage(msg),
      this.paymentLinkOrderRefForMessage(msg),
    ];
    for (const key of directKeys) {
      if (key) keys.add(key);
    }
    for (const button of msg.metadata?.interactive?.buttons ?? []) {
      const data = button.data;
      const buttonKeys = [
        this.nonEmptyString(data?.paymentLinkId),
        this.nonEmptyString(data?.orderRef),
        this.nonEmptyString(data?.orderId),
      ];
      for (const key of buttonKeys) {
        if (key) keys.add(key);
      }
    }
    return [...keys];
  }

  private paymentLinkKeyForMessage(msg: OperatorChatMessage): string | null {
    return this.paymentLinkIdForMessage(msg)
      ?? this.paymentLinkOrderRefForMessage(msg)
      ?? this.paymentLinkKeyFromButtons(msg);
  }

  private isPaymentLinkRequestMessage(msg: OperatorChatMessage): boolean {
    if (this.isPaymentLinkCustomerConfirmation(msg) || this.isPaymentLinkPaidOperatorNotification(msg)) return false;
    const step = this.nonEmptyString(msg.metadata?.interactive?.['step']);
    return step === 'operator_payment'
      || step === 'operator_payment_update'
      || this.paymentLinkKeyFromButtons(msg) !== null;
  }

  private paidPaymentMetadataForMessage(msg: OperatorChatMessage): NonNullable<OperatorMessageMetadata['payment']> | null {
    const payment = msg.metadata?.payment;
    if (!payment || payment.source !== 'payment_link' || payment.status !== 'paid') return null;
    return payment;
  }

  private preferRicherPaymentMetadata(
    current: NonNullable<OperatorMessageMetadata['payment']> | undefined,
    next: NonNullable<OperatorMessageMetadata['payment']>,
  ): NonNullable<OperatorMessageMetadata['payment']> {
    if (!current) return next;
    const currentItems = current.items?.length ?? 0;
    const nextItems = next.items?.length ?? 0;
    if (nextItems > currentItems) return next;
    return current;
  }

  private applyPaidPaymentMetadataToRequest(
    msg: OperatorChatMessage,
    paidPayment: NonNullable<OperatorMessageMetadata['payment']>,
  ): OperatorChatMessage {
    const metadata: OperatorMessageMetadata = { ...(msg.metadata ?? {}) };
    const existingPayment = metadata.payment ?? {};
    metadata.payment = {
      ...existingPayment,
      ...paidPayment,
      source: 'payment_link',
      status: 'paid',
    };
    return { ...msg, metadata };
  }

  private mergePaymentLinkPaidNotificationsIntoMeta(meta: MessagesMetaItem[]): MessagesMetaItem[] {
    const paidByKey = new Map<string, NonNullable<OperatorMessageMetadata['payment']>>();

    for (const item of meta) {
      const keys = this.paymentLinkKeysForMessage(item.msg);
      const paidPayment = this.paidPaymentMetadataForMessage(item.msg);
      if (keys.length === 0 || !paidPayment) continue;
      for (const key of keys) {
        paidByKey.set(key, this.preferRicherPaymentMetadata(paidByKey.get(key), paidPayment));
      }
    }

    if (paidByKey.size === 0) return meta;

    const requestKeys = new Set<string>();
    for (const item of meta) {
      const keys = this.paymentLinkKeysForMessage(item.msg);
      if (keys.some(key => paidByKey.has(key)) && this.isPaymentLinkRequestMessage(item.msg)) {
        for (const key of keys) requestKeys.add(key);
      }
    }

    if (requestKeys.size === 0) return meta;

    return meta.map((item) => {
      const keys = this.paymentLinkKeysForMessage(item.msg);
      const matchedKey = keys.find(key => requestKeys.has(key));
      if (!matchedKey) return item;

      if (this.isPaymentLinkRequestMessage(item.msg)) {
        const paidPayment = keys.map(key => paidByKey.get(key)).find((payment): payment is NonNullable<OperatorMessageMetadata['payment']> => !!payment);
        if (!paidPayment) return item;
        return {
          ...item,
          msg: this.applyPaidPaymentMetadataToRequest(item.msg, paidPayment),
        };
      }

      if (this.isPaymentLinkCustomerConfirmation(item.msg) || this.isPaymentLinkPaidOperatorNotification(item.msg)) {
        return { ...item, skipRender: true };
      }

      return item;
    });
  }

  private isPaymentLinkCustomerConfirmation(msg: OperatorChatMessage): boolean {
    return msg.metadata?.['kind'] === 'payment_link_paid_customer_confirmation';
  }

  private isPaymentLinkPaidOperatorNotification(msg: OperatorChatMessage): boolean {
    if (this.isPaymentLinkCustomerConfirmation(msg)) return false;
    const step = this.nonEmptyString(msg.metadata?.interactive?.['step']);
    if (step === 'payment_link_paid') return true;
    const payment = msg.metadata?.payment;
    return msg.sender_type === 'system'
      && payment?.source === 'payment_link'
      && payment?.status === 'paid';
  }

  private rememberPendingMediaReady(evt: MediaReadyEvent): void {
    this.pendingMediaReadyEvents.set(evt.messageId, evt);
    while (this.pendingMediaReadyEvents.size > MAX_PENDING_MEDIA_READY_EVENTS) {
      const firstKey = this.pendingMediaReadyEvents.keys().next().value;
      if (!firstKey) break;
      this.pendingMediaReadyEvents.delete(firstKey);
    }
  }

  private mediaReadyPatch(evt: MediaReadyEvent): Partial<OperatorChatMessage> {
    const patch: Partial<OperatorChatMessage> = {
      attachment_url: evt.attachmentUrl,
    };
    if (evt.fileName) patch.original_file_name = evt.fileName;
    if (evt.mimeType) patch.original_mime_type = evt.mimeType;
    if (isOperatorMessageType(evt.mediaType)) patch.message_type = evt.mediaType;
    return patch;
  }

  private applyMediaReadyToMessage(message: OperatorChatMessage, evt: MediaReadyEvent): OperatorChatMessage {
    return { ...message, ...this.mediaReadyPatch(evt) };
  }

  private applyPendingMediaReady(message: OperatorChatMessage): OperatorChatMessage {
    const evt = this.pendingMediaReadyEvents.get(message.id);
    if (!evt) return message;
    this.pendingMediaReadyEvents.delete(message.id);
    return this.applyMediaReadyToMessage(message, evt);
  }

  private applyMediaReadyEvent(evt: MediaReadyEvent): boolean {
    let changedActiveMessages = false;
    let nextMessages: OperatorChatMessage[] = [];

    this._messages.update(messages => {
      nextMessages = messages.map(message => {
        if (message.id !== evt.messageId) return message;
        changedActiveMessages = true;
        return this.applyMediaReadyToMessage(message, evt);
      });
      return changedActiveMessages ? nextMessages : messages;
    });

    if (changedActiveMessages) {
      this.rebuildMessagesMeta(nextMessages);
    }

    let changedCache = false;
    for (const [, cached] of this.messageCache) {
      if (!cached.messages.some(message => message.id === evt.messageId)) continue;
      cached.messages = cached.messages.map(message =>
        message.id === evt.messageId
          ? this.applyMediaReadyToMessage(message, evt)
          : message,
      );
      cached.lastAccessed = Date.now();
      changedCache = true;
      break;
    }

    return changedActiveMessages || changedCache;
  }

  private updateActiveCache(sessionId: string, messages: OperatorChatMessage[] = this._messages()): void {
    const cached = this.messageCache.get(sessionId);
    if (!cached) return;
    cached.messages = messages;
    cached.totalCount = Math.max(cached.totalCount, messages.length);
    cached.lastAccessed = Date.now();
  }

  private applyPaymentLinkPaidStatusToMessages(data: PaymentLinkEventPayload, paidAt: string): boolean {
    const paymentLinkId = this.paymentLinkIdFromEvent(data);
    const orderRef = this.nonEmptyString(data.orderRef);
    if (!paymentLinkId && !orderRef) return false;

    const amount = this.finiteNumber(data.amount);
    const method = this.nonEmptyString(data.method);
    let changed = false;
    let nextMessages: OperatorChatMessage[] = [];

    this._messages.update(messages => {
      nextMessages = messages.map(msg => {
        if (!this.messageMatchesPaymentLink(msg, paymentLinkId, orderRef)) return msg;

        const metadata: OperatorMessageMetadata = { ...(msg.metadata ?? {}) };
        const nextPayment: NonNullable<OperatorMessageMetadata['payment']> = {
          ...(metadata.payment ?? {}),
          source: metadata.payment?.source ?? 'payment_link',
          status: 'paid',
        };
        if (amount !== null) nextPayment.amount = amount;
        nextPayment.method = method ? this.paymentLinkDisplayMethod(method) : 'online';
        if (paymentLinkId) nextPayment.paymentLinkId = paymentLinkId;
        if (orderRef) nextPayment.orderRef = orderRef;
        nextPayment.paidAt = nextPayment.paidAt ?? paidAt;

        metadata.payment = nextPayment;
        changed = true;
        return { ...msg, metadata };
      });
      return nextMessages;
    });

    if (!changed) return false;
    this.rebuildMessagesMeta(nextMessages);
    const activeId = this._activeSessionId();
    if (activeId) this.updateActiveCache(activeId, nextMessages);
    return true;
  }

  private hasPaymentLinkPaidOperatorNotification(data: PaymentLinkEventPayload): boolean {
    const paymentLinkId = this.paymentLinkIdFromEvent(data);
    const orderRef = this.nonEmptyString(data.orderRef);
    return this._messages().some(msg =>
      this.isPaymentLinkPaidOperatorNotification(msg)
      && this.messageMatchesPaymentLink(msg, paymentLinkId, orderRef)
    );
  }

  private buildPaymentLinkPaidNotification(
    sessionId: string,
    data: PaymentLinkEventPayload,
    paidAt: string,
  ): OperatorChatMessage {
    const paymentLinkId = this.paymentLinkIdFromEvent(data);
    const orderRef = this.nonEmptyString(data.orderRef);
    const amount = this.finiteNumber(data.amount);
    const key = this.paymentLinkEventKey(data) ?? paidAt;
    const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '_');
    const refText = orderRef ? ` по ссылке ${orderRef}` : '';
    const content = amount !== null
      ? `Клиент оплатил ${amount}₽${refText}. Создайте заказ.`
      : `Клиент оплатил${refText}. Создайте заказ.`;
    const buttonData: NonNullable<NonNullable<NonNullable<OperatorMessageMetadata['interactive']>['buttons']>[number]['data']> = {};
    if (paymentLinkId) buttonData.paymentLinkId = paymentLinkId;
    if (orderRef) buttonData.orderRef = orderRef;
    if (amount !== null) buttonData.amount = amount;
    const payment: NonNullable<OperatorMessageMetadata['payment']> = {
      source: 'payment_link',
      status: 'paid',
      method: this.paymentLinkDisplayMethod(this.nonEmptyString(data.method)),
      paidAt,
    };
    if (amount !== null) payment.amount = amount;
    if (paymentLinkId) payment.paymentLinkId = paymentLinkId;
    if (orderRef) payment.orderRef = orderRef;

    return {
      id: `payment-link-paid-${sessionId}-${safeKey}`,
      session_id: sessionId,
      sender_type: 'system',
      sender_name: 'Система',
      message_type: 'interactive',
      content,
      attachment_url: null,
      created_at: paidAt,
      is_read: false,
      metadata: {
        interactive: {
          type: 'buttons',
          step: 'payment_link_paid',
          buttons: [
            {
              id: 'create_order_from_link',
              label: 'Создать заказ',
              value: 'create_order_from_link',
              data: buttonData,
            },
          ],
        },
        payment,
      },
    };
  }

  private applyPaymentLinkPaidEvent(data: PaymentLinkEventPayload): void {
    const sessionId = this.nonEmptyString(data.conversationId);
    if (!sessionId || sessionId !== this._activeSessionId()) return;

    const paidAt = new Date().toISOString();
    const updatedExistingPaymentRequest = this.applyPaymentLinkPaidStatusToMessages(data, paidAt);
    if (updatedExistingPaymentRequest) return;
    if (this.hasPaymentLinkPaidOperatorNotification(data)) return;

    const msg = this.buildPaymentLinkPaidNotification(sessionId, data, paidAt);
    this._messages.update(msgs => [...msgs, msg]);
    this.appendMessageMeta(msg);
    this.updateActiveCache(sessionId);
  }

  private applyPaidPaymentNotificationToExistingRequest(msg: OperatorChatMessage): boolean {
    const keys = this.paymentLinkKeysForMessage(msg);
    const paidPayment = this.paidPaymentMetadataForMessage(msg);
    if (keys.length === 0 || !paidPayment) return false;

    let changed = false;
    let nextMessages: OperatorChatMessage[] = [];
    this._messages.update(messages => {
      nextMessages = messages.map(current => {
        if (!this.isPaymentLinkRequestMessage(current)) return current;
        const currentKeys = this.paymentLinkKeysForMessage(current);
        if (!currentKeys.some(currentKey => keys.includes(currentKey))) return current;
        changed = true;
        return this.applyPaidPaymentMetadataToRequest(current, paidPayment);
      });
      return changed ? nextMessages : messages;
    });

    if (!changed) return false;
    this.rebuildMessagesMeta(nextMessages);
    const activeId = this._activeSessionId();
    if (activeId) this.updateActiveCache(activeId, nextMessages);
    return true;
  }

  private replacePaymentLinkPaidSynthetic(msg: OperatorChatMessage): boolean {
    if (!this.isPaymentLinkPaidOperatorNotification(msg)) return false;
    const paymentLinkId = this.paymentLinkIdForMessage(msg);
    const orderRef = this.paymentLinkOrderRefForMessage(msg);
    if (!paymentLinkId && !orderRef) return false;

    let replaced = false;
    let nextMessages: OperatorChatMessage[] = [];
    this._messages.update(messages => {
      const existing = messages.find(current =>
        safeStartsWith(current.id, 'payment-link-paid-')
        && this.isPaymentLinkPaidOperatorNotification(current)
        && this.messageMatchesPaymentLink(current, paymentLinkId, orderRef)
      );
      if (!existing) {
        nextMessages = messages;
        return messages;
      }
      replaced = true;
      nextMessages = messages.map(current =>
        current.id === existing.id ? { ...existing, ...msg } : current
      );
      return nextMessages;
    });

    if (!replaced) return false;
    this.rebuildMessagesMeta(nextMessages);
    this.updateActiveCache(msg.session_id, nextMessages);
    return true;
  }

  /** O(N) full rebuild. Called on bulk message changes (selectSession, load initial/older, jump). */
  private rebuildMessagesMeta(msgs: OperatorChatMessage[]): void {
    this._mediaGroupTail = null;
    if (msgs.length === 0) {
      this._messagesMeta.set([]);
      return;
    }

    let baseMeta: MessagesMetaItem[] = msgs.map((msg, i) => ({
      msg,
      showDate: i === 0 || !sameDay(msg.created_at, msgs[i - 1].created_at),
      grouped: i > 0 && msg.sender_type === msgs[i - 1].sender_type &&
               new Date(msg.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() < MSG_GROUP_GAP_MS,
      lastInGroup: i === msgs.length - 1 || msgs[i + 1].sender_type !== msg.sender_type ||
                   new Date(msgs[i + 1].created_at).getTime() - new Date(msg.created_at).getTime() >= MSG_GROUP_GAP_MS,
      mediaGroupStart: false,
      mediaGroupItems: null,
      skipRender: false,
    }));
    baseMeta = this.mergePaymentLinkPaidNotificationsIntoMeta(baseMeta);

    for (let i = 0; i < baseMeta.length; i++) {
      const m = baseMeta[i];
      if (m.skipRender || !m.msg.attachment_url || !isVisualImage(m.msg)) continue;
      if (hasRealCaption(m.msg)) continue;

      const groupItems: OperatorChatMessage[] = [m.msg];
      let j = i + 1;
      while (j < baseMeta.length) {
        const next = baseMeta[j];
        if (!next.msg.attachment_url || !isVisualImage(next.msg)) break;
        if (hasRealCaption(next.msg)) break;
        if (next.msg.sender_type !== m.msg.sender_type) break;
        if (new Date(next.msg.created_at).getTime() - new Date(baseMeta[j - 1].msg.created_at).getTime() > MEDIA_GROUP_GAP_MS) break;
        if (next.showDate) break;
        groupItems.push(next.msg);
        j++;
      }

      if (groupItems.length >= 2) {
        m.mediaGroupStart = true;
        m.mediaGroupItems = groupItems;
        for (let k = i + 1; k < i + groupItems.length; k++) {
          baseMeta[k].skipRender = true;
        }
        if (i + groupItems.length === baseMeta.length) {
          this._mediaGroupTail = {
            firstIdx: i,
            count: groupItems.length,
            lastCreatedAt: groupItems[groupItems.length - 1].created_at,
            senderType: m.msg.sender_type,
          };
        }
      }
    }

    // Open-ended single-image tail: could still grow into a group on the next message.
    if (!this._mediaGroupTail) {
      const lastIdx = baseMeta.length - 1;
      const last = baseMeta[lastIdx];
      if (last.msg.attachment_url && isVisualImage(last.msg) && !hasRealCaption(last.msg) && !last.skipRender) {
        this._mediaGroupTail = {
          firstIdx: lastIdx,
          count: 1,
          lastCreatedAt: last.msg.created_at,
          senderType: last.msg.sender_type,
        };
      }
    }

    this._messagesMeta.set(baseMeta);
  }

  private applyDeliveryStatus(
    message: OperatorChatMessage,
    status: OperatorMessageDeliveryStatus | string,
    timestamp: string,
  ): OperatorChatMessage {
    if (status === 'read') {
      return {
        ...message,
        delivery_status: 'read',
        delivered_at: message.delivered_at || timestamp,
        read_at: message.read_at || timestamp,
        is_read: true,
      };
    }
    if (status === 'delivered') {
      return {
        ...message,
        delivery_status: 'delivered',
        delivered_at: message.delivered_at || timestamp,
      };
    }
    if (status === 'sent' || status === 'accepted' || status === 'failed') {
      return { ...message, delivery_status: status };
    }
    return { ...message, delivery_status: status };
  }

  /** O(1) amortized append. Called on WS visitor:new-message or optimistic operator send. */
  private appendMessageMeta(msg: OperatorChatMessage): void {
    const prev = this._messagesMeta();
    if (prev.some(p => p.msg.id === msg.id)) return;
    if (prev.length === 0) {
      this.rebuildMessagesMeta(this._messages());
      return;
    }

    const last = prev[prev.length - 1];
    const tGap = new Date(msg.created_at).getTime() - new Date(last.msg.created_at).getTime();
    const sameSender = last.msg.sender_type === msg.sender_type;
    const grouped = sameSender && tGap < MSG_GROUP_GAP_MS;
    const showDate = !sameDay(msg.created_at, last.msg.created_at);

    const newEntry: MessagesMetaItem = {
      msg,
      showDate,
      grouped,
      lastInGroup: true,
      mediaGroupStart: false,
      mediaGroupItems: null,
      skipRender: false,
    };

    let updatedPrev: MessagesMetaItem[] = prev;
    if (grouped) {
      updatedPrev = prev.slice(0, prev.length - 1).concat({ ...last, lastInGroup: false });
    }

    const tail = this._mediaGroupTail;
    const extensible = !!tail
      && !showDate
      && tail.senderType === msg.sender_type
      && !!msg.attachment_url
      && isVisualImage(msg)
      && !hasRealCaption(msg)
      && (new Date(msg.created_at).getTime() - new Date(tail.lastCreatedAt).getTime()) <= MEDIA_GROUP_GAP_MS;

    if (extensible && tail) {
      const firstMeta = updatedPrev[tail.firstIdx];
      const existingItems = firstMeta.mediaGroupItems ?? [firstMeta.msg];
      const nextItems = [...existingItems, msg];
      const nextFirst: MessagesMetaItem = { ...firstMeta, mediaGroupStart: true, mediaGroupItems: nextItems };
      const nextEntry: MessagesMetaItem = { ...newEntry, skipRender: true };

      const next: MessagesMetaItem[] = updatedPrev.slice();
      next[tail.firstIdx] = nextFirst;
      next.push(nextEntry);
      this._messagesMeta.set(this.mergePaymentLinkPaidNotificationsIntoMeta(next));
      this._mediaGroupTail = {
        firstIdx: tail.firstIdx,
        count: nextItems.length,
        lastCreatedAt: msg.created_at,
        senderType: msg.sender_type,
      };
      return;
    }

    if (msg.attachment_url && isVisualImage(msg) && !hasRealCaption(msg)) {
      this._mediaGroupTail = {
        firstIdx: updatedPrev.length,
        count: 1,
        lastCreatedAt: msg.created_at,
        senderType: msg.sender_type,
      };
    } else {
      this._mediaGroupTail = null;
    }

    this._messagesMeta.set(this.mergePaymentLinkPaidNotificationsIntoMeta([...updatedPrev, newEntry]));
  }

  /**
   * Initialize WebSocket subscription for operator chat monitoring
   */
  init(): void {
    if (!isPlatformBrowser(this.platformId) || this.wsInitialized) return;
    this.wsInitialized = true;
    this.wsService.joinVisitorChats();
    this.loadSessions();

    this.destroyRef.onDestroy(() => {
      this.wsService.leaveVisitorChats();
      this.wsInitialized = false;
    });
  }

  loadSessions(status?: string, channel?: string): void {
    const filter = status ?? this._statusFilter();
    const ch = channel ?? 'all';
    this._loading.set(true);
    this.http.get<{ success: boolean; data: OperatorChatSession[] }>(
      `/api/visitor-chat/admin/sessions?status=${filter}&channel=${ch}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          // Preserve active session in the list even if it doesn't match the current filter
          // (e.g. active session is 'resolved' but filter is 'open')
          const activeId = this._activeSessionId();
          const activeInResult = activeId ? res.data.some(s => s.id === activeId) : true;
          if (activeId && !activeInResult) {
            const current = this._sessions().find(s => s.id === activeId);
            if (current) {
              this._sessions.set([current, ...res.data]);
            } else {
              this._sessions.set(res.data);
            }
          } else {
            this._sessions.set(res.data);
          }
        }
        this._loading.set(false);
      },
      error: (err) => {
        this.log.error('Failed to load sessions', { httpStatus: err?.status });
        this._loading.set(false);
      },
    });
  }

  setStatusFilter(status: string): void {
    this._statusFilter.set(status);
    this.loadSessions(status);
  }

  selectSession(sessionId: string): void {
    // Emit left previous chat (collision detection)
    const prev = this._activeSessionId();
    if (prev) this.wsService.emitLeftChat(prev);

    this._activeSessionId.set(sessionId);
    this._sessionNotFound.set(false);

    // Emit viewing new chat (collision detection)
    const user = this.authService.currentUser();
    const operatorName = user?.display_name || user?.displayName || 'Оператор';
    this.wsService.emitViewingChat(sessionId, operatorName);

    // Ensure session object exists in _sessions (needed for activeSession computed)
    const exists = this._sessions().some(s => s.id === sessionId);
    if (!exists) {
      this.loadSessionDetail(sessionId);
    }

    // Try LRU cache for instant restore
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      this._messages.set(cached.messages);
      this._previousMessages.set(cached.previousMessages ?? []);
      this._activityItems.set(cached.activityItems ?? []);
      this.hasOlder.set(cached.hasOlder);
      this.totalMessageCount.set(cached.totalCount);
      cached.lastAccessed = Date.now();
      this.rebuildMessagesMeta(cached.messages);
      // Background sync newer messages
      this.syncNewerMessages(sessionId, cached);
    } else {
      this._messages.set([]);
      this._messagesMeta.set([]);
      this._mediaGroupTail = null;
      this._previousMessages.set([]);
      this._activityItems.set([]);
      this.hasOlder.set(true);
      this.loadInitialMessages(sessionId);
    }

    this.markVisitorMessagesRead(sessionId);
    // Clear unread dot in inbox sidebar
    this.inboxService.markItemRead(sessionId);
  }

  /** Load a single session detail and add to _sessions if missing */
  private loadSessionDetail(sessionId: string): void {
    this.http.get<{ success: boolean; data: OperatorChatSession }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/detail`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this._sessions.update(sessions => {
            if (sessions.some(s => s.id === sessionId)) return sessions;
            return [res.data, ...sessions];
          });
        }
      },
      error: (err: unknown) => {
        const status = httpStatusOf(err);
        if (status === 404) {
          this._sessionNotFound.set(true);
          this.log.warn('Session not found (orphaned crm_inbox entry?)', { sessionId });
        } else {
          this.log.error('Failed to load session detail', { sessionId, status });
        }
      },
    });
  }

  /** Mark all visitor messages in a session as read by operator */
  markVisitorMessagesRead(sessionId: string): void {
    this.http.put<{ success: boolean; data: { markedCount: number } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/mark-read`, {}
    ).subscribe();
  }

  deselectSession(): void {
    // Emit left chat (collision detection)
    const prev = this._activeSessionId();
    if (prev) this.wsService.emitLeftChat(prev);

    this._activeSessionId.set(null);
    this._messages.set([]);
    this._messagesMeta.set([]);
    this._mediaGroupTail = null;
    this._previousMessages.set([]);
    this._activityItems.set([]);
    this._messagesLoading.set(false);
    this.loadingOlder.set(false);
  }

  /** Load recent messages for a session (initial load — older loaded on scroll up) */
  private loadInitialMessages(sessionId: string): void {
    this._messagesLoading.set(true);
    this.http.get<PaginatedResponse>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages?limit=100`
    ).subscribe({
      next: (res) => {
        if (sessionId !== this._activeSessionId()) return;
        if (res.success) {
          const messages = normalizePaymentLinkPaymentMessages(res.data);
          const previousMessages = normalizePaymentLinkPaymentMessages(res.previousMessages ?? []);
          // activityItems приходят ТОЛЬКО на initial load; на пагинации поля нет.
          const activityItems = sanitizeActivityItems(res.activityItems);
          this._messages.set(messages);
          this._previousMessages.set(previousMessages);
          this._activityItems.set(activityItems);
          this.hasOlder.set(res.hasOlder);
          this.totalMessageCount.set(res.totalCount);
          this.rebuildMessagesMeta(messages);
          this.updateCache(sessionId, messages, res.hasOlder, res.hasNewer, res.totalCount, previousMessages, activityItems);
        }
        this._messagesLoading.set(false);
      },
      error: (err) => {
        if (sessionId !== this._activeSessionId()) return;
        this.log.error('Failed to load messages', { httpStatus: err?.status, sessionId });
        this._messagesLoading.set(false);
      },
    });
  }

  /** Load older messages (scroll up — infinite scroll) */
  loadOlderMessages(): void {
    const sessionId = this._activeSessionId();
    if (!sessionId || this.loadingOlder() || !this.hasOlder()) return;

    const msgs = this._messages();
    if (msgs.length === 0) return;
    const oldestTs = msgs[0].created_at;

    this.loadingOlder.set(true);
    this.http.get<PaginatedResponse>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages?limit=50&before=${encodeURIComponent(oldestTs)}`
    ).subscribe({
      next: (res) => {
        if (sessionId !== this._activeSessionId()) return;
        if (res.success && res.data.length > 0) {
          const messages = normalizePaymentLinkPaymentMessages(res.data);
          this._messages.update(current => [...messages, ...current]);
          this.hasOlder.set(res.hasOlder);
          this.rebuildMessagesMeta(this._messages());
          // Update cache
          const cached = this.messageCache.get(sessionId);
          if (cached) {
            cached.messages = [...messages, ...cached.messages];
            cached.hasOlder = res.hasOlder;
            cached.lastAccessed = Date.now();
          }
        } else {
          this.hasOlder.set(false);
        }
        this.loadingOlder.set(false);
      },
      error: (err) => {
        if (sessionId !== this._activeSessionId()) return;
        this.log.error('Failed to load older messages', { httpStatus: err?.status, sessionId });
        this.loadingOlder.set(false);
      },
    });
  }

  /** Background sync newer messages (after cache restore) */
  private syncNewerMessages(sessionId: string, cached: MessageCache): void {
    if (cached.messages.length === 0) return;
    const newestTs = cached.messages[cached.messages.length - 1].created_at;

    this.http.get<PaginatedResponse>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages?limit=100&after=${encodeURIComponent(newestTs)}`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data.length > 0 && sessionId === this._activeSessionId()) {
          const messages = normalizePaymentLinkPaymentMessages(res.data);
          // Deduplicate
          const existingIds = new Set(this._messages().map(m => m.id));
          const newMsgs = messages.filter(m => !existingIds.has(m.id));
          if (newMsgs.length > 0) {
            this._messages.update(current => [...current, ...newMsgs]);
            for (const m of newMsgs) this.appendMessageMeta(m);
            cached.messages = [...cached.messages, ...newMsgs];
            cached.totalCount = res.totalCount;
          }
        }
      },
    });
  }

  /** Search messages in a session */
  searchMessages(sessionId: string, query: string) {
    return this.http.get<{ success: boolean; data: { id: string; content: string; sender_name: string; sender_type: string; created_at: string }[] }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages/search?q=${encodeURIComponent(query)}&limit=20`
    );
  }

  /** Jump to a specific message by timestamp (loads around it) */
  jumpToMessage(sessionId: string, timestamp: string): void {
    this._messagesLoading.set(true);
    this.http.get<PaginatedResponse>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages?limit=50&around=${encodeURIComponent(timestamp)}`
    ).subscribe({
      next: (res) => {
        if (sessionId !== this._activeSessionId()) return;
        if (res.success) {
          const messages = normalizePaymentLinkPaymentMessages(res.data);
          this._messages.set(messages);
          this.hasOlder.set(res.hasOlder);
          this.totalMessageCount.set(res.totalCount);
          this.rebuildMessagesMeta(messages);
          // FIX-A: jump (around) НЕ возвращает previousMessages/activityItems (они только
          // на initial load) — сохраняем текущие сигналы в кэш, иначе после прыжка и
          // возврата к сессии лента восстановится без активности/предыдущих бесед до reload.
          this.updateCache(sessionId, messages, res.hasOlder, res.hasNewer, res.totalCount, this._previousMessages(), this._activityItems());
        }
        this._messagesLoading.set(false);
      },
      error: (err) => {
        if (sessionId !== this._activeSessionId()) return;
        this.log.error('Failed to jump to message', { httpStatus: err?.status, sessionId, timestamp });
        this._messagesLoading.set(false);
      },
    });
  }

  /** Update LRU cache (trim messages to MAX_CACHED_MESSAGES to prevent OOM) */
  private updateCache(sessionId: string, messages: OperatorChatMessage[], hasOlder: boolean, hasNewer: boolean, totalCount: number, previousMessages?: OperatorChatMessage[], activityItems?: ActivityItem[]): void {
    const trimmed = messages.length > this.MAX_CACHED_MESSAGES
      ? messages.slice(-this.MAX_CACHED_MESSAGES)
      : messages;
    this.messageCache.set(sessionId, {
      messages: trimmed, previousMessages, activityItems, hasOlder: hasOlder || trimmed.length < messages.length, hasNewer, totalCount, lastAccessed: Date.now()
    });
    // Evict oldest if over limit
    if (this.messageCache.size > this.MAX_CACHE_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, val] of this.messageCache) {
        if (val.lastAccessed < oldestTime) {
          oldestTime = val.lastAccessed;
          oldestKey = key;
        }
      }
      if (oldestKey) this.messageCache.delete(oldestKey);
    }
  }

  sendReply(content: string, replyToMessageId?: string): void {
    const sessionId = this._activeSessionId();
    if (!sessionId || !content.trim()) return;

    const user = this.authService.currentUser();
    const operatorName = user?.display_name || user?.email || 'Оператор';

    // Resolve reply-to context for optimistic display
    let replyToContent: string | null = null;
    let replyToSenderName: string | null = null;
    if (replyToMessageId) {
      const replyTarget = this._messages().find(m => m.id === replyToMessageId);
      if (replyTarget) {
        replyToContent = replyTarget.content?.substring(0, 120) || null;
        replyToSenderName = replyTarget.sender_name || (replyTarget.sender_type === 'visitor' ? 'Клиент' : 'Оператор');
      }
    }

    // Optimistic add
    const tempMsg: OperatorChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      sender_type: 'operator',
      sender_name: operatorName,
      message_type: 'text',
      content: content.trim(),
      attachment_url: null,
      created_at: new Date().toISOString(),
      is_read: true,
      reply_to_message_id: replyToMessageId || null,
      reply_to_content: replyToContent,
      reply_to_sender_name: replyToSenderName,
    };
    this._messages.update(msgs => [...msgs, tempMsg]);
    this.appendMessageMeta(tempMsg);

    // Send via WebSocket (real-time delivery to visitor)
    this.wsService.replyToVisitor(sessionId, content.trim(), operatorName);

    // Save via REST API (persistence + session status update)
    const body: Record<string, unknown> = { content: content.trim() };
    if (replyToMessageId) {
      body['reply_to_message_id'] = replyToMessageId;
    }
    this.http.post<{ success: boolean; data: OperatorChatMessage }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/reply`,
      body
    ).subscribe({
      next: (res) => {
        if (res.success) {
          // Replace temp message with server response
          this._messages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data : m)
          );
          this.rebuildMessagesMeta(this._messages());
          // Update session status in list
          this._sessions.update(sessions =>
            sessions.map(s => s.id === sessionId ? { ...s, status: 'active' as const, last_message: content.trim(), last_message_at: new Date().toISOString() } : s)
          );
        }
      },
      error: (err) => {
        this.log.error('Failed to send message', { httpStatus: err?.status, sessionId });
        this._messages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
        this.rebuildMessagesMeta(this._messages());
      },
    });
  }

  sendNote(content: string): void {
    const sessionId = this._activeSessionId();
    if (!sessionId || !content.trim()) return;

    const user = this.authService.currentUser();
    const operatorName = user?.display_name || user?.email || 'Оператор';

    // Optimistic add
    const tempMsg: OperatorChatMessage = {
      id: `temp-note-${Date.now()}`,
      session_id: sessionId,
      sender_type: 'internal_note',
      sender_name: operatorName,
      message_type: 'text',
      content: content.trim(),
      attachment_url: null,
      created_at: new Date().toISOString(),
      is_read: true,
    };
    this._messages.update(msgs => [...msgs, tempMsg]);
    this.appendMessageMeta(tempMsg);

    // Save via REST API (no WS delivery to visitor)
    this.http.post<{ success: boolean; data: OperatorChatMessage }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/note`,
      { content: content.trim() }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data : m)
          );
          this.rebuildMessagesMeta(this._messages());
        }
      },
      error: (err) => {
        this.log.error('Failed to send note', { httpStatus: err?.status, sessionId });
        this._messages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
        this.rebuildMessagesMeta(this._messages());
      },
    });
  }

  assignToMe(sessionId: string): void {
    this.http.post<{ success: boolean; data: OperatorChatSession }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/assign`,
      { operator_id: 'self' }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const userId = this.authService.currentUser()?.id || null;
          this._sessions.update(sessions =>
            sessions.map(s => s.id === sessionId
              ? { ...s, assigned_operator_id: userId, status: 'active' as const }
              : s
            )
          );
        }
      },
    });
  }

  unassign(sessionId: string): void {
    this.http.post<{ success: boolean }>(`/api/visitor-chat/admin/sessions/${sessionId}/unassign`, {}).subscribe({
      next: () => {
        this._sessions.update(sessions =>
          sessions.map(s => s.id === sessionId ? { ...s, assigned_operator_id: null } : s)
        );
      },
    });
  }

  transfer(sessionId: string, toOperatorId: string, note?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean; data?: OperatorChatSession }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/transfer`,
      { to_operator_id: toOperatorId, note },
    ).pipe(
      tap((res) => {
        if (res.success) {
          this._sessions.update(sessions =>
            sessions.map(s => s.id === sessionId ? { ...s, assigned_operator_id: toOperatorId } : s),
          );
        }
      }),
      catchError((err: { status?: number; error?: { error?: string } }) => {
        const code = err?.status;
        const msg = code === 403 ? 'Нет прав для передачи чата'
          : code === 404 ? 'Оператор или чат не найден'
          : err?.error?.error || 'Не удалось передать чат';
        this.snackBar.open(msg, 'OK', { duration: 5000, panelClass: 'error-snackbar' });
        return throwError(() => err);
      }),
    );
  }

  /** Chat-ownership-v1: claim session into private (personal) work queue. */
  claimPrivate(sessionId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/claim-private`, {},
    ).pipe(
      tap((res) => {
        if (res.success) {
          const userId = this.authService.currentUser()?.id || null;
          this._sessions.update(sessions => sessions.map(s =>
            s.id === sessionId
              ? { ...s, is_private: true, private_owner_id: userId, assigned_operator_id: userId, status: 'active' as const }
              : s,
          ));
        }
      }),
      catchError((err: { error?: { error?: string } }) => {
        this.snackBar.open(err?.error?.error || 'Не удалось забрать чат в личную работу', 'OK', { duration: 4000 });
        return throwError(() => err);
      }),
    );
  }

  /** Chat-ownership-v1: release private ownership, return to shared queue. */
  releasePrivate(sessionId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/release-private`, {},
    ).pipe(
      tap((res) => {
        if (res.success) {
          this._sessions.update(sessions => sessions.map(s =>
            s.id === sessionId ? { ...s, is_private: false, private_owner_id: null } : s,
          ));
        }
      }),
      catchError((err: { error?: { error?: string } }) => {
        this.snackBar.open(err?.error?.error || 'Не удалось снять приватность', 'OK', { duration: 4000 });
        return throwError(() => err);
      }),
    );
  }

  /** Add a message to the current chat (public API — replaces bracket-notation hacks) */
  addMessage(msg: OperatorChatMessage): void {
    const current = this._messages();
    if (current.some(m => m.id === msg.id)) return;
    const existing = current.find(m =>
      (safeStartsWith(m.id, 'temp-') || safeStartsWith(m.id, 'ws-')) &&
      m.content === msg.content &&
      m.sender_type === msg.sender_type,
    );
    if (existing) {
      this._messages.update(msgs => msgs.map(m => m.id === existing.id ? { ...existing, ...msg } : m));
      this.rebuildMessagesMeta(this._messages());
      return;
    }
    if (this.replacePaymentLinkPaidSynthetic(msg)) return;
    this._messages.update(msgs => [...msgs, msg]);
    this.appendMessageMeta(msg);
  }

  /** Update metadata on a specific message (e.g. payment status change via WS) */
  updateMessageMetadata(messageId: string, metadata: OperatorMessageMetadata): void {
    this._messages.update(msgs => msgs.map(m =>
      m.id === messageId ? { ...m, metadata } : m
    ));
  }

  /** Toggle a reaction emoji on a message (add if not present, remove if already added) */
  toggleReaction(messageId: string, emoji: string): void {
    const sessionId = this._activeSessionId();
    if (!sessionId) return;
    this.http.post<{ success: boolean; data: { reactions: MessageReactions } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages/${messageId}/reactions`,
      { emoji },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.update(msgs => msgs.map(m =>
            m.id === messageId ? { ...m, metadata: { ...m.metadata, reactions: res.data.reactions } } : m,
          ));
        }
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Ошибка реакции';
        this.log.error('toggleReaction failed', { error: message });
      },
    });
  }

  /** Toggle pin/unpin on a message */
  togglePin(messageId: string): void {
    const sessionId = this._activeSessionId();
    if (!sessionId) return;
    this.http.post<{ success: boolean; data: { pinned: boolean } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages/${messageId}/pin`,
      {},
    ).subscribe({
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Ошибка закрепления';
        this.log.error('togglePin failed', { error: message });
      },
    });
  }

  /** Delete an outgoing pult message */
  deleteMessage(sessionId: string, messageId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages/${messageId}`,
    );
  }

  /** Edit an outgoing pult text message */
  editMessage(sessionId: string, messageId: string, content: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages/${messageId}`,
      { content },
    );
  }

  /** Upload file via presigned URL → S3 with real progress tracking */
  uploadFileWithProgress(sessionId: string, file: File, onProgress?: (percent: number) => void) {
    return new Observable<{ success: boolean; data: OperatorChatMessage }>(subscriber => {
      const presignUrl = `/api/visitor-chat/admin/sessions/${sessionId}/upload/presign`;
      const completeUrl = `/api/visitor-chat/admin/sessions/${sessionId}/upload/complete`;
      const contentType = file.type || 'application/octet-stream';

      // Step 1: get presigned PUT URL
      this.http.post<{ success: boolean; data: { uploads: { s3Key: string; uploadUrl: string }[] } }>(
        presignUrl, { files: [{ fileName: file.name, contentType }] },
      ).subscribe({
        next: (presignRes) => {
          if (!presignRes.success || !presignRes.data.uploads[0]) {
            subscriber.error(new Error('Presign failed'));
            return;
          }
          const { s3Key, uploadUrl } = presignRes.data.uploads[0];

          // Step 2: PUT file directly to S3 via XHR for progress tracking
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress?.(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // Step 3: notify backend that upload is complete
              this.http.post<{ success: boolean; data: OperatorChatMessage }>(
                completeUrl,
                { files: [{ s3Key, fileName: file.name, contentType, fileSize: file.size }] },
              ).subscribe({
                next: (res) => { subscriber.next(res); subscriber.complete(); },
                error: (err) => subscriber.error(err),
              });
            } else {
              subscriber.error(new Error(`S3 upload failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => subscriber.error(new Error('S3 upload network error'));
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', contentType);
          xhr.send(file);
        },
        error: (err) => subscriber.error(err),
      });
    });
  }

  requestSuggestion(sessionId: string) {
    return this.http.post<{ success: boolean; data: { suggestion: string } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/suggest`, {}
    );
  }

  createFollowup(sessionId: string, followUpAt: string, note?: string) {
    return this.http.post<{ success: boolean; data: { id: string; follow_up_at: string; note: string | null } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/followup`,
      { follow_up_at: followUpAt, note }
    );
  }

  cancelFollowup(sessionId: string, followupId: string) {
    return this.http.delete<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/followup/${followupId}`
    );
  }

  getFollowup(sessionId: string) {
    return this.http.get<{ success: boolean; data: { id: string; follow_up_at: string; note: string | null } | null }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/followup`
    );
  }

  // ── Client / Booking linking ──

  updateSessionFields(sessionId: string, fields: Partial<OperatorChatSession>): void {
    this._sessions.update(sessions => sessions.map(s =>
      s.id === sessionId ? { ...s, ...fields } : s
    ));
  }

  linkClient(sessionId: string, userId: string) {
    return this.http.put<{ success: boolean; data: { userId: string; clientName: string; clientPhone: string } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/link-client`,
      { userId }
    );
  }

  linkBooking(sessionId: string, bookingId: string) {
    return this.http.put<{ success: boolean; data: { id: string; service_name: string; start_time: string; status: string } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/link-booking`,
      { bookingId }
    );
  }

  getSuggestedClients(sessionId: string) {
    return this.http.get<{ success: boolean; data: { users: SuggestedClient[]; bookings: SuggestedBooking[] } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/suggested-clients`
    );
  }

  /** F70: Update visitor phone from CRM inline input.
   *  Local session update handled by chatPhoneUpdated socket event effect. */
  updateVisitorPhone(sessionId: string, phone: string) {
    return this.http.put<{ success: boolean; data: { phone: string } }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/phone`,
      { phone },
    );
  }

  updateSessionStatus(sessionId: string, status: 'resolved' | 'closed'): void {
    this.http.put<{ success: boolean; data: OperatorChatSession }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/status`,
      { status }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          const currentFilter = this._statusFilter();
          if (currentFilter !== 'all' && currentFilter !== status) {
            // Фильтр не совпадает → убираем из списка (instant feedback)
            this._sessions.update(sessions => sessions.filter(s => s.id !== sessionId));
          } else {
            // Фильтр совпадает или 'all' → обновляем статус in-place
            this._sessions.update(sessions =>
              sessions.map(s => s.id === sessionId ? { ...s, status } : s)
            );
          }
          if (sessionId === this._activeSessionId()) {
            this.deselectSession();
          }
          // Обновить unified inbox (левая панель)
          this.inboxService.refresh();
        }
      },
    });
  }

  // ── F65: Scheduled Messages ──────────────────────────────────────────

  scheduleMessage(content: string, sendAt: string): void {
    const sessionId = this._activeSessionId();
    if (!sessionId || !content.trim()) return;

    this.http.post<{ success: boolean }>(`/api/visitor-chat/admin/sessions/${sessionId}/schedule-message`, {
      content: content.trim(),
      send_at: sendAt,
    }).subscribe({
      error: (err) => this.log.error('Failed to schedule message', { httpStatus: err?.status }),
    });
  }

  loadScheduledMessages(sessionId: string) {
    return this.http.get<{ success: boolean; data: ScheduledMessage[] }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/scheduled`,
    );
  }

  cancelScheduledMessage(id: string) {
    return this.http.delete<{ success: boolean }>(
      `/api/visitor-chat/admin/scheduled-messages/${id}`,
    );
  }

  // ── Notification sound + desktop notification ───────────────────────

  toggleSoundMute(): void {
    const newVal = !this._soundMuted();
    this._soundMuted.set(newVal);
    try { localStorage.setItem('chat-sound-muted', String(newVal)); } catch { /* */ }
  }

  // DO NOT CHANGE notification sound parameters (frequencies, duration, ramp type) without explicit approval
  private playNotificationSound(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this._soundMuted()) return;
    try {
      if (!this._audioCtx) {
        this._audioCtx = new AudioContext();
      }
      const ctx = this._audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* audio not available */ }
  }

  private showDesktopNotification(wsMsg: { session?: { visitorName: string | null } | null }, chatMsg: OperatorChatMessage): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (document.visibilityState === 'visible') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    try {
      const visitorName = wsMsg.session?.visitorName || chatMsg.sender_name || 'Клиент';
      const preview = (chatMsg.content || 'Новое сообщение').substring(0, 100);
      const n = new Notification(visitorName, {
        body: preview,
        icon: '/web-app-manifest-192x192.png',
        tag: `chat-${chatMsg.session_id}`,
        requireInteraction: false,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      setTimeout(() => n.close(), 5000);
    } catch { /* Notification API not available */ }
  }
}
