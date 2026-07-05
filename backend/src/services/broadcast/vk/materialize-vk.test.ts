import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the VK-specific shape of materializeRecipients + buildAudienceWhere (S4).
 *
 * Kept in its own file (not folded into campaign.service.segments.test.ts) so it doesn't
 * collide with the MAX-session tests on the shared service. DB is mocked with a SQL-text
 * router; we capture the two INSERT passes inside the transaction and assert the VK fragments.
 *
 * Load-bearing properties (architecture Review responses):
 *  - P0-1 anti-dup-per-peer: VK pass-1 uses DISTINCT ON (conv.external_chat_id) so two
 *    contacts on one peer collapse to ONE queued row, and ON CONFLICT DO NOTHING absorbs the
 *    uq_recipient_vk_peer backstop.
 *  - opt-in gate: VK pass-1 EXISTS(channel_users … opted_in = true AND opted_out_at IS NULL)
 *    excludes opted_in=false peers; the pass-2 funnel records them as skipped/not_opted_in.
 *  - test_mode: the (NOT mc.test_mode OR c.id = ANY(allowed_contact_ids)) gate is kept, so a
 *    test_mode VK campaign with allowed_contact_ids=[flavrinov] fans out to exactly 1 peer.
 *  - TG IMMUTABILITY: for channel='telegram', NEITHER buildAudienceWhere NOR materialize
 *    contains the channel_users opt-in fragment or DISTINCT ON — the TG SQL is unchanged.
 */

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;
type QueryOneFn = (sql: string, params?: unknown[]) => Promise<unknown>;

const { mockQuery, mockQueryOne, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn<QueryFn>().mockResolvedValue([]),
  mockQueryOne: vi.fn<QueryOneFn>().mockResolvedValue(null),
  mockTransaction: vi.fn(),
}));

vi.mock('../../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne, transaction: mockTransaction },
}));
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../broadcast-governor.js', () => ({ pauseBot: vi.fn(), isBotPaused: vi.fn(), getBotPauseMs: vi.fn() }));
vi.mock('../../connectors/core/account-store.js', () => ({ getAccountByChannel: vi.fn() }));
vi.mock('../../connectors/core/adapter-registry.js', () => ({ getAdapterOrThrow: vi.fn() }));

const { previewAudience, materializeRecipients } = await import('../campaign.service.js');

const FLAVRINOV = '42c8f423-7f12-4d05-963a-095740a47a32';

/**
 * Capture every client.query call in the transaction so we can inspect the two INSERT passes.
 * `inserted` controls how many rows pass-1 reports (rowCount), letting us assert dedup counts.
 */
function runMaterialize(opts: {
  audienceFilter: unknown;
  testMode?: boolean;
  allowed?: string[] | null;
  pass1Inserted?: number;
}): Promise<{
  result: Awaited<ReturnType<typeof materializeRecipients>>;
  pass1: { sql: string; params: unknown[] };
  pass2: { sql: string; params: unknown[] };
}> {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let insertSeen = 0;
  mockTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] });
        if (sql.includes('SELECT id, test_mode, allowed_contact_ids')) {
          return {
            rows: [{
              id: 'camp-vk', test_mode: opts.testMode ?? false,
              allowed_contact_ids: opts.allowed ?? null,
              utm_source: 'vk', utm_medium: 'group', utm_campaign: 'edu-vk',
              broadcast_payload: { text: 'hi', mediaUrl: 'https://cdn/x.jpg' },
              audience_filter: opts.audienceFilter,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO campaign_recipients')) {
          insertSeen += 1;
          // pass-1 = first INSERT → report the dispatchable count; pass-2 → exclusions (0 here).
          return { rows: [], rowCount: insertSeen === 1 ? (opts.pass1Inserted ?? 1) : 0 };
        }
        if (sql.includes('GROUP BY status')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
    };
    return fn(client);
  });

  return materializeRecipients('camp-vk').then((result) => {
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO campaign_recipients'));
    return { result, pass1: inserts[0], pass2: inserts[1] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryOne.mockResolvedValue(null);
});

// ─── VK opt-in gate + per-peer dedup (P0-1) ──────────────────────────────────

describe('materializeRecipients — VK channel', () => {
  it('pass-1 applies the opt-in gate (channel_users, opted_in=true, opted_out_at IS NULL)', async () => {
    const { pass1 } = await runMaterialize({ audienceFilter: { channel: 'vk' } });

    expect(pass1.sql).toContain('channel_users cu');
    expect(pass1.sql).toContain('cu.opted_in = true');
    expect(pass1.sql).toContain('cu.opted_out_at IS NULL');
    // matched strictly on the chosen LATERAL peer (P1-3), not "any dialog of the contact".
    expect(pass1.sql).toContain('cu.external_user_id = conv.external_chat_id');
    // channel param ($4) is the VK channel.
    expect(pass1.params[3]).toBe('vk');
  });

  it('P0-1: pass-1 dedups per peer (DISTINCT ON external_chat_id) + ON CONFLICT DO NOTHING', async () => {
    // Two contacts on one peer → DISTINCT ON collapses to ONE queued row; the unique peer
    // index (uq_recipient_vk_peer) is absorbed by ON CONFLICT DO NOTHING. We assert the SQL
    // SHAPE that guarantees "2 contacts on 1 peer → exactly 1 queued".
    const { pass1 } = await runMaterialize({ audienceFilter: { channel: 'vk' } });

    expect(pass1.sql).toContain('DISTINCT ON (conv.external_chat_id)');
    expect(pass1.sql).toContain('ORDER BY conv.external_chat_id, c.id'); // deterministic pick
    expect(pass1.sql).toContain('ON CONFLICT'); // peer/contact unique backstop absorbed
    expect(pass1.sql).toContain('DO NOTHING');
  });

  it('pass-2 records opted-out/never-opted-in peers as a reportable exclusion (not_opted_in)', async () => {
    const { pass2 } = await runMaterialize({ audienceFilter: { channel: 'vk' } });

    // VK pass-2 funnel: a contact with a chat but NOT opted in → skipped / not_opted_in.
    expect(pass2.sql).toContain("'not_opted_in'");
    expect(pass2.sql).toContain('channel_users cu');
    // VK pass-2 uses the bare conflict clause (absorbs both the peer index AND contact index).
    expect(pass2.sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('test_mode keeps the gate so allowed_contact_ids=[flavrinov] fans out to exactly 1 peer', async () => {
    const { result, pass1 } = await runMaterialize({
      audienceFilter: { channel: 'vk' },
      testMode: true,
      allowed: [FLAVRINOV],
      pass1Inserted: 1, // the DB (with the gate) inserts exactly the one allowed contact
    });

    expect(pass1.sql).toContain('NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids)');
    expect(result.inserted).toBe(1);
  });
});

// ─── TG immutability (the inviolable regression guard) ───────────────────────

describe('TG immutability — VK fragments must NOT leak into telegram SQL', () => {
  it('materialize for channel=telegram has NO channel_users opt-in fragment and NO DISTINCT ON', async () => {
    const { pass1, pass2 } = await runMaterialize({ audienceFilter: { channel: 'telegram' } });

    expect(pass1.sql).not.toContain('channel_users');
    expect(pass1.sql).not.toContain('DISTINCT ON');
    expect(pass1.sql).not.toContain('opted_in');
    // TG keeps the targeted contact-pair conflict (not the bare VK one).
    expect(pass1.sql).toContain('ON CONFLICT (campaign_id, contact_id) DO NOTHING');
    // pass-2 funnel for TG has no opt-in concept: no channel_users probe and the VK
    // not-opted-in predicate collapses to the literal `false` (the 'not_opted_in' CASE label
    // is dead code on TG — never reachable because the predicate is false).
    expect(pass2.sql).not.toContain('channel_users');
    expect(pass2.sql).toContain('OR false'); // vkNotOptedIn predicate is `false` for telegram
    expect(pass2.sql).toContain('ON CONFLICT (campaign_id, contact_id) DO NOTHING'); // targeted, not bare
  });

  it('NULL filter → legacy all-telegram is also free of VK fragments', async () => {
    const { pass1 } = await runMaterialize({ audienceFilter: null });

    expect(pass1.params[3]).toBe('telegram');
    expect(pass1.sql).not.toContain('channel_users');
    expect(pass1.sql).not.toContain('DISTINCT ON');
  });

  it('buildAudienceWhere (via previewAudience) opt-in fragment is VK-only', async () => {
    let vkSql = '';
    let tgSql = '';
    mockQueryOne.mockImplementation(async (q: string) => {
      if (q.includes('channel_users')) vkSql = q; else tgSql = q;
      return { cnt: 1 };
    });

    await previewAudience({ channel: 'vk' });
    await previewAudience({ channel: 'telegram' });

    // VK preview carries the opt-in EXISTS; telegram preview does NOT (byte-for-byte unchanged).
    expect(vkSql).toContain('channel_users cu');
    expect(vkSql).toContain('cu.opted_in = true');
    expect(tgSql).not.toContain('channel_users');
  });
});
