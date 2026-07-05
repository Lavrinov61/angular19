/**
 * Centralized enriched broadcast for visitor chat messages.
 *
 * Single function replaces 9+ scattered io.emit('visitor:new-message', ...) calls.
 * Enriches the WS payload with session metadata so the frontend can build/update
 * InboxItems directly from the WebSocket event — zero HTTP for real-time updates.
 */

import db from '../database/db.js';
import { enqueueCrmEvent } from './crm-event-queue.service.js';
import { storageService } from './storage.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('chat-broadcast');

interface SessionData {
  visitor_name: string | null;
  visitor_phone: string | null;
  channel: string;
  status: string;
  assigned_operator_id: string | null;
  assigned_operator_name?: string | null;
  contact_id?: string | null;
  user_id?: string | null;
  client_last_seen_at?: string | null;
}

interface BroadcastMessageData {
  readonly [key: string]: unknown;
}

interface BroadcastOptions {
  sessionId: string;
  message: BroadcastMessageData;
  /** If session data is already loaded in calling context, pass it to avoid extra DB query */
  session?: SessionData | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function broadcastChatMessage(opts: BroadcastOptions): Promise<void> {
  let session = opts.session ?? null;

  // Load session metadata if not provided (~1ms query)
  if (!session) {
    session = await db.queryOne<SessionData>(
      `SELECT COALESCE(ct.display_name, client_u.display_name, s.visitor_name) AS visitor_name,
              COALESCE(ct.phone, client_u.phone, s.visitor_phone) AS visitor_phone,
              COALESCE(ct.last_seen_at, client_u.last_seen_at) AS client_last_seen_at,
              s.channel, s.status,
              s.assigned_operator_id, u.display_name AS assigned_operator_name,
              s.contact_id,
              COALESCE(ct.user_id, s.user_id) AS user_id
       FROM conversations s
       LEFT JOIN contacts ct ON ct.id = s.contact_id
       LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, s.user_id)
       LEFT JOIN users u ON u.id = s.assigned_operator_id
       WHERE s.id = $1`,
      [opts.sessionId],
    );
  }

  const msg = opts.message;
  const messageId = readString(msg['id']) ?? readString(msg['messageId']);
  const visitorId = readString(msg['visitor_id']) ?? readString(msg['visitorId']);
  const content = readString(msg['content']) ?? '';
  const messageType = readString(msg['message_type']) ?? readString(msg['messageType']) ?? 'text';
  const senderType = readString(msg['sender_type']) ?? readString(msg['senderType']) ?? 'visitor';
  const senderName = readString(msg['sender_name']) ?? readString(msg['senderName']);
  const senderId = readString(msg['sender_id']) ?? readString(msg['senderId']);
  const createdAt = msg['created_at'] || msg['timestamp'] || new Date();
  const metadata = msg['metadata'] ?? (msg['interactive'] ? { interactive: msg['interactive'] } : null);
  const isForwarded = msg['is_forwarded'] === true || msg['isForwarded'] === true;

  // Sign S3 attachment URL for secure access
  let attachmentUrl = readString(msg['attachment_url']) ?? readString(msg['attachmentUrl']);
  if (attachmentUrl && storageService.isS3Url(attachmentUrl)) {
    try {
      attachmentUrl = await storageService.resolveSignedUrl(attachmentUrl);
    } catch {
      // Keep original URL as fallback
    }
  }
  const normalizedMessage: BroadcastMessageData = {
    ...msg,
    ...(messageId ? { id: messageId } : {}),
    sender_type: senderType,
    sender_name: senderName,
    message_type: messageType,
    created_at: createdAt,
    attachment_url: attachmentUrl,
    metadata,
  };

  broadcastToRoom('visitor:new-message', 'admin:visitor-chats', {
    // Message data (backwards-compatible with existing frontend)
    sessionId: opts.sessionId,
    ...(messageId ? { messageId } : {}),
    visitorId,
    content,
    messageType,
    timestamp: createdAt,
    attachmentUrl,
    message: normalizedMessage,
    metadata,
    is_forwarded: isForwarded,
    forwarded_from_name: readString(msg['forwarded_from_name']) ?? null,
    reply_to_message_id: readString(msg['reply_to_message_id']) ?? null,
    // Explicit senderId for echo-filter on frontend
    senderId,
    senderType,
    senderName,

    // Session metadata for InboxItem construction on the frontend
    session: session
      ? {
          visitorName: session.visitor_name,
          visitorPhone: session.visitor_phone,
          channel: session.channel,
          status: session.status,
          assignedOperatorId: session.assigned_operator_id,
          assignedOperatorName: session.assigned_operator_name || null,
          contactId: session.contact_id || null,
          userId: session.user_id || null,
          clientName: session.visitor_name,
          clientPhone: session.visitor_phone,
          clientLastSeenAt: session.client_last_seen_at || null,
        }
      : null,
  });

  // Update crm_inbox table so data persists after F5 reload
  if (session) {
    enqueueCrmEvent('chat', opts.sessionId, 'message_received', {
      client_name: session.visitor_name,
      client_phone: session.visitor_phone,
      preview: content.substring(0, 200),
      status: session.status,
      priority: senderType === 'visitor' ? 1 : 2,
      sort_time: createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt || new Date().toISOString()),
      channel: session.channel,
      assigned_to: session.assigned_operator_id,
      assigned_to_name: session.assigned_operator_name || null,
      unread: senderType === 'visitor',
      metadata: {},
    }).catch(err => log.warn('enqueueCrmEvent from broadcast failed', { sessionId: opts.sessionId, error: String(err) }));
  }
}
