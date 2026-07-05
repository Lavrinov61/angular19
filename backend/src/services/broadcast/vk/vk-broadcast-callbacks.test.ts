import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for vk-broadcast-callbacks.service + parseVkBroadcastCmd.
 *
 * The VK inline-button callbacks (handled in vk.adapter message_event) turn «❌ Отписаться»
 * into a suppression, «🙋 Я не студент» into an operator lead, «📍 Наши адреса» into an
 * addresses reply. DB / chat-broadcast / account-store / adapter-registry are mocked.
 *
 * P0-2 IDEMPOTENCY is the load-bearing property: VK may redeliver a message_event if our ack
 * misses the event_id window or the webhook retries. So a REPEATED callback must produce
 * EXACTLY ONE suppression and must NOT duplicate the not-student note.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const {
  mockQuery,
  mockQueryOne,
  mockTransaction,
  mockBroadcastChatMessage,
  mockGetAccountByChannel,
  mockGetAdapter,
  mockSendText,
} = vi.hoisted(() => {
  const sendText = vi.fn().mockResolvedValue({ success: true });
  return {
    mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
    mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
    mockTransaction: vi.fn(),
    mockBroadcastChatMessage: vi.fn().mockResolvedValue(undefined),
    mockGetAccountByChannel: vi.fn().mockResolvedValue({ id: 'acct-vk', credentials: { groupToken: 'vk1.a.T' } }),
    mockGetAdapter: vi.fn(() => ({ sendText })),
    mockSendText: sendText,
  };
});

vi.mock('../../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne, transaction: mockTransaction },
}));
vi.mock('../../chat-broadcast.service.js', () => ({
  broadcastChatMessage: mockBroadcastChatMessage,
}));
vi.mock('../../connectors/core/account-store.js', () => ({
  getAccountByChannel: mockGetAccountByChannel,
}));
vi.mock('../../connectors/core/adapter-registry.js', () => ({
  getAdapter: mockGetAdapter,
}));
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { handleVkBroadcastCallback } = await import('./vk-broadcast-callbacks.service.js');
const { parseVkBroadcastCmd, isVkBroadcastCallback, VK_BCAST_UNSUB, VK_BCAST_NOT_STUDENT, VK_BCAST_ADDRESSES } =
  await import('./vk-broadcast-callbacks.constants.js');

const PEER = 66681961;
const CONV = { id: 'conv-1', contact_id: 'contact-1' };

/**
 * Build a tx client whose `query` records the SQL it sees and answers the not-student dedup
 * EXISTS probe with `noteExists` (false = note absent → it will be inserted).
 */
function txClient(noteExists: boolean, calls: string[]) {
  return {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("sender_type = 'internal_note'") && sql.includes("metadata ->> 'bcastNote'")) {
        return { rows: noteExists ? [{ x: 1 }] : [], rowCount: noteExists ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO messages')) {
        return { rows: [{ id: 'note-1', conversation_id: CONV.id, sender_type: 'internal_note', content: '…', created_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue(null);
  mockBroadcastChatMessage.mockReset().mockResolvedValue(undefined);
  mockSendText.mockReset().mockResolvedValue({ success: true });
  mockGetAccountByChannel.mockResolvedValue({ id: 'acct-vk', credentials: { groupToken: 'vk1.a.T' } });
  mockGetAdapter.mockReturnValue({ sendText: mockSendText });
});

// ─── parseVkBroadcastCmd — tolerant of object / JSON-string / bare string ─────

describe('parseVkBroadcastCmd', () => {
  it('parses the object form {cmd:...} (VK deserializes valid JSON payloads)', () => {
    expect(parseVkBroadcastCmd({ cmd: VK_BCAST_UNSUB })).toBe(VK_BCAST_UNSUB);
  });

  it('parses a JSON-string payload', () => {
    expect(parseVkBroadcastCmd(JSON.stringify({ cmd: VK_BCAST_NOT_STUDENT }))).toBe(VK_BCAST_NOT_STUDENT);
  });

  it('parses a bare string value', () => {
    expect(parseVkBroadcastCmd(VK_BCAST_ADDRESSES)).toBe(VK_BCAST_ADDRESSES);
  });

  it('returns null for a foreign / malformed payload', () => {
    expect(parseVkBroadcastCmd({ cmd: 'some_other_thing' })).toBeNull();
    expect(parseVkBroadcastCmd('not-ours')).toBeNull();
    expect(parseVkBroadcastCmd('{bad json')).toBeNull();
    expect(parseVkBroadcastCmd(null)).toBeNull();
    expect(parseVkBroadcastCmd(undefined)).toBeNull();
    expect(parseVkBroadcastCmd(42)).toBeNull();
  });

  it('isVkBroadcastCallback mirrors parse (true only for our cmds)', () => {
    expect(isVkBroadcastCallback({ cmd: VK_BCAST_UNSUB })).toBe(true);
    expect(isVkBroadcastCallback('nope')).toBe(false);
  });
});

// ─── guard: foreign payload / missing peer ────────────────────────────────────

describe('handleVkBroadcastCallback — guards', () => {
  it('returns void for a non-broadcast payload (no DB hit)', async () => {
    const res = await handleVkBroadcastCallback(PEER, { cmd: 'foreign' });
    expect(res).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns void when peerId is 0/falsy', async () => {
    const res = await handleVkBroadcastCallback(0, { cmd: VK_BCAST_UNSUB });
    expect(res).toBeUndefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ─── ADDRESSES → reply + snackbar (idempotent by nature) ──────────────────────

describe('handleVkBroadcastCallback — addresses', () => {
  it('sends the studio addresses as a VK message and returns a snackbar', async () => {
    mockQuery.mockResolvedValueOnce([
      { name: 'Своё Фото — Соборный', address: 'ул. Соборный 21' },
      { name: 'Своё Фото — Баррикадная', address: 'ул. 2-ая Баррикадная 4' },
    ]);

    const res = await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_ADDRESSES });

    expect(mockSendText).toHaveBeenCalledTimes(1);
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain('Соборный 21');
    expect(sentText).toContain('2-ая Баррикадная 4');
    // Тире из названия студии убрано (правило проекта «без тире»).
    expect(sentText).not.toContain('—');
    expect(sentText).not.toContain('–');
    // Ответ идёт сообщением в диалог, snackbar НЕ показываем.
    expect(res).toEqual({});
    // addresses path does not resolve a conversation.
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ─── UNSUB → suppression (P0-2 idempotent on repeat) ──────────────────────────

describe('handleVkBroadcastCallback — unsubscribe (P0-2 idempotency)', () => {
  it('records a suppression keyed by contact_id + clears opt-in, returns snackbar', async () => {
    const calls: string[] = [];
    mockQueryOne.mockResolvedValueOnce(CONV); // resolveVkConversation
    mockTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => {
      const client = { query: vi.fn(async (sql: string) => { calls.push(sql); return { rows: [], rowCount: 0 }; }) };
      return fn(client);
    });

    const res = await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_UNSUB });

    const supp = calls.find((s) => s.includes('INSERT INTO marketing_suppressions'));
    expect(supp).toBeTruthy();
    expect(supp).toContain("'unsubscribe'");
    expect(supp).toContain('ON CONFLICT'); // idempotent insert (no dup suppression on retry)
    expect(calls.some((s) => s.includes('UPDATE channel_users') && s.includes('opted_in = false'))).toBe(true);
    // Подтверждение отписки идёт сообщением в диалог (не snackbar).
    expect(res).toEqual({});
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText.mock.calls[0][2] as string).toContain('отписались');
    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();
  });

  it('a REPEATED unsubscribe callback produces EXACTLY ONE suppression (ON CONFLICT DO NOTHING)', async () => {
    // Simulate a real unique index: a second INSERT for the same contact is a no-op.
    const suppressed = new Set<string>();
    mockQueryOne.mockResolvedValue(CONV);
    mockTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('INSERT INTO marketing_suppressions')) {
            const contactId = String((params as unknown[])[0]);
            if (suppressed.has(contactId)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
            suppressed.add(contactId);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };
      return fn(client);
    });

    await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_UNSUB });
    await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_UNSUB }); // VK redelivery

    expect(suppressed.size).toBe(1); // exactly one suppression row across both events
  });
});

// ─── NOT_STUDENT → internal_note (P0-2: deduped on repeat) ────────────────────

describe('handleVkBroadcastCallback — not-a-student (P0-2 note dedup)', () => {
  it('inserts an internal_note and live-notifies the operator (note absent)', async () => {
    const calls: string[] = [];
    mockQueryOne.mockResolvedValueOnce(CONV); // resolveVkConversation
    mockTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => fn(txClient(false, calls)));

    const res = await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_NOT_STUDENT });

    expect(calls.some((s) => s.includes('INSERT INTO messages') && s.includes("'internal_note'"))).toBe(true);
    expect(mockBroadcastChatMessage).toHaveBeenCalledTimes(1);
    expect(mockBroadcastChatMessage.mock.calls[0][0]).toMatchObject({ sessionId: CONV.id });
    // Ответ клиенту идёт сообщением в диалог (не snackbar).
    expect(res).toEqual({});
    expect(mockSendText).toHaveBeenCalledTimes(1);
  });

  it('does NOT duplicate the note (no INSERT, no notify) when the marker note already exists', async () => {
    const calls: string[] = [];
    mockQueryOne.mockResolvedValueOnce(CONV);
    mockTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => fn(txClient(true, calls)));

    const res = await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_NOT_STUDENT });

    expect(calls.some((s) => s.includes('INSERT INTO messages'))).toBe(false); // dedup: no duplicate note
    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();                    // no duplicate notify on retry
    expect(res).toEqual({});                                                    // client still acked (сообщением)
    expect(mockSendText).toHaveBeenCalledTimes(1);
  });

  it('a REPEATED not-student callback inserts the note only ONCE across two events', async () => {
    // Stateful conversation marker: first event inserts, second sees it exists.
    let noteCreated = false;
    mockQueryOne.mockResolvedValue(CONV);
    mockTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("sender_type = 'internal_note'") && sql.includes("metadata ->> 'bcastNote'")) {
            return { rows: noteCreated ? [{ x: 1 }] : [], rowCount: noteCreated ? 1 : 0 };
          }
          if (sql.includes('INSERT INTO messages')) {
            noteCreated = true;
            return { rows: [{ id: 'note-1', conversation_id: CONV.id, sender_type: 'internal_note', content: '…', created_at: new Date() }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };
      return fn(client);
    });

    await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_NOT_STUDENT });
    await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_NOT_STUDENT }); // VK redelivery

    expect(noteCreated).toBe(true);
    expect(mockBroadcastChatMessage).toHaveBeenCalledTimes(1); // notified once, not twice
  });

  it('still acks the client when no conversation is found (no note, no notify)', async () => {
    mockQueryOne.mockResolvedValue(null); // resolveVkConversation → none

    const res = await handleVkBroadcastCallback(PEER, { cmd: VK_BCAST_NOT_STUDENT });

    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();
    // Даже без конверсации клиент получает ответ сообщением.
    expect(res).toEqual({});
    expect(mockSendText).toHaveBeenCalledTimes(1);
  });
});
