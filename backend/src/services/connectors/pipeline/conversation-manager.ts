/**
 * Omnichannel v2 — Conversation Manager
 *
 * Find/create conversations in the `conversations` table (v2).
 * Manages lifecycle, denormalized counters, and operator assignment.
 *
 * Replaces inline session find/create logic from inbound-pipeline.ts.
 */

import db from '../../../database/db.js';
import type { ChannelType, ChannelAccount } from '../core/types.js';
import type { ParsedMessage } from '../core/dto.js';
import { createLogger } from '../../../utils/logger.js';
import { enqueueCrmEvent } from '../../crm-event-queue.service.js';

const log = createLogger('conversation-manager');

// ─── Row types ────────────────────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  channel: ChannelType;
  account_id: string | null;
  external_chat_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  visitor_id: string | null;
  visitor_name: string | null;
  visitor_phone: string | null;
  visitor_email: string | null;
  status: ConversationStatus;
  assigned_operator_id: string | null;
  source: string;
  message_count: number;
  unread_count: number;
  last_message_content: string | null;
  last_message_at: string | null;
  first_response_at: string | null;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  legacy_session_id: string | null;
  auto_reply_sent: boolean;
}

export type ConversationStatus = 'open' | 'waiting' | 'active' | 'resolved' | 'closed';

export interface FindOrCreateResult {
  conversationId: string;
  isNew: boolean;
  reopened: boolean;
  conversation: ConversationRow;
}

// ─── Find or Create ───────────────────────────────────────────────────────────

/**
 * Find an existing open conversation or create a new one.
 *
 * Lookup: channel + externalChatId with status NOT IN ('closed').
 * On new: inserts with visitor_id = `{channel}:{externalUserId}`.
 */
export async function findOrCreateConversation(
  channel: ChannelType,
  account: ChannelAccount,
  msg: ParsedMessage,
  contactId?: string,
): Promise<FindOrCreateResult> {
  // 1. Try to find existing conversation (including recently closed <7d)
  const existing = await db.queryOne<ConversationRow>(
    `SELECT * FROM conversations
     WHERE channel = $1 AND external_chat_id = $2
       AND (status NOT IN ('closed')
            OR (status = 'closed' AND updated_at > NOW() - INTERVAL '7 days'))
     ORDER BY created_at DESC LIMIT 1`,
    [channel, msg.externalChatId],
  );

  if (existing) {
    // Reopen resolved or recently-closed conversation when client sends a new message
    const previousStatus = existing.status;
    const reopened = previousStatus === 'resolved' || previousStatus === 'closed';
    if (reopened) {
      await db.query(
        `UPDATE conversations SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [existing.id],
      );
      existing.status = 'active';
      log.info('conversation reopened by new message', { conversationId: existing.id, channel, previousStatus });

      enqueueCrmEvent('chat', existing.id, 'conversation_reopened', {
        client_name: existing.visitor_name,
        client_phone: existing.visitor_phone,
        preview: 'Клиент вернулся',
        status: 'active',
        priority: 1,
        sort_time: new Date().toISOString(),
        channel,
        assigned_to: existing.assigned_operator_id,
        assigned_to_name: null,
        unread: true,
        metadata: { reopened: true },
      }).catch(err => log.warn('enqueueCrmEvent reopened failed', { error: String(err) }));
    }

    return { conversationId: existing.id, isNew: false, reopened, conversation: existing };
  }

  // 2. Create new conversation
  const visitorId = `${channel}:${msg.externalUserId}`;
  const metadata: Record<string, string> = {
    externalChatId: msg.externalChatId,
    channel,
  };
  if (msg.phone) metadata['phone'] = msg.phone;
  if (msg.username) metadata['username'] = msg.username;

  const newConv = await db.queryOne<ConversationRow>(
    `INSERT INTO conversations
      (channel, account_id, external_chat_id, visitor_id, visitor_name,
       visitor_phone, status, source, metadata, contact_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
     RETURNING *`,
    [
      channel,
      account.id,
      msg.externalChatId,
      visitorId,
      msg.userName,
      msg.phone || null,
      channel === 'web' ? 'web' : channel,
      JSON.stringify(metadata),
      contactId || null,
    ],
  );

  log.info('conversation created', {
    conversationId: newConv!.id,
    channel,
    externalChatId: msg.externalChatId,
    visitorName: msg.userName,
  });

  // CRM inbox: add new chat item
  enqueueCrmEvent('chat', newConv!.id, 'conversation_created', {
    client_name: msg.userName,
    client_phone: msg.phone || null,
    preview: 'Новый разговор',
    status: 'open',
    priority: 1,
    sort_time: newConv!.created_at,
    channel: channel,
    assigned_to: null,
    assigned_to_name: null,
    unread: true,
    metadata: { messageCount: 0, channel, createdAt: newConv!.created_at },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  return { conversationId: newConv!.id, isNew: true, reopened: false, conversation: newConv! };
}

// ─── Counter Updates ──────────────────────────────────────────────────────────

/**
 * Update denormalized counters after a new message is inserted.
 * Called by inbound-worker after INSERT messages.
 */
export async function updateConversationOnMessage(
  conversationId: string,
  content: string,
  senderType: 'visitor' | 'operator' | 'bot' | 'system',
): Promise<void> {
  const isVisitor = senderType === 'visitor';
  await db.query(
    `UPDATE conversations SET
       message_count = message_count + 1,
       unread_count = CASE WHEN $3 THEN unread_count + 1 ELSE unread_count END,
       last_message_content = LEFT($2, 200),
       last_message_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId, content, isVisitor],
  );
}

/**
 * Record first operator response time for SLA tracking.
 */
export async function recordFirstResponse(conversationId: string): Promise<void> {
  await db.query(
    `UPDATE conversations SET
       first_response_at = COALESCE(first_response_at, NOW()),
       status = 'active',
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId],
  );
}

/**
 * Mark all messages as read (operator viewed the conversation).
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  await db.query(
    `UPDATE conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1`,
    [conversationId],
  );
}

/**
 * Assign an operator to a conversation.
 */
export async function assignOperator(
  conversationId: string,
  operatorId: string,
): Promise<void> {
  await db.query(
    `UPDATE conversations SET
       assigned_operator_id = $2,
       status = 'active',
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId, operatorId],
  );
  log.info('operator assigned', { conversationId, operatorId });
}

/**
 * Link a contact to a conversation.
 */
export async function linkContact(
  conversationId: string,
  contactId: string,
): Promise<void> {
  await db.query(
    `UPDATE conversations SET contact_id = $2, updated_at = NOW()
     WHERE id = $1 AND contact_id IS NULL`,
    [conversationId, contactId],
  );
}

/**
 * Close a conversation (set status = 'closed', closed_at = NOW()).
 */
export async function closeConversation(conversationId: string): Promise<void> {
  await db.query(
    `UPDATE conversations SET
       status = 'closed',
       closed_at = NOW(),
       resolved_at = COALESCE(resolved_at, NOW()),
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId],
  );

  // CRM inbox: remove closed conversation
  enqueueCrmEvent('chat', conversationId, 'conversation_closed', undefined, true)
    .catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
}
