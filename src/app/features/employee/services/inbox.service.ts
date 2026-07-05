import { Injectable, inject, signal, computed, effect, untracked, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { ToastService } from '../../../core/services/toast.service';
import { BatchedUpdater } from '../../../shared/utils/batched-updater';
import { InboxItem, InboxCounts, InboxTypeFilter, InboxScopeFilter, InboxSortOption, InboxGroup } from '../models/inbox.model';

/** Partial update payload for inbox item — one of these per WS event, coalesced per sessionId. */
interface InboxItemPartialUpdate {
  kind: 'chat-upsert';
  sessionId: string;
  preview: string;
  sortTime: string;
  reopened?: boolean;
  session?: {
    visitorName?: string | null;
    visitorPhone?: string | null;
    channel?: string;
    status?: string;
    assignedOperatorId?: string | null;
    assignedOperatorName?: string | null;
    reopened?: boolean;
  } | null;
  unreadDelta: number; // added to counts.unread on flush (only for visitor-sent)
}

interface InboxResponse {
  success: boolean;
  data: InboxItem[];
  total: number;
}

interface CountsResponse {
  success: boolean;
  data: Partial<InboxCounts> | null;
}

interface ReopenClosedTodayResponse {
  success: boolean;
  affected: number;
}

const INITIAL_INBOX_COUNTS: InboxCounts = {
  total: 0,
  chat: 0,
  task: 0,
  booking: 0,
  order: 0,
  approval: 0,
  urgent: 0,
  unassigned: 0,
  unread: 0,
  unpaid: 0,
  paidUnlinked: 0,
};

@Injectable({ providedIn: 'root' })
export class InboxService {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly log = inject(LoggerService).createChild('InboxService');
  private readonly toastService = inject(ToastService);

  // Internal state
  private readonly _items = signal<InboxItem[]>([]);
  private readonly _counts = signal<InboxCounts>({ ...INITIAL_INBOX_COUNTS });
  private readonly _loading = signal(false);
  private readonly _typeFilter = signal<InboxTypeFilter>(
    (isPlatformBrowser(this.platformId)
      ? localStorage.getItem('inbox_type') as InboxTypeFilter | null
      : null) || 'chat',
  );
  private readonly _scopeFilter = signal<InboxScopeFilter>(
    (isPlatformBrowser(this.platformId)
      ? localStorage.getItem('inbox_scope') as InboxScopeFilter | null
      : null) || 'all',
  );
  private readonly _searchQuery = signal('');
  private readonly _sortOption = signal<InboxSortOption>('time');
  private readonly _paymentFilter = signal<'all' | 'paid_unlinked'>(
    this.readPaymentFilterFromStorage()
  );
  private _initialized = false;

  // Public readonly
  readonly items = this._items.asReadonly();
  readonly counts = this._counts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly typeFilter = this._typeFilter.asReadonly();
  readonly scopeFilter = this._scopeFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();
  readonly paymentFilter = this._paymentFilter.asReadonly();

  private readPaymentFilterFromStorage(): 'all' | 'paid_unlinked' {
    if (!isPlatformBrowser(this.platformId)) return 'all';
    const v = localStorage.getItem('inbox_payment_filter');
    return v === 'paid_unlinked' ? 'paid_unlinked' : 'all';
  }

  readonly totalCount = computed(() => this._counts().total);

  readonly filteredItems = computed(() => {
    const type = this._typeFilter();
    const sort = this._sortOption();
    const items = this._items();
    const byType = type === 'all' ? items : items.filter(i => i.type === type);

    const currentUserId = this.auth.currentUser()?.id;
    const isAdmin = this.auth.isAdmin();
    const filtered = byType.filter(i => {
      if (i.type !== 'chat' || !i.isPrivate) return true;
      return isAdmin || i.privateOwnerId === currentUserId;
    });

    if (sort === 'priority') {
      return [...filtered].sort((a, b) => a.priority - b.priority || new Date(b.sortTime).getTime() - new Date(a.sortTime).getTime());
    }
    return filtered;
  });

  readonly groupedItems = computed<InboxGroup[]>(() => {
    const items = this.filteredItems();
    if (!items.length) return [];

    const sort = this._sortOption();

    if (sort === 'priority') {
      // Group by priority level
      const priorityLabels: Record<number, string> = { 0: 'Срочные', 1: 'Высокие', 2: 'Обычные', 3: 'Низкие' };
      const priorityOrder = [0, 1, 2, 3];
      const groups: Record<number, InboxItem[]> = {};

      for (const item of items) {
        const p = item.priority >= 0 && item.priority <= 3 ? item.priority : 2;
        (groups[p] ??= []).push(item);
      }

      return priorityOrder.filter(p => groups[p]?.length).map(p => ({ label: priorityLabels[p], items: groups[p] }));
    }

    // Group by date (default for time sort)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - (now.getDay() || 7) * 86400000 + 86400000; // Monday

    const groups: Record<string, InboxItem[]> = {};
    const order = ['Сегодня', 'Вчера', 'На этой неделе', 'Ранее'];

    for (const item of items) {
      const ts = new Date(item.sortTime).getTime();
      let label: string;
      if (ts >= todayStart) label = 'Сегодня';
      else if (ts >= yesterdayStart) label = 'Вчера';
      else if (ts >= weekStart) label = 'На этой неделе';
      else label = 'Ранее';

      (groups[label] ??= []).push(item);
    }

    return order.filter(l => groups[l]?.length).map(label => ({ label, items: groups[label] }));
  });

  // WS-pushed inbox counts (from crm-event-queue worker)
  private _prevCountsJson = '';
  private _itemsSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsCountsEffect = effect(() => {
    const counts = this.wsService.inboxCounts();
    if (!counts || !this._initialized) return;
    const normalizedCounts = this.normalizeCounts(counts, untracked(() => this._counts()));
    this._counts.set(normalizedCounts);
    // When counts change (item removed/added in DB), sync _items with debounce
    const json = JSON.stringify(normalizedCounts);
    if (this._prevCountsJson && this._prevCountsJson !== json) {
      if (this._itemsSyncTimer) clearTimeout(this._itemsSyncTimer);
      this._itemsSyncTimer = setTimeout(() => this.loadItems(), 500);
    }
    this._prevCountsJson = json;
  });

  // Debounce for non-chat WS events (tasks, orders, approvals) — still use HTTP refresh
  private _refreshPending = false;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _countsTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleRefresh(): void {
    if (!this._initialized) return;
    if (!this._refreshPending) {
      this._refreshPending = true;
      if (this._refreshTimer) clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(() => {
        this._refreshPending = false;
        this.loadItems();
      }, 1000);
    }
    if (this._countsTimer) clearTimeout(this._countsTimer);
    this._countsTimer = setTimeout(() => this.loadCounts(), 3000);
  }

  /**
   * Chat WS events are coalesced through `inboxBatcher`. Multiple bursts on the
   * same sessionId collapse into one signal write on the next RAF tick — so we
   * never re-sort the items array synchronously for every individual event.
   */
  private readonly inboxBatcher = new BatchedUpdater<string, InboxItemPartialUpdate>((batch) => {
    this.applyChatBatch(batch);
  });

  // Chat messages — direct WS-driven inbox update (zero HTTP for real-time)
  private readonly chatEffect = effect(() => {
    const msg = this.wsService.visitorNewMessage();
    if (!msg || !this._initialized) return;

    const session = msg.session ?? null;
    const msgAny = msg as Record<string, unknown>;
    const dbRow = msgAny['message'] as Record<string, unknown> | undefined;
    const senderType = dbRow?.['sender_type'] || msgAny['senderType'] || 'visitor';

    const update: InboxItemPartialUpdate = {
      kind: 'chat-upsert',
      sessionId: msg.sessionId,
      preview: msg.content || '',
      sortTime: new Date(msg.timestamp).toISOString(),
      reopened: session?.reopened,
      session: session ? {
        visitorName: session.visitorName,
        visitorPhone: session.visitorPhone,
        channel: session.channel,
        status: session.status,
        assignedOperatorId: session.assignedOperatorId,
        assignedOperatorName: session.assignedOperatorName,
        reopened: session.reopened,
      } : null,
      unreadDelta: senderType === 'visitor' ? 1 : 0,
    };
    this.inboxBatcher.schedule(msg.sessionId, update);
  });

  // Payment-link events — flip hasPaidUnlinked badge on chat inbox items without HTTP refresh
  private readonly paymentLinkEffect = effect(() => {
    const evt = this.wsService.paymentLinkEvent();
    if (!evt || !this._initialized) return;
    untracked(() => {
      const conversationId = evt.data.conversationId;
      if (!conversationId) return;

      const paymentFilterActive = this._paymentFilter() === 'paid_unlinked';

      if (evt.event === 'payment-link:paid') {
        const existed = this._items().some(i => i.type === 'chat' && i.id === conversationId);
        const amount = this.metadataNumber(evt.data.amount, 0);
        this._items.update(items => items.map(i =>
          i.type === 'chat' && i.id === conversationId
            ? this.withPaidUnlinkedPayment(i, amount, evt.data.orderRef)
            : i
        ));
        // New paid_unlinked item should appear when filter is active but chat not in _items.
        if (paymentFilterActive && !existed) this.loadItems();
      } else if (evt.event === 'payment-link:linked') {
        // One chat can have several paid links. Refetch the aggregate instead of
        // assuming the linked payment was the last unlinked payment.
        this.loadItems();
        this.loadCounts();
      } else if (evt.event === 'payment-link:expired') {
        const orderRef = evt.data.orderRef;
        if (orderRef) {
          this.toastService.warning(`Ссылка ${orderRef} истекла`);
        }
      }
    });
  });

  private withPaidUnlinkedPayment(item: InboxItem, amount: number, orderRef: string | undefined): InboxItem {
    const currentCount = this.metadataNumber(
      item.metadata.paidUnlinkedCount,
      item.metadata.hasPaidUnlinked ? 1 : 0,
    );
    const currentAmount = this.metadataNumber(item.metadata.paidUnlinkedAmount, 0);
    const nextAmount = amount > 0 ? currentAmount + amount : currentAmount;

    return {
      ...item,
      metadata: {
        ...item.metadata,
        hasPaidUnlinked: true,
        paidUnlinkedCount: currentCount + 1,
        paidUnlinkedAmount: nextAmount > 0 ? nextAmount : undefined,
        paidUnlinkedOrderRef: orderRef ?? item.metadata.paidUnlinkedOrderRef,
      },
    };
  }

  private metadataNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /** Apply a coalesced batch of chat WS events to _items + _counts in one signal write. */
  private applyChatBatch(batch: Map<string, InboxItemPartialUpdate>): void {
    let unreadDelta = 0;
    for (const u of batch.values()) unreadDelta += u.unreadDelta;

    this._items.update(items => {
      // Work on a map keyed by id for upserts + final reorder by sortTime among touched keys.
      const byId = new Map<string, InboxItem>();
      for (const it of items) byId.set(it.id, it);

      const touched = new Set<string>();
      for (const [sessionId, u] of batch) {
        const existing = byId.get(sessionId);
        if (existing && existing.type === 'chat') {
          const s = u.session;
          const updated: InboxItem = {
            ...existing,
            preview: u.preview || existing.preview,
            sortTime: u.sortTime,
            unread: true,
            reopened: u.reopened ?? existing.reopened,
            ...(s ? {
              clientName: s.visitorName || existing.clientName,
              clientPhone: s.visitorPhone ?? existing.clientPhone,
              channel: s.channel || existing.channel,
              status: s.status || existing.status,
              assignedTo: s.assignedOperatorId ?? existing.assignedTo,
              assignedToName: s.assignedOperatorName ?? existing.assignedToName,
            } : {}),
          };
          byId.set(sessionId, updated);
          touched.add(sessionId);
        } else if (u.session) {
          const s = u.session;
          const newItem: InboxItem = {
            id: sessionId,
            type: 'chat',
            clientName: s.visitorName ?? null,
            clientPhone: s.visitorPhone ?? null,
            preview: u.preview,
            status: s.status || 'open',
            priority: s.status === 'open' ? 1 : 2,
            sortTime: u.sortTime,
            channel: s.channel,
            assignedTo: s.assignedOperatorId ?? undefined,
            assignedToName: s.assignedOperatorName ?? undefined,
            unread: true,
            reopened: s.reopened || false,
            metadata: {},
          };
          byId.set(sessionId, newItem);
          touched.add(sessionId);
        }
      }

      // Preserve original order, except move all touched chat items to the top
      // ordered by their sortTime descending (latest first).
      const touchedItems = [...touched].map(id => byId.get(id)!).filter(Boolean);
      touchedItems.sort((a, b) => new Date(b.sortTime).getTime() - new Date(a.sortTime).getTime());
      const untouched = items.filter(it => !touched.has(it.id));
      // Return new-items (those that weren't in original list) combined with updated existing ones on top.
      return [...touchedItems, ...untouched];
    });

    if (unreadDelta > 0) {
      this._counts.update(c => ({ ...c, unread: c.unread + unreadDelta }));
    }
  }

  // Chat privacy changed (claim-private / release-private) — direct WS-driven update
  private readonly privacyEffect = effect(() => {
    const evt = this.wsService.chatPrivacyChanged();
    if (!evt || !this._initialized) return;

    this._items.update(items => items.map(i =>
      i.id === evt.sessionId && i.type === 'chat'
        ? { ...i, isPrivate: evt.isPrivate, privateOwnerId: evt.ownerId }
        : i
    ));
  });

  // Chat removed from inbox (became private for someone else, or transferred to another operator)
  private readonly removeFromInboxEffect = effect(() => {
    const evt = this.wsService.chatRemovedFromInbox();
    if (!evt || !this._initialized) return;

    this._items.update(items => items.filter(i => !(i.id === evt.sessionId && i.type === 'chat')));
  });

  // Chat assignment — direct WS-driven update (no HTTP)
  private readonly assignmentEffect = effect(() => {
    const evt = this.wsService.chatAssignment();
    if (!evt || !this._initialized) return;

    this._items.update(items => {
      const idx = items.findIndex(i => i.type === 'chat' && i.id === evt.sessionId);
      if (idx < 0) return items;

      const item = items[idx];
      let updated: InboxItem;

      if (evt.event === 'assigned') {
        updated = { ...item, assignedTo: evt.operatorId, assignedToName: evt.operatorName, status: 'active' };
      } else if (evt.event === 'unassigned') {
        updated = { ...item, assignedTo: undefined, assignedToName: undefined };
      } else if (evt.event === 'transferred') {
        updated = { ...item, assignedTo: evt.toOperatorId, assignedToName: undefined };
      } else {
        return items;
      }

      return [...items.slice(0, idx), updated, ...items.slice(idx + 1)];
    });

    // Refresh counts after assignment changes (affects unassigned count)
    if (this._countsTimer) clearTimeout(this._countsTimer);
    this._countsTimer = setTimeout(() => this.loadCounts(), 2000);
  });

  // WS reconnect — catch-up from PostgreSQL after reconnection
  private readonly reconnectEffect = effect(() => {
    const state = this.wsService.connectionState();
    if (state.connected && this._initialized) {
      // Flush any pending WS-driven batch before the authoritative HTTP refresh
      // to avoid a transient mixed state in the items list.
      this.inboxBatcher.flushNow();
      this.loadItems();
      this.loadCounts();
    }
  });

  // Non-chat events still use HTTP refresh
  private readonly taskEffect = effect(() => {
    const evt = this.wsService.taskEvent();
    if (evt && this._initialized) this.scheduleRefresh();
  });

  private readonly orderEffect = effect(() => {
    const evt = this.wsService.orderEvent();
    if (evt && this._initialized) this.scheduleRefresh();
  });

  private readonly approvalEffect = effect(() => {
    const evt = this.wsService.approvalEvent();
    if (evt && this._initialized) this.scheduleRefresh();
  });

  init(): void {
    if (this._initialized || !isPlatformBrowser(this.platformId)) return;
    this._initialized = true;

    // Subscribe to task/booking WebSocket events
    this.wsService.subscribeToTasks('all');

    // Subscribe to visitor chat events
    this.wsService.joinVisitorChats();

    this.loadItems();
    this.loadCounts();

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      this.wsService.unsubscribeFromTasks();
      this.wsService.leaveVisitorChats();
      this._initialized = false;
      if (this._refreshTimer) clearTimeout(this._refreshTimer);
      if (this._countsTimer) clearTimeout(this._countsTimer);
      if (this._itemsSyncTimer) clearTimeout(this._itemsSyncTimer);
      this.inboxBatcher.destroy();
    });
  }

  loadItems(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const scope = this._scopeFilter();
    const search = this._searchQuery();

    const sort = this._sortOption();
    let url = `/api/crm/inbox?filter=${scope}&sort=${sort}&limit=200`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const paymentFilter = this._paymentFilter();
    if (paymentFilter !== 'all') url += `&paymentFilter=${paymentFilter}`;

    this._loading.set(true);
    this.http.get<InboxResponse>(url).subscribe({
      next: (res) => {
        if (res.success) {
          this._items.set(res.data.map(i => this.normalizeItem(i)));
        }
        this._loading.set(false);
      },
      error: (err) => {
        this.log.error('Failed to load inbox items', { httpStatus: err?.status, scope: this._scopeFilter() });
        this._loading.set(false);
      },
    });
  }

  /** Normalize privacy fields — accept either camelCase or snake_case from backend. */
  private normalizeItem(raw: InboxItem): InboxItem {
    const anyRaw = raw as InboxItem & { is_private?: boolean; private_owner_id?: string | null };
    const isPrivate = raw.isPrivate ?? anyRaw.is_private ?? false;
    const privateOwnerId = raw.privateOwnerId ?? anyRaw.private_owner_id ?? null;
    return { ...raw, isPrivate, privateOwnerId };
  }

  private normalizeCounts(raw: Partial<InboxCounts> | null | undefined, fallback: InboxCounts): InboxCounts {
    const counts = raw ?? {};
    return {
      total: this.normalizeCountValue(counts.total, fallback.total),
      chat: this.normalizeCountValue(counts.chat, fallback.chat),
      task: this.normalizeCountValue(counts.task, fallback.task),
      booking: this.normalizeCountValue(counts.booking, fallback.booking),
      order: this.normalizeCountValue(counts.order, fallback.order),
      approval: this.normalizeCountValue(counts.approval, fallback.approval),
      urgent: this.normalizeCountValue(counts.urgent, fallback.urgent),
      unassigned: this.normalizeCountValue(counts.unassigned, fallback.unassigned),
      unread: this.normalizeCountValue(counts.unread, fallback.unread),
      unpaid: this.normalizeCountValue(counts.unpaid, fallback.unpaid),
      paidUnlinked: this.normalizeCountValue(counts.paidUnlinked, fallback.paidUnlinked),
    };
  }

  private normalizeCountValue(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  loadCounts(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const scope = this._scopeFilter();
    this.http.get<CountsResponse>(`/api/crm/inbox/counts?filter=${scope}`).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this._counts.set(this.normalizeCounts(res.data, this._counts()));
        }
      },
      error: (err) => {
        this.log.error('Failed to load inbox counts', { httpStatus: err?.status, scope });
      },
    });
  }

  setTypeFilter(type: InboxTypeFilter): void {
    this._typeFilter.set(type);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('inbox_type', type);
    }
  }

  setScopeFilter(scope: InboxScopeFilter): void {
    this._scopeFilter.set(scope);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('inbox_scope', scope);
    }
    this.loadItems();
    this.loadCounts();
  }

  setSearch(query: string): void {
    this._searchQuery.set(query);
    this.loadItems();
  }

  setSortOption(sort: InboxSortOption): void {
    this._sortOption.set(sort);
    this.loadItems();
  }

  setPaymentFilter(v: 'all' | 'paid_unlinked'): void {
    this._paymentFilter.set(v);
    if (isPlatformBrowser(this.platformId)) {
      try { localStorage.setItem('inbox_payment_filter', v); } catch { /* quota/ssr */ }
    }
    this.loadItems();
  }

  refresh(): void {
    this.loadItems();
    this.loadCounts();
  }

  reopenClosedToday(): Observable<ReopenClosedTodayResponse> {
    return this.http.post<ReopenClosedTodayResponse>('/api/crm/inbox/reopen-closed-today', {});
  }

  /** Mark a single inbox item as read (clear unread dot) */
  markItemRead(id: string): void {
    this._items.update(items => {
      const idx = items.findIndex(i => i.id === id);
      if (idx < 0 || !items[idx].unread) return items;
      return items.map(i => i.id === id ? { ...i, unread: false } : i);
    });
  }

  bulkAction(action: string, ids: string[], payload?: Record<string, string>): void {
    this.http.post<{ success: boolean; affected: number }>('/api/crm/inbox/bulk', { action, ids, payload }).subscribe({
      next: () => this.refresh(),
    });
  }
}
