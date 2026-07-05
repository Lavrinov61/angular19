/**
 * conversation-adapter.ts — Thin adapter layer for bot engine ↔ conversations/messages tables.
 *
 * Phase 6 of Omnichannel v2 migration.
 * Centralizes all DB operations that chat-bot-engine.ts needs, replacing
 * inline SQL against legacy visitor_chat_sessions / visitor_chat_messages.
 *
 * Each function maps 1:1 to a future Rust trait method.
 */

import db from '../../database/db.js';
import type {
  ConversationFullRow,
  MessageFullRow,
  MessageHistoryPage,
  ConversationsListResult,
  ResolvedId,
} from '../../types/views/chat-views.js';

/**
 * JSONB metadata from PostgreSQL — inherently dynamic.
 * Values can be primitives, nested objects, or arrays.
 * Runtime checks in bot engine handle shape validation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonbRecord = Record<string, any>;

// ─── Conversation (replaces visitor_chat_sessions) ──────────────────────────

/**
 * Merge JSONB data into conversation metadata (||).
 * Pattern: UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
 */
export async function mergeMetadata(
  conversationId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(data), conversationId],
  );
}

/**
 * Remove specific keys from conversation metadata.
 * Uses parameterized text[] to avoid SQL injection.
 */
export async function removeMetadataKeys(
  conversationId: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await db.query(
    `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - $2::text[], updated_at = NOW() WHERE id = $1`,
    [conversationId, keys],
  );
}

/**
 * Remove keys AND merge new data in one statement.
 * Uses parameterized text[] for key removal to avoid SQL injection.
 */
export async function removeKeysAndMerge(
  conversationId: string,
  keysToRemove: string[],
  dataToMerge: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE conversations SET metadata = (COALESCE(metadata, '{}'::jsonb) - $3::text[]) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(dataToMerge), conversationId, keysToRemove],
  );
}

/** SELECT metadata FROM conversations */
export async function getMetadata(
  conversationId: string,
): Promise<JsonbRecord> {
  const row = await db.queryOne<{ metadata: JsonbRecord }>(
    `SELECT metadata FROM conversations WHERE id = $1`,
    [conversationId],
  );
  return row?.metadata ?? {};
}

/** SELECT metadata + phone from contacts (SSOT), fallback visitor_phone */
export async function getMetadataAndPhone(
  conversationId: string,
): Promise<{ metadata: JsonbRecord; visitor_phone: string | null }> {
  const row = await db.queryOne<{
    metadata: JsonbRecord;
    visitor_phone: string | null;
    contact_phone: string | null;
  }>(
    `SELECT c.metadata, c.visitor_phone, ct.phone AS contact_phone
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [conversationId],
  );
  return {
    metadata: row?.metadata ?? {},
    visitor_phone: row?.contact_phone || row?.visitor_phone || null,
  };
}

/** SELECT channel, entry_context FROM conversations */
export async function getChannelAndEntryContext(
  conversationId: string,
): Promise<{ channel: string | null; entry_context: JsonbRecord | null }> {
  const row = await db.queryOne<{ channel: string; entry_context: JsonbRecord }>(
    `SELECT channel, entry_context FROM conversations WHERE id = $1`,
    [conversationId],
  );
  return { channel: row?.channel ?? null, entry_context: row?.entry_context ?? null };
}

/** UPDATE contact phone + merge conversation metadata.
 *  Phone is written to contacts (SSOT) only. */
export async function updatePhoneAndMetadata(
  conversationId: string,
  phone: string,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  const metaMerge = extraMetadata ? JSON.stringify(extraMetadata) : '{"phoneAsked": true}';
  // Write phone to contacts (SSOT) — only if contact has no phone yet to respect UNIQUE
  await db.query(
    `UPDATE contacts SET phone = $1, updated_at = NOW()
     WHERE id = (SELECT contact_id FROM conversations WHERE id = $2)
       AND (phone IS NULL OR phone = '')`,
    [phone, conversationId],
  );
  // Merge metadata into conversation
  await db.query(
    `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [metaMerge, conversationId],
  );
}

/** Replace conversation context with a new JSONB object */
export async function resetContext(
  conversationId: string,
  context: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE conversations SET context = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(context), conversationId],
  );
}

// ─── Messages (replaces visitor_chat_messages) ──────────────────────────────

/** Count visitor photos (image messages) in a conversation */
export async function countVisitorPhotos(conversationId: string): Promise<number> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
    [conversationId],
  );
  return parseInt(row?.cnt ?? '0', 10);
}

/**
 * Get recent bot message metadata (for extracting button data from previous steps).
 * Returns metadata JSONB array from the N most recent bot messages.
 */
export async function getRecentBotMetadata(
  conversationId: string,
  limit = 3,
): Promise<JsonbRecord[]> {
  const rows = await db.query<{ metadata: JsonbRecord }>(
    `SELECT metadata FROM messages
     WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
     ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit],
  );
  return rows.map(r => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata));
}

/** Update content of the last visitor message (for text normalization) */
export async function updateLastVisitorContent(
  conversationId: string,
  content: string,
): Promise<void> {
  await db.query(
    `UPDATE messages SET content = $1
     WHERE id = (SELECT id FROM messages WHERE conversation_id = $2 AND sender_type = 'visitor' ORDER BY created_at DESC LIMIT 1)`,
    [content, conversationId],
  );
}

/** Get the last bot message step (interactive.step from metadata) */
export async function getLastBotStep(conversationId: string): Promise<string | null> {
  const row = await db.queryOne<{ metadata: JsonbRecord }>(
    `SELECT metadata FROM messages
     WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  if (!row) return null;
  try {
    const meta: JsonbRecord = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    const step = (meta?.['interactive'] as Record<string, unknown> | undefined)?.['step'];
    return typeof step === 'string' ? step : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 (v1→v2 migration) — additional adapter functions
// ═══════════════════════════════════════════════════════════════════════════

/** Resolve conversation ID — supports legacy session IDs via PG function. */
export async function resolveConversationId(id: string): Promise<string | null> {
  const row = await db.queryOne<ResolvedId>(
    `SELECT resolve_conversation_id($1) AS id`,
    [id],
  );
  return row?.id ?? null;
}


/** Insert a message (replaces INSERT INTO visitor_chat_messages). */
export async function insertMessage(
  conversationId: string,
  data: {
    senderType: string;
    senderId?: string;
    senderName?: string;
    content: string;
    messageType?: string;
    attachmentUrl?: string;
    metadata?: Record<string, unknown>;
    clientMessageId?: string;
  },
): Promise<{ id: string; created_at: string }> {
  const row = await db.queryOne<{ id: string; created_at: string }>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_id, sender_name,
        content, message_type, attachment_url, metadata, client_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at::text AS created_at`,
    [
      conversationId,
      data.senderType,
      data.senderId ?? null,
      data.senderName ?? null,
      data.content,
      data.messageType ?? 'text',
      data.attachmentUrl ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.clientMessageId ?? null,
    ],
  );

  return { id: row!.id, created_at: row!.created_at };
}

/** Get conversation by ID with resolve (falls back to legacy_session_id). */
export async function getConversationById(id: string): Promise<ConversationFullRow | null> {
  // First try direct UUID lookup
  const direct = await db.queryOne<ConversationFullRow>(
    `SELECT id, channel, account_id, external_chat_id, contact_id,
            user_id, visitor_id, visitor_name, visitor_phone, visitor_email,
            status, assigned_operator_id, source, message_count, unread_count,
            last_message_content, last_message_at, first_response_at,
            context, metadata, created_at, updated_at, closed_at,
            legacy_session_id, entry_context
     FROM conversations WHERE id = $1`,
    [id],
  );
  if (direct) return direct;

  // Fallback: resolve via legacy_session_id
  const resolved = await resolveConversationId(id);
  if (!resolved) return null;

  return db.queryOne<ConversationFullRow>(
    `SELECT id, channel, account_id, external_chat_id, contact_id,
            user_id, visitor_id, visitor_name, visitor_phone, visitor_email,
            status, assigned_operator_id, source, message_count, unread_count,
            last_message_content, last_message_at, first_response_at,
            context, metadata, created_at, updated_at, closed_at,
            legacy_session_id, entry_context
     FROM conversations WHERE id = $1`,
    [resolved],
  );
}

/** Get message history with cursor-based pagination. */
export async function getMessageHistory(
  conversationId: string,
  opts: {
    limit?: number;
    before?: string;
    after?: string;
  },
): Promise<MessageHistoryPage> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const params: unknown[] = [conversationId, limit + 1];
  let whereExtra = '';
  let orderDir = 'DESC';

  if (opts.before) {
    whereExtra = `AND m.created_at < $3`;
    params.push(opts.before);
  } else if (opts.after) {
    whereExtra = `AND m.created_at > $3`;
    orderDir = 'ASC';
    params.push(opts.after);
  }

  const rows = await db.query<MessageFullRow>(
    `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.sender_name,
            m.message_type, m.content, m.external_message_id, m.client_message_id,
            m.is_read, m.delivery_status, m.created_at, m.metadata,
            m.attachment_url
     FROM messages m
     WHERE m.conversation_id = $1 AND m.deleted_at IS NULL ${whereExtra}
     ORDER BY m.created_at ${orderDir}
     LIMIT $2`,
    params,
  );

  // Determine if there are more messages
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  // If we fetched in ASC order, reverse for consistent DESC output
  if (orderDir === 'ASC') rows.reverse();

  // Total count (cached via CTE for efficiency)
  const totalRow = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL`,
    [conversationId],
  );
  const total = parseInt(totalRow?.cnt ?? '0', 10);

  return {
    messages: rows,
    hasOlder: opts.before ? hasMore : (opts.after ? true : hasMore),
    hasNewer: opts.after ? hasMore : (opts.before ? true : false),
    total,
  };
}

/** Update conversation fields.
 *  visitorName/visitorPhone write to contacts (SSOT) only. */
export async function updateConversation(
  id: string,
  fields: Partial<{
    status: string;
    assignedOperatorId: string | null;
    visitorName: string;
    visitorPhone: string;
    metadata: Record<string, unknown>;
    closedAt: string;
  }>,
): Promise<void> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (fields.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    params.push(fields.status);
  }
  if (fields.assignedOperatorId !== undefined) {
    setClauses.push(`assigned_operator_id = $${paramIdx++}`);
    params.push(fields.assignedOperatorId);
  }
  if (fields.metadata !== undefined) {
    setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIdx++}::jsonb`);
    params.push(JSON.stringify(fields.metadata));
  }
  if (fields.closedAt !== undefined) {
    setClauses.push(`closed_at = $${paramIdx++}`);
    params.push(fields.closedAt);
  }

  params.push(id);
  await db.query(
    `UPDATE conversations SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    params,
  );

  // Write name/phone to contacts (SSOT)
  if (fields.visitorName !== undefined) {
    await db.query(
      `UPDATE contacts SET display_name = $1, updated_at = NOW()
       WHERE id = (SELECT contact_id FROM conversations WHERE id = $2)`,
      [fields.visitorName, id],
    );
  }
  if (fields.visitorPhone !== undefined) {
    await db.query(
      `UPDATE contacts SET phone = $1, updated_at = NOW()
       WHERE id = (SELECT contact_id FROM conversations WHERE id = $2)
         AND (phone IS NULL OR phone = '')`,
      [fields.visitorPhone, id],
    );
  }
}

/** Get conversations list (for admin/inbox). Search queries contacts (SSOT). */
export async function getConversationsList(opts: {
  status?: string[];
  channel?: string;
  assignedOperatorId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ConversationsListResult> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;
  let needContactJoin = false;

  if (opts.status && opts.status.length > 0) {
    conditions.push(`c.status = ANY($${paramIdx++})`);
    params.push(opts.status);
  }
  if (opts.channel) {
    conditions.push(`c.channel = $${paramIdx++}`);
    params.push(opts.channel);
  }
  if (opts.assignedOperatorId) {
    conditions.push(`c.assigned_operator_id = $${paramIdx++}`);
    params.push(opts.assignedOperatorId);
  }
  if (opts.search) {
    needContactJoin = true;
    conditions.push(
      `(ct.display_name ILIKE $${paramIdx} OR ct.phone ILIKE $${paramIdx} OR c.visitor_name ILIKE $${paramIdx} OR c.visitor_phone ILIKE $${paramIdx})`,
    );
    params.push(`%${opts.search}%`);
    paramIdx++;
  }

  const contactJoin = needContactJoin ? 'LEFT JOIN contacts ct ON ct.id = c.contact_id' : '';
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRow = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM conversations c ${contactJoin} ${whereClause}`,
    params,
  );
  const total = parseInt(countRow?.cnt ?? '0', 10);

  // Fetch page
  params.push(limit, offset);
  const rows = await db.query<ConversationFullRow>(
    `SELECT c.id, c.channel, c.account_id, c.external_chat_id, c.contact_id,
            c.user_id, c.visitor_id, c.visitor_name, c.visitor_phone, c.visitor_email,
            c.status, c.assigned_operator_id, c.source, c.message_count, c.unread_count,
            c.last_message_content, c.last_message_at, c.first_response_at,
            c.context, c.metadata, c.created_at, c.updated_at, c.closed_at,
            c.legacy_session_id, c.entry_context
     FROM conversations c
     ${contactJoin}
     ${whereClause}
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    params,
  );

  return { conversations: rows, total };
}

/** Mark messages as read. Returns count of updated rows. */
export async function markMessagesRead(
  conversationId: string,
  messageIds: string[],
): Promise<number> {
  if (messageIds.length === 0) return 0;

  const rows = await db.query<{ id: string }>(
    `UPDATE messages
     SET is_read = true, read_at = COALESCE(read_at, NOW())
     WHERE conversation_id = $1 AND id = ANY($2) AND is_read = false
     RETURNING id`,
    [conversationId, messageIds],
  );
  return rows.length;
}

/** Get unread count for a conversation. */
export async function getUnreadCount(conversationId: string): Promise<number> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM messages
     WHERE conversation_id = $1 AND sender_type = 'visitor' AND is_read = false AND deleted_at IS NULL`,
    [conversationId],
  );
  return parseInt(row?.cnt ?? '0', 10);
}

/** Add a tag to a conversation. */
export async function addTag(conversationId: string, tag: string): Promise<void> {
  await db.query(
    `INSERT INTO conversation_tags (conversation_id, tag)
     VALUES ($1, $2)
     ON CONFLICT (conversation_id, tag) DO NOTHING`,
    [conversationId, tag],
  );
}

/** Remove a tag from a conversation. */
export async function removeTag(conversationId: string, tag: string): Promise<void> {
  await db.query(
    `DELETE FROM conversation_tags WHERE conversation_id = $1 AND tag = $2`,
    [conversationId, tag],
  );
}

/** Get all tags for a conversation. */
export async function getTags(conversationId: string): Promise<string[]> {
  const rows = await db.query<{ tag: string }>(
    `SELECT tag FROM conversation_tags WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return rows.map(r => r.tag);
}
