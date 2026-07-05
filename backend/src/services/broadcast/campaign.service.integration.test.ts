import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * EXECUTABLE test-gate verification (real DB) — NOT a SQL-text comparison.
 *
 * Runs the actual materializeRecipients against magnus_photo_db and asserts the
 * test_mode safety gate holds:
 *   (a) positive: allowed=[temp-contact] → exactly 1 recipient row = that temp contact;
 *   (b) negative: NOBODY outside allowed_contact_ids is materialized (0 non-allowed rows),
 *       even though many other telegram contacts exist ungated.
 *
 * SELF-CONTAINED (P2): the test creates its OWN throwaway contact + open telegram
 * conversation and gates the campaign to it. It does NOT depend on flavrinov (whose
 * suppression/consent state is mutable and was making this test flaky). The temp contact
 * is brand-new, so it is never in marketing_suppressions, and materializeRecipients does
 * NOT require a marketing consent (pressing /start is the audience — see campaign.service
 * §materializeRecipients), so the only gate exercised is allowed_contact_ids + open chat.
 *
 * All temp rows (conversation, contact, campaign, recipients) are cleaned up in afterAll —
 * 0 leaks. FK conversations→contacts is ON DELETE RESTRICT, so order matters (conv first).
 *
 * If the DB is unreachable (e.g. isolated CI without PG), the suite skips rather than
 * failing — the gate is environment-dependent by design.
 */

// NOTE: deliberately NO `vi.mock('../../database/db.js')` here — this hits the real DB.
import db from '../../database/db.js';
import { materializeRecipients } from './campaign.service.js';

let dbAvailable = false;
let campaignId = '';
let contactId = '';
let conversationId = '';

// A unique, valid-looking telegram chat id for the temp conversation (no collision with reality).
const TEMP_CHAT_ID = `vitest-gate-${Date.now()}`;

beforeAll(async () => {
  try {
    await db.query('SELECT 1');
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  // Order: recipients → campaign, then conversation → contact (FK ON DELETE RESTRICT).
  if (campaignId) {
    await db.query(`DELETE FROM campaign_recipients WHERE campaign_id = $1`, [campaignId]).catch(() => undefined);
    await db.query(`DELETE FROM marketing_campaigns WHERE id = $1`, [campaignId]).catch(() => undefined);
  }
  if (conversationId) {
    await db.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]).catch(() => undefined);
  }
  if (contactId) {
    await db.query(`DELETE FROM contacts WHERE id = $1`, [contactId]).catch(() => undefined);
  }
});

interface IdRow { id: string }
interface CountRow { cnt: number }
interface RecipientRow { contact_id: string; status: string }

describe('materializeRecipients — live test-gate (self-contained temp contact)', () => {
  it('materializes ONLY the gated temp contact, and nobody outside allowed_contact_ids', async () => {
    if (!dbAvailable) {
      console.warn('[integration] DB unreachable — skipping live test-gate');
      return;
    }

    // Sanity: there is a real ungated audience (so "only 1" is meaningful, not "only 1 exists").
    const audience = await db.queryOne<CountRow>(
      `SELECT count(DISTINCT c.id)::int AS cnt
       FROM contacts c
       JOIN conversations conv ON conv.contact_id = c.id AND conv.channel = 'telegram'
         AND conv.external_chat_id IS NOT NULL AND conv.status <> 'closed'
       WHERE c.deleted_at IS NULL`,
    );
    expect((audience?.cnt ?? 0)).toBeGreaterThan(1); // many TG contacts exist ungated

    // ── Temp fixture: a brand-new contact with an open telegram conversation. ──
    const contact = await db.queryOne<IdRow>(
      `INSERT INTO contacts (display_name, source) VALUES ('TEMP vitest-gate', 'vitest-gate') RETURNING id`,
    );
    contactId = contact!.id;

    const conv = await db.queryOne<IdRow>(
      `INSERT INTO conversations (channel, contact_id, external_chat_id, status, source, last_message_at)
       VALUES ('telegram'::channel_type, $1, $2, 'open', 'vitest-gate', now())
       RETURNING id`,
      [contactId, TEMP_CHAT_ID],
    );
    conversationId = conv!.id;

    // Temp campaign: test_mode=true, allow ONLY the temp contact.
    const camp = await db.queryOne<IdRow>(
      `INSERT INTO marketing_campaigns
         (name, campaign_type, channel, status, test_mode, allowed_contact_ids,
          utm_source, utm_medium, utm_campaign, broadcast_payload)
       VALUES ('TEMP vitest-gate', 'messenger', 'telegram', 'draft', true, $1::uuid[],
               'telegram', 'bot', 'vitest-gate', $2::jsonb)
       RETURNING id`,
      [[contactId], JSON.stringify({ text: 'тест', mediaUrl: 'https://svoefoto.ru/x.jpg' })],
    );
    campaignId = camp!.id;

    // EXECUTE the real materialization.
    const res = await materializeRecipients(campaignId);

    // (a) positive: exactly 1 dispatchable row, and it is the temp contact.
    expect(res.inserted).toBe(1);

    const rows = await db.query<RecipientRow>(
      `SELECT contact_id::text AS contact_id, status FROM campaign_recipients WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_id).toBe(contactId);
    expect(rows[0].status).toBe('queued');

    // (b) negative: NOBODY outside allowed_contact_ids materialized — 0 non-temp rows,
    // despite the large ungated audience.
    const nonAllowed = rows.filter((r) => r.contact_id !== contactId);
    expect(nonAllowed).toHaveLength(0);
  });
});
