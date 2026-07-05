/**
 * backfill-vk-names.ts — Resolve "VK User {id}" placeholders to real names
 *
 * Usage: cd backend && npx tsx scripts/backfill-vk-names.ts
 *
 * Finds channel_users with placeholder display_name, resolves via VK API,
 * then updates channel_users, conversations, messages, and contacts.
 */

import db from '../src/database/db.js';
import { resolveVkUserName } from '../src/services/connectors/vk/vk.user-cache.js';

const RATE_LIMIT_DELAY = 340; // ~3 req/sec

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfill(): Promise<void> {
  // Get VK group token from active channel account
  const account = await db.queryOne<{ credentials: { groupToken?: string } }>(
    `SELECT credentials FROM channel_accounts WHERE channel = 'vk' AND is_active = true LIMIT 1`,
    [],
  );
  if (!account?.credentials?.groupToken) {
    console.error('[VK-Backfill] No active VK channel account with groupToken found');
    process.exit(1);
  }
  const groupToken = account.credentials.groupToken;

  // Find placeholder names
  const rows = await db.query<{ external_user_id: string }>(
    `SELECT DISTINCT external_user_id FROM channel_users
     WHERE channel = 'vk' AND display_name ~ '^VK User \\d+$'`,
    [],
  );

  console.log(`[VK-Backfill] Found ${rows.length} users to resolve`);

  let resolved = 0;
  let failed = 0;

  for (const row of rows) {
    const userId = Number(row.external_user_id);
    if (isNaN(userId)) {
      failed++;
      continue;
    }

    try {
      const name = await resolveVkUserName(userId, groupToken);
      if (name === `VK User ${userId}`) {
        // API returned fallback — user may be deactivated
        failed++;
        continue;
      }

      // Update channel_users
      await db.query(
        `UPDATE channel_users SET display_name = $1, last_seen_at = NOW()
         WHERE channel = 'vk' AND external_user_id = $2`,
        [name, row.external_user_id],
      );

      // Update conversations
      await db.query(
        `UPDATE conversations SET visitor_name = $1
         WHERE channel = 'vk' AND external_chat_id = $2 AND visitor_name ~ '^VK User \\d+$'`,
        [name, row.external_user_id],
      );

      // Update messages
      await db.query(
        `UPDATE messages SET sender_name = $1
         WHERE conversation_id IN (
           SELECT id FROM conversations WHERE channel = 'vk' AND external_chat_id = $2
         ) AND sender_name ~ '^VK User \\d+$'`,
        [name, row.external_user_id],
      );

      // Update contacts
      await db.query(
        `UPDATE contacts SET display_name = $1
         WHERE id IN (
           SELECT contact_id FROM channel_users
           WHERE channel = 'vk' AND external_user_id = $2 AND contact_id IS NOT NULL
         ) AND display_name ~ '^VK User \\d+$'`,
        [name, row.external_user_id],
      );

      resolved++;
      console.log(`[VK-Backfill] ${resolved}/${rows.length} ${row.external_user_id} → ${name}`);
    } catch (err) {
      failed++;
      console.error(`[VK-Backfill] Failed for ${row.external_user_id}: ${String(err)}`);
    }

    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`[VK-Backfill] Done: ${resolved} resolved, ${failed} failed/skipped`);
  process.exit(0);
}

backfill().catch(err => {
  console.error('[VK-Backfill] Fatal:', err);
  process.exit(1);
});
