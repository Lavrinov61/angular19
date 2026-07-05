/**
 * chat-direct-upload.routes.ts — Pre-signed S3 upload endpoints.
 *
 * Replaces multer memoryStorage with direct client-to-S3 uploads:
 *   POST /presign  → returns pre-signed PUT URLs
 *   POST /complete → verifies S3 objects, creates messages, runs bot
 *   POST /complete-bundle → same + order context
 *
 * Auth-only: endpoints требуют JWT (routed через /sessions/:id/upload authenticateToken).
 */

import { Router, Response } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { storageService } from '../../services/storage.service.js';
import { ALLOWED_MIME_TYPES, detectMessageType, fileTypeCaption, uploadLimiter, getOwnedConversation } from './chat-shared.js';
import { getSessionContext, updateSessionContext } from './chat-context.service.js';
import { requireUser, type AuthRequest } from '../../middleware/auth.js';
import { broadcastChatMessage } from '../../services/chat-broadcast.service.js';
import {
  mapBundleSelectedOptionsByGroup,
  buildPostUploadBotResponse,
} from './chat-upload-helpers.js';
import type { SubmitOrderBundlePayload } from './chat-upload-helpers.js';
import type { EntryContext } from './chat-shared.js';
import { generateOrderNumber, handlePayOrderInternal } from './chat-order.service.js';

import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
const router = Router();

const logger = createLogger('chat-direct-upload.routes');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES_PER_REQUEST = 500;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

interface PresignFileEntry {
  fileName: string;
  contentType: string;
  fileSize: number;
}

interface CompleteFileEntry {
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

interface RawPresignFileEntry {
  fileName?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
}

interface RawCompleteFileEntry extends RawPresignFileEntry {
  s3Key?: unknown;
}

interface UploadMessageRow {
  readonly [key: string]: unknown;
  id: string;
  content: string;
  created_at: string | Date | null;
}

interface GroupedSelectedOptions {
  readonly [groupSlug: string]: string[];
}

interface BundleSessionContextPatch {
  selectedOptions?: GroupedSelectedOptions;
  selectedDoc?: string;
  selectedDocs?: string[];
  customerNote?: string;
  categorySlug?: string;
  orderNumber?: number;
}

interface PendingOrderData {
  readonly [key: string]: unknown;
  delivery_method?: string;
  channel?: string;
  categorySlug?: string;
  price?: number;
  tariff?: string;
  service?: string;
  photoCount?: number;
  firstPrice?: number;
  nextPrice?: number;
  size?: string;
  copies?: number;
  printType?: string;
  borders?: string;
}

interface OwnedUploadSession {
  id: string;
  visitor_id: string | null;
  user_id: string | null;
  channel: string | null;
  source: string | null;
  entry_context: EntryContext | null;
  status: string | null;
  visitor_name: string | null;
  visitor_phone: string | null;
  assigned_operator_id: string | null;
  selected_service: string | null;
  selected_price: number | null;
  page_url: string | null;
  user_agent: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

function isRawPresignFileEntry(value: unknown): value is RawPresignFileEntry {
  return typeof value === 'object' && value !== null;
}

function isRawCompleteFileEntry(value: unknown): value is RawCompleteFileEntry {
  return typeof value === 'object' && value !== null;
}

function isPendingOrderData(value: unknown): value is PendingOrderData {
  return typeof value === 'object' && value !== null;
}

function validateFileEntry(entry: unknown, index: number): PresignFileEntry {
  if (!isRawPresignFileEntry(entry)) throw new AppError(400, `files[${index}]: invalid entry`);
  const e = entry;
  const fileName = typeof e['fileName'] === 'string' ? e['fileName'] : '';
  const contentType = typeof e['contentType'] === 'string' ? e['contentType'] : '';
  const fileSize = typeof e['fileSize'] === 'number' ? e['fileSize'] : 0;
  if (!fileName) throw new AppError(400, `files[${index}]: fileName required`);
  if (!ALLOWED_MIME_TYPES.has(contentType)) throw new AppError(400, `files[${index}]: unsupported type ${contentType}`);
  if (fileSize > MAX_FILE_SIZE) throw new AppError(400, `files[${index}]: exceeds 50MB limit`);
  return { fileName, contentType, fileSize };
}

function validateCompleteEntry(entry: unknown, index: number): CompleteFileEntry {
  if (!isRawCompleteFileEntry(entry)) throw new AppError(400, `files[${index}]: invalid entry`);
  const e = entry;
  const s3Key = typeof e['s3Key'] === 'string' ? e['s3Key'] : '';
  if (!s3Key.startsWith('chat/')) throw new AppError(400, `files[${index}]: invalid s3Key`);
  const fileName = typeof e['fileName'] === 'string' ? e['fileName'] : '';
  const contentType = typeof e['contentType'] === 'string' ? e['contentType'] : '';
  const fileSize = typeof e['fileSize'] === 'number' ? e['fileSize'] : 0;
  return { s3Key, fileName, contentType, fileSize };
}

function isClosedConversationStatus(status: string | null | undefined): boolean {
  return status === 'resolved' || status === 'closed';
}

function statusAfterVisitorActivity(status: string | null | undefined): string {
  return isClosedConversationStatus(status) ? 'open' : status || 'open';
}

async function markVisitorActivity(
  sessionId: string,
  preview: string,
  messageCount: number,
): Promise<void> {
  await pool.query(
    `UPDATE conversations
        SET status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END,
            closed_at = CASE WHEN status IN ('resolved','closed') THEN NULL ELSE closed_at END,
            last_message_at = NOW(),
            last_message_content = LEFT($2, 200),
            message_count = COALESCE(message_count, 0) + $3,
            updated_at = NOW()
      WHERE id = $1`,
    [sessionId, preview, messageCount],
  );
}

async function verifyOwnedSession(userId: string, sessionId: string): Promise<OwnedUploadSession> {
  await getOwnedConversation(userId, sessionId);
  const result = await pool.query<OwnedUploadSession>(
    `SELECT id, visitor_id, user_id, channel, source, entry_context, status, visitor_name,
            visitor_phone, assigned_operator_id, selected_service, selected_price,
            page_url, user_agent, created_at, updated_at
     FROM conversations WHERE id = $1`,
    [sessionId]
  );
  if (result.rows.length === 0) throw new AppError(404, 'Session not found');
  return result.rows[0];
}

// ─── POST /sessions/:sessionId/upload/presign ────────────────────────────────

router.post('/sessions/:sessionId/upload/presign', uploadLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const { sessionId } = req.params;
  const { files } = req.body;

  if (!Array.isArray(files) || files.length === 0) throw new AppError(400, 'files array required');
  if (files.length > MAX_FILES_PER_REQUEST) throw new AppError(400, `max ${MAX_FILES_PER_REQUEST} files per request`);

  await verifyOwnedSession(req.user.id, sessionId);

  const uploads = await Promise.all(
    files.map(async (raw: unknown, i: number) => {
      const entry = validateFileEntry(raw, i);
      const ext = path.extname(entry.fileName).toLowerCase() || '.bin';
      const s3Key = `chat/${uuidv4()}${ext}`;
      const { url } = await storageService.generatePresignedPutUrl(s3Key, entry.contentType);
      return { s3Key, uploadUrl: url, contentType: entry.contentType };
    })
  );

  res.json({ success: true, data: { uploads } });
});

// ─── POST /sessions/:sessionId/upload/complete ───────────────────────────────

router.post('/sessions/:sessionId/upload/complete', uploadLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const { sessionId } = req.params;
  const { files, caption, suppressBot } = req.body;
  void suppressBot;

  if (!Array.isArray(files) || files.length === 0) throw new AppError(400, 'files array required');

  const session = await verifyOwnedSession(req.user.id, sessionId);
  const visitorId = session.visitor_id || null;
  const visitorDisplayName = session.visitor_name || req.user.display_name || 'Клиент';

  // Validate entries
  const validated: CompleteFileEntry[] = files.map((raw: unknown, i: number) => validateCompleteEntry(raw, i));

  // Verify S3 objects in parallel
  const headResults = await Promise.allSettled(
    validated.map((entry, i) => withTimeout(storageService.headObject(entry.s3Key), 5000, `headObject[${i}]`))
  );
  for (let i = 0; i < headResults.length; i++) {
    const r = headResults[i];
    if (r.status === 'rejected' || !r.value) throw new AppError(400, `files[${i}]: not found in storage`);
  }

  // Batch INSERT all messages + photo count in a transaction
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < validated.length; i++) {
    const file = validated[i];
    const attachmentUrl = storageService.getPublicUrl(file.s3Key);
    const msgType = detectMessageType(file.contentType, file.fileName);
    const msgCaption = validated.length > 1
      ? `${fileTypeCaption(msgType)} ${i + 1}/${validated.length}${caption ? ` — ${caption}` : ''}`
      : caption || fileTypeCaption(msgType);
    const off = i * 5;
    placeholders.push(`($${off + 1}, 'visitor', $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5})`);
    values.push(sessionId, visitorDisplayName, msgType, msgCaption, attachmentUrl);
  }

  const client = await pool.connect();
  let savedMessages: UploadMessageRow[];
  let totalPhotoCount: number;
  try {
    await client.query('BEGIN');
    const insertResult = await client.query<UploadMessageRow>(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_name, message_type, content, attachment_url)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );
    savedMessages = insertResult.rows;

    const photoCountResult = await client.query(
      `SELECT COUNT(*) as cnt FROM messages
       WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor'`,
      [sessionId]
    );
    totalPhotoCount = parseInt(String(photoCountResult.rows[0].cnt), 10);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await updateSessionContext(sessionId, { hasPhoto: totalPhotoCount > 0, photoCount: totalPhotoCount });
  const lastSavedMessage = savedMessages[savedMessages.length - 1];
  await markVisitorActivity(sessionId, lastSavedMessage?.content || '', savedMessages.length);
  const liveSessionStatus = statusAfterVisitorActivity(session.status);

  // Broadcast to operators
  const socketServer = req.app.socketServer;
  if (socketServer) {
    const sessionMeta = {
      visitor_name: session.visitor_name,
      visitor_phone: session.visitor_phone || null,
      channel: session.channel || 'web',
      status: liveSessionStatus,
      assigned_operator_id: session.assigned_operator_id || null,
    };
    for (const msg of savedMessages) {
      broadcastChatMessage({
        sessionId,
        message: { ...msg, visitorId },
        session: sessionMeta,
      }).catch(err => logger.error('[direct-upload] broadcast failed', { error: String(err) }));
    }
  }

  if (validated.length === 1) {
    res.json({
      success: true,
      data: { message: savedMessages[0], botResponse: null, attachmentUrl: storageService.getPublicUrl(validated[0].s3Key) },
    });
  } else {
    res.json({ success: true, data: { messages: savedMessages, botResponse: null, count: validated.length } });
  }
});

// ─── POST /sessions/:sessionId/upload/complete-bundle ────────────────────────

router.post('/sessions/:sessionId/upload/complete-bundle', uploadLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const { sessionId } = req.params;
  const { files, orderConfig } = req.body;

  if (!Array.isArray(files) || files.length === 0) throw new AppError(400, 'files array required');

  const session = await verifyOwnedSession(req.user.id, sessionId);
  const visitorId = session.visitor_id || null;
  const visitorDisplayName = session.visitor_name || req.user.display_name || 'Клиент';

  // Validate entries
  const validated: CompleteFileEntry[] = files.map((raw: unknown, i: number) => validateCompleteEntry(raw, i));

  // Verify S3 objects in parallel
  const headResults = await Promise.allSettled(
    validated.map((entry, i) => withTimeout(storageService.headObject(entry.s3Key), 5000, `headObject[${i}]`))
  );
  for (let i = 0; i < headResults.length; i++) {
    const r = headResults[i];
    if (r.status === 'rejected' || !r.value) throw new AppError(400, `files[${i}]: not found in storage`);
  }

  // Parse order config
  const bundlePayload: SubmitOrderBundlePayload = (orderConfig && typeof orderConfig === 'object') ? orderConfig : {};
  const categorySlug = bundlePayload.categorySlug || 'photo-docs';
  const groupedSelectedOptions: GroupedSelectedOptions = await mapBundleSelectedOptionsByGroup(categorySlug, bundlePayload.selectedOptions || []);

  // Update session context
  const contextPatch: BundleSessionContextPatch = {};
  if (Object.keys(groupedSelectedOptions).length > 0) contextPatch['selectedOptions'] = groupedSelectedOptions;
  if (bundlePayload.selectedDoc?.trim()) contextPatch['selectedDoc'] = bundlePayload.selectedDoc.trim();
  else if (bundlePayload.selectedDocs?.length) contextPatch['selectedDoc'] = `Комплект документов: ${bundlePayload.selectedDocs.join(', ')}`;
  if (bundlePayload.selectedDocs?.length) contextPatch['selectedDocs'] = bundlePayload.selectedDocs;
  if (bundlePayload.customerNote?.trim()) contextPatch['customerNote'] = bundlePayload.customerNote.trim();
  contextPatch['categorySlug'] = categorySlug;
  contextPatch['orderNumber'] = 1;

  if (Object.keys(contextPatch).length > 0) {
    await pool.query(
      `UPDATE conversations SET context = COALESCE(context, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [sessionId, JSON.stringify(contextPatch)],
    );
  }

  // Batch INSERT hidden messages
  const attachmentUrls: string[] = [];
  const bValues: unknown[] = [];
  const bPlaceholders: string[] = [];
  for (let i = 0; i < validated.length; i++) {
    const file = validated[i];
    const attachmentUrl = storageService.getPublicUrl(file.s3Key);
    attachmentUrls.push(attachmentUrl);
    const msgType = detectMessageType(file.contentType, file.fileName);
    const off = i * 6;
    bPlaceholders.push(`($${off + 1}, 'visitor', $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}::jsonb)`);
    bValues.push(sessionId, visitorDisplayName, msgType, `\u{1F4F7} \u0424\u043E\u0442\u043E ${i + 1}/${validated.length}`, attachmentUrl,
      JSON.stringify({ hiddenInUi: true, source: 'bundle_submit' }));
  }
  await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, attachment_url, metadata)
     VALUES ${bPlaceholders.join(', ')}`,
    bValues,
  );

  // Visible gallery message
  const galleryResult = await pool.query<UploadMessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'visitor', $2, 'text', $3, $4::jsonb)
     RETURNING *`,
    [sessionId, visitorDisplayName, `📷 ${validated.length} фото загружены`,
     JSON.stringify({ gallery: attachmentUrls, source: 'bundle_submit' })],
  );

  await updateSessionContext(sessionId, { hasPhoto: validated.length > 0, photoCount: validated.length });

  const galleryRow = galleryResult.rows[0];
  if (!galleryRow) {
    throw new AppError(500, 'Failed to create gallery message');
  }
  const galleryMessage = { ...galleryRow, gallery_urls: attachmentUrls };
  await markVisitorActivity(sessionId, galleryMessage.content || '', validated.length + 1);
  const liveSessionStatus = statusAfterVisitorActivity(session.status);

  // Broadcast gallery
  const socketServer = req.app.socketServer;
  if (socketServer) {
    broadcastChatMessage({
      sessionId,
      message: { ...galleryMessage, visitorId },
      session: {
        visitor_name: session.visitor_name, visitor_phone: session.visitor_phone || null,
        channel: session.channel || 'web', status: liveSessionStatus,
        assigned_operator_id: session.assigned_operator_id || null,
      },
    }).catch(err => logger.error('[direct-upload] broadcast failed', { error: String(err) }));
  }

  // ── Build order summary + create order atomically ──────────────────────
  let botResponseMsg: UploadMessageRow | null = null;
  let orderId: string | null = null;
  let orderTotal: number | null = null;

  if (config.chat.botEnabled) try {
    const botResult = await buildPostUploadBotResponse(
      sessionId, session, validated.length, 'batch',
      categorySlug, undefined, bundlePayload.configuratorTotal,
    );

    // Extract pending order data from bot response buttons
    const firstButton = botResult.botInteractive?.buttons?.[0];
    const rawPendingOrder = firstButton && 'data' in firstButton ? firstButton.data : undefined;
    const pendingOrder = isPendingOrderData(rawPendingOrder) ? rawPendingOrder : undefined;

    let orderCreated = false;
    if (pendingOrder) {
      const orderNumber = await generateOrderNumber(sessionId);
      const deliveryMethod = pendingOrder.delivery_method || 'electronic';
      const delivery: import('./chat-shared.js').DeliveryInfo = {
        pickup: deliveryMethod === 'pickup' ? 'Студия Своё Фото' : 'Электронная доставка',
        production: 'Студия Своё Фото',
      };
      const orderResult = await handlePayOrderInternal(
        sessionId, pendingOrder, delivery, orderNumber,
      );

      orderId = `chat-${sessionId}-${orderNumber}`;
      orderTotal = pendingOrder.price || bundlePayload.configuratorTotal || null;

      // Save order confirmation message (single consolidated message)
      if (orderResult.content) {
        orderCreated = true;
        const confirmInsert = await pool.query<UploadMessageRow>(
          `INSERT INTO messages
            (conversation_id, sender_type, sender_name, message_type, content, metadata)
           VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3::jsonb)
           RETURNING *`,
          [sessionId, orderResult.content,
           JSON.stringify({ interactive: orderResult.interactive, source: 'bundle_order_confirm' })],
        );

        const confirmMessage = confirmInsert.rows[0];
        if (socketServer && confirmMessage) {
          broadcastChatMessage({
            sessionId,
            message: { ...confirmMessage, visitorId },
            session: {
              visitor_name: session.visitor_name, visitor_phone: session.visitor_phone || null,
              channel: session.channel || 'web', status: liveSessionStatus,
              assigned_operator_id: session.assigned_operator_id || null,
            },
          }).catch(err => logger.error('[direct-upload] confirm broadcast failed', { error: String(err) }));
        }
      }
    }

    // Only save intermediate bot summary if order was NOT created
    // (order confirmation already contains all details — avoid duplicate messages)
    if (!orderCreated) {
      const botInsert = await pool.query<UploadMessageRow>(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'text', $2, $3::jsonb)
         RETURNING *`,
        [sessionId, botResult.botResponse,
         JSON.stringify({ interactive: botResult.botInteractive, source: 'bundle_order' })],
      );
      botResponseMsg = botInsert.rows[0] || null;

      if (socketServer && botResponseMsg) {
        broadcastChatMessage({
          sessionId,
          message: { ...botResponseMsg, visitorId },
          session: {
            visitor_name: session.visitor_name, visitor_phone: session.visitor_phone || null,
            channel: session.channel || 'web', status: liveSessionStatus,
            assigned_operator_id: session.assigned_operator_id || null,
          },
        }).catch(err => logger.error('[direct-upload] bot broadcast failed', { error: String(err) }));
      }
    }
  } catch (err) {
    // Order creation failed but photos were uploaded — log error, return partial success
    logger.error('[complete-bundle] Order creation failed', { error: String(err), sessionId });
  }

  res.json({
    success: true,
    data: { galleryMessage, botResponse: botResponseMsg, count: validated.length, orderId, orderTotal },
  });
});

export default router;
