/**
 * One-time migration script: Import Telegram chats from old Python bot DB
 * (bitrix_connectors_shared @ localhost:5432) → Managed PG (magnus_photo_db @ YC)
 *
 * Usage: cd backend && npx tsx scripts/import-local-chats.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

// Load .env from backend/
dotenv.config({ path: path.resolve(import.meta.dirname ?? '.', '../.env') });

const { Pool } = pg;

// ── Source: old Python bot DB (localhost) ─────────────────────────
const sourcePool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'bitrix_connectors_shared',
  user: 'magnus_user',
  password: 'magnus_password',
  max: 3,
});

// ── Target: Managed PG (YC) ──────────────────────────────────────
const targetPool = new Pool({
  host: process.env['DB_HOST'] || 'rc1b-ihjtr0uu8m7vgdjb.mdb.yandexcloud.net',
  port: parseInt(process.env['DB_PORT'] || '6432', 10),
  database: process.env['DB_NAME'] || 'magnus_photo_db',
  user: process.env['DB_USER'] || 'magnus_user',
  password: process.env['DB_PASSWORD'] || '',
  ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

// ── Telegram Bot API (for proactive messages) ────────────────────
const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'] || '';

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) { console.log(`  ⚠ No BOT_TOKEN, skip send to ${chatId}`); return false; }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.log(`  ⚠ Telegram API error for ${chatId}: ${resp.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(`  ⚠ Telegram send failed for ${chatId}: ${err}`);
    return false;
  }
}

// ── Map old message types → new ──────────────────────────────────
function mapMessageType(oldType: string): string {
  switch (oldType) {
    case 'text': return 'text';
    case 'photo': case 'image': return 'image';
    case 'document': case 'file': case 'voice': case 'audio': case 'video': return 'file';
    case 'sticker': return 'image';
    default: return 'text';
  }
}

// ── Map sender direction/type ────────────────────────────────────
function mapSenderType(direction: string, sender: string): string {
  if (sender === 'ai_bot') return 'bot';
  if (direction === 'incoming') return 'visitor';
  return 'operator'; // outgoing from CRM operator
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Import Telegram chats: bitrix_connectors_shared → managed PG');
  console.log('═══════════════════════════════════════════════════════\n');

  // Verify connections
  try {
    await sourcePool.query('SELECT 1');
    console.log('✅ Source DB connected (localhost:5432 bitrix_connectors_shared)');
  } catch (err) {
    console.error('❌ Cannot connect to source DB:', err);
    process.exit(1);
  }
  try {
    await targetPool.query('SELECT 1');
    console.log('✅ Target DB connected (Managed PG)');
  } catch (err) {
    console.error('❌ Cannot connect to target DB:', err);
    process.exit(1);
  }

  // ── 1. Load all Telegram chats from source (line_id=13) ────────
  const LINE_ID_TELEGRAM = 13;
  const { rows: srcChats } = await sourcePool.query<{
    id: number;
    external_chat_id: string;
    user_name: string | null;
    status: string;
    last_message_at: number | null;
    created_at: number | null;
    updated_at: number | null;
  }>(`SELECT id, external_chat_id, user_name, status, last_message_at, created_at, updated_at
      FROM chats WHERE line_id = $1 ORDER BY created_at`, [LINE_ID_TELEGRAM]);

  console.log(`\n📊 Source: ${srcChats.length} Telegram chats (line_id=${LINE_ID_TELEGRAM})`);

  // ── 2. Load existing sessions from target (for dedup) ──────────
  const { rows: existingSessions } = await targetPool.query<{
    id: string;
    external_chat_id: string;
  }>(`SELECT id, metadata->>'externalChatId' as external_chat_id
      FROM visitor_chat_sessions WHERE channel = 'telegram'`);

  const existingByExtChatId = new Map<string, string>();
  for (const s of existingSessions) {
    if (s.external_chat_id) existingByExtChatId.set(s.external_chat_id, s.id);
  }
  console.log(`📊 Target: ${existingSessions.length} existing Telegram sessions`);

  // ── 3. Load telegram_users from source for name enrichment ─────
  const { rows: tgUsers } = await sourcePool.query<{
    user_id: string;
    username: string | null;
    full_name: string | null;
    phone: string | null;
  }>('SELECT user_id::text, username, full_name, phone FROM telegram_users');

  const tgUserMap = new Map<string, { username: string | null; full_name: string | null; phone: string | null }>();
  for (const u of tgUsers) {
    tgUserMap.set(u.user_id, u);
  }
  console.log(`📊 telegram_users: ${tgUsers.length} enrichment records`);

  // ── 4. Migrate chats ──────────────────────────────────────────
  let importedSessions = 0;
  let skippedSessions = 0;
  let mergedSessions = 0;
  let importedMessages = 0;
  let failedMessages = 0;
  const openSessionIds: { sessionId: string; externalChatId: string; visitorName: string }[] = [];
  const importedNames: string[] = [];

  for (const chat of srcChats) {
    const extChatId = chat.external_chat_id;
    const visitorId = `telegram:${extChatId}`;
    const tgUser = tgUserMap.get(extChatId);
    const visitorName = chat.user_name || tgUser?.full_name || `Telegram ${extChatId}`;
    const username = tgUser?.username || null;
    const phone = tgUser?.phone || null;

    // ── Load messages for this chat ──────────────────────────────
    const { rows: srcMsgs } = await sourcePool.query<{
      id: string;
      sender: string;
      direction: string;
      content: string;
      type: string;
      metadata: string | null;
      status: string;
      created_at: number | null;
    }>(`SELECT id, sender, direction, content, type, metadata, status, created_at
        FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`, [chat.id]);

    if (srcMsgs.length === 0) {
      skippedSessions++;
      continue;
    }

    // ── Check if session already exists in target ────────────────
    const existingId = existingByExtChatId.get(extChatId);

    let sessionId: string;

    if (existingId) {
      // Merge: import only messages that don't exist yet
      sessionId = existingId;
      mergedSessions++;
    } else {
      // Create new session
      sessionId = randomUUID();

      const createdAt = chat.created_at ? new Date(chat.created_at * 1000) : new Date();
      const lastMessageAt = chat.last_message_at ? new Date(chat.last_message_at * 1000) : createdAt;

      const metadata = JSON.stringify({
        externalChatId: extChatId,
        channel: 'telegram',
        ...(username ? { username } : {}),
      });

      // Determine status: if last message is incoming (visitor), mark as open
      const lastMsg = srcMsgs[srcMsgs.length - 1];
      const lastIsVisitor = lastMsg.direction === 'incoming';
      const status = lastIsVisitor ? 'open' : 'closed';

      try {
        await targetPool.query(
          `INSERT INTO visitor_chat_sessions
            (id, visitor_id, visitor_name, visitor_phone, channel, status, metadata, created_at, updated_at, last_message_at, source)
           VALUES ($1, $2, $3, $4, 'telegram', $5, $6::jsonb, $7, $7, $8, 'migration')
           ON CONFLICT (id) DO NOTHING`,
          [sessionId, visitorId, visitorName, phone, status, metadata, createdAt, lastMessageAt],
        );

        if (status === 'open') {
          openSessionIds.push({ sessionId, externalChatId: extChatId, visitorName });
        }

        importedSessions++;
        importedNames.push(visitorName);
      } catch (err) {
        console.error(`  ❌ Failed to create session for ${visitorName} (${extChatId}):`, err);
        skippedSessions++;
        continue;
      }
    }

    // ── Import messages ──────────────────────────────────────────
    for (const msg of srcMsgs) {
      const msgId = randomUUID();
      const senderType = mapSenderType(msg.direction, msg.sender);
      const messageType = mapMessageType(msg.type);
      const content = msg.content || '[Без текста]';
      const createdAt = msg.created_at ? new Date(msg.created_at * 1000) : new Date();
      const externalMessageId = msg.id; // preserve original ID for dedup

      try {
        await targetPool.query(
          `INSERT INTO visitor_chat_messages
            (id, session_id, sender_type, sender_id, sender_name, message_type, content,
             external_message_id, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
           ON CONFLICT DO NOTHING`,
          [
            msgId,
            sessionId,
            senderType,
            senderType === 'visitor' ? extChatId : (msg.sender === 'ai_bot' ? 'bot' : msg.sender),
            senderType === 'visitor' ? visitorName : (msg.sender === 'ai_bot' ? 'AI Бот' : 'Оператор'),
            messageType,
            content,
            externalMessageId,
            createdAt,
          ],
        );
        importedMessages++;
      } catch (err) {
        failedMessages++;
        // Silently continue — likely constraint violation
      }
    }

    // ── Upsert channel_users ─────────────────────────────────────
    try {
      await targetPool.query(
        `INSERT INTO channel_users (channel, external_user_id, display_name, username, phone)
         VALUES ('telegram', $1, $2, $3, $4)
         ON CONFLICT (channel, external_user_id) DO UPDATE SET
           display_name = COALESCE(EXCLUDED.display_name, channel_users.display_name),
           username = COALESCE(EXCLUDED.username, channel_users.username),
           phone = COALESCE(EXCLUDED.phone, channel_users.phone),
           last_seen_at = NOW()`,
        [extChatId, visitorName, username, phone],
      );
    } catch {
      // non-critical
    }
  }

  // ── 5. Recalculate denormalized counts ─────────────────────────
  console.log('\n🔄 Recalculating message_count / unread_count / last_message...');
  await targetPool.query(`
    UPDATE visitor_chat_sessions s SET
      message_count = sub.cnt,
      unread_count = sub.unread,
      last_message_at = sub.last_at,
      last_message_content = sub.last_content
    FROM (
      SELECT
        m.session_id,
        COUNT(*) as cnt,
        COUNT(*) FILTER (WHERE m.sender_type = 'visitor' AND m.is_read = false) as unread,
        MAX(m.created_at) as last_at,
        (SELECT content FROM visitor_chat_messages WHERE session_id = m.session_id ORDER BY created_at DESC LIMIT 1) as last_content
      FROM visitor_chat_messages m
      JOIN visitor_chat_sessions s2 ON s2.id = m.session_id
      WHERE s2.channel = 'telegram' AND s2.source = 'migration'
      GROUP BY m.session_id
    ) sub
    WHERE s.id = sub.session_id
  `);

  // ── 6. Refresh materialized view ──────────────────────────────
  console.log('🔄 Refreshing crm_inbox_view...');
  try {
    await targetPool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY crm_inbox_view');
    console.log('✅ crm_inbox_view refreshed');
  } catch (err) {
    console.log('⚠ crm_inbox_view refresh failed (may not have UNIQUE index for CONCURRENTLY):', err);
    try {
      await targetPool.query('REFRESH MATERIALIZED VIEW crm_inbox_view');
      console.log('✅ crm_inbox_view refreshed (non-concurrent)');
    } catch {
      console.log('⚠ crm_inbox_view refresh failed completely');
    }
  }

  // ── 7. Send proactive messages to open sessions ────────────────
  console.log(`\n📤 Sending proactive messages to ${openSessionIds.length} open sessions...`);
  let sentCount = 0;
  const proactiveText = 'Здравствуйте! Мы получили ваше обращение. Чем можем помочь?';

  for (const { sessionId, externalChatId, visitorName } of openSessionIds) {
    const ok = await sendTelegramMessage(externalChatId, proactiveText);
    if (ok) {
      // Save as bot message
      await targetPool.query(
        `INSERT INTO visitor_chat_messages
          (id, session_id, sender_type, sender_id, sender_name, message_type, content, is_read, created_at)
         VALUES ($1, $2, 'bot', 'bot', 'Бот', 'text', $3, true, NOW())`,
        [randomUUID(), sessionId, proactiveText],
      );
      sentCount++;
      console.log(`  ✅ Sent to ${visitorName} (${externalChatId})`);
    } else {
      console.log(`  ⚠ Failed for ${visitorName} (${externalChatId})`);
    }
  }

  // ── 8. Report ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Sessions imported:  ${importedSessions}`);
  console.log(`  Sessions merged:    ${mergedSessions}`);
  console.log(`  Sessions skipped:   ${skippedSessions} (no messages)`);
  console.log(`  Messages imported:  ${importedMessages}`);
  console.log(`  Messages failed:    ${failedMessages}`);
  console.log(`  Proactive sent:     ${sentCount}/${openSessionIds.length}`);
  console.log('');

  if (importedNames.length > 0) {
    console.log('  Imported users:');
    for (const name of importedNames.slice(0, 50)) {
      console.log(`    • ${name}`);
    }
    if (importedNames.length > 50) {
      console.log(`    ... and ${importedNames.length - 50} more`);
    }
  }

  if (openSessionIds.length > 0) {
    console.log('\n  Open sessions (awaiting operator reply):');
    for (const { visitorName, externalChatId } of openSessionIds) {
      console.log(`    • ${visitorName} (${externalChatId})`);
    }
  }

  await sourcePool.end();
  await targetPool.end();
  console.log('\n✅ Done. Connections closed.');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
