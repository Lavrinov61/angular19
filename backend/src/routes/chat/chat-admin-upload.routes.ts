/**
 * chat-admin-upload.routes.ts — Pre-signed S3 upload for CRM operators.
 *
 * POST /admin/sessions/:sessionId/upload/presign  → returns pre-signed PUT URLs
 * POST /admin/sessions/:sessionId/upload/complete  → verifies S3 objects, creates messages
 *
 * Files go directly from browser to S3 — no nginx/multer/RAM limits.
 */

import { Router, Response } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../database/db.js';
import db from '../../database/db.js';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { storageService } from '../../services/storage.service.js';
import { broadcastChatMessage } from '../../services/chat-broadcast.service.js';
import { ALLOWED_MIME_TYPES } from './chat-shared.js';
import { createLogger } from '../../utils/logger.js';
import { validateCompletedUploadObject, type StoredObjectHead } from '../../utils/upload-object-validation.js';

const router = Router();
const log = createLogger('chat-admin-upload');

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PresignFileEntry {
  fileName: string;
  contentType: string;
}

interface CompleteFileEntry {
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

interface CompleteBody {
  files: CompleteFileEntry[];
  replyToMessageId?: string;
}

interface RawPresignEntry {
  fileName?: unknown;
  contentType?: unknown;
}

interface RawCompleteBody {
  files?: unknown;
  replyToMessageId?: unknown;
}

interface RawCompleteEntry extends RawPresignEntry {
  s3Key?: unknown;
  fileSize?: unknown;
}

interface SavedOperatorMessage {
  readonly [key: string]: unknown;
  id: string;
  content?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  sender_type?: string | null;
  message_type?: string | null;
  created_at?: string | Date | null;
}

interface ChatSessionRow {
  channel?: unknown;
  source?: unknown;
  metadata?: unknown;
  visitor_name?: unknown;
  visitor_phone?: unknown;
  status?: unknown;
  assigned_operator_id?: unknown;
}

interface SocketRoomEmitter {
  emit(event: string, data: unknown): void;
}

interface SocketIoLike {
  to(room: string): SocketRoomEmitter;
}

interface SocketServerProvider {
  getIO(): SocketIoLike;
}

interface AppWithSocketServer {
  socketServer: SocketServerProvider;
}

// ── POST /admin/sessions/:sessionId/upload/presign ───────────────────────────

router.post('/admin/sessions/:sessionId/upload/presign', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const rawFiles: unknown = req.body.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new AppError(400, 'files array required');
  }

  const uploads: { s3Key: string; uploadUrl: string; contentType: string }[] = [];

  for (const raw of rawFiles) {
    const entry = parsePresignEntry(raw);
    const ext = path.extname(entry.fileName).toLowerCase() || '.bin';
    const s3Key = `chat/${uuidv4()}${ext}`;
    const { url } = await storageService.generatePresignedPutUrl(s3Key, entry.contentType);
    uploads.push({ s3Key, uploadUrl: url, contentType: entry.contentType });
  }

  res.json({ success: true, data: { uploads } });
});

// ── POST /admin/sessions/:sessionId/upload/complete ──────────────────────────

router.post('/admin/sessions/:sessionId/upload/complete', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const user = req.user;

  const body = parseCompleteBody(req.body);
  const savedMessages: SavedOperatorMessage[] = [];

  // Validate s3Keys before any S3 calls
  for (const file of body.files) {
    if (!file.s3Key.startsWith('chat/')) throw new AppError(400, `invalid s3Key: ${file.s3Key}`);
  }

  // Verify S3 objects in parallel
  const headResults = await Promise.allSettled(
    body.files.map((file, i) => withTimeout(storageService.headObject(file.s3Key), 5000, `headObject[${i}]`))
  );
  const objectHeads: StoredObjectHead[] = [];
  for (let i = 0; i < headResults.length; i++) {
    const r = headResults[i];
    if (r.status === 'rejected' || !r.value) throw new AppError(400, `File not found in S3: ${body.files[i].s3Key}`);
    objectHeads.push(r.value);
  }

  await Promise.all(body.files.map((file, i) => validateCompletedUploadObject({
    file,
    head: objectHeads[i],
    storage: storageService,
    index: i,
  })));

  for (let i = 0; i < body.files.length; i++) {
    const file = body.files[i];
    const head = objectHeads[i];
    const fileUrl = storageService.getPublicUrl(file.s3Key);
    const originalName = file.fileName || file.s3Key.split('/').pop() || 'file';
    const isImage = file.contentType.startsWith('image/');
    const messageType = isImage ? 'image' : 'file';

    // Resolve reply-to external ID
    let replyToExternalId: string | null = null;
    if (body.replyToMessageId) {
      const replyRow = await pool.query(
        `SELECT external_message_id FROM messages WHERE id = $1 AND conversation_id = $2`,
        [body.replyToMessageId, sessionId],
      );
      if (replyRow.rows[0]) replyToExternalId = replyRow.rows[0].external_message_id;
    }

    // Transaction: insert message + update conversation
    const txResult = await db.transaction(async (client) => {
      const msgResult = await client.query<SavedOperatorMessage>(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_id, sender_name, message_type, content, attachment_url, reply_to_message_id)
         VALUES ($1, 'operator', $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [sessionId, user.id, 'Оператор', messageType, originalName, fileUrl, body.replyToMessageId || null],
      );
      await client.query(
        `UPDATE conversations
         SET last_message_at = NOW(),
             last_message_content = LEFT($2, 200),
             message_count = COALESCE(message_count, 0) + 1
         WHERE id = $1`,
        [sessionId, isImage ? '📷 Фото' : `📎 ${originalName}`],
      );
      const sessionData = await client.query<ChatSessionRow>(
        `SELECT channel, source, metadata, visitor_name, visitor_phone, status, assigned_operator_id
         FROM conversations WHERE id = $1`,
        [sessionId],
      );
      return { msg: msgResult.rows[0], sessionRow: sessionData.rows[0] };
    });

    const { msg, sessionRow } = txResult;

    // media_attachments for correct MIME on download
    pool.query(
      `INSERT INTO media_attachments
        (message_id, s3_key, s3_url, media_type, mime_type, file_size_bytes, file_name, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
       ON CONFLICT DO NOTHING`,
      [msg.id, file.s3Key, fileUrl, messageType, file.contentType, head.contentLength, originalName],
    ).catch(err => log.error('media_attachments insert failed', { error: String(err) }));

    // Socket.IO broadcast
    emitToSockets(req, sessionId, msg, sessionRow, fileUrl);

    // Outbound delivery to messenger
    await deliverToMessenger(sessionId, msg, sessionRow, fileUrl, originalName, messageType, replyToExternalId);

    savedMessages.push(msg);
  }

  res.json({ success: true, data: savedMessages.length === 1 ? savedMessages[0] : savedMessages });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePresignEntry(raw: unknown): PresignFileEntry {
  if (!isRawPresignEntry(raw)) throw new AppError(400, 'invalid file entry');
  const fileName = typeof raw.fileName === 'string' ? raw.fileName : '';
  const contentType = typeof raw.contentType === 'string' ? raw.contentType : '';
  if (!fileName) throw new AppError(400, 'fileName required');
  if (!ALLOWED_MIME_TYPES.has(contentType)) throw new AppError(400, `unsupported type: ${contentType}`);
  return { fileName, contentType };
}

function parseCompleteBody(raw: unknown): CompleteBody {
  if (!isRawCompleteBody(raw)) throw new AppError(400, 'invalid body');
  const files = Array.isArray(raw.files) ? raw.files : [];
  if (files.length === 0) throw new AppError(400, 'files array required');
  const replyToMessageId = typeof raw.replyToMessageId === 'string' ? raw.replyToMessageId : undefined;
  const parsed: CompleteFileEntry[] = files.map((f: unknown) => {
    if (!isRawCompleteEntry(f)) throw new AppError(400, 'invalid file entry');
    return {
      s3Key: typeof f.s3Key === 'string' ? f.s3Key : '',
      fileName: typeof f.fileName === 'string' ? f.fileName : '',
      contentType: typeof f.contentType === 'string' ? f.contentType : '',
      fileSize: typeof f.fileSize === 'number' ? f.fileSize : 0,
    };
  });
  return { files: parsed, replyToMessageId };
}

function isRawPresignEntry(value: unknown): value is RawPresignEntry {
  return typeof value === 'object' && value !== null;
}

function isRawCompleteBody(value: unknown): value is RawCompleteBody {
  return typeof value === 'object' && value !== null;
}

function isRawCompleteEntry(value: unknown): value is RawCompleteEntry {
  return typeof value === 'object' && value !== null;
}

function emitToSockets(
  req: AuthRequest,
  sessionId: string,
  msg: SavedOperatorMessage,
  sessionRow: ChatSessionRow | undefined,
  fileUrl: string,
): void {
  if (!hasSocketServer(req.app)) return;

  const io = req.app.socketServer.getIO();

  const resolveAndEmit = async (): Promise<void> => {
    let attachmentUrl = fileUrl;
    if (storageService.isS3Url(attachmentUrl)) {
      try { attachmentUrl = await storageService.resolveSignedUrl(attachmentUrl); } catch { /* keep original */ }
    }
    io.to(`visitor:${sessionId}`).emit('operator:message', {
      sessionId, id: msg['id'], content: msg['content'],
      senderName: msg['sender_name'], senderType: msg['sender_type'],
      messageType: msg['message_type'], attachmentUrl,
      timestamp: msg['created_at'],
    });
    broadcastChatMessage({
      sessionId, message: msg,
      session: sessionRow ? {
        visitor_name: String(sessionRow['visitor_name'] ?? ''),
        visitor_phone: String(sessionRow['visitor_phone'] ?? ''),
        channel: String(sessionRow['channel'] ?? ''),
        status: String(sessionRow['status'] ?? ''),
        assigned_operator_id: sessionRow['assigned_operator_id'] ? String(sessionRow['assigned_operator_id']) : null,
        assigned_operator_name: null,
      } : null,
    }).catch(err => log.error('broadcastChatMessage failed', { error: String(err) }));
  };

  resolveAndEmit().catch(err => log.error('Socket emit failed', { error: String(err) }));
}

async function deliverToMessenger(
  sessionId: string,
  msg: SavedOperatorMessage,
  sessionRow: ChatSessionRow | undefined,
  fileUrl: string,
  originalName: string,
  messageType: string,
  replyToExternalId: string | null,
): Promise<void> {
  if (!sessionRow) return;
  const channel = sessionRow['channel'];
  if (typeof channel !== 'string' || ['web', 'online', 'studio'].includes(channel)) return;
  const externalChatId = getExternalChatId(sessionRow.metadata);
  if (!externalChatId) return;

  try {
    const { enqueueOutbound } = await import('../../services/connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel: channel as Parameters<typeof enqueueOutbound>[0]['channel'],
      externalChatId, content: originalName,
      messageType: messageType as Parameters<typeof enqueueOutbound>[0]['messageType'],
      attachmentUrl: fileUrl, sourceMessageId: String(msg['id']),
      conversationId: sessionId,
      replyToExternalId: replyToExternalId || undefined,
    });
  } catch (err) {
    log.error('enqueueOutbound failed (message saved in DB)', { error: String(err) });
  }
}

function hasSocketServer(value: unknown): value is AppWithSocketServer {
  if (typeof value !== 'object' || value === null || !('socketServer' in value)) return false;
  const socketServer = value.socketServer;
  if (typeof socketServer !== 'object' || socketServer === null || !('getIO' in socketServer)) return false;
  return typeof socketServer.getIO === 'function';
}

function getExternalChatId(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null || !('externalChatId' in metadata)) return null;
  return typeof metadata.externalChatId === 'string' ? metadata.externalChatId : null;
}

export default router;
