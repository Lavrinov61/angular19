import { TestBed } from '@angular/core/testing';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { vi } from 'vitest';
import { OperatorChatService, OperatorChatSession, OperatorChatMessage } from './operator-chat.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import { InboxService } from './inbox.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeSession = (overrides: Partial<OperatorChatSession> = {}): OperatorChatSession => ({
  id: 'sess-1',
  visitor_id: 'v1',
  visitor_name: 'Клиент',
  visitor_phone: null,
  selected_service: null,
  page_url: null,
  channel: 'web',
  status: 'open',
  assigned_operator_id: null,
  assigned_operator_name: null,
  last_message_at: null,
  created_at: new Date().toISOString(),
  first_response_at: null,
  resolved_at: null,
  message_count: 0,
  last_message: null,
  csat_score: null,
  csat_comment: null,
  contact_id: null,
  user_id: null,
  booking_id: null,
  client_name: null,
  client_phone: null,
  client_last_seen_at: null,
  client_purchases_count: 0,
  booking_service: null,
  booking_date: null,
  booking_status: null,
  is_private: false,
  ...overrides,
});

const makeMsg = (overrides: Partial<OperatorChatMessage> = {}): OperatorChatMessage => ({
  id: 'msg-1',
  session_id: 'sess-1',
  sender_type: 'visitor',
  sender_name: 'Клиент',
  message_type: 'text',
  content: 'Привет',
  attachment_url: null,
  created_at: new Date().toISOString(),
  is_read: false,
  ...overrides,
});

interface MockSocketPayload {
  readonly [key: string]: unknown;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockWs() {
  return {
    visitorNewMessage: signal<null | MockSocketPayload>(null),
    paymentLinkEvent: signal<null | { event: string; data: MockSocketPayload }>(null),
    chatAssignment: signal<null | MockSocketPayload>(null),
    internalNoteEvent: signal<null | MockSocketPayload>(null),
    mediaReadyEvent: signal<null | MockSocketPayload>(null),
    visitorTyping: signal<null | { sessionId: string; visitorId: string; isTyping: boolean }>(null),
    operatorTyping: signal<null | MockSocketPayload>(null),
    messageStatusUpdate: signal<null | MockSocketPayload>(null),
    chatClientLinked: signal<null | MockSocketPayload>(null),
    chatPrivacyChanged: signal<null | MockSocketPayload>(null),
    chatRemovedFromInbox: signal<null | MockSocketPayload>(null),
    chatAssignedToYou: signal<null | MockSocketPayload>(null),
    chatStatusChanged: signal<null | MockSocketPayload>(null),
    chatPhoneUpdated: signal<null | MockSocketPayload>(null),
    chatViewing: signal<null | MockSocketPayload>(null),
    chatLeft: signal<null | MockSocketPayload>(null),
    reconnected: signal<null | number>(null),
    messageDeleted: signal<null | MockSocketPayload>(null),
    messageEdited: signal<null | MockSocketPayload>(null),
    messageReactionUpdated: signal<null | MockSocketPayload>(null),
    messagePinToggled: signal<null | MockSocketPayload>(null),
    joinVisitorChats: vi.fn(),
    leaveVisitorChats: vi.fn(),
    emitLeftChat: vi.fn(),
    emitViewingChat: vi.fn(),
    replyToVisitor: vi.fn(),
  };
}

function createMockAuth(userId = 'operator-1') {
  return {
    currentUser: signal({ id: userId, display_name: 'Operator', email: 'op@test.com', role: 'employee' }),
    isAuthenticated: signal(true),
  };
}

const mockInbox = { refresh: vi.fn(), markItemRead: vi.fn() };

const mockLogger = {
  createChild: vi.fn().mockReturnValue({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
};

const adminSessionsUrl = '/api/visitor-chat/admin/sessions';
const isAdminSessionsRequest = (request: HttpRequest<unknown>): boolean => (
  request.url === adminSessionsUrl
  || request.urlWithParams === adminSessionsUrl
  || request.urlWithParams.startsWith(`${adminSessionsUrl}?`)
);
const queryParam = (request: HttpRequest<unknown>, name: string): string | null => (
  request.params.get(name) ?? new URLSearchParams(request.urlWithParams.split('?')[1] ?? '').get(name)
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OperatorChatService', () => {
  let service: OperatorChatService;
  let httpMock: HttpTestingController;
  let mockWs: ReturnType<typeof createMockWs>;
  let mockAuth: ReturnType<typeof createMockAuth>;

  beforeEach(() => {
    mockWs = createMockWs();
    mockAuth = createMockAuth();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: WebSocketService, useValue: mockWs },
        { provide: AuthService, useValue: mockAuth },
        { provide: InboxService, useValue: mockInbox },
        { provide: LoggerService, useValue: mockLogger },
      ],
    });

    service = TestBed.inject(OperatorChatService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('sessions is empty', () => expect(service.sessions()).toEqual([]));
    it('messages is empty', () => expect(service.messages()).toEqual([]));
    it('activeSessionId is null', () => expect(service.activeSessionId()).toBeNull());
    it('activeSession is null', () => expect(service.activeSession()).toBeNull());
    it('visitorIsTyping is false', () => expect(service.visitorIsTyping()).toBe(false));
    it('sessionCount is 0', () => expect(service.sessionCount()).toBe(0));
  });

  // ─── loadSessions ──────────────────────────────────────────────────────────

  describe('loadSessions()', () => {
    it('GETs sessions with default status filter', () => {
      service.loadSessions();
      const req = httpMock.expectOne(isAdminSessionsRequest);
      expect(queryParam(req.request, 'status')).toBe('open');
      expect(queryParam(req.request, 'channel')).toBe('all');
      req.flush({ success: true, data: [] });
    });

    it('updates sessions signal on success', () => {
      service.loadSessions();
      httpMock.expectOne(isAdminSessionsRequest).flush({
        success: true,
        data: [makeSession(), makeSession({ id: 'sess-2' })],
      });
      expect(service.sessions()).toHaveLength(2);
    });

    it('resets loading to false after HTTP error', () => {
      service.loadSessions();
      httpMock.expectOne(isAdminSessionsRequest).flush(
        'Error', { status: 500, statusText: 'Server Error' }
      );
      expect(service.loading()).toBe(false);
    });

    it('preserves active session in list even when it is not in the response', () => {
      // Set up: load sessions and select one
      service.loadSessions();
      httpMock.expectOne(isAdminSessionsRequest).flush({
        success: true,
        data: [makeSession({ id: 'active-sess' })],
      });
      service.selectSession('active-sess');
      // selectSession triggers mark-read and initial messages load
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      // Now reload sessions with a result that does NOT include the active session
      service.loadSessions();
      httpMock.expectOne(isAdminSessionsRequest).flush({
        success: true,
        data: [makeSession({ id: 'other-sess' })],
      });

      // Active session should still be in the list
      expect(service.sessions().some(s => s.id === 'active-sess')).toBe(true);
    });
  });

  // ─── setStatusFilter ──────────────────────────────────────────────────────

  describe('setStatusFilter()', () => {
    it('updates statusFilter and reloads sessions', () => {
      service.setStatusFilter('resolved');
      const req = httpMock.expectOne(isAdminSessionsRequest);
      expect(queryParam(req.request, 'status')).toBe('resolved');
      req.flush({ success: true, data: [] });
      expect(service.statusFilter()).toBe('resolved');
    });
  });

  // ─── selectSession / deselectSession ──────────────────────────────────────

  describe('selectSession()', () => {
    it('sets activeSessionId', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });

      service.selectSession('sess-1');
      expect(service.activeSessionId()).toBe('sess-1');

      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });
    });

    it('loads initial messages from HTTP when no cache entry exists', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });

      service.selectSession('sess-1');

      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      const msgsReq = httpMock.expectOne(r => r.url.includes('/messages'));
      expect(msgsReq.request.url).toContain('/sess-1/messages');
      msgsReq.flush({ success: true, data: [makeMsg()], hasOlder: false, hasNewer: false, totalCount: 1 });

      expect(service.messages()).toHaveLength(1);
    });

    it('groups web photo upload sequence captions into one media group', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });

      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });

      const baseTime = Date.parse('2026-01-01T09:00:00.000Z');
      const photos = [1, 2, 3].map(i => makeMsg({
        id: `photo-${i}`,
        message_type: 'image',
        content: `📷 Фото ${i}/3`,
        attachment_url: `/uploads/photo-${i}.jpg`,
        original_mime_type: 'image/jpeg',
        created_at: new Date(baseTime + i * 1000).toISOString(),
      }));
      httpMock.expectOne(r => r.url.includes('/messages')).flush({
        success: true,
        data: photos,
        hasOlder: false,
        hasNewer: false,
        totalCount: photos.length,
      });

      const meta = service.messagesMeta();
      expect(meta[0].mediaGroupStart).toBe(true);
      expect(meta[0].mediaGroupItems?.map(m => m.id)).toEqual(['photo-1', 'photo-2', 'photo-3']);
      expect(meta[1].skipRender).toBe(true);
      expect(meta[2].skipRender).toBe(true);
    });

    it('does not group generated photo labels with user captions', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });

      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });

      const baseTime = Date.parse('2026-01-01T09:00:00.000Z');
      const photos = [1, 2].map(i => makeMsg({
        id: `captioned-photo-${i}`,
        message_type: 'image',
        content: `📷 Фото ${i}/2 — срочно напечатать`,
        attachment_url: `/uploads/captioned-photo-${i}.jpg`,
        original_mime_type: 'image/jpeg',
        created_at: new Date(baseTime + i * 1000).toISOString(),
      }));
      httpMock.expectOne(r => r.url.includes('/messages')).flush({
        success: true,
        data: photos,
        hasOlder: false,
        hasNewer: false,
        totalCount: photos.length,
      });

      expect(service.messagesMeta().some(meta => meta.mediaGroupStart)).toBe(false);
    });

    it('ignores stale messages response after switching sessions', () => {
      service.loadSessions();
      httpMock.expectOne(isAdminSessionsRequest).flush({
        success: true,
        data: [makeSession({ id: 'sess-1' }), makeSession({ id: 'sess-2' })],
      });

      service.selectSession('sess-1');
      const firstMessagesReq = httpMock.expectOne(r => r.urlWithParams.includes('/sess-1/messages'));
      httpMock.expectOne(r => r.urlWithParams.includes('/sess-1/mark-read')).flush({ success: true, data: { markedCount: 0 } });

      service.selectSession('sess-2');
      const secondMessagesReq = httpMock.expectOne(r => r.urlWithParams.includes('/sess-2/messages'));
      httpMock.expectOne(r => r.urlWithParams.includes('/sess-2/mark-read')).flush({ success: true, data: { markedCount: 0 } });

      secondMessagesReq.flush({
        success: true,
        data: [makeMsg({ id: 'msg-2', session_id: 'sess-2', content: 'Вторая сессия' })],
        hasOlder: false,
        hasNewer: false,
        totalCount: 1,
      });
      firstMessagesReq.flush({
        success: true,
        data: [makeMsg({ id: 'msg-1', session_id: 'sess-1', content: 'Первая сессия' })],
        hasOlder: false,
        hasNewer: false,
        totalCount: 1,
      });

      expect(service.activeSessionId()).toBe('sess-2');
      expect(service.messages()).toEqual([
        expect.objectContaining({ id: 'msg-2', session_id: 'sess-2' }),
      ]);
    });
  });

  describe('deselectSession()', () => {
    it('clears activeSessionId and messages', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [makeMsg()], hasOlder: false, hasNewer: false, totalCount: 1 });

      service.deselectSession();
      expect(service.activeSessionId()).toBeNull();
      expect(service.messages()).toEqual([]);
    });
  });

  // ─── sendReply — optimistic behaviour ─────────────────────────────────────

  describe('sendReply()', () => {
    beforeEach(() => {
      // Set up an active session with messages
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });
    });

    it('immediately adds a temp message before HTTP response', () => {
      service.sendReply('Привет!');
      // Temp message should be in list before HTTP response
      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].id).toMatch(/^temp-/);
      expect(service.messages()[0].content).toBe('Привет!');
      expect(service.messages()[0].sender_type).toBe('operator');

      // Cleanup
      const replyReq = httpMock.expectOne(r => r.url.includes('/reply'));
      const serverMsg = makeMsg({ id: 'server-msg-1', sender_type: 'operator', content: 'Привет!' });
      replyReq.flush({ success: true, data: serverMsg });
    });

    it('replaces temp message with server response on success', () => {
      service.sendReply('Тест');
      const tempId = service.messages()[0].id;

      const serverMsg = makeMsg({ id: 'real-id-99', sender_type: 'operator', content: 'Тест' });
      httpMock.expectOne(r => r.url.includes('/reply')).flush({ success: true, data: serverMsg });

      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].id).toBe('real-id-99');
      expect(service.messages()[0].id).not.toBe(tempId);
    });

    it('removes temp message on HTTP error (rollback)', () => {
      service.sendReply('Ошибочное сообщение');
      expect(service.messages()).toHaveLength(1);

      httpMock.expectOne(r => r.url.includes('/reply')).flush(
        'Error', { status: 500, statusText: 'Server Error' }
      );

      // Temp message should be removed
      expect(service.messages()).toHaveLength(0);
    });

    it('does nothing when content is empty or whitespace', () => {
      service.sendReply('   ');
      httpMock.expectNone(r => r.url.includes('/reply'));
      expect(service.messages()).toHaveLength(0);
    });

    it('does nothing when no session is active', () => {
      service.deselectSession();
      service.sendReply('Привет');
      httpMock.expectNone(r => r.url.includes('/reply'));
    });
  });

  // ─── sendNote — optimistic behaviour ─────────────────────────────────────

  describe('sendNote()', () => {
    beforeEach(() => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });
    });

    it('immediately adds temp internal_note message', () => {
      service.sendNote('Внутренняя заметка');
      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].sender_type).toBe('internal_note');
      expect(service.messages()[0].id).toMatch(/^temp-note-/);

      httpMock.expectOne(r => r.url.includes('/note')).flush({
        success: true,
        data: makeMsg({ id: 'note-1', sender_type: 'internal_note', content: 'Внутренняя заметка' }),
      });
    });

    it('rolls back temp note message on HTTP error', () => {
      service.sendNote('Заметка с ошибкой');
      expect(service.messages()).toHaveLength(1);

      httpMock.expectOne(r => r.url.includes('/note')).flush(
        'Error', { status: 500, statusText: 'Server Error' }
      );

      expect(service.messages()).toHaveLength(0);
    });
  });

  // ─── assignToMe ──────────────────────────────────────────────────────────

  describe('assignToMe()', () => {
    it('POSTs to /assign and updates session assigned_operator_id on success', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession({ id: 'sess-5' })] });

      service.assignToMe('sess-5');
      const req = httpMock.expectOne(r => r.url.includes('/sess-5/assign'));
      expect(req.request.method).toBe('POST');
      req.flush({ success: true, data: makeSession({ id: 'sess-5', assigned_operator_id: 'operator-1' }) });

      const updated = service.sessions().find(s => s.id === 'sess-5');
      expect(updated?.assigned_operator_id).toBe('operator-1');
      expect(updated?.status).toBe('active');
    });
  });

  // ─── transfer ─────────────────────────────────────────────────────────────

  describe('transfer()', () => {
    it('POSTs to /transfer with to_operator_id and note', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession({ id: 'sess-6' })] });

      service.transfer('sess-6', 'op-99', 'Передаю коллеге').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/sess-6/transfer'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ to_operator_id: 'op-99', note: 'Передаю коллеге' });
      req.flush({ success: true, data: makeSession({ id: 'sess-6', assigned_operator_id: 'op-99' }) });

      const updated = service.sessions().find(s => s.id === 'sess-6');
      expect(updated?.assigned_operator_id).toBe('op-99');
    });
  });

  // ─── Typing indicator via WebSocket ──────────────────────────────────────

  describe('visitorIsTyping computed', () => {
    it('returns true for the active session when typing event arrives', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      mockWs.visitorTyping.set({ sessionId: 'sess-1', visitorId: 'v1', isTyping: true });
      TestBed.flushEffects();

      expect(service.visitorIsTyping()).toBe(true);
    });

    it('returns false for a different session than the active one', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      // Typing event for a DIFFERENT session
      mockWs.visitorTyping.set({ sessionId: 'sess-OTHER', visitorId: 'v2', isTyping: true });
      TestBed.flushEffects();

      expect(service.visitorIsTyping()).toBe(false);
    });
  });

  // ─── Echo filter — own operator messages via WS ───────────────────────────

  describe('WS visitorNewMessage echo filter', () => {
    it('replaces temp-id with DB id when own message comes back via WS', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      // Send a reply (creates temp-* message)
      service.sendReply('Echo test');
      const _tempId = service.messages()[0].id;

      // Simulate WS echo for the same operator message with a DB id
      mockWs.visitorNewMessage.set({
        sessionId: 'sess-1',
        content: 'Echo test',
        messageType: 'text',
        timestamp: new Date(),
        senderId: 'operator-1',   // same as currentUser.id
        message: { id: 'db-msg-55', sender_type: 'operator', sender_id: 'operator-1' },
        session: null,
      } satisfies MockSocketPayload);

      TestBed.flushEffects();

      // The temp message must be replaced with the DB id, no duplicate
      const msgs = service.messages();
      expect(msgs.some(m => m.id.startsWith('temp-'))).toBe(false);
      expect(msgs.some(m => m.id === 'db-msg-55')).toBe(true);
      expect(msgs).toHaveLength(1);

      // Cleanup HTTP for the reply endpoint
      httpMock.match(r => r.url.includes('/reply')).forEach(r =>
        r.flush({ success: true, data: makeMsg({ id: 'db-msg-55', sender_type: 'operator', content: 'Echo test' }) })
      );
    });

    it('preserves bot sender type from live payment messages', async () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      mockWs.visitorNewMessage.set({
        sessionId: 'sess-1',
        content: '💳 К оплате: 156₽',
        messageType: 'interactive',
        timestamp: new Date('2026-05-12T10:24:00.000Z'),
        message: {
          id: 'db-payment-1',
          senderType: 'bot',
          senderName: 'Своё Фото',
          messageType: 'interactive',
          metadata: { interactive: { type: 'buttons' } },
        },
        session: null,
      } satisfies MockSocketPayload);

      TestBed.flushEffects();
      await Promise.resolve();
      httpMock.match(r => r.url.includes('/mark-read')).forEach(r =>
        r.flush({ success: true, data: { markedCount: 0 } })
      );

      expect(service.messages()[0]).toMatchObject({
        id: 'db-payment-1',
        sender_type: 'bot',
        sender_name: 'Своё Фото',
        message_type: 'interactive',
      });
    });

    it('adds a paid payment-link card from payment-link:paid when the chat message event is missed', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: {
          paymentLinkId: 'pl-1',
          conversationId: 'sess-1',
          amount: 200,
          orderRef: 'SF-1',
        },
      });

      TestBed.flushEffects();

      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0]).toMatchObject({
        sender_type: 'system',
        message_type: 'interactive',
        metadata: {
          interactive: { step: 'payment_link_paid' },
          payment: {
            source: 'payment_link',
            status: 'paid',
            amount: 200,
            paymentLinkId: 'pl-1',
            orderRef: 'SF-1',
          },
        },
      });
    });

    it('keeps CloudPayments card details from payment-link:paid as online payment, not terminal card', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: {
          paymentLinkId: 'pl-1',
          conversationId: 'sess-1',
          amount: 200,
          orderRef: 'SF-1',
          method: 'card',
        },
      });

      TestBed.flushEffects();

      expect(service.messages()[0].metadata?.payment?.method).toBe('online');
    });

    it('replaces the synthetic paid payment-link card when the DB chat message arrives', async () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: {
          paymentLinkId: 'pl-1',
          conversationId: 'sess-1',
          amount: 200,
          orderRef: 'SF-1',
        },
      });
      TestBed.flushEffects();
      expect(service.messages()[0].id).toMatch(/^payment-link-paid-/);

      mockWs.visitorNewMessage.set({
        sessionId: 'sess-1',
        content: 'Клиент оплатил 200₽ по ссылке SF-1. Создайте заказ.',
        messageType: 'interactive',
        timestamp: new Date('2026-05-12T10:25:00.000Z'),
        message: {
          id: 'db-payment-paid-1',
          sender_type: 'system',
          sender_name: 'Система',
          message_type: 'interactive',
          metadata: {
            interactive: { type: 'buttons', step: 'payment_link_paid' },
            payment: {
              source: 'payment_link',
              status: 'paid',
              amount: 200,
              paymentLinkId: 'pl-1',
              orderRef: 'SF-1',
            },
          },
        },
        session: null,
      } satisfies MockSocketPayload);

      TestBed.flushEffects();
      await Promise.resolve();
      httpMock.match(r => r.url.includes('/mark-read')).forEach(r =>
        r.flush({ success: true, data: { markedCount: 0 } })
      );

      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].id).toBe('db-payment-paid-1');
    });

    it('marks an existing payment-link request as paid without appending a duplicate operator card', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({
        success: true,
        data: [
          makeMsg({
            id: 'payment-request-1',
            sender_type: 'bot',
            sender_name: 'Своё Фото',
            message_type: 'interactive',
            content: '💳 К оплате: 180₽\n• В стиле Полароид: 5 × 36₽ — 180₽',
            metadata: {
              interactive: {
                type: 'buttons',
                step: 'operator_payment',
                buttons: [
                  {
                    id: 'pay',
                    data: {
                      orderId: 'SF-1',
                      amount: 180,
                    },
                  },
                ],
              },
            },
          }),
        ],
        hasOlder: false,
        hasNewer: false,
        totalCount: 1,
      });

      mockWs.paymentLinkEvent.set({
        event: 'payment-link:paid',
        data: {
          paymentLinkId: 'pl-1',
          conversationId: 'sess-1',
          amount: 180,
          orderRef: 'SF-1',
          method: 'card',
        },
      });
      TestBed.flushEffects();

      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0]).toMatchObject({
        id: 'payment-request-1',
        metadata: {
          payment: {
            source: 'payment_link',
            status: 'paid',
            amount: 180,
            paymentLinkId: 'pl-1',
            orderRef: 'SF-1',
            method: 'online',
          },
        },
      });
    });

    it('merges paid payment-link notifications into the original request after HTTP reload', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({
        success: true,
        data: [
          makeMsg({
            id: 'payment-request-1',
            sender_type: 'bot',
            sender_name: 'Своё Фото',
            message_type: 'interactive',
            content: '💳 К оплате: 180₽\n• В стиле Полароид: 5 × 36₽ — 180₽',
            metadata: {
              interactive: {
                type: 'buttons',
                step: 'operator_payment',
                buttons: [
                  {
                    id: 'pay',
                    data: {
                      orderId: 'SF-1',
                      amount: 180,
                    },
                  },
                ],
              },
            },
          }),
          makeMsg({
            id: 'customer-confirmation-1',
            sender_type: 'bot',
            sender_name: 'Своё Фото',
            message_type: 'text',
            content: '✅ Оплата 180₽ получена. Спасибо!',
            metadata: {
              kind: 'payment_link_paid_customer_confirmation',
              paymentLinkId: 'pl-1',
              orderRef: 'SF-1',
              payment: {
                source: 'payment_link',
                status: 'paid',
                method: 'online',
                amount: 180,
                paymentLinkId: 'pl-1',
                orderRef: 'SF-1',
                items: [{ name: 'В стиле Полароид', price: 180 }],
              },
            },
          }),
          makeMsg({
            id: 'operator-paid-1',
            sender_type: 'system',
            sender_name: 'Система',
            message_type: 'interactive',
            content: '✅ Клиент оплатил 180₽ по ссылке SF-1. Создайте заказ.',
            metadata: {
              interactive: { type: 'buttons', step: 'payment_link_paid' },
              payment: {
                source: 'payment_link',
                status: 'paid',
                method: 'online',
                amount: 180,
                paymentLinkId: 'pl-1',
                orderRef: 'SF-1',
              },
            },
          }),
        ],
        hasOlder: false,
        hasNewer: false,
        totalCount: 3,
      });

      const meta = service.messagesMeta();
      expect(meta[0].msg).toMatchObject({
        id: 'payment-request-1',
        metadata: {
          payment: {
            source: 'payment_link',
            status: 'paid',
            amount: 180,
            paymentLinkId: 'pl-1',
            orderRef: 'SF-1',
            items: [{ name: 'В стиле Полароид', price: 180 }],
          },
        },
      });
      expect(meta[1].skipRender).toBe(true);
      expect(meta[2].skipRender).toBe(true);
    });

    it('applies media-ready events that arrive before the matching chat messages', async () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      const baseTime = Date.parse('2026-07-02T06:35:00.000Z');
      for (const index of [1, 2]) {
        mockWs.mediaReadyEvent.set({
          conversationId: 'sess-1',
          messageId: `photo-${index}`,
          attachmentUrl: `/media/chat/photo-${index}.jpg`,
          mediaType: 'image',
          fileName: `photo-${index}.jpg`,
          mimeType: 'image/jpeg',
          status: 'uploaded',
        } satisfies MockSocketPayload);
        TestBed.flushEffects();
      }

      for (const index of [1, 2]) {
        mockWs.visitorNewMessage.set({
          sessionId: 'sess-1',
          content: `Фото ${index}/2`,
          messageType: 'image',
          timestamp: new Date(baseTime + index * 1000),
          message: {
            id: `photo-${index}`,
            sender_type: 'visitor',
            sender_name: 'Клиент',
            message_type: 'image',
            content: `Фото ${index}/2`,
            created_at: new Date(baseTime + index * 1000).toISOString(),
          },
          session: null,
        } satisfies MockSocketPayload);
        TestBed.flushEffects();
      }
      await Promise.resolve();
      httpMock.match(r => r.url.includes('/mark-read')).forEach(r =>
        r.flush({ success: true, data: { markedCount: 0 } })
      );

      expect(service.messages().map(message => message.attachment_url)).toEqual([
        '/media/chat/photo-1.jpg',
        '/media/chat/photo-2.jpg',
      ]);
      expect(service.messages().map(message => message.original_mime_type)).toEqual([
        'image/jpeg',
        'image/jpeg',
      ]);
      expect(service.messagesMeta()[0].mediaGroupStart).toBe(true);
      expect(service.messagesMeta()[0].mediaGroupItems?.map(message => message.id)).toEqual(['photo-1', 'photo-2']);
      expect(service.messagesMeta()[1].skipRender).toBe(true);
    });
  });

  // ─── LRU cache ────────────────────────────────────────────────────────────

  describe('LRU message cache', () => {
    it('restores messages from cache on re-select without HTTP request', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({ success: true, data: [makeSession()] });

      // First select — loads from HTTP, populates cache
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages?')).flush({
        success: true, data: [makeMsg({ id: 'cached-1' })], hasOlder: false, hasNewer: false, totalCount: 1,
      });

      // Deselect
      service.deselectSession();

      // Re-select — should restore from cache (no new messages HTTP request)
      service.selectSession('sess-1');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });

      // A sync request may be made for newer messages — flush it
      const syncReqs = httpMock.match(r => r.url.includes('/messages'));
      syncReqs.forEach(r => r.flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 1 }));

      // Messages should be restored immediately from cache
      expect(service.messages().some(m => m.id === 'cached-1')).toBe(true);
    });
  });

  // ─── activeSession computed ───────────────────────────────────────────────

  describe('activeSession computed', () => {
    it('returns the session object when activeSessionId is set', () => {
      service.loadSessions();
      httpMock.expectOne(r => r.url.includes('/sessions')).flush({
        success: true, data: [makeSession({ id: 'sess-X', visitor_name: 'Тест' })],
      });

      service.selectSession('sess-X');
      httpMock.expectOne(r => r.url.includes('/mark-read')).flush({ success: true, data: { markedCount: 0 } });
      httpMock.expectOne(r => r.url.includes('/messages')).flush({ success: true, data: [], hasOlder: false, hasNewer: false, totalCount: 0 });

      expect(service.activeSession()?.id).toBe('sess-X');
      expect(service.activeSession()?.visitor_name).toBe('Тест');
    });

    it('returns null when no session is selected', () => {
      expect(service.activeSession()).toBeNull();
    });
  });
});
