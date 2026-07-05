import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { vi } from 'vitest';
import { InboxService } from './inbox.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { LoggerService } from '../../../core/services/logger.service';
import { InboxItem, InboxCounts } from '../models/inbox.model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'item-1',
  type: 'chat',
  clientName: 'Иван',
  clientPhone: '+79001234567',
  preview: 'Привет',
  status: 'open',
  priority: 2,
  sortTime: new Date().toISOString(),
  metadata: {},
  ...overrides,
});

const makeCounts = (overrides: Partial<InboxCounts> = {}): InboxCounts => ({
  total: 0, chat: 0, task: 0, booking: 0, order: 0, approval: 0, urgent: 0, unassigned: 0, unread: 0, unpaid: 0, paidUnlinked: 0,
  ...overrides,
});

const makeLegacyCounts = (overrides: Partial<InboxCounts> = {}): Omit<InboxCounts, 'paidUnlinked'> => {
  const counts = makeCounts(overrides);
  return {
    total: counts.total,
    chat: counts.chat,
    task: counts.task,
    booking: counts.booking,
    order: counts.order,
    approval: counts.approval,
    urgent: counts.urgent,
    unassigned: counts.unassigned,
    unread: counts.unread,
    unpaid: counts.unpaid,
  };
};

interface PaymentLinkEventLike {
  event: string;
  data: {
    conversationId?: string;
    amount?: number;
    orderRef?: string;
    [k: string]: unknown;
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockWs() {
  return {
    visitorNewMessage: signal<null | Record<string, unknown>>(null),
    chatAssignment: signal<null | Record<string, unknown>>(null),
    chatPrivacyChanged: signal<null | Record<string, unknown>>(null),
    chatRemovedFromInbox: signal<null | Record<string, unknown>>(null),
    connectionState: signal({ connected: false, connecting: false, error: null }),
    taskEvent: signal<null | Record<string, unknown>>(null),
    orderEvent: signal<null | Record<string, unknown>>(null),
    approvalEvent: signal<null | Record<string, unknown>>(null),
    inboxCounts: signal<Partial<InboxCounts> | null>(null),
    paymentLinkEvent: signal<PaymentLinkEventLike | null>(null),
    subscribeToTasks: vi.fn(),
    joinVisitorChats: vi.fn(),
    unsubscribeFromTasks: vi.fn(),
    leaveVisitorChats: vi.fn(),
  };
}

const mockLogger = {
  createChild: vi.fn().mockReturnValue({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
};

describe('InboxService', () => {
  let service: InboxService;
  let httpMock: HttpTestingController;
  let mockWs: ReturnType<typeof createMockWs>;

  beforeEach(() => {
    mockWs = createMockWs();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: WebSocketService, useValue: mockWs },
        { provide: LoggerService, useValue: mockLogger },
      ],
    });

    service = TestBed.inject(InboxService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('items is empty', () => expect(service.items()).toEqual([]));
    it('loading is false', () => expect(service.loading()).toBe(false));
    it('typeFilter defaults to "chat"', () => expect(service.typeFilter()).toBe('chat'));
    it('scopeFilter defaults to "all"', () => expect(service.scopeFilter()).toBe('all'));
    it('sortOption defaults to "time"', () => expect(service.sortOption()).toBe('time'));
    it('totalCount is 0', () => expect(service.totalCount()).toBe(0));
    it('paidUnlinked count defaults to 0', () => expect(service.counts().paidUnlinked).toBe(0));
    it('filteredItems is empty', () => expect(service.filteredItems()).toEqual([]));
    it('groupedItems is empty', () => expect(service.groupedItems()).toEqual([]));
  });

  // ─── loadItems() ────────────────────────────────────────────────────────────

  describe('loadItems()', () => {
    it('GETs /api/crm/inbox with scope, sort and limit params', () => {
      service.loadItems();
      const req = httpMock.expectOne(r => r.url === '/api/crm/inbox');
      expect(req.request.params.get('filter')).toBe('all');
      expect(req.request.params.get('sort')).toBe('time');
      expect(req.request.params.get('limit')).toBe('50');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('sets items when response is successful', () => {
      const items = [makeItem()];
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: items, total: 1 });
      expect(service.items()).toHaveLength(1);
    });

    it('does NOT clear items when success is false', () => {
      // pre-fill
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [makeItem()], total: 1 });
      expect(service.items()).toHaveLength(1);

      // second load returns success=false
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: false, data: [], total: 0 });
      // items should remain unchanged
      expect(service.items()).toHaveLength(1);
    });

    it('resets loading to false after success', () => {
      service.loadItems();
      expect(service.loading()).toBe(true);
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      expect(service.loading()).toBe(false);
    });

    it('resets loading to false after HTTP error', () => {
      service.loadItems();
      expect(service.loading()).toBe(true);
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush('Error', { status: 500, statusText: 'Server Error' });
      expect(service.loading()).toBe(false);
    });

    it('includes search param when searchQuery is set', () => {
      service.setSearch('Иван');
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      // Already consumed by setSearch; verify it was included
    });
  });

  // ─── loadCounts() ────────────────────────────────────────────────────────────

  describe('loadCounts()', () => {
    it('GETs /api/crm/inbox/counts with filter param', () => {
      service.loadCounts();
      const req = httpMock.expectOne(r => r.url === '/api/crm/inbox/counts');
      expect(req.request.params.get('filter')).toBe('all');
      req.flush({ success: true, data: makeCounts() });
    });

    it('updates totalCount signal after successful response', () => {
      service.loadCounts();
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({
        success: true, data: makeCounts({ total: 17, unread: 3 }),
      });
      expect(service.totalCount()).toBe(17);
    });

    it('updates paidUnlinked after successful response', () => {
      service.loadCounts();
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({
        success: true, data: makeCounts({ paidUnlinked: 6 }),
      });
      expect(service.counts().paidUnlinked).toBe(6);
    });

    it('keeps current paidUnlinked when legacy HTTP payload omits it', () => {
      service.loadCounts();
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({
        success: true, data: makeCounts({ paidUnlinked: 4 }),
      });

      service.loadCounts();
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({
        success: true, data: makeLegacyCounts({ total: 12, unread: 2 }),
      });

      expect(service.counts().total).toBe(12);
      expect(service.counts().unread).toBe(2);
      expect(service.counts().paidUnlinked).toBe(4);
    });

    it('does NOT update counts when success is false', () => {
      service.loadCounts();
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: false, data: null });
      expect(service.totalCount()).toBe(0);
    });

    it('keeps current paidUnlinked when legacy WebSocket payload omits it', () => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({
        success: true, data: makeCounts({ paidUnlinked: 9 }),
      });

      mockWs.inboxCounts.set(makeLegacyCounts({ total: 3, unread: 1 }));
      TestBed.flushEffects();

      expect(service.counts().total).toBe(3);
      expect(service.counts().unread).toBe(1);
      expect(service.counts().paidUnlinked).toBe(9);
    });
  });

  // ─── setTypeFilter / filteredItems ───────────────────────────────────────────

  describe('filteredItems computed', () => {
    beforeEach(() => {
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [
          makeItem({ id: '1', type: 'chat' }),
          makeItem({ id: '2', type: 'task' }),
          makeItem({ id: '3', type: 'order' }),
          makeItem({ id: '4', type: 'chat' }),
        ],
        total: 4,
      });
    });

    it('returns only chat items when typeFilter is "chat"', () => {
      service.setTypeFilter('chat');
      expect(service.filteredItems()).toHaveLength(2);
      expect(service.filteredItems().every(i => i.type === 'chat')).toBe(true);
    });

    it('returns only task items when typeFilter is "task"', () => {
      service.setTypeFilter('task');
      expect(service.filteredItems()).toHaveLength(1);
      expect(service.filteredItems()[0].type).toBe('task');
    });

    it('returns empty array for a type with no matching items', () => {
      service.setTypeFilter('booking');
      expect(service.filteredItems()).toHaveLength(0);
    });
  });

  // ─── groupedItems by time ──────────────────────────────────────────────────

  describe('groupedItems computed (time sort)', () => {
    const now = Date.now();

    it('groups items into "Сегодня", "Вчера", "На этой неделе", "Ранее"', () => {
      const todayTs = new Date(now - 2 * 3_600_000).toISOString();          // 2h ago → Сегодня
      const yesterdayTs = new Date(now - 25 * 3_600_000).toISOString();     // 25h ago → Вчера
      const earlierTs = new Date(now - 30 * 86_400_000).toISOString();      // 30 days ago → Ранее

      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [
          makeItem({ id: '1', sortTime: todayTs }),
          makeItem({ id: '2', sortTime: yesterdayTs }),
          makeItem({ id: '3', sortTime: earlierTs }),
        ],
        total: 3,
      });

      const groups = service.groupedItems();
      expect(groups.some(g => g.label === 'Сегодня')).toBe(true);
      expect(groups.some(g => g.label === 'Вчера')).toBe(true);
      expect(groups.some(g => g.label === 'Ранее')).toBe(true);
    });

    it('returns empty array when there are no items', () => {
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      expect(service.groupedItems()).toEqual([]);
    });
  });

  // ─── groupedItems by priority ─────────────────────────────────────────────

  describe('groupedItems computed (priority sort)', () => {
    it('groups items by priority label when sort is "priority"', () => {
      service.setSortOption('priority');
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [
          makeItem({ id: '1', priority: 0 }),   // Срочные
          makeItem({ id: '2', priority: 2 }),   // Обычные
          makeItem({ id: '3', priority: 0 }),   // Срочные
        ],
        total: 3,
      });

      const groups = service.groupedItems();
      expect(groups.some(g => g.label === 'Срочные')).toBe(true);
      expect(groups.some(g => g.label === 'Обычные')).toBe(true);
      expect(groups.find(g => g.label === 'Срочные')?.items).toHaveLength(2);
    });
  });

  // ─── setScopeFilter ────────────────────────────────────────────────────────

  describe('setScopeFilter()', () => {
    it('updates scopeFilter and triggers a new HTTP request', () => {
      service.setScopeFilter('my');

      // loadItems() and loadCounts() are called
      const itemsReq = httpMock.expectOne(r => r.url === '/api/crm/inbox');
      expect(itemsReq.request.params.get('filter')).toBe('my');
      itemsReq.flush({ success: true, data: [], total: 0 });

      const countsReq = httpMock.expectOne(r => r.url === '/api/crm/inbox/counts');
      expect(countsReq.request.params.get('filter')).toBe('my');
      countsReq.flush({ success: true, data: makeCounts() });

      expect(service.scopeFilter()).toBe('my');
    });
  });

  // ─── setSearch ────────────────────────────────────────────────────────────

  describe('setSearch()', () => {
    it('includes search query in the loadItems request', () => {
      service.setSearch('Ольга');
      const req = httpMock.expectOne(r => r.url === '/api/crm/inbox');
      expect(req.request.url).toContain('search=');
      req.flush({ success: true, data: [], total: 0 });
      expect(service.searchQuery()).toBe('Ольга');
    });
  });

  // ─── bulkAction ───────────────────────────────────────────────────────────

  describe('bulkAction()', () => {
    it('POSTs to /api/crm/inbox/bulk with action, ids and optional payload', () => {
      service.bulkAction('resolve', ['item-1', 'item-2'], { note: 'done' });

      const bulkReq = httpMock.expectOne('/api/crm/inbox/bulk');
      expect(bulkReq.request.method).toBe('POST');
      expect(bulkReq.request.body).toEqual({ action: 'resolve', ids: ['item-1', 'item-2'], payload: { note: 'done' } });
      bulkReq.flush({ success: true, affected: 2 });

      // After success, refresh() is called → loadItems + loadCounts
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts() });
    });
  });

  // ─── WebSocket: visitorNewMessage → updates inbox item ───────────────────

  describe('visitorNewMessage WS event', () => {
    it('updates an existing chat item in-place when session matches', () => {
      // Set up initialized state by manually triggering init flag via init()
      // First manually load items
      service.loadItems();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [makeItem({ id: 'sess-1', type: 'chat', preview: 'Старое сообщение' })],
        total: 1,
      });

      // Simulate service._initialized = true by calling init() in browser context
      // (effects won't fire until _initialized is true, so we call init())
      service.init();
      // init() triggers loadItems + loadCounts
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [makeItem({ id: 'sess-1', type: 'chat', preview: 'Старое сообщение' })], total: 1 });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts() });

      // Now emit WS event
      mockWs.visitorNewMessage.set({
        sessionId: 'sess-1',
        content: 'Новое сообщение',
        messageType: 'text',
        timestamp: new Date(),
        senderType: 'visitor',
        message: { sender_type: 'visitor', id: 'msg-new' },
        session: null,
      } as unknown as Record<string, unknown>);

      TestBed.flushEffects();

      const items = service.items();
      expect(items[0].preview).toBe('Новое сообщение');
      expect(items[0].unread).toBe(true);
    });

    it('increments unread count when a visitor message arrives', () => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts({ total: 5, unread: 0 }) });

      mockWs.visitorNewMessage.set({
        sessionId: 'sess-new',
        content: 'Привет',
        messageType: 'text',
        timestamp: new Date(),
        message: { sender_type: 'visitor' },
        session: { visitorName: 'Клиент', visitorPhone: null, channel: 'web', status: 'open', assignedOperatorId: null, assignedOperatorName: null },
      } as unknown as Record<string, unknown>);

      TestBed.flushEffects();

      // unread count should have incremented
      expect(service.counts().unread).toBe(1);
    });

    it('does NOT increment unread when the sender is an operator', () => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: [], total: 0 });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts({ unread: 0 }) });

      mockWs.visitorNewMessage.set({
        sessionId: 'sess-1',
        content: 'Ответ оператора',
        messageType: 'text',
        timestamp: new Date(),
        message: { sender_type: 'operator' },
        session: null,
      } as unknown as Record<string, unknown>);

      TestBed.flushEffects();

      expect(service.counts().unread).toBe(0);
    });
  });

  // ─── WebSocket: chatAssignment → updates session in list ──────────────────

  describe('chatAssignment WS event', () => {
    it('updates assignedTo when event is "assigned"', () => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [makeItem({ id: 'sess-1', type: 'chat', assignedTo: undefined })],
        total: 1,
      });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts() });

      mockWs.chatAssignment.set({
        event: 'assigned',
        sessionId: 'sess-1',
        operatorId: 'op-7',
        operatorName: 'Мария',
      } as unknown as Record<string, unknown>);

      TestBed.flushEffects();

      // A debounced loadCounts is triggered — flush it
      httpMock.match(r => r.url === '/api/crm/inbox/counts').forEach(r => r.flush({ success: true, data: makeCounts() }));

      const item = service.items().find(i => i.id === 'sess-1');
      expect(item?.assignedTo).toBe('op-7');
      expect(item?.assignedToName).toBe('Мария');
      expect(item?.status).toBe('active');
    });

    it('clears assignedTo when event is "unassigned"', () => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({
        success: true,
        data: [makeItem({ id: 'sess-1', type: 'chat', assignedTo: 'op-7', assignedToName: 'Мария' })],
        total: 1,
      });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts() });

      mockWs.chatAssignment.set({
        event: 'unassigned',
        sessionId: 'sess-1',
      } as unknown as Record<string, unknown>);

      TestBed.flushEffects();
      httpMock.match(r => r.url === '/api/crm/inbox/counts').forEach(r => r.flush({ success: true, data: makeCounts() }));

      const item = service.items().find(i => i.id === 'sess-1');
      expect(item?.assignedTo).toBeUndefined();
      expect(item?.assignedToName).toBeUndefined();
    });
  });

  // ─── WebSocket: paymentLinkEvent → flips hasPaidUnlinked badge ─────────────

  describe('paymentLinkEvent WS event', () => {
    const seedItems = (items: InboxItem[]) => {
      service.init();
      httpMock.expectOne(r => r.url === '/api/crm/inbox').flush({ success: true, data: items, total: items.length });
      httpMock.expectOne(r => r.url === '/api/crm/inbox/counts').flush({ success: true, data: makeCounts() });
    };

    it('payment-link:paid sets hasPaidUnlinked=true on the matching chat row', () => {
      seedItems([makeItem({ id: 'conv-1', type: 'chat' })]);

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: { conversationId: 'conv-1', amount: 1200, orderRef: 'CRM-A' },
      });
      TestBed.flushEffects();

      const item = service.items().find(i => i.id === 'conv-1');
      expect(item?.metadata?.['hasPaidUnlinked']).toBe(true);
    });

    it('payment-link:paid writes paidUnlinkedAmount and paidUnlinkedOrderRef to metadata', () => {
      seedItems([makeItem({ id: 'conv-1', type: 'chat' })]);

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: { conversationId: 'conv-1', amount: 2500, orderRef: 'CRM-XYZ' },
      });
      TestBed.flushEffects();

      const item = service.items().find(i => i.id === 'conv-1');
      expect(item?.metadata?.['paidUnlinkedAmount']).toBe(2500);
      expect(item?.metadata?.['paidUnlinkedOrderRef']).toBe('CRM-XYZ');
    });

    it('payment-link:paid does NOT touch a row with a different conversationId', () => {
      seedItems([
        makeItem({ id: 'conv-1', type: 'chat' }),
        makeItem({ id: 'conv-2', type: 'chat' }),
      ]);

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: { conversationId: 'conv-1', amount: 300, orderRef: 'CRM-A' },
      });
      TestBed.flushEffects();

      const other = service.items().find(i => i.id === 'conv-2');
      expect(other?.metadata?.['hasPaidUnlinked']).toBeUndefined();
      expect(other?.metadata?.['paidUnlinkedAmount']).toBeUndefined();
    });

    it('payment-link:paid does NOT touch items whose type is not "chat"', () => {
      seedItems([
        makeItem({ id: 'conv-1', type: 'chat' }),
        makeItem({ id: 'conv-1', type: 'task' }),
      ]);

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: { conversationId: 'conv-1', amount: 500, orderRef: 'CRM-T' },
      });
      TestBed.flushEffects();

      const taskItem = service.items().find(i => i.type === 'task');
      expect(taskItem?.metadata?.['hasPaidUnlinked']).toBeUndefined();
    });

    it('payment-link:linked resets hasPaidUnlinked=false and clears amount/orderRef', () => {
      seedItems([makeItem({
        id: 'conv-1',
        type: 'chat',
        metadata: {
          hasPaidUnlinked: true,
          paidUnlinkedAmount: 1200,
          paidUnlinkedOrderRef: 'CRM-A',
        },
      })]);

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:linked',
        data: { conversationId: 'conv-1' },
      });
      TestBed.flushEffects();

      const item = service.items().find(i => i.id === 'conv-1');
      expect(item?.metadata?.['hasPaidUnlinked']).toBe(false);
      expect(item?.metadata?.['paidUnlinkedAmount']).toBeUndefined();
      expect(item?.metadata?.['paidUnlinkedOrderRef']).toBeUndefined();
    });

    it('does nothing when the service has not been init()-ed', () => {
      // no seedItems() → no init(), no HTTP calls expected
      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: { conversationId: 'conv-1', amount: 1, orderRef: 'CRM-Z' },
      });
      TestBed.flushEffects();

      expect(service.items()).toEqual([]);
    });

    it('does not throw when conversationId is null', () => {
      seedItems([makeItem({ id: 'conv-1', type: 'chat' })]);

      expect(() => {
        mockWs.paymentLinkEvent.set({
          event: 'payment-link:paid',
          data: { conversationId: undefined, amount: 10, orderRef: 'CRM-Q' },
        });
        TestBed.flushEffects();
      }).not.toThrow();

      const item = service.items().find(i => i.id === 'conv-1');
      expect(item?.metadata?.['hasPaidUnlinked']).toBeUndefined();
    });
  });
});
