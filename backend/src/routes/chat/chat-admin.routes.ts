import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import archiver from 'archiver';
import { pool } from '../../database/db.js';
import db from '../../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../../middleware/auth.js';
import { hasPermission } from '../../config/permissions.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logAudit } from '../../services/audit.service.js';
import { getIdentityLinkRequestContext, logIdentityLinkEvent } from '../../services/identity-link-audit.service.js';
import { buildWidgetPaymentButton } from './chat-pricing.helpers.js';
import { storageService } from '../../services/storage.service.js';
import { broadcastChatMessage } from '../../services/chat-broadcast.service.js';
import { autoLinkSessionToClient, suggestClientsForSession, searchClientsByQuery } from '../../services/client-context.service.js';
import { enqueueCrmEvent } from '../../services/crm-event-queue.service.js';
import { recordBusinessEvent } from '../../services/business-observability.service.js';
import { idempotent } from '../../middleware/idempotency.js';
import { isAllowedMediaDomain } from '../../config/media-domains.js';
import { createLogger } from '../../utils/logger.js';
import { mimeToExt } from '../../utils/mime-utils.js';
import { convertImageBufferToJpeg, needsJpegConversion, replaceExtForJpeg } from '../../utils/image-convert.js';
import { appendReadableToArchive } from '../../utils/archive-utils.js';
import PQueue from 'p-queue';
import { validate } from '../../middleware/validate.js';
import {
  replySchema,
  noteSchema,
  updateStatusSchema,
  assignSchema,
  transferSchema,
  claimPrivateSchema,
  releasePrivateSchema,
  updateCartSchema,
  paymentLinkSchema,
  followupSchema,
  createQuickReplySchema,
  updateQuickReplySchema,
  linkClientSchema,
  linkBookingSchema,
  downloadSelectedSchema,
  updateVisitorPhoneSchema,
  scheduleMessageSchema,
  forwardMessageSchema,
  type ScheduleMessageInput,
  type ForwardMessageInput,
} from '../../schemas/chat-admin.schema.js';
import type Messages from '../../types/generated/public/Messages.js';
import type MediaAttachments from '../../types/generated/public/MediaAttachments.js';
import type ChatFollowups from '../../types/generated/public/ChatFollowups.js';
import type ScheduledMessages from '../../types/generated/public/ScheduledMessages.js';
import type {
  ForwardSourceMessage,
  ForwardedMessageRow,
  OperatorNameRow,
  ChatAdminSessionRow,
  ChatAdminMessageRow,
  ChatResourcePrivacyRow,
  PinnedMessageRow,
} from '../../types/views/chat-views.js';
import type Conversations from '../../types/generated/public/Conversations.js';
import { maskPhone } from '../../utils/mask-phone.js';
import { checkSubscriptionByUserId, getCredits } from '../../services/subscription.service.js';
import { calculatePriceWaterfall, type PriceWaterfallInput } from '../../services/pricing-engine.service.js';
import { parseMessageMetadata, type MessageReactions } from '../../types/jsonb/message-metadata.js';
import { parseConversationMetadata } from '../../types/jsonb/conversation-jsonb.js';
import type { ChannelType as ConnectorChannelType } from '../../services/connectors/core/types.js';
import { requireActiveEmployeeShiftForPaymentLink } from '../../services/virtual-shift.service.js';
import { buildActivityTimeline, toActivityItems } from '../../services/client-activity-timeline.service.js';
import type { ActivityItem } from '../../types/views/crm-views.js';

const log = createLogger('chat-admin');

const router = Router();
const PREVIOUS_CONVERSATION_HISTORY_LIMIT = 2000;

interface ConversationIdentityAuditRow {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  visitor_id: string | null;
}

/** Defense-in-depth: strip HTML tags before DB insert */
function sanitizeContent(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function toConnectorChannel(channel: string | null): ConnectorChannelType | null {
  switch (channel) {
    case 'telegram':
      return 'telegram';
    case 'vk':
      return 'vk';
    case 'whatsapp':
      return 'whatsapp';
    case 'instagram':
      return 'instagram';
    case 'max':
      return 'max';
    case 'email':
      return 'email';
    case 'web':
      return 'web';
    default:
      return null;
  }
}

function getExternalChatId(metadata: Conversations['metadata']): string | undefined {
  const value = Reflect.get(parseConversationMetadata(metadata) ?? {}, 'externalChatId');
  return typeof value === 'string' ? value : undefined;
}

function getConversationExternalChatId(conv: Pick<Conversations, 'external_chat_id' | 'metadata'>): string | undefined {
  return conv.external_chat_id ?? getExternalChatId(conv.metadata);
}

function isOutgoingPultMessage(senderType: string): boolean {
  return senderType === 'operator' || senderType === 'bot';
}

interface ConversationMessageStatsRow {
  message_count: number;
  unread_count: number;
  last_message_content: string | null;
  last_message_at: string | null;
}

async function refreshConversationMessageSummary(sessionId: string): Promise<ConversationMessageStatsRow> {
  const stats = await db.queryOne<ConversationMessageStatsRow>(
    `SELECT
       COUNT(*)::int AS message_count,
       COUNT(*) FILTER (WHERE sender_type = 'visitor' AND COALESCE(is_read, false) = false)::int AS unread_count,
       (
         SELECT content
         FROM messages
         WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC NULLS LAST
         LIMIT 1
       ) AS last_message_content,
       (
         SELECT created_at
         FROM messages
         WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC NULLS LAST
         LIMIT 1
       ) AS last_message_at
     FROM messages
     WHERE conversation_id = $1 AND deleted_at IS NULL`,
    [sessionId],
  );

  const normalized = stats ?? {
    message_count: 0,
    unread_count: 0,
    last_message_content: null,
    last_message_at: null,
  };

  await db.query(
    `UPDATE conversations
     SET message_count = $2,
         unread_count = $3,
         last_message_content = $4,
         last_message_at = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [
      sessionId,
      normalized.message_count,
      normalized.unread_count,
      normalized.last_message_content,
      normalized.last_message_at,
    ],
  );

  await db.query(
    `UPDATE crm_inbox
     SET preview = $2,
         sort_time = COALESCE($3::timestamptz, sort_time),
         unread = $4::int > 0,
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('messageCount', $5::int, 'unreadCount', $4::int),
         updated_at = NOW()
     WHERE type = 'chat' AND id = $1`,
    [
      sessionId,
      normalized.last_message_content,
      normalized.last_message_at,
      normalized.unread_count,
      normalized.message_count,
    ],
  );

  return normalized;
}

/** F70: Emit phone update via Socket.IO (runtime type narrowing, no type assertions) */
function emitPhoneUpdate(req: AuthRequest, sessionId: string, phone: string): void {
  const io = req.app.socketServer?.getIO();
  if (!io) return;
  io.to('admin:visitor-chats').emit('chatPhoneUpdated', { sessionId, visitorPhone: phone });
}

// ============================================================================
// API для операторов (требует авторизации + права chat:reply)
// ============================================================================

// All /admin/* endpoints require authentication and chat:reply permission
router.use('/admin', authenticateToken, requirePermission('chat:reply'));

/**
 * Получить одну сессию по ID (для операторов)
 * GET /admin/sessions/:sessionId/detail
 */
router.get('/admin/sessions/:sessionId/detail', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  const rows = await db.query<ChatAdminSessionRow>(
     `SELECT s.*, u.display_name AS assigned_operator_name,
            COALESCE(ct.display_name, client_u.display_name, s.visitor_name) AS client_name,
            COALESCE(ct.phone, client_u.phone, s.visitor_phone) AS client_phone,
            COALESCE(ct.last_seen_at, client_u.last_seen_at) AS client_last_seen_at,
            (SELECT count(*) FROM orders o WHERE o.client_id = COALESCE(ct.user_id, s.user_id))::int AS client_purchases_count,
            b.service_name AS booking_service, b.start_time AS booking_date, b.status AS booking_status
     FROM conversations s
     LEFT JOIN users u ON u.id = s.assigned_operator_id
     LEFT JOIN contacts ct ON ct.id = s.contact_id
     LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, s.user_id)
     LEFT JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  );

  if (!rows.length) {
    throw new AppError(404, 'Session not found');
  }

  const row = rows[0];
  if (req.user?.role !== 'admin') {
    row.client_phone = maskPhone(row.client_phone);
  }

  // If conversation is linked to a user account, load their subscription
  const userId = row.user_id;
  if (typeof userId === 'string') {
    const sub = await checkSubscriptionByUserId(userId);
    if (sub) {
      const credits = await getCredits(sub.id);
      row.subscription = { ...sub, credits };
    }
  }

  res.json({ success: true, data: row });
});

/**
 * Получить активные сессии (для операторов)
 * GET /admin/sessions
 */
router.get('/admin/sessions', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { status = 'open', channel = 'all', source = 'all' } = req.query;

  // Uses denormalized columns (message_count, unread_count, last_message_content) — no N+1 subqueries
  // Privacy filter: hide chats that are marked is_private by other operators (admins see everything)
  const rows = await db.query<ChatAdminSessionRow>(
    `SELECT s.*, s.message_count, s.unread_count,
            s.last_message_content AS last_message,
            u.display_name AS assigned_operator_name,
            COALESCE(ct.display_name, client_u.display_name, s.visitor_name) AS client_name,
            COALESCE(ct.phone, client_u.phone, s.visitor_phone) AS client_phone,
            COALESCE(ct.last_seen_at, client_u.last_seen_at) AS client_last_seen_at,
            b.service_name AS booking_service, b.start_time AS booking_date, b.status AS booking_status
     FROM conversations s
     LEFT JOIN users u ON u.id = s.assigned_operator_id
     LEFT JOIN contacts ct ON ct.id = s.contact_id
     LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, s.user_id)
     LEFT JOIN bookings b ON b.id = s.booking_id
     WHERE ($1 = 'all' OR s.status = $1)
       AND ($2 = 'all' OR s.channel = $2::channel_type)
       AND ($3 = 'all' OR s.source = $3)
       AND (s.is_private = false OR s.assigned_operator_id = $4 OR $5 = true)
     ORDER BY s.last_message_at DESC NULLS LAST, s.created_at DESC
     LIMIT 200`,
    [status, channel, source, req.user.id, hasPermission(req.user.role, 'inbox:all_chats')]
  );

  if (req.user?.role !== 'admin') {
    for (const row of rows) {
      row.client_phone = maskPhone(row.client_phone);
    }
  }

  res.json({
    success: true,
    data: rows
  });
});

/**
 * Ответить на сообщение (для операторов)
 * POST /admin/sessions/:sessionId/reply
 */
router.post('/admin/sessions/:sessionId/reply', authenticateToken, validate(replySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { messageType, replyToMessageId } = req.body;
  const content = sanitizeContent(req.body.content);

  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  // Resolve reply-to (lookup original message for external delivery)
  let replyToExternalId: string | null = null;
  if (replyToMessageId) {
    const replyMsg = await pool.query(
      `SELECT external_message_id FROM messages WHERE id = $1 AND conversation_id = $2`,
      [replyToMessageId, sessionId],
    );
    if (replyMsg.rows[0]) {
      replyToExternalId = replyMsg.rows[0].external_message_id;
    }
  }

  // Transactional: UPDATE session + INSERT message + SELECT session data
  const txResult = await db.transaction(async (client) => {
    // 1. Update session status + SLA + denormalized last_message (only assign if unassigned)
    // Operator reply = perceptible human action: lock ai_agent to operator mode (idempotent).
    await client.query(
      `UPDATE conversations
       SET status = 'active',
           assigned_operator_id = COALESCE(assigned_operator_id, $2),
           first_response_at = COALESCE(first_response_at, NOW()),
           last_message_at = NOW(),
           last_message_content = LEFT($3, 200),
           message_count = COALESCE(message_count, 0) + 1,
           ai_agent_mode = 'operator',
           ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()),
           ai_agent_mode_set_by = 'operator:' || $2::text
       WHERE id = $1`,
      [sessionId, req.user!.id, content]
    );
    // TODO: cancel in-flight debounce ai-turn job after S3 (ai-turn-worker) is ready

    // 2. Insert operator message (with optional reply_to_message_id)
    const msgResult = await client.query(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_id, sender_name, message_type, content, reply_to_message_id)
       VALUES ($1, 'operator', $2, $3, $4, $5, $6)
       RETURNING *`,
      [sessionId, req.user!.id, 'Оператор', messageType, content, replyToMessageId || null]
    );

    // 3. Get session channel info + metadata for enriched broadcast (inside same tx for consistency)
    const sessionData = await client.query(
      `SELECT c.channel, c.source, c.metadata,
              COALESCE(ct.display_name, client_u.display_name, c.visitor_name) AS visitor_name,
              COALESCE(ct.phone, client_u.phone, c.visitor_phone) AS visitor_phone,
              COALESCE(ct.last_seen_at, client_u.last_seen_at) AS client_last_seen_at,
              c.status, c.assigned_operator_id, c.contact_id,
              COALESCE(ct.user_id, c.user_id) AS user_id
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN users client_u ON client_u.id = COALESCE(ct.user_id, c.user_id)
       WHERE c.id = $1`,
      [sessionId]
    );

    return { msg: msgResult.rows[0], sessionRow: sessionData.rows[0] };
  });

  const { msg, sessionRow } = txResult;

  // Post-transaction: Socket.IO emit (message guaranteed in DB)
  const socketServer = req.app.socketServer;
  if (socketServer) {
    let attachmentUrl = msg.attachment_url;
    if (attachmentUrl && storageService.isS3Url(attachmentUrl)) {
      try { attachmentUrl = await storageService.resolveSignedUrl(attachmentUrl); } catch { /* keep original */ }
    }
    socketServer.getIO().to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId,
      id: msg.id,
      content: msg.content,
      senderName: msg.sender_name,
      senderType: msg.sender_type,
      messageType: msg.message_type,
      attachmentUrl,
      timestamp: msg.created_at,
    });
    broadcastChatMessage({
      sessionId,
      message: msg,
      session: sessionRow ? {
        visitor_name: sessionRow.visitor_name,
        visitor_phone: sessionRow.visitor_phone,
        channel: sessionRow.channel,
        status: sessionRow.status,
        assigned_operator_id: sessionRow.assigned_operator_id,
        assigned_operator_name: null,
        contact_id: sessionRow.contact_id,
        user_id: sessionRow.user_id,
        client_last_seen_at: sessionRow.client_last_seen_at,
      } : null,
    }).catch(err => log.error('[chat-admin] broadcastChatMessage failed', { error: String(err) }));
  }

  // Post-transaction: BullMQ enqueue (fail-safe — message already in DB)
  const deliveryChannel = sessionRow?.channel;
  if (deliveryChannel && !['web', 'online', 'studio'].includes(deliveryChannel)) {
    const externalChatId = sessionRow.metadata?.externalChatId;
    if (externalChatId) {
      try {
        const { enqueueOutbound } = await import('../../services/connectors/pipeline/outbound-worker.js');
        await enqueueOutbound({
          channel: deliveryChannel as Parameters<typeof enqueueOutbound>[0]['channel'],
          externalChatId,
          content,
          messageType: (messageType || 'text') as Parameters<typeof enqueueOutbound>[0]['messageType'],
          sourceMessageId: msg.id,
          conversationId: sessionId,
          replyToExternalId: replyToExternalId || undefined,
        });
        if (socketServer) {
          socketServer.getIO().to('admin:visitor-chats').emit('message:status-update', {
            sessionId,
            messageIds: [msg.id],
            status: 'sent',
          });
        }
      } catch (err) {
        log.error('enqueueOutbound failed (message saved in DB)', { error: String(err) });
      }
    }
  }

  logAudit({ userId: req.user.id, userName: 'Оператор', action: 'chat_reply', entityType: 'chat', entityId: sessionId, ip: req.ip });

  res.json({
    success: true,
    data: msg
  });
});

/**
 * Внутренняя заметка оператора (видна только коллегам)
 * POST /admin/sessions/:sessionId/note
 */
router.post('/admin/sessions/:sessionId/note', authenticateToken, validate(noteSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { content } = req.body;

  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  // Get operator display name
  const userRow = await pool.query(
    `SELECT display_name, email FROM users WHERE id = $1`,
    [req.user.id]
  );
  const senderName = userRow.rows[0]?.display_name || userRow.rows[0]?.email || 'Оператор';

  const result = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'internal_note', $2, $3, 'text', $4)
     RETURNING *`,
    [sessionId, req.user.id, senderName, content.trim()]
  );

  // Broadcast to admin room only (visitors don't see notes)
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('visitor:internal-note', {
      sessionId,
      message: result.rows[0],
    });
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

/**
 * AI-подсказка для оператора
 * POST /admin/sessions/:sessionId/suggest
 */
router.post('/admin/sessions/:sessionId/suggest', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { generateOperatorSuggestion } = await import('../../services/ai-chat.service.js');
  const suggestion = await generateOperatorSuggestion(sessionId);

  res.json({ success: true, data: { suggestion } });
});

/**
 * Экспорт чата
 * GET /admin/sessions/:sessionId/export?format=csv|txt
 */
router.get('/admin/sessions/:sessionId/export', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const format = (req.query['format'] as string) || 'csv';

  const { exportChatAsCsv, exportChatAsText } = await import('../../services/chat-export.service.js');

  if (format === 'txt') {
    const text = await exportChatAsText(sessionId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${sessionId.slice(0, 8)}.txt"`);
    res.send(text);
  } else {
    const csv = await exportChatAsCsv(sessionId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${sessionId.slice(0, 8)}.csv"`);
    res.send(csv);
  }
});

/**
 * Получить сообщения сессии (для операторов)
 * GET /admin/sessions/:sessionId/messages
 */
router.get('/admin/sessions/:sessionId/messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const limit = Math.min(parseInt(req.query['limit'] as string) || 2000, 2000);
  const before = req.query['before'] as string | undefined;
  const after = req.query['after'] as string | undefined;
  const around = req.query['around'] as string | undefined;

  let queryText: string;
  let queryParams: unknown[];

  if (around) {
    // Load messages around a timestamp (for jump-to-message)
    const halfLimit = Math.floor(limit / 2);
    queryText = `(
      SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
             m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
             m.created_at, m.is_read, m.read_at, m.delivered_at,
             m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
             r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
             ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
             ma.all_media
      FROM messages m
      LEFT JOIN messages r ON r.id = m.reply_to_message_id
      LEFT JOIN LATERAL (
        SELECT
          (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
          (array_agg(file_name ORDER BY created_at))[1] AS file_name,
          (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
          json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
        FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
      ) ma ON true
      WHERE m.conversation_id = $1 AND m.created_at <= $2 AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT $3
    ) UNION ALL (
      SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
             m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
             m.created_at, m.is_read, m.read_at, m.delivered_at,
             m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
             r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
             ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
             ma.all_media
      FROM messages m
      LEFT JOIN messages r ON r.id = m.reply_to_message_id
      LEFT JOIN LATERAL (
        SELECT
          (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
          (array_agg(file_name ORDER BY created_at))[1] AS file_name,
          (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
          json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
        FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
      ) ma ON true
      WHERE m.conversation_id = $1 AND m.created_at > $2 AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC LIMIT $4
    ) ORDER BY created_at ASC`;
    queryParams = [sessionId, around, halfLimit, halfLimit];
  } else if (before) {
    // Load older messages (scroll up)
    queryText = `SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
            m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
            m.created_at, m.is_read, m.read_at, m.delivered_at,
            m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
            r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
            ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
             ma.all_media
     FROM messages m
     LEFT JOIN messages r ON r.id = m.reply_to_message_id
     LEFT JOIN LATERAL (
       SELECT
         (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
         (array_agg(file_name ORDER BY created_at))[1] AS file_name,
         (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
         json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
       FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
     ) ma ON true
     WHERE m.conversation_id = $1 AND m.created_at < $2 AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT $3`;
    queryParams = [sessionId, before, limit];
  } else if (after) {
    // Load newer messages (sync)
    queryText = `SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
            m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
            m.created_at, m.is_read, m.read_at, m.delivered_at,
            m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
            r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
            ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
             ma.all_media
     FROM messages m
     LEFT JOIN messages r ON r.id = m.reply_to_message_id
     LEFT JOIN LATERAL (
       SELECT
         (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
         (array_agg(file_name ORDER BY created_at))[1] AS file_name,
         (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
         json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
       FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
     ) ma ON true
     WHERE m.conversation_id = $1 AND m.created_at > $2 AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC LIMIT $3`;
    queryParams = [sessionId, after, limit];
  } else {
    // Default: load latest N messages (backward compatible — no params = all for small limit, or latest N)
    queryText = `SELECT * FROM (
      SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
             m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
             m.created_at, m.is_read, m.read_at, m.delivered_at,
             m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
             r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
             ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
             ma.all_media
      FROM messages m
      LEFT JOIN messages r ON r.id = m.reply_to_message_id
      LEFT JOIN LATERAL (
        SELECT
          (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
          (array_agg(file_name ORDER BY created_at))[1] AS file_name,
          (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
          json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
        FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
      ) ma ON true
      WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT $2
    ) sub ORDER BY created_at ASC`;
    queryParams = [sessionId, limit];
  }

  const messages = await pool.query<ChatAdminMessageRow>(queryText, queryParams);

  // If "before" was used, reverse to ASC order
  let rows = messages.rows;
  if (before) {
    rows = rows.reverse();
  }

  // Count total for hasOlder/hasNewer
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL`,
    [sessionId]
  );
  const totalCount = totalResult.rows[0]?.total || 0;

  const hasOlder = rows.length > 0 && totalCount > rows.length
    ? (await pool.query(
        `SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = $1 AND created_at < $2 AND deleted_at IS NULL) AS has`,
        [sessionId, rows[0].created_at]
      )).rows[0]?.has ?? false
    : false;

  const hasNewer = rows.length > 0
    ? (await pool.query(
        `SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = $1 AND created_at > $2 AND deleted_at IS NULL) AS has`,
        [sessionId, rows[rows.length - 1].created_at]
      )).rows[0]?.has ?? false
    : false;

  const enrichedMessages = rows.map((msg) => {
    const interactive = parseMessageMetadata(msg.metadata)?.interactive;
    if (interactive) {
      return { ...msg, interactive };
    }
    return msg;
  });

  // ── Cross-conversation history: load messages from other conversations of the same person ──
  // Only on initial load (no pagination params) to avoid re-fetching on scroll
  let previousMessages: ChatAdminMessageRow[] | undefined;
  if (!before && !after && !around) {
    try {
      const prevRows = await db.query<ChatAdminMessageRow>(
        `WITH current_conv AS (
           SELECT c.id, c.external_chat_id, c.channel, c.visitor_id, c.contact_id, c.user_id,
                  CASE
                    WHEN length(current_phone.digits) >= 10 THEN right(current_phone.digits, 10)
                    ELSE NULL
                  END AS phone_key
           FROM conversations c
           LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
           LEFT JOIN users u ON u.id = COALESCE(ct.user_id, c.user_id)
           CROSS JOIN LATERAL (
             SELECT regexp_replace(COALESCE(ct.phone, u.phone, c.visitor_phone, ''), '\\D', '', 'g') AS digits
           ) current_phone
           WHERE c.id = $1
         ),
         related_conversations AS (
           SELECT DISTINCT c.id
           FROM current_conv cur
           JOIN conversations c ON c.id != cur.id
           LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
           LEFT JOIN users u ON u.id = COALESCE(ct.user_id, c.user_id)
           CROSS JOIN LATERAL (
             SELECT regexp_replace(COALESCE(ct.phone, u.phone, c.visitor_phone, ''), '\\D', '', 'g') AS digits
           ) related_phone
           WHERE (cur.contact_id IS NOT NULL AND c.contact_id = cur.contact_id)
              OR (cur.user_id IS NOT NULL AND c.user_id = cur.user_id)
              OR (cur.external_chat_id IS NOT NULL AND c.external_chat_id = cur.external_chat_id AND c.channel = cur.channel)
              OR (cur.visitor_id IS NOT NULL AND c.visitor_id = cur.visitor_id)
              OR (
                cur.phone_key IS NOT NULL
                AND length(related_phone.digits) >= 10
                AND right(related_phone.digits, 10) = cur.phone_key
              )
         )
         SELECT m.id, m.conversation_id, m.sender_type, m.sender_name, m.message_type, m.content,
                m.metadata, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
                m.created_at, m.is_read, m.delivered_at, m.read_at,
                m.reply_to_message_id, m.is_forwarded, m.forwarded_from_name, m.pinned_at, m.pinned_by,
                r.content AS reply_to_content, r.sender_name AS reply_to_sender_name,
                ma.file_name AS original_file_name, ma.mime_type AS original_mime_type,
                ma.all_media
         FROM messages m
         JOIN related_conversations rc ON rc.id = m.conversation_id
         LEFT JOIN messages r ON r.id = m.reply_to_message_id
         LEFT JOIN LATERAL (
           SELECT
             (array_agg(s3_url ORDER BY created_at))[1] AS s3_url,
             (array_agg(file_name ORDER BY created_at))[1] AS file_name,
             (array_agg(mime_type ORDER BY created_at))[1] AS mime_type,
             json_agg(json_build_object('url', s3_url, 'file_name', file_name, 'mime_type', mime_type) ORDER BY created_at) AS all_media
           FROM media_attachments WHERE message_id = m.id AND processing_status = 'uploaded'
         ) ma ON true
         WHERE m.deleted_at IS NULL
           AND m.sender_type != 'internal_note'
           AND (m.metadata IS NULL OR (m.metadata->>'hiddenInUi') IS DISTINCT FROM 'true')
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [sessionId, PREVIOUS_CONVERSATION_HISTORY_LIMIT],
      );

      if (prevRows.length > 0) {
        // Reverse to ASC order (we fetched DESC for LIMIT efficiency)
        prevRows.reverse();

        // Enrich metadata
        const enrichedPrev = prevRows.map((msg) => {
          const interactive = parseMessageMetadata(msg.metadata)?.interactive;
          return interactive
            ? { ...msg, interactive, is_previous_session: true }
            : { ...msg, is_previous_session: true };
        });

        previousMessages = enrichedPrev;
      }
    } catch (err) {
      log.warn('Failed to load cross-conversation history', { sessionId, error: String(err) });
      // Non-critical — don't block the response
    }
  }

  // ── Activity timeline (read-side): доменная активность человека инлайн в ленте ──
  // Только на initial load (как previousMessages). Собирается из доменных таблиц
  // по identity-bundle (user_id + телефон) этого диалога; в messages НЕ пишется,
  // includeMessages:false (сообщения приходят через data+previousMessages).
  let activityItems: ActivityItem[] | undefined;
  if (!before && !after && !around) {
    try {
      // current_conv CTE наружу identity не отдаёт (P2-1) → отдельный лёгкий SELECT.
      // Та же формула резолва, что в previousMessages: contact.user_id/conv.user_id,
      // телефон — contact.phone/user.phone/conv.visitor_phone (нормализованный).
      const identityRow = await db.queryOne<{ user_id: string | null; phone_last10: string | null }>(
        `SELECT COALESCE(ct.user_id, c.user_id)::text AS user_id,
                CASE WHEN length(p.digits) >= 10 THEN right(p.digits, 10) ELSE NULL END AS phone_last10
           FROM conversations c
           LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
           LEFT JOIN users u ON u.id = COALESCE(ct.user_id, c.user_id)
           CROSS JOIN LATERAL (
             SELECT regexp_replace(COALESCE(ct.phone, u.phone, c.visitor_phone, ''), '\\D', '', 'g') AS digits
           ) p
          WHERE c.id = $1`,
        [sessionId],
      );

      if (identityRow && (identityRow.user_id || identityRow.phone_last10)) {
        const rows = await buildActivityTimeline(
          { userId: identityRow.user_id, phoneLast10: identityRow.phone_last10 },
          { includeMessages: false },
        );
        activityItems = toActivityItems(rows);
      }
    } catch (err) {
      log.warn('Failed to load activity timeline', { sessionId, error: String(err) });
      // Non-critical — don't block the response
    }
  }

  res.json({
    success: true,
    data: enrichedMessages,
    previousMessages,
    activityItems,
    hasOlder,
    hasNewer,
    totalCount,
  });
});

/**
 * Изменить статус сессии (для операторов)
 * PUT /admin/sessions/:sessionId/status
 */
router.put('/admin/sessions/:sessionId/status', authenticateToken, idempotent(60), validate(updateStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { status } = req.body;

  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  // SLA: resolved_at при resolved/closed
  const resolvedAtClause = ['resolved', 'closed'].includes(status)
    ? ', resolved_at = COALESCE(resolved_at, NOW())'
    : '';

  // Operator sets status to active = operator taking over: lock ai_agent (idempotent).
  const agentLockClause = status === 'active'
    ? `, ai_agent_mode = 'operator', ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()), ai_agent_mode_set_by = 'operator:' || $3::text`
    : '';

  const result = await pool.query(
    `UPDATE conversations
     SET status = $2, assigned_operator_id = COALESCE(assigned_operator_id, $3)${resolvedAtClause}${agentLockClause}
     WHERE id = $1
     RETURNING *`,
    [sessionId, status, req.user.id]
  );
  // TODO: cancel in-flight debounce ai-turn job after S3 (ai-turn-worker) is ready (only if status === 'active')

  if (result.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  // Gamification: award XP for chat resolution (fire-and-forget)
  if (['resolved', 'closed'].includes(status)) {
    const resolvedByUserId = req.user.id;
    void import('../../services/employee-gamification.service.js')
      .then(({ awardXP }) =>
        awardXP(resolvedByUserId, 'chat_resolved', sessionId, 'Чат закрыт')
          .catch(err => log.warn('awardXP failed', { error: String(err) }))
      )
      .catch(err => log.warn('employee-gamification import failed', { error: String(err) }));
  }

  // CRM inbox event
  if (['resolved', 'closed'].includes(status)) {
    enqueueCrmEvent('chat', sessionId, 'conversation_closed', undefined, true)
      .catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
  } else {
    enqueueCrmEvent('chat', sessionId, 'status_changed', {
      status,
      priority: status === 'open' ? 1 : status === 'waiting' ? 2 : 3,
      sort_time: new Date().toISOString(),
    }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
  }

  // WebSocket broadcast: notify all operators about status change
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const conv = result.rows[0];
    socketServer.getIO().to('admin:visitor-chats').emit('chat:status-changed', {
      sessionId,
      status,
      assignedOperatorId: conv.assigned_operator_id || null,
      updatedBy: req.user.id,
    });
  }

  res.json({
    success: true,
    data: result.rows[0]
  });
});

/**
 * Назначить чат на оператора (или взять себе)
 * POST /admin/sessions/:sessionId/assign
 * body: { operator_id?: string } -- 'self' или UUID; по умолчанию = текущий пользователь
 */
router.post('/admin/sessions/:sessionId/assign', authenticateToken, idempotent(60), validate(assignSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }

  const { sessionId } = req.params;
  let operatorId = req.body.operator_id;
  if (!operatorId || operatorId === 'self') operatorId = req.user.id;

  // Race-safe: only assign if unassigned or re-assigning own chat.
  // Operator take-over: lock ai_agent to operator mode (idempotent).
  const result = await pool.query(
    `UPDATE conversations
     SET assigned_operator_id = $2,
         status = CASE WHEN status = 'open' THEN 'active' ELSE status END,
         updated_at = NOW(),
         ai_agent_mode = 'operator',
         ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()),
         ai_agent_mode_set_by = 'operator:' || $2::text
     WHERE id = $1
       AND (assigned_operator_id IS NULL OR assigned_operator_id = $3)
     RETURNING *`,
    [sessionId, operatorId, req.user.id]
  );
  // TODO: cancel in-flight debounce ai-turn job after S3 (ai-turn-worker) is ready

  if (result.rows.length === 0) {
    const exists = await pool.query('SELECT assigned_operator_id FROM conversations WHERE id = $1', [sessionId]);
    if (!exists.rows.length) { throw new AppError(404, 'Session not found'); }
    throw new AppError(409, 'Чат уже назначен другому оператору');
  }

  // Get operator name
  const opRow = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [operatorId]);
  const operatorName = opRow.rows[0]?.display_name || opRow.rows[0]?.email || 'Оператор';

  // System message
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
    [sessionId, `Чат взят в работу: ${operatorName}`]
  );

  // Ownership history audit
  await pool.query(
    `INSERT INTO chat_ownership_history (resource_type, conversation_id, action, from_operator_id, to_operator_id, changed_by, note)
     VALUES ('conversation', $1, 'assign', NULL, $2, $3, NULL)`,
    [sessionId, operatorId, req.user.id]
  );

  // WebSocket broadcast
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const io = socketServer.getIO();
    io.to('admin:visitor-chats').emit('chat:assigned', {
      sessionId, operatorId, operatorName, assignedBy: req.user.id,
    });
    // Targeted notification if admin/manager assigned someone else
    if (operatorId !== req.user.id) {
      const assignedByName = (await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.user.id])).rows[0];
      io.to(`user:${operatorId}`).emit('chat:assigned-to-you', {
        sessionId,
        resource_type: 'conversation',
        assigned_by_name: assignedByName?.display_name || assignedByName?.email || 'Администратор',
        mode: 'assign',
      });
    }
  }

  logAudit({ userId: req.user.id, userName: operatorName, action: 'chat_assign', entityType: 'chat', entityId: sessionId, ip: req.ip });

  // CRM inbox event: assignment
  enqueueCrmEvent('chat', sessionId, 'assignment_changed', {
    assigned_to: operatorId,
    assigned_to_name: operatorName,
    status: 'active',
    priority: 3,
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  res.json({ success: true, data: result.rows[0] });
});

/**
 * Освободить чат (снять назначение)
 * POST /admin/sessions/:sessionId/unassign
 */
router.post('/admin/sessions/:sessionId/unassign', authenticateToken, idempotent(60), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }

  const { sessionId } = req.params;

  // Only current assignee or admin can unassign
  const session = await pool.query('SELECT assigned_operator_id FROM conversations WHERE id = $1', [sessionId]);
  if (!session.rows.length) { throw new AppError(404, 'Session not found'); }

  const previousOperatorId = session.rows[0].assigned_operator_id;
  if (previousOperatorId !== req.user.id && req.user.role !== 'admin') {
    throw new AppError(403, 'Только назначенный оператор или админ может отменить назначение');
  }

  const result = await pool.query(
    `UPDATE conversations SET assigned_operator_id = NULL, is_private = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [sessionId]
  );

  // System message
  const opRow = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.user.id]);
  const opName = opRow.rows[0]?.display_name || opRow.rows[0]?.email || 'Оператор';
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
    [sessionId, `${opName} освободил чат`]
  );

  // Ownership history audit
  await pool.query(
    `INSERT INTO chat_ownership_history (resource_type, conversation_id, action, from_operator_id, to_operator_id, changed_by, note)
     VALUES ('conversation', $1, 'unassign', $2, NULL, $3, NULL)`,
    [sessionId, previousOperatorId, req.user.id]
  );

  // WebSocket broadcast
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('chat:unassigned', {
      sessionId, unassignedBy: req.user.id,
      status: result.rows[0]?.status || 'open',
    });
  }

  // CRM inbox event: unassigned → status back to open
  enqueueCrmEvent('chat', sessionId, 'status_changed', {
    status: 'open',
    priority: 1,
    sort_time: new Date().toISOString(),
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  res.json({ success: true, data: result.rows[0] });
});

/**
 * Передать чат другому оператору
 * POST /admin/sessions/:sessionId/transfer
 * body: { to_operator_id: string, note?: string }
 */
router.post('/admin/sessions/:sessionId/transfer', authenticateToken, requirePermission('chat:transfer'), idempotent(60), validate(transferSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }

  const { sessionId } = req.params;
  const { to_operator_id, note, resource_type: requestedResourceType } = req.body;
  if (to_operator_id === req.user.id) { throw new AppError(400, 'Cannot transfer to yourself'); }

  // Verify target is active staff (admin, manager, employee) — exclude system bots and photographers
  const targetOp = await pool.query(
    `SELECT id, display_name, email FROM users
     WHERE id = $1
       AND role IN ('admin', 'manager', 'employee')
       AND is_active = true
       AND is_system = false`,
    [to_operator_id]
  );
  if (!targetOp.rows.length) { throw new AppError(404, 'Target operator not found'); }

  const fromOpRow = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.user.id]);
  const fromName = fromOpRow.rows[0]?.display_name || fromOpRow.rows[0]?.email || 'Оператор';
  const toName = targetOp.rows[0].display_name || targetOp.rows[0].email || 'Оператор';

  // Two-table UPDATE with autodetect — reset is_private (privacy does NOT inherit on transfer)
  let resolvedResourceType: 'conversation' | 'visitor_session' | null = null;
  let updatedRow: ChatResourcePrivacyRow | null = null;
  let previousOperatorId: string | null = null;

  if (requestedResourceType !== 'visitor_session') {
    // Operator transfer = human action: lock ai_agent to operator mode on receiving end (idempotent).
    const r = await pool.query<ChatResourcePrivacyRow>(
      `UPDATE conversations
       SET assigned_operator_id = $2, is_private = false, updated_at = NOW(),
           ai_agent_mode = 'operator',
           ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()),
           ai_agent_mode_set_by = 'operator:' || $3::text
       WHERE id = $1
       RETURNING *, (SELECT assigned_operator_id FROM conversations WHERE id = $1) AS _unused`,
      [sessionId, to_operator_id, req.user.id]
    );
    // TODO: cancel in-flight debounce ai-turn job after S3 (ai-turn-worker) is ready
    if (r.rows.length) {
      resolvedResourceType = 'conversation';
      updatedRow = r.rows[0];
    }
  }
  if (!resolvedResourceType && requestedResourceType !== 'conversation') {
    const r = await pool.query<ChatResourcePrivacyRow>(
      `UPDATE visitor_chat_sessions
       SET assigned_operator_id = $2, is_private = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId, to_operator_id]
    );
    if (r.rows.length) {
      resolvedResourceType = 'visitor_session';
      updatedRow = r.rows[0];
    }
  }

  if (!resolvedResourceType || !updatedRow) { throw new AppError(404, 'Session not found'); }

  // Capture previous operator (best-effort; from the last non-self ownership event — fallback NULL)
  const prevRow = await pool.query(
    `SELECT to_operator_id FROM chat_ownership_history
     WHERE ${resolvedResourceType === 'conversation' ? 'conversation_id' : 'visitor_session_id'} = $1
       AND action IN ('assign','transfer','claim-private')
     ORDER BY changed_at DESC LIMIT 1 OFFSET 0`,
    [sessionId]
  );
  previousOperatorId = prevRow.rows[0]?.to_operator_id || null;

  // Ownership history audit
  await pool.query(
    `INSERT INTO chat_ownership_history
      (resource_type, ${resolvedResourceType === 'conversation' ? 'conversation_id' : 'visitor_session_id'}, action, from_operator_id, to_operator_id, changed_by, note)
     VALUES ($1, $2, 'transfer', $3, $4, $5, $6)`,
    [resolvedResourceType, sessionId, previousOperatorId, to_operator_id, req.user.id, note || null]
  );

  // System message (only for conversations — visitor_chat_sessions has separate message pipeline)
  if (resolvedResourceType === 'conversation') {
    let transferMsg = `Чат передан от ${fromName} к ${toName}`;
    if (note) transferMsg += `: ${note}`;
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
       VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
      [sessionId, transferMsg]
    );
  }

  // WebSocket broadcast
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const io = socketServer.getIO();
    io.to('admin:visitor-chats').emit('chat:transferred', {
      sessionId,
      resource_type: resolvedResourceType,
      fromOperatorId: req.user.id,
      fromOperatorName: fromName,
      toOperatorId: to_operator_id,
      toOperatorName: toName,
      note: note || null,
    });
    io.to(`user:${to_operator_id}`).emit('chat:assigned-to-you', {
      sessionId,
      resource_type: resolvedResourceType,
      assigned_by_name: fromName,
      note: note || null,
      mode: 'transfer',
    });
  }

  logAudit({ userId: req.user.id, userName: fromName, action: 'chat_transfer', entityType: 'chat', entityId: sessionId, details: { toOperatorId: to_operator_id, toName, note, resourceType: resolvedResourceType }, ip: req.ip });

  // CRM inbox event: transfer (assignment changed) — conversations only
  if (resolvedResourceType === 'conversation') {
    enqueueCrmEvent('chat', sessionId, 'assignment_changed', {
      assigned_to: to_operator_id,
      assigned_to_name: toName,
      status: 'active',
      priority: 3,
    }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
  }

  res.json({ success: true, data: { ...updatedRow, resource_type: resolvedResourceType } });
});

/**
 * Взять чат в приватный режим (скрыть от других операторов)
 * POST /admin/sessions/:sessionId/claim-private
 * body: { note?: string, resource_type?: 'conversation' | 'visitor_session' }
 */
router.post('/admin/sessions/:sessionId/claim-private', authenticateToken, requirePermission('chat:claim'), idempotent(60), validate(claimPrivateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }

  const { sessionId } = req.params;
  const { note, resource_type: requestedResourceType } = req.body;

  // Autodetect + race-safe UPDATE. Skip 409 for self-claim (allow repeat without error).
  let resolvedResourceType: 'conversation' | 'visitor_session' | null = null;
  let updatedRow: ChatResourcePrivacyRow | null = null;

  if (requestedResourceType !== 'visitor_session') {
    // Claim-private = operator takes exclusive ownership: lock ai_agent to operator mode (idempotent).
    const r = await pool.query<ChatResourcePrivacyRow>(
      `UPDATE conversations
       SET is_private = true, assigned_operator_id = $2, updated_at = NOW(),
           ai_agent_mode = 'operator',
           ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()),
           ai_agent_mode_set_by = 'operator:' || $2::text
       WHERE id = $1
         AND (is_private = false OR assigned_operator_id = $2)
       RETURNING *`,
      [sessionId, req.user.id]
    );
    // TODO: cancel in-flight debounce ai-turn job after S3 (ai-turn-worker) is ready
    if (r.rows.length) {
      resolvedResourceType = 'conversation';
      updatedRow = r.rows[0];
    } else {
      // Check if conversation exists but privatized by someone else
      const exists = await pool.query<ChatResourcePrivacyRow>('SELECT id, is_private, assigned_operator_id FROM conversations WHERE id = $1', [sessionId]);
      if (exists.rows.length) {
        if (exists.rows[0].is_private) {
          throw new AppError(409, 'Чат уже в приватном режиме у другого оператора');
        }
      }
    }
  }
  if (!resolvedResourceType && requestedResourceType !== 'conversation') {
    const r = await pool.query<ChatResourcePrivacyRow>(
      `UPDATE visitor_chat_sessions
       SET is_private = true, assigned_operator_id = $2, updated_at = NOW()
       WHERE id = $1
         AND (is_private = false OR assigned_operator_id = $2)
       RETURNING *`,
      [sessionId, req.user.id]
    );
    if (r.rows.length) {
      resolvedResourceType = 'visitor_session';
      updatedRow = r.rows[0];
    } else {
      const exists = await pool.query<ChatResourcePrivacyRow>('SELECT id, is_private, assigned_operator_id FROM visitor_chat_sessions WHERE id = $1', [sessionId]);
      if (exists.rows.length && exists.rows[0].is_private) {
        throw new AppError(409, 'Сессия уже в приватном режиме у другого оператора');
      }
    }
  }

  if (!resolvedResourceType || !updatedRow) { throw new AppError(404, 'Session not found'); }

  const opRow = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.user.id]);
  const operatorName = opRow.rows[0]?.display_name || opRow.rows[0]?.email || 'Оператор';

  // Ownership history audit
  await pool.query(
    `INSERT INTO chat_ownership_history
      (resource_type, ${resolvedResourceType === 'conversation' ? 'conversation_id' : 'visitor_session_id'}, action, from_operator_id, to_operator_id, changed_by, note)
     VALUES ($1, $2, 'claim-private', NULL, $3, $3, $4)`,
    [resolvedResourceType, sessionId, req.user.id, note || null]
  );

  // System message (conversations only)
  if (resolvedResourceType === 'conversation') {
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
       VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
      [sessionId, `${operatorName} взял чат в приватный режим`]
    );
  }

  logAudit({ userId: req.user.id, userName: operatorName, action: 'chat_claim_private', entityType: 'chat', entityId: sessionId, details: { resourceType: resolvedResourceType, note }, ip: req.ip });

  // WebSocket: admins видят смену privacy в общем канале, а targeted removal — прочим операторам (managers, employees), кроме меня
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const io = socketServer.getIO();
    io.to('admin:visitor-chats').emit('chat:privacy-changed', {
      sessionId,
      resource_type: resolvedResourceType,
      is_private: true,
      assigned_operator_id: req.user.id,
      assigned_operator_name: operatorName,
      assigned_by_name: operatorName,
    });
    // Targeted — все non-admin operators кроме меня теряют этот чат из инбокса
    const ops = await pool.query(
      `SELECT id FROM users
       WHERE role IN ('manager', 'employee') AND is_active = true AND is_system = false
         AND id != $1`,
      [req.user.id]
    );
    for (const op of ops.rows) {
      io.to(`user:${op.id}`).emit('chat:removed-from-inbox', {
        sessionId,
        resource_type: resolvedResourceType,
        reason: 'private',
      });
    }
  }

  res.json({ success: true, data: { ...updatedRow, resource_type: resolvedResourceType } });
});

/**
 * Вернуть чат в общий доступ (снять приватность)
 * POST /admin/sessions/:sessionId/release-private
 * body: { note?: string, resource_type?: 'conversation' | 'visitor_session' }
 */
router.post('/admin/sessions/:sessionId/release-private', authenticateToken, requirePermission('chat:claim'), idempotent(60), validate(releasePrivateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }

  const { sessionId } = req.params;
  const { note, resource_type: requestedResourceType } = req.body;

  // Autodetect current record
  let resolvedResourceType: 'conversation' | 'visitor_session' | null = null;
  let currentRow: ChatResourcePrivacyRow | null = null;

  if (requestedResourceType !== 'visitor_session') {
    const r = await pool.query<ChatResourcePrivacyRow>('SELECT id, is_private, assigned_operator_id FROM conversations WHERE id = $1', [sessionId]);
    if (r.rows.length) {
      resolvedResourceType = 'conversation';
      currentRow = r.rows[0];
    }
  }
  if (!resolvedResourceType && requestedResourceType !== 'conversation') {
    const r = await pool.query<ChatResourcePrivacyRow>('SELECT id, is_private, assigned_operator_id FROM visitor_chat_sessions WHERE id = $1', [sessionId]);
    if (r.rows.length) {
      resolvedResourceType = 'visitor_session';
      currentRow = r.rows[0];
    }
  }

  if (!resolvedResourceType || !currentRow) { throw new AppError(404, 'Session not found'); }

  // Only owner or admin can release privacy
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && currentRow.assigned_operator_id !== req.user.id) {
    throw new AppError(403, 'Только текущий владелец или админ может снять приватность');
  }

  const table = resolvedResourceType === 'conversation' ? 'conversations' : 'visitor_chat_sessions';
  const updated = await pool.query(
    `UPDATE ${table} SET is_private = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [sessionId]
  );

  const opRow = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.user.id]);
  const operatorName = opRow.rows[0]?.display_name || opRow.rows[0]?.email || 'Оператор';

  // Ownership history audit
  await pool.query(
    `INSERT INTO chat_ownership_history
      (resource_type, ${resolvedResourceType === 'conversation' ? 'conversation_id' : 'visitor_session_id'}, action, from_operator_id, to_operator_id, changed_by, note)
     VALUES ($1, $2, 'release-private', $3, NULL, $4, $5)`,
    [resolvedResourceType, sessionId, currentRow.assigned_operator_id, req.user.id, note || null]
  );

  // System message (conversations only)
  if (resolvedResourceType === 'conversation') {
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
       VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
      [sessionId, `${operatorName} вернул чат в общий доступ`]
    );
  }

  logAudit({ userId: req.user.id, userName: operatorName, action: 'chat_release_private', entityType: 'chat', entityId: sessionId, details: { resourceType: resolvedResourceType, note, wasOwner: currentRow.assigned_operator_id }, ip: req.ip });

  // WebSocket: privacy снят, чат снова виден всем
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('chat:privacy-changed', {
      sessionId,
      resource_type: resolvedResourceType,
      is_private: false,
      assigned_operator_id: currentRow.assigned_operator_id,
      assigned_operator_name: null,
      assigned_by_name: operatorName,
    });
  }

  res.json({ success: true, data: { ...updated.rows[0], resource_type: resolvedResourceType } });
});

/**
 * Получить корзину сессии (для операторов)
 * GET /admin/sessions/:sessionId/cart
 */
router.get('/admin/sessions/:sessionId/cart', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const result = await pool.query(
    `SELECT metadata FROM conversations WHERE id = $1`,
    [sessionId]
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }
  const metadata = result.rows[0].metadata || {};
  res.json({ success: true, data: metadata.cart || null });
});

/**
 * Обновить корзину сессии (для операторов)
 * PUT /admin/sessions/:sessionId/cart
 */
router.put('/admin/sessions/:sessionId/cart', authenticateToken, validate(updateCartSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { items } = req.body;

  const cart = { items, updatedAt: new Date().toISOString(), updatedBy: 'operator' };

  const result = await pool.query(
    `UPDATE conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cart', $2::jsonb)
     WHERE id = $1
     RETURNING metadata`,
    [sessionId, JSON.stringify(cart)]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  // Notify visitor via WebSocket
  const io = req.app.socketServer?.getIO();
  if (io) {
    io.to(`visitor:${sessionId}`).emit('operator:cart-update', { sessionId, items });
    io.to('admin:visitor-chats').emit('admin:cart-updated', { sessionId, items });
  }

  res.json({ success: true, data: cart });
});

/**
 * Сгенерировать ссылку на оплату (для операторов)
 * POST /admin/sessions/:sessionId/payment-link
 */
router.post('/admin/sessions/:sessionId/payment-link', authenticateToken, validate(paymentLinkSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { description } = req.body;

  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }
  const operatorId = req.user.id;

  // Read cart from session metadata
  const sessionResult = await pool.query(
    `SELECT metadata, visitor_name, visitor_phone FROM conversations WHERE id = $1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  const session = sessionResult.rows[0];
  const cart = session.metadata?.cart;
  if (!cart || !cart.items || cart.items.length === 0) {
    throw new AppError(400, 'Cart is empty');
  }

  // Waterfall v2: пересчёт через pricing engine для items с serviceOptionId
  type CartItemShape = { serviceOptionId?: string; price: number; nextPrice?: number; quantity: number; name: string };
  const wfItems: PriceWaterfallInput['items'] = [];
  let manualSum = 0;
  for (const item of cart.items as CartItemShape[]) {
    if (item.serviceOptionId) {
      wfItems.push({ serviceOptionId: item.serviceOptionId, quantity: item.quantity || 1 });
    } else {
      manualSum += item.price + (item.nextPrice ?? item.price) * Math.max(0, (item.quantity || 1) - 1);
    }
  }
  let total: number;
  if (wfItems.length > 0) {
    const wfResult = await calculatePriceWaterfall({
      items: wfItems, customerPhone: session.visitor_phone || undefined, channel: 'crm',
    });
    total = wfResult.total + manualSum;
    log.info('[payment-link] Waterfall v2', { sessionId, wfTotal: wfResult.total, manualSum, savings: wfResult.savings });
  } else {
    total = manualSum;
  }

  const activePaymentShift = await db.transaction((client) =>
    requireActiveEmployeeShiftForPaymentLink(client, operatorId),
  );

  // Generate order ID
  const orderCount = await pool.query(
    `SELECT COUNT(*) FROM photo_print_orders WHERE chat_session_id = $1`,
    [sessionId]
  );
  const orderNum = parseInt(orderCount.rows[0].count, 10) + 1;
  const orderId = `chat-${sessionId.substring(0, 8)}-${orderNum}`;

  // Create order in photo_print_orders
  const itemsJson = JSON.stringify(cart.items.map((item: { name: string; price: number; quantity: number }) => ({
    name: item.name, price: item.price, quantity: item.quantity,
  })));

  const orderInsertResult = await pool.query(
    `INSERT INTO photo_print_orders
      (order_id, mode, total_price, status, payment_status, contact_name, contact_phone, items, chat_session_id, initiated_by, assigned_employee_id, employee_shift_id)
     VALUES ($1, 'simple', $2, 'pending_payment', 'none', $3, $4, $5, $6, $7, $7, $8)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, total, session.visitor_name || '', session.visitor_phone || '', itemsJson, sessionId, operatorId, activePaymentShift.id]
  );
  recordBusinessEvent({
    domain: 'chat',
    event: 'operator_payment_order.created',
    outcome: 'success',
    severity: 'info',
    actorId: operatorId,
    entityType: 'photo_print_order',
    entityId: orderId,
    orderId,
    chatSessionId: sessionId,
    metadata: {
      source: 'operator_payment_link',
      totalPrice: total,
      itemCount: cart.items.length,
      inserted: (orderInsertResult.rowCount ?? 0) > 0,
      employeeShiftId: activePaymentShift.id,
    },
  });

  // Build widget payment button
  const desc = description || cart.items.map((i: { name: string }) => i.name).join(', ');
  const interactive = {
    type: 'buttons',
    step: 'operator_payment',
    buttons: [buildWidgetPaymentButton(orderId, total, desc)],
  };

  // Build item lines for enriched message
  const itemLines = cart.items
    .map((item: { name: string; price: number; nextPrice?: number; quantity: number }) => {
      const itemTotal = item.price + (item.nextPrice ?? item.price) * Math.max(0, item.quantity - 1);
      const qty = item.quantity > 1 ? ` \u00d7${item.quantity}` : '';
      return `\u2022 ${item.name}${qty} \u2014 ${itemTotal}\u20BD`;
    })
    .join('\n');

  // Send system message in chat with payment button
  const linkMsg = `\u{1F4B3} \u0421\u0447\u0451\u0442 \u043D\u0430 \u043E\u043F\u043B\u0430\u0442\u0443: ${total}\u20BD\n\n${itemLines}`;
  const paymentMeta = {
    orderId,
    amount: total,
    status: 'pending' as const,
    items: cart.items.map((item: { name: string; price: number; nextPrice?: number; quantity: number }) => ({
      name: item.name,
      price: item.price + (item.nextPrice ?? item.price) * Math.max(0, item.quantity - 1),
      qty: item.quantity,
    })),
  };
  await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)`,
    [sessionId, linkMsg, JSON.stringify({ interactive, payment: paymentMeta })]
  );

  // Notify visitor via WebSocket
  const io = req.app.socketServer?.getIO();
  if (io) {
    io.to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId,
      content: linkMsg,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'interactive',
      interactive,
      timestamp: new Date(),
    });

    // Broadcast to CRM operators
    broadcastChatMessage({
      sessionId,
      message: {
        sender_type: 'bot',
        sender_name: 'Своё Фото',
        content: linkMsg,
        message_type: 'interactive',
        metadata: JSON.stringify({ interactive, payment: paymentMeta }),
        created_at: new Date(),
      },
    }).catch(err => log.error('[chat-admin] broadcastChatMessage failed (payment-link)', { error: String(err) }));
  }

  res.json({ success: true, data: { paymentUrl: null, orderId, amount: total, mode: 'widget' } });
});

/**
 * Пометить сообщения visitor как прочитанные оператором
 * PUT /admin/sessions/:sessionId/mark-read
 */
router.put('/admin/sessions/:sessionId/mark-read', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  const result = await pool.query(
    `UPDATE messages
     SET is_read = true, read_at = NOW()
     WHERE conversation_id = $1 AND sender_type = 'visitor' AND is_read = false
     RETURNING id, client_message_id`,
    [sessionId]
  );

  const updatedIds = result.rows.map((r: { id: string }) => r.id);
  const updatedClientIds = result.rows
    .map((r: { client_message_id?: string | null }) => r.client_message_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  // Reset denormalized unread_count
  if (updatedIds.length > 0) {
    await pool.query(
      `UPDATE conversations SET unread_count = 0 WHERE id = $1`,
      [sessionId]
    );

    // Broadcast to visitor — they can show "прочитано" checkmarks
    const socketServer = req.app.socketServer;
    if (socketServer) {
      socketServer.getIO().to(`visitor:${sessionId}`).emit('message:status-update', {
        sessionId,
        messageIds: updatedIds,
        clientMessageIds: updatedClientIds,
        status: 'read',
      });
    }
  }

  res.json({ success: true, data: { markedCount: updatedIds.length } });
});

/**
 * Поиск по архивным сессиям (для юридических целей)
 * GET /admin/sessions/archive?search=...
 */
router.get('/admin/sessions/archive', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const search = (req.query['search'] as string || '').trim();
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);

  // Privacy filter: archive inherits privacy — other operators don't see foreign private chats.
  // conversations_archive is a snapshot of conversations; is_private column exists via same table copy
  // or conversations_archive may not carry is_private — we defensively coalesce to false.
  let rows;
  const canSeeAll = hasPermission(req.user.role, 'inbox:all_chats');
  if (search) {
    rows = await db.query(
      `SELECT s.*, s.message_count, s.last_message_content AS last_message
       FROM conversations_archive s
       WHERE (s.visitor_name ILIKE '%' || $1 || '%'
          OR s.visitor_phone ILIKE '%' || $1 || '%'
          OR s.visitor_email ILIKE '%' || $1 || '%')
         AND (COALESCE(s.is_private, false) = false OR s.assigned_operator_id = $2 OR $3 = true)
       ORDER BY s.created_at DESC LIMIT $4`,
      [search, req.user.id, canSeeAll, limit]
    );
  } else {
    rows = await db.query(
      `SELECT s.*, s.message_count, s.last_message_content AS last_message
       FROM conversations_archive s
       WHERE (COALESCE(s.is_private, false) = false OR s.assigned_operator_id = $1 OR $2 = true)
       ORDER BY s.created_at DESC LIMIT $3`,
      [req.user.id, canSeeAll, limit]
    );
  }

  res.json({ success: true, data: rows });
});

/**
 * Поиск по сообщениям в сессии
 * GET /admin/sessions/:sessionId/messages/search?q=...&limit=20
 */
router.get('/admin/sessions/:sessionId/messages/search', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const q = (req.query['q'] as string || '').trim();
  const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 50);

  if (!q) {
    res.json({ success: true, data: [] });
    return;
  }

  const results = await pool.query(
    `SELECT id, content, sender_name, sender_type, created_at
     FROM messages
     WHERE conversation_id = $1 AND content ILIKE '%' || $2 || '%' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT $3`,
    [sessionId, q, limit]
  );

  res.json({ success: true, data: results.rows });
});

// ─── FOLLOW-UP / SNOOZE ──────────────────────────────
/**
 * POST /admin/sessions/:sessionId/followup
 * Создать follow-up напоминание для чата
 */
router.post('/admin/sessions/:sessionId/followup', authenticateToken, validate(followupSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { follow_up_at, note } = req.body;

  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const followUpDate = new Date(follow_up_at);
  if (followUpDate <= new Date()) {
    throw new AppError(400, 'follow_up_at must be in the future');
  }

  // Cancel any pending followups for this session by this operator
  await pool.query(
    `UPDATE chat_followups SET status = 'cancelled'
     WHERE session_id = $1 AND operator_id = $2 AND status = 'pending'`,
    [sessionId, req.user.id],
  );

  const result = await pool.query<Pick<ChatFollowups, 'id' | 'follow_up_at' | 'note'>>(
    `INSERT INTO chat_followups (session_id, operator_id, follow_up_at, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, follow_up_at, note`,
    [sessionId, req.user.id, followUpDate.toISOString(), note?.trim() || null],
  );

  logAudit({
    userId: req.user.id,
    userName: req.user.email,
    action: 'followup_created',
    entityType: 'chat',
    entityId: sessionId,
    details: { followUpAt: follow_up_at, note },
  });

  res.json({ success: true, data: result.rows[0] });
});

/**
 * DELETE /admin/sessions/:sessionId/followup/:followupId
 * Отменить follow-up
 */
router.delete('/admin/sessions/:sessionId/followup/:followupId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  await pool.query(
    `UPDATE chat_followups SET status = 'cancelled'
     WHERE id = $1 AND session_id = $2 AND operator_id = $3 AND status = 'pending'`,
    [req.params['followupId'], req.params['sessionId'], req.user.id],
  );

  res.json({ success: true });
});

/**
 * GET /admin/sessions/:sessionId/followup
 * Получить активный follow-up для сессии текущего оператора
 */
router.get('/admin/sessions/:sessionId/followup', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const rows = await pool.query<Pick<ChatFollowups, 'id' | 'follow_up_at' | 'note'>>(
    `SELECT id, follow_up_at, note FROM chat_followups
     WHERE session_id = $1 AND operator_id = $2 AND status = 'pending'
     ORDER BY follow_up_at ASC LIMIT 1`,
    [req.params['sessionId'], req.user.id],
  );

  res.json({ success: true, data: rows.rows[0] || null });
});

// ─── QUICK REPLIES CRUD ──────────────────────────────

/**
 * Создать быстрый ответ
 * POST /admin/quick-replies
 */
router.post('/admin/quick-replies', authenticateToken, validate(createQuickReplySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { title, content, category } = req.body;

  const result = await pool.query(
    `INSERT INTO chat_quick_replies (title, content, category, created_by, is_active, sort_order)
     VALUES ($1, $2, $3, $4, true, COALESCE((SELECT MAX(sort_order) + 1 FROM chat_quick_replies), 0))
     RETURNING *`,
    [title.trim(), content.trim(), category?.trim() || null, req.user.id]
  );

  res.json({ success: true, data: result.rows[0] });
});

/**
 * Обновить быстрый ответ
 * PUT /admin/quick-replies/:id
 */
router.put('/admin/quick-replies/:id', authenticateToken, validate(updateQuickReplySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { id } = req.params;
  const { title, content, category, sort_order } = req.body;

  const result = await pool.query(
    `UPDATE chat_quick_replies
     SET title = COALESCE($2, title),
         content = COALESCE($3, content),
         category = COALESCE($4, category),
         sort_order = COALESCE($5, sort_order),
         updated_at = NOW()
     WHERE id = $1 AND is_active = true
     RETURNING *`,
    [id, title?.trim(), content?.trim(), category?.trim(), sort_order]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Quick reply not found');
  }

  res.json({ success: true, data: result.rows[0] });
});

/**
 * Удалить быстрый ответ (soft-delete)
 * DELETE /admin/quick-replies/:id
 */
router.delete('/admin/quick-replies/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE chat_quick_replies SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true RETURNING id`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Quick reply not found');
  }

  res.json({ success: true });
});

// ============================================================================
// Client / Booking linking
// ============================================================================

/**
 * Привязать клиента к чат-сессии
 * PUT /admin/sessions/:sessionId/link-client
 */
router.put('/admin/sessions/:sessionId/link-client', authenticateToken, validate(linkClientSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { sessionId } = req.params;
  const { userId } = req.body;

  // Verify user exists
  const userRes = await pool.query(`SELECT id, display_name, phone FROM users WHERE id = $1 AND is_active = TRUE`, [userId]);
  if (!userRes.rows.length) { throw new AppError(404, 'User not found'); }

  const conversationBefore = await db.queryOne<ConversationIdentityAuditRow>(
    `SELECT id, user_id, contact_id, channel, external_chat_id, visitor_id
     FROM conversations WHERE id = $1`,
    [sessionId],
  );
  const updateResult = await pool.query<ConversationIdentityAuditRow>(
    `UPDATE conversations SET user_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, user_id, contact_id, channel, external_chat_id, visitor_id`,
    [userId, sessionId]
  );

  const user = userRes.rows[0];
  const auditRequest = getIdentityLinkRequestContext(req);
  const linkedConversation = updateResult.rows[0];
  if (linkedConversation) {
    await logIdentityLinkEvent({
      action: 'identity_link_chat',
      source: 'chat_admin_link_client',
      entityType: 'conversation',
      entityId: linkedConversation.id,
      actorUserId: req.user.id,
      actorUserName: req.user.display_name ?? req.user.email ?? null,
      actorRole: req.user.role,
      ip: auditRequest.ip,
      userAgent: auditRequest.userAgent,
      conversationId: linkedConversation.id,
      contactId: linkedConversation.contact_id,
      channel: linkedConversation.channel,
      externalChatId: linkedConversation.external_chat_id,
      visitorId: linkedConversation.visitor_id,
      previousUserId: conversationBefore?.user_id ?? null,
      newUserId: userId,
      reason: 'operator_manual_link_client',
      result: 'linked',
    });
  } else {
    await logIdentityLinkEvent({
      action: 'identity_link_skipped',
      source: 'chat_admin_link_client',
      entityType: 'conversation',
      entityId: sessionId,
      actorUserId: req.user.id,
      actorUserName: req.user.display_name ?? req.user.email ?? null,
      actorRole: req.user.role,
      ip: auditRequest.ip,
      userAgent: auditRequest.userAgent,
      conversationId: sessionId,
      previousUserId: conversationBefore?.user_id ?? null,
      newUserId: userId,
      reason: 'conversation_missing_for_manual_link',
      result: 'failed',
    });
  }

  // Broadcast to operators
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('chatClientLinked', {
      sessionId,
      userId,
      clientName: user.display_name,
      clientPhone: user.phone,
      bookingId: null,
    });
  }

  logAudit({ userId: req.user.id, action: 'chat_link_client', entityType: 'chat_session', entityId: sessionId, details: { linkedUserId: userId } });
  res.json({ success: true, data: { userId, clientName: user.display_name, clientPhone: user.phone } });
});

/**
 * Привязать запись к чат-сессии
 * PUT /admin/sessions/:sessionId/link-booking
 */
router.put('/admin/sessions/:sessionId/link-booking', authenticateToken, validate(linkBookingSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { sessionId } = req.params;
  const { bookingId } = req.body;

  // Verify booking exists
  const bkRes = await pool.query(
    `SELECT b.id, b.start_time, b.status, b.service_name
     FROM bookings b
     WHERE b.id = $1`,
    [bookingId]
  );
  if (!bkRes.rows.length) { throw new AppError(404, 'Booking not found'); }

  await pool.query(
    `UPDATE conversations SET booking_id = $1, updated_at = NOW() WHERE id = $2`,
    [bookingId, sessionId]
  );

  const booking = bkRes.rows[0];

  const socketServer2 = req.app.socketServer;
  if (socketServer2) {
    socketServer2.getIO().to('admin:visitor-chats').emit('chatClientLinked', {
      sessionId,
      bookingId,
      bookingService: booking.service_name,
      bookingDate: booking.start_time,
      bookingStatus: booking.status,
    });
  }

  logAudit({ userId: req.user.id, action: 'chat_link_booking', entityType: 'chat_session', entityId: sessionId, details: { bookingId } });
  res.json({ success: true, data: booking });
});

/**
 * F70: Обновить телефон посетителя (из CRM inline input)
 * PUT /admin/sessions/:sessionId/phone
 */
router.put('/admin/sessions/:sessionId/phone', authenticateToken, validate(updateVisitorPhoneSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { throw new AppError(401, 'Unauthorized'); }
  const { sessionId } = req.params;
  const { phone } = req.body;

  // Normalize: remove spaces and dashes, keep + and digits
  const normalized = phone.replace(/[\s()-]/g, '');

  const result = await pool.query(
    `UPDATE conversations
     SET visitor_phone = $1,
         metadata = COALESCE(metadata, '{}'::jsonb) || '{"phoneSource": "crm_manual"}'::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, visitor_phone`,
    [normalized, sessionId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  // Broadcast phone update to other operators
  emitPhoneUpdate(req, sessionId, normalized);

  // Auto-link session to client by phone (fire-and-forget with logging)
  autoLinkSessionToClient(sessionId).catch(err =>
    log.warn('autoLinkSessionToClient failed after phone update', { sessionId, error: String(err) }),
  );

  logAudit({ userId: req.user.id, action: 'chat_update_phone', entityType: 'chat_session', entityId: sessionId, details: { phone: normalized } });
  res.json({ success: true, data: { phone: normalized } });
});

/**
 * Получить подсказки клиентов для привязки
 * GET /admin/sessions/:sessionId/suggested-clients
 */
router.get('/admin/sessions/:sessionId/suggested-clients', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
  const result = q
    ? await searchClientsByQuery(q, sessionId)
    : await suggestClientsForSession(sessionId);
  res.json({ success: true, data: result });
});

/**
 * Скачать файл из сообщения (stream через сервер с правильными заголовками)
 * GET /admin/files/:messageId/download
 * Решает проблему: cross-origin S3 presigned URLs игнорируют атрибут download.
 */
router.get('/admin/files/:messageId/download', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { messageId } = req.params;

  interface FileDownloadRow {
    id: Pick<Messages, 'id'>['id'];
    attachment_url: string | null;
    content: Pick<Messages, 'content'>['content'];
    message_type: Pick<Messages, 'message_type'>['message_type'];
    original_file_name: Pick<MediaAttachments, 'file_name'>['file_name'];
    detected_mime: Pick<MediaAttachments, 'mime_type'>['mime_type'] | null;
  }

  const msgResult = await pool.query<FileDownloadRow>(
    `SELECT m.id, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url, m.content, m.message_type,
            ma.file_name AS original_file_name, ma.mime_type AS detected_mime
     FROM messages m
     LEFT JOIN media_attachments ma ON ma.message_id = m.id
     WHERE m.id = $1`,
    [messageId],
  );

  if (!msgResult.rows.length || !msgResult.rows[0].attachment_url) {
    throw new AppError(404, 'Message or attachment not found');
  }

  const row = msgResult.rows[0];
  const attachmentUrl = row.attachment_url!;

  // Determine filename: media_attachments.file_name → URL basename (if has extension) → content → fallback
  const urlBasename = attachmentUrl.split('/').pop()?.split('?')[0] || '';
  const urlHasExt = /\.\w{1,10}$/.test(urlBasename);
  let filename = row.original_file_name
    || (urlHasExt ? urlBasename : null)
    || (row.content && !/^\[/.test(row.content.trim()) && row.content !== attachmentUrl
        && !row.content.includes('\n') && row.content.length < 60
        ? row.content.replace(/[/\\:*?"<>|]/g, '_') : null)
    || (urlHasExt ? urlBasename : null)
    || 'file';

  // Determine MIME type: media_attachments → extension-based refinement → octet-stream
  // application/zip is ambiguous — Office docs (.docx/.xlsx/.pptx) are ZIP containers,
  // so treat it the same as missing MIME and resolve from filename extension.
  const EXT_MIME: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword',
    xls: 'application/vnd.ms-excel',
    ppt: 'application/vnd.ms-powerpoint',
    pdf: 'application/pdf',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    txt: 'text/plain', csv: 'text/csv', html: 'text/html', json: 'application/json',
  };
  let mimeType = row.detected_mime || null;
  const needsExtFallback = !mimeType || mimeType === 'application/octet-stream' || mimeType === 'application/zip';
  if (needsExtFallback) {
    // Try extension from filename first, then from URL basename
    const extMatch = filename.match(/\.(\w+)$/) || urlBasename.match(/\.(\w+)$/);
    if (extMatch) {
      const extMime = EXT_MIME[extMatch[1].toLowerCase()];
      if (extMime) mimeType = extMime;
    }
  }
  if (!mimeType) mimeType = 'application/octet-stream';

  // WebP/HEIC → JPEG conversion for photo studio workflow
  const sourceMimeType = mimeType;
  const convertToJpeg = needsJpegConversion(sourceMimeType, attachmentUrl);
  if (convertToJpeg) {
    mimeType = 'image/jpeg';
    filename = replaceExtForJpeg(filename);
  }

  // Ensure filename has an extension — content-based filenames (e.g. from interactive messages) may lack one
  if (!/\.\w{1,10}$/.test(filename) && mimeType !== 'application/octet-stream') {
    const MIME_EXT: Record<string, string> = Object.fromEntries(
      Object.entries(EXT_MIME).map(([ext, mime]) => [mime, ext]),
    );
    const ext = MIME_EXT[mimeType];
    if (ext) filename = `${filename}.${ext}`;
  }

  // Try S3 key first (most files are in S3)
  const s3Key = storageService.keyFromUrl(attachmentUrl);
  if (s3Key) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    if (convertToJpeg) {
      const { buffer } = await storageService.downloadToBuffer(s3Key);
      const jpeg = await convertImageBufferToJpeg(buffer, sourceMimeType, attachmentUrl);
      res.end(jpeg);
    } else {
      const stream = await storageService.getReadStream(s3Key);
      stream.pipe(res);
    }
    return;
  }

  // Local file fallback
  if (attachmentUrl.startsWith('/uploads/')) {
    const localPath = path.resolve(process.cwd(), attachmentUrl.replace(/^\//, ''));
    if (!localPath.startsWith(process.cwd() + path.sep)) {
      throw new AppError(403, 'Invalid path');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    if (convertToJpeg) {
      const source = await fs.promises.readFile(localPath);
      const jpeg = await convertImageBufferToJpeg(source, sourceMimeType, attachmentUrl);
      res.end(jpeg);
    } else {
      res.sendFile(localPath);
    }
    return;
  }

  throw new AppError(400, 'Unsupported attachment URL');
});

// ============================================================================
// Media download for operators (JWT-protected, bypasses HMAC session token)
// ============================================================================

const BASE_DIR = process.cwd();
// SSRF whitelist — centralized in media-domains.ts

function safePath(relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\//, '');
  const resolved = path.resolve(BASE_DIR, cleaned);
  if (!resolved.startsWith(BASE_DIR + path.sep) && resolved !== BASE_DIR) {
    return null;
  }
  return resolved;
}

async function appendFileToArchive(
  archive: archiver.Archiver,
  url: string,
  archiveName: string,
  convertToJpeg = false,
  mimeType?: string | null,
): Promise<void> {
  if (url.startsWith('/uploads/')) {
    const localPath = safePath(url);
    if (localPath && fs.existsSync(localPath)) {
      if (convertToJpeg) {
        const source = await fs.promises.readFile(localPath);
        const jpeg = await convertImageBufferToJpeg(source, mimeType, url);
        archive.append(jpeg, { name: archiveName });
      } else {
        archive.file(localPath, { name: archiveName });
      }
    }
    return;
  }

  // For S3 URLs — use SDK directly (no public URL dependency)
  const s3Key = storageService.keyFromUrl(url);
  if (s3Key) {
    if (convertToJpeg) {
      const { buffer } = await storageService.downloadToBuffer(s3Key);
      const jpeg = await convertImageBufferToJpeg(buffer, mimeType, url);
      archive.append(jpeg, { name: archiveName });
    } else {
      const stream = await storageService.getReadStream(s3Key);
      await appendReadableToArchive(archive, stream, archiveName);
    }
    return;
  }

  // Fallback for non-S3 external URLs (e.g. legacy data)
  const parsed = new URL(url);
  if (!isAllowedMediaDomain(parsed.hostname)) {
    return;
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
  let buf = Buffer.from(response.data);
  if (convertToJpeg) {
    buf = await convertImageBufferToJpeg(buf, mimeType, url);
  }
  archive.append(buf, { name: archiveName });
}

/** Reject if the wrapped promise does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Resolved payload ready to be appended to an archive. Downloading/converting
 * (the slow, blocking part) happens off the archive's serial entry queue so it
 * can be parallelised; appending the resolved payload is cheap and serial.
 */
type ArchivePayload =
  | { kind: 'localPath'; path: string }
  | { kind: 'buffer'; buffer: Buffer };

/**
 * Download (and optionally JPEG-convert) a single file into a payload that can
 * be appended to the archive. Buffers S3/HTTP sources so no stream stays open
 * across the parallel download phase. Returns null if the source is missing or
 * not an allowed location.
 */
async function loadFilePayload(
  url: string,
  convertToJpeg: boolean,
  mimeType?: string | null,
): Promise<ArchivePayload | null> {
  if (url.startsWith('/uploads/')) {
    const localPath = safePath(url);
    if (!localPath || !fs.existsSync(localPath)) return null;
    if (convertToJpeg) {
      const source = await fs.promises.readFile(localPath);
      const jpeg = await convertImageBufferToJpeg(source, mimeType, url);
      return { kind: 'buffer', buffer: jpeg };
    }
    // archiver reads the file lazily on finalize — cheap, keep as path
    return { kind: 'localPath', path: localPath };
  }

  const s3Key = storageService.keyFromUrl(url);
  if (s3Key) {
    const { buffer } = await storageService.downloadToBuffer(s3Key);
    const out = convertToJpeg ? await convertImageBufferToJpeg(buffer, mimeType, url) : buffer;
    return { kind: 'buffer', buffer: out };
  }

  // Fallback for non-S3 external URLs (e.g. legacy data)
  const parsed = new URL(url);
  if (!isAllowedMediaDomain(parsed.hostname)) return null;
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
  let buf = Buffer.from(response.data);
  if (convertToJpeg) buf = await convertImageBufferToJpeg(buf, mimeType, url);
  return { kind: 'buffer', buffer: buf };
}

/** Placeholder patterns that should NOT be used as filenames */
const FILE_NAME_PLACEHOLDERS = /^\[(?:Файл:\s*|Файл|Фото|Видео|Голосовое сообщение|Стикер|Документ)\]$/;

type DownloadRow = Pick<Messages, 'id' | 'sender_type' | 'content' | 'created_at' | 'message_type'> & {
  attachment_url: string;
  original_file_name: Pick<MediaAttachments, 'file_name'>['file_name'];
  detected_mime: Pick<MediaAttachments, 'mime_type'>['mime_type'] | null;
};

/** Build a human-readable archive name for a file row */
function buildArchiveName(row: DownloadRow, index: number): string {
  const convert = needsJpegConversion(row.detected_mime, row.attachment_url);

  // Priority 1: original file name from media_attachments
  if (row.original_file_name) {
    const name = convert ? replaceExtForJpeg(row.original_file_name) : row.original_file_name;
    return `${index}_${name}`;
  }

  // Priority 2: message content if meaningful
  if (row.content && !FILE_NAME_PLACEHOLDERS.test(row.content.trim()) && row.content !== row.attachment_url) {
    // Sanitize content for use as filename
    const sanitized = row.content.replace(/[/\\:*?"<>|]/g, '_').substring(0, 100);
    const effectiveMime = convert ? 'image/jpeg' : row.detected_mime;
    const ext = effectiveMime ? mimeToExt(effectiveMime) : replaceExtForJpeg(extFromUrl(row.attachment_url));
    // Add extension if content doesn't already have one
    if (sanitized.includes('.')) return `${index}_${convert ? replaceExtForJpeg(sanitized) : sanitized}`;
    return `${index}_${sanitized}${ext}`;
  }

  // Priority 3: type-based name with proper extension
  const typeLabel = row.message_type === 'image' ? 'photo'
    : row.message_type === 'video' ? 'video'
    : row.message_type === 'audio' ? 'audio'
    : 'file';
  const effectiveMime = convert ? 'image/jpeg' : row.detected_mime;
  const ext = effectiveMime ? mimeToExt(effectiveMime) : replaceExtForJpeg(extFromUrl(row.attachment_url));
  return `${typeLabel}_${String(index).padStart(3, '0')}${ext}`;
}

function extFromUrl(url: string): string {
  const lastSegment = url.split('/').pop()?.split('?')[0] ?? '';
  const dotIdx = lastSegment.lastIndexOf('.');
  if (dotIdx > 0) return lastSegment.substring(dotIdx);
  return '.bin';
}

/** Message type filter sets for download endpoint */
const TYPE_FILTERS: Record<string, string[]> = {
  images: ['image'],
  documents: ['file'],
  media: ['image', 'video', 'audio'],
  all: ['image', 'file', 'video', 'audio'],
};

/**
 * Скачать все медиа сессии как ZIP (для операторов)
 * GET /admin/sessions/:sessionId/download?type=sent|received&filter=all|images|documents|media
 */
router.get('/admin/sessions/:sessionId/download', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { type } = req.query;
  const filter = typeof req.query['filter'] === 'string' ? req.query['filter'] : 'all';

  const allowedTypes = TYPE_FILTERS[filter] || TYPE_FILTERS['all'];

  // Get visitor name for ZIP folder
  const convResult = await pool.query<Pick<Conversations, 'visitor_name'>>(
    `SELECT visitor_name FROM conversations WHERE id = $1`,
    [sessionId],
  );
  const visitorName = convResult.rows[0]?.visitor_name?.replace(/[/\\:*?"<>|]/g, '_').trim() || 'client';

  let query = `
    SELECT m.id, m.sender_type, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
           m.content, m.created_at, m.message_type,
           ma.file_name AS original_file_name, ma.mime_type AS detected_mime
    FROM messages m
    LEFT JOIN media_attachments ma ON ma.message_id = m.id
    WHERE m.conversation_id = $1
      AND m.message_type = ANY($2::text[])
      AND COALESCE(m.attachment_url, ma.s3_url) IS NOT NULL
      AND m.deleted_at IS NULL
  `;
  const params: unknown[] = [sessionId, allowedTypes];

  if (type === 'sent') {
    query += ` AND m.sender_type = 'visitor'`;
  } else if (type === 'received') {
    query += ` AND m.sender_type IN ('operator', 'bot')`;
  }
  query += ` ORDER BY m.created_at ASC`;

  const result = await pool.query<DownloadRow>(query, params);
  if (result.rows.length === 0) {
    throw new AppError(404, 'No media files found');
  }

  const zipName = `${visitorName}-${sessionId.substring(0, 8)}`;
  const archive = archiver('zip', { zlib: { level: 6 } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}.zip"`);
  archive.pipe(res);

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const prefix = row.sender_type === 'visitor' ? 'original' : 'processed';
    const archiveName = `${visitorName}/${prefix}/${buildArchiveName(row, i + 1)}`;
    try {
      const convert = needsJpegConversion(row.detected_mime, row.attachment_url);
      await appendFileToArchive(archive, row.attachment_url, archiveName, convert, row.detected_mime);
    } catch (err) {
      log.error('[admin download] Failed to add file', { url: row.attachment_url, err: String(err) });
    }
  }

  await archive.finalize();
});

/**
 * Скачать выбранные файлы как ZIP (для операторов)
 * POST /admin/sessions/:sessionId/download-selected
 * Body: { urls: string[] }
 */
router.post('/admin/sessions/:sessionId/download-selected', authenticateToken, validate(downloadSelectedSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { messageIds } = req.body;

  // Get visitor name for ZIP folder
  const convResult = await pool.query<Pick<Conversations, 'visitor_name'>>(
    `SELECT visitor_name FROM conversations WHERE id = $1`,
    [sessionId],
  );
  const visitorName = convResult.rows[0]?.visitor_name?.replace(/[/\\:*?"<>|]/g, '_').trim() || 'client';

  // Fetch messages by IDs (avoids signed-URL mismatch)
  const dbResult = await pool.query<DownloadRow>(
    `SELECT m.id, m.sender_type, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
            m.content, m.created_at, m.message_type,
            ma.file_name AS original_file_name, ma.mime_type AS detected_mime
     FROM messages m
     LEFT JOIN media_attachments ma ON ma.message_id = m.id
     WHERE m.conversation_id = $1 AND m.id = ANY($2::uuid[]) AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC`,
    [sessionId, messageIds]
  );
  const rowsById = new Map(dbResult.rows.map(r => [r.id, r]));

  // Build the ordered list of files to fetch (preserve messageIds order + naming)
  const tasks: { id: string; archiveName: string; url: string; convert: boolean; mime: string | null }[] = [];
  let idx = 0;
  for (const id of messageIds) {
    const row = rowsById.get(id);
    if (!row || !row.attachment_url) continue;
    idx++;
    tasks.push({
      id,
      archiveName: `${visitorName}/${buildArchiveName(row, idx)}`,
      url: row.attachment_url,
      convert: needsJpegConversion(row.detected_mime, row.attachment_url),
      mime: row.detected_mime,
    });
  }

  if (tasks.length === 0) {
    throw new AppError(404, 'No valid files found');
  }

  const zipName = `${visitorName}-selected-${sessionId.substring(0, 8)}`;
  const archive = archiver('zip', { zlib: { level: 6 } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}.zip"`);
  archive.pipe(res);

  // Download (and convert) files in parallel with bounded concurrency so one
  // slow/hung file can no longer block the whole ZIP. Each file has its own
  // timeout; failures are skipped gracefully and replaced with an error marker.
  const PER_FILE_TIMEOUT_MS = 8000;
  const queue = new PQueue({ concurrency: 4 });
  const payloads: (ArchivePayload | null)[] = new Array(tasks.length).fill(null);
  const skipped: string[] = [];

  await Promise.all(
    tasks.map((task, i) =>
      queue.add(async () => {
        try {
          payloads[i] = await withTimeout(
            loadFilePayload(task.url, task.convert, task.mime),
            PER_FILE_TIMEOUT_MS,
            task.archiveName,
          );
          if (payloads[i] === null) skipped.push(task.id);
        } catch (err) {
          skipped.push(task.id);
          log.warn('[admin download-selected] Failed to fetch file', { id: task.id, err: String(err) });
        }
      }),
    ),
  );

  // Append in original order; archiver's entry queue is serial anyway.
  for (let i = 0; i < tasks.length; i++) {
    const payload = payloads[i];
    const task = tasks[i];
    if (!payload) {
      // Graceful skip — leave a marker so the operator sees the file was dropped
      archive.append(
        `Не удалось загрузить файл (пропущен из-за ошибки или таймаута).\nИсходный URL: ${task.url}\n`,
        { name: `${task.archiveName}.НЕ_ЗАГРУЖЕН.txt` },
      );
      continue;
    }
    if (payload.kind === 'localPath') {
      archive.file(payload.path, { name: task.archiveName });
    } else {
      archive.append(payload.buffer, { name: task.archiveName });
    }
  }

  if (skipped.length > 0) {
    log.warn('[admin download-selected] Skipped files', {
      sessionId,
      skippedCount: skipped.length,
      total: tasks.length,
      ids: skipped,
    });
  }

  await archive.finalize();
});

// ============================================================================
// Forward message to another session
// ============================================================================

/**
 * Forward a message to another chat session
 * POST /admin/sessions/:sessionId/forward
 * Body: { messageId: string, content?: string }
 * sessionId = target session
 */
router.post('/admin/sessions/:sessionId/forward', validate(forwardMessageSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { sessionId } = req.params; // target session
  const body: ForwardMessageInput = req.body;

  // 1. Find original message (attachment_url is NOT in Kanel Messages — use view type)
  const originalMsg = await db.queryOne<ForwardSourceMessage>(
    `SELECT id, content, attachment_url, message_type, sender_name, conversation_id
     FROM messages WHERE id = $1`,
    [body.messageId],
  );
  if (!originalMsg) throw new AppError(404, 'Original message not found');

  // 2. Verify target session exists
  const targetSession = await db.queryOne<Pick<Conversations, 'id' | 'visitor_name' | 'visitor_phone' | 'channel' | 'status' | 'assigned_operator_id'>>(
    `SELECT id, visitor_name, visitor_phone, channel, status, assigned_operator_id
     FROM conversations WHERE id = $1`,
    [sessionId],
  );
  if (!targetSession) throw new AppError(404, 'Target session not found');

  // Get operator name
  const opRow = await db.queryOne<OperatorNameRow>(
    `SELECT display_name, email FROM users WHERE id = $1`,
    [req.user.id],
  );
  const operatorName = opRow?.display_name || opRow?.email || 'Оператор';

  // 3. Determine forwarded sender name
  const forwardedFromName = originalMsg.sender_name || 'Неизвестный';

  // 4. Insert forwarded message into target session
  const content = body.content || originalMsg.content;
  const msgResult = await db.queryOne<ForwardedMessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_id, sender_name, message_type, content, attachment_url,
       is_forwarded, forwarded_from_name)
     VALUES ($1, 'operator', $2, $3, $4, $5, $6, true, $7)
     RETURNING id, conversation_id, sender_type, sender_id, sender_name, message_type, content,
               attachment_url, is_forwarded, forwarded_from_name, created_at`,
    [
      sessionId,
      req.user.id,
      operatorName,
      originalMsg.message_type,
      content,
      originalMsg.attachment_url,
      forwardedFromName,
    ],
  );

  if (!msgResult) throw new AppError(500, 'Failed to insert forwarded message');

  // 5. Update denormalized fields on target session
  await pool.query(
    `UPDATE conversations
     SET last_message_at = NOW(),
         last_message_content = LEFT($2, 200),
         message_count = COALESCE(message_count, 0) + 1
     WHERE id = $1`,
    [sessionId, content ? content.substring(0, 190) : ''],
  );

  // 6. Broadcast to admin room — reuse emitPhoneUpdate pattern for safe socket access
  const socketServer = (req.app as Express.Application & { socketServer?: { getIO: () => import('socket.io').Server } }).socketServer;
  if (socketServer) {
    let attachmentUrl = msgResult.attachment_url;
    if (attachmentUrl && storageService.isS3Url(attachmentUrl)) {
      try { attachmentUrl = await storageService.resolveSignedUrl(attachmentUrl); } catch { /* keep original */ }
    }

    broadcastChatMessage({
      sessionId,
      message: { ...msgResult, attachment_url: attachmentUrl },
      session: {
        visitor_name: targetSession.visitor_name,
        visitor_phone: targetSession.visitor_phone,
        channel: targetSession.channel,
        status: targetSession.status || 'active',
        assigned_operator_id: targetSession.assigned_operator_id,
        assigned_operator_name: null,
      },
    }).catch(err => log.error('[chat-admin] broadcastChatMessage failed (forward)', { error: String(err) }));
  }

  logAudit({
    userId: req.user.id,
    userName: operatorName,
    action: 'chat_forward',
    entityType: 'chat',
    entityId: sessionId,
    details: { originalMessageId: body.messageId, fromSession: originalMsg.conversation_id },
    ip: req.ip,
  });

  res.json({ success: true, data: msgResult });
});

// ============================================================================
// F65: Scheduled Messages
// ============================================================================

/**
 * Schedule a message to be sent later
 * POST /admin/sessions/:sessionId/schedule-message
 */
router.post('/admin/sessions/:sessionId/schedule-message', validate(scheduleMessageSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const body: ScheduleMessageInput = req.body;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  const row = await db.queryOne<Pick<ScheduledMessages, 'id' | 'send_at' | 'status' | 'created_at'>>(
    `INSERT INTO scheduled_messages (conversation_id, content, send_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, send_at, status, created_at`,
    [sessionId, sanitizeContent(body.content), body.send_at, userId],
  );

  logAudit({ userId, action: 'scheduled_message_created', entityType: 'scheduled_messages', entityId: row?.id ?? '', details: { sessionId, send_at: body.send_at }, ip: req.ip });

  res.json({ success: true, data: row });
});

/**
 * List scheduled messages for a session
 * GET /admin/sessions/:sessionId/scheduled
 */
router.get('/admin/sessions/:sessionId/scheduled', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;

  const rows = await db.query<Pick<ScheduledMessages, 'id' | 'content' | 'send_at' | 'status' | 'created_by' | 'sent_at' | 'error' | 'created_at'> & { creator_name: string | null }>(
    `SELECT sm.id, sm.content, sm.send_at, sm.status, sm.created_by, sm.sent_at, sm.error, sm.created_at,
            u.display_name AS creator_name
     FROM scheduled_messages sm
     LEFT JOIN users u ON u.id = sm.created_by
     WHERE sm.conversation_id = $1
     ORDER BY sm.send_at ASC`,
    [sessionId],
  );

  res.json({ success: true, data: rows });
});

/**
 * Cancel a scheduled message
 * DELETE /admin/scheduled-messages/:id
 */
router.delete('/admin/scheduled-messages/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  const row = await db.queryOne<Pick<ScheduledMessages, 'id' | 'status'>>(
    `UPDATE scheduled_messages SET status = 'cancelled'
     WHERE id = $1 AND status = 'pending'
     RETURNING id, status`,
    [id],
  );

  if (!row) {
    throw new AppError(404, 'Scheduled message not found or already processed');
  }

  logAudit({ userId, action: 'scheduled_message_cancelled', entityType: 'scheduled_messages', entityId: id, ip: req.ip });

  res.json({ success: true, data: row });
});

/**
 * Удалить исходящее сообщение пульта (из БД + из мессенджера, если уже отправлено)
 * DELETE /admin/sessions/:sessionId/messages/:messageId
 */
router.delete('/admin/sessions/:sessionId/messages/:messageId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, messageId } = req.params;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  // Fetch message
  const msg = await db.queryOne<Pick<Messages, 'id' | 'sender_type' | 'sender_id' | 'external_message_id' | 'content' | 'message_type'>>(
    `SELECT id, sender_type, sender_id, external_message_id, content, message_type
     FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [messageId, sessionId],
  );
  if (!msg) throw new AppError(404, 'Message not found');

  // Operators may delete only outgoing pult messages, never client/history/system messages.
  if (!isOutgoingPultMessage(msg.sender_type)) {
    throw new AppError(403, 'Можно удалять только исходящие сообщения пульта');
  }

  // Get conversation for channel info
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'metadata' | 'external_chat_id'>>(
    `SELECT channel, metadata, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );

  // Delete from external messenger if possible
  const deleteChannel = toConnectorChannel(conv?.channel ?? null);
  if (conv && msg.external_message_id && deleteChannel && deleteChannel !== 'web') {
    try {
      const { getAdapterOrThrow } = await import('../../services/connectors/core/adapter-registry.js');
      const { getAccountByChannel } = await import('../../services/connectors/core/account-store.js');
      const adapter = getAdapterOrThrow(deleteChannel);
      if (adapter.deleteMessage) {
        const externalChatId = getConversationExternalChatId(conv);
        if (!externalChatId) {
          throw new AppError(409, 'У чата нет внешнего ID для удаления в мессенджере');
        }
        const account = await getAccountByChannel(deleteChannel);
        if (!account) {
          throw new AppError(502, 'Аккаунт канала не настроен');
        }
        const result = await adapter.deleteMessage(account, externalChatId, msg.external_message_id);
        if (!result.success) {
          log.warn('External deleteMessage failed', { channel: conv.channel, error: result.errorMessage });
          throw new AppError(502, 'Не удалось удалить сообщение в мессенджере клиента');
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      log.warn('External deleteMessage error', { error: String(err) });
      throw new AppError(502, 'Не удалось удалить сообщение в мессенджере клиента');
    }
  }

  // Soft delete
  await db.query(`UPDATE messages SET deleted_at = NOW() WHERE id = $1`, [messageId]);

  // Update conversation denormalized counters and inbox preview after removing latest messages.
  await refreshConversationMessageSummary(sessionId);

  // Broadcast deletion via Socket.IO
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('message:deleted', { sessionId, messageId });
    socketServer.getIO().to(`visitor:${sessionId}`).emit('message:deleted', { sessionId, messageId });
  }

  logAudit({ userId, userName: 'Оператор', action: 'message_deleted', entityType: 'messages', entityId: messageId, ip: req.ip, details: { sessionId, content: msg.content?.substring(0, 100) } });

  res.json({ success: true });
});

/**
 * Редактировать исходящее текстовое сообщение пульта
 * PATCH /admin/sessions/:sessionId/messages/:messageId
 */
router.patch('/admin/sessions/:sessionId/messages/:messageId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, messageId } = req.params;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  const newContent = sanitizeContent(req.body.content || '');
  if (!newContent) throw new AppError(400, 'Content is required');
  if (newContent.length > 10000) throw new AppError(400, 'Content too long');

  // Fetch message
  const msg = await db.queryOne<Pick<Messages, 'id' | 'sender_type' | 'sender_id' | 'external_message_id' | 'message_type'>>(
    `SELECT id, sender_type, sender_id, external_message_id, message_type
     FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [messageId, sessionId],
  );
  if (!msg) throw new AppError(404, 'Message not found');

  if (!isOutgoingPultMessage(msg.sender_type)) {
    throw new AppError(403, 'Можно редактировать только исходящие сообщения пульта');
  }
  if (msg.message_type !== 'text') {
    throw new AppError(400, 'Можно редактировать только текстовые сообщения');
  }

  // Get conversation for channel info
  const conv = await db.queryOne<Pick<Conversations, 'channel' | 'metadata' | 'external_chat_id'>>(
    `SELECT channel, metadata, external_chat_id FROM conversations WHERE id = $1`,
    [sessionId],
  );

  // Edit in external messenger if possible
  const editChannel = toConnectorChannel(conv?.channel ?? null);
  if (conv && msg.external_message_id && editChannel && editChannel !== 'web') {
    try {
      const { getAdapterOrThrow } = await import('../../services/connectors/core/adapter-registry.js');
      const { getAccountByChannel } = await import('../../services/connectors/core/account-store.js');
      const adapter = getAdapterOrThrow(editChannel);
      if (adapter.editMessageText) {
        const externalChatId = getConversationExternalChatId(conv);
        if (!externalChatId) {
          throw new AppError(409, 'У чата нет внешнего ID для редактирования в мессенджере');
        }
        const account = await getAccountByChannel(editChannel);
        if (!account) {
          throw new AppError(502, 'Аккаунт канала не настроен');
        }
        const result = await adapter.editMessageText(account, externalChatId, msg.external_message_id, newContent);
        if (!result.success) {
          log.warn('External editMessageText failed', { channel: conv.channel, error: result.errorMessage });
          throw new AppError(502, 'Не удалось изменить сообщение в мессенджере клиента');
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      log.warn('External editMessageText error', { error: String(err) });
      throw new AppError(502, 'Не удалось изменить сообщение в мессенджере клиента');
    }
  }

  // Update in DB
  const updated = await db.queryOne<Messages>(
    `UPDATE messages SET content = $1, metadata = COALESCE(metadata, '{}'::jsonb) || '{"edited": true}'::jsonb
     WHERE id = $2
     RETURNING *`,
    [newContent, messageId],
  );

  await refreshConversationMessageSummary(sessionId);

  // Broadcast edit via Socket.IO
  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('message:edited', { sessionId, messageId, content: newContent });
    socketServer.getIO().to(`visitor:${sessionId}`).emit('message:edited', { sessionId, messageId, content: newContent });
  }

  logAudit({ userId, userName: 'Оператор', action: 'message_edited', entityType: 'messages', entityId: messageId, ip: req.ip, details: { sessionId } });

  res.json({ success: true, data: updated });
});

// ============================================================================
// Message Reactions (JSONB in messages.metadata)
// ============================================================================

/**
 * POST /admin/sessions/:sessionId/messages/:messageId/reactions
 * Toggle reaction: if reaction from this user exists — remove it, otherwise — add.
 */
router.post('/admin/sessions/:sessionId/messages/:messageId/reactions', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, messageId } = req.params;
  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string') {
    throw new AppError(400, 'emoji is required');
  }

  const userId = req.user!.id;
  const userName = req.user!.display_name || 'Оператор';

  const msg = await db.queryOne<Pick<Messages, 'metadata'>>(
    'SELECT metadata FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL',
    [messageId, sessionId],
  );
  if (!msg) throw new AppError(404, 'Message not found');

  const parsed = parseMessageMetadata(msg.metadata);
  const reactions: MessageReactions = parsed?.reactions ? { ...parsed.reactions } : {};

  const existing = reactions[emoji]?.findIndex(r => r.userId === userId) ?? -1;

  if (existing >= 0) {
    const updated = [...reactions[emoji]];
    updated.splice(existing, 1);
    if (updated.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = updated;
    }
  } else {
    // Max 20 unique emoji per message
    if (!reactions[emoji] && Object.keys(reactions).length >= 20) {
      throw new AppError(400, 'Max 20 different reactions per message');
    }
    reactions[emoji] = [...(reactions[emoji] || []), { userId, userName }];
  }

  await db.query(
    `UPDATE messages SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [messageId, JSON.stringify({ reactions })],
  );

  // Broadcast via Socket.IO — both operator room and visitor room
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const reactionPayload = { sessionId, messageId, reactions };
    socketServer.getIO().to('admin:visitor-chats').emit('message:reaction-updated', reactionPayload);
    socketServer.getIO().to(`visitor:${sessionId}`).emit('message:reaction-updated', reactionPayload);
  }

  res.json({ success: true, data: { reactions } });
});

/**
 * Toggle pin/unpin a message
 * POST /admin/sessions/:sessionId/messages/:messageId/pin
 */
router.post('/admin/sessions/:sessionId/messages/:messageId/pin', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, messageId } = req.params;
  const userId = req.user!.id;

  const msg = await db.queryOne<PinnedMessageRow>(
    'SELECT id, pinned_at FROM messages WHERE id = $1 AND conversation_id = $2',
    [messageId, sessionId],
  );
  if (!msg) { throw new AppError(404, 'Message not found'); }

  const isPinned = !!msg.pinned_at;

  if (isPinned) {
    await db.query('UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = $1', [messageId]);
  } else {
    await db.query('UPDATE messages SET pinned_at = NOW(), pinned_by = $2 WHERE id = $1', [messageId, userId]);
  }

  const socketServer = req.app.socketServer;
  if (socketServer) {
    const pinPayload = {
      sessionId,
      messageId,
      pinned: !isPinned,
      pinnedBy: !isPinned ? userId : null,
    };
    socketServer.getIO().to('admin:visitor-chats').emit('message:pin-toggled', pinPayload);
    socketServer.getIO().to(`visitor:${sessionId}`).emit('message:pin-toggled', pinPayload);
  }

  res.json({ success: true, data: { pinned: !isPinned } });
});

/**
 * Get pinned messages for a session
 * GET /admin/sessions/:sessionId/pinned-messages
 */
router.get('/admin/sessions/:sessionId/pinned-messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const rows = await db.query(
    `SELECT m.id, m.content, m.message_type, m.sender_type, m.sender_name, m.created_at, m.pinned_at, m.pinned_by,
            u.display_name AS pinned_by_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.pinned_by
     WHERE m.conversation_id = $1 AND m.pinned_at IS NOT NULL
     ORDER BY m.pinned_at DESC`,
    [sessionId],
  );
  res.json({ success: true, data: rows });
});

/**
 * Управление режимом AI-агента для диалога
 * POST /admin/sessions/:sessionId/ai-agent-mode
 * body: { mode: 'bot' | 'off' }
 * Право: authenticateToken (как у reply). Возврат из режима operator обратно к боту или выкл.
 */
router.post('/admin/sessions/:sessionId/ai-agent-mode', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { sessionId } = req.params;
  const { mode } = req.body as { mode: unknown };

  if (mode !== 'bot' && mode !== 'off') {
    throw new AppError(400, 'mode must be "bot" or "off"');
  }

  // Return conversation to bot or turn off: clear lock so ai-turn-worker may resume (if mode='bot').
  const result = await pool.query(
    `UPDATE conversations
     SET ai_agent_mode = $2,
         ai_agent_locked_at = NULL,
         ai_agent_mode_set_by = 'operator:' || $3::text
     WHERE id = $1
     RETURNING id, ai_agent_mode, ai_agent_locked_at, ai_agent_mode_set_by`,
    [sessionId, mode, req.user.id]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  logAudit({ userId: req.user.id, userName: 'Оператор', action: 'ai_agent_mode_set', entityType: 'chat', entityId: sessionId, details: { mode }, ip: req.ip });

  const socketServer = req.app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:visitor-chats').emit('chat:ai-agent-mode-changed', {
      sessionId,
      mode,
      changedBy: req.user.id,
    });
  }

  res.json({ success: true, mode });
});

/**
 * POST /admin/sessions/:sessionId/ai-reply
 * Оператор просит бота сформировать и ОТПРАВИТЬ ответ клиенту (ручной триггер хода).
 * Нужно, когда автозапуск не сработал: сообщение пришло до включения бота, диалог
 * был у оператора, или просто хочется, чтобы ответил бот. Переводит диалог в bot,
 * снимает lock и ставит ход на последнее сообщение клиента.
 */
router.post('/admin/sessions/:sessionId/ai-reply', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { sessionId } = req.params;

  const conv = await pool.query(
    `SELECT c.channel, c.external_chat_id,
            (SELECT m.id FROM messages m
               WHERE m.conversation_id = c.id AND m.sender_type = 'visitor'
               ORDER BY m.created_at DESC LIMIT 1) AS last_visitor_msg_id
       FROM conversations c WHERE c.id = $1`,
    [sessionId]
  );
  if (conv.rows.length === 0) throw new AppError(404, 'Session not found');
  const { channel, external_chat_id, last_visitor_msg_id } = conv.rows[0];
  if (!external_chat_id) throw new AppError(400, 'У диалога нет канала для ответа клиенту');
  if (!last_visitor_msg_id) throw new AppError(400, 'Нет сообщения клиента, на которое ответить');

  // Оператор явно просит бота: переводим в bot и снимаем lock.
  await pool.query(
    `UPDATE conversations
       SET ai_agent_mode = 'bot', ai_agent_locked_at = NULL,
           ai_agent_mode_set_by = 'operator:' || $2::text, updated_at = NOW()
     WHERE id = $1`,
    [sessionId, req.user.id]
  );

  const { enqueueAiTurn } = await import('../../services/connectors/pipeline/ai-turn-worker.js');
  await enqueueAiTurn({ conversationId: sessionId, triggerMessageId: last_visitor_msg_id, channel });

  logAudit({ userId: req.user.id, userName: 'Оператор', action: 'ai_reply_requested', entityType: 'chat', entityId: sessionId, details: {}, ip: req.ip });
  res.json({ success: true });
});

export default router;
