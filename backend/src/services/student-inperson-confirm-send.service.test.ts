import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type PoolClient } from 'pg';
import db from '../database/db.js';
import {
  enqueueInPersonConfirmSend,
  processDueInPersonConfirmSends,
  resolveBestMessengerForUser,
  sendInPersonConfirmLinkToConversation,
} from './student-inperson-confirm-send.service.js';

const deliverToChannel = vi.hoisted(() => vi.fn());
const sendSms = vi.hoisted(() => vi.fn());
const hasVerifiedEducationAccount = vi.hoisted(() => vi.fn());
const broadcastToRoom = vi.hoisted(() => vi.fn());
const broadcastChatMessage = vi.hoisted(() => vi.fn());
const enqueueOutbound = vi.hoisted(() => vi.fn());

vi.mock('../database/db.js', () => ({
  default: {
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('./channel-delivery.service.js', () => ({ deliverToChannel }));
vi.mock('./sms.service.js', () => ({ sendSms }));
vi.mock('./account-discounts.service.js', () => ({ hasVerifiedEducationAccount }));
vi.mock('../websocket/broadcast-to-room.js', () => ({ broadcastToRoom }));
vi.mock('./chat-broadcast.service.js', () => ({ broadcastChatMessage }));
vi.mock('./connectors/pipeline/outbound-worker.js', () => ({ enqueueOutbound }));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function makeClient(handler: (sql: string, params: unknown[]) => unknown): PoolClient {
  const queryMock = vi.fn(async (sql: string, params: unknown[]) => handler(normalizeSql(sql), params ?? []));
  const client: PoolClient = Object.assign(new Client(), { query: queryMock, release: vi.fn() });
  return client;
}

interface ClaimRowOverrides {
  id?: string;
  verification_id?: string;
  user_id?: string | null;
  phone_normalized?: string;
  attempts?: number;
}

describe('enqueueInPersonConfirmSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasVerifiedEducationAccount.mockResolvedValue(false);
  });

  it('upserts a pending send and returns the resolved send_at + channel hint', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ channel: 'telegram', external_chat_id: 'tg-1' });

    const client = makeClient((sql) => {
      if (sql.includes("status = 'sent'")) return { rows: [] }; // anti-dup check
      if (sql.includes('AS send_at')) return { rows: [{ send_at: '2026-06-06T06:00:00.000Z' }] };
      if (sql.startsWith('INSERT INTO student_inperson_confirm_sends')) {
        return { rows: [{ send_at: '2026-06-06T06:00:00.000Z' }] };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    });

    const result = await enqueueInPersonConfirmSend(client, {
      verificationId: 'v-1',
      userId: 'u-1',
      phoneNormalized: '79001234567',
    });

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe('enqueued');
    expect(result.sendAt).toBe('2026-06-06T06:00:00.000Z');
    expect(result.channelHint).toBe('telegram');

    const insert = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) =>
      normalizeSql(call[0]).startsWith('INSERT INTO student_inperson_confirm_sends'),
    );
    expect(normalizeSql(insert?.[0])).toContain('ON CONFLICT (verification_id) DO UPDATE');
  });

  it('does not enqueue when the user already has a verified education account', async () => {
    hasVerifiedEducationAccount.mockResolvedValue(true);
    const client = makeClient(() => {
      throw new Error('should not run any SQL');
    });

    const result = await enqueueInPersonConfirmSend(client, {
      verificationId: 'v-1',
      userId: 'u-1',
      phoneNormalized: '79001234567',
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('already_verified');
    expect(result.sendAt).toBeNull();
  });

  it('does not enqueue when a send was already delivered recently to that phone', async () => {
    const client = makeClient((sql) => {
      if (sql.includes("status = 'sent'")) return { rows: [{ '?column?': 1 }] };
      throw new Error(`Unhandled SQL: ${sql}`);
    });

    const result = await enqueueInPersonConfirmSend(client, {
      verificationId: 'v-1',
      userId: 'u-1',
      phoneNormalized: '79001234567',
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe('recently_sent');
  });
});

describe('resolveBestMessengerForUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when there is no bound messenger conversation', async () => {
    vi.mocked(db.queryOne).mockResolvedValue(null);
    expect(await resolveBestMessengerForUser('u-1')).toBeNull();
  });

  it('returns channel + external chat id when a messenger is bound', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ channel: 'max', external_chat_id: 'max-9' });
    expect(await resolveBestMessengerForUser('u-1')).toEqual({ channel: 'max', externalChatId: 'max-9' });
  });

  it('looks at conversation user binding, not only contact user binding', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ channel: 'max', external_chat_id: 'max-9' });

    await resolveBestMessengerForUser('u-1');

    const sql = normalizeSql(vi.mocked(db.queryOne).mock.calls[0]?.[0]);
    expect(sql).toContain('(ct.user_id = $1 OR c.user_id = $1');
  });

  it('can match a messenger contact by normalized phone when the contact is not linked to the user', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ channel: 'max', external_chat_id: 'max-9' });

    await resolveBestMessengerForUser('u-1', '79001234567');

    const [sql, params] = vi.mocked(db.queryOne).mock.calls[0] ?? [];
    expect(normalizeSql(sql)).toContain("RIGHT(REGEXP_REPLACE(COALESCE(ct.phone, c.visitor_phone, ''), '\\D', '', 'g'), 10)");
    expect(params).toEqual(['u-1', '79001234567']);
  });
});

describe('processDueInPersonConfirmSends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasVerifiedEducationAccount.mockResolvedValue(false);
    delete process.env['INPERSON_CONFIRM_SEND_ENABLED'];
  });

  function claimRow(over: ClaimRowOverrides = {}) {
    return {
      id: 's-1',
      verification_id: 'v-1',
      user_id: 'u-1',
      phone_normalized: '79001234567',
      attempts: 1,
      ...over,
    };
  }

  it('does nothing when the killswitch is off', async () => {
    process.env['INPERSON_CONFIRM_SEND_ENABLED'] = 'false';
    await processDueInPersonConfirmSends();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('delivers to messenger and marks sent', async () => {
    deliverToChannel.mockResolvedValue(true);
    const updates: string[] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      updates.push(n);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      // user-resolve через contacts (нет target на заявке)
      if (n.includes('FROM conversations') && n.includes('JOIN contacts')) {
        return { channel: 'telegram', external_chat_id: 'tg-1' };
      }
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).toHaveBeenCalledWith('telegram', 'tg-1', expect.stringContaining('svoefoto.ru/education/in-person'));
    expect(updates.some(u => u.includes("status = 'sent'") && u.includes('channel_used'))).toBe(true);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('prioritizes the target conversation over the user-resolved messenger', async () => {
    deliverToChannel.mockResolvedValue(true);
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) {
        return { status: 'pending_in_person', target_conversation_id: 'conv-target' };
      }
      // Явный target-диалог (прямой SELECT по id, без JOIN contacts).
      if (n.includes('FROM conversations') && n.includes('WHERE id = $1') && !n.includes('JOIN contacts')) {
        return { channel: 'vk', external_chat_id: 'vk-target' };
      }
      // user-resolve вернул бы другой канал — он не должен победить.
      if (n.includes('FROM conversations') && n.includes('JOIN contacts')) {
        return { channel: 'telegram', external_chat_id: 'tg-user' };
      }
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).toHaveBeenCalledWith('vk', 'vk-target', expect.stringContaining('svoefoto.ru/education/in-person'));
    expect(deliverToChannel).not.toHaveBeenCalledWith('telegram', 'tg-user', expect.anything());
  });

  it('falls back to user-resolved messenger when the target conversation is not a deliverable messenger', async () => {
    deliverToChannel.mockResolvedValue(true);
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) {
        return { status: 'pending_in_person', target_conversation_id: 'conv-web' };
      }
      // target — web-диалог без external_chat_id → helper вернёт null.
      if (n.includes('FROM conversations') && n.includes('WHERE id = $1') && !n.includes('JOIN contacts')) {
        return { channel: 'web', external_chat_id: null };
      }
      if (n.includes('FROM conversations') && n.includes('JOIN contacts')) {
        return { channel: 'telegram', external_chat_id: 'tg-user' };
      }
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).toHaveBeenCalledWith('telegram', 'tg-user', expect.anything());
  });

  it('falls back to SMS when messenger delivery returns false', async () => {
    deliverToChannel.mockResolvedValue(false);
    sendSms.mockResolvedValue({ success: true, smsId: 'voximplant:1' });
    const sentUpdates: string[] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      sentUpdates.push(n);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      if (n.includes('FROM conversations') && n.includes('JOIN contacts')) {
        return { channel: 'whatsapp', external_chat_id: 'wa-1' };
      }
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sentUpdates.some(u => u.includes("status = 'sent'") && u.includes('channel_used'))).toBe(true);
  });

  it('falls back to SMS when the user has no bound messenger', async () => {
    sendSms.mockResolvedValue({ success: true, smsId: 'voximplant:2' });
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      if (n.includes('FROM conversations')) return null; // no messenger
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('marks skipped (not sent) when SMS is disabled in the environment', async () => {
    sendSms.mockResolvedValue({ success: true, smsId: 'disabled' });
    const updates: string[] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      updates.push(n);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      if (n.includes('FROM conversations')) return null;
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(updates.some(u => u.includes("status = 'skipped'"))).toBe(true);
    expect(updates.some(u => u.includes("status = 'sent'"))).toBe(false);
  });

  it('skips delivery when the verification is no longer pending_in_person', async () => {
    const updates: string[] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      updates.push(n);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'approved', target_conversation_id: null };
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(updates.some(u => u.includes("status = 'skipped'"))).toBe(true);
  });

  it('marks failed when SMS fails on the final attempt', async () => {
    sendSms.mockResolvedValue({ success: false, error: 'provider down' });
    const finalUpdates: unknown[][] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) {
        return [claimRow({ attempts: 5 })] as never; // already at MAX_ATTEMPTS
      }
      if (n.includes('SET status = $2')) finalUpdates.push(params ?? []);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      if (n.includes('FROM conversations')) return null;
      return null;
    });

    await processDueInPersonConfirmSends();

    // markFailedOrRetry передаёт status вторым параметром; attempts=5 >= MAX → 'failed'.
    expect(finalUpdates.some(params => params[1] === 'failed')).toBe(true);
  });

  it('skips on send when the user became verified between enqueue and delivery', async () => {
    hasVerifiedEducationAccount.mockResolvedValue(true);
    const skipUpdates: unknown[][] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) return [claimRow()] as never;
      if (n.includes("status = 'skipped'")) skipUpdates.push(params ?? []);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      return null;
    });

    await processDueInPersonConfirmSends();

    expect(deliverToChannel).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(skipUpdates.some(params => params[1] === 'already_verified')).toBe(true);
  });

  it('returns to pending (not failed) when delivery fails but attempts are below MAX', async () => {
    deliverToChannel.mockResolvedValue(false);
    sendSms.mockResolvedValue({ success: false, error: 'provider down' });
    const finalUpdates: unknown[][] = [];
    vi.mocked(db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) {
        return [claimRow({ attempts: 1 })] as never; // below MAX_ATTEMPTS (=5)
      }
      if (n.includes('SET status = $2')) finalUpdates.push(params ?? []);
      return [] as never;
    });
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.includes('FROM student_verifications')) return { status: 'pending_in_person', target_conversation_id: null };
      if (n.includes('FROM conversations') && n.includes('JOIN contacts')) {
        return { channel: 'telegram', external_chat_id: 'tg-1' };
      }
      return null;
    });

    await processDueInPersonConfirmSends();

    // attempts=1 < MAX → обратно в pending для ретрая, last_error выставлен, НЕ failed.
    const retry = finalUpdates.find(params => params[1] === 'pending');
    expect(retry).toBeDefined();
    expect(retry?.[2]).toBe('provider down');
    expect(finalUpdates.some(params => params[1] === 'failed')).toBe(false);
  });

  it('claims due rows atomically with FOR UPDATE SKIP LOCKED and recovers stuck sending rows', async () => {
    let claimSql = '';
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      const n = normalizeSql(sql);
      if (n.startsWith('UPDATE student_inperson_confirm_sends s')) {
        claimSql = n;
        return [] as never; // нет due-записей — достаточно зафиксировать текст claim-запроса
      }
      return [] as never;
    });

    await processDueInPersonConfirmSends();

    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain("status = 'sending'");
    expect(claimSql).toContain('attempts = attempts + 1');
    // Ветка восстановления зависших sending-записей.
    expect(claimSql).toContain("status = 'sending' AND updated_at < NOW() - INTERVAL '15 minutes'");
  });
});

describe('sendInPersonConfirmLinkToConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastChatMessage.mockResolvedValue(undefined);
    enqueueOutbound.mockResolvedValue('queued-1');
  });

  /** Мок db.queryOne по содержимому SQL: conv → dedup → emp → insert. */
  function mockQueryOne(opts: {
    conv: unknown;
    dup?: unknown;
    emp?: unknown;
    inserted?: unknown;
  }): void {
    vi.mocked(db.queryOne).mockImplementation(async (sql: string) => {
      const s = normalizeSql(sql);
      if (s.includes('FROM conversations WHERE id = $1')) return opts.conv;
      if (s.startsWith('SELECT id FROM messages')) return opts.dup ?? null;
      if (s.includes('SELECT display_name FROM users')) return opts.emp ?? { display_name: 'Оператор' };
      if (s.startsWith('INSERT INTO messages')) return opts.inserted ?? { id: 'msg-1', created_at: '2026-06-08T10:00:00.000Z' };
      return null;
    });
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as never);
  }

  it('delivers into a web conversation (message + socket, no outbound)', async () => {
    mockQueryOne({ conv: { channel: 'web', external_chat_id: null } });

    const res = await sendInPersonConfirmLinkToConversation({
      conversationId: 'conv-web',
      verificationId: 'ver-1',
      employeeId: 'emp-1',
    });

    expect(res).toEqual({ outcome: 'sent', channel: 'web' });
    expect(vi.mocked(db.queryOne).mock.calls.some(([sql]) => normalizeSql(sql).startsWith('INSERT INTO messages'))).toBe(true);
    expect(broadcastToRoom).toHaveBeenCalledWith('operator:message', 'visitor:conv-web', expect.objectContaining({ senderType: 'operator' }));
    expect(broadcastChatMessage).toHaveBeenCalledTimes(1);
    // web → внешней доставки нет.
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('also enqueues outbound for a messenger conversation', async () => {
    mockQueryOne({ conv: { channel: 'telegram', external_chat_id: 'tg-1' } });

    const res = await sendInPersonConfirmLinkToConversation({
      conversationId: 'conv-tg',
      verificationId: 'ver-1',
      employeeId: 'emp-1',
    });

    expect(res).toEqual({ outcome: 'sent', channel: 'telegram' });
    expect(enqueueOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      externalChatId: 'tg-1',
      dedupKey: 'inperson-confirm:ver-1',
    }));
  });

  it('does not double-send when the link is already in the chat (dedup)', async () => {
    mockQueryOne({ conv: { channel: 'web', external_chat_id: null }, dup: { id: 'old-msg' } });

    const res = await sendInPersonConfirmLinkToConversation({
      conversationId: 'conv-web',
      verificationId: 'ver-1',
      employeeId: 'emp-1',
    });

    expect(res).toEqual({ outcome: 'duplicate', channel: 'web' });
    expect(vi.mocked(db.queryOne).mock.calls.some(([sql]) => normalizeSql(sql).startsWith('INSERT INTO messages'))).toBe(false);
    expect(broadcastToRoom).not.toHaveBeenCalled();
  });

  it('returns no_conversation when the conversation is missing', async () => {
    mockQueryOne({ conv: null });

    const res = await sendInPersonConfirmLinkToConversation({
      conversationId: 'gone',
      verificationId: 'ver-1',
      employeeId: 'emp-1',
    });

    expect(res).toEqual({ outcome: 'no_conversation', channel: null });
    expect(broadcastToRoom).not.toHaveBeenCalled();
  });
});
