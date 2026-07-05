import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { vi } from 'vitest';
import { StaffChatService } from './staff-chat.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { StaffConversation, StaffMessage } from '../models/staff-chat.model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeConversation = (overrides: Partial<StaffConversation> = {}): StaffConversation => ({
  id: 'conv-1',
  title: 'Общий чат',
  type: 'group',
  created_by: 'user-1',
  last_message_at: new Date().toISOString(),
  last_message_preview: '',
  created_at: new Date().toISOString(),
  unread_count: 0,
  participants: [],
  ...overrides,
});

const makeMsg = (overrides: Partial<StaffMessage> = {}): StaffMessage => ({
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'user-2',
  sender_name: 'Коллега',
  content: 'Привет!',
  message_type: 'text',
  attachment_url: null,
  original_filename: null,
  reply_to_message_id: null,
  reply_to_content: null,
  reply_to_sender_name: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockWs() {
  return {
    staffChatMessage: signal<null | { conversationId: string; message: unknown }>(null),
    staffChatMessageEdited: signal<null | { conversationId: string; messageId: string; content: string; editedAt: string }>(null),
    staffChatMessageDeleted: signal<null | { conversationId: string; messageId: string }>(null),
    staffChatTyping: signal<null | { conversationId: string; userId: string; isTyping: boolean }>(null),
    staffChatUserLeft: signal<null | { conversationId: string; userId: string }>(null),
    staffChatUserJoined: signal<null | { conversationId: string; userId: string }>(null),
    staffChatConversationUpdated: signal<null | { conversationId: string; title: string }>(null),
    staffChatReactionAdded: signal<null | { conversationId: string; messageId: string; emoji: string; userId: string }>(null),
    staffChatReactionRemoved: signal<null | { conversationId: string; messageId: string; emoji: string; userId: string }>(null),
    staffChatMessagePinned: signal<null | { conversationId: string; messageId: string }>(null),
    staffChatMessageUnpinned: signal<null | { conversationId: string; messageId: string }>(null),
    joinStaffChat: vi.fn(),
    leaveStaffChat: vi.fn(),
    sendStaffTyping: vi.fn(),
  };
}

function createMockAuth(userId = 'user-1') {
  return {
    currentUser: signal({ id: userId, display_name: 'Я', email: 'me@test.com', role: 'employee' }),
    isAuthenticated: signal(true),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StaffChatService', () => {
  let service: StaffChatService;
  let httpMock: HttpTestingController;
  let mockWs: ReturnType<typeof createMockWs>;
  let mockAuth: ReturnType<typeof createMockAuth>;

  beforeEach(() => {
    mockWs = createMockWs();
    mockAuth = createMockAuth('user-1');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: WebSocketService, useValue: mockWs },
        { provide: AuthService, useValue: mockAuth },
      ],
    });

    service = TestBed.inject(StaffChatService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('conversations is empty', () => expect(service.conversations()).toEqual([]));
    it('messages is empty', () => expect(service.messages()).toEqual([]));
    it('activeConversationId is null', () => expect(service.activeConversationId()).toBeNull());
    it('activeConversation is null', () => expect(service.activeConversation()).toBeNull());
    it('totalUnread is 0', () => expect(service.totalUnread()).toBe(0));
    it('lastError is null', () => expect(service.lastError()).toBeNull());
  });

  // ─── loadConversations ────────────────────────────────────────────────────

  describe('loadConversations()', () => {
    it('GETs /api/staff-chat/conversations', () => {
      service.loadConversations();
      const req = httpMock.expectOne('/api/staff-chat/conversations');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('sets conversations and joins each via WS on success', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({
        success: true,
        data: [makeConversation({ id: 'conv-A' }), makeConversation({ id: 'conv-B' })],
      });

      expect(service.conversations()).toHaveLength(2);
      expect(mockWs.joinStaffChat).toHaveBeenCalledWith('conv-A');
      expect(mockWs.joinStaffChat).toHaveBeenCalledWith('conv-B');
    });

    it('resets loading to false after error', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush('Error', { status: 500, statusText: 'Server Error' });
      expect(service.loading()).toBe(false);
    });

    it('totalUnread is the sum of unread_count across all conversations', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({
        success: true,
        data: [
          makeConversation({ unread_count: 3 }),
          makeConversation({ id: 'conv-2', unread_count: 7 }),
        ],
      });
      expect(service.totalUnread()).toBe(10);
    });
  });

  // ─── selectConversation / deselectConversation ────────────────────────────

  describe('selectConversation()', () => {
    it('sets activeConversationId and loads messages', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      service.selectConversation('conv-1');
      expect(service.activeConversationId()).toBe('conv-1');

      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });

    it('clears messages before loading new ones', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({
        success: true,
        data: [makeConversation({ id: 'conv-1' }), makeConversation({ id: 'conv-2' })],
      });

      // Select first
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true, data: [makeMsg({ id: 'msg-a' })], hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
      expect(service.messages()).toHaveLength(1);

      // Select second — messages should be cleared immediately
      service.selectConversation('conv-2');
      expect(service.messages()).toHaveLength(0);

      httpMock.expectOne('/api/staff-chat/conversations/conv-2/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });
  });

  describe('deselectConversation()', () => {
    it('clears activeConversationId and messages', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [makeMsg()], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      service.deselectConversation();
      expect(service.activeConversationId()).toBeNull();
      expect(service.messages()).toEqual([]);
    });
  });

  // ─── sendMessage — optimistic behaviour ──────────────────────────────────

  describe('sendMessage()', () => {
    beforeEach(() => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });

    it('immediately adds a temp message before HTTP response', () => {
      service.sendMessage('Тест');
      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].id).toMatch(/^temp-/);
      expect(service.messages()[0].content).toBe('Тест');

      const serverMsg = makeMsg({ id: 'server-1', sender_id: 'user-1', content: 'Тест' });
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: serverMsg });
    });

    it('replaces temp message with server response on success', () => {
      service.sendMessage('Привет');
      const tempId = service.messages()[0].id;

      const serverMsg = makeMsg({ id: 'real-100', content: 'Привет' });
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: serverMsg });

      expect(service.messages()).toHaveLength(1);
      expect(service.messages()[0].id).toBe('real-100');
      expect(service.messages()[0].id).not.toBe(tempId);
    });

    it('removes temp message and sets lastError on HTTP error', () => {
      service.sendMessage('Fail');
      expect(service.messages()).toHaveLength(1);

      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush(
        'Error', { status: 500, statusText: 'Server Error' }
      );

      expect(service.messages()).toHaveLength(0);
      expect(service.lastError()).toBeTruthy();
    });

    it('does nothing when content is empty or whitespace', () => {
      service.sendMessage('   ');
      httpMock.expectNone('/api/staff-chat/conversations/conv-1/messages');
      expect(service.messages()).toHaveLength(0);
    });

    it('does nothing when no conversation is active', () => {
      service.deselectConversation();
      service.sendMessage('Привет');
      httpMock.expectNone(r => r.url.includes('/messages'));
    });
  });

  // ─── editMessage — optimistic update ─────────────────────────────────────

  describe('editMessage()', () => {
    beforeEach(() => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true,
        data: [makeMsg({ id: 'msg-edit', content: 'Оригинал' })],
        hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });

    it('immediately updates the message content optimistically', () => {
      service.editMessage('msg-edit', 'Изменено');

      expect(service.messages()[0].content).toBe('Изменено');
      expect(service.messages()[0].edited_at).toBeTruthy();

      const serverMsg = makeMsg({ id: 'msg-edit', content: 'Изменено', edited_at: new Date().toISOString() });
      httpMock.expectOne(r => r.url.includes('/msg-edit')).flush({ success: true, data: serverMsg });
    });

    it('PUTs to the correct endpoint with new content', () => {
      service.editMessage('msg-edit', 'Новый текст');

      const req = httpMock.expectOne(r => r.url.includes('/conv-1/messages/msg-edit'));
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ content: 'Новый текст' });
      req.flush({ success: true, data: makeMsg({ id: 'msg-edit', content: 'Новый текст' }) });
    });

    it('reverts by reloading messages and sets lastError on HTTP error', () => {
      service.editMessage('msg-edit', 'Fail edit');
      // Optimistic update happened
      expect(service.messages()[0].content).toBe('Fail edit');

      httpMock.expectOne(r => r.url.includes('/msg-edit')).flush(
        { message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' }
      );

      // Service reloads messages as rollback
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true,
        data: [makeMsg({ id: 'msg-edit', content: 'Оригинал' })],
        hasOlder: false,
      });

      expect(service.lastError()).toBeTruthy();
    });

    it('does nothing when new content is empty', () => {
      service.editMessage('msg-edit', '   ');
      httpMock.expectNone(r => r.url.includes('/msg-edit'));
    });
  });

  // ─── deleteMessage — optimistic soft-delete ───────────────────────────────

  describe('deleteMessage()', () => {
    beforeEach(() => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true,
        data: [makeMsg({ id: 'msg-del', content: 'К удалению' })],
        hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });

    it('immediately soft-deletes by clearing content and setting deleted_at', () => {
      service.deleteMessage('msg-del');

      expect(service.messages()[0].content).toBe('');
      expect(service.messages()[0].deleted_at).toBeTruthy();

      httpMock.expectOne(r => r.url.includes('/msg-del')).flush({ success: true });
    });

    it('DELETEs to the correct endpoint', () => {
      service.deleteMessage('msg-del');
      const req = httpMock.expectOne(r => r.url.includes('/conv-1/messages/msg-del'));
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });

    it('reloads messages and sets lastError on HTTP error', () => {
      service.deleteMessage('msg-del');
      httpMock.expectOne(r => r.url.includes('/msg-del')).flush(
        { message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' }
      );

      // Rollback via reload
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true, data: [makeMsg({ id: 'msg-del', content: 'К удалению' })], hasOlder: false,
      });

      expect(service.lastError()).toBeTruthy();
    });
  });

  // ─── leaveConversation ────────────────────────────────────────────────────

  describe('leaveConversation()', () => {
    beforeEach(() => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({
        success: true,
        data: [makeConversation({ id: 'conv-1' }), makeConversation({ id: 'conv-2' })],
      });
    });

    it('DELETEs /leave and removes conversation from list', () => {
      service.leaveConversation('conv-1');
      const req = httpMock.expectOne('/api/staff-chat/conversations/conv-1/leave');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });

      expect(service.conversations().some(c => c.id === 'conv-1')).toBe(false);
      expect(service.conversations()).toHaveLength(1);
    });

    it('deselects active conversation when leaving it', () => {
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      service.leaveConversation('conv-1');
      httpMock.expectOne(r => r.url.includes('/leave')).flush({ success: true });

      expect(service.activeConversationId()).toBeNull();
    });

    it('calls wsService.leaveStaffChat after leaving', () => {
      service.leaveConversation('conv-1');
      httpMock.expectOne(r => r.url.includes('/leave')).flush({ success: true });
      expect(mockWs.leaveStaffChat).toHaveBeenCalledWith('conv-1');
    });
  });

  // ─── toggleReaction ───────────────────────────────────────────────────────

  describe('toggleReaction()', () => {
    beforeEach(() => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true,
        data: [makeMsg({ id: 'msg-react', reactions: [] })],
        hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });
    });

    it('calls addReaction (POST) when the user has NOT reacted yet', () => {
      service.toggleReaction('msg-react', '👍');
      const req = httpMock.expectOne(r => r.url.includes('/reactions'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ emoji: '👍' });
      req.flush({ success: true });
    });

    it('calls removeReaction (DELETE) when the user HAS already reacted', () => {
      // Pre-seed message with an existing myReaction
      service.loadConversations();
      // loadConversations triggers HTTP again — just flush it
      httpMock.match('/api/staff-chat/conversations').forEach(r =>
        r.flush({ success: true, data: [makeConversation()] })
      );

      // Directly update messages via selectConversation with a pre-reacted message
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true,
        data: [makeMsg({ id: 'msg-react', reactions: [{ emoji: '👍', count: 1, users: ['user-1'], myReaction: true }] })],
        hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      service.toggleReaction('msg-react', '👍');
      const req = httpMock.expectOne(r => r.url.includes('/reactions'));
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  // ─── WS: staffChatMessageEdited ───────────────────────────────────────────

  describe('WS staffChatMessageEdited', () => {
    it('updates message content in the active conversation', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true, data: [makeMsg({ id: 'msg-1', content: 'Старый текст' })], hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      mockWs.staffChatMessageEdited.set({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        content: 'Новый текст',
        editedAt: new Date().toISOString(),
      });

      TestBed.flushEffects();

      expect(service.messages()[0].content).toBe('Новый текст');
      expect(service.messages()[0].edited_at).toBeTruthy();
    });
  });

  // ─── WS: staffChatMessageDeleted ─────────────────────────────────────────

  describe('WS staffChatMessageDeleted', () => {
    it('soft-deletes message in the active conversation', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({
        success: true, data: [makeMsg({ id: 'msg-del', content: 'Удаляем' })], hasOlder: false,
      });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      mockWs.staffChatMessageDeleted.set({ conversationId: 'conv-1', messageId: 'msg-del' });
      TestBed.flushEffects();

      expect(service.messages()[0].content).toBe('');
      expect(service.messages()[0].deleted_at).toBeTruthy();
    });
  });

  // ─── WS: staffChatUserLeft (current user) ────────────────────────────────

  describe('WS staffChatUserLeft (current user)', () => {
    it('removes the conversation from the list when the current user leaves', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({
        success: true,
        data: [makeConversation({ id: 'conv-1' }), makeConversation({ id: 'conv-2' })],
      });

      // Signal that current user (user-1) left conv-1
      mockWs.staffChatUserLeft.set({ conversationId: 'conv-1', userId: 'user-1' });
      TestBed.flushEffects();

      expect(service.conversations().some(c => c.id === 'conv-1')).toBe(false);
      expect(service.conversations()).toHaveLength(1);
    });

    it('deselects the active conversation when the current user is removed', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      mockWs.staffChatUserLeft.set({ conversationId: 'conv-1', userId: 'user-1' });
      TestBed.flushEffects();

      expect(service.activeConversationId()).toBeNull();
    });
  });

  // ─── WS: staffChatTyping ─────────────────────────────────────────────────

  describe('WS staffChatTyping', () => {
    it('adds user to typingUsers when isTyping is true', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      // user-99 is typing in conv-1 (different from current user-1)
      mockWs.staffChatTyping.set({ conversationId: 'conv-1', userId: 'user-99', isTyping: true });
      TestBed.flushEffects();

      const typers = service.typingUsers().get('conv-1');
      expect(typers?.has('user-99')).toBe(true);
    });

    it('ignores typing events from the current user', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      // current user (user-1) typing — should be ignored
      mockWs.staffChatTyping.set({ conversationId: 'conv-1', userId: 'user-1', isTyping: true });
      TestBed.flushEffects();

      expect(service.typingUsers().get('conv-1')).toBeUndefined();
    });

    it('removes user from typingUsers when isTyping is false', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      mockWs.staffChatTyping.set({ conversationId: 'conv-1', userId: 'user-99', isTyping: true });
      TestBed.flushEffects();

      mockWs.staffChatTyping.set({ conversationId: 'conv-1', userId: 'user-99', isTyping: false });
      TestBed.flushEffects();

      const typers = service.typingUsers().get('conv-1');
      expect(!typers || !typers.has('user-99')).toBe(true);
    });
  });

  // ─── Echo filter: own WS messages replace temp-id ─────────────────────────

  describe('WS staffChatMessage echo filter', () => {
    it('replaces temp-* message with the real message from WS for own messages', () => {
      service.init();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });
      service.selectConversation('conv-1');
      httpMock.expectOne('/api/staff-chat/conversations/conv-1/messages').flush({ success: true, data: [], hasOlder: false });
      httpMock.expectOne(r => r.url.includes('/read')).flush({ success: true });

      // Send own message (creates temp-*)
      service.sendMessage('Echo test');
      expect(service.messages()[0].id).toMatch(/^temp-/);

      // WS echo: own message with real DB id
      const realMsg = makeMsg({ id: 'db-55', sender_id: 'user-1', content: 'Echo test' });
      mockWs.staffChatMessage.set({ conversationId: 'conv-1', message: realMsg });
      TestBed.flushEffects();

      // temp should be replaced, no duplication
      const msgs = service.messages();
      expect(msgs.some(m => m.id.startsWith('temp-'))).toBe(false);
      expect(msgs.some(m => m.id === 'db-55')).toBe(true);
      expect(msgs).toHaveLength(1);

      // Cleanup HTTP for the messages endpoint
      httpMock.match(r => r.url.includes('/conv-1/messages') && !r.url.includes('/read')).forEach(r =>
        r.flush({ success: true, data: [realMsg] })
      );
    });
  });

  // ─── renameConversation ──────────────────────────────────────────────────

  describe('renameConversation()', () => {
    it('PUTs to /api/staff-chat/conversations/:id and updates title in list', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation({ title: 'Старое название' })] });

      service.renameConversation('conv-1', 'Новое название');
      const req = httpMock.expectOne('/api/staff-chat/conversations/conv-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ title: 'Новое название' });
      req.flush({ success: true });

      expect(service.conversations()[0].title).toBe('Новое название');
    });

    it('does nothing when newTitle is empty or whitespace', () => {
      service.loadConversations();
      httpMock.expectOne('/api/staff-chat/conversations').flush({ success: true, data: [makeConversation()] });

      service.renameConversation('conv-1', '   ');
      httpMock.expectNone('/api/staff-chat/conversations/conv-1');
    });
  });
});
