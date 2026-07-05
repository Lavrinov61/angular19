import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for broadcast-callbacks.service — the inline-button handlers that turn
 * «❌ Отписаться» into a suppression and «🙋 Я не студент» into an operator lead.
 * DB + chat-broadcast are mocked; assertions cover the side effects + the client ack text.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const { mockQuery, mockQueryOne, mockBroadcastChatMessage } = vi.hoisted(() => ({
  mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
  mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
  mockBroadcastChatMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne },
}));
vi.mock('../chat-broadcast.service.js', () => ({
  broadcastChatMessage: mockBroadcastChatMessage,
}));
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { handleBroadcastCallback, BCAST_UNSUB, BCAST_NOT_STUDENT, BCAST_ADDRESSES } = await import('./broadcast-callbacks.service.js');

const CONV = { id: 'conv-1', contact_id: 'contact-1' };

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue([]);
  mockQueryOne.mockReset().mockResolvedValue(null);
  mockBroadcastChatMessage.mockReset().mockResolvedValue(undefined);
});

describe('handleBroadcastCallback', () => {
  it('returns null for non-broadcast callback data', async () => {
    expect(await handleBroadcastCallback('1020685867', 'some_other_cb')).toBeNull();
    expect(await handleBroadcastCallback('', BCAST_UNSUB)).toBeNull(); // empty chatId
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('addresses: replies with all physical studio addresses from the DB (no conversation lookup)', async () => {
    mockQuery.mockResolvedValueOnce([
      { name: 'Своё Фото — Соборный', address: 'ул. Соборный 21, Ростов-на-Дону' },
      { name: 'Своё Фото — Баррикадная', address: 'ул. 2-ая Баррикадная 4, Ростов-на-Дону' },
    ]);
    const res = await handleBroadcastCallback('1020685867', BCAST_ADDRESSES);

    const studioQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM\n     studios') || String(sql).includes('FROM studios'));
    expect(studioQuery).toBeTruthy();
    expect(String(studioQuery![0])).toContain("location_code <> 'online'"); // virtual/test rows excluded
    expect(res?.ackText).toContain('Соборный 21');
    expect(res?.ackText).toContain('2-ая Баррикадная 4');
    // Headers (studio names) are bold via HTML parse_mode so the reply is scannable.
    expect(res?.parseMode).toBe('HTML');
    expect(res?.ackText).toContain('<b>Своё Фото — Соборный</b>');
    expect(mockQueryOne).not.toHaveBeenCalled(); // addresses path skips resolveConversation
  });

  it('addresses: graceful fallback when no studios returned', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await handleBroadcastCallback('1020685867', BCAST_ADDRESSES);
    expect(res?.ackText).toContain('временно недоступны');
  });

  it('unsubscribe: records marketing_suppressions(reason=unsubscribe) keyed by contact_id', async () => {
    mockQueryOne.mockResolvedValueOnce(CONV); // resolveConversation
    const res = await handleBroadcastCallback('1020685867', BCAST_UNSUB);

    const supp = mockQuery.mock.calls.find(([sql]) => String(sql).includes('marketing_suppressions'));
    expect(supp).toBeTruthy();
    expect(String(supp![0])).toContain("'unsubscribe'");
    expect((supp![1] as unknown[])[0]).toBe('contact-1');     // contact_id
    expect((supp![1] as unknown[])[1]).toBe('1020685867');     // external_chat_id
    expect(res?.ackText).toContain('отписаны');
    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();
  });

  it('not-student: inserts an internal_note and live-notifies the operator', async () => {
    mockQueryOne
      .mockResolvedValueOnce(CONV)                                  // resolveConversation
      .mockResolvedValueOnce({ id: 'note-1', conversation_id: 'conv-1', sender_type: 'internal_note', content: '…' }); // note insert RETURNING
    const res = await handleBroadcastCallback('1020685867', BCAST_NOT_STUDENT);

    const noteInsert = mockQueryOne.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO messages') && String(sql).includes("'internal_note'"));
    expect(noteInsert).toBeTruthy();
    expect(String(noteInsert![0])).toContain('Я не студент');
    expect(mockBroadcastChatMessage).toHaveBeenCalledTimes(1);
    expect(mockBroadcastChatMessage.mock.calls[0][0]).toMatchObject({ sessionId: 'conv-1' });
    // Ack invites the client to describe their occupation (engaging prompt, not a dead "передал менеджеру").
    expect(res?.ackText).toContain('чем вы занимаетесь');
    expect(res?.ackText).toContain('специальное предложение');
  });

  it('not-student: still acks the client even if no conversation is found (no note)', async () => {
    mockQueryOne.mockResolvedValue(null); // resolveConversation → none
    const res = await handleBroadcastCallback('1020685867', BCAST_NOT_STUDENT);
    expect(mockBroadcastChatMessage).not.toHaveBeenCalled();
    expect(res?.ackText).toContain('чем вы занимаетесь');
  });

  // ── channel param (S3): a MAX callback must resolve the conversation on the MAX channel ──
  it('channel="max": resolveConversation looks up the conversation on channel=max', async () => {
    mockQueryOne.mockResolvedValueOnce(CONV); // resolveConversation
    const res = await handleBroadcastCallback('138553724', BCAST_UNSUB, 'max');

    // resolveConversation is the (only) queryOne here — its 2nd SQL param is the channel.
    const resolveCall = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('FROM conversations'));
    expect(resolveCall).toBeTruthy();
    expect(String(resolveCall![0])).toContain('channel = $2');
    expect((resolveCall![1] as unknown[])[0]).toBe('138553724'); // chatId → $1
    expect((resolveCall![1] as unknown[])[1]).toBe('max');         // channel → $2
    expect(res?.ackText).toContain('отписаны');
  });

  it('default (no channel arg): resolveConversation still uses channel=telegram (TG regression guard)', async () => {
    mockQueryOne.mockResolvedValueOnce(CONV);
    await handleBroadcastCallback('1020685867', BCAST_UNSUB);

    const resolveCall = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('FROM conversations'));
    expect((resolveCall![1] as unknown[])[1]).toBe('telegram');
  });

  it('channel="max": not-student routes the note on the MAX conversation', async () => {
    mockQueryOne
      .mockResolvedValueOnce(CONV)                                  // resolveConversation (channel=max)
      .mockResolvedValueOnce({ id: 'note-1', conversation_id: 'conv-1', sender_type: 'internal_note', content: '…' });
    await handleBroadcastCallback('138553724', BCAST_NOT_STUDENT, 'max');

    const resolveCall = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('FROM conversations'));
    expect((resolveCall![1] as unknown[])[1]).toBe('max');
    expect(mockBroadcastChatMessage).toHaveBeenCalledTimes(1);
  });
});
