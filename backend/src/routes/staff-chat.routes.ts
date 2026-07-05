import { Router, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { Server as SocketIOServer } from 'socket.io';
import { pool } from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { detectMessageType, getSocketServer } from './chat/chat-shared.js';
import { storageService } from '../services/storage.service.js';
import { sendPush } from '../services/web-push-notify.service.js';
import { notifyNativeStaffChatParticipants } from '../services/native-notifier.service.js';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { createLogger } from '../utils/logger.js';
import { validateImageBuffer } from '../utils/image-validate.js';
import { mimeFromFilename, mimeToExt } from '../utils/mime-utils.js';
import { safeSharp } from '../utils/safe-sharp.js';
import type {
  StaffAttachmentMessage,
  StaffMessageReply,
  StaffMessageWithReplyMedia,
} from '../types/views/staff-chat-views.js';
import type { Response as ExpressResponse } from 'express';

const log = createLogger('staff-chat');

const router = Router();

const _GENERAL_CHAT_ID = '00000000-0000-0000-0000-000000000001';
const SELF_DIRECT_CHAT_TITLE = 'Личный чат';
const STAFF_CHAT_ROLES = ['admin', 'manager', 'employee', 'photographer'] as const;
const STAFF_THUMB_WIDTH = 480;
const STAFF_THUMB_QUALITY = 74;
const STAFF_THUMB_CACHE_SECONDS = 86_400;

interface DirectConversationRow {
  id: string;
  title: string | null;
  type: string;
  created_by: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

interface StaffUserLookupRow {
  id: string;
  role: string;
  is_active: boolean | null;
  is_system: boolean | null;
}

interface StaffChatNotificationParticipantRow {
  user_id: string;
}

interface SocketServerWithPresence {
  getOnlineUserIds: () => Promise<string[]>;
}

function isStaffChatRole(role: string): boolean {
  return (STAFF_CHAT_ROLES as readonly string[]).includes(role);
}

function hasOnlineUserIds(server: unknown): server is SocketServerWithPresence {
  return typeof server === 'object'
    && server !== null
    && 'getOnlineUserIds' in server
    && typeof server.getOnlineUserIds === 'function';
}

async function getActiveStaffChatUser(userId: string): Promise<StaffUserLookupRow> {
  const targetUser = await pool.query<StaffUserLookupRow>(
    `SELECT id, role, is_active, is_system FROM users WHERE id = $1`,
    [userId],
  );
  const target = targetUser.rows[0];
  if (!target) throw new AppError(404, 'Пользователь не найден');
  if (!target.is_active) throw new AppError(400, 'Пользователь деактивирован');
  if (target.is_system) throw new AppError(400, 'Нельзя создать чат с системным аккаунтом');
  if (!isStaffChatRole(target.role)) throw new AppError(400, 'Пользователь не является сотрудником');
  return target;
}

async function findDirectConversation(currentUserId: string, targetUserId: string): Promise<DirectConversationRow | null> {
  if (currentUserId === targetUserId) {
    const existing = await pool.query<DirectConversationRow>(
      `SELECT c.* FROM staff_conversations c
       WHERE c.type = 'direct'
         AND c.deleted_at IS NULL
         AND c.title = $2
         AND EXISTS (
           SELECT 1 FROM staff_conversation_participants p
           WHERE p.conversation_id = c.id
             AND p.user_id = $1
             AND p.left_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM staff_conversation_participants p
           WHERE p.conversation_id = c.id
             AND p.user_id != $1
             AND p.left_at IS NULL
         )
       ORDER BY c.created_at ASC NULLS LAST
       LIMIT 1`,
      [currentUserId, SELF_DIRECT_CHAT_TITLE],
    );
    return existing.rows[0] ?? null;
  }

  const existing = await pool.query<DirectConversationRow>(
    `SELECT c.* FROM staff_conversations c
     WHERE c.type = 'direct'
       AND c.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM staff_conversation_participants p
         WHERE p.conversation_id = c.id
           AND p.user_id = $1
           AND p.left_at IS NULL
       )
       AND EXISTS (
         SELECT 1 FROM staff_conversation_participants p
         WHERE p.conversation_id = c.id
           AND p.user_id = $2
           AND p.left_at IS NULL
       )
       AND (
         SELECT COUNT(*)::int FROM staff_conversation_participants p
         WHERE p.conversation_id = c.id
           AND p.left_at IS NULL
       ) = 2
     ORDER BY c.created_at ASC NULLS LAST
     LIMIT 1`,
    [currentUserId, targetUserId],
  );
  return existing.rows[0] ?? null;
}

async function createDirectConversation(currentUserId: string, targetUserId: string): Promise<DirectConversationRow> {
  const title = currentUserId === targetUserId ? SELF_DIRECT_CHAT_TITLE : null;
  const conv = await pool.query<DirectConversationRow>(
    `INSERT INTO staff_conversations (title, type, created_by, last_message_preview)
     VALUES ($1, 'direct', $2, '')
     RETURNING *`,
    [title, currentUserId],
  );
  const created = conv.rows[0];
  if (!created) throw new AppError(500, 'Не удалось создать чат');

  if (currentUserId === targetUserId) {
    await pool.query(
      `INSERT INTO staff_conversation_participants (conversation_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL`,
      [created.id, currentUserId],
    );
  } else {
    await pool.query(
      `INSERT INTO staff_conversation_participants (conversation_id, user_id, role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member')
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL`,
      [created.id, currentUserId, targetUserId],
    );
  }

  return created;
}

async function getOrCreateDirectConversation(
  currentUserId: string,
  targetUserId: string,
): Promise<{ conversation: DirectConversationRow; existing: boolean }> {
  const existing = await findDirectConversation(currentUserId, targetUserId);
  if (existing) return { conversation: existing, existing: true };

  const conversation = await createDirectConversation(currentUserId, targetUserId);
  return { conversation, existing: false };
}

async function ensureDirectConversationsForStaffUser(userId: string): Promise<void> {
  const staff = await pool.query<Pick<StaffUserLookupRow, 'id'>>(
    `SELECT id
     FROM users
     WHERE role = ANY($1::text[])
       AND is_active = true
       AND is_system = false
     ORDER BY id`,
    [STAFF_CHAT_ROLES],
  );

  for (const target of staff.rows) {
    await getOrCreateDirectConversation(userId, target.id);
  }
}

// Staff chat — только сотрудники (team:chat permission). Rate limiters убраны:
// internal CRM за JWT, 10 операторов за office NAT — лимитеры только ломали UX.
router.use(authenticateToken, requirePermission('team:chat'));

// ============================================================================
// Middleware: verify user is active participant of conversation
// ============================================================================

async function requireParticipation(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const convId = req.params['id'];
  if (!convId) throw new AppError(400, 'Conversation ID required');

  const { rows } = await pool.query(
    `SELECT role FROM staff_conversation_participants
     WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [convId, req.user!.id],
  );
  if (rows.length === 0) throw new AppError(403, 'Not a participant of this conversation');

  // Attach role for downstream handlers
  (req as AuthRequest & { participantRole?: string }).participantRole = rows[0].role || 'member';
  next();
}

// ============================================================================
// Helper: send push to all other participants
// ============================================================================

async function notifyParticipants(
  conversationId: string,
  senderId: string,
  senderName: string,
  previewText: string,
  io?: SocketIOServer,
  messageId?: string,
): Promise<void> {
  try {
    const params: unknown[] = [conversationId, senderId];
    const participants = await pool.query<StaffChatNotificationParticipantRow>(
      `SELECT p.user_id FROM staff_conversation_participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = $1
         AND p.user_id != $2
         AND p.left_at IS NULL
         AND u.is_active = true
         AND (p.muted_until IS NULL OR p.muted_until < NOW())`,
      params,
    );
    for (const p of participants.rows) {
      sendPush(p.user_id, {
        title: senderName,
        body: previewText.substring(0, 80),
        tag: `staff-chat-${conversationId}`,
        url: '/employee/team',
      }).catch(err => log.warn('Failed to send staff-chat push', { error: String(err) }));
    }

    if (io) {
      await notifyNativeStaffChatParticipants(io, {
        conversationId,
        messageId,
        senderId,
        senderName,
        previewText,
      });
    }
  } catch (err) {
    log.warn('Failed to notify staff-chat participants', {
      conversationId,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Helper: resolve sender name
// ============================================================================

async function getSenderName(userId: string): Promise<string> {
  const row = await pool.query(
    `SELECT display_name, email FROM users WHERE id = $1`,
    [userId],
  );
  return row.rows[0]?.display_name || row.rows[0]?.email || 'Сотрудник';
}

interface StaffReplyResolution {
  replyToId: string | null;
  snapshot: StaffMessageReply | null;
}

function staffReplyPreview(row: StaffMessageReply): string | null {
  const content = row.content?.trim() ?? '';
  const filename = row.original_filename?.trim() ?? '';
  const hasCaption = content.length > 0 && content !== filename;

  if (row.message_type === 'image') return (hasCaption ? content : 'Фото').substring(0, 200);
  if (row.message_type === 'video') return (hasCaption ? content : 'Видео').substring(0, 200);
  if (row.message_type === 'audio') return (hasCaption ? content : 'Аудио').substring(0, 200);
  if (row.attachment_url) return (hasCaption ? content : filename || 'Файл').substring(0, 200);
  return content.substring(0, 200) || null;
}

async function resolveReplySnapshot(conversationId: string, replyToMessageId: unknown): Promise<StaffReplyResolution> {
  if (typeof replyToMessageId !== 'string' || !replyToMessageId) {
    return { replyToId: null, snapshot: null };
  }

  const replyMsg = await pool.query<StaffMessageReply>(
    `SELECT content, sender_name, message_type, attachment_url, original_filename
     FROM staff_messages
     WHERE id = $1
       AND conversation_id = $2
       AND deleted_at IS NULL`,
    [replyToMessageId, conversationId],
  );
  const row = replyMsg.rows[0];
  if (!row) return { replyToId: null, snapshot: null };

  return {
    replyToId: replyToMessageId,
    snapshot: {
      ...row,
      content: staffReplyPreview(row),
    },
  };
}

function withReplyMedia(row: StaffMessageWithReplyMedia, reply: StaffMessageReply | null): StaffMessageWithReplyMedia {
  return {
    ...row,
    reply_to_content: row.reply_to_content ?? reply?.content ?? null,
    reply_to_sender_name: row.reply_to_sender_name ?? reply?.sender_name ?? null,
    reply_to_message_type: reply?.message_type ?? null,
    reply_to_attachment_url: reply?.attachment_url ?? null,
    reply_to_original_filename: reply?.original_filename ?? null,
  };
}

interface StaffAttachmentWithUrl extends StaffAttachmentMessage {
  attachment_url: string;
}

async function loadStaffAttachment(conversationId: string, messageId: string): Promise<StaffAttachmentWithUrl> {
  const result = await pool.query<StaffAttachmentMessage>(
    `SELECT id, conversation_id, content, message_type, attachment_url, original_filename
     FROM staff_messages
     WHERE id = $1
       AND conversation_id = $2
       AND deleted_at IS NULL`,
    [messageId, conversationId],
  );

  const row = result.rows[0];
  if (!row?.attachment_url) {
    throw new AppError(404, 'Attachment not found');
  }
  return { ...row, attachment_url: row.attachment_url };
}

function attachmentUrlBasename(url: string): string | null {
  const rawName = url.split('?')[0]?.split('/').filter(Boolean).pop();
  if (!rawName) return null;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function safeDownloadFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return cleaned || fallback;
}

function hasFilenameExtension(filename: string): boolean {
  return /\.[A-Za-z0-9]{1,10}$/.test(filename);
}

function ensureDownloadExtension(filename: string, mimeType: string): string {
  if (hasFilenameExtension(filename) || mimeType === 'application/octet-stream') return filename;
  const ext = mimeToExt(mimeType);
  return ext === '.bin' ? filename : `${filename}${ext}`;
}

function baseAttachmentFilename(row: StaffAttachmentWithUrl): string {
  const fallback = row.message_type === 'image' ? `photo-${row.id.slice(0, 8)}` : `file-${row.id.slice(0, 8)}`;
  return row.original_filename
    || attachmentUrlBasename(row.attachment_url)
    || (row.content && row.content.length < 80 && !row.content.startsWith('[') ? row.content : null)
    || fallback;
}

async function resolveAttachmentMime(attachmentUrl: string, filename: string): Promise<string> {
  let mimeType = mimeFromFilename(filename);
  const key = storageService.keyFromUrl(attachmentUrl);
  if (key) {
    const head = await storageService.headObject(key);
    if (!mimeType && head?.contentType && head.contentType !== 'application/octet-stream') {
      mimeType = head.contentType;
    }
  }
  return mimeType ?? 'application/octet-stream';
}

async function downloadNameAndMime(row: StaffAttachmentWithUrl): Promise<{ filename: string; mimeType: string }> {
  const baseName = safeDownloadFilename(baseAttachmentFilename(row), row.message_type === 'image' ? 'photo' : 'file');
  const mimeType = await resolveAttachmentMime(row.attachment_url, baseName);
  return {
    filename: ensureDownloadExtension(baseName, mimeType),
    mimeType,
  };
}

function resolveLocalAttachmentPath(attachmentUrl: string): string {
  if (!attachmentUrl.startsWith('/uploads/')) {
    throw new AppError(400, 'Unsupported attachment URL');
  }

  const localPath = path.resolve(process.cwd(), attachmentUrl.replace(/^\//, ''));
  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  if (localPath !== uploadsRoot && !localPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new AppError(403, 'Invalid attachment path');
  }
  return localPath;
}

async function readAttachmentBuffer(attachmentUrl: string): Promise<Buffer> {
  const key = storageService.keyFromUrl(attachmentUrl);
  if (key) {
    const { buffer } = await storageService.downloadToBuffer(key);
    return buffer;
  }
  return fs.readFile(resolveLocalAttachmentPath(attachmentUrl));
}

function encodedAttachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

function ifNoneMatchIncludes(header: string | string[] | undefined, etag: string): boolean {
  if (Array.isArray(header)) return header.includes(etag);
  return header === etag;
}

function setAttachmentDownloadHeaders(res: Response, filename: string, mimeType: string): void {
  res.setHeader('Content-Disposition', encodedAttachmentDisposition(filename));
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Security-Policy', "default-src 'none'");
}

// ============================================================================
// Conversations
// ============================================================================

/**
 * GET /api/staff-chat/conversations
 */
router.get('/conversations', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  // Auto-join general chat if not a participant
  try {
    await pool.query(
      `INSERT INTO staff_conversation_participants (id, conversation_id, user_id, role)
       SELECT gen_random_uuid(), c.id, $1, 'member'
       FROM staff_conversations c
       WHERE c.type = 'general' AND c.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM staff_conversation_participants p
           WHERE p.conversation_id = c.id AND p.user_id = $1 AND p.left_at IS NULL
         )
       ON CONFLICT DO NOTHING`,
      [req.user.id],
    );
  } catch (err) {
    log.warn('Failed to auto-join general staff chat', { userId: req.user.id, error: String(err) });
  }

  // Re-activate if previously left
  try {
    await pool.query(
      `UPDATE staff_conversation_participants SET left_at = NULL
       WHERE user_id = $1 AND left_at IS NOT NULL
         AND conversation_id IN (SELECT id FROM staff_conversations WHERE type = 'general' AND deleted_at IS NULL)`,
      [req.user.id],
    );
  } catch (err) {
    log.warn('Failed to re-activate general staff chat membership', { userId: req.user.id, error: String(err) });
  }

  await ensureDirectConversationsForStaffUser(req.user.id);

  const searchTerm = (req.query['q'] as string || '').trim();
  const searchFilter = searchTerm
    ? `AND (c.title ILIKE '%' || $4 || '%' OR EXISTS (
         SELECT 1 FROM staff_conversation_participants p3
         JOIN users u3 ON u3.id = p3.user_id
         WHERE p3.conversation_id = c.id AND u3.display_name ILIKE '%' || $4 || '%'
       ))`
    : '';

  const params: (string | boolean)[] = [req.user.id, req.query['archived'] === 'true', SELF_DIRECT_CHAT_TITLE];
  if (searchTerm) params.push(searchTerm);

  const conversations = await pool.query(
    `SELECT c.*,
      (SELECT COUNT(*)::int FROM staff_messages sm
       WHERE sm.conversation_id = c.id
         AND sm.created_at > COALESCE(
           (SELECT last_read_at FROM staff_read_receipts
            WHERE user_id = $1 AND conversation_id = c.id),
           '1970-01-01'
         )
         AND sm.sender_id != $1
      ) AS unread_count,
      (SELECT json_agg(json_build_object(
               'user_id', p.user_id,
               'display_name', u.display_name,
               'email', u.email,
               'is_active', u.is_active,
               'last_seen_at', u.last_seen_at
             ))
       FROM staff_conversation_participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = c.id AND p.left_at IS NULL
      ) AS participants
     FROM staff_conversations c
     JOIN staff_conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1 AND cp.left_at IS NULL
       AND c.deleted_at IS NULL
       -- Hide direct chats where the other participant is deactivated; keep self-chat visible.
       AND (
         c.type != 'direct'
         OR EXISTS (
           SELECT 1 FROM staff_conversation_participants p2
           JOIN users u2 ON u2.id = p2.user_id
           WHERE p2.conversation_id = c.id
             AND p2.user_id != $1
             AND p2.left_at IS NULL
             AND u2.is_active = true
         )
         OR (
           c.title = $3
           AND NOT EXISTS (
             SELECT 1 FROM staff_conversation_participants p2
             WHERE p2.conversation_id = c.id
               AND p2.user_id != $1
               AND p2.left_at IS NULL
           )
         )
       )
       AND (($2::boolean IS TRUE AND c.archived_at IS NOT NULL)
            OR ($2::boolean IS NOT TRUE AND c.archived_at IS NULL))
       ${searchFilter}
     ORDER BY
       CASE WHEN c.type = 'general' THEN 0 ELSE 1 END,
       c.last_message_at DESC`,
    params,
  );

  res.json({ success: true, data: conversations.rows });
});

/**
 * POST /api/staff-chat/conversations
 */
router.post('/conversations', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { type = 'direct', title, participantIds } = req.body;

  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    throw new AppError(400, 'participantIds required');
  }

  // For direct chat, check if already exists
  if (type === 'direct' && participantIds.length === 1) {
    const targetId = participantIds[0];
    if (typeof targetId !== 'string' || !targetId) throw new AppError(400, 'participantIds required');
    await getActiveStaffChatUser(targetId);

    const direct = await getOrCreateDirectConversation(req.user.id, targetId);
    res.json({
      success: true,
      data: direct.existing ? { id: direct.conversation.id, existing: true } : direct.conversation,
    });
    return;
  }

  const conv = await pool.query(
    `INSERT INTO staff_conversations (title, type, created_by)
     VALUES ($1, $2, $3) RETURNING *`,
    [title || null, type, req.user!.id],
  );
  const convId = conv.rows[0].id;

  const normalizedParticipantIds = participantIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const allParticipants = [req.user!.id, ...normalizedParticipantIds.filter((id: string) => id !== req.user!.id)];
  for (const userId of allParticipants) {
    await pool.query(
      `INSERT INTO staff_conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [convId, userId],
    );
  }

  res.json({ success: true, data: conv.rows[0] });
});

// ============================================================================
// Messages
// ============================================================================

/**
 * GET /api/staff-chat/conversations/:id/messages
 */
router.get('/conversations/:id/messages', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { before, limit = '50' } = req.query;
  const lim = Math.min(parseInt(limit as string, 10) || 50, 100);

  let query = `SELECT m.id, m.conversation_id, m.sender_id, m.sender_name, m.content,
    m.message_type, m.attachment_url, m.original_filename,
    m.reply_to_message_id,
    COALESCE(m.reply_to_content, ref.content) AS reply_to_content,
    COALESCE(m.reply_to_sender_name, ref.sender_name) AS reply_to_sender_name,
    ref.message_type AS reply_to_message_type,
    ref.attachment_url AS reply_to_attachment_url,
    ref.original_filename AS reply_to_original_filename,
    m.deleted_at, m.edited_at, m.pinned_at, m.pinned_by,
    m.is_forwarded, m.forwarded_from_name, m.created_at,
    COALESCE(
      (SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'users', r.users))
       FROM (
         SELECT emoji, COUNT(*)::int AS cnt, array_agg(user_id) AS users
         FROM staff_message_reactions WHERE message_id = m.id GROUP BY emoji
       ) r
      ), '[]'::json
    ) AS reactions
    FROM staff_messages m
    LEFT JOIN staff_messages ref
      ON ref.id = m.reply_to_message_id
     AND ref.conversation_id = m.conversation_id
     AND ref.deleted_at IS NULL
    WHERE m.conversation_id = $1`;
  const params: unknown[] = [id];

  if (before) {
    query += ` AND m.created_at < $${params.length + 1}`;
    params.push(before);
  }

  query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
  params.push(lim);

  const messages = await pool.query(query, params);

  // Check if there are older messages
  const oldest = messages.rows[messages.rows.length - 1];
  let hasOlder = false;
  if (oldest) {
    const countRes = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM staff_messages WHERE conversation_id = $1 AND created_at < $2) AS has_older`,
      [id, oldest.created_at],
    );
    hasOlder = countRes.rows[0]?.has_older ?? false;
  }

  const rows = messages.rows.reverse();

  // Mark conversation as delivered for this user on first open.
  // Transition sent -> delivered is detected by comparing previous delivered_at (NULL) with new value.
  // If delivered_at was already set we keep the original timestamp (COALESCE) and skip broadcast.
  try {
    const deliveredRes = await pool.query(
      `WITH prev AS (
         SELECT delivered_at AS was_delivered_at
         FROM staff_read_receipts
         WHERE user_id = $1 AND conversation_id = $2
       )
       INSERT INTO staff_read_receipts (user_id, conversation_id, last_read_at, last_read_message_id, delivered_at)
       VALUES ($1, $2, NULL, NULL, NOW())
       ON CONFLICT (user_id, conversation_id)
       DO UPDATE SET delivered_at = COALESCE(staff_read_receipts.delivered_at, NOW())
       RETURNING delivered_at,
                 (SELECT was_delivered_at FROM prev) AS was_delivered_at`,
      [req.user!.id, id],
    );
    const row = deliveredRes.rows[0];
    if (row && row.was_delivered_at === null) {
      const socketServer = getSocketServer(req.app);
      if (socketServer) {
        socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:delivered', {
          conversationId: id,
          userId: req.user!.id,
          deliveredAt: row.delivered_at instanceof Date ? row.delivered_at.toISOString() : row.delivered_at,
        });
      }
    }
  } catch (err) {
    log.warn('Failed to mark delivered', { conversationId: id, error: String(err) });
  }

  res.json({ success: true, data: rows, hasOlder });
});

/**
 * GET /api/staff-chat/conversations/:id/messages/:msgId/thumbnail
 */
router.get('/conversations/:id/messages/:msgId/thumbnail', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const message = await loadStaffAttachment(id, msgId);
  if (message.message_type !== 'image') {
    throw new AppError(400, 'Thumbnail is available for image messages only');
  }

  const etag = `"staff-thumb-${message.id}-${STAFF_THUMB_WIDTH}-${STAFF_THUMB_QUALITY}"`;
  if (ifNoneMatchIncludes(req.headers['if-none-match'], etag)) {
    res.status(304).end();
    return;
  }

  const sourceBuffer = await readAttachmentBuffer(message.attachment_url);
  const validation = validateImageBuffer(sourceBuffer);
  if (!validation.valid) {
    throw new AppError(415, 'Unsupported image preview');
  }

  const thumbnailBuffer = await safeSharp(
    () => sharp(sourceBuffer)
      .rotate()
      .resize(STAFF_THUMB_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: STAFF_THUMB_QUALITY })
      .toBuffer(),
    'staff-chat:thumbnail',
  );

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', `private, max-age=${STAFF_THUMB_CACHE_SECONDS}, immutable`);
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.send(thumbnailBuffer);
});

/**
 * GET /api/staff-chat/conversations/:id/messages/:msgId/download
 */
router.get('/conversations/:id/messages/:msgId/download', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const message = await loadStaffAttachment(id, msgId);
  const { filename, mimeType } = await downloadNameAndMime(message);
  const key = storageService.keyFromUrl(message.attachment_url);

  if (key) {
    setAttachmentDownloadHeaders(res, filename, mimeType);
    const stream = await storageService.getReadStream(key);
    stream.on('error', err => {
      log.error('Failed to stream staff-chat attachment', { messageId: msgId, error: String(err) });
      res.destroy(err);
    });
    stream.pipe(res);
    return;
  }

  const localPath = resolveLocalAttachmentPath(message.attachment_url);
  setAttachmentDownloadHeaders(res, filename, mimeType);
  res.sendFile(localPath);
});

/**
 * POST /api/staff-chat/conversations/:id/messages — text message
 */
router.post('/conversations/:id/messages', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { content, replyToMessageId } = req.body;

  if (!content?.trim()) throw new AppError(400, 'Content required');

  const senderName = await getSenderName(req.user!.id);
  const reply = await resolveReplySnapshot(id, replyToMessageId);

  const msg = await pool.query<StaffMessageWithReplyMedia>(
    `INSERT INTO staff_messages
      (conversation_id, sender_id, sender_name, content, message_type,
       reply_to_message_id, reply_to_content, reply_to_sender_name)
     VALUES ($1, $2, $3, $4, 'text', $5, $6, $7) RETURNING *`,
    [id, req.user!.id, senderName, content.trim(),
     reply.replyToId, reply.snapshot?.content ?? null, reply.snapshot?.sender_name ?? null],
  );
  const message = withReplyMedia(msg.rows[0], reply.snapshot);

  // Parse @mentions and insert into staff_mentions
  const mentionRegex = /@([\p{L}\w]+(?:\s[\p{L}\w]+)?)/gu;
  const mentionMatches = content.trim().match(mentionRegex);
  if (mentionMatches && mentionMatches.length > 0) {
    const mentionNames = mentionMatches.map((m: string) => m.slice(1).trim());
    const mentionedUsers = await pool.query(
      `SELECT id, display_name FROM users
       WHERE is_active = true AND is_system = false AND display_name ILIKE ANY($1::text[])`,
      [mentionNames],
    );
    for (const mentionedUser of mentionedUsers.rows) {
      if (mentionedUser.id === req.user!.id) continue;
      await pool.query(
        `INSERT INTO staff_mentions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [message.id, mentionedUser.id],
      );
      const mentionSocket = getSocketServer(req.app);
      if (mentionSocket) {
        mentionSocket.getIO().to(`user:${mentionedUser.id}`).emit('staff-chat:mention', {
          conversationId: id,
          messageId: message.id,
          mentionedUserId: mentionedUser.id,
          senderName,
        });
      }
      sendPush(mentionedUser.id, {
        title: `Упоминание от ${senderName}`,
        body: content.trim().substring(0, 80),
        tag: `staff-mention-${message.id}`,
        url: '/employee/team',
      }).catch(err => log.warn('Failed to send mention push', { error: String(err) }));
    }
  }

  // Broadcast via WebSocket
  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:new-message', {
      conversationId: id,
      message,
    });
  }

  // Push notifications (fire-and-forget)
  void notifyParticipants(id, req.user!.id, senderName, content.trim(), req.app.socketServer?.getIO(), message.id);

  res.json({ success: true, data: message });
});


// ============================================================================
// Mentions
// ============================================================================

/**
 * GET /api/staff-chat/mentions — unread mentions for current user
 */
router.get('/mentions', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const mentions = await pool.query(
    `SELECT sm.message_id, sm.user_id, m.conversation_id, m.sender_name,
            m.content, m.created_at
     FROM staff_mentions sm
     JOIN staff_messages m ON m.id = sm.message_id
     WHERE sm.user_id = $1
       AND m.deleted_at IS NULL
       AND m.created_at > COALESCE(
         (SELECT MAX(rr.last_read_at) FROM staff_read_receipts rr
          WHERE rr.user_id = $1 AND rr.conversation_id = m.conversation_id),
         '1970-01-01'
       )
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [req.user!.id],
  );

  res.json({ success: true, data: mentions.rows });
});

// ============================================================================
// Read receipts
// ============================================================================

/**
 * PUT /api/staff-chat/conversations/:id/read
 */
router.put('/conversations/:id/read', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const lastMsg = await pool.query(
    `SELECT id FROM staff_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [id],
  );

  const upserted = await pool.query(
    `INSERT INTO staff_read_receipts (user_id, conversation_id, last_read_at, last_read_message_id, delivered_at)
     VALUES ($1, $2, NOW(), $3, NOW())
     ON CONFLICT (user_id, conversation_id)
     DO UPDATE SET last_read_at = NOW(),
                   last_read_message_id = $3,
                   delivered_at = COALESCE(staff_read_receipts.delivered_at, NOW())
     RETURNING last_read_at, last_read_message_id`,
    [req.user!.id, id, lastMsg.rows[0]?.id || null],
  );
  const receipt = upserted.rows[0];

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:read', {
      conversationId: id,
      userId: req.user!.id,
      lastReadAt: receipt?.last_read_at instanceof Date ? receipt.last_read_at.toISOString() : receipt?.last_read_at ?? null,
      lastReadMessageId: receipt?.last_read_message_id ?? null,
    });
  }

  res.json({ success: true });
});

/**
 * GET /api/staff-chat/conversations/:id/read-receipts
 */
router.get('/conversations/:id/read-receipts', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const receipts = await pool.query(
    `SELECT r.user_id, r.last_read_at, r.last_read_message_id, r.delivered_at, u.display_name
     FROM staff_read_receipts r
     JOIN users u ON u.id = r.user_id
     WHERE r.conversation_id = $1 AND u.is_active = true`,
    [id],
  );

  res.json({ success: true, data: receipts.rows });
});

// ============================================================================
// Message Edit / Delete
// ============================================================================

/**
 * PUT /api/staff-chat/conversations/:id/messages/:msgId — edit message
 */
router.put('/conversations/:id/messages/:msgId', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) throw new AppError(400, 'Content required');
  if (content.trim().length > 5000) throw new AppError(400, 'Message too long');

  const msg = await pool.query(
    `SELECT sender_id, created_at, deleted_at FROM staff_messages WHERE id = $1 AND conversation_id = $2`,
    [msgId, id],
  );
  if (!msg.rows[0]) throw new AppError(404, 'Message not found');
  if (msg.rows[0].deleted_at) throw new AppError(400, 'Cannot edit deleted message');
  if (msg.rows[0].sender_id !== req.user!.id) throw new AppError(403, 'Can only edit own messages');

  const ageMs = Date.now() - new Date(msg.rows[0].created_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) throw new AppError(400, 'Cannot edit messages older than 24 hours');

  const updated = await pool.query(
    `UPDATE staff_messages SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *`,
    [content.trim(), msgId],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-edited', {
      conversationId: id,
      messageId: msgId,
      content: content.trim(),
      editedAt: updated.rows[0].edited_at,
    });
  }

  res.json({ success: true, data: updated.rows[0] });
});

/**
 * DELETE /api/staff-chat/conversations/:id/messages/:msgId — soft delete
 */
router.delete('/conversations/:id/messages/:msgId', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  const msg = await pool.query(
    `SELECT sender_id, deleted_at FROM staff_messages WHERE id = $1 AND conversation_id = $2`,
    [msgId, id],
  );
  if (!msg.rows[0]) throw new AppError(404, 'Message not found');
  if (msg.rows[0].deleted_at) throw new AppError(400, 'Already deleted');

  const isOwn = msg.rows[0].sender_id === req.user!.id;
  const isAdmin = participantRole === 'owner' || participantRole === 'admin';
  if (!isOwn && !isAdmin) throw new AppError(403, 'Cannot delete this message');

  await pool.query(
    `UPDATE staff_messages SET deleted_at = NOW(), content = '' WHERE id = $1`,
    [msgId],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-deleted', {
      conversationId: id,
      messageId: msgId,
    });
  }

  res.json({ success: true });
});

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * PUT /api/staff-chat/conversations/:id — rename group
 */
router.put('/conversations/:id', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title } = req.body;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  if (!title?.trim()) throw new AppError(400, 'Title required');
  if (title.trim().length > 100) throw new AppError(400, 'Title too long');

  const conv = await pool.query(`SELECT type FROM staff_conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!conv.rows[0]) throw new AppError(404, 'Conversation not found or was deleted');
  if (conv.rows[0].type === 'direct') throw new AppError(400, 'Cannot rename direct chat');
  if (participantRole !== 'owner' && participantRole !== 'admin') {
    throw new AppError(403, 'Only owner or admin can rename');
  }

  const updated = await pool.query(
    `UPDATE staff_conversations SET title = $1 WHERE id = $2 RETURNING *`,
    [title.trim(), id],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:conversation-updated', {
      conversationId: id,
      title: title.trim(),
    });
  }

  res.json({ success: true, data: updated.rows[0] });
});

/**
 * DELETE /api/staff-chat/conversations/:id/leave — leave conversation
 */
router.delete('/conversations/:id/leave', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  const conv = await pool.query(`SELECT type FROM staff_conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!conv.rows[0]) throw new AppError(404, 'Conversation not found or was deleted');
  if (conv.rows[0].type === 'general') throw new AppError(400, 'Cannot leave general chat');
  if (conv.rows[0].type === 'direct') throw new AppError(400, 'Cannot leave direct chat');

  // If owner leaves, transfer ownership to the oldest remaining member
  if (participantRole === 'owner') {
    const nextOwner = await pool.query(
      `SELECT user_id FROM staff_conversation_participants
       WHERE conversation_id = $1 AND user_id != $2 AND left_at IS NULL
       ORDER BY ctid LIMIT 1`,
      [id, req.user!.id],
    );
    if (nextOwner.rows[0]) {
      await pool.query(
        `UPDATE staff_conversation_participants SET role = 'owner'
         WHERE conversation_id = $1 AND user_id = $2`,
        [id, nextOwner.rows[0].user_id],
      );
    }
  }

  await pool.query(
    `UPDATE staff_conversation_participants SET left_at = NOW()
     WHERE conversation_id = $1 AND user_id = $2`,
    [id, req.user!.id],
  );

  const senderName = await getSenderName(req.user!.id);
  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:user-left', {
      conversationId: id,
      userId: req.user!.id,
      userName: senderName,
    });
  }

  res.json({ success: true });
});

/**
 * POST /api/staff-chat/conversations/:id/members — add member to group
 */
router.post('/conversations/:id/members', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { userId } = req.body;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  if (!userId) throw new AppError(400, 'userId required');

  const conv = await pool.query(`SELECT type FROM staff_conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!conv.rows[0]) throw new AppError(404, 'Conversation not found or was deleted');
  if (conv.rows[0].type !== 'group') throw new AppError(400, 'Can only add members to group chats');
  if (participantRole !== 'owner' && participantRole !== 'admin') {
    throw new AppError(403, 'Only owner or admin can add members');
  }

  // Re-activate if previously left, or insert new
  const existing = await pool.query(
    `SELECT user_id, left_at FROM staff_conversation_participants
     WHERE conversation_id = $1 AND user_id = $2`,
    [id, userId],
  );

  if (existing.rows[0]) {
    if (!existing.rows[0].left_at) throw new AppError(400, 'User is already a member');
    await pool.query(
      `UPDATE staff_conversation_participants SET left_at = NULL, role = 'member'
       WHERE conversation_id = $1 AND user_id = $2`,
      [id, userId],
    );
  } else {
    await pool.query(
      `INSERT INTO staff_conversation_participants (conversation_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [id, userId],
    );
  }

  const userName = await getSenderName(userId);
  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:user-joined', {
      conversationId: id,
      userId,
      userName,
    });
  }

  res.json({ success: true });
});

/**
 * DELETE /api/staff-chat/conversations/:id/members/:userId — remove member
 */
router.delete('/conversations/:id/members/:userId', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, userId } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  const conv = await pool.query(`SELECT type FROM staff_conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!conv.rows[0]) throw new AppError(404, 'Conversation not found or was deleted');
  if (conv.rows[0].type !== 'group') throw new AppError(400, 'Can only remove members from group chats');
  if (participantRole !== 'owner' && participantRole !== 'admin') {
    throw new AppError(403, 'Only owner or admin can remove members');
  }
  if (userId === req.user!.id) throw new AppError(400, 'Use /leave to leave the conversation');

  await pool.query(
    `UPDATE staff_conversation_participants SET left_at = NOW()
     WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [id, userId],
  );

  const userName = await getSenderName(userId);
  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:user-left', {
      conversationId: id,
      userId,
      userName,
    });
  }

  res.json({ success: true });
});

/**
 * PUT /api/staff-chat/conversations/:id/settings — mute / notification prefs
 */
router.put('/conversations/:id/settings', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { mutedUntil } = req.body;

  await pool.query(
    `UPDATE staff_conversation_participants SET muted_until = $1
     WHERE conversation_id = $2 AND user_id = $3`,
    [mutedUntil || null, id, req.user!.id],
  );

  res.json({ success: true });
});

// ============================================================================
// Archive / Unarchive
// ============================================================================

/**
 * PUT /api/staff-chat/conversations/:id/archive
 */
router.put('/conversations/:id/archive', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  if (participantRole !== 'owner' && participantRole !== 'admin') {
    throw new AppError(403, 'Only owner or admin can archive');
  }

  await pool.query(
    `UPDATE staff_conversations SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );

  const ss = getSocketServer(req.app);
  if (ss) {
    ss.getIO().to(`staff-chat:${id}`).emit('staff-chat:conversation-archived', {
      conversationId: id,
      archived: true,
    });
  }

  res.json({ success: true });
});

/**
 * PUT /api/staff-chat/conversations/:id/unarchive
 */
router.put('/conversations/:id/unarchive', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  if (participantRole !== 'owner' && participantRole !== 'admin') {
    throw new AppError(403, 'Only owner or admin can unarchive');
  }

  await pool.query(
    `UPDATE staff_conversations SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL`,
    [id],
  );

  const ss = getSocketServer(req.app);
  if (ss) {
    ss.getIO().to(`staff-chat:${id}`).emit('staff-chat:conversation-archived', {
      conversationId: id,
      archived: false,
    });
  }

  res.json({ success: true });
});

// ============================================================================
// Message Restore (undelete)
// ============================================================================

/**
 * PUT /api/staff-chat/conversations/:id/messages/:msgId/restore
 */
router.put('/conversations/:id/messages/:msgId/restore', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  const msg = await pool.query(
    `SELECT sender_id, deleted_at FROM staff_messages WHERE id = $1 AND conversation_id = $2`,
    [msgId, id],
  );
  if (!msg.rows[0]) throw new AppError(404, 'Message not found');
  if (!msg.rows[0].deleted_at) throw new AppError(400, 'Message is not deleted');

  const isOwn = msg.rows[0].sender_id === req.user!.id;
  const isAdmin = participantRole === 'owner' || participantRole === 'admin';
  if (!isOwn && !isAdmin) throw new AppError(403, 'Cannot restore this message');

  const restored = await pool.query(
    `UPDATE staff_messages SET deleted_at = NULL WHERE id = $1 RETURNING *`,
    [msgId],
  );

  const ss = getSocketServer(req.app);
  if (ss) {
    ss.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-restored', {
      conversationId: id,
      messageId: msgId,
      message: restored.rows[0],
    });
  }

  res.json({ success: true, data: restored.rows[0] });
});

/**
 * GET /api/staff-chat/conversations/:id/info — participants and details
 */
router.get('/conversations/:id/info', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const conv = await pool.query(`SELECT * FROM staff_conversations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!conv.rows[0]) throw new AppError(404, 'Conversation not found or was deleted');

  const participants = await pool.query(
    `SELECT p.user_id, p.role, p.muted_until, p.left_at,
            u.display_name, u.email, u.is_active, u.last_seen_at
     FROM staff_conversation_participants p
     JOIN users u ON u.id = p.user_id
     WHERE p.conversation_id = $1 AND p.left_at IS NULL
     ORDER BY
       CASE p.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       u.display_name ASC NULLS LAST`,
    [id],
  );

  res.json({
    success: true,
    data: { ...conv.rows[0], participants: participants.rows },
  });
});

// ============================================================================
// Search
// ============================================================================

/**
 * GET /api/staff-chat/conversations/:id/search?q=text&limit=20&offset=0
 */
router.get('/conversations/:id/search', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const q = (req.query['q'] as string || '').trim();
  const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);

  if (!q || q.length < 2) {
    res.json({ success: true, data: [], hasMore: false });
    return;
  }

  const results = await pool.query(
    `SELECT id, conversation_id, sender_id, sender_name, content, message_type,
            attachment_url, original_filename, created_at,
            ts_rank(to_tsvector('russian', content), plainto_tsquery('russian', $2)) AS rank
     FROM staff_messages
     WHERE conversation_id = $1
       AND deleted_at IS NULL
       AND to_tsvector('russian', content) @@ plainto_tsquery('russian', $2)
     ORDER BY rank DESC, created_at DESC
     LIMIT $3 OFFSET $4`,
    [id, q, limit, offset],
  );

  res.json({ success: true, data: results.rows, hasMore: results.rows.length === limit });
});

// ============================================================================
// Media & Links
// ============================================================================

/**
 * GET /api/staff-chat/conversations/:id/media — медиа-галерея
 */
router.get('/conversations/:id/media', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const type = req.query.type as string | undefined; // image, video, audio, file
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
    const before = req.query.before as string | undefined;

    const params: unknown[] = [id, limit + 1];
    let whereClause = `m.conversation_id = $1 AND m.deleted_at IS NULL AND m.attachment_url IS NOT NULL`;

    if (type) {
      params.push(type);
      whereClause += ` AND m.message_type = $${params.length}`;
    }
    if (before) {
      params.push(before);
      whereClause += ` AND m.created_at < $${params.length}`;
    }

    const result = await pool.query(`
      SELECT m.id, m.conversation_id, m.sender_id, m.sender_name,
             m.content, m.message_type, m.attachment_url, m.original_filename,
             m.created_at
      FROM staff_messages m
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $2
    `, params);

    const hasMore = result.rows.length > limit;
    const data = result.rows.slice(0, limit);

    res.json({ success: true, data, hasMore });
  } catch (err) {
    log.error('Error fetching staff-chat media', { error: String(err) });
    res.status(500).json({ success: false, error: 'Failed to fetch media' });
  }
});

/**
 * GET /api/staff-chat/conversations/:id/links — ссылки из сообщений
 */
router.get('/conversations/:id/links', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const before = req.query.before as string | undefined;

    const params: unknown[] = [id, limit + 1];
    let whereClause = `m.conversation_id = $1 AND m.deleted_at IS NULL AND m.content ~ 'https?://'`;

    if (before) {
      params.push(before);
      whereClause += ` AND m.created_at < $${params.length}`;
    }

    const result = await pool.query(`
      SELECT m.id, m.sender_id, m.sender_name, m.content, m.created_at
      FROM staff_messages m
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $2
    `, params);

    const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;
    const hasMore = result.rows.length > limit;
    const data = result.rows.slice(0, limit).map(r => ({
      ...r,
      urls: r.content.match(URL_REGEX) || [],
    }));

    res.json({ success: true, data, hasMore });
  } catch (err) {
    log.error('Error fetching staff-chat links', { error: String(err) });
    res.status(500).json({ success: false, error: 'Failed to fetch links' });
  }
});

// ============================================================================
// Bookmarks (saved messages)
// ============================================================================

/**
 * POST /api/staff-chat/conversations/:id/messages/:msgId/bookmark — toggle bookmark
 */
router.post('/conversations/:id/messages/:msgId/bookmark', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, msgId } = req.params;
    const userId = req.user!.id;

    const msgCheck = await pool.query(
      'SELECT id FROM staff_messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL',
      [msgId, id]
    );
    if (msgCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    const existing = await pool.query(
      'SELECT id FROM staff_bookmarks WHERE user_id = $1 AND message_id = $2',
      [userId, msgId]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM staff_bookmarks WHERE user_id = $1 AND message_id = $2', [userId, msgId]);
      res.json({ success: true, bookmarked: false });
    } else {
      await pool.query(
        'INSERT INTO staff_bookmarks (user_id, message_id, conversation_id) VALUES ($1, $2, $3)',
        [userId, msgId, id]
      );
      res.json({ success: true, bookmarked: true });
    }
  } catch (err) {
    log.error('Error toggling staff-chat bookmark', { error: String(err) });
    res.status(500).json({ success: false, error: 'Failed to toggle bookmark' });
  }
});

/**
 * GET /api/staff-chat/bookmarks — list current user's bookmarks
 */
router.get('/bookmarks', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
    const before = req.query.before as string | undefined;

    const params: unknown[] = [userId, limit + 1];
    let whereClause = 'b.user_id = $1';
    if (before) {
      params.push(before);
      whereClause += ` AND b.created_at < $${params.length}`;
    }

    const result = await pool.query(`
      SELECT b.id as bookmark_id, b.created_at as bookmarked_at,
             m.id, m.conversation_id, m.sender_id, m.sender_name,
             m.content, m.message_type, m.attachment_url, m.original_filename,
             m.created_at,
             c.title as conversation_title, c.type as conversation_type
      FROM staff_bookmarks b
      JOIN staff_messages m ON m.id = b.message_id
      JOIN staff_conversations c ON c.id = b.conversation_id
      WHERE ${whereClause} AND m.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT $2
    `, params);

    const hasMore = result.rows.length > limit;
    const data = result.rows.slice(0, limit);

    res.json({ success: true, data, hasMore });
  } catch (err) {
    log.error('Error fetching staff-chat bookmarks', { error: String(err) });
    res.status(500).json({ success: false, error: 'Failed to fetch bookmarks' });
  }
});

// ============================================================================
// Reactions
// ============================================================================

/**
 * GET /api/staff-chat/conversations/:id/messages/:msgId/reactions
 */
router.get('/conversations/:id/messages/:msgId/reactions', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { msgId } = req.params;

  const reactions = await pool.query(
    `SELECT emoji, array_agg(user_id) AS users, COUNT(*)::int AS count
     FROM staff_message_reactions
     WHERE message_id = $1
     GROUP BY emoji
     ORDER BY MIN(created_at)`,
    [msgId],
  );

  res.json({ success: true, data: reactions.rows });
});

/**
 * POST /api/staff-chat/conversations/:id/messages/:msgId/reactions
 */
router.post('/conversations/:id/messages/:msgId/reactions', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string' || emoji.length > 10) {
    throw new AppError(400, 'Valid emoji required');
  }

  // Check max 20 unique emoji per message
  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT emoji)::int AS cnt FROM staff_message_reactions WHERE message_id = $1`,
    [msgId],
  );
  if ((countRes.rows[0]?.cnt || 0) >= 20) {
    // Check if this emoji already exists (user adding to existing is fine)
    const existsRes = await pool.query(
      `SELECT 1 FROM staff_message_reactions WHERE message_id = $1 AND emoji = $2 LIMIT 1`,
      [msgId, emoji],
    );
    if (existsRes.rows.length === 0) {
      throw new AppError(400, 'Max 20 different reactions per message');
    }
  }

  await pool.query(
    `INSERT INTO staff_message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [msgId, req.user!.id, emoji],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:reaction-added', {
      conversationId: id,
      messageId: msgId,
      userId: req.user!.id,
      emoji,
    });
  }

  res.json({ success: true });
});

/**
 * DELETE /api/staff-chat/conversations/:id/messages/:msgId/reactions/:emoji
 */
router.delete('/conversations/:id/messages/:msgId/reactions/:emoji', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId, emoji } = req.params;

  await pool.query(
    `DELETE FROM staff_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [msgId, req.user!.id, emoji],
  );

  const socketServer = getSocketServer(req.app);
  if (socketServer) {
    socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:reaction-removed', {
      conversationId: id,
      messageId: msgId,
      userId: req.user!.id,
      emoji,
    });
  }

  res.json({ success: true });
});

// ============================================================================
// Pinned Messages
// ============================================================================

/**
 * GET /api/staff-chat/conversations/:id/pinned
 */
router.get('/conversations/:id/pinned', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const pinned = await pool.query(
    `SELECT id, conversation_id, sender_id, sender_name, content, message_type,
            attachment_url, original_filename, pinned_at, pinned_by, created_at
     FROM staff_messages
     WHERE conversation_id = $1 AND pinned_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY pinned_at DESC`,
    [id],
  );

  res.json({ success: true, data: pinned.rows });
});

/**
 * PUT /api/staff-chat/conversations/:id/messages/:msgId/pin
 */
router.put('/conversations/:id/messages/:msgId/pin', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, msgId } = req.params;
  const { pinned } = req.body;

  if (pinned) {
    // Check max 50 pinned messages per conversation
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM staff_messages WHERE conversation_id = $1 AND pinned_at IS NOT NULL`,
      [id],
    );
    if ((countRes.rows[0]?.cnt || 0) >= 50) {
      throw new AppError(400, 'Max 50 pinned messages per conversation');
    }

    await pool.query(
      `UPDATE staff_messages SET pinned_at = NOW(), pinned_by = $1 WHERE id = $2 AND conversation_id = $3`,
      [req.user!.id, msgId, id],
    );

    const socketServer = getSocketServer(req.app);
    if (socketServer) {
      socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-pinned', {
        conversationId: id,
        messageId: msgId,
      });
    }
  } else {
    await pool.query(
      `UPDATE staff_messages SET pinned_at = NULL, pinned_by = NULL WHERE id = $1 AND conversation_id = $2`,
      [msgId, id],
    );

    const socketServer = getSocketServer(req.app);
    if (socketServer) {
      socketServer.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-unpinned', {
        conversationId: id,
        messageId: msgId,
      });
    }
  }

  res.json({ success: true });
});

// ============================================================================
// Forward Message
// ============================================================================

/**
 * POST /api/staff-chat/conversations/:id/forward
 * Supports single messageId or array messageIds for multi-forward
 */
router.post('/conversations/:id/forward', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { messageId, messageIds, targetConversationId } = req.body;

  // Support both single messageId and array messageIds
  const ids: string[] = messageIds ?? (messageId ? [messageId] : []);
  if (ids.length === 0 || !targetConversationId) {
    throw new AppError(400, 'messageId(s) and targetConversationId required');
  }
  if (ids.length > 50) {
    throw new AppError(400, 'Cannot forward more than 50 messages at once');
  }

  // Verify participation in target conversation
  const targetCheck = await pool.query(
    `SELECT 1 FROM staff_conversation_participants
     WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [targetConversationId, req.user!.id],
  );
  if (targetCheck.rows.length === 0) {
    throw new AppError(403, 'Not a participant of target conversation');
  }

  // Get original messages in order
  const originals = await pool.query(
    `SELECT id, content, sender_name, message_type, attachment_url, original_filename
     FROM staff_messages WHERE id = ANY($1) AND conversation_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [ids, id],
  );
  if (originals.rows.length === 0) throw new AppError(404, 'No valid messages found');

  const senderName = await getSenderName(req.user!.id);
  const ss = getSocketServer(req.app);
  const forwardedMessages: StaffMessageWithReplyMedia[] = [];

  for (const orig of originals.rows) {
    const forwarded = await pool.query<StaffMessageWithReplyMedia>(
      `INSERT INTO staff_messages
        (conversation_id, sender_id, sender_name, content, message_type,
         attachment_url, original_filename, is_forwarded, forwarded_from_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8) RETURNING *`,
      [targetConversationId, req.user!.id, senderName, orig.content, orig.message_type,
       orig.attachment_url, orig.original_filename, orig.sender_name],
    );

    const fwdRow = forwarded.rows[0];
    forwardedMessages.push(fwdRow);

    if (ss) {
      let fwdAttachmentUrl = fwdRow.attachment_url;
      if (fwdAttachmentUrl && storageService.isS3Url(fwdAttachmentUrl)) {
        try { fwdAttachmentUrl = await storageService.resolveSignedUrl(fwdAttachmentUrl); } catch (err) { log.warn('Failed to sign forwarded attachment URL', { error: err }); }
      }
      ss.getIO().to(`staff-chat:${targetConversationId}`).emit('staff-chat:new-message', {
        conversationId: targetConversationId,
        message: { ...fwdRow, attachment_url: fwdAttachmentUrl },
      });
    }
  }

  const firstOrig = originals.rows[0];
  const countLabel = originals.rows.length > 1 ? ` (${originals.rows.length})` : '';
  const firstForwardedId = forwardedMessages[0]?.id;
  void notifyParticipants(
    targetConversationId,
    req.user!.id,
    senderName,
    `↪ ${firstOrig.content?.substring(0, 60) || 'Файл'}${countLabel}`,
    req.app.socketServer?.getIO(),
    firstForwardedId,
  );

  res.json({ success: true, data: forwardedMessages });
});

// ============================================================================
// Batch Delete Messages
// ============================================================================

/**
 * DELETE /api/staff-chat/conversations/:id/messages/batch
 */
router.delete('/conversations/:id/messages/batch', requireParticipation, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { messageIds } = req.body;
  const participantRole = (req as AuthRequest & { participantRole?: string }).participantRole;

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw new AppError(400, 'messageIds array required');
  }
  if (messageIds.length > 100) {
    throw new AppError(400, 'Cannot delete more than 100 messages at once');
  }

  const isAdmin = participantRole === 'owner' || participantRole === 'admin';

  // Admin can delete any, non-admin only own messages
  let result;
  if (isAdmin) {
    result = await pool.query(
      `UPDATE staff_messages SET deleted_at = NOW(), content = ''
       WHERE id = ANY($1) AND conversation_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [messageIds, id],
    );
  } else {
    result = await pool.query(
      `UPDATE staff_messages SET deleted_at = NOW(), content = ''
       WHERE id = ANY($1) AND conversation_id = $2 AND sender_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [messageIds, id, req.user!.id],
    );
  }

  const deletedIds = result.rows.map((r: Record<string, string>) => r['id']);

  const ss = getSocketServer(req.app);
  if (ss) {
    for (const deletedId of deletedIds) {
      ss.getIO().to(`staff-chat:${id}`).emit('staff-chat:message-deleted', {
        conversationId: id,
        messageId: deletedId,
      });
    }
  }

  res.json({ success: true, deletedCount: deletedIds.length, deletedIds });
});

// ============================================================================
// Pre-signed S3 upload for staff chat
// ============================================================================

/**
 * Pre-signed S3 upload for staff chat files
 * POST /api/staff-chat/conversations/:id/direct-upload/presign
 * POST /api/staff-chat/conversations/:id/direct-upload/complete
 */
router.use(
  '/conversations/:id/direct-upload',
  requireParticipation,
  createPresignedUploadRoutes({
    prefix: 'staff-chat',
    allowedMimes: new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
      'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/opus',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
      'application/zip', 'application/x-zip-compressed',
    ]),
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 10,
    auth: [], // auth already applied via router.use at top
    rateLimiter: createUploadLimiter('ul-staff:', 100, 15 * 60 * 1000),
    onComplete: async (files: VerifiedFile[], req, res: ExpressResponse) => {
      const convId = req.params['id'];
      const authReq = req as AuthRequest;
      if (!authReq.user) throw new AppError(401, 'Unauthorized');

      const caption = typeof req.body['caption'] === 'string' ? req.body['caption'].trim() : '';
      const replyToMessageId = typeof req.body['replyToMessageId'] === 'string' ? req.body['replyToMessageId'] : null;
      const senderName = await getSenderName(authReq.user.id);
      const reply = await resolveReplySnapshot(convId, replyToMessageId);

      const savedMessages: StaffMessageWithReplyMedia[] = [];
      const socketServer = getSocketServer(req.app);
      for (const file of files) {
        const messageType = detectMessageType(file.contentType, file.fileName);
        const msg = await pool.query<StaffMessageWithReplyMedia>(
          `INSERT INTO staff_messages
            (conversation_id, sender_id, sender_name, content, message_type,
             attachment_url, original_filename,
             reply_to_message_id, reply_to_content, reply_to_sender_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [convId, authReq.user.id, senderName, caption || file.fileName,
           messageType, file.s3Url, file.fileName,
           reply.replyToId, reply.snapshot?.content ?? null, reply.snapshot?.sender_name ?? null],
        );
        const savedMessage = withReplyMedia(msg.rows[0], reply.snapshot);
        savedMessages.push(savedMessage);

        if (socketServer) {
          let directSignedUrl = savedMessage.attachment_url;
          if (directSignedUrl && storageService.isS3Url(directSignedUrl)) {
            try {
              directSignedUrl = await storageService.resolveSignedUrl(directSignedUrl);
            } catch (err) {
              log.warn('Failed to sign staff-chat attachment URL', { error: String(err) });
            }
          }
          socketServer.getIO().to(`staff-chat:${convId}`).emit('staff-chat:new-message', {
            conversationId: convId,
            message: { ...savedMessage, attachment_url: directSignedUrl },
          });
        }
      }

      const firstType = files[0] ? detectMessageType(files[0].contentType, files[0].fileName) : 'file';
      void notifyParticipants(
        convId,
        authReq.user.id,
        senderName,
        `${firstType === 'image' ? '📷 Фото' : '📎 Файл'}${files.length > 1 ? ` (${files.length})` : ''}`,
        req.app.socketServer?.getIO(),
        savedMessages[0]?.id,
      );

      res.json({ success: true, data: savedMessages });
    },
  }),
);

// ============================================================================
// Contacts & Direct
// ============================================================================

/**
 * GET /api/staff-chat/contacts
 */
router.get('/contacts', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const contacts = await pool.query(
    `SELECT id AS user_id, display_name, email, role, last_seen_at
     FROM users
     WHERE role IN ('admin', 'manager', 'employee', 'photographer')
       AND is_active = true
       AND is_system = false
       AND id != $1
     ORDER BY display_name ASC NULLS LAST, email ASC`,
    [req.user!.id],
  );

  res.json({ success: true, data: contacts.rows });
});

/**
 * GET /api/staff-chat/direct/:userId
 */
router.get('/direct/:userId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { userId } = req.params;
  await getActiveStaffChatUser(userId);

  const direct = await getOrCreateDirectConversation(req.user.id, userId);
  res.json({ success: true, data: direct.conversation });
});

// ============================================================================
// Presence
// ============================================================================

/**
 * GET /api/staff-chat/presence — online status for all staff users
 * Uses Redis ZSET ws:online (scores are Unix timestamps of last activity)
 */
router.get('/presence', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  // Get staff users with last_seen_at
  const usersResult = await pool.query(
    `SELECT id, display_name, last_seen_at
     FROM users
     WHERE role IN ('admin', 'manager', 'employee', 'photographer')
       AND is_active = true
       AND is_system = false`,
  );

  // Get online user IDs from Redis via socketServer
  const ss = getSocketServer(req.app);
  let onlineIds: string[] = [];
  if (hasOnlineUserIds(ss)) {
    onlineIds = await ss.getOnlineUserIds();
  }
  const onlineSet = new Set(onlineIds);

  const presence = usersResult.rows.map(u => ({
    userId: u.id,
    displayName: u.display_name,
    online: onlineSet.has(u.id),
    lastSeenAt: u.last_seen_at,
  }));

  res.json({ success: true, data: presence });
});

export default router;
