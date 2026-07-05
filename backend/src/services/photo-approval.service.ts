/**
 * photo-approval.service.ts — Business logic for photo approval flow.
 * Extracted from photo-approvals.routes.ts (Stage 2B).
 * In Stage 3 notifications/WS/push become BullMQ jobs.
 */

import { pool } from '../database/db.js';
import db from '../database/db.js';
import crypto from 'crypto';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('photo-approval');
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middleware/errorHandler.js';
import { NotificationService } from './notification.service.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { storageService } from './storage.service.js';
import { generateThumbnail } from './approval-thumbnail.service.js';
import { updateSessionCounters, loadPhotoStatuses } from './approval-counters.service.js';
import type {
  PhotoApprovalRow,
  PhotoApprovalSessionRow,
  PhotoApprovalVariantRow,
  ApprovalStats,
  ConversationChannelInfo,
  ChatSessionId,
} from '../types/views/approval-views.js';
import type { IdOnly } from '../types/db-common.types.js';
import type Users from '../types/generated/public/Users.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type Messages from '../types/generated/public/Messages.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApprovalAccessInfo {
  clientId: string | null;
  photographerId: string | null;
  sessionClientId: string | null;
  approvalSessionId: string | null;
  status: string;
}

interface ConversationExternalMetadata {
  externalChatId?: unknown;
}

interface BroadcastableMessage extends Messages {
  readonly [key: string]: unknown;
}

function isConversationExternalMetadata(value: unknown): value is ConversationExternalMetadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── Ownership check (shared across approve/reject/unapprove/request-changes) ─

export async function checkApprovalAccess(
  photoId: string,
  userId: string,
  userRole: string,
): Promise<ApprovalAccessInfo> {
  const result = await pool.query<Pick<PhotoApprovalRow, 'client_id' | 'photographer_id' | 'status' | 'approval_session_id'> & { session_client_id: string | null }>(
    `SELECT pa.client_id, pa.photographer_id, pa.status, pa.approval_session_id,
            pas.client_id as session_client_id
     FROM photo_approvals pa
     LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
     WHERE pa.id = $1`,
    [photoId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const row = result.rows[0];
  const isStaff = ['admin', 'employee', 'photographer'].includes(userRole);
  const isOwner = row.client_id === userId
    || row.session_client_id === userId
    || row.photographer_id === userId
    || isStaff;

  if (!isOwner) {
    throw new AppError(403, 'Forbidden');
  }

  return {
    clientId: row.client_id,
    photographerId: row.photographer_id,
    sessionClientId: row.session_client_id,
    approvalSessionId: row.approval_session_id,
    status: row.status,
  };
}

// ─── WS emit helper ────────────────────────────────────────────────────────

async function emitApprovalReview(
  sessionId: string,
  action: string,
  photoId: string,
): Promise<void> {
  try {
    const photos = await loadPhotoStatuses(sessionId);
    broadcastToRoom('approval:photo-reviewed', 'admin:visitor-chats', {
      sessionId, action, photoId, photos,
    });
  } catch { /* pub/sub not available */ }
}

// ─── 1. Approve photo ──────────────────────────────────────────────────────

export interface ApprovePhotoParams {
  photoId: string;
  userId: string;
  userRole: string;
  comment?: string;
  selectedVariantId?: string;
}

export async function approvePhoto(params: ApprovePhotoParams): Promise<PhotoApprovalRow> {
  const { photoId, userId, userRole, comment, selectedVariantId } = params;
  const approval = await checkApprovalAccess(photoId, userId, userRole);
  const isStaff = ['admin', 'employee', 'photographer'].includes(userRole);

  // Select variant if provided
  if (selectedVariantId && approval.approvalSessionId) {
    await pool.query(
      'UPDATE photo_approval_variants SET is_selected = FALSE, selected_at = NULL WHERE approval_id = $1',
      [photoId],
    );
    await pool.query(
      'UPDATE photo_approval_variants SET is_selected = TRUE, selected_at = NOW() WHERE id = $1 AND approval_id = $2',
      [selectedVariantId, photoId],
    );
    await pool.query(
      'UPDATE photo_approvals SET selected_variant_id = $1 WHERE id = $2',
      [selectedVariantId, photoId],
    );
  }

  const approvedByRole = isStaff ? 'employee' : 'client';

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET status = 'approved', comment = $2, approved_at = NOW(), updated_at = NOW(),
         approved_by = $3, approved_by_role = $4
     WHERE id = $1
     RETURNING *`,
    [photoId, comment || null, userId, approvedByRole],
  );

  if (approval.approvalSessionId) {
    await updateSessionCounters(approval.approvalSessionId);
  }

  // Notify photographer (fire-and-forget → BullMQ in Stage 3)
  const notifBody = isStaff ? 'Оператор одобрил результат ретуши' : 'Клиент одобрил результат ретуши';
  NotificationService.create({
    userId: approval.photographerId!,
    title: 'Фото одобрено',
    body: notifBody,
    type: 'retouch_approval',
    data: { approval_id: photoId },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  if (approval.approvalSessionId) {
    await emitApprovalReview(approval.approvalSessionId, 'approved', photoId);
  }

  return result.rows[0];
}

// ─── 2. Unapprove photo ────────────────────────────────────────────────────

export interface UnapprovePhotoParams {
  photoId: string;
  userId: string;
  userRole: string;
}

export async function unapprovePhoto(params: UnapprovePhotoParams): Promise<PhotoApprovalRow> {
  const { photoId, userId, userRole } = params;

  if (!['admin', 'employee', 'photographer'].includes(userRole)) {
    throw new AppError(403, 'Only staff can unapprove');
  }

  const check = await pool.query<Pick<PhotoApprovalRow, 'approval_session_id'>>(
    'SELECT pa.approval_session_id FROM photo_approvals pa WHERE pa.id = $1',
    [photoId],
  );
  if (check.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  // Clear variant selection
  await pool.query(
    'UPDATE photo_approval_variants SET is_selected = FALSE, selected_at = NULL WHERE approval_id = $1',
    [photoId],
  );

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET status = 'pending', approved_at = NULL, selected_variant_id = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [photoId],
  );

  const sessionId = check.rows[0].approval_session_id;
  if (sessionId) {
    await updateSessionCounters(sessionId);
    await emitApprovalReview(sessionId, 'unapproved', photoId);
  }

  return result.rows[0];
}

// ─── 3. Reject photo ───────────────────────────────────────────────────────

export interface RejectPhotoParams {
  photoId: string;
  userId: string;
  userRole: string;
  reason?: string;
}

export async function rejectPhoto(params: RejectPhotoParams): Promise<PhotoApprovalRow> {
  const { photoId, userId, userRole, reason } = params;
  const approval = await checkApprovalAccess(photoId, userId, userRole);

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET status = 'rejected', comment = $1, rejected_at = NOW(), updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [reason || null, photoId],
  );

  if (approval.approvalSessionId) {
    await updateSessionCounters(approval.approvalSessionId);
  }

  NotificationService.create({
    userId: approval.photographerId!,
    title: 'Фото отклонено',
    body: reason ? `Причина: ${reason}` : 'Клиент отклонил результат ретуши',
    type: 'retouch_approval',
    data: { approval_id: photoId, reason },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  if (approval.approvalSessionId) {
    await emitApprovalReview(approval.approvalSessionId, 'rejected', photoId);
  }

  return result.rows[0];
}

// ─── 4. Request changes ────────────────────────────────────────────────────

export interface RequestChangesParams {
  photoId: string;
  userId: string;
  userRole: string;
  changes: string;
}

export async function requestPhotoChanges(params: RequestChangesParams): Promise<PhotoApprovalRow> {
  const { photoId, userId, userRole, changes } = params;
  const approval = await checkApprovalAccess(photoId, userId, userRole);

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET status = 'changes_requested', comment = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [changes, photoId],
  );

  if (approval.approvalSessionId) {
    await updateSessionCounters(approval.approvalSessionId);
  }

  NotificationService.create({
    userId: approval.photographerId!,
    title: 'Нужна доработка',
    body: changes,
    type: 'retouch_approval',
    data: { approval_id: photoId },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  if (approval.approvalSessionId) {
    await emitApprovalReview(approval.approvalSessionId, 'changes_requested', photoId);
  }

  return result.rows[0];
}

// ─── 5. Bulk approve ───────────────────────────────────────────────────────

export interface BulkApproveParams {
  photoIds: string[];
  userId: string;
  userRole: string;
}

export async function bulkApprovePhotos(params: BulkApproveParams): Promise<{ approved: number; results: PhotoApprovalRow[] }> {
  const { photoIds, userId, userRole } = params;

  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new AppError(400, 'ids array is required');
  }

  const isStaff = ['admin', 'employee', 'photographer'].includes(userRole);
  const approvedByRole = isStaff ? 'employee' : 'client';

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET status = 'approved', approved_at = NOW(), updated_at = NOW(),
         approved_by = $2, approved_by_role = $3
     WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'changes_requested')
     RETURNING *`,
    [photoIds, userId, approvedByRole],
  );

  // Collect unique session IDs and sync counters
  const sessionIds = new Set<string>();
  for (const row of result.rows) {
    if (row.approval_session_id) sessionIds.add(row.approval_session_id);
  }
  for (const sid of sessionIds) {
    await updateSessionCounters(sid);
    await emitApprovalReview(sid, 'bulk_approved', photoIds[0]);
  }

  return { approved: result.rows.length, results: result.rows };
}

// ─── 6. Complete session ───────────────────────────────────────────────────

export interface CompleteSessionParams {
  sessionId: string;
  userId: string;
  userRole: string;
}

export async function completeApprovalSession(params: CompleteSessionParams): Promise<{ status: string; approvedCount: number }> {
  const { sessionId, userId, userRole } = params;

  const session = await pool.query<Pick<PhotoApprovalSessionRow, 'id' | 'client_id' | 'status'>>(
    'SELECT id, client_id, status FROM photo_approval_sessions WHERE id = $1',
    [sessionId],
  );
  if (session.rows.length === 0) throw new AppError(404, 'Session not found');

  const s = session.rows[0];
  const isStaff = ['admin', 'employee', 'photographer'].includes(userRole);
  if (!isStaff && s.client_id !== userId) throw new AppError(403, 'Forbidden');

  // Calculate final status from photo statuses
  const stats = await pool.query<ApprovalStats>(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'approved') as approved,
            COUNT(*) FILTER (WHERE status = 'rejected') as rejected
     FROM photo_approvals
     WHERE approval_session_id = $1
       AND revision_round = (SELECT current_revision_round FROM photo_approval_sessions WHERE id = $1)`,
    [sessionId],
  );

  const total = parseInt(stats.rows[0]?.total || '0');
  const approved = parseInt(stats.rows[0]?.approved || '0');
  const rejected = parseInt(stats.rows[0]?.rejected || '0');
  let finalStatus = 'completed';
  if (approved === total && total > 0) finalStatus = 'approved';
  else if (approved > 0) finalStatus = 'completed';

  await pool.query(
    `UPDATE photo_approval_sessions SET status = $2, completed_at = NOW(), updated_at = NOW(),
       approved_count = $3, rejected_count = $4 WHERE id = $1`,
    [sessionId, finalStatus, approved, rejected],
  );

  try {
    broadcastToRoom('approval:session-completed', 'admin:visitor-chats', {
      sessionId, status: finalStatus,
    });
  } catch { /* pub/sub not available */ }

  return { status: finalStatus, approvedCount: approved };
}

// ─── 7. Deliver final photo (quick delivery from CRM) ──────────────────────

export interface DeliverFinalPhotoParams {
  chatSessionId: string;
  title: string;
  photographerId: string;
  /** Legacy: multer buffer upload */
  fileBuffer?: Buffer;
  originalFilename?: string;
  mimetype?: string;
  /** Presigned: file already in S3 */
  s3Key?: string;
  s3Url?: string;
}

export async function deliverFinalPhoto(params: DeliverFinalPhotoParams): Promise<{
  sessionId: string;
  publicToken: string;
  downloadLink: string;
  hasUserAccount: boolean;
}> {
  const { chatSessionId, title, photographerId } = params;

  // 1. Look up chat session
  const sessionRes = await pool.query<Pick<Conversations, 'user_id' | 'contact_id' | 'visitor_name' | 'visitor_phone'>>(
    'SELECT user_id, contact_id, visitor_name, visitor_phone FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
    [chatSessionId],
  );
  if (!sessionRes.rows[0]) throw new AppError(404, 'Chat session not found');

  const chatSession = sessionRes.rows[0];

  // Contact resolution
  let contactId: string | null = chatSession.contact_id;
  if (!contactId && chatSession.user_id) {
    const { findOrCreateContact: foc } = await import('./contact.service.js');
    const userRow = await pool.query<Pick<Users, 'phone' | 'email' | 'display_name'>>(
      'SELECT phone, email, display_name FROM users WHERE id = $1', [chatSession.user_id],
    );
    const u = userRow.rows[0];
    if (u) {
      const contact = await foc({
        phone: u.phone, email: u.email, displayName: u.display_name, source: 'manual',
      });
      await pool.query('UPDATE contacts SET user_id = $1 WHERE id = $2 AND user_id IS NULL', [chatSession.user_id, contact.id]);
      contactId = contact.id;
    }
  }

  // 2. Upload photo to S3 (or reuse presigned key)
  let photoUrl: string;
  let buffer: Buffer | null = null;
  if (params.s3Key && params.s3Url) {
    photoUrl = params.s3Url;
    try {
      const dl = await storageService.downloadToBuffer(params.s3Key);
      buffer = dl.buffer;
    } catch (err) {
      log.warn('[deliver-final] failed to download presigned file for thumbnail', { error: String(err) });
    }
  } else if (params.fileBuffer) {
    const ext = path.extname(params.originalFilename || '.jpg') || '.jpg';
    const key = `approvals/${uuidv4()}${ext}`;
    const result = await storageService.upload(params.fileBuffer, key, params.mimetype || 'image/jpeg');
    photoUrl = result.url;
    buffer = params.fileBuffer;
  } else {
    throw new AppError(400, 'Either fileBuffer or s3Key+s3Url must be provided');
  }

  // 3. Generate thumbnail (non-fatal)
  let thumbnailUrl: string | null = null;
  if (buffer) {
    try {
      const result = await generateThumbnail(buffer);
      thumbnailUrl = result.thumbnailUrl;
    } catch (err) {
      log.warn('[deliver-final] thumbnail generation failed, continuing without', { error: String(err) });
    }
  }

  // 4. Create approval session + photo in transaction
  const client = await pool.connect();
  let approvalSessionId: string;
  let publicToken: string;
  try {
    await client.query('BEGIN');

    publicToken = crypto.randomBytes(24).toString('hex');

    const sessionInsert = await client.query<{ id: string }>(
      `INSERT INTO photo_approval_sessions
        (public_token, client_name, client_phone, client_id, contact_id, photographer_id,
         title, status, total_photos, approved_count, chat_session_id, first_viewed_at, completed_at, download_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 1, 1, $8, NOW(), NOW(), NOW() + INTERVAL '30 days')
       RETURNING id`,
      [
        publicToken,
        chatSession.visitor_name || '',
        chatSession.visitor_phone || null,
        chatSession.user_id,
        contactId,
        photographerId,
        title.trim(),
        chatSessionId,
      ],
    );
    approvalSessionId = sessionInsert.rows[0].id;

    await client.query(
      `INSERT INTO photo_approvals
        (client_id, photographer_id, approval_session_id,
         retouched_photo_url, thumbnail_url, status,
         approved_at, approved_by, approved_by_role, revision_round)
       VALUES ($1, $2, $3, $4, $5, 'approved', NOW(), $6, 'employee', 1)`,
      [chatSession.user_id, photographerId, approvalSessionId, photoUrl, thumbnailUrl, photographerId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 5. Interactive message in chat
  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const publicReviewUrl = `${baseUrl}/photo-review/${publicToken}`;
  const myPhotosUrl = `${baseUrl}/user-profile/my-photos`;
  const sysContent = `📸 Фото «${title.trim()}» готово.\n\nСкачать фотографию можно сразу по кнопке ниже. Она также доступна в разделе «Мои фотографии».`;
  const sysMetadata = JSON.stringify({
    interactive: {
      type: 'buttons',
      sessionId: approvalSessionId,
      approvalAction: 'final_delivery',
      buttons: [
        { id: 'download_photo', label: '📥 Скачать фотографию', url: publicReviewUrl, color: '#f59e0b' },
        { id: 'view_my_photos', label: '📷 Мои фотографии', url: myPhotosUrl, color: '#6b7280' },
      ],
    },
  });
  const msgResult = await pool.query<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata, attachment_url)
     VALUES ((SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1), 'bot', 'Своё Фото', 'interactive', $2, $3, $4)
     RETURNING *`,
    [chatSessionId, sysContent, sysMetadata, photoUrl],
  );

  // 6. WebSocket broadcast
  if (msgResult.rows.length > 0) {
    broadcastChatMessage({
      sessionId: chatSessionId,
      message: msgResult.rows[0],
    }).catch(err => log.error('[PhotoApprovals] broadcast error', { error: String(err) }));

    deliverToExternalChannel({
      chatSessionId,
      text: `📸 Фото «${title.trim()}» готово.\n\nСкачать фотографию можно сразу по кнопке ниже.`,
      buttonLabel: '📥 Скачать фотографию',
      url: publicReviewUrl,
      sourceMessageId: msgResult.rows[0].id,
    }).catch(err => log.error('[PhotoApprovals] final photo omnichannel error', { error: String(err) }));
  }

  // 7. Push notification (fire-and-forget)
  if (chatSession.user_id) {
    import('./web-push-notify.service.js').then(({ sendPush }) =>
      sendPush(chatSession.user_id!, {
        title: 'Ваше фото готово!',
        body: `Фото «${title.trim()}» можно скачать сразу`,
        tag: `photo-delivery-${approvalSessionId}`,
        url: `/photo-review/${publicToken}`,
        icon: '/web-app-manifest-192x192.png',
      }),
    ).catch(err => log.error('[PhotoApprovals] push error', { error: String(err) }));
  }

  return { sessionId: approvalSessionId, publicToken, downloadLink: publicReviewUrl, hasUserAccount: !!chatSession.user_id };
}

// ─── 7b. Deliver final photos — batch (from CRM presigned upload) ──────────

function pluralPhotos(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'фотография';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'фотографии';
  return 'фотографий';
}

export interface DeliverFinalPhotosParams {
  chatSessionId: string;
  title: string;
  photographerId: string;
  photos: Array<{ s3Key: string; originalFilename?: string }>;
}

export async function deliverFinalPhotos(params: DeliverFinalPhotosParams): Promise<{
  sessionId: string;
  publicToken: string;
  photoCount: number;
  downloadLink: string;
  hasUserAccount: boolean;
}> {
  const { chatSessionId, title, photographerId, photos } = params;

  // 1. Look up chat session (same as deliverFinalPhoto)
  const sessionRes = await pool.query<Pick<Conversations, 'user_id' | 'contact_id' | 'visitor_name' | 'visitor_phone'>>(
    'SELECT user_id, contact_id, visitor_name, visitor_phone FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
    [chatSessionId],
  );
  if (!sessionRes.rows[0]) throw new AppError(404, 'Chat session not found');

  const chatSession = sessionRes.rows[0];

  // Contact resolution
  let contactId: string | null = chatSession.contact_id;
  if (!contactId && chatSession.user_id) {
    const { findOrCreateContact: foc } = await import('./contact.service.js');
    const userRow = await pool.query<Pick<Users, 'phone' | 'email' | 'display_name'>>(
      'SELECT phone, email, display_name FROM users WHERE id = $1', [chatSession.user_id],
    );
    const u = userRow.rows[0];
    if (u) {
      const contact = await foc({
        phone: u.phone, email: u.email, displayName: u.display_name, source: 'manual',
      });
      await pool.query('UPDATE contacts SET user_id = $1 WHERE id = $2 AND user_id IS NULL', [chatSession.user_id, contact.id]);
      contactId = contact.id;
    }
  }

  // 2. Process each photo: get S3 URL + generate thumbnail
  const photoResults: Array<{ photoUrl: string; thumbnailUrl: string | null }> = [];
  for (const photo of photos) {
    const photoUrl = storageService.getPublicUrl(photo.s3Key);
    let thumbnailUrl: string | null = null;
    try {
      const dl = await storageService.downloadToBuffer(photo.s3Key);
      const result = await generateThumbnail(dl.buffer);
      thumbnailUrl = result.thumbnailUrl;
    } catch (err) {
      log.warn('[deliver-finals] thumbnail generation failed, continuing without', { s3Key: photo.s3Key, error: String(err) });
    }
    photoResults.push({ photoUrl, thumbnailUrl });
  }

  // 3. Create approval session + N photos in transaction
  const client = await pool.connect();
  let approvalSessionId: string;
  let publicToken: string;
  try {
    await client.query('BEGIN');

    publicToken = crypto.randomBytes(24).toString('hex');

    const sessionInsert = await client.query<{ id: string }>(
      `INSERT INTO photo_approval_sessions
        (public_token, client_name, client_phone, client_id, contact_id, photographer_id,
         title, status, total_photos, approved_count, chat_session_id,
         first_viewed_at, completed_at, download_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $8, $9, NOW(), NOW(), NOW() + INTERVAL '30 days')
       RETURNING id`,
      [
        publicToken,
        chatSession.visitor_name || '',
        chatSession.visitor_phone || null,
        chatSession.user_id,
        contactId,
        photographerId,
        title.trim(),
        photoResults.length,
        chatSessionId,
      ],
    );
    approvalSessionId = sessionInsert.rows[0].id;

    for (const pr of photoResults) {
      await client.query(
        `INSERT INTO photo_approvals
          (client_id, photographer_id, approval_session_id,
           retouched_photo_url, thumbnail_url, status,
           approved_at, approved_by, approved_by_role, revision_round)
         VALUES ($1, $2, $3, $4, $5, 'approved', NOW(), $6, 'employee', 1)`,
        [chatSession.user_id, photographerId, approvalSessionId, pr.photoUrl, pr.thumbnailUrl, photographerId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 4. Interactive message in chat
  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const publicReviewUrl = `${baseUrl}/photo-review/${publicToken}`;
  const myPhotosUrl = `${baseUrl}/user-profile/my-photos`;
  const N = photoResults.length;
  const msgText = N === 1
    ? `📸 Фото «${title.trim()}» готово.\n\nСкачать фотографию можно сразу по кнопке ниже. Она также доступна в разделе «Мои фотографии».`
    : `📸 Вам выданы ${N} ${pluralPhotos(N)}.\n\n«${title.trim()}»\n\nСкачать фотографии можно сразу по кнопке ниже. Они также доступны в разделе «Мои фотографии».`;
  const downloadButtonLabel = N === 1 ? '📥 Скачать фотографию' : '📥 Скачать фотографии';
  const msgMetadata = JSON.stringify({
    interactive: {
      type: 'buttons',
      sessionId: approvalSessionId,
      approvalAction: 'final_delivery',
      buttons: [
        { id: 'download_photos', label: downloadButtonLabel, url: publicReviewUrl, color: '#f59e0b' },
        { id: 'view_my_photos', label: '📷 Мои фотографии', url: myPhotosUrl, color: '#6b7280' },
      ],
    },
  });
  const previewAttachmentUrl = N === 1 ? photoResults[0]?.photoUrl ?? null : null;
  const msgResult = await pool.query<BroadcastableMessage>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata, attachment_url)
     VALUES ((SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1), 'bot', 'Своё Фото', 'interactive', $2, $3, $4)
     RETURNING *`,
    [chatSessionId, msgText, msgMetadata, previewAttachmentUrl],
  );

  // 5. WebSocket broadcast
  if (msgResult.rows.length > 0) {
    broadcastChatMessage({
      sessionId: chatSessionId,
      message: msgResult.rows[0],
    }).catch(err => log.error('[PhotoApprovals] batch broadcast error', { error: String(err) }));

    deliverToExternalChannel({
      chatSessionId,
      text: N === 1
        ? `📸 Фото «${title.trim()}» готово.\n\nСкачать фотографию можно сразу по кнопке ниже.`
        : `📸 Вам выданы ${N} ${pluralPhotos(N)}.\n\nСкачать фотографии можно сразу по кнопке ниже.`,
      buttonLabel: downloadButtonLabel,
      url: publicReviewUrl,
      sourceMessageId: msgResult.rows[0].id,
    }).catch(err => log.error('[PhotoApprovals] final photos omnichannel error', { error: String(err) }));
  }

  // 6. Push notification (fire-and-forget)
  if (chatSession.user_id) {
    import('./web-push-notify.service.js').then(({ sendPush }) =>
      sendPush(chatSession.user_id!, {
        title: 'Ваши фото готовы!',
        body: N === 1
          ? `Фото «${title.trim()}» можно скачать сразу`
          : `${N} ${pluralPhotos(N)} можно скачать сразу`,
        tag: `photo-delivery-batch-${approvalSessionId}`,
        url: `/photo-review/${publicToken}`,
        icon: '/web-app-manifest-192x192.png',
      }),
    ).catch(err => log.error('[PhotoApprovals] batch push error', { error: String(err) }));
  }

  return { sessionId: approvalSessionId, publicToken, photoCount: N, downloadLink: publicReviewUrl, hasUserAccount: !!chatSession.user_id };
}

// ─── 8. Omnichannel delivery (shared between autosend + send-to-chat) ──────

export interface OmnichannelDeliveryParams {
  chatSessionId: string;
  text: string;
  buttonLabel: string;
  url: string;
  sourceMessageId: string;
}

export async function deliverToExternalChannel(params: OmnichannelDeliveryParams): Promise<void> {
  const { chatSessionId, text, buttonLabel, url, sourceMessageId } = params;

  // Lookup conversation (supports legacy_session_id for backward compat)
  const chatSession = await pool.query<ConversationChannelInfo>(
    'SELECT id, channel, external_chat_id, metadata FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
    [chatSessionId],
  );
  if (chatSession.rows.length === 0) return;

  const { channel: rawChannel, external_chat_id, metadata } = chatSession.rows[0];
  const meta = isConversationExternalMetadata(metadata) ? metadata : null;
  const externalChatId = external_chat_id || (typeof meta?.externalChatId === 'string' ? meta.externalChatId : null);
  if (!rawChannel || ['web', 'online', 'studio'].includes(rawChannel) || !externalChatId) return;

  const { getAdapterOrThrow } = await import('./connectors/core/adapter-registry.js');
  const { getAccountByChannel } = await import('./connectors/core/account-store.js');
  const channel = rawChannel as import('./connectors/core/types.js').ChannelType;
  const adapter = getAdapterOrThrow(channel);
  const account = await getAccountByChannel(channel);
  if (!account) return;

  if (adapter.sendWithInlineButton && (channel === 'telegram' || channel === 'vk' || channel === 'max')) {
    const result = await adapter.sendWithInlineButton(account, externalChatId, text, buttonLabel, url);
    if (!result.success) log.error('inline button send failed', { channel, error: result.errorMessage });
  } else {
    const { enqueueOutbound } = await import('./connectors/pipeline/outbound-worker.js');
    await enqueueOutbound({
      channel,
      externalChatId,
      content: `${text}\n${url}`,
      messageType: 'text',
      sourceMessageId,
      conversationId: chatSessionId,
    });
  }
}

// ─── 9. Send approval link to chat (autosend on session create) ─────────────

export interface SendApprovalLinkParams {
  orderId: string;
  clientName: string;
  shareUrl: string;
}

export async function sendApprovalLinkToChat(params: SendApprovalLinkParams): Promise<void> {
  const { orderId, clientName, shareUrl } = params;

  const orderRow = await pool.query<ChatSessionId>(
    `SELECT chat_session_id FROM photo_print_orders
     WHERE (CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN id = $1::uuid ELSE false END)
        OR order_id = $1
     LIMIT 1`,
    [orderId],
  );
  if (!orderRow.rows.length) return;

  const chatSessionId = orderRow.rows[0].chat_session_id;
  if (!chatSessionId) return;

  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const fullLink = `${baseUrl}${shareUrl}`;
  const textWithLink = `Здравствуйте, ${clientName}! 📸\nВаши фотографии обработаны и готовы для просмотра.\nПерейдите по ссылке для согласования результата:\n${fullLink}`;
  const textNoLink = `Здравствуйте, ${clientName}! 📸\nВаши фотографии обработаны и готовы для просмотра.\nНажмите кнопку ниже для согласования результата:`;

  const interactivePayload = {
    interactive: {
      type: 'buttons',
      buttons: [
        { id: 'view_photos', label: '📷 Посмотреть фото', icon: 'photo_library', value: 'view_photos', url: fullLink, color: '#667eea' },
      ],
    },
  };
  const metadataJson = JSON.stringify(interactivePayload);

  const msgResult = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ((SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1), 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [chatSessionId, textWithLink, metadataJson],
  );

  // Mark link as sent
  await pool.query(
    `UPDATE photo_approval_sessions SET link_sent_via = 'chat', link_sent_at = NOW() WHERE public_token = $1`,
    [shareUrl.replace('/photo-review/', '')],
  );

  // Socket.IO
  if (msgResult.rows.length > 0) {
    const msg = msgResult.rows[0];

    broadcastToRoom('operator:message', `visitor:${chatSessionId}`, {
      sessionId: chatSessionId,
      content: textWithLink,
      senderName: 'Своё Фото',
      senderType: 'bot',
      timestamp: msg.created_at,
      id: msg.id,
      messageType: 'interactive',
      interactive: interactivePayload.interactive,
      metadata: interactivePayload,
    });

    await broadcastChatMessage({ sessionId: chatSessionId, message: msg });
  }

  // Web Push (fire-and-forget)
  import('./visitor-push.service.js').then(({ sendVisitorChatPush }) =>
    sendVisitorChatPush(chatSessionId, {
      title: 'Ваши фото готовы',
      body: 'Нажмите, чтобы посмотреть и согласовать фотографии',
      tag: `approval-${chatSessionId}`,
      url: shareUrl,
    }),
  ).catch(err => log.error('[PhotoApprovals] push approval link error', { error: String(err) }));

  // External channel delivery
  if (msgResult.rows.length > 0) {
    await deliverToExternalChannel({
      chatSessionId,
      text: textNoLink,
      buttonLabel: '📸 Посмотреть фото',
      url: fullLink,
      sourceMessageId: msgResult.rows[0].id,
    }).catch(e => log.error('[PhotoApprovals] autosend omnichannel error:', e instanceof Error ? e.message : e));
  }
}

// ─── 10. Send gallery to chat ──────────────────────────────────────────────

export interface SendGalleryToChatParams {
  sessionId: string;
  overrideText?: string;
}

export async function sendGalleryToChat(params: SendGalleryToChatParams): Promise<{
  messageId: string;
  reviewUrl: string;
}> {
  const { sessionId } = params;

  const session = await pool.query<PhotoApprovalSessionRow>(
    'SELECT *, public_token FROM photo_approval_sessions WHERE id = $1',
    [sessionId],
  );
  if (session.rows.length === 0) throw new AppError(404, 'Session not found');
  const sess = session.rows[0];

  const chatSessionId = sess.chat_session_id;
  if (!chatSessionId) {
    throw new AppError(400, 'No chat session linked. Set chat_session_id on session first.');
  }

  // Photos + variants
  const photos = await pool.query<Pick<PhotoApprovalRow, 'id' | 'retouched_photo_url' | 'thumbnail_url' | 'original_photo_url' | 'original_thumbnail_url' | 'status'>>(
    `SELECT pa.id, pa.retouched_photo_url, pa.thumbnail_url, pa.original_photo_url, pa.original_thumbnail_url, pa.status
     FROM photo_approvals pa WHERE pa.approval_session_id = $1 ORDER BY pa.created_at ASC`,
    [sessionId],
  );

  const photosWithVariants = [];
  for (const photo of photos.rows) {
    const variants = await pool.query<PhotoApprovalVariantRow>(
      'SELECT id, variant_url, thumbnail_url, label, sort_order FROM photo_approval_variants WHERE approval_id = $1 ORDER BY sort_order ASC',
      [photo.id],
    );
    photosWithVariants.push({
      id: photo.id,
      retouchedUrl: photo.retouched_photo_url,
      thumbnailUrl: photo.thumbnail_url,
      originalUrl: photo.original_photo_url,
      status: photo.status,
      variants: variants.rows.map((v) => ({
        id: v.id, url: v.variant_url, thumbnailUrl: v.thumbnail_url, label: v.label,
      })),
    });
  }

  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const reviewUrl = `${baseUrl}/photo-review/${sess.public_token}`;
  const crmUrl = '/employee/approvals';

  const interactivePayload = {
    interactive: {
      type: 'approval_gallery',
      sessionId: sess.id,
      photos: photosWithVariants,
      reviewUrl,
      crmUrl,
    },
  };

  const totalVariants = photosWithVariants.reduce((sum, p) => sum + p.variants.length, 0);
  const text = params.overrideText
    ?? `📸 Согласование фото\n${photosWithVariants.length} фото${totalVariants > 0 ? `, ${totalVariants} вариантов` : ''}\n\nНажмите для просмотра и выбора варианта:`;

  // Resolve conversation_id (may be passed as legacy_session_id)
  const convRow = await db.queryOne<ConversationChannelInfo>(
    'SELECT id, channel, external_chat_id, metadata FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
    [chatSessionId],
  );

  const metadataJson = JSON.stringify(interactivePayload);
  const resolvedConvId = convRow?.id || chatSessionId;
  const msgResult = await pool.query(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [resolvedConvId, text, metadataJson],
  );

  await pool.query(
    'UPDATE photo_approval_sessions SET link_sent_via = \'chat\', link_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
    [sessionId],
  );

  // Socket.IO
  if (msgResult.rows.length > 0) {
    const msg = msgResult.rows[0];

    broadcastToRoom('operator:message', `visitor:${chatSessionId}`, {
      sessionId: chatSessionId,
      content: text,
      senderName: 'Своё Фото',
      senderType: 'bot',
      timestamp: msg.created_at,
      id: msg.id,
      messageType: 'interactive',
      interactive: interactivePayload.interactive,
      metadata: interactivePayload,
    });

    await broadcastChatMessage({ sessionId: chatSessionId, message: msg });
  }

  // Push notification (fire-and-forget)
  import('./visitor-push.service.js').then(({ sendVisitorChatPush }) =>
    sendVisitorChatPush(chatSessionId, {
      title: '📸 Ваши фото готовы',
      body: 'Нажмите для просмотра и согласования фотографий',
      tag: `approval-gallery-${sessionId}`,
      url: `/photo-review/${sess.public_token}`,
    }),
  ).catch(err => log.error('[PhotoApprovals] push gallery error', { error: String(err) }));

  // External channel delivery (fire-and-forget)
  deliverToExternalChannel({
    chatSessionId,
    text: 'Ваши фото готовы для согласования!\nНажмите кнопку ниже, чтобы выбрать лучший вариант:',
    buttonLabel: '📸 Посмотреть фото',
    url: reviewUrl,
    sourceMessageId: msgResult.rows[0].id,
  }).catch(e => log.error('[PhotoApprovals] omnichannel delivery error', { error: String(e) }));

  return { messageId: msgResult.rows[0].id, reviewUrl };
}

// ─── 11. Upload photo to session ───────────────────────────────────────────

export interface UploadPhotoToSessionParams {
  sessionId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  mimetype: string;
  photographerId: string;
  role?: 'original' | 'retouched';
}

export async function uploadPhotoToSession(params: UploadPhotoToSessionParams): Promise<{
  photo?: PhotoApprovalRow;
  original?: { url: string; thumbnailUrl: string | null };
}> {
  const { sessionId, fileBuffer, originalFilename, mimetype, photographerId, role = 'retouched' } = params;

  const sessionCheck = await pool.query<Pick<PhotoApprovalSessionRow, 'id' | 'client_id'> & { original_photo_url: string | null; original_thumbnail_url: string | null }>(
    'SELECT id, client_id, original_photo_url, original_thumbnail_url FROM photo_approval_sessions WHERE id = $1',
    [sessionId],
  );
  if (sessionCheck.rows.length === 0) throw new AppError(404, 'Session not found');

  const ext = path.extname(originalFilename) || '.jpg';
  const { url: photoUrl } = await storageService.upload(fileBuffer, `approvals/${uuidv4()}${ext}`, mimetype);

  let thumbUrl: string | null = null;
  try {
    const { thumbnailUrl } = await generateThumbnail(fileBuffer);
    thumbUrl = thumbnailUrl;
  } catch (e) {
    log.error('[PhotoApprovals] thumbnail generation failed:', { error: String(e) });
  }

  if (role === 'original') {
    await pool.query(
      'UPDATE photo_approval_sessions SET original_photo_url = $1, original_thumbnail_url = $2, updated_at = NOW() WHERE id = $3',
      [photoUrl, thumbUrl, sessionId],
    );
    await pool.query(
      'UPDATE photo_approvals SET original_photo_url = $1, original_thumbnail_url = $2 WHERE approval_session_id = $3 AND original_photo_url IS NULL',
      [photoUrl, thumbUrl, sessionId],
    );
    return { original: { url: photoUrl, thumbnailUrl: thumbUrl } };
  }

  const sess = sessionCheck.rows[0];

  // Bump revision round if session is in changes_requested
  const sessionState = await pool.query<Pick<PhotoApprovalSessionRow, 'status' | 'current_revision_round'>>(
    'SELECT status, current_revision_round FROM photo_approval_sessions WHERE id = $1',
    [sessionId],
  );
  let revisionRound = sessionState.rows[0]?.current_revision_round || 1;
  if (sessionState.rows[0]?.status === 'changes_requested') {
    revisionRound += 1;
    await pool.query(
      'UPDATE photo_approval_sessions SET current_revision_round = $2, status = \'in_review\', updated_at = NOW() WHERE id = $1',
      [sessionId, revisionRound],
    );
  }

  const result = await pool.query<PhotoApprovalRow>(
    `INSERT INTO photo_approvals
      (client_id, photographer_id, approval_session_id, retouched_photo_url, thumbnail_url, original_photo_url, original_thumbnail_url, status, revision_round)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     RETURNING *`,
    [sess.client_id, photographerId, sessionId, photoUrl, thumbUrl, sess.original_photo_url, sess.original_thumbnail_url, revisionRound],
  );

  await updateSessionCounters(sessionId);

  // WS event
  try {
    const eventData = { sessionId, photoId: result.rows[0].id, revisionRound };
    broadcastToRoom('approval:photo-uploaded', 'admin:visitor-chats', eventData);
    if (sess.client_id) {
      broadcastToRoom('approval:photo-uploaded', `user:${sess.client_id}`, eventData);
    }
  } catch { /* pub/sub not available */ }

  return { photo: result.rows[0] };
}

// ─── 12. Reupload photo after changes ──────────────────────────────────────

export interface ReuploadPhotoParams {
  photoId: string;
  retouchedPhotoUrl: string;
  userId: string;
}

export async function reuploadPhoto(params: ReuploadPhotoParams): Promise<PhotoApprovalRow> {
  const { photoId, retouchedPhotoUrl, userId } = params;

  const approvalCheck = await pool.query<Pick<PhotoApprovalRow, 'client_id' | 'status' | 'comment'>>(
    'SELECT client_id, status, comment FROM photo_approvals WHERE id = $1',
    [photoId],
  );
  if (approvalCheck.rows.length === 0) throw new AppError(404, 'Approval not found');

  const approval = approvalCheck.rows[0];
  if (approval.status !== 'changes_requested' && approval.status !== 'rejected') {
    throw new AppError(400, 'Can only re-upload when status is changes_requested or rejected');
  }

  // Snapshot current state as revision
  const currentVariants = await pool.query(
    'SELECT id, variant_url, thumbnail_url, label, sort_order, is_selected FROM photo_approval_variants WHERE approval_id = $1 ORDER BY sort_order',
    [photoId],
  );
  const currentAnnotations = await pool.query(
    'SELECT id, annotation, created_at FROM photo_approval_annotations WHERE approval_id = $1 ORDER BY created_at',
    [photoId],
  );

  await pool.query(
    `INSERT INTO photo_approval_revisions
       (approval_id, revision_number, variants_snapshot, client_comment, annotations_snapshot, status, created_by)
     VALUES ($1,
       (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM photo_approval_revisions WHERE approval_id = $1),
       $2, $3, $4, $5, $6)`,
    [photoId, JSON.stringify(currentVariants.rows), approval.comment || null,
     JSON.stringify(currentAnnotations.rows), approval.status, userId],
  );

  const result = await pool.query<PhotoApprovalRow>(
    `UPDATE photo_approvals
     SET retouched_photo_url = $1,
         status = 'pending',
         comment = NULL,
         approved_at = NULL,
         rejected_at = NULL,
         revision_count = revision_count + 1,
         selected_variant_id = NULL,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [retouchedPhotoUrl, photoId],
  );

  // Notify client (fire-and-forget → BullMQ in Stage 3)
  NotificationService.create({
    userId: approval.client_id!,
    title: 'Ретушь обновлена',
    body: 'Фото после доработки готово для повторной проверки',
    type: 'retouch_approval',
    data: { approval_id: photoId },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  return result.rows[0];
}
