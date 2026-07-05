import { Component, inject, input, output, effect, signal, computed, untracked, ChangeDetectionStrategy, DestroyRef, ElementRef, OnDestroy, OnInit, PLATFORM_ID, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser, SlicePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { OperatorChatService, OperatorChatMessage, SuggestedClient, SuggestedBooking, MessagesMetaItem, ActivityItem } from '../../services/operator-chat.service';
import { decodeFileName, getFileIcon, getFileLabel, getFileCategory, humanFileName, isBrowserPreviewableImage } from '../../../../shared/utils/file-helpers';
import { QuickRepliesService } from '../../services/quick-replies.service';
import { ChatTagsService } from '../../services/chat-tags.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { MediaDownloadService } from '../../../chat-page/services/media-download.service';
import { ChatSelectionService, SelectedFile } from '../../services/chat-selection.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { AiCrmApiService, SuggestedReply } from '../../services/ai-crm-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import { OrdersApiService, PhotoPrintOrder } from '../../services/orders-api.service';
import { orderStatusLabel, channelIcon, channelLabel, isBrandChannel, channelSvgIcon } from '../../utils/crm-helpers';
import { hasRealMediaCaption } from '../../utils/chat-caption.util';
import { chatPaymentMethodView, type ChatPaymentMethodTone, type ChatPaymentMethodView } from '../../utils/chat-payment-method-view.util';
import { ChatApprovalWidgetComponent } from './chat-approval-widget.component';
import { createChatOrderNavigationTarget } from './chat-order-menu.util';
import { MediaVideoPlayerComponent } from '../../../../shared/components/media-video-player/media-video-player.component';
import { MediaAudioPlayerComponent } from '../../../../shared/components/media-audio-player/media-audio-player.component';
import { PhoneMaskPipe } from '../../pipes/phone-mask.pipe';
import { MaskPhonesInTextPipe } from '../../pipes/mask-phones-in-text.pipe';
import { isNewBadgeVisible, markBadgeSeen } from '../../../../shared/utils/new-badge.util';
import { FaceValidationApiService, FaceValidationResult } from '../../services/face-validation-api.service';
import { QuickPrintService } from '../../services/quick-print.service';
import { DocumentSetHandoffService } from '../../services/document-set-handoff.service';
import { chatMediaRetryUrl } from '../../utils/chat-media-retry.util';

declare const __msgId: unique symbol;
type MessageId = string & { readonly [__msgId]: true };
/** Элемент единой ленты: либо мета обычного сообщения, либо activity-плашка. */
type FeedMetaItem = MessagesMetaItem | ActivityItem;
type ChatPaymentMetadata = NonNullable<NonNullable<OperatorChatMessage['metadata']>['payment']>;
type ChatInteractiveMetadata = NonNullable<NonNullable<OperatorChatMessage['metadata']>['interactive']>;
type ChatInteractiveButton = NonNullable<ChatInteractiveMetadata['buttons']>[number];
type ChatPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | string;
const CHAT_IMAGE_MAX_RETRIES = 3;

interface ChatPaymentCardItem {
  readonly name: string;
  readonly price: number;
}

interface ChatPaymentCardView {
  readonly amount: number | null;
  readonly status: ChatPaymentStatus;
  readonly statusLabel: string;
  readonly icon: string;
  readonly method: string | null;
  readonly methodLabel: string | null;
  readonly methodTone: ChatPaymentMethodTone | null;
  readonly methodIcon: string | null;
  readonly detail: string | null;
  readonly items: readonly ChatPaymentCardItem[];
  readonly canUseActions: boolean;
}

@Component({
  selector: 'app-chat-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, SlicePipe, DecimalPipe, TextFieldModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTooltipModule, MatDividerModule, MatMenuModule,
    ChatApprovalWidgetComponent,
    MediaVideoPlayerComponent,
    MediaAudioPlayerComponent,
    PhoneMaskPipe,
    MaskPhonesInTextPipe,
  ],
  host: {
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    '(paste)': 'onPaste($event)',
    '(keydown)': 'onChatKeydown($event)',
    '(document:mousemove)': 'onRbMouseMove($event)',
    '(document:mouseup)': 'onRbMouseUp()',
  },
  templateUrl: './chat-detail.component.html',
  styleUrl: './chat-detail.component.scss',
})
export class ChatDetailComponent implements OnInit, OnDestroy {
  protected readonly chatService = inject(OperatorChatService);
  protected readonly quickReplies = inject(QuickRepliesService);
  protected readonly tagsService = inject(ChatTagsService);
  protected readonly chatSelection = inject(ChatSelectionService);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly el = inject(ElementRef);
  private readonly toast = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly downloadService = inject(MediaDownloadService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly wsService = inject(WebSocketService);
  private readonly aiCrmApi = inject(AiCrmApiService);
  private readonly authService = inject(AuthService);
  private readonly faceValidationApi = inject(FaceValidationApiService);
  private readonly quickPrintService = inject(QuickPrintService);
  private readonly documentSetHandoff = inject(DocumentSetHandoffService);
  private readonly destroyRef = inject(DestroyRef);

  sessionId = input.required<string>();
  clientPhoneResolved = output<string | null>();
  clientUserIdResolved = output<string>();
  clientContactIdResolved = output<string>();
  cartItemsToAdd = output<SyncCartItem[]>();
  navigateToItem = output<{ type: string; id: string }>();
  createOrderFromChat = output<void>();

  readonly operatorTyping = this.chatService.operatorTypingForSession;
  readonly chatViewer = this.chatService.currentChatViewers;
  readonly isNoteMode = signal(false);
  readonly replyFocused = signal(false);
  // Reply / Forward
  readonly replyingTo = signal<OperatorChatMessage | null>(null);
  readonly forwardingMessage = signal<OperatorChatMessage | null>(null);
  // Message context menu (universal — all message types)
  readonly msgContextMenuPosition = signal({ x: '0px', y: '0px' });
  readonly msgContextMenuTarget = signal<OperatorChatMessage | null>(null);
  readonly msgContextMenuTriggerRef = viewChild<MatMenuTrigger>('msgContextMenuTrigger');
  readonly clientOrders = signal<PhotoPrintOrder[]>([]);
  readonly clientOrdersLoading = signal(false);
  // Quick mark-paid inline confirmation
  readonly markPaidConfirmOrder = signal<PhotoPrintOrder | null>(null);
  readonly markPaidSending = signal(false);
  // Payment card actions (in-chat buttons)
  readonly paymentCardBusy = signal(false);
  readonly orderStatusLabel = orderStatusLabel;
  readonly aiSuggestion = signal<string | null>(null);
  readonly aiLoading = signal(false);
  readonly isDragOver = signal(false);
  readonly activeFollowup = signal<{ id: string; follow_up_at: string; note: string | null } | null>(null);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly aiSuggestions = signal<SuggestedReply[]>([]);
  readonly faceValidations = signal<Readonly<Record<MessageId, FaceValidationResult>>>({});
  readonly faceValidationLoading = signal<readonly MessageId[]>([]);

  /** Expanded media grid groups (tracks message ID of group start) */
  readonly expandedMediaGroups = signal(new Set<string>());
  readonly MEDIA_GRID_COLLAPSED_COUNT = 20;
  readonly aiSuggestionsLoading = signal(false);
  readonly showApprovalWidget = signal(false);
  readonly linkedApprovalId = signal<string | null>(null);
  readonly showScrollToBottom = signal(false);
  readonly newMessagesSinceScroll = signal(0);
  readonly isSearchOpen = signal(false);
  readonly searchQuery = signal('');
  readonly searchResults = signal<{ id: string; content: string; sender_name: string; created_at: string }[]>([]);
  readonly searchLoading = signal(false);
  readonly searchIndex = signal(-1);
  // NEW badge for inline payment
  readonly showPaymentBadge = signal(isNewBadgeVisible('inline-payment'));
  // F70: Inline phone input
  readonly phoneEditMode = signal(false);
  readonly phoneInputValue = signal('');
  // Client linking
  readonly suggestedClients = signal<SuggestedClient[]>([]);
  readonly suggestedBookings = signal<SuggestedBooking[]>([]);
  readonly clientSearchOpen = signal(false);
  readonly clientSearchQuery = signal('');
  readonly clientSearchResults = signal<SuggestedClient[]>([]);
  readonly bookingSearchOpen = signal(false);
  private clientSearchDebounce: ReturnType<typeof setTimeout> | null = null;
  replyText = '';
  private isAtBottom = true;
  private messageCount = 0;
  private slaIntervalId: ReturnType<typeof setInterval> | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private isTypingEmitted = false;
  private clientOrdersSessionId: string | null = null;
  private scrollObserver: IntersectionObserver | null = null;
  private loadOlderDebounce: ReturnType<typeof setTimeout> | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private lastEmittedPhone: string | null | undefined = undefined;
  private lastEmittedUserId: string | null | undefined = undefined;
  private lastSessionId?: string;

  // Lightbox
  readonly lightboxOpen = signal(false);
  readonly lightboxImages = signal<{ url: string; id: string }[]>([]);
  readonly lightboxIndex = signal(0);

  // Rubber-band selection
  readonly rbActive = signal(false);
  readonly rbStart = signal<{ x: number; y: number } | null>(null);
  readonly rbRect = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  private currentRbGroup: OperatorChatMessage[] | null = null;
  private rbWasDrag = false;
  private rbCtrlHeld = false;
  private rbPreExisting = new Map<string, SelectedFile>();

  // Photo rotation (CSS-only, per message)
  readonly photoRotations = signal<readonly { id: string; rotation: number }[]>([]);

  /** SLA: ticks every 10s to update timer display */
  readonly slaTick = signal(0);
  readonly slaDisplay = computed(() => {
    this.slaTick(); // re-evaluate on tick
    const session = this.chatService.activeSession();
    if (!session) return null;
    if (session.status === 'resolved' || session.status === 'closed') return null;
    if (session.first_response_at) {
      return { status: 'responded', label: 'Ответ дан' };
    }
    const createdAt = session.created_at;
    if (!createdAt) return null;
    const elapsed = Date.now() - new Date(createdAt).getTime();
    if (elapsed < 0) return null;
    const limitMs = 5 * 60 * 1000;
    const min = Math.floor(elapsed / 1000 / 60);
    const sec = Math.floor((elapsed / 1000) % 60);
    const label = `Клиент ждёт: ${min}:${sec.toString().padStart(2, '0')}`;
    if (elapsed >= limitMs) return { status: 'breached', label };
    if (elapsed >= limitMs * 0.7) return { status: 'warning', label };
    return { status: 'ok', label };
  });

  readonly visitorOnline = computed(() => {
    const id = this.sessionId();
    return id ? (this.wsService.visitorOnlineMap().get(id) ?? false) : false;
  });

  readonly visitorLastSeenAt = computed(() => {
    this.slaTick();
    const id = this.sessionId();
    const presence = id ? this.wsService.visitorPresenceMap().get(id) : undefined;
    return presence?.lastSeenAt
      ?? this.chatService.activeSession()?.client_last_seen_at
      ?? null;
  });

  readonly visitorPresenceLabel = computed(() => {
    this.slaTick();
    if (this.visitorOnline()) return 'Онлайн на сайте';
    const lastSeenAt = this.visitorLastSeenAt();
    return lastSeenAt ? `Был(а) ${this.relativePastLabel(lastSeenAt)}` : 'Офлайн';
  });

  readonly displayPhone = computed(() => {
    const session = this.chatService.activeSession();
    return session?.client_phone || session?.visitor_phone || null;
  });

  readonly channelDegraded = computed(() => {
    const session = this.chatService.activeSession();
    const cb = this.wsService.channelCircuitBreaker();
    if (session?.channel && cb?.channel === session.channel && cb?.state === 'OPEN') {
      return cb;
    }
    return null;
  });

  /** Режим AI-агента для текущей сессии ('bot' | 'operator' | 'off' | null). */
  readonly aiAgentMode = computed(() => this.chatService.activeSession()?.ai_agent_mode ?? null);

  /** Busy-флаг во время переключения режима AI (чтобы не кликать дважды). */
  readonly aiAgentModeBusy = signal(false);

  /** Переключить режим AI для текущего диалога. */
  setAiAgentMode(mode: 'bot' | 'off'): void {
    const sessionId = this.sessionId();
    if (!sessionId || this.aiAgentModeBusy()) return;
    this.aiAgentModeBusy.set(true);
    this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${encodeURIComponent(sessionId)}/ai-agent-mode`,
      { mode },
    ).subscribe({
      next: () => {
        this.chatService.updateSessionFields(sessionId, { ai_agent_mode: mode });
        this.aiAgentModeBusy.set(false);
        this.toast.success(mode === 'bot' ? 'Диалог возвращён боту' : 'Вы взяли диалог у бота');
      },
      error: () => {
        this.aiAgentModeBusy.set(false);
        this.toast.error('Не удалось переключить режим AI');
      },
    });
  }

  readonly aiReplyBusy = signal(false);
  /** Попросить бота сформировать и отправить ответ клиенту (ручной триггер хода). */
  aiReplyToClient(): void {
    const sessionId = this.sessionId();
    if (!sessionId || this.aiReplyBusy()) return;
    this.aiReplyBusy.set(true);
    this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${encodeURIComponent(sessionId)}/ai-reply`,
      {},
    ).subscribe({
      next: () => {
        this.aiReplyBusy.set(false);
        this.toast.success('Бот формирует ответ клиенту');
      },
      error: () => {
        this.aiReplyBusy.set(false);
        this.toast.error('Не удалось запросить ответ бота');
      },
    });
  }

  /** First unpaid order linked to this chat session */
  readonly linkedUnpaidOrder = computed(() => {
    const sid = this.sessionId();
    const orders = this.clientOrders();
    return orders.find(o => o.chat_session_id === sid && o.payment_status !== 'paid') ?? null;
  });

  readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
  readonly scrollSentinelRef = viewChild<ElementRef<HTMLElement>>('scrollSentinel');

  private readonly sentinelEffect = effect(() => {
    const el = this.scrollSentinelRef();
    if (el) this.observeSentinel(el.nativeElement);
  });

  /**
   * Pre-computed message grouping metadata with media grouping.
   * Built incrementally in OperatorChatService so the component doesn't pay
   * O(N²) on every message arrival.
   */
  readonly messagesMeta = computed<MessagesMetaItem[]>(() => {
    const meta = this.chatService.messagesMeta();
    const operatorPaymentKeys = new Set<string>();

    for (const item of meta) {
      if (!this.isOperatorPaymentLinkNotification(item.msg)) continue;
      const key = this.paymentLinkDedupKey(item.msg);
      if (key) operatorPaymentKeys.add(key);
    }

    if (operatorPaymentKeys.size === 0) return meta;

    return meta.map((item) => {
      if (item.skipRender || !this.isPaymentLinkCustomerConfirmation(item.msg)) return item;
      const key = this.paymentLinkDedupKey(item.msg);
      return key && operatorPaymentKeys.has(key) ? { ...item, skipRender: true } : item;
    });
  });

  /**
   * Единая лента: interleave готовой `messagesMeta` (media-группировка уже посчитана
   * над `_messages`, НЕ трогаем) и activity-плашек по `created_at` ASC.
   * Activity — самостоятельные не-media строки (не участвуют в media-grid).
   * Сообщения остаются MessagesMetaItem как есть, поэтому существующая разметка
   * пузырей в шаблоне переиспользуется без изменений (item === meta).
   * Блок «Предыдущие беседы» сюда НЕ входит — он остаётся отдельной секцией сверху.
   */
  readonly unifiedFeedMeta = computed<FeedMetaItem[]>(() => {
    const meta = this.messagesMeta();
    const activity = this.chatService.activityItems();
    if (activity.length === 0) return meta;

    // Activity по времени ASC — вставляем перед первым сообщением, чьё время позже.
    const sortedActivity = [...activity].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const result: FeedMetaItem[] = [];
    let ai = 0;
    for (const item of meta) {
      const itemTime = new Date(item.msg.created_at).getTime();
      while (ai < sortedActivity.length && new Date(sortedActivity[ai].created_at).getTime() <= itemTime) {
        result.push(sortedActivity[ai]);
        ai++;
      }
      result.push(item);
    }
    // Остаток activity новее последнего сообщения — в конец ленты.
    while (ai < sortedActivity.length) {
      result.push(sortedActivity[ai]);
      ai++;
    }
    return result;
  });

  /** Type-guard для шаблона: элемент ленты — плашка активности. */
  isActivity(item: FeedMetaItem): item is ActivityItem {
    return 'kind' in item && item.kind === 'activity';
  }

  /** Стабильный track-ключ для @for единой ленты (id есть у обоих типов). */
  feedTrackId(item: FeedMetaItem): string {
    return this.isActivity(item) ? item.id : item.msg.id;
  }

  /** Привести элемент ленты к MessagesMetaItem (в @else-ветке после isActivity). */
  asMeta(item: FeedMetaItem): MessagesMetaItem {
    return item as MessagesMetaItem;
  }

  /** Material-иконка плашки активности по типу события. */
  activityIcon(item: ActivityItem): string {
    switch (item.activity_type) {
      case 'booking': return 'event';
      case 'order': return 'receipt_long';
      case 'pos_receipt': return 'point_of_sale';
      case 'subscription': return 'card_membership';
      case 'call': return 'call';
      case 'loyalty': return 'loyalty';
      default: return 'info';
    }
  }

  /** Pre-computed meta for previous conversation messages (simplified — no media grouping) */
  readonly previousMessagesMeta = computed<MessagesMetaItem[]>(() => {
    const msgs = this.chatService.previousMessages();
    return msgs.map((msg, i) => ({
      msg,
      showDate: i === 0 || new Date(msg.created_at).toDateString() !== new Date(msgs[i - 1].created_at).toDateString(),
      grouped: i > 0 && msg.sender_type === msgs[i - 1].sender_type &&
               new Date(msg.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() < 120_000,
      lastInGroup: i === msgs.length - 1 || msgs[i + 1].sender_type !== msg.sender_type ||
                   new Date(msgs[i + 1].created_at).getTime() - new Date(msg.created_at).getTime() >= 120_000,
      mediaGroupStart: false,
      mediaGroupItems: null,
      skipRender: false,
    }));
  });

  private readonly sessionEffect = effect(() => {
    const id = this.sessionId();
    if (id) {
      untracked(() => {
        this.chatService.init();
        this.chatService.selectSession(id);
        this.quickReplies.load();
        this.tagsService.load();
        this.tagsService.getSessionTags(id);
        this.loadFollowup(id);
        this.loadAiSuggestions();
        this.messageCount = 0;
        this.isAtBottom = true;
        this.showScrollToBottom.set(false);
        this.newMessagesSinceScroll.set(0);
        this.replyText = '';
        this.replyingTo.set(null);
        this.forwardingMessage.set(null);
        this.stopOperatorTyping();
        this.aiSuggestion.set(null);
        this.clientOrdersSessionId = null;
        this.startSlaTimer();
        this.suggestedClients.set([]);
        this.suggestedBookings.set([]);
        this.clientSearchOpen.set(false);
        this.bookingSearchOpen.set(false);
        this.linkedApprovalId.set(null);
        this.markPaidConfirmOrder.set(null);
        this.loadSuggestedClients(id);
        this.loadLinkedApproval(id);
      });
    }
  });

  private readonly phoneEffect = effect(() => {
    const session = this.chatService.activeSession();
    if (session) {
      // Reset dedup guards when switching between sessions
      const sessionId = session.id;
      if (sessionId !== this.lastSessionId) {
        this.lastSessionId = sessionId;
        this.lastEmittedUserId = undefined;
        this.lastEmittedPhone = undefined;
      }

      // Priority 1: user_id (registered user) → loads full profile in right panel
      const userId = session.user_id || null;
      if (userId && userId !== this.lastEmittedUserId) {
        this.lastEmittedUserId = userId;
        this.lastEmittedPhone = undefined;
        this.clientUserIdResolved.emit(userId);
        return;
      }

      // Priority 2: phone (from contact or messenger)
      const phone = session.client_phone || session.visitor_phone || null;
      if (phone && phone !== this.lastEmittedPhone) {
        this.lastEmittedPhone = phone;
        this.lastEmittedUserId = undefined;
        this.clientPhoneResolved.emit(phone);
        return;
      }

      // Priority 3: contact_id (VK/МАКС/Telegram contacts without phone)
      const contactId = session.contact_id || null;
      if (contactId && !userId && !phone) {
        this.clientContactIdResolved.emit(contactId);
        return;
      }

      // Nothing resolved — emit null phone to clear panel
      if (!userId && !phone && !contactId && this.lastEmittedPhone !== null) {
        this.lastEmittedPhone = null;
        this.lastEmittedUserId = undefined;
        this.clientPhoneResolved.emit(null);
      }
    }
  });

  private readonly maintenanceEffect = effect(() => {
    const evt = this.wsService.serverMaintenance();
    if (evt) {
      this.toast.info(evt.message || 'Обновление сервера, переподключение...');
    }
  });

  /** Update payment card status when order:paid event arrives */
  private readonly orderPaidEffect = effect(() => {
    const evt = this.wsService.orderEvent();
    if (!evt || evt.event !== 'order:paid') return;
    const paidOrderId = evt.data['orderId'] as string | undefined;
    if (!paidOrderId) return;
    // Find payment message with matching orderId and update its status
    const msgs = untracked(() => this.chatService.messages());
    const paymentMsg = msgs.find(m => {
      const payment = this.paymentMetadata(m);
      return payment?.orderId === paidOrderId;
    });
    if (paymentMsg) {
      this.setPaymentCardStatus(paymentMsg, 'paid');
    }
    // Also update clientOrders so linkedUnpaidOrder clears
    const orders = untracked(() => this.clientOrders());
    const updated = orders.map(o =>
      o.order_id === paidOrderId ? { ...o, payment_status: 'paid' } : o,
    );
    if (updated.some((o, i) => o !== orders[i])) {
      this.clientOrders.set(updated);
    }
  });

  /** Update stale inline invoice cards when the paid bot message arrives. */
  private readonly paymentConfirmationEffect = effect(() => {
    const msgs = this.chatService.messages();
    if (msgs.length === 0) return;

    const paidOrderIds = new Set<string>();
    const paidAmounts: number[] = [];
    for (const msg of msgs) {
      for (const orderId of this.paymentConfirmationOrderIds(msg)) {
        paidOrderIds.add(orderId);
      }
      const amount = this.paymentConfirmationAmount(msg);
      if (amount !== null) paidAmounts.push(amount);
    }
    if (paidOrderIds.size === 0 && paidAmounts.length === 0) return;

    const pendingCards = msgs.filter(msg => this.isPendingPaymentCard(msg));
    const allowAmountFallback = paidOrderIds.size === 0 && pendingCards.length === 1;
    for (const card of pendingCards) {
      const payment = this.paymentMetadata(card);
      if (!payment) continue;
      const amount = typeof payment.amount === 'number' ? payment.amount : null;
      const matchesId = typeof payment.orderId === 'string' && paidOrderIds.has(payment.orderId);
      const matchesAmount = allowAmountFallback
        && amount !== null
        && paidAmounts.some(paidAmount => Math.abs(paidAmount - amount) < 0.01);
      if (matchesId || matchesAmount) {
        untracked(() => this.setPaymentCardStatus(card, 'paid'));
      }
    }
  });

  /** Auto-load client orders when active session changes (for quick mark-paid) */
  private readonly linkedOrdersEffect = effect(() => {
    const sessionId = this.chatService.activeSession()?.id;
    if (sessionId) {
      untracked(() => this.loadLinkedOrders());
    }
  });

  private readonly scrollEffect = effect(() => {
    const count = this.chatService.messages().length;
    if (count <= this.messageCount) {
      this.messageCount = count;
      return;
    }
    const isInitialLoad = this.messageCount === 0 && count > 1;
    const delta = count - this.messageCount;
    this.messageCount = count;
    if (this.isAtBottom || isInitialLoad) {
      this.scheduleScrollToBottom(isInitialLoad);
    } else {
      this.newMessagesSinceScroll.update(n => n + delta);
    }
  });

  /** Scroll to bottom with retries for initial load (lazy images shift scrollHeight) */
  private scheduleScrollToBottom(withRetries: boolean): void {
    const scroll = () => {
      const container = this.messagesContainer();
      if (container) {
        container.nativeElement.scrollTop = container.nativeElement.scrollHeight;
      }
    };
    // setTimeout(0) ensures Angular change detection has rendered the DOM first
    // (requestAnimationFrame can fire before CD, leaving scrollHeight stale)
    setTimeout(scroll, 0);
    if (withRetries) {
      // Catch lazy-loaded images that increase scrollHeight after render
      setTimeout(scroll, 100);
      setTimeout(scroll, 300);
      setTimeout(scroll, 600);
      setTimeout(scroll, 1200);
      setTimeout(() => { scroll(); this.isAtBottom = true; }, 2000);
    }
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.setupScrollObserver();
    }
  }

  ngOnDestroy(): void {
    this.stopSlaTimer();
    this.stopOperatorTyping();
    this.scrollObserver?.disconnect();
    if (this.loadOlderDebounce) clearTimeout(this.loadOlderDebounce);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  onMessagesScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 80;
    this.isAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < threshold;
    this.showScrollToBottom.set(!this.isAtBottom);
    if (this.isAtBottom) {
      this.newMessagesSinceScroll.set(0);
    }
  }

  scrollToBottom(): void {
    const container = this.messagesContainer();
    if (container) {
      container.nativeElement.scrollTop = container.nativeElement.scrollHeight;
    }
    this.showScrollToBottom.set(false);
    this.newMessagesSinceScroll.set(0);
    this.isAtBottom = true;
  }

  private setupScrollObserver(): void {
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this.chatService.hasOlder() && !this.chatService.loadingOlder()) {
          if (this.loadOlderDebounce) clearTimeout(this.loadOlderDebounce);
          this.loadOlderDebounce = setTimeout(() => {
            const container = this.messagesContainer();
            const prevScrollHeight = container?.nativeElement.scrollHeight ?? 0;
            this.chatService.loadOlderMessages();
            if (container) {
              requestAnimationFrame(() => {
                const newScrollHeight = container.nativeElement.scrollHeight;
                container.nativeElement.scrollTop += (newScrollHeight - prevScrollHeight);
              });
            }
          }, 300);
        }
      },
      { threshold: 0.1 }
    );
  }

  observeSentinel(el: HTMLElement): void {
    if (this.scrollObserver && el) {
      this.scrollObserver.disconnect();
      this.scrollObserver.observe(el);
    }
  }

  toggleSearch(): void {
    const open = !this.isSearchOpen();
    this.isSearchOpen.set(open);
    if (!open) {
      this.searchQuery.set('');
      this.searchResults.set([]);
      this.searchIndex.set(-1);
    }
  }

  onSearchInput(query: string): void {
    this.searchQuery.set(query);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (!query.trim()) {
      this.searchResults.set([]);
      this.searchIndex.set(-1);
      return;
    }
    this.searchDebounce = setTimeout(() => {
      this.searchLoading.set(true);
      this.chatService.searchMessages(this.sessionId(), query.trim()).subscribe({
        next: (res) => {
          if (res.success) {
            this.searchResults.set(res.data);
            this.searchIndex.set(res.data.length > 0 ? 0 : -1);
          }
          this.searchLoading.set(false);
        },
        error: () => this.searchLoading.set(false),
      });
    }, 500);
  }

  navigateSearch(direction: 'up' | 'down'): void {
    const results = this.searchResults();
    if (!results.length) return;
    let idx = this.searchIndex();
    idx = direction === 'down' ? Math.min(idx + 1, results.length - 1) : Math.max(idx - 1, 0);
    this.searchIndex.set(idx);
    const result = results[idx];
    if (result) {
      this.chatService.jumpToMessage(this.sessionId(), result.created_at);
    }
  }

  onChatKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      this.toggleSearch();
    }
    // Lightbox keyboard
    if (this.lightboxOpen()) {
      if (event.key === 'Escape') {
        this.closeLightbox();
      } else if (event.key === 'ArrowRight') {
        this.lightboxNext();
      } else if (event.key === 'ArrowLeft') {
        this.lightboxPrev();
      }
    }
  }

  private startSlaTimer(): void {
    this.stopSlaTimer();
    if (isPlatformBrowser(this.platformId)) {
      this.slaIntervalId = setInterval(() => this.slaTick.update(v => v + 1), 10_000);
    }
  }

  private stopSlaTimer(): void {
    if (this.slaIntervalId) {
      clearInterval(this.slaIntervalId);
      this.slaIntervalId = null;
    }
  }

  insertQuickReply(content: string): void {
    const session = this.chatService.activeSession();
    const user = this.authService.currentUser();
    const clientName = session?.visitor_name || 'Клиент';
    const operatorName = user?.display_name || user?.email || 'Оператор';
    this.replyText = content
      .replace(/\{\{client_name\}\}/g, clientName)
      .replace(/\{\{operator_name\}\}/g, operatorName);
  }

  toggleNoteMode(): void {
    this.isNoteMode.update(v => !v);
  }

  sendReply(): void {
    if (!this.replyText.trim()) return;
    this.stopOperatorTyping();

    const editing = this.editingMessage();
    if (editing) {
      this.chatService.editMessage(this.sessionId(), editing.id, this.replyText).subscribe({
        next: () => this.toast.success('Сообщение отредактировано'),
        error: () => this.toast.error('Не удалось отредактировать'),
      });
      this.replyText = '';
      this.editingMessage.set(null);
      return;
    }

    if (this.isNoteMode()) {
      this.chatService.sendNote(this.replyText);
    } else {
      const replyToId = this.replyingTo()?.id;
      this.chatService.sendReply(this.replyText, replyToId);
    }
    this.replyText = '';
    this.clearReplyTo();
  }

  openScheduleDialog(): void {
    if (!this.replyText.trim()) return;
    const content = this.replyText;
    import('./schedule-message-dialog.component').then(m => {
      const ref = this.dialog.open(m.ScheduleMessageDialogComponent, {
        width: '420px',
      });
      ref.afterClosed().subscribe((sendAt: string | undefined) => {
        if (sendAt) {
          this.chatService.scheduleMessage(content, sendAt);
          this.replyText = '';
          this.toast.success('Сообщение запланировано');
        }
      });
    });
  }

  setReplyTo(msg: OperatorChatMessage): void {
    this.replyingTo.set(msg);
    this.forwardingMessage.set(null);
  }

  clearReplyTo(): void {
    this.replyingTo.set(null);
    this.editingMessage.set(null);
  }

  // --- Message edit/delete ---
  readonly editingMessage = signal<OperatorChatMessage | null>(null);

  startEditMessage(msg: OperatorChatMessage): void {
    this.editingMessage.set(msg);
    this.replyingTo.set(null);
    this.forwardingMessage.set(null);
    this.replyText = msg.content;
  }

  cancelEdit(): void {
    this.editingMessage.set(null);
    this.replyText = '';
  }

  canDeleteOutgoingMessage(msg: OperatorChatMessage | null | undefined): msg is OperatorChatMessage {
    return !!msg
      && (msg.sender_type === 'operator' || msg.sender_type === 'bot')
      && !this.isApprovalLinkedMessage(msg);
  }

  canEditOutgoingMessage(msg: OperatorChatMessage | null | undefined): msg is OperatorChatMessage {
    return this.canDeleteOutgoingMessage(msg) && msg.message_type === 'text';
  }

  isApprovalLinkedMessage(msg: OperatorChatMessage | null | undefined): msg is OperatorChatMessage {
    return this.approvalDeleteIdentifier(msg) !== null;
  }

  approvalDeleteLabel(msg: OperatorChatMessage | null | undefined): string {
    return this.isFinalApprovalDeliveryMessage(msg) ? 'Удалить финал' : 'Удалить согласование';
  }

  confirmDeleteMessage(msg: OperatorChatMessage): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Удалить сообщение?', message: 'Сообщение будет удалено из чата и из мессенджера клиента.' },
    });
    ref.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.chatService.deleteMessage(this.sessionId(), msg.id).subscribe({
          next: () => this.toast.success('Сообщение удалено'),
          error: () => this.toast.error('Не удалось удалить'),
        });
      }
    });
  }

  confirmDeleteApproval(msg: OperatorChatMessage): void {
    const approvalSessionId = this.approvalDeleteIdentifier(msg);
    if (!approvalSessionId) return;
    const isFinalDelivery = this.isFinalApprovalDeliveryMessage(msg);
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: isFinalDelivery ? 'Удалить финал?' : 'Удалить согласование?',
        message: isFinalDelivery
          ? 'Финальная выдача будет отменена, выбранные фото исчезнут из «Мои фотографии», а сообщение уйдет из чата.'
          : 'Согласование будет отменено, выбранные варианты сбросятся, а сообщение уйдет из чата.',
      },
    });
    ref.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.http.delete<{ success: boolean }>(`/api/photo-approvals/sessions/${encodeURIComponent(approvalSessionId)}`).subscribe({
          next: () => this.toast.success(isFinalDelivery ? 'Финал удален' : 'Согласование удалено'),
          error: () => this.toast.error(isFinalDelivery ? 'Не удалось удалить финал' : 'Не удалось удалить согласование'),
        });
      }
    });
  }

  private approvalDeleteIdentifier(msg: OperatorChatMessage | null | undefined): string | null {
    const interactive = msg?.metadata?.interactive;
    if (!interactive) return null;
    if (interactive.type === 'approval_gallery') {
      return this.nonEmptyString(interactive.sessionId);
    }
    if (!this.isFinalApprovalInteractive(interactive)) return null;
    return this.nonEmptyString(interactive.sessionId) ?? this.finalApprovalPublicToken(interactive);
  }

  private isFinalApprovalDeliveryMessage(msg: OperatorChatMessage | null | undefined): boolean {
    const interactive = msg?.metadata?.interactive;
    return !!interactive && this.isFinalApprovalInteractive(interactive);
  }

  private isFinalApprovalInteractive(interactive: ChatInteractiveMetadata): boolean {
    if (interactive.approvalAction === 'final_delivery') return true;
    return interactive.type === 'buttons' && this.finalApprovalPublicToken(interactive) !== null;
  }

  private finalApprovalPublicToken(interactive: ChatInteractiveMetadata): string | null {
    const buttons = interactive.buttons;
    if (!buttons?.length) return null;
    for (const button of buttons) {
      if (this.isFinalDownloadButton(button) && button.url) {
        const match = button.url.match(/\/photo-review\/([^/?#]+)/);
        if (match?.[1]) return match[1];
      }
    }
    return null;
  }

  private isFinalDownloadButton(button: ChatInteractiveButton): boolean {
    return button.id === 'download_photo' || button.id === 'download_photos';
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  startForward(msg: OperatorChatMessage): void {
    this.forwardingMessage.set(msg);
    this.replyingTo.set(null);
    import('./forward-dialog.component').then(m => {
      this.dialog.open(m.ForwardDialogComponent, {
        width: '480px',
        maxHeight: '80vh',
        data: {
          message: msg,
          currentSessionId: this.sessionId(),
        },
      }).afterClosed().subscribe((result: { success?: boolean; targetName?: string } | undefined) => {
        this.forwardingMessage.set(null);
        if (result?.success) {
          this.toast.success(`Сообщение переслано в чат ${result.targetName || ''}`);
        }
      });
    });
  }

  copyMessageText(msg: OperatorChatMessage): void {
    const text = msg.content || '';
    if (text) {
      navigator.clipboard.writeText(text);
      this.toast.success('Скопировано');
    }
  }

  scrollToMessage(messageId: string): void {
    if (!messageId) return;
    const container = this.messagesContainer();
    if (!container) return;
    const el = container.nativeElement.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-flash');
      setTimeout(() => el.classList.remove('highlight-flash'), 1500);
    } else {
      // Message not in DOM — try to load it by jumping
      const msg = this.chatService.messages().find(m => m.id === messageId);
      if (msg) {
        this.chatService.jumpToMessage(this.sessionId(), msg.created_at);
      }
    }
  }

  isRealCaption(content: string | null | undefined): boolean {
    return hasRealMediaCaption(content);
  }

  toggleMediaGridExpanded(msgId: string): void {
    this.expandedMediaGroups.update(s => {
      const next = new Set(s);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  }

  onMsgContextMenu(event: MouseEvent, msg: OperatorChatMessage): void {
    event.preventDefault();
    this.msgContextMenuPosition.set({ x: event.clientX + 'px', y: event.clientY + 'px' });
    this.msgContextMenuTarget.set(msg);
    setTimeout(() => {
      this.msgContextMenuTriggerRef()?.openMenu();
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendReply();
    }
  }

  onReplyInput(): void {
    if (this.isNoteMode()) return;
    const sessionId = this.sessionId();
    if (!sessionId) return;

    if (!this.isTypingEmitted) {
      this.isTypingEmitted = true;
      this.wsService.sendOperatorTyping(sessionId, true);
    }

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => this.stopOperatorTyping(), 3000);
  }

  private stopOperatorTyping(): void {
    if (this.isTypingEmitted) {
      this.isTypingEmitted = false;
      const sessionId = this.sessionId();
      if (sessionId) this.wsService.sendOperatorTyping(sessionId, false);
    }
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }

  addTag(tagId: string): void {
    this.tagsService.addTag(this.sessionId(), tagId);
  }

  removeTag(tagId: string): void {
    this.tagsService.removeTag(this.sessionId(), tagId);
  }

  takeChat(): void {
    this.chatService.assignToMe(this.sessionId());
    this.toast.success('Чат взят в работу');
  }

  /** F70: Save phone from inline CRM input */
  savePhone(): void {
    const raw = this.phoneInputValue().trim();
    if (!raw || raw.length < 6) {
      this.phoneEditMode.set(false);
      this.phoneInputValue.set('');
      return;
    }
    // Normalize: keep + and digits only
    const normalized = raw.replace(/[\s()-]/g, '');
    this.chatService.updateVisitorPhone(this.sessionId(), normalized).subscribe({
      next: (res) => {
        if (res.success) {
          this.toast.success('Телефон сохранён');
        }
        this.phoneEditMode.set(false);
        this.phoneInputValue.set('');
      },
      error: () => {
        this.toast.error('Ошибка сохранения телефона');
        this.phoneEditMode.set(false);
        this.phoneInputValue.set('');
      },
    });
  }

  openTransferDialog(): void {
    import('../shared/transfer-dialog.component').then(m => {
      const session = this.chatService.activeSession();
      this.dialog.open(m.TransferDialogComponent, {
        data: { currentOperatorId: session?.assigned_operator_id },
        width: '420px',
      }).afterClosed().subscribe(result => {
        if (result?.operatorId) {
          this.chatService.transfer(this.sessionId(), result.operatorId, result.note).subscribe({
            next: () => this.toast.success('Чат передан'),
          });
        }
      });
    });
  }

  /** Chat-ownership-v1: operators/managers/admins can privatize their assigned chats. */
  readonly canMakePrivate = computed(() => {
    const role = this.authService.userRole();
    return role === 'admin' || role === 'manager' || role === 'employee';
  });

  /** Owner of a private chat or any admin can release privacy. */
  readonly canReleasePrivate = computed(() => {
    const session = this.chatService.activeSession();
    const user = this.authService.currentUser();
    if (!session || !user) return false;
    return session.private_owner_id === user.id || this.authService.isAdmin();
  });

  claimPrivate(): void {
    this.chatService.claimPrivate(this.sessionId()).subscribe({
      next: () => this.toast.success('Чат забран в личную работу'),
    });
  }

  releasePrivate(): void {
    this.chatService.releasePrivate(this.sessionId()).subscribe({
      next: () => this.toast.success('Приватность снята'),
    });
  }

  assigneeName(): string {
    const session = this.chatService.activeSession();
    if (!session?.assigned_operator_id) return '';
    return session.assigned_operator_name || 'Оператор';
  }

  resolveSession(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Пометить как решённый?',
        message: 'Чат будет помечен как решённый.',
        confirmLabel: 'Решено',
        icon: 'check_circle',
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.chatService.updateSessionStatus(this.sessionId(), 'resolved');
        this.toast.success('Чат помечен как решённый');
      }
    });
  }

  closeSession(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Закрыть чат?',
        message: 'Чат будет закрыт. Клиент сможет начать новый.',
        confirmLabel: 'Закрыть',
        icon: 'close',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.chatService.updateSessionStatus(this.sessionId(), 'closed');
        this.toast.success('Чат закрыт');
      }
    });
  }

  // --- Payment actions ---

  requestCreateOrderFromChat(): void {
    this.createOrderFromChat.emit();
  }

  onPaymentClick(): void {
    markBadgeSeen('inline-payment');
    this.showPaymentBadge.set(false);
    this.openOnlinePayment();
  }

  openOnlinePayment(): void {
    const session = this.chatService.activeSession();
    if (!session) return;
    const phone = this.displayPhone() || '';
    const clientName = session.client_name || session.visitor_name || '';
    import('../payment-dialog/payment-dialog.component').then(m => {
      this.dialog.open(m.PaymentDialogComponent, {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data: {
          mode: 'chat' as const,
          phone,
          clientName,
          sessionId: session.id,
          // Личность клиента: телефон в чате маскируется для не-админов, по user_id/contact_id
          // диалог резолвит реальный телефон (для скидки/чека), не показывая его сотруднику.
          clientUserId: session.user_id ?? undefined,
          clientContactId: session.contact_id ?? undefined,
        },
      }).afterClosed().subscribe((result: { type?: string; orderId?: string; amount?: number; receiptNumber?: string } | undefined) => {
        if (result?.type === 'sent') {
          this.toast.success('Ссылка на оплату отправлена в чат');
        } else if (result?.type === 'transferInstructions') {
          this.toast.success('Реквизиты для перевода отправлены в чат');
        } else if (result?.type === 'transfer') {
          this.toast.success(`Перевод подтверждён, чек создан: ${result.receiptNumber ?? ''}`);
        } else if (result?.type === 'posReceipt') {
          this.toast.success(`POS-чек создан: ${result.receiptNumber ?? ''}`);
        }
      });
    });
  }

  openSubscriptionOffer(): void {
    const session = this.chatService.activeSession();
    if (!session) return;
    const phone = this.displayPhone() || '';
    const clientName = session.client_name || session.visitor_name || '';
    import('../subscription-offer/subscription-offer-dialog.component').then(m => {
      this.dialog.open(m.SubscriptionOfferDialogComponent, {
        width: '720px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        data: {
          sessionId: session.id,
          phone,
          clientName,
        },
      }).afterClosed().subscribe((result: { type?: string } | undefined) => {
        if (result?.type === 'sent') {
          this.toast.success('Предложение подписки отправлено в чат');
        } else if (result?.type === 'account-info-sent') {
          this.toast.success('Информация о подписке отправлена в чат');
        }
      });
    });
  }

  openRegisterStudentDialog(): void {
    const session = this.chatService.activeSession();
    if (!session) return;
    import('../student-verifications/in-person-student-verification-dialog.component').then(m => {
      this.dialog.open(m.InPersonStudentVerificationDialogComponent, {
        width: 'min(1096px, 95vw)',
        maxWidth: '95vw',
        maxHeight: '92vh',
        data: {
          sessionId: this.sessionId(),
          phone: this.displayPhone(),
        },
      });
    });
  }

  openSubscriptionGift(): void {
    const session = this.chatService.activeSession();
    if (!session) return;
    const phone = this.displayPhone() || '';
    const clientName = session.client_name || session.visitor_name || '';
    import('../subscription-offer/subscription-offer-dialog.component').then(m => {
      this.dialog.open(m.SubscriptionOfferDialogComponent, {
        width: '720px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        data: {
          mode: 'gift' as const,
          sessionId: session.id,
          phone,
          clientName,
        },
      }).afterClosed().subscribe((result: { type?: string; promoCode?: string } | undefined) => {
        if (result?.type === 'gifted') {
          this.toast.success('Подарочный промокод отправлен в чат');
        } else if (result?.type === 'account-info-sent') {
          this.toast.success('Информация о подписке отправлена в чат');
        }
      });
    });
  }

  // --- File upload ---

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const related = event.relatedTarget as Node | null;
    if (!related || !this.el.nativeElement.contains(related)) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) {
      for (const file of Array.from(files)) {
        this.uploadFile(file);
      }
    }
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          this.uploadFile(file);
          event.preventDefault();
          break;
        }
      }
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.uploadFile(input.files[0]);
      input.value = '';
    }
  }

  private uploadFile(file: File): void {
    const sessionId = this.sessionId();
    if (!sessionId) return;
    // No size limit — file goes directly to S3 via presigned URL
    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.chatService.uploadFileWithProgress(sessionId, file, (percent) => {
      this.uploadProgress.set(percent);
    }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.chatService.addMessage(res.data);
        }
        this.uploadProgress.set(100);
        this.uploading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось загрузить файл');
        this.uploading.set(false);
        this.uploadProgress.set(0);
      },
    });
  }

  requestAiSuggestion(): void {
    this.aiLoading.set(true);
    this.aiSuggestion.set(null);
    this.chatService.requestSuggestion(this.sessionId()).subscribe({
      next: (res) => {
        if (res.success) {
          this.aiSuggestion.set(res.data.suggestion);
        }
        this.aiLoading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось получить подсказку');
        this.aiLoading.set(false);
      },
    });
  }

  loadAiSuggestions(): void {
    const sessionId = this.sessionId();
    if (!sessionId) return;
    this.aiSuggestionsLoading.set(true);
    this.aiCrmApi.getSuggestedReplies(sessionId).subscribe({
      next: (suggestions) => {
        this.aiSuggestions.set(suggestions);
        this.aiSuggestionsLoading.set(false);
      },
      error: () => {
        this.aiSuggestionsLoading.set(false);
      },
    });
  }

  useSuggestion(text: string): void {
    this.replyText = text;
    this.aiSuggestions.set([]);
  }

  exportChat(format: 'csv' | 'txt'): void {
    const id = this.sessionId();
    this.http.get(`/api/visitor-chat/admin/sessions/${id}/export?format=${format}`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${id.slice(0, 8)}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error('Не удалось экспортировать чат'),
    });
  }

  downloadPhotos(type?: 'sent' | 'received'): void {
    const id = this.sessionId();
    const action = type === 'sent'
      ? this.downloadService.downloadSent(id)
      : type === 'received'
        ? this.downloadService.downloadReceived(id)
        : this.downloadService.downloadAll(id);
    action
      .then(() => this.toast.success('ZIP-архив скачивается'))
      .catch(() => this.toast.error('Не удалось скачать архив'));
  }

  acceptSuggestion(): void {
    const text = this.aiSuggestion();
    if (text) {
      this.replyText = text;
      this.aiSuggestion.set(null);
    }
  }

  senderLabel(msg: OperatorChatMessage): string {
    if (msg.sender_type === 'visitor') return 'Клиент';
    if (msg.sender_type === 'bot') {
      return this.isAiAssistantMessage(msg) ? 'Искусственный интеллект' : 'Автоматическое сообщение';
    }
    if (msg.sender_type === 'system') return 'Система';
    if (msg.sender_type === 'internal_note') return `${msg.sender_name || 'Оператор'} (заметка)`;
    return msg.sender_name || 'Оператор';
  }

  protected isAiAssistantMessage(msg: OperatorChatMessage): boolean {
    return msg.sender_type === 'bot'
      && (msg.metadata?.['kind'] === 'ai_agent_reply' || msg.sender_name === 'Ассистент');
  }

  timeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  dateLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  private relativePastLabel(iso: string): string {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return this.timeLabel(iso);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (elapsedSeconds < 60) return 'только что';

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes} мин назад`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours} ч назад`;

    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays === 1) return `вчера в ${this.timeLabel(iso)}`;
    if (elapsedDays < 7) return `${elapsedDays} дн назад`;

    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;
  readonly isBrandChannel = isBrandChannel;
  readonly channelSvgIcon = channelSvgIcon;

  csatColor(score: number): string {
    if (score >= 4) return 'csat-good';
    if (score === 3) return 'csat-neutral';
    return 'csat-bad';
  }

  // ─── Follow-up ─────────────────────
  private loadFollowup(sessionId: string): void {
    this.chatService.getFollowup(sessionId).subscribe({
      next: (res) => this.activeFollowup.set(res.data),
      error: () => this.activeFollowup.set(null),
    });
  }

  scheduleFollowup(minutes: number): void {
    const sessionId = this.sessionId();
    const followUpAt = new Date(Date.now() + minutes * 60_000).toISOString();
    this.chatService.createFollowup(sessionId, followUpAt).subscribe({
      next: (res) => {
        if (res.success) this.activeFollowup.set(res.data);
      },
    });
  }

  scheduleFollowupTomorrow(): void {
    const sessionId = this.sessionId();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    this.chatService.createFollowup(sessionId, tomorrow.toISOString()).subscribe({
      next: (res) => {
        if (res.success) this.activeFollowup.set(res.data);
      },
    });
  }

  cancelActiveFollowup(): void {
    const f = this.activeFollowup();
    if (!f) return;
    this.chatService.cancelFollowup(this.sessionId(), f.id).subscribe({
      next: () => this.activeFollowup.set(null),
    });
  }

  followupTimeLeft(): string {
    const f = this.activeFollowup();
    if (!f) return '';
    const diff = new Date(f.follow_up_at).getTime() - Date.now();
    if (diff < 0) return 'сейчас';
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `${mins} мин`;
    const hours = Math.round(mins / 60);
    return `${hours} ч`;
  }

  isPrintable(msg: OperatorChatMessage): boolean {
    return !!(msg.attachment_url &&
      (msg.message_type === 'image' || msg.message_type === 'file'));
  }

  fileIcon(url: string, mimeType?: string | null): string { return getFileIcon(url, mimeType); }
  fileLabel(url: string, mimeType?: string | null): string { return getFileLabel(url, mimeType); }
  fileCategory(url: string, mimeType?: string | null): string { return getFileCategory(url, mimeType); }

  /** Check if a file URL points to an image (for thumbnail preview in file cards) */
  isImageFile(url: string, mimeType?: string | null): boolean { return isBrowserPreviewableImage(url, mimeType); }

  canPreviewImage(msg: OperatorChatMessage): boolean {
    return (msg.message_type === 'image' || msg.message_type === 'file')
      && isBrowserPreviewableImage(msg.attachment_url, msg.original_mime_type);
  }

  onChatImageLoadError(event: Event): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;

    const attempts = Number.parseInt(img.dataset['chatMediaRetryCount'] ?? '0', 10);
    if (!Number.isFinite(attempts) || attempts >= CHAT_IMAGE_MAX_RETRIES) return;

    img.dataset['chatMediaRetryCount'] = String(attempts + 1);
    const delayMs = attempts === 0 ? 500 : 2000;

    window.setTimeout(() => {
      const source = img.currentSrc || img.src;
      if (!source) return;
      img.src = chatMediaRetryUrl(source, Date.now(), window.location.origin);
    }, delayMs);
  }

  fileName(msg: OperatorChatMessage): string {
    // Priority: original_file_name from media_attachments → humanFileName fallback
    if (msg.original_file_name) return decodeFileName(msg.original_file_name);
    return humanFileName(msg.content, msg.attachment_url ?? null, msg.original_mime_type ?? undefined);
  }

  formatFileSize(msg: OperatorChatMessage): string {
    const metadata = msg.metadata;
    const size = metadata?.['file_size'] as number | undefined;
    if (!size || typeof size !== 'number') return '';
    if (size < 1024) return `${size} Б`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
    return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  }

  getExtension(msg: OperatorChatMessage): string {
    const url = msg.attachment_url;
    if (!url) return '';
    const lastSegment = url.split('/').pop()?.split('?')[0] ?? '';
    const dotIdx = lastSegment.lastIndexOf('.');
    if (dotIdx > 0) {
      return '.' + lastSegment.substring(dotIdx + 1).toLowerCase();
    }
    return '';
  }

  quickPrintMsg(msg: OperatorChatMessage): void {
    if (!msg.attachment_url || !this.isImageFile(msg.attachment_url, msg.original_mime_type)) return;
    this.quickPrintService.quickPrint(msg.attachment_url, this.quickPrintService.lastPresetSlug(), 1);
  }

  printSingle(msg: OperatorChatMessage): void {
    this.goToPrintCenter([msg]);
  }

  /**
   * Комплект фото на документы — открывает сервис печати (print-center) с готовыми
   * настройками: лист 10×15, матовая бумага, высокое качество, струйник по студии
   * (Соборный → L8050 правый, Баррикадная → L8050), N×фото на лист + брендовый подвал.
   * Само фото уже обрезано фотографом; раскладку считает print-center по mode=document-set.
   */
  printDocumentSet(msg: OperatorChatMessage): void {
    // Гейт как у самой кнопки в шаблоне: фото-вложение (isImageFile), а НЕ canPreviewImage
    // — у ботовых сообщений «Ваша фотография готова» message_type ≠ image, и canPreviewImage
    // ложно, хотя кнопка показана и фото есть.
    if (!msg.attachment_url || !this.isImageFile(msg.attachment_url, msg.original_mime_type)) {
      this.toast.warning('Фото недоступно для печати');
      return;
    }
    const sessionId = this.sessionId();
    if (!sessionId) {
      this.toast.warning('Чат не выбран');
      return;
    }
    // Явная передача фото в print-center — чтобы диалог открылся сразу, не дожидаясь
    // пере-обнаружения фото в потоке сообщений (гонка загрузки сессии).
    this.documentSetHandoff.set({
      url: msg.attachment_url,
      name: this.fileName(msg),
      sessionId,
      messageId: msg.id,
      faceValidation: msg.id ? this.getFaceValidation(msg.id) : undefined,
    });
    this.router.navigate(['/employee/print-center'], {
      queryParams: { chat: sessionId, messages: msg.id, mode: 'document-set' },
    }).then(ok => {
      if (!ok) {
        // Навигация отменена (guard) — убираем неиспользованный handoff, чтобы он не «выстрелил» позже.
        this.documentSetHandoff.consume();
        this.toast.warning('Не удалось открыть сервис печати');
      }
    }).catch(() => {
      this.documentSetHandoff.consume();
      this.toast.error('Ошибка открытия печати');
    });
  }

  async printDocumentSetEnvelope(): Promise<void> {
    try {
      const [{ buildEnvelopeC6DialogData }, { PrintDialogComponent }, { printDialogConfig }] = await Promise.all([
        import('../../utils/document-set-dialog'),
        import('../print-dialog/print-dialog.component'),
        import('../../utils/print-dialog-config'),
      ]);
      const data = await buildEnvelopeC6DialogData();
      this.dialog.open(PrintDialogComponent, printDialogConfig(data))
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((result?: { printed?: boolean }) => {
          if (result?.printed) {
            this.toast.success('Конверт C6 отправлен в печать');
          }
        });
    } catch {
      this.toast.error('Не удалось открыть печать конверта');
    }
  }

  /** Get cached face validation result for a message. */
  getFaceValidation(msgId: string): FaceValidationResult | undefined {
    return this.faceValidations()[msgId as MessageId];
  }

  /** Run on-demand face validation for a chat image message. */
  validateFaceForMessage(msg: OperatorChatMessage): void {
    if (!msg.attachment_url || !msg.id || !this.isImageFile(msg.attachment_url, msg.original_mime_type)) return;
    const id = msg.id as MessageId;
    if (this.faceValidations()[id] || this.faceValidationLoading().includes(id)) return;

    this.faceValidationLoading.update(prev => [...prev, id]);
    this.faceValidationApi.validate(msg.attachment_url, { message_id: msg.id }).subscribe({
      next: result => {
        this.faceValidations.update(prev => ({ ...prev, [id]: result }));
        this.faceValidationLoading.update(prev => prev.filter(x => x !== id));
        const mm = result.face_height_mm;
        const ok = result.is_valid_passport;
        this.toast.info(
          ok ? `Лицо ${mm}мм — соответствует ГОСТ (30-34мм)` : `Лицо ${mm}мм — ${result.verdict === 'no_face' ? 'лицо не найдено' : 'не соответствует ГОСТ (30-34мм)'}`,
        );
      },
      error: () => {
        this.faceValidationLoading.update(prev => prev.filter(x => x !== id));
        this.toast.error('Ошибка проверки лица');
      },
    });
  }

  openFinalPhotoUpload(): void {
    const session = this.chatService.activeSession();
    if (!session) return;
    import('./final-photo-upload-dialog.component').then(m => {
      this.dialog.open(m.FinalPhotoUploadDialogComponent, {
        width: '520px',
        maxHeight: '90vh',
        data: {
          chatSessionId: session.id,
          clientName: session.visitor_name || '',
        },
      });
    });
  }

  addPrintItemsToCart(items: SyncCartItem[]): void {
    this.cartItemsToAdd.emit(items);
  }

  private handlePrintCartResult(result: { cartItems?: SyncCartItem[] } | null | undefined): boolean {
    const items = result?.cartItems;
    if (!items?.length) return false;
    this.addPrintItemsToCart(items);
    return true;
  }

  loadClientOrders(): void {
    const session = this.chatService.activeSession();
    if (!session?.id) {
      this.clientOrdersSessionId = session?.id ?? null;
      this.clientOrdersLoading.set(false);
      this.clientOrders.set([]);
      return;
    }
    if (this.clientOrdersSessionId === session.id && this.clientOrders().length) return;
    this.clientOrdersSessionId = session.id;
    this.clientOrdersLoading.set(true);
    this.clientOrders.set([]);
    this.ordersApi.getOrders({ chat_session_id: session.id, limit: 10 }).subscribe({
      next: res => {
        this.clientOrdersLoading.set(false);
        if (res.success) this.clientOrders.set(res.data ?? []);
      },
      error: () => this.clientOrdersLoading.set(false),
    });
  }

  openClientOrder(orderId: string): void {
    this.navigateToItem.emit(createChatOrderNavigationTarget(orderId));
  }

  linkOrderToChat(orderId: string): void {
    this.ordersApi.linkChatSession(orderId, this.sessionId()).subscribe({
      next: () => {
        this.toast.success(`Заказ ${orderId} привязан к чату`);
        this.loadClientOrders();
      },
      error: () => this.toast.error('Не удалось привязать заказ'),
    });
  }

  /** Load orders linked to current chat session (auto-called on session change) */
  private loadLinkedOrders(): void {
    const session = this.chatService.activeSession();
    if (!session?.id) {
      this.clientOrdersSessionId = session?.id ?? null;
      this.clientOrdersLoading.set(false);
      this.clientOrders.set([]);
      return;
    }
    this.clientOrdersSessionId = session.id;
    this.clientOrdersLoading.set(true);
    this.clientOrders.set([]);
    this.ordersApi.getOrders({ chat_session_id: session.id, limit: 10 }).subscribe({
      next: res => {
        this.clientOrdersLoading.set(false);
        if (res.success) this.clientOrders.set(res.data ?? []);
      },
      error: () => this.clientOrdersLoading.set(false),
    });
  }

  /** Inline confirmation for quick mark-paid from chat header */
  showMarkPaidConfirm(order: PhotoPrintOrder): void {
    this.markPaidConfirmOrder.set(order);
  }

  cancelMarkPaidConfirm(): void {
    this.markPaidConfirmOrder.set(null);
  }

  quickMarkPaid(method: 'cash' | 'transfer'): void {
    const order = this.markPaidConfirmOrder();
    if (!order || this.markPaidSending()) return;
    this.markPaidSending.set(true);
    this.ordersApi.markPaid(order.order_id, { method }).subscribe({
      next: () => {
        this.markPaidSending.set(false);
        this.markPaidConfirmOrder.set(null);
        this.toast.success(`Заказ ${order.order_id} отмечен как оплаченный`);
        this.loadLinkedOrders();
      },
      error: (err) => {
        this.markPaidSending.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отметить оплату');
      },
    });
  }

  toggleApprovalWidget(): void {
    this.showApprovalWidget.update(v => !v);
  }

  approvalSessionStatus(msg: OperatorChatMessage): string | null {
    const interactive = msg.metadata?.interactive;
    if (!interactive || interactive.type !== 'approval_gallery') return null;
    const photos = interactive.photos;
    if (!photos?.length) return null;
    const approved = photos.filter(p => p.status === 'approved').length;
    const total = photos.length;
    if (approved === total) return `Все ${total} фото одобрены`;
    if (approved > 0) return `${approved}/${total} одобрено`;
    const withSelected = photos.filter(p => p.variants?.some(v => this.isSelectedApprovalVariant(v))).length;
    if (withSelected > 0) return `${withSelected}/${total} выбрано`;
    return null;
  }

  private isSelectedApprovalVariant(variant: unknown): boolean {
    return typeof variant === 'object'
      && variant !== null
      && 'is_selected' in variant
      && variant.is_selected === true;
  }

  isPaymentMessage(msg: OperatorChatMessage): boolean {
    return this.paymentCardView(msg) !== null;
  }

  paymentCardView(msg: OperatorChatMessage): ChatPaymentCardView | null {
    const payment = this.paymentMetadata(msg);
    if (payment) {
      const status = (this.nonEmptyString(payment.status) ?? 'pending').toLowerCase();
      const method = this.nonEmptyString(payment.method);
      const methodView = this.paymentMethodView(
        method,
        this.nonEmptyString(payment.methodLabel),
        this.nonEmptyString(payment.source),
      );
      return {
        amount: this.paymentAmount(payment.amount),
        status,
        statusLabel: this.paymentStatusLabel(status),
        icon: this.paymentStatusIcon(status),
        method,
        methodLabel: methodView.label,
        methodTone: methodView.tone,
        methodIcon: methodView.icon,
        detail: this.paymentDetail(payment),
        items: this.paymentItems(payment.items),
        canUseActions: this.nonEmptyString(payment.orderId) !== null && status !== 'paid' && status !== 'cancelled',
      };
    }

    if (!this.isPaymentConfirmationText(msg.content)) return null;
    const amount = this.paymentAmount(msg.metadata?.['amount']) ?? this.paymentConfirmationAmount(msg);
    if (amount === null) return null;
    const orderRef = this.paymentConfirmationOrderRef(msg);
    return {
      amount,
      status: 'paid',
      statusLabel: this.paymentStatusLabel('paid'),
      icon: this.paymentStatusIcon('paid'),
      method: 'online',
      methodLabel: 'ОНЛАЙН ОПЛАТА',
      methodTone: 'online',
      methodIcon: 'bolt',
      detail: orderRef ? `Ссылка ${orderRef}` : null,
      items: [],
      canUseActions: false,
    };
  }

  paymentCardMarkPaid(msg: OperatorChatMessage): void {
    const orderId = this.paymentOrderId(msg);
    if (!orderId || this.paymentCardBusy()) return;
    this.paymentCardBusy.set(true);
    this.ordersApi.markPaid(orderId, { method: 'transfer' }).subscribe({
      next: () => {
        this.paymentCardBusy.set(false);
        this.setPaymentCardStatus(msg, 'paid');
        this.toast.success('Заказ отмечен как оплаченный');
        this.loadLinkedOrders();
      },
      error: (err) => {
        this.paymentCardBusy.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отметить оплату');
      },
    });
  }

  paymentCardRemind(msg: OperatorChatMessage): void {
    const orderId = this.paymentOrderId(msg);
    if (!orderId || this.paymentCardBusy()) return;
    this.paymentCardBusy.set(true);
    this.ordersApi.sendReminder(orderId).subscribe({
      next: (res) => {
        this.paymentCardBusy.set(false);
        this.toast.success(res.message || 'Напоминание отправлено');
      },
      error: (err) => {
        this.paymentCardBusy.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отправить напоминание');
      },
    });
  }

  paymentCardCancelInvoice(msg: OperatorChatMessage): void {
    const orderId = this.paymentOrderId(msg);
    if (!orderId || this.paymentCardBusy()) return;
    this.paymentCardBusy.set(true);
    this.ordersApi.cancelPayment(orderId).subscribe({
      next: () => {
        this.paymentCardBusy.set(false);
        this.setPaymentCardStatus(msg, 'cancelled');
        this.toast.success('Счёт отменён');
        this.loadLinkedOrders();
      },
      error: (err) => {
        this.paymentCardBusy.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отменить счёт');
      },
    });
  }

  private paymentMetadata(msg: OperatorChatMessage): ChatPaymentMetadata | null {
    return msg.metadata?.payment ?? null;
  }

  private paymentAmount(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return this.parsePaymentAmount(value);
    return null;
  }

  private paymentStatusLabel(status: string): string {
    switch (status) {
      case 'paid': return 'Оплачено';
      case 'failed': return 'Ошибка';
      case 'cancelled': return 'Отменён';
      default: return 'Ожидает оплаты';
    }
  }

  private paymentStatusIcon(status: string): string {
    if (status === 'paid') return 'check_circle';
    if (status === 'failed' || status === 'cancelled') return 'cancel';
    return 'credit_card';
  }

  private paymentMethodView(method: string | null, explicitLabel: string | null, source: string | null): ChatPaymentMethodView {
    return chatPaymentMethodView(method, explicitLabel, source);
  }

  private paymentDetail(payment: ChatPaymentMetadata): string | null {
    const receiptNumber = this.nonEmptyString(payment.receiptNumber);
    if (receiptNumber) return `Чек ${receiptNumber}`;
    const orderRef = this.nonEmptyString(payment.orderRef);
    if (orderRef && payment.source === 'payment_link') return `Ссылка ${orderRef}`;
    return null;
  }

  private paymentItems(items: ChatPaymentMetadata['items'] | undefined): readonly ChatPaymentCardItem[] {
    if (!items?.length) return [];
    return items.flatMap((item) => {
      const name = this.nonEmptyString(item.name);
      const price = this.paymentAmount(item.price);
      return name && price !== null ? [{ name, price }] : [];
    });
  }

  private paymentOrderId(msg: OperatorChatMessage): string | null {
    const orderId = this.paymentMetadata(msg)?.orderId;
    return typeof orderId === 'string' && orderId.length > 0 ? orderId : null;
  }

  private isPendingPaymentCard(msg: OperatorChatMessage): boolean {
    const payment = this.paymentMetadata(msg);
    return !!payment && payment.status !== 'paid' && payment.status !== 'cancelled';
  }

  private setPaymentCardStatus(msg: OperatorChatMessage, status: 'paid' | 'cancelled'): void {
    const metadata = msg.metadata ?? {};
    const payment = metadata.payment;
    if (!payment) return;
    this.chatService.updateMessageMetadata(msg.id, {
      ...metadata,
      payment: { ...payment, status },
    });
  }

  private paymentConfirmationOrderIds(msg: OperatorChatMessage): string[] {
    const ids = new Set<string>();
    const payment = this.paymentMetadata(msg);
    if (payment?.status === 'paid' && typeof payment.orderId === 'string' && payment.orderId.length > 0) {
      ids.add(payment.orderId);
    }
    if (!this.isPaymentConfirmationText(msg.content)) return [...ids];

    for (const match of msg.content.matchAll(/\/track\/([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
      ids.add(match[1]);
    }
    for (const match of msg.content.matchAll(/\b(?:SF|chat)-[A-Za-z0-9_-]+\b/g)) {
      ids.add(match[0]);
    }
    return [...ids];
  }

  private paymentConfirmationAmount(msg: OperatorChatMessage): number | null {
    if (!this.isPaymentConfirmationText(msg.content)) return null;
    const patterns = [
      /оплата\s+([\d\s.,]+)\s*(?:₽|[рp]|руб\.?)\s+(?:получена|оплачен[ао]?)/i,
      /клиент\s+оплатил[аи]?\s+([\d\s.,]+)\s*(?:₽|[рp]|руб\.?)/i,
      /принят[ыа]\s+[^:\n]+:\s*([\d\s.,]+)\s*(?:₽|[рp]|руб\.?)/i,
    ];
    for (const pattern of patterns) {
      const match = msg.content.match(pattern);
      if (match) return this.parsePaymentAmount(match[1]);
    }
    return null;
  }

  private paymentConfirmationOrderRef(msg: OperatorChatMessage): string | null {
    const payment = this.paymentMetadata(msg);
    const paymentOrderRef = this.nonEmptyString(payment?.orderRef);
    if (paymentOrderRef) return paymentOrderRef;
    const metadataOrderRef = this.nonEmptyString(msg.metadata?.['orderRef']);
    if (metadataOrderRef) return metadataOrderRef;
    return msg.content.match(/по\s+ссылке\s+([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  }

  private parsePaymentAmount(value: string): number | null {
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  }

  private isPaymentLinkCustomerConfirmation(msg: OperatorChatMessage): boolean {
    return msg.metadata?.['kind'] === 'payment_link_paid_customer_confirmation';
  }

  private isOperatorPaymentLinkNotification(msg: OperatorChatMessage): boolean {
    if (this.isPaymentLinkCustomerConfirmation(msg)) return false;
    const interactiveStep = this.nonEmptyString(msg.metadata?.interactive?.['step']);
    if (interactiveStep === 'payment_link_paid') return true;
    const payment = this.paymentMetadata(msg);
    return msg.sender_type === 'system' && payment?.source === 'payment_link';
  }

  private paymentLinkDedupKey(msg: OperatorChatMessage): string | null {
    const payment = this.paymentMetadata(msg);
    return this.nonEmptyString(payment?.paymentLinkId)
      ?? this.nonEmptyString(msg.metadata?.['paymentLinkId'])
      ?? this.nonEmptyString(payment?.orderRef)
      ?? this.nonEmptyString(msg.metadata?.['orderRef']);
  }

  private isPaymentConfirmationText(content: string): boolean {
    const normalized = content.toLowerCase();
    return (normalized.includes('оплата') && (normalized.includes('получена') || normalized.includes('оплачен')))
      || /клиент\s+оплатил/.test(normalized)
      || /принят[ыа]\s+(?:наличные|перевод|сбп|карт[ауы]|безнал)/.test(normalized);
  }

  // ── Linked approval ──

  private loadLinkedApproval(sessionId: string): void {
    this.http.get<{ success: boolean; data: { id: string }[] }>(
      `/api/photo-approvals/sessions?chat_session_id=${sessionId}&limit=1`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data?.length) {
          this.linkedApprovalId.set(res.data[0].id);
        }
      },
    });
  }

  // ── Client linking methods ──

  private loadSuggestedClients(sessionId: string): void {
    this.chatService.getSuggestedClients(sessionId).subscribe({
      next: res => {
        if (res.success) {
          this.suggestedClients.set(res.data.users);
          this.suggestedBookings.set(res.data.bookings);
        }
      },
    });
  }

  confirmLinkClient(userId: string): void {
    const sessionId = this.sessionId();
    this.chatService.linkClient(sessionId, userId).subscribe({
      next: res => {
        if (res.success) {
          this.chatService.updateSessionFields(sessionId, {
            user_id: res.data.userId,
            client_name: res.data.clientName,
            client_phone: res.data.clientPhone,
          });
          this.toast.success(`Клиент ${res.data.clientName} привязан`);
          this.suggestedClients.set([]);
          this.suggestedBookings.set([]);
          this.clientSearchOpen.set(false);
          this.clientSearchResults.set([]);
        }
      },
      error: () => this.toast.error('Не удалось привязать клиента'),
    });
  }

  dismissSuggestions(): void {
    this.suggestedClients.set([]);
  }

  openClientSearch(): void {
    this.clientSearchOpen.set(true);
    this.clientSearchQuery.set('');
    this.clientSearchResults.set([]);
  }

  closeClientSearch(): void {
    this.clientSearchOpen.set(false);
    this.clientSearchQuery.set('');
    this.clientSearchResults.set([]);
  }

  onClientSearchInput(value: string): void {
    this.clientSearchQuery.set(value);
    if (this.clientSearchDebounce) clearTimeout(this.clientSearchDebounce);
    if (!value.trim()) { this.clientSearchResults.set([]); return; }
    this.clientSearchDebounce = setTimeout(() => {
      this.http.get<{ success: boolean; data: { users: SuggestedClient[] } }>(
        `/api/visitor-chat/admin/sessions/${this.sessionId()}/suggested-clients?q=${encodeURIComponent(value.trim())}`
      ).subscribe({
        next: res => {
          if (res.success) {
            this.clientSearchResults.set(res.data.users);
          }
        },
      });
    }, 400);
  }

  openBookingSearch(): void {
    this.bookingSearchOpen.set(true);
    if (!this.suggestedBookings().length) {
      this.loadSuggestedClients(this.sessionId());
    }
  }

  confirmLinkBooking(bookingId: string): void {
    const sessionId = this.sessionId();
    this.chatService.linkBooking(sessionId, bookingId).subscribe({
      next: res => {
        if (res.success) {
          this.toast.success('Запись привязана к чату');
          this.bookingSearchOpen.set(false);
        }
      },
      error: () => this.toast.error('Не удалось привязать запись'),
    });
  }

  bookingStatusLabel(status: string): string {
    return ({ pending: 'ожидание', confirmed: 'записан', completed: 'готово', cancelled: 'отмена', 'no-show': 'не пришёл' })[status] || status;
  }

  // ═══════════════════════════════════════════════════
  // MEDIA GRID — click handlers
  // ═══════════════════════════════════════════════════

  private toFile(msg: OperatorChatMessage): SelectedFile {
    return {
      msgId: msg.id,
      url: msg.attachment_url!,
      name: this.fileName(msg),
      type: this.canPreviewImage(msg) ? 'image' : 'file',
    };
  }

  private buildFileMap(items: OperatorChatMessage[]): Map<string, SelectedFile> {
    const map = new Map<string, SelectedFile>();
    for (const m of items) {
      if (m.attachment_url) map.set(m.id, this.toFile(m));
    }
    return map;
  }

  onMediaGridClick(event: Event, msg: OperatorChatMessage, groupItems: OperatorChatMessage[]): void {
    if (this.rbWasDrag) {
      this.rbWasDrag = false;
      return;
    }

    if (this.chatSelection.selectionMode()) {
      if (event instanceof MouseEvent && event.shiftKey) {
        const orderedIds = groupItems.filter(m => m.attachment_url).map(m => m.id);
        this.chatSelection.selectRange(orderedIds, msg.id, this.buildFileMap(groupItems));
      } else {
        this.chatSelection.toggleWithTrack(msg.id, this.toFile(msg));
      }
    } else {
      this.openLightbox(msg, groupItems);
    }
  }

  // ═══════════════════════════════════════════════════
  // RUBBER-BAND selection
  // ═══════════════════════════════════════════════════

  onGridMouseDown(event: MouseEvent, groupItems: OperatorChatMessage[]): void {
    if (event.button !== 0) return;
    // Don't start rubber-band on buttons
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('.media-grid-header')) return;

    event.preventDefault();
    this.rbActive.set(true);
    this.rbStart.set({ x: event.clientX, y: event.clientY });
    this.currentRbGroup = groupItems;
    this.rbWasDrag = false;
    this.rbCtrlHeld = event.ctrlKey || event.metaKey;

    if (!this.rbCtrlHeld) {
      this.rbPreExisting = new Map();
    } else {
      this.rbPreExisting = new Map(this.chatSelection.selected());
    }
    this.chatSelection.selectionMode.set(true);
  }

  onRbMouseMove(event: MouseEvent): void {
    if (!this.rbActive()) return;
    const start = this.rbStart()!;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!this.rbWasDrag && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    this.rbWasDrag = true;
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    this.rbRect.set({ x, y, w, h });
    this.updateRubberBandSelection();
  }

  onRbMouseUp(): void {
    if (!this.rbActive()) return;
    this.rbActive.set(false);
    this.rbRect.set(null);
    this.currentRbGroup = null;
    // If no drag happened, don't mark as drag
    if (!this.rbWasDrag && this.chatSelection.count() === 0) {
      this.chatSelection.selectionMode.set(false);
    }
  }

  private updateRubberBandSelection(): void {
    const rect = this.rbRect();
    if (!rect || !this.currentRbGroup) return;

    const gridBodies = this.el.nativeElement.querySelectorAll('.media-grid-body');
    if (!gridBodies.length) return;

    const toSelect: SelectedFile[] = [];
    gridBodies.forEach((gridEl: Element) => {
      const items = gridEl.querySelectorAll('.media-grid-item');
      items.forEach((el: Element) => {
        const msgId = (el as HTMLElement).dataset['msgId'];
        if (!msgId) return;
        const r = el.getBoundingClientRect();
        if (this.rectsIntersect(rect, { x: r.left, y: r.top, w: r.width, h: r.height })) {
          const msg = this.currentRbGroup!.find(m => m.id === msgId);
          if (msg?.attachment_url) {
            toSelect.push(this.toFile(msg));
          }
        }
      });
    });

    // Merge with pre-existing selection (Ctrl mode)
    const merged = new Map(this.rbPreExisting);
    for (const f of toSelect) {
      merged.set(f.msgId, f);
    }
    this.chatSelection.replaceSelection(Array.from(merged.values()));
  }

  private rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // ═══════════════════════════════════════════════════
  // LIGHTBOX
  // ═══════════════════════════════════════════════════

  openLightbox(msg: OperatorChatMessage, groupItems?: OperatorChatMessage[]): void {
    const images = (groupItems || [msg])
      .filter(m => this.canPreviewImage(m))
      .map(m => ({ url: m.attachment_url!, id: m.id }));
    if (!images.length) return;
    this.lightboxImages.set(images);
    this.lightboxIndex.set(images.findIndex(i => i.id === msg.id) || 0);
    this.lightboxOpen.set(true);
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
  }

  lightboxPrev(): void {
    this.lightboxIndex.update(i => Math.max(0, i - 1));
  }

  lightboxNext(): void {
    this.lightboxIndex.update(i => Math.min(this.lightboxImages().length - 1, i + 1));
  }

  lightboxDownload(): void {
    const img = this.lightboxImages()[this.lightboxIndex()];
    if (img) {
      // Use backend proxy for correct filename + MIME, fallback to fetch→blob
      this.downloadService.downloadByMessageId(img.id)
        .catch(() => this.downloadService.downloadSingle(img.url));
    }
  }

  downloadFile(msg: OperatorChatMessage): void {
    if (!msg.attachment_url) return;
    const filename = this.fileName(msg);
    // Use backend proxy (streams with correct Content-Disposition + MIME), fallback to fetch→blob
    this.downloadService.downloadByMessageId(msg.id, filename)
      .catch(() => this.downloadService.downloadSingle(msg.attachment_url!, filename));
  }

  rotatePhoto(msg: OperatorChatMessage): void {
    this.photoRotations.update(rotations => {
      const current = rotations.find(item => item.id === msg.id)?.rotation ?? 0;
      const next = { id: msg.id, rotation: (current + 90) % 360 };
      const exists = rotations.some(item => item.id === msg.id);
      return exists
        ? rotations.map(item => item.id === msg.id ? next : item)
        : [...rotations, next];
    });
  }

  getRotation(msgId: string): number {
    return this.photoRotations().find(item => item.id === msgId)?.rotation ?? 0;
  }

  printGroupAll(items: OperatorChatMessage[]): void {
    this.goToPrintCenter(items);
  }

  printAllChatPhotos(): void {
    this.goToPrintCenter();
  }

  goToPrintCenter(items: readonly OperatorChatMessage[] = []): void {
    const sessionId = this.sessionId();
    if (!sessionId) {
      this.toast.warning('Чат не выбран');
      return;
    }

    const messageIds = items
      .filter(message => !!message.attachment_url)
      .map(message => message.id);

    void this.router.navigate(['/employee/print-center'], {
      queryParams: {
        chat: sessionId,
        ...(messageIds.length > 0 ? { messages: messageIds.join(',') } : {}),
      },
    });
  }

  downloadGroupZip(items: OperatorChatMessage[]): void {
    const ids = items.filter(m => m.attachment_url).map(m => m.id);
    if (!ids.length) return;
    this.downloadService.downloadSelectedZip(this.sessionId(), ids)
      .then(() => this.toast.success('ZIP-архив скачивается'))
      .catch(() => this.toast.error('Не удалось скачать архив'));
  }

  // ── Message Reactions ──

  reactionKeys(reactions: import('../../services/operator-chat.service').MessageReactions | undefined): string[] {
    return reactions ? Object.keys(reactions) : [];
  }

  hasOwnReaction(users: import('../../services/operator-chat.service').ReactionUser[] | undefined): boolean {
    const myId = this.authService.currentUser()?.id;
    return users?.some(u => u.userId === myId) ?? false;
  }
}
