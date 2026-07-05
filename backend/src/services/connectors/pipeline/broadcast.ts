/**
 * Omnichannel v2 — Broadcast Service
 *
 * Socket.IO event emission for the new pipeline.
 * Backward-compatible: emits both sessionId AND conversationId.
 *
 * Replaces broadcastChatMessage from chat-broadcast.service.ts
 * with enriched payload from the conversations/messages tables.
 *
 * PM2-split aware: все эмиты идут через `broadcastToRoom()` —
 * в api напрямую через io, в worker-процессах через Redis pub/sub.
 */

import type { ConversationRow } from './conversation-manager.js';
import type { DeliveryStatus, SenderType, MessageType } from '../core/types.js';
import type Contacts from '../../../types/generated/public/Contacts.js';
import type { MessageMetadata } from '../../../types/jsonb/message-metadata.js';
import db from '../../../database/db.js';
import { broadcastToRoom } from '../../../websocket/broadcast-to-room.js';

// ─── Message row shape ────────────────────────────────────────────────────────

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  sender_name: string | null;
  message_type: MessageType;
  content: string;
  external_message_id: string | null;
  reply_to_message_id: string | null;
  is_forwarded: boolean;
  forwarded_from_name: string | null;
  delivery_status: DeliveryStatus;
  metadata: MessageMetadata | null;
  created_at: string;
}

export interface ConversationUpdateChanges {
  [field: string]: unknown;
}

// ─── Broadcast: New Message ───────────────────────────────────────────────────

export interface BroadcastMessageOptions {
  message: MessageRow;
  conversation: ConversationRow;
  replyToContent?: string | null;
  replyToSenderName?: string | null;
  mediaUrls?: string[];
  reopened?: boolean;
}

/**
 * Broadcast a new message to the admin room.
 *
 * Emits `visitor:new-message` with both `sessionId` and `conversationId`
 * for backward compatibility during the migration period.
 */
export async function broadcastNewMessage(opts: BroadcastMessageOptions): Promise<void> {
  const { message: msg, conversation: conv } = opts;

  // Resolve contact data for visitor name/phone (contacts is SSOT)
  let visitorName = conv.visitor_name;
  let visitorPhone = conv.visitor_phone;
  if (conv.contact_id) {
    const contact = await db.queryOne<Pick<Contacts, 'display_name' | 'phone'>>(
      `SELECT display_name, phone FROM contacts WHERE id = $1`,
      [conv.contact_id],
    );
    if (contact) {
      visitorName = contact.display_name || visitorName;
      visitorPhone = contact.phone || visitorPhone;
    }
  }

  const attachmentUrl = opts.mediaUrls?.[0] || null;
  broadcastToRoom('visitor:new-message', 'admin:visitor-chats', {
    // Backward compat (Angular reads sessionId)
    sessionId: conv.legacy_session_id || conv.id,
    // New field — prefer this going forward
    conversationId: conv.id,

    // Message fields
    visitorId: conv.visitor_id,
    content: msg.content,
    messageType: msg.message_type,
    timestamp: msg.created_at,
    attachmentUrl,
    message: msg,
    is_forwarded: msg.is_forwarded,
    forwarded_from_name: msg.forwarded_from_name,
    reply_to_message_id: msg.reply_to_message_id,
    reply_to_content: opts.replyToContent || null,
    reply_to_sender_name: opts.replyToSenderName || null,
    senderId: msg.sender_id,

    // Session/conversation metadata for InboxItem construction
    session: {
      visitorName,
      visitorPhone,
      channel: conv.channel,
      status: conv.status,
      assignedOperatorId: conv.assigned_operator_id,
      assignedOperatorName: null,
      reopened: opts.reopened || false,
      contactId: conv.contact_id || null,
      userId: conv.user_id || null,
    },
  });
}

// ─── Broadcast: Delivery Status ───────────────────────────────────────────────

/**
 * Broadcast a delivery status update for a message.
 * Frontend uses this to update message bubbles (sent → delivered → read).
 */
export function broadcastStatusUpdate(
  conversationId: string,
  messageId: string,
  status: DeliveryStatus,
  errorMessage?: string,
): void {
  broadcastToRoom('message:status-update', 'admin:visitor-chats', {
    // Backward compat for the Angular operator chat, which still consumes
    // sessionId/messageIds for status updates.
    sessionId: conversationId,
    conversationId,
    messageId,
    messageIds: [messageId],
    status,
    errorMessage: errorMessage || null,
    timestamp: new Date().toISOString(),
  });
}

// ─── Broadcast: Media Ready ──────────────────────────────────────────────────

export type MediaReadyStatus = 'uploaded' | 'failed';

export interface MediaReadyOptions {
  status?: MediaReadyStatus;
  errorMessage?: string | null;
  clientNotified?: boolean | null;
  clientMessage?: string | null;
}

/**
 * Notify frontend that media has been processed and is ready for display.
 * Frontend uses this to update message bubbles with the actual attachment URL.
 */
export async function broadcastMediaReady(
  conversationId: string,
  messageId: string,
  attachmentUrl: string,
  mediaType: string,
  fileName?: string | null,
  mimeType?: string | null,
  options?: MediaReadyOptions,
): Promise<void> {
  broadcastToRoom('message:media-ready', 'admin:visitor-chats', {
    conversationId,
    messageId,
    attachmentUrl,
    mediaType,
    fileName: fileName || null,
    mimeType: mimeType || null,
    status: options?.status ?? 'uploaded',
    errorMessage: options?.errorMessage ?? null,
    clientNotified: options?.clientNotified ?? null,
    clientMessage: options?.clientMessage ?? null,
    timestamp: new Date().toISOString(),
  });
}

// ─── Broadcast: Conversation Updated ──────────────────────────────────────────

/**
 * Broadcast conversation-level changes (assignment, status, etc.).
 */
export function broadcastConversationUpdate(
  conversationId: string,
  changes: ConversationUpdateChanges,
): void {
  broadcastToRoom('conversation:updated', 'admin:visitor-chats', {
    conversationId,
    ...changes,
    timestamp: new Date().toISOString(),
  });
}

// ─── Broadcast: Merge Suggestion ──────────────────────────────────────────────

/**
 * Broadcast a contact merge suggestion when duplicate contacts are detected.
 */
export function broadcastMergeSuggestion(
  contact: { id: string; displayName: string | null; source: string },
  duplicates: Array<{ id: string; display_name: string | null; phone: string | null }>,
): void {
  if (duplicates.length === 0) return;

  broadcastToRoom('contact:merge-suggested', 'admin:visitor-chats', {
    contact,
    duplicates,
  });
}
