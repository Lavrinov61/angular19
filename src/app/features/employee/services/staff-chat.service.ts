import { Injectable, inject, signal, computed, effect, untracked, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, switchMap, filter } from 'rxjs';
import { HttpEventType, type HttpEvent } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { StaffConversation, StaffMessage, StaffMessageView, StaffParticipant } from '../models/staff-chat.model';

interface ConversationsResponse {
  success: boolean;
  data: StaffConversation[];
}

interface MessagesResponse {
  success: boolean;
  data: StaffMessage[];
  hasOlder?: boolean;
}

interface ContactsResponse {
  success: boolean;
  data: StaffParticipant[];
}

interface StaffBookmark {
  bookmark_id: string;
  bookmarked_at: string;
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  message_type: string;
  attachment_url: string | null;
  original_filename: string | null;
  created_at: string;
  conversation_title: string | null;
  conversation_type: string;
}

interface StaffReadReceipt {
  lastReadMessageId: string | null;
  lastReadAt: string | null;
  deliveredAt?: string | null;
}

export interface ChatNotification {
  id: string;
  conversationId: string;
  conversationTitle: string;
  senderName: string;
  preview: string;
  messageType: string;
  timestamp: Date;
}

type ReplySnapshot = Pick<
  StaffMessage,
  | 'reply_to_message_id'
  | 'reply_to_content'
  | 'reply_to_sender_name'
  | 'reply_to_message_type'
  | 'reply_to_attachment_url'
  | 'reply_to_original_filename'
>;

@Injectable({ providedIn: 'root' })
export class StaffChatService {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);

  // State
  private readonly _contactsLoading = signal(false);
  private readonly _contactsError = signal<string | null>(null);
  private readonly _conversations = signal<StaffConversation[]>([]);
  private readonly _activeConversationId = signal<string | null>(null);
  private readonly _messages = signal<StaffMessage[]>([]);
  private readonly _contacts = signal<StaffParticipant[]>([]);
  private readonly _loading = signal(false);
  private readonly _messagesLoading = signal(false);
  private readonly _typingUsers = signal<ReadonlyMap<string, ReadonlyMap<string, string>>>(new Map());
  private readonly _replyTo = signal<StaffMessage | null>(null);
  private readonly _uploading = signal(false);
  private readonly _uploadProgress = signal(0);
  private readonly _editingMessageId = signal<string | null>(null);
  private readonly _hasOlder = signal(false);
  private readonly _loadingOlder = signal(false);
  private readonly _lastError = signal<string | null>(null);
  private readonly _readReceipts = signal<ReadonlyMap<string, StaffReadReceipt>>(new Map());

  private readonly _generalMessages = signal<StaffMessage[]>([]);
  private readonly _generalId = signal<string | null>(null);
  private readonly _mentionCount = signal(0);
  private readonly _presenceMap = signal<ReadonlyMap<string, { online: boolean; lastSeenAt: string }>>(new Map());

  private readonly _mediaItems = signal<StaffMessage[]>([]);
  private readonly _mediaLoading = signal(false);

  private readonly _linkItems = signal<{ id: string; sender_name: string; content: string; urls: string[]; created_at: string }[]>([]);
  private readonly _linksLoading = signal(false);

  // Bookmarks
  private readonly _bookmarks = signal<StaffBookmark[]>([]);
  private readonly _bookmarksLoading = signal(false);
  private readonly _bookmarkedMessageIds = signal<ReadonlySet<string>>(new Set());

  private _initialized = false;
  private _joinedConversations = new Set<string>();
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _generalChatVisible = false;

  // Focus-only markRead: defer HTTP while tab hidden/unfocused
  private _pendingMarkRead = new Set<string>();
  private _focusListener: (() => void) | null = null;
  private _visibilityListener: (() => void) | null = null;

  // Draft persistence
  private _drafts = new Map<string, string>();
  // Notification sound
  private _soundMuted = false;
  private _audioCtx: AudioContext | null = null;
  private _lastSoundTime = 0;
  private readonly SOUND_THROTTLE_MS = 2000;

  // markGeneralRead debounce
  private _markGeneralReadPending = false;

  // Rate-limit cooldown (epoch ms) — when > Date.now(), skip init polls
  private _rateLimitUntil = 0;

  // Public readonly
  readonly contactsLoading = this._contactsLoading.asReadonly();
  readonly contactsError = this._contactsError.asReadonly();
  readonly conversations = this._conversations.asReadonly();
  readonly activeConversationId = this._activeConversationId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly contacts = this._contacts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly messagesLoading = this._messagesLoading.asReadonly();
  readonly typingUsers = this._typingUsers.asReadonly();
  readonly replyTo = this._replyTo.asReadonly();
  readonly uploading = this._uploading.asReadonly();
  readonly uploadProgress = this._uploadProgress.asReadonly();
  readonly editingMessageId = this._editingMessageId.asReadonly();
  readonly hasOlder = this._hasOlder.asReadonly();
  readonly loadingOlder = this._loadingOlder.asReadonly();
  readonly lastError = this._lastError.asReadonly();

  readonly generalMessages = this._generalMessages.asReadonly();
  readonly generalId = this._generalId.asReadonly();
  readonly readReceipts = this._readReceipts.asReadonly();
  readonly mentionCount = this._mentionCount.asReadonly();
  readonly presenceMap = this._presenceMap.asReadonly();

  readonly mediaItems = this._mediaItems.asReadonly();
  readonly mediaLoading = this._mediaLoading.asReadonly();

  readonly linkItems = this._linkItems.asReadonly();
  readonly linksLoading = this._linksLoading.asReadonly();

  readonly bookmarks = this._bookmarks.asReadonly();
  readonly bookmarksLoading = this._bookmarksLoading.asReadonly();
  readonly bookmarkedMessageIds = this._bookmarkedMessageIds.asReadonly();

  readonly soundMuted = signal(false);

  // Notification queue — persistent toasts
  private readonly _notifications = signal<ChatNotification[]>([]);
  readonly notifications = this._notifications.asReadonly();

  dismissNotification(id: string): void {
    this._notifications.update(list => list.filter(n => n.id !== id));
  }

  dismissAllNotifications(): void {
    this._notifications.set([]);
  }

  readonly activeConversation = computed(() => {
    const id = this._activeConversationId();
    return id ? this._conversations().find(c => c.id === id) ?? null : null;
  });

  readonly generalConversation = computed(() =>
    this._conversations().find(c => c.type === 'general') ?? null
  );

  readonly generalUnread = computed(() => {
    const conv = this.generalConversation();
    return conv?.unread_count ?? 0;
  });

  readonly totalUnread = computed(() =>
    this._conversations().reduce((sum, c) => sum + (c.unread_count || 0), 0)
  );

  /** Messages enriched with pre-computed display flags (grouping, date divider, own/avatar). */
  readonly groupedMessages = computed<StaffMessageView[]>(() => {
    const msgs = this._messages();
    const currentUserId = this.authService.currentUser()?.id;
    // Keep threshold in sync with ConversationRoomComponent.isGrouped (2 min)
    const GROUP_THRESHOLD_MS = 2 * 60 * 1000;

    const result: StaffMessageView[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const prev = i > 0 ? msgs[i - 1] : null;
      const msgTs = new Date(msg.created_at).getTime();
      const prevTs = prev ? new Date(prev.created_at).getTime() : 0;

      const _isGrouped = prev !== null
        && prev.sender_id === msg.sender_id
        && !prev.deleted_at
        && (msgTs - prevTs) < GROUP_THRESHOLD_MS;

      const _showDate = !prev
        || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();

      result.push({
        ...msg,
        _isGrouped,
        _showAvatar: !_isGrouped,
        _showDate,
        _isOwn: msg.sender_id === currentUserId,
        _prevTsMs: prevTs,
      });
    }
    return result;
  });

  private readonly messageIndexById = computed<ReadonlyMap<string, number>>(() => {
    const index = new Map<string, number>();
    this._messages().forEach((message, position) => {
      index.set(message.id, position);
    });
    return index;
  });

  // ============================================================================
  // WS Effects
  // ============================================================================

  private readonly messageEffect = effect(() => {
    const evt = this.wsService.staffChatMessage();
    if (!evt) return;
    untracked(() => {
      if (!this._initialized) return;
      const rawMessage = evt.message as unknown;
      const msg = rawMessage as StaffMessage;
      const currentUserId = this.authService.currentUser()?.id;
      const isOwnMessage = msg.sender_id === currentUserId;
      const isActive = evt.conversationId === this._activeConversationId();

      // Update active conversation messages (single update for both own echo-replace and incoming)
      if (isActive) {
        this._messages.update(msgs => {
          if (isOwnMessage) {
            // Echo filter: own messages are already added optimistically via HTTP — replace temp-id
            const tempIdx = msgs.findIndex(m =>
              m.id.startsWith('temp-') && m.content === msg.content && m.sender_id === currentUserId
            );
            if (tempIdx >= 0) {
              const updated = [...msgs];
              updated[tempIdx] = msg;
              return updated;
            }
          }
          // Dedup — skip if already present
          return msgs.some(m => m.id === msg.id) ? msgs : [...msgs, msg];
        });

        if (!isOwnMessage) {
          this.markRead(evt.conversationId);
        }
      }

      // General chat secondary store (for dashboard mini-chat)
      const generalId = this._generalId();
      if (generalId && evt.conversationId === generalId) {
        this._generalMessages.update(msgs => {
          if (isOwnMessage) {
            const tempIdx = msgs.findIndex(m =>
              m.id.startsWith('temp-') && m.content === msg.content && m.sender_id === currentUserId
            );
            if (tempIdx >= 0) {
              const updated = [...msgs];
              updated[tempIdx] = msg;
              return updated;
            }
          }
          return msgs.some(m => m.id === msg.id) ? msgs : [...msgs, msg];
        });
        // Auto-mark read when widget is visible (debounced)
        if (this._generalChatVisible) {
          this.debouncedMarkGeneralRead();
        }
      }

      // Play notification sound for messages from others (throttled: max 1 per 2s)
      if (!isOwnMessage && !this.soundMuted()) {
        const conv = this._conversations().find(c => c.id === evt.conversationId);
        const isMuted = conv?.participants?.find(p => p.user_id === this.authService.currentUser()?.id)?.muted_until;
        const now = Date.now();
        if (!isMuted && now - this._lastSoundTime >= this.SOUND_THROTTLE_MS) {
          this._lastSoundTime = now;
          this.playNotificationSound();
        }
      }

      // Persistent notification (only if not viewing this chat or tab hidden)
      if (!isOwnMessage) {
        const isViewingThisChat = this._activeConversationId() === evt.conversationId && !document.hidden;
        if (!isViewingThisChat) {
          const conv = this._conversations().find(c => c.id === evt.conversationId);
          const senderName = msg.sender_name || 'Коллега';
          const notification: ChatNotification = {
            id: msg.id || crypto.randomUUID(),
            conversationId: evt.conversationId,
            conversationTitle: conv?.title || senderName,
            senderName,
            preview: (msg.content || '').substring(0, 80) || (msg.message_type !== 'text' ? 'Вложение' : ''),
            messageType: msg.message_type || 'text',
            timestamp: new Date(),
          };
          this._notifications.update(list => [...list, notification].slice(-3));
          // Auto-dismiss after 8 seconds
          setTimeout(() => this.dismissNotification(notification.id), 8000);
        }
      }

      // Browser notification for staff chat (tab hidden or not viewing this chat)
      if (!isOwnMessage && isPlatformBrowser(this.platformId)) {
        const isViewingChat = this._activeConversationId() === evt.conversationId && !document.hidden;
        if (!isViewingChat && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const senderName = msg.sender_name || 'Коллега';
            const body = (msg.content || '').substring(0, 60) || (msg.message_type !== 'text' ? 'Вложение' : '');
            const n = new Notification(senderName, {
              body,
              icon: '/web-app-manifest-192x192.png',
              tag: 'staff-chat-message',
              requireInteraction: false,
            });
            setTimeout(() => n.close(), 5000);
            n.onclick = () => { window.focus(); n.close(); };
          } catch { /* SW notification fallback not needed */ }
        }
      }

      // Update conversation list (sort, preview, unread)
      this._conversations.update(convs => {
        const idx = convs.findIndex(c => c.id === evt.conversationId);
        if (idx >= 0) {
          const preview = msg.message_type === 'text'
            ? msg.content.substring(0, 100)
            : msg.message_type === 'image' ? '📷 Фото' : '📎 Файл';
          const updated = {
            ...convs[idx],
            last_message_at: msg.created_at,
            last_message_preview: preview,
            unread_count: (isActive || isOwnMessage) ? 0 : (convs[idx].unread_count || 0) + 1,
          };
          return [updated, ...convs.filter((_, i) => i !== idx)];
        }
        // New conversation — reload list
        this.loadConversations();
        return convs;
      });
    });
  });

  private readonly messageEditedEffect = effect(() => {
    const evt = this.wsService.staffChatMessageEdited();
    if (!evt) return;
    untracked(() => {
      if (!this._initialized) return;

      const editMapper = (m: StaffMessage) =>
        m.id === evt.messageId ? { ...m, content: evt.content, edited_at: evt.editedAt } : m;

      if (evt.conversationId === this._activeConversationId()) {
        this._messages.update(msgs => msgs.map(editMapper));
      }
      if (evt.conversationId === this._generalId()) {
        this._generalMessages.update(msgs => msgs.map(editMapper));
      }
    });
  });

  private readonly messageDeletedEffect = effect(() => {
    const evt = this.wsService.staffChatMessageDeleted();
    if (!evt) return;
    untracked(() => {
      if (!this._initialized) return;

      const deleteMapper = (m: StaffMessage) =>
        m.id === evt.messageId ? { ...m, content: '', deleted_at: new Date().toISOString() } : m;

      if (evt.conversationId === this._activeConversationId()) {
        this._messages.update(msgs => msgs.map(deleteMapper));
      }
      if (evt.conversationId === this._generalId()) {
        this._generalMessages.update(msgs => msgs.map(deleteMapper));
      }
    });
  });

  private readonly typingEffect = effect(() => {
    const evt = this.wsService.staffChatTyping();
    if (!evt || !this._initialized) return;

    const currentUserId = this.authService.currentUser()?.id;
    if (evt.userId === currentUserId) return;

    const key = `${evt.conversationId}:${evt.userId}`;
    const prevTimer = this.typingTimers.get(key);
    if (prevTimer) clearTimeout(prevTimer);

    this._typingUsers.update(map => {
      const next = new Map(map);
      const convTypers = new Map(next.get(evt.conversationId) || []);
      if (evt.isTyping) {
        convTypers.set(evt.userId, evt.userId);
      } else {
        convTypers.delete(evt.userId);
      }
      if (convTypers.size > 0) {
        next.set(evt.conversationId, convTypers);
      } else {
        next.delete(evt.conversationId);
      }
      return next;
    });

    if (evt.isTyping) {
      const timer = setTimeout(() => {
        this._typingUsers.update(map => {
          const next = new Map(map);
          const convTypers = new Map(next.get(evt.conversationId) || []);
          convTypers.delete(evt.userId);
          if (convTypers.size > 0) {
            next.set(evt.conversationId, convTypers);
          } else {
            next.delete(evt.conversationId);
          }
          return next;
        });
        this.typingTimers.delete(key);
      }, 5000);
      this.typingTimers.set(key, timer);
    }
  });

  private readonly userLeftEffect = effect(() => {
    const evt = this.wsService.staffChatUserLeft();
    if (!evt || !this._initialized) return;

    const currentUserId = this.authService.currentUser()?.id;
    if (evt.userId === currentUserId) {
      // I was removed — remove conversation from list
      this._conversations.update(convs => convs.filter(c => c.id !== evt.conversationId));
      if (this._activeConversationId() === evt.conversationId) {
        this.deselectConversation();
      }
      this._joinedConversations.delete(evt.conversationId);
      this.wsService.leaveStaffChat(evt.conversationId);
    } else {
      // Another user left — update participants
      this._conversations.update(convs =>
        convs.map(c => c.id === evt.conversationId
          ? { ...c, participants: c.participants.filter(p => p.user_id !== evt.userId) }
          : c
        )
      );
    }
  });

  private readonly userJoinedEffect = effect(() => {
    const evt = this.wsService.staffChatUserJoined();
    if (!evt || !this._initialized) return;

    // Reload conversation info to get updated participants
    if (evt.conversationId === this._activeConversationId()) {
      this.loadConversations();
    }
  });

  private readonly conversationUpdatedEffect = effect(() => {
    const evt = this.wsService.staffChatConversationUpdated();
    if (!evt || !this._initialized) return;

    this._conversations.update(convs =>
      convs.map(c => c.id === evt.conversationId
        ? { ...c, title: evt.title }
        : c
      )
    );
  });

  private readonly readReceiptEffect = effect(() => {
    const evt = this.wsService.staffChatRead();
    if (!evt || !this._initialized) return;

    const currentUserId = this.authService.currentUser()?.id;
    const activeId = this._activeConversationId();

    // Update unread count to 0 for our own read events
    if (evt.userId === currentUserId) {
      this._conversations.update(convs =>
        convs.map(c => c.id === evt.conversationId ? { ...c, unread_count: 0 } : c)
      );
    }

    // Update per-user receipt map for active conversation from WS payload — no HTTP refetch
    if (evt.conversationId === activeId) {
      this._readReceipts.update(prev => {
        const next = new Map(prev);
        const existing = next.get(evt.userId);
        next.set(evt.userId, {
          lastReadMessageId: evt.lastReadMessageId ?? existing?.lastReadMessageId ?? null,
          lastReadAt: evt.lastReadAt ?? existing?.lastReadAt ?? new Date().toISOString(),
          deliveredAt: existing?.deliveredAt,
        });
        return next;
      });
    }
  });

  private readonly deliveredEffect = effect(() => {
    const evt = this.wsService.staffChatDelivered();
    if (!evt || !this._initialized) return;
    const currentUserId = this.authService.currentUser()?.id;
    if (evt.userId === currentUserId) return;
    const activeId = this._activeConversationId();
    if (evt.conversationId !== activeId) return;

    this._readReceipts.update(prev => {
      const next = new Map(prev);
      const existing = next.get(evt.userId);
      next.set(evt.userId, {
        lastReadMessageId: existing?.lastReadMessageId ?? null,
        lastReadAt: existing?.lastReadAt ?? null,
        deliveredAt: evt.deliveredAt,
      });
      return next;
    });
  });

  private readonly mentionEffect = effect(() => {
    const evt = this.wsService.staffChatMention();
    if (!evt || !this._initialized) return;
    this._mentionCount.update(c => c + 1);
  });

  private readonly presenceChangeEffect = effect(() => {
    const evt = this.wsService.staffChatPresenceChange();
    if (!evt || !this._initialized) return;
    this._presenceMap.update(prev => {
      const next = new Map(prev);
      next.set(evt.userId, { online: evt.online, lastSeenAt: evt.lastSeenAt });
      return next;
    });
  });

  // Rebase state on WebSocket reconnect (replaces periodic polling).
  // Throttle: NAT/firewall flapping triggered reconnect каждые 30с → 5 req × 2 = 10/min burst.
  private _lastRebaseAt = 0;
  private readonly reconnectRebaseEffect = effect(() => {
    const ts = this.wsService.reconnected();
    if (ts === 0 || !this._initialized) return;
    untracked(() => {
      if (Date.now() < this._rateLimitUntil) return;
      if (Date.now() - this._lastRebaseAt < 10_000) return;
      this._lastRebaseAt = Date.now();
      this.loadConversations();
      const activeId = this._activeConversationId();
      if (activeId) {
        this.loadMessages(activeId);
        this.loadReadReceipts(activeId);
        this.loadPinnedMessages();
      }
      this.loadPresence();
    });
  });

  // ============================================================================
  // Lifecycle
  // ============================================================================

  init(): void {
    if (this._initialized || !isPlatformBrowser(this.platformId)) return;
    this._initialized = true;

    // Load drafts from localStorage
    try {
      const raw = localStorage.getItem('staff-chat-drafts');
      if (raw) this._drafts = new Map(JSON.parse(raw));
    } catch { /* ignore corrupt data */ }

    // Load sound preference (wrapped: localStorage может быть заблокирован)
    try {
      this.soundMuted.set(localStorage.getItem('staff-chat-sound-muted') === 'true');
    } catch { /* ignore */ }

    this.loadConversations();
    this.loadPresence();

    // Focus-only markRead trigger: flush deferred reads when tab returns
    const onFocus = () => this.drainPendingMarkRead();
    const onVisibility = () => {
      if (!document.hidden) this.drainPendingMarkRead();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    this._focusListener = onFocus;
    this._visibilityListener = onVisibility;

    this.destroyRef.onDestroy(() => {
      for (const convId of this._joinedConversations) {
        this.wsService.leaveStaffChat(convId);
      }
      this._joinedConversations.clear();
      for (const timer of this.typingTimers.values()) {
        clearTimeout(timer);
      }
      this.typingTimers.clear();
      if (this._focusListener) {
        window.removeEventListener('focus', this._focusListener);
        this._focusListener = null;
      }
      if (this._visibilityListener) {
        document.removeEventListener('visibilitychange', this._visibilityListener);
        this._visibilityListener = null;
      }
      this._pendingMarkRead.clear();
      this._initialized = false;
    });
  }

  // ============================================================================
  // Conversations
  // ============================================================================

  loadConversations(): void {
    this._loading.set(true);

    const params: Record<string, string> = {};
    if (this._showArchived()) params['archived'] = 'true';

    const obs = this.guardedGet<ConversationsResponse>('/api/staff-chat/conversations', { params });
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          this._conversations.set(res.data);
          for (const conv of res.data) {
            if (!this._joinedConversations.has(conv.id)) {
              this.wsService.joinStaffChat(conv.id);
              this._joinedConversations.add(conv.id);
            }
            if (conv.type === 'general' && !this._generalId()) {
              this._generalId.set(conv.id);
            }
          }
          // Auto-mark general chat read when dashboard widget is visible
          if (this._generalChatVisible) {
            this.markGeneralRead();
          }
        }
        this._loading.set(false);
      },
      error: (err) => this.handleHttpError(err, 'conversations'),
    });
  }

  loadReadReceipts(conversationId: string): void {
    const obs = this.guardedGet<{ success: boolean; data: { user_id: string; last_read_message_id: string | null; last_read_at: string | null; delivered_at?: string | null }[] }>(
      `/api/staff-chat/conversations/${conversationId}/read-receipts`,
    );
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          const next = new Map<string, StaffReadReceipt>();
          for (const r of res.data) {
            next.set(r.user_id, {
              lastReadMessageId: r.last_read_message_id,
              lastReadAt: r.last_read_at,
              deliveredAt: r.delivered_at ?? undefined,
            });
          }
          this._readReceipts.set(next);
        }
      },
      error: (err) => this.handleHttpError(err, 'read-receipts'),
    });
  }

  /** Check if a message has been read by the other party (for direct chats) */
  isMessageReadByOther(messageId: string, messageCreatedAt: string): boolean {
    return this.getMessageReadState(messageId, messageCreatedAt) === 'read';
  }

  /** Return 3-state message delivery status from sender's perspective (direct chats). */
  getMessageReadState(messageId: string, messageCreatedAt: string): 'sent' | 'delivered' | 'read' {
    const currentUserId = this.authService.currentUser()?.id;
    const receipts = this._readReceipts();
    const msgTs = new Date(messageCreatedAt).getTime();
    const messageIndexes = this.messageIndexById();
    const messageIndex = messageIndexes.get(messageId);

    let delivered = false;
    for (const [userId, receipt] of receipts) {
      if (userId === currentUserId) continue;

      if (receipt.lastReadMessageId) {
        if (receipt.lastReadMessageId === messageId) {
          return 'read';
        }

        const readIndex = messageIndexes.get(receipt.lastReadMessageId);
        if (messageIndex !== undefined && readIndex !== undefined && readIndex >= messageIndex) {
          return 'read';
        }

        if (this.isReceiptAtOrAfter(receipt.lastReadAt, msgTs)) {
          return 'read';
        }
      }

      if (this.isReceiptAtOrAfter(receipt.deliveredAt, msgTs)) {
        delivered = true;
      }
    }
    return delivered ? 'delivered' : 'sent';
  }

  private isReceiptAtOrAfter(receiptAt: string | null | undefined, messageTs: number): boolean {
    if (!receiptAt || !Number.isFinite(messageTs)) return false;
    const receiptTs = new Date(receiptAt).getTime();
    return Number.isFinite(receiptTs) && receiptTs >= messageTs;
  }

  selectConversation(conversationId: string): void {
    // Guard: re-selecting same conversation is a no-op (ломает infinite loop
    // когда sessionEffect в conversation-room retriggers на каждый change detection).
    if (this._activeConversationId() === conversationId) return;
    this._activeConversationId.set(conversationId);
    this._messages.set([]);
    this._replyTo.set(null);
    this._editingMessageId.set(null);
    this._hasOlder.set(false);
    this.loadMessages(conversationId);
    this.markRead(conversationId);
    this.loadReadReceipts(conversationId);
  }

  deselectConversation(): void {
    this._activeConversationId.set(null);
    this._messages.set([]);
    this._replyTo.set(null);
    this._editingMessageId.set(null);
  }

  // ============================================================================
  // Messages
  // ============================================================================

  private loadMessages(conversationId: string): void {
    this._messagesLoading.set(true);
    const obs = this.guardedGet<MessagesResponse>(`/api/staff-chat/conversations/${conversationId}/messages`);
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.set(res.data);
          this._hasOlder.set(res.hasOlder ?? false);
        }
        this._messagesLoading.set(false);
      },
      error: (err) => this.handleHttpError(err, 'messages'),
    });
  }

  loadOlderMessages(): void {
    const convId = this._activeConversationId();
    if (!convId || this._loadingOlder() || !this._hasOlder()) return;

    const msgs = this._messages();
    if (msgs.length === 0) return;
    const oldestTs = msgs[0].created_at;

    this._loadingOlder.set(true);
    this.http.get<MessagesResponse>(
      `/api/staff-chat/conversations/${convId}/messages`,
      { params: { before: oldestTs, limit: '50' } },
    ).subscribe({
      next: (res) => {
        if (res.success && res.data.length > 0) {
          this._messages.update(current => [...res.data, ...current]);
          this._hasOlder.set(res.hasOlder ?? false);
        } else {
          this._hasOlder.set(false);
        }
        this._loadingOlder.set(false);
      },
      error: () => this._loadingOlder.set(false),
    });
  }

  private replySnapshot(replyTo: StaffMessage | null | undefined): ReplySnapshot {
    return {
      reply_to_message_id: replyTo?.id ?? null,
      reply_to_content: this.replyPreviewText(replyTo),
      reply_to_sender_name: replyTo?.sender_name ?? null,
      reply_to_message_type: replyTo?.message_type ?? null,
      reply_to_attachment_url: replyTo?.attachment_url ?? null,
      reply_to_original_filename: replyTo?.original_filename ?? null,
    };
  }

  private replyPreviewText(replyTo: StaffMessage | null | undefined): string | null {
    if (!replyTo) return null;

    const content = replyTo.content?.trim() ?? '';
    const filename = replyTo.original_filename?.trim() ?? '';
    const hasCaption = content.length > 0 && content !== filename;

    if (replyTo.message_type === 'image') return (hasCaption ? content : 'Фото').substring(0, 200);
    if (replyTo.message_type === 'video') return (hasCaption ? content : 'Видео').substring(0, 200);
    if (replyTo.message_type === 'audio') return (hasCaption ? content : 'Аудио').substring(0, 200);
    if (replyTo.attachment_url) return (hasCaption ? content : filename || 'Файл').substring(0, 200);
    return content.substring(0, 200) || null;
  }

  sendMessage(content: string): void {
    const convId = this._activeConversationId();
    if (!convId || !content.trim()) return;

    const user = this.authService.currentUser();
    const senderName = user?.display_name || user?.email || 'Сотрудник';
    const replyTo = this._replyTo();
    const reply = this.replySnapshot(replyTo);

    // Optimistic add
    const tempMsg: StaffMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      sender_id: user?.id || '',
      sender_name: senderName,
      content: content.trim(),
      message_type: 'text',
      attachment_url: null,
      original_filename: null,
      ...reply,
      created_at: new Date().toISOString(),
    };
    this._messages.update(msgs => [...msgs, tempMsg]);
    this._replyTo.set(null);
    this._lastError.set(null);

    this.http.post<{ success: boolean; data: StaffMessage }>(
      `/api/staff-chat/conversations/${convId}/messages`,
      { content: content.trim(), replyToMessageId: replyTo?.id || undefined }
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data : m)
          );
        }
      },
      error: () => {
        this._messages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
        this._lastError.set('Не удалось отправить сообщение');
      },
    });
  }

  uploadFile(file: File, caption?: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;

    const user = this.authService.currentUser();
    const senderName = user?.display_name || user?.email || 'Сотрудник';
    const replyTo = this._replyTo();
    const reply = this.replySnapshot(replyTo);
    const isImage = file.type.startsWith('image/');

    // Optimistic add
    const tempMsg: StaffMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      sender_id: user?.id || '',
      sender_name: senderName,
      content: caption || file.name,
      message_type: isImage ? 'image' : 'file',
      attachment_url: isImage ? URL.createObjectURL(file) : null,
      original_filename: file.name,
      ...reply,
      created_at: new Date().toISOString(),
    };
    this._messages.update(msgs => [...msgs, tempMsg]);
    this._replyTo.set(null);
    this._uploading.set(true);
    this._lastError.set(null);

    // Presigned S3 upload: presign → PUT to S3 (with progress) → complete
    const presignUrl = `/api/staff-chat/conversations/${convId}/direct-upload/presign`;
    const completeUrl = `/api/staff-chat/conversations/${convId}/direct-upload/complete`;
    this._uploadProgress.set(0);

    this.http.post<{ success: boolean; data: { uploads: { s3Key: string; uploadUrl: string }[] } }>(
      presignUrl,
      { files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }] },
    ).pipe(
      switchMap(presignRes => {
        const { s3Key, uploadUrl } = presignRes.data.uploads[0];
        return this.http.put(uploadUrl, file, {
          headers: { 'Content-Type': file.type },
          reportProgress: true,
          observe: 'events',
        }).pipe(
          filter((event: HttpEvent<unknown>) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              this._uploadProgress.set(Math.round(100 * event.loaded / event.total));
            }
            return event.type === HttpEventType.Response;
          }),
          switchMap(() => this.http.post<{ success: boolean; data: StaffMessage[] }>(
            completeUrl,
            { files: [{ s3Key, fileName: file.name, contentType: file.type, fileSize: file.size }], caption, replyToMessageId: replyTo?.id || undefined },
          )),
        );
      }),
    ).subscribe({
      next: (res) => {
        if (res.success && res.data[0]) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data[0] : m)
          );
        }
        this._uploadProgress.set(100);
        this._uploading.set(false);
        setTimeout(() => this._uploadProgress.set(0), 500);
      },
      error: () => {
        this._messages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
        this._uploading.set(false);
        this._uploadProgress.set(0);
        this._lastError.set('Не удалось загрузить файл');
      },
    });
  }

  // ============================================================================
  // General Chat (dashboard mini-chat secondary store)
  // ============================================================================

  loadGeneralMessages(): void {
    const convId = this._generalId();
    if (!convId) return;

    this.http.get<MessagesResponse>(
      `/api/staff-chat/conversations/${convId}/messages`,
      { params: { limit: '30' } },
    ).subscribe({
      next: (res) => {
        if (res.success) this._generalMessages.set(res.data);
      },
    });
  }

  sendGeneralMessage(content: string, replyToMessageId?: string): void {
    const convId = this._generalId();
    if (!convId || !content.trim()) return;

    const user = this.authService.currentUser();
    const senderName = user?.display_name || user?.email || 'Сотрудник';

    const replyMsg = replyToMessageId
      ? this._generalMessages().find(m => m.id === replyToMessageId)
      : null;
    const reply = this.replySnapshot(replyMsg);

    const tempMsg: StaffMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      sender_id: user?.id || '',
      sender_name: senderName,
      content: content.trim(),
      message_type: 'text',
      attachment_url: null,
      original_filename: null,
      ...reply,
      created_at: new Date().toISOString(),
    };
    this._generalMessages.update(msgs => [...msgs, tempMsg]);

    this.http.post<{ success: boolean; data: StaffMessage }>(
      `/api/staff-chat/conversations/${convId}/messages`,
      { content: content.trim(), replyToMessageId: replyToMessageId || undefined },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._generalMessages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data : m)
          );
        }
      },
      error: () => {
        this._generalMessages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
      },
    });
  }

  uploadGeneralFile(file: File, caption?: string, replyToMessageId?: string): void {
    const convId = this._generalId();
    if (!convId) return;

    const user = this.authService.currentUser();
    const senderName = user?.display_name || user?.email || 'Сотрудник';
    const isImage = file.type.startsWith('image/');

    const replyMsg = replyToMessageId
      ? this._generalMessages().find(m => m.id === replyToMessageId)
      : null;
    const reply = this.replySnapshot(replyMsg);

    const tempMsg: StaffMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      sender_id: user?.id || '',
      sender_name: senderName,
      content: caption || file.name,
      message_type: isImage ? 'image' : 'file',
      attachment_url: isImage ? URL.createObjectURL(file) : null,
      original_filename: file.name,
      ...reply,
      created_at: new Date().toISOString(),
    };
    this._generalMessages.update(msgs => [...msgs, tempMsg]);
    this._uploading.set(true);
    this._uploadProgress.set(0);

    // Presigned S3 upload: presign → PUT to S3 (with progress) → complete
    const presignUrl = `/api/staff-chat/conversations/${convId}/direct-upload/presign`;
    const completeUrl = `/api/staff-chat/conversations/${convId}/direct-upload/complete`;

    this.http.post<{ success: boolean; data: { uploads: { s3Key: string; uploadUrl: string }[] } }>(
      presignUrl,
      { files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }] },
    ).pipe(
      switchMap(presignRes => {
        const { s3Key, uploadUrl } = presignRes.data.uploads[0];
        return this.http.put(uploadUrl, file, {
          headers: { 'Content-Type': file.type },
          reportProgress: true,
          observe: 'events',
        }).pipe(
          filter((event: HttpEvent<unknown>) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              this._uploadProgress.set(Math.round(100 * event.loaded / event.total));
            }
            return event.type === HttpEventType.Response;
          }),
          switchMap(() => this.http.post<{ success: boolean; data: StaffMessage[] }>(
            completeUrl,
            { files: [{ s3Key, fileName: file.name, contentType: file.type, fileSize: file.size }], caption, replyToMessageId: replyToMessageId || undefined },
          )),
        );
      }),
    ).subscribe({
      next: (res) => {
        if (res.success && res.data[0]) {
          this._generalMessages.update(msgs =>
            msgs.map(m => m.id === tempMsg.id ? res.data[0] : m)
          );
        }
        this._uploadProgress.set(100);
        this._uploading.set(false);
        setTimeout(() => this._uploadProgress.set(0), 500);
      },
      error: () => {
        this._generalMessages.update(msgs => msgs.filter(m => m.id !== tempMsg.id));
        this._uploading.set(false);
        this._uploadProgress.set(0);
      },
    });
  }

  searchGeneralMessages(query: string): void {
    const convId = this._generalId();
    if (!convId || query.trim().length < 2) {
      this._searchResults.set([]);
      this._searchHasMore.set(false);
      return;
    }
    this._searching.set(true);
    this.http.get<{ success: boolean; data: StaffMessage[]; hasMore: boolean }>(
      `/api/staff-chat/conversations/${convId}/search`,
      { params: { q: query.trim() } },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._searchResults.set(res.data);
          this._searchHasMore.set(res.hasMore);
        }
        this._searching.set(false);
      },
      error: () => this._searching.set(false),
    });
  }

  sendGeneralTyping(isTyping: boolean): void {
    const convId = this._generalId();
    if (convId) {
      this.wsService.sendStaffTyping(convId, isTyping);
    }
  }

  createGeneralConversation(): void {
    this.http.post<{ success: boolean; data: { id: string } }>(
      '/api/staff-chat/conversations',
      { title: 'Общий чат', type: 'general', participantIds: [] },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._generalId.set(res.data.id);
          this.wsService.joinStaffChat(res.data.id);
          this._joinedConversations.add(res.data.id);
          this._generalMessages.set([]);
          this.loadConversations();
        }
      },
    });
  }

  // ============================================================================
  // Edit / Delete
  // ============================================================================

  startEditing(messageId: string): void {
    this._editingMessageId.set(messageId);
  }

  cancelEditing(): void {
    this._editingMessageId.set(null);
  }

  editMessage(messageId: string, newContent: string): void {
    const convId = this._activeConversationId();
    if (!convId || !newContent.trim()) return;

    // Optimistic update
    this._messages.update(msgs =>
      msgs.map(m => m.id === messageId
        ? { ...m, content: newContent.trim(), edited_at: new Date().toISOString() }
        : m
      )
    );
    this._editingMessageId.set(null);
    this._lastError.set(null);

    this.http.put<{ success: boolean; data: StaffMessage }>(
      `/api/staff-chat/conversations/${convId}/messages/${messageId}`,
      { content: newContent.trim() },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === messageId ? res.data : m)
          );
        }
      },
      error: (err) => {
        // Revert — reload messages
        this.loadMessages(convId);
        this._lastError.set(err.error?.message || 'Не удалось редактировать');
      },
    });
  }

  deleteMessage(messageId: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;

    // Optimistic soft-delete
    this._messages.update(msgs =>
      msgs.map(m => m.id === messageId
        ? { ...m, content: '', deleted_at: new Date().toISOString() }
        : m
      )
    );
    this._lastError.set(null);

    this.http.delete<{ success: boolean }>(
      `/api/staff-chat/conversations/${convId}/messages/${messageId}`,
    ).subscribe({
      error: (err) => {
        this.loadMessages(convId);
        this._lastError.set(err.error?.message || 'Не удалось удалить');
      },
    });
  }

  editGeneralMessage(messageId: string, newContent: string): void {
    const convId = this._generalId();
    if (!convId || !newContent.trim()) return;

    this._generalMessages.update(msgs =>
      msgs.map(m => m.id === messageId
        ? { ...m, content: newContent.trim(), edited_at: new Date().toISOString() }
        : m
      )
    );

    this.http.put<{ success: boolean; data: StaffMessage }>(
      `/api/staff-chat/conversations/${convId}/messages/${messageId}`,
      { content: newContent.trim() },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._generalMessages.update(msgs =>
            msgs.map(m => m.id === messageId ? res.data : m)
          );
        }
      },
      error: () => this.loadGeneralMessages(),
    });
  }

  deleteGeneralMessage(messageId: string): void {
    const convId = this._generalId();
    if (!convId) return;

    this._generalMessages.update(msgs =>
      msgs.map(m => m.id === messageId
        ? { ...m, content: '', deleted_at: new Date().toISOString() }
        : m
      )
    );

    this.http.delete<{ success: boolean }>(
      `/api/staff-chat/conversations/${convId}/messages/${messageId}`,
    ).subscribe({
      error: () => this.loadGeneralMessages(),
    });
  }

  // ============================================================================
  // Conversation Management
  // ============================================================================

  leaveConversation(conversationId: string): void {
    this.http.delete<{ success: boolean }>(
      `/api/staff-chat/conversations/${conversationId}/leave`,
    ).subscribe({
      next: () => {
        this._conversations.update(convs => convs.filter(c => c.id !== conversationId));
        if (this._activeConversationId() === conversationId) {
          this.deselectConversation();
        }
        this._joinedConversations.delete(conversationId);
        this.wsService.leaveStaffChat(conversationId);
      },
      error: (err) => {
        this._lastError.set(err.error?.message || 'Не удалось покинуть чат');
      },
    });
  }

  renameConversation(conversationId: string, newTitle: string): void {
    if (!newTitle.trim()) return;

    this.http.put<{ success: boolean }>(
      `/api/staff-chat/conversations/${conversationId}`,
      { title: newTitle.trim() },
    ).subscribe({
      next: () => {
        this._conversations.update(convs =>
          convs.map(c => c.id === conversationId ? { ...c, title: newTitle.trim() } : c)
        );
      },
      error: (err) => {
        this._lastError.set(err.error?.message || 'Не удалось переименовать');
      },
    });
  }

  addMember(conversationId: string, userId: string): void {
    this.http.post<{ success: boolean }>(
      `/api/staff-chat/conversations/${conversationId}/members`,
      { userId },
    ).subscribe({
      next: () => this.loadConversations(),
      error: (err) => {
        this._lastError.set(err.error?.message || 'Не удалось добавить участника');
      },
    });
  }

  removeMember(conversationId: string, userId: string): void {
    this.http.delete<{ success: boolean }>(
      `/api/staff-chat/conversations/${conversationId}/members/${userId}`,
    ).subscribe({
      next: () => this.loadConversations(),
      error: (err) => {
        this._lastError.set(err.error?.message || 'Не удалось удалить участника');
      },
    });
  }

  muteConversation(conversationId: string, until: Date | null): void {
    this.http.put<{ success: boolean }>(
      `/api/staff-chat/conversations/${conversationId}/settings`,
      { mutedUntil: until?.toISOString() || null },
    ).subscribe({
      error: (err) => {
        this._lastError.set(err.error?.message || 'Ошибка настроек');
      },
    });
  }

  // ============================================================================
  // Reactions
  // ============================================================================

  private readonly reactionAddedEffect = effect(() => {
    const evt = this.wsService.staffChatReactionAdded();
    if (!evt || !this._initialized) return;
    const applyAdd = (msgs: StaffMessage[]): StaffMessage[] => msgs.map(m => {
      if (m.id !== evt.messageId) return m;
      const reactions = [...(m.reactions || [])];
      const existing = reactions.find(r => r.emoji === evt.emoji);
      if (existing) {
        if (!existing.users.includes(evt.userId)) {
          existing.users = [...existing.users, evt.userId];
          existing.count++;
          existing.myReaction = existing.myReaction || evt.userId === this.authService.currentUser()?.id;
        }
      } else {
        reactions.push({
          emoji: evt.emoji,
          count: 1,
          users: [evt.userId],
          myReaction: evt.userId === this.authService.currentUser()?.id,
        });
      }
      return { ...m, reactions };
    });
    if (evt.conversationId === this._activeConversationId()) {
      this._messages.update(applyAdd);
    }
    if (evt.conversationId === this._generalId()) {
      this._generalMessages.update(applyAdd);
    }
  });

  private readonly reactionRemovedEffect = effect(() => {
    const evt = this.wsService.staffChatReactionRemoved();
    if (!evt || !this._initialized) return;
    const applyRemove = (msgs: StaffMessage[]): StaffMessage[] => msgs.map(m => {
      if (m.id !== evt.messageId) return m;
      const reactions = [...(m.reactions || [])];
      const idx = reactions.findIndex(r => r.emoji === evt.emoji);
      if (idx >= 0) {
        const r = reactions[idx];
        r.users = r.users.filter(u => u !== evt.userId);
        r.count = Math.max(0, r.count - 1);
        r.myReaction = r.users.includes(this.authService.currentUser()?.id || '');
        if (r.count === 0) reactions.splice(idx, 1);
      }
      return { ...m, reactions };
    });
    if (evt.conversationId === this._activeConversationId()) {
      this._messages.update(applyRemove);
    }
    if (evt.conversationId === this._generalId()) {
      this._generalMessages.update(applyRemove);
    }
  });

  addReaction(messageId: string, emoji: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    this.http.post(`/api/staff-chat/conversations/${convId}/messages/${messageId}/reactions`, { emoji }).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка реакции'),
    });
  }

  removeReaction(messageId: string, emoji: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    this.http.delete(`/api/staff-chat/conversations/${convId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка реакции'),
    });
  }

  toggleReaction(messageId: string, emoji: string): void {
    const msg = this._messages().find(m => m.id === messageId);
    const existing = msg?.reactions?.find(r => r.emoji === emoji);
    if (existing?.myReaction) {
      this.removeReaction(messageId, emoji);
    } else {
      this.addReaction(messageId, emoji);
    }
  }

  toggleGeneralReaction(messageId: string, emoji: string): void {
    const convId = this._generalId();
    if (!convId) return;
    const msg = this._generalMessages().find(m => m.id === messageId);
    const existing = msg?.reactions?.find(r => r.emoji === emoji);
    if (existing?.myReaction) {
      this.http.delete(`/api/staff-chat/conversations/${convId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`).subscribe({
        error: (err) => this._lastError.set(err.error?.message || 'Ошибка реакции'),
      });
    } else {
      this.http.post(`/api/staff-chat/conversations/${convId}/messages/${messageId}/reactions`, { emoji }).subscribe({
        error: (err) => this._lastError.set(err.error?.message || 'Ошибка реакции'),
      });
    }
  }

  // ============================================================================
  // Pin
  // ============================================================================

  private readonly _pinnedMessages = signal<StaffMessage[]>([]);
  readonly pinnedMessages = this._pinnedMessages.asReadonly();

  private readonly messagePinnedEffect = effect(() => {
    const evt = this.wsService.staffChatMessagePinned();
    if (!evt || !this._initialized) return;
    if (evt.conversationId === this._activeConversationId()) {
      this._messages.update(msgs =>
        msgs.map(m => m.id === evt.messageId ? { ...m, pinned_at: new Date().toISOString() } : m)
      );
      // Add to pinned list (find from messages)
      const msg = this._messages().find(m => m.id === evt.messageId);
      if (msg && !this._pinnedMessages().some(m => m.id === evt.messageId)) {
        this._pinnedMessages.update(prev => [...prev, { ...msg, pinned_at: new Date().toISOString() }]);
      }
    }
  });

  private readonly messageUnpinnedEffect = effect(() => {
    const evt = this.wsService.staffChatMessageUnpinned();
    if (!evt || !this._initialized) return;
    if (evt.conversationId === this._activeConversationId()) {
      this._messages.update(msgs =>
        msgs.map(m => m.id === evt.messageId ? { ...m, pinned_at: null } : m)
      );
      this._pinnedMessages.update(msgs => msgs.filter(m => m.id !== evt.messageId));
    }
  });

  pinMessage(messageId: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    this.http.put(`/api/staff-chat/conversations/${convId}/messages/${messageId}/pin`, { pinned: true }).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка закрепления'),
    });
  }

  unpinMessage(messageId: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    this.http.put(`/api/staff-chat/conversations/${convId}/messages/${messageId}/pin`, { pinned: false }).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка открепления'),
    });
  }

  loadPinnedMessages(): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    const obs = this.guardedGet<{ success: boolean; data: StaffMessage[] }>(
      `/api/staff-chat/conversations/${convId}/pinned`,
    );
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) this._pinnedMessages.set(res.data);
      },
      error: (err) => this.handleHttpError(err, 'pinned'),
    });
  }

  // ============================================================================
  // Search
  // ============================================================================

  private readonly _searchResults = signal<StaffMessage[]>([]);
  private readonly _searching = signal(false);
  private readonly _searchHasMore = signal(false);
  private _lastSearchQuery = '';
  readonly searchResults = this._searchResults.asReadonly();
  readonly searching = this._searching.asReadonly();
  readonly searchHasMore = this._searchHasMore.asReadonly();

  searchMessages(query: string, offset = 0): void {
    const convId = this._activeConversationId();
    if (!convId || query.trim().length < 2) {
      this._searchResults.set([]);
      this._searchHasMore.set(false);
      return;
    }
    this._searching.set(true);
    this._lastSearchQuery = query.trim();
    if (offset === 0) this._searchResults.set([]);

    const obs = this.guardedGet<{ success: boolean; data: StaffMessage[]; hasMore: boolean }>(
      `/api/staff-chat/conversations/${convId}/search`,
      { params: { q: query.trim(), offset: String(offset) } },
    );
    if (!obs) {
      this._searching.set(false);
      return;
    }
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          if (offset === 0) {
            this._searchResults.set(res.data);
          } else {
            this._searchResults.update(prev => [...prev, ...res.data]);
          }
          this._searchHasMore.set(res.hasMore);
        }
        this._searching.set(false);
      },
      error: (err) => {
        this._searching.set(false);
        this.handleHttpError(err, 'search');
      },
    });
  }

  loadMoreSearchResults(): void {
    if (!this._lastSearchQuery || !this._searchHasMore()) return;
    this.searchMessages(this._lastSearchQuery, this._searchResults().length);
  }

  clearSearch(): void {
    this._searchResults.set([]);
    this._searchHasMore.set(false);
    this._lastSearchQuery = '';
  }

  filterConversations(query: string): void {
    const params: Record<string, string> = {};
    if (query.trim()) params['q'] = query.trim();
    const obs = this.guardedGet<ConversationsResponse>('/api/staff-chat/conversations', { params });
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) this._conversations.set(res.data);
      },
      error: (err) => this.handleHttpError(err, 'conversations'),
    });
  }

  // ============================================================================
  // Forward (single + multi)
  // ============================================================================

  forwardMessage(messageId: string, targetConversationId: string): void {
    const convId = this._activeConversationId();
    if (!convId) return;
    this.http.post<{ success: boolean }>(`/api/staff-chat/conversations/${convId}/forward`, {
      messageId,
      targetConversationId,
    }).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка пересылки'),
    });
  }

  forwardMessages(fromConvId: string, toConvId: string, messageIds: string[]): void {
    if (!fromConvId || !toConvId || messageIds.length === 0) return;
    this.http.post<{ success: boolean }>(`/api/staff-chat/conversations/${fromConvId}/forward`, {
      messageIds,
      targetConversationId: toConvId,
    }).subscribe({
      error: (err) => this._lastError.set(err.error?.message || 'Ошибка пересылки'),
    });
  }

  // ============================================================================
  // Batch Delete
  // ============================================================================

  batchDeleteMessages(convId: string, messageIds: string[]): void {
    if (!convId || messageIds.length === 0) return;

    // Optimistic soft-delete
    const idsSet = new Set(messageIds);
    this._messages.update(msgs =>
      msgs.map(m => idsSet.has(m.id)
        ? { ...m, content: '', deleted_at: new Date().toISOString() }
        : m
      )
    );
    this._lastError.set(null);

    this.http.delete<{ success: boolean; deletedCount: number }>(
      `/api/staff-chat/conversations/${convId}/messages/batch`,
      { body: { messageIds } },
    ).subscribe({
      error: (err) => {
        this.loadMessages(convId);
        this._lastError.set(err.error?.message || 'Не удалось удалить сообщения');
      },
    });
  }

  // ============================================================================
  // Archive / Unarchive
  // ============================================================================

  private readonly _showArchived = signal(false);
  readonly showArchived = this._showArchived.asReadonly();

  toggleShowArchived(): void {
    this._showArchived.update(v => !v);
    this.loadConversations();
  }

  archiveConversation(id: string): void {
    this.http.put<{ success: boolean }>(`/api/staff-chat/conversations/${id}/archive`, {}).subscribe({
      next: () => {
        this._conversations.update(convs => convs.filter(c => c.id !== id));
        if (this._activeConversationId() === id) {
          this.deselectConversation();
        }
      },
      error: (err) => this._lastError.set(err.error?.message || 'Не удалось архивировать'),
    });
  }

  unarchiveConversation(id: string): void {
    this.http.put<{ success: boolean }>(`/api/staff-chat/conversations/${id}/unarchive`, {}).subscribe({
      next: () => {
        this._conversations.update(convs => convs.filter(c => c.id !== id));
        if (this._activeConversationId() === id) {
          this.deselectConversation();
        }
      },
      error: (err) => this._lastError.set(err.error?.message || 'Не удалось разархивировать'),
    });
  }

  // ============================================================================
  // Message Restore (undelete)
  // ============================================================================

  restoreMessage(convId: string, msgId: string): void {
    this.http.put<{ success: boolean; data: StaffMessage }>(
      `/api/staff-chat/conversations/${convId}/messages/${msgId}/restore`, {},
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._messages.update(msgs =>
            msgs.map(m => m.id === msgId ? res.data : m)
          );
        }
      },
      error: (err) => this._lastError.set(err.error?.message || 'Не удалось восстановить'),
    });
  }

  private readonly conversationArchivedEffect = effect(() => {
    const evt = this.wsService.staffChatConversationArchived();
    if (!evt || !this._initialized) return;

    // Remove conversation from current list (it moved to/from archive)
    this._conversations.update(convs => convs.filter(c => c.id !== evt.conversationId));
    if (this._activeConversationId() === evt.conversationId) {
      this.deselectConversation();
    }
  });

  private readonly messageRestoredEffect = effect(() => {
    const evt = this.wsService.staffChatMessageRestored();
    if (!evt || !this._initialized) return;

    const restoredMsg = evt.message as StaffMessage;
    if (evt.conversationId === this._activeConversationId()) {
      this._messages.update(msgs =>
        msgs.map(m => m.id === evt.messageId ? { ...restoredMsg, deleted_at: null } : m)
      );
    }
    if (evt.conversationId === this._generalId()) {
      this._generalMessages.update(msgs =>
        msgs.map(m => m.id === evt.messageId ? { ...restoredMsg, deleted_at: null } : m)
      );
    }
  });

  // ============================================================================
  // Helpers
  // ============================================================================

  setReplyTo(msg: StaffMessage | null): void {
    this._replyTo.set(msg);
  }

  markRead(conversationId: string): void {
    // Optimistic: clear unread locally immediately
    this._conversations.update(convs =>
      convs.map(c => c.id === conversationId ? { ...c, unread_count: 0 } : c)
    );

    // Optimistic own read-receipt: if active conv, pin our own entry to the last message
    const currentUserId = this.authService.currentUser()?.id;
    const activeId = this._activeConversationId();
    let prevReceipts: ReadonlyMap<string, StaffReadReceipt> | null = null;
    if (currentUserId && conversationId === activeId) {
      const lastMsg = this._messages().at(-1);
      if (lastMsg) {
        prevReceipts = this._readReceipts();
        this._readReceipts.update(prev => {
          const next = new Map(prev);
          const nowIso = new Date().toISOString();
          next.set(currentUserId, {
            lastReadMessageId: lastMsg.id,
            lastReadAt: nowIso,
            deliveredAt: nowIso,
          });
          return next;
        });
      }
    }

    // Focus-only HTTP: defer network call while tab is hidden/unfocused
    if (isPlatformBrowser(this.platformId)
      && typeof document !== 'undefined'
      && (document.hidden || !document.hasFocus())) {
      this._pendingMarkRead.add(conversationId);
      return;
    }

    this.flushMarkRead(conversationId, prevReceipts);
  }

  private flushMarkRead(
    conversationId: string,
    prevReceipts: ReadonlyMap<string, StaffReadReceipt> | null = null,
  ): void {
    this.http.put(`/api/staff-chat/conversations/${conversationId}/read`, {}).subscribe({
      error: (err) => {
        if (prevReceipts) {
          this._readReceipts.set(prevReceipts);
        }
        this.handleHttpError(err, 'mark-read');
      },
    });
  }

  private drainPendingMarkRead(): void {
    if (this._pendingMarkRead.size === 0) return;
    const ids = [...this._pendingMarkRead];
    this._pendingMarkRead.clear();
    for (const id of ids) {
      this.flushMarkRead(id);
    }
  }

  setGeneralChatVisible(visible: boolean): void {
    this._generalChatVisible = visible;
    if (visible) this.markGeneralRead();
  }

  markGeneralRead(): void {
    const convId = this._generalId();
    if (!convId) return;
    const conv = this.generalConversation();
    if (!conv || !conv.unread_count) return;
    this.markRead(convId);
  }

  private debouncedMarkGeneralRead(): void {
    if (this._markGeneralReadPending) return;
    this._markGeneralReadPending = true;
    setTimeout(() => {
      this._markGeneralReadPending = false;
      this.markGeneralRead();
    }, 500);
  }

  clearError(): void {
    this._lastError.set(null);
  }

  private handleHttpError(
    err: HttpErrorResponse,
    context:
      | 'conversations'
      | 'messages'
      | 'mentions'
      | 'presence'
      | 'read-receipts'
      | 'pinned'
      | 'media'
      | 'links'
      | 'search'
      | 'mark-read',
  ): void {
    this._loading.set(false);
    if (context === 'messages') this._messagesLoading.set(false);

    if (err?.status === 429) {
      const retryAfterRaw = err.headers?.get('Retry-After') ?? err.headers?.get('retry-after') ?? '30';
      const retryAfter = Number(retryAfterRaw) || 30;
      this._rateLimitUntil = Date.now() + retryAfter * 1000;
      const msg = `Слишком много запросов, подождите ${retryAfter} сек`;
      this._lastError.set(msg);
      this.snackBar.open(msg, 'Закрыть', { duration: 5000, panelClass: 'error-snackbar' });
      return;
    }

    if (err?.status === 401) {
      const msg = 'Сессия истекла — войдите снова';
      this._lastError.set(msg);
      this.snackBar.open(msg, 'Закрыть', { duration: 5000, panelClass: 'error-snackbar' });
      return;
    }

    const human = err?.status >= 500
      ? 'Сервер временно недоступен'
      : err?.status === 0
        ? 'Нет соединения'
        : `Ошибка загрузки (${context})`;
    this._lastError.set(human);
    this.snackBar.open(human, 'Закрыть', { duration: 5000, panelClass: 'error-snackbar' });
  }

  private guardedGet<T>(
    url: string,
    opts?: { params?: Record<string, string | number> },
  ): Observable<T> | null {
    if (!isPlatformBrowser(this.platformId)) {
      // SSR: не шлём HTTP, но и loading не оставляем застрявшим — hydration перенесёт true в client.
      this._loading.set(false);
      this._messagesLoading.set(false);
      return null;
    }
    if (Date.now() < this._rateLimitUntil) {
      this._loading.set(false);
      this._messagesLoading.set(false);
      return null;
    }
    return this.http.get<T>(url, opts);
  }

  loadConversationMedia(conversationId: string): void {
    this._mediaLoading.set(true);
    const obs = this.guardedGet<{ success: boolean; data: StaffMessage[] }>(
      `/api/staff-chat/conversations/${conversationId}/media`,
    );
    if (!obs) {
      this._mediaLoading.set(false);
      return;
    }
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          this._mediaItems.set(res.data);
        }
        this._mediaLoading.set(false);
      },
      error: (err) => {
        this._mediaLoading.set(false);
        this.handleHttpError(err, 'media');
      },
    });
  }

  loadConversationLinks(conversationId: string): void {
    this._linksLoading.set(true);
    const obs = this.guardedGet<{ success: boolean; data: { id: string; sender_name: string; content: string; urls: string[]; created_at: string }[] }>(
      `/api/staff-chat/conversations/${conversationId}/links`,
    );
    if (!obs) {
      this._linksLoading.set(false);
      return;
    }
    obs.subscribe({
      next: (res) => {
        if (res.success) this._linkItems.set(res.data);
        this._linksLoading.set(false);
      },
      error: (err) => {
        this._linksLoading.set(false);
        this.handleHttpError(err, 'links');
      },
    });
  }

  isBookmarked(messageId: string): boolean {
    return this._bookmarkedMessageIds().has(messageId);
  }

  toggleBookmark(conversationId: string, messageId: string): void {
    this.http.post<{ success: boolean; bookmarked: boolean }>(
      `/api/staff-chat/conversations/${conversationId}/messages/${messageId}/bookmark`, {}
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._bookmarkedMessageIds.update(set => {
            const next = new Set(set);
            if (res.bookmarked) next.add(messageId);
            else next.delete(messageId);
            return next;
          });
        }
      }
    });
  }

  loadBookmarks(): void {
    this._bookmarksLoading.set(true);
    this.http.get<{ success: boolean; data: StaffBookmark[] }>(
      '/api/staff-chat/bookmarks'
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this._bookmarks.set(res.data);
          this._bookmarkedMessageIds.set(new Set(res.data.map(b => b.id)));
        }
        this._bookmarksLoading.set(false);
      },
      error: () => this._bookmarksLoading.set(false),
    });
  }

  loadContacts(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this._contactsLoading.set(true);
    this._contactsError.set(null);
    this.http.get<ContactsResponse>('/api/staff-chat/contacts').subscribe({
      next: (res) => {
        this._contactsLoading.set(false);
        if (!res.success) {
          this._contactsError.set('Сервер вернул ошибку');
          return;
        }
        const filtered = res.data.filter(c =>
          !!c.user_id
          && typeof c.user_id === 'string'
          && !/@[^@]*\.internal$/i.test(c.email || ''),
        );
        this._contacts.set(filtered);
      },
      error: (err: HttpErrorResponse) => {
        this._contactsLoading.set(false);
        if (err.status === 401 || err.status === 403) {
          this._contactsError.set('Сессия истекла. Обновите страницу или перезайдите.');
          this._lastError.set('Сессия истекла');
          this.snackBar.open('Сессия истекла. Обновите страницу.', 'OK', { duration: 6000 });
        } else {
          this._contactsError.set('Не удалось загрузить список сотрудников');
          this._lastError.set('Не удалось загрузить контакты');
          this.snackBar.open('Не удалось загрузить список сотрудников', 'OK', { duration: 4000 });
        }
      },
    });
  }

  createDirect(userId: string): void {
    if (!userId) {
      this._lastError.set('Не выбран собеседник');
      this.snackBar.open('Не выбран собеседник', 'OK', { duration: 3000 });
      return;
    }
    this.http.get<{ success: boolean; data: { id: string } }>(`/api/staff-chat/direct/${userId}`).subscribe({
      next: (res) => {
        if (res.success) {
          this.loadConversations();
          this.selectConversation(res.data.id);
          this.snackBar.open('Чат создан', 'OK', { duration: 2000 });
        } else {
          this._lastError.set('Не удалось создать чат');
          this.snackBar.open('Не удалось создать чат', 'OK', { duration: 4000 });
        }
      },
      error: (err: HttpErrorResponse) => {
        const msg = err?.error?.message || (err.status === 401 ? 'Сессия истекла. Перезайдите в систему.' : 'Не удалось создать чат');
        this._lastError.set(msg);
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  createGroup(title: string, participantIds: string[]): void {
    const cleanIds = participantIds.filter(Boolean);
    this.http.post<{ success: boolean; data: { id: string } }>('/api/staff-chat/conversations', {
      type: 'group',
      title,
      participantIds: cleanIds,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.loadConversations();
          this.selectConversation(res.data.id);
          this.snackBar.open('Группа создана', 'OK', { duration: 2000 });
        }
      },
      error: (err: HttpErrorResponse) => {
        const msg = err?.error?.message || (err.status === 401 ? 'Сессия истекла. Перезайдите в систему.' : 'Не удалось создать группу');
        this._lastError.set(msg);
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  sendTyping(isTyping: boolean): void {
    const convId = this._activeConversationId();
    if (convId) {
      this.wsService.sendStaffTyping(convId, isTyping);
    }
  }

  getConversationDisplayName(conv: StaffConversation): string {
    if (conv.type === 'general') return conv.title || 'Общий чат';
    if (conv.title) return conv.title;
    if (conv.type === 'direct') {
      const currentUserId = this.authService.currentUser()?.id;
      const other = conv.participants?.find(p => p.user_id !== currentUserId);
      return other?.display_name || other?.email || 'Чат';
    }
    return 'Групповой чат';
  }

  // ============================================================================
  // Mentions
  // ============================================================================

  loadMentions(): void {
    const obs = this.guardedGet<{ success: boolean; data: unknown[] }>('/api/staff-chat/mentions');
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) this._mentionCount.set(res.data.length);
      },
      error: (err) => this.handleHttpError(err, 'mentions'),
    });
  }

  // ============================================================================
  // Presence
  // ============================================================================

  loadPresence(): void {
    const obs = this.guardedGet<{ success: boolean; data: { userId: string; online: boolean; lastSeenAt: string }[] }>(
      '/api/staff-chat/presence',
    );
    if (!obs) return;
    obs.subscribe({
      next: (res) => {
        if (res.success) {
          const map = new Map<string, { online: boolean; lastSeenAt: string }>();
          for (const entry of res.data) {
            map.set(entry.userId, { online: entry.online, lastSeenAt: entry.lastSeenAt });
          }
          this._presenceMap.set(map);
        }
      },
      error: (err) => this.handleHttpError(err, 'presence'),
    });
  }

  isStaffOnline(userId: string): boolean {
    return this._presenceMap().get(userId)?.online ?? this.wsService.isUserOnline(userId);
  }

  getLastSeenAt(userId: string): string | null {
    return this._presenceMap().get(userId)?.lastSeenAt ?? null;
  }

  // ============================================================================
  // Draft Persistence
  // ============================================================================

  saveDraft(conversationId: string, text: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (text.trim()) {
      this._drafts.set(conversationId, text);
    } else {
      this._drafts.delete(conversationId);
    }
    this.persistDrafts();
  }

  getDraft(conversationId: string): string {
    return this._drafts.get(conversationId) ?? '';
  }

  clearDraft(conversationId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this._drafts.delete(conversationId);
    this.persistDrafts();
  }

  private persistDrafts(): void {
    try {
      localStorage.setItem('staff-chat-drafts', JSON.stringify([...this._drafts.entries()]));
    } catch { /* quota exceeded — ignore */ }
  }

  // ============================================================================
  // Notification Sound
  // ============================================================================

  toggleSoundMuted(): void {
    const next = !this.soundMuted();
    this.soundMuted.set(next);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('staff-chat-sound-muted', String(next));
    }
  }

  // DO NOT CHANGE notification sound parameters (frequencies, duration, ramp type) without explicit approval
  private playNotificationSound(): void {
    if (!isPlatformBrowser(this.platformId)) return;
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
}
