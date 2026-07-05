import { Router } from 'express';
import { authenticateToken, AuthRequest, requireUser, requirePermission } from '../middleware/auth.js';
import { pool } from '../database/db.js';
import db from '../database/db.js';
import { NotificationService } from '../services/notification.service.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import PQueue from 'p-queue';
import { AppError } from '../middleware/errorHandler.js';
import { storageService } from '../services/storage.service.js';
import { generateThumbnail } from '../services/approval-thumbnail.service.js';
import { updateSessionCounters } from '../services/approval-counters.service.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { sendGalleryToChat, deliverFinalPhoto, deliverFinalPhotos } from '../services/photo-approval.service.js';
import { syncOrderStatusForApproval } from '../services/order-status.service.js';
import { markRetouchRevision } from '../services/retouch.service.js';
import { createLogger } from '../utils/logger.js';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { validateFaceAndSave } from '../services/face-validation.service.js';
import { resolveClientId } from '../services/approval-client-resolver.service.js';
import { getIdentityLinkRequestContext, hashPublicToken, logIdentityLinkEvent } from '../services/identity-link-audit.service.js';
import type { Request, Response } from 'express';
import type WorkTasks from '../types/generated/public/WorkTasks.js';
import type Users from '../types/generated/public/Users.js';
import type { IdOnly } from '../types/db-common.types.js';

const log = createLogger('photo-approvals');

const router = Router();

const approvalUploadLimiter = createUploadLimiter('ul-approv-leg:', 100, 15 * 60 * 1000);

// P1 SECURITY FIX: async queue for auto-validation (prevent concurrent spawn)
const photoValidationQueue = new PQueue({ concurrency: 2 });

// ─── Body interfaces for presigned upload endpoints ─────────────────────────

interface SessionPhotoBody {
  s3Key: string;
  role?: string;
}

interface VariantUploadBody {
  s3Key: string;
  label?: string;
}

interface DeliverFinalBody {
  s3Key: string;
  title: string;
  chat_session_id: string;
}

interface DeliverFinalsBody {
  chatSessionId: string;
  title: string;
  photos: Array<{ s3Key: string; originalFilename?: string }>;
}

interface DownloadSessionRow {
  id: string;
  status: string;
  client_id: string | null;
  contact_id: string | null;
  download_expires_at: string | null;
  title: string;
}

interface ApprovedDownloadPhotoRow {
  id: string;
  retouched_photo_url: string;
  thumbnail_url: string;
  status: string;
}

interface ApprovalDeleteSessionRow {
  id: string;
  chat_session_id: string | null;
  public_token: string;
}

interface LinkSessionRow {
  id: string;
  client_id: string | null;
  chat_session_id: string | null;
}

interface AutoLinkedApprovalSessionRow extends IdOnly {
  chat_session_id: string | null;
}

interface ConversationIdentityRow {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  visitor_id: string | null;
}

type PipelineServiceFilter = 'photo-docs';

const UUID_SQL_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

function getOptionalStringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !Object.hasOwn(body, key)) {
    return undefined;
  }
  const value = Reflect.get(body, key);
  return typeof value === 'string' ? value : undefined;
}

function getQueryString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getPipelineServiceFilter(value: unknown): PipelineServiceFilter | null {
  return value === 'photo-docs' ? value : null;
}

function isTruthyQuery(value: unknown): boolean {
  return value === 'true' || value === '1';
}

function isAuthenticatedUser(value: unknown): value is NonNullable<AuthRequest['user']> {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'id') === 'string'
    && typeof Reflect.get(value, 'role') === 'string';
}

function requireRequestUser(req: Request): asserts req is Request & { user: NonNullable<AuthRequest['user']> } {
  if (!isAuthenticatedUser(Reflect.get(req, 'user'))) {
    throw new AppError(401, 'Unauthorized');
  }
}

async function autoLinkHandler(req: AuthRequest, res: Response): Promise<void> {
  requireUser(req, res);
  const userId = req.user.id;
  const auditRequest = getIdentityLinkRequestContext(req);
  const actorUserName = req.user.display_name ?? req.user.email ?? null;

  const userRow = await db.queryOne<Pick<Users, 'phone' | 'telegram_id'>>(
    'SELECT phone, telegram_id FROM users WHERE id = $1', [userId],
  );
  const phone = userRow?.phone || null;
  const telegramId = userRow?.telegram_id || null;

  const contactRows = await db.query<IdOnly>(
    'SELECT id FROM contacts WHERE user_id = $1', [userId],
  );
  const contactIds = contactRows.map(r => r.id);

  const convRows = await db.query<IdOnly>(
    `SELECT c.id FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE COALESCE(ct.user_id, c.user_id) = $1
     UNION
     SELECT id FROM conversations WHERE contact_id = ANY($2)
     UNION
     SELECT id FROM conversations WHERE channel = 'telegram' AND external_chat_id = $3 AND $3 IS NOT NULL`,
    [userId, contactIds.length > 0 ? contactIds : [], telegramId],
  );
  const convIds = convRows.map(r => r.id);

  const updated = await db.query<AutoLinkedApprovalSessionRow>(
    `UPDATE photo_approval_sessions
     SET client_id = $1, updated_at = NOW()
     WHERE client_id IS NULL AND deleted_at IS NULL
       AND (($2::text IS NOT NULL AND client_phone = $2)
            OR (chat_session_id = ANY($3)))
     RETURNING id, chat_session_id`,
    [userId, phone, convIds.length > 0 ? convIds : []],
  );
  const updatedIds = updated.map(r => r.id);

  if (updatedIds.length > 0) {
    await db.query(
      `UPDATE photo_approvals SET client_id = $1
       WHERE approval_session_id = ANY($2) AND client_id IS NULL`,
      [userId, updatedIds],
    );

    // Propagate user_id to conversations for linked sessions
    const updatedChatIds = updated
      .map(session => session.chat_session_id)
      .filter((id): id is string => Boolean(id));
    const conversationBeforeRows = updatedChatIds.length > 0
      ? await db.query<ConversationIdentityRow>(
          `SELECT id, user_id, contact_id, channel, external_chat_id, visitor_id
           FROM conversations WHERE id = ANY($1)`,
          [updatedChatIds],
        )
      : [];
    const conversationBeforeById = new Map(conversationBeforeRows.map(row => [row.id, row]));
    const updatedConversations = updatedChatIds.length > 0
      ? await db.query<ConversationIdentityRow>(
          `UPDATE conversations SET user_id = $1, updated_at = NOW()
           WHERE user_id IS NULL AND id = ANY($2)
           RETURNING id, user_id, contact_id, channel, external_chat_id, visitor_id`,
          [userId, updatedChatIds],
        )
      : [];

    for (const linkedSession of updated) {
      await logIdentityLinkEvent({
        action: 'identity_link_session',
        source: 'photo_approvals_auto_link',
        entityType: 'photo_approval_session',
        entityId: linkedSession.id,
        actorUserId: userId,
        actorUserName,
        actorRole: req.user.role,
        ip: auditRequest.ip,
        userAgent: auditRequest.userAgent,
        approvalSessionId: linkedSession.id,
        conversationId: linkedSession.chat_session_id,
        previousClientId: null,
        newClientId: userId,
        reason: 'authenticated_user_phone_or_related_conversation_match',
        result: 'linked',
        metadata: { phoneAvailable: Boolean(phone) },
      });
    }

    for (const conversation of updatedConversations) {
      const before = conversationBeforeById.get(conversation.id);
      await logIdentityLinkEvent({
        action: 'identity_link_chat',
        source: 'photo_approvals_auto_link',
        entityType: 'conversation',
        entityId: conversation.id,
        actorUserId: userId,
        actorUserName,
        actorRole: req.user.role,
        ip: auditRequest.ip,
        userAgent: auditRequest.userAgent,
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        channel: conversation.channel,
        externalChatId: conversation.external_chat_id,
        visitorId: conversation.visitor_id,
        previousUserId: before?.user_id ?? null,
        newUserId: userId,
        reason: 'photo_approval_session_auto_link',
        result: 'linked',
      });
    }
  }

  log.info('Auto-linked approval sessions', { userId, linked: updatedIds.length });
  res.json({ success: true, linked: updatedIds.length });
}


// Get photos for approval (client view)
router.get('/', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { session_id, status } = req.query;

  let query = `
    SELECT
      pa.id, pa.session_id, pa.photo_id, pa.client_id, pa.photographer_id,
      pa.status, pa.comment, pa.original_photo_url, pa.retouched_photo_url,
      pa.retouch_type, pa.order_id, pa.approved_at, pa.rejected_at,
      pa.created_at, pa.updated_at,
      pa.approval_session_id,
      ps.date as session_date, p.file_url,
      COALESCE(pa.thumbnail_url, p.thumbnail_url) as thumbnail_url,
      pa.original_thumbnail_url, p.metadata,
      pas.title as session_name, pas.public_token
    FROM photo_approvals pa
    LEFT JOIN photo_sessions ps ON pa.session_id = ps.id
    LEFT JOIN photos p ON pa.photo_id = p.id
    LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
    WHERE (pa.client_id = $1 OR pas.client_id = $1
           OR pas.contact_id = (SELECT id FROM contacts WHERE user_id = $1 LIMIT 1))
      AND (pa.approval_session_id IS NULL OR pas.deleted_at IS NULL)
  `;

  const params: unknown[] = [userId];

  if (session_id) {
    query += ` AND pa.session_id = $${params.length + 1}`;
    params.push(session_id);
  }

  if (status) {
    const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      query += ` AND pa.status = $${params.length + 1}`;
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      query += ` AND pa.status = ANY($${params.length + 1}::text[])`;
      params.push(statuses);
    }
  }

  query += ` ORDER BY pa.created_at DESC`;

  const result = await pool.query(query, params);

  res.json({
    approvals: result.rows,
    total: result.rowCount,
  });
});

// Link session to authenticated client (token-based binding)
router.post('/link-session', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { token } = req.body;
  if (!token || typeof token !== 'string') throw new AppError(400, 'token is required');

  const auditRequest = getIdentityLinkRequestContext(req);
  const tokenHash = hashPublicToken(token);
  const actorUserName = req.user.display_name ?? req.user.email ?? null;

  const session = await pool.query<LinkSessionRow>(
    'SELECT id, client_id, chat_session_id FROM photo_approval_sessions WHERE public_token = $1', [token]
  );
  if (session.rows.length === 0) throw new AppError(404, 'Session not found');

  const sess = session.rows[0];
  if (sess.client_id === req.user.id) {
    await logIdentityLinkEvent({
      action: 'identity_link_skipped',
      source: 'photo_approvals_link_session',
      entityType: 'photo_approval_session',
      entityId: sess.id,
      actorUserId: req.user.id,
      actorUserName,
      actorRole: req.user.role,
      ip: auditRequest.ip,
      userAgent: auditRequest.userAgent,
      approvalSessionId: sess.id,
      conversationId: sess.chat_session_id,
      previousClientId: sess.client_id,
      newClientId: req.user.id,
      reason: 'session_already_linked_to_actor',
      result: 'skipped',
      tokenHash,
    });
    res.json({ success: true, sessionId: sess.id });
    return;
  }
  if (sess.client_id && sess.client_id !== req.user.id) {
    await logIdentityLinkEvent({
      action: 'identity_link_skipped',
      source: 'photo_approvals_link_session',
      entityType: 'photo_approval_session',
      entityId: sess.id,
      actorUserId: req.user.id,
      actorUserName,
      actorRole: req.user.role,
      ip: auditRequest.ip,
      userAgent: auditRequest.userAgent,
      approvalSessionId: sess.id,
      conversationId: sess.chat_session_id,
      previousClientId: sess.client_id,
      newClientId: req.user.id,
      reason: 'session_linked_to_another_client',
      result: 'blocked',
      tokenHash,
    });
    throw new AppError(403, 'Session linked to another client');
  }

  const conversationBefore = sess.chat_session_id
    ? await db.queryOne<ConversationIdentityRow>(
        `SELECT id, user_id, contact_id, channel, external_chat_id, visitor_id
         FROM conversations WHERE id = $1`,
        [sess.chat_session_id],
      )
    : null;

  await pool.query('UPDATE photo_approval_sessions SET client_id = $1, updated_at = NOW() WHERE id = $2',
    [req.user.id, sess.id]);
  await pool.query('UPDATE photo_approvals SET client_id = $1 WHERE approval_session_id = $2 AND client_id IS NULL',
    [req.user.id, sess.id]);

  await logIdentityLinkEvent({
    action: 'identity_link_session',
    source: 'photo_approvals_link_session',
    entityType: 'photo_approval_session',
    entityId: sess.id,
    actorUserId: req.user.id,
    actorUserName,
    actorRole: req.user.role,
    ip: auditRequest.ip,
    userAgent: auditRequest.userAgent,
    approvalSessionId: sess.id,
    conversationId: sess.chat_session_id,
    previousClientId: sess.client_id,
    newClientId: req.user.id,
    reason: 'authenticated_public_token_link',
    result: 'linked',
    tokenHash,
  });

  // Propagate user_id to conversation
  if (sess.chat_session_id) {
    const conversationUpdate = await pool.query<ConversationIdentityRow>(
      `UPDATE conversations SET user_id = $1, updated_at = NOW()
       WHERE id = $2 AND user_id IS NULL
       RETURNING id, user_id, contact_id, channel, external_chat_id, visitor_id`,
      [req.user.id, sess.chat_session_id],
    );
    const linkedConversation = conversationUpdate.rows[0];
    if (linkedConversation) {
      await logIdentityLinkEvent({
        action: 'identity_link_chat',
        source: 'photo_approvals_link_session',
        entityType: 'conversation',
        entityId: linkedConversation.id,
        actorUserId: req.user.id,
        actorUserName,
        actorRole: req.user.role,
        ip: auditRequest.ip,
        userAgent: auditRequest.userAgent,
        approvalSessionId: sess.id,
        conversationId: linkedConversation.id,
        contactId: linkedConversation.contact_id,
        channel: linkedConversation.channel,
        externalChatId: linkedConversation.external_chat_id,
        visitorId: linkedConversation.visitor_id,
        previousUserId: conversationBefore?.user_id ?? null,
        newUserId: req.user.id,
        reason: 'photo_approval_link_session_propagation',
        result: 'linked',
        tokenHash,
      });
    } else {
      await logIdentityLinkEvent({
        action: 'identity_link_skipped',
        source: 'photo_approvals_link_session',
        entityType: 'conversation',
        entityId: sess.chat_session_id,
        actorUserId: req.user.id,
        actorUserName,
        actorRole: req.user.role,
        ip: auditRequest.ip,
        userAgent: auditRequest.userAgent,
        approvalSessionId: sess.id,
        conversationId: sess.chat_session_id,
        contactId: conversationBefore?.contact_id ?? null,
        channel: conversationBefore?.channel ?? null,
        externalChatId: conversationBefore?.external_chat_id ?? null,
        visitorId: conversationBefore?.visitor_id ?? null,
        previousUserId: conversationBefore?.user_id ?? null,
        newUserId: req.user.id,
        reason: 'conversation_already_linked_or_missing',
        result: 'skipped',
        tokenHash,
      });
    }
  }

  res.json({ success: true, sessionId: sess.id, linked: true });
});

// Auto-link unlinked sessions to authenticated user (by phone + conversations)
router.post('/auto-link', authenticateToken, autoLinkHandler);

// Get photographer's photos for approval
router.get('/photographer', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { status, session_id } = req.query;

  let query = `
    SELECT
      pa.id, pa.session_id, pa.photo_id, pa.client_id, pa.photographer_id,
      pa.status, pa.comment, pa.original_photo_url, pa.retouched_photo_url,
      pa.retouch_type, pa.order_id, pa.approved_at, pa.rejected_at,
      pa.created_at, pa.updated_at,
      u.display_name as client_name, u.email as client_email,
      ps.date as session_date, p.file_url, p.thumbnail_url
    FROM photo_approvals pa
    LEFT JOIN users u ON pa.client_id = u.id
    LEFT JOIN photo_sessions ps ON pa.session_id = ps.id
    LEFT JOIN photos p ON pa.photo_id = p.id
    WHERE pa.photographer_id = $1
  `;

  const params: unknown[] = [photographerId];

  if (status) {
    query += ` AND pa.status = $${params.length + 1}`;
    params.push(status);
  }

  if (session_id) {
    query += ` AND pa.session_id = $${params.length + 1}`;
    params.push(session_id);
  }

  query += ` ORDER BY pa.created_at DESC`;

  const result = await pool.query(query, params);

  res.json({
    approvals: result.rows,
    total: result.rowCount,
  });
});

// Approve photo
router.post('/:id/approve', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;
  const { comment } = req.body;

  // Check ownership (include session-level client_id)
  const approvalCheck = await pool.query(
    `SELECT pa.client_id, pa.photographer_id, pa.status, pa.approval_session_id,
            pas.client_id as session_client_id
     FROM photo_approvals pa
     LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
     WHERE pa.id = $1`,
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  const isOwner = approval.client_id === userId
    || approval.session_client_id === userId
    || approval.photographer_id === userId
    || req.user.role === 'admin';
  if (!isOwner) {
    throw new AppError(403, 'Forbidden');
  }

  const result = await pool.query(
    `UPDATE photo_approvals
     SET status = 'approved', comment = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, comment || null]
  );

  // Sync session counters
  if (approval.approval_session_id) {
    await updateSessionCounters(approval.approval_session_id);
  }

  // Create notification for photographer
  NotificationService.create({
    userId: approval.photographer_id,
    title: 'Фото одобрено',
    body: 'Клиент одобрил результат ретуши',
    type: 'retouch_approval',
    data: { approval_id: id },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  // Retouch hook: complete retouch task when photo approved
  if (approval.approval_session_id) {
    const retouchTask = await pool.query<Pick<WorkTasks, 'id'>>(
      `SELECT id FROM work_tasks WHERE approval_session_id = $1 AND task_type = 'retouch' AND status = 'waiting'`,
      [approval.approval_session_id],
    );
    if (retouchTask.rows[0]) {
      await pool.query(
        `UPDATE work_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [retouchTask.rows[0].id],
      );
      const socketServer = req.app.socketServer;
      if (socketServer) {
        socketServer.getIO().to('employee:dashboard').emit('retouch:completed', { taskId: retouchTask.rows[0].id });
      }
      await pool.query(
        `INSERT INTO retouch_task_history (task_id, from_status, to_status, changed_by, reason)
         VALUES ($1, 'waiting', 'completed', $2, 'Клиент одобрил результат')`,
        [retouchTask.rows[0].id, userId],
      );
    }
  }

  res.json(result.rows[0]);
});

// Reject photo
router.post('/:id/reject', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;
  const { reason } = req.body;

  const approvalCheck = await pool.query(
    `SELECT pa.client_id, pa.photographer_id, pa.approval_session_id,
            pas.client_id as session_client_id
     FROM photo_approvals pa
     LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
     WHERE pa.id = $1`,
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  const isOwner = approval.client_id === userId
    || approval.session_client_id === userId
    || approval.photographer_id === userId
    || req.user.role === 'admin';
  if (!isOwner) {
    throw new AppError(403, 'Forbidden');
  }

  const result = await pool.query(
    `UPDATE photo_approvals
     SET status = 'rejected',
         comment = $1,
         rejected_at = NOW(),
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [reason || null, id]
  );

  // Sync session counters
  if (approval.approval_session_id) {
    await updateSessionCounters(approval.approval_session_id);
  }

  // Notify photographer
  NotificationService.create({
    userId: approval.photographer_id,
    title: 'Фото отклонено',
    body: reason ? `Причина: ${reason}` : 'Клиент отклонил результат ретуши',
    type: 'retouch_approval',
    data: { approval_id: id, reason },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  // Retouch hook: send task back for revision + reset countdown on reject
  if (approval.approval_session_id) {
    const revision = await markRetouchRevision({
      approvalSessionId: approval.approval_session_id,
      reason: reason || 'Клиент отклонил результат',
      changedBy: userId,
    });
    if (revision) {
      const socketServer = req.app.socketServer;
      if (socketServer) {
        socketServer.getIO().to('employee:dashboard').emit('retouch:revision_requested', {
          taskId: revision.taskId,
          reason: reason || null,
        });
      }
    }
  }

  res.json(result.rows[0]);
});

// Request changes
router.post('/:id/request-changes', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;
  const { changes } = req.body;

  if (!changes) {
    throw new AppError(400, 'changes field is required');
  }

  const approvalCheck = await pool.query(
    `SELECT pa.client_id, pa.photographer_id, pa.approval_session_id,
            pas.client_id as session_client_id
     FROM photo_approvals pa
     LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
     WHERE pa.id = $1`,
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  const isOwner = approval.client_id === userId
    || approval.session_client_id === userId
    || approval.photographer_id === userId
    || req.user.role === 'admin';
  if (!isOwner) {
    throw new AppError(403, 'Forbidden');
  }

  const result = await pool.query(
    `UPDATE photo_approvals
     SET status = 'changes_requested',
         comment = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [changes, id]
  );

  // Sync session counters
  if (approval.approval_session_id) {
    await updateSessionCounters(approval.approval_session_id);
  }

  // Notify photographer
  NotificationService.create({
    userId: approval.photographer_id,
    title: 'Нужна доработка',
    body: changes,
    type: 'retouch_approval',
    data: { approval_id: id },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  // Retouch hook: send task back for revision + reset countdown on request-changes
  if (approval.approval_session_id) {
    const revision = await markRetouchRevision({
      approvalSessionId: approval.approval_session_id,
      reason: changes,
      changedBy: userId,
    });
    if (revision) {
      const socketServer = req.app.socketServer;
      if (socketServer) {
        socketServer.getIO().to('employee:dashboard').emit('retouch:revision_requested', {
          taskId: revision.taskId,
          reason: changes,
        });
      }
    }
  }

  res.json(result.rows[0]);
});

// Add annotation
router.post('/:id/annotations', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;
  const { x_position, y_position, comment } = req.body;

  // Check ownership
  const approvalCheck = await pool.query(
    'SELECT client_id, photographer_id FROM photo_approvals WHERE id = $1',
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  if (approval.client_id !== userId && approval.photographer_id !== userId && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  const annotationData = JSON.stringify({
    x: x_position || null,
    y: y_position || null,
    comment: comment || '',
  });

  const result = await pool.query(
    `INSERT INTO photo_approval_annotations (
      approval_id, user_id, annotation
    ) VALUES ($1, $2, $3::jsonb)
    RETURNING *`,
    [id, userId, annotationData]
  );

  res.status(201).json(result.rows[0]);
});

// Get annotations for approval
router.get('/:id/annotations', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;

  // Check access
  const approvalCheck = await pool.query(
    'SELECT client_id, photographer_id FROM photo_approvals WHERE id = $1',
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  if (approval.client_id !== userId && approval.photographer_id !== userId && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  const result = await pool.query(
    `SELECT
      paa.*, u.display_name as author_name
    FROM photo_approval_annotations paa
    LEFT JOIN users u ON paa.user_id = u.id
    WHERE paa.approval_id = $1
    ORDER BY paa.created_at ASC`,
    [id]
  );

  res.json({ annotations: result.rows });
});

// Delete annotation
router.delete('/annotations/:annotationId', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { annotationId } = req.params;

  const result = await pool.query(
    `DELETE FROM photo_approval_annotations
     WHERE id = $1 AND (user_id = $2 OR $3 = 'admin')
     RETURNING id`,
    [annotationId, userId, req.user.role]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Annotation not found or forbidden');
  }

  res.json({ message: 'Annotation deleted successfully' });
});

// Get approval history
router.get('/:id/history', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT
      pa.id, pa.status, pa.comment,
      pa.created_at, pa.updated_at, pa.approved_at, pa.rejected_at,
      u.display_name as user_name
    FROM photo_approvals pa
    LEFT JOIN users u ON pa.client_id = u.id
    WHERE pa.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  res.json({
    history: [
      {
        status: 'pending',
        timestamp: result.rows[0].created_at,
        user: result.rows[0].user_name,
      },
      {
        status: result.rows[0].status,
        timestamp: result.rows[0].updated_at,
        changes: result.rows[0].comment,
      },
    ],
  });
});

// Bulk approve photos
router.post('/bulk/approve', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { approval_ids } = req.body;

  if (!Array.isArray(approval_ids) || approval_ids.length === 0) {
    throw new AppError(400, 'approval_ids array is required');
  }

  const result = await pool.query(
    `UPDATE photo_approvals
     SET status = 'approved', approved_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1) AND (client_id = $2 OR EXISTS (
       SELECT 1 FROM photo_approval_sessions pas
       WHERE pas.id = photo_approvals.approval_session_id AND pas.client_id = $2
     ))
     RETURNING id`,
    [approval_ids, userId]
  );

  // Sync counters for affected sessions
  const affected = await pool.query(
    'SELECT DISTINCT approval_session_id FROM photo_approvals WHERE id = ANY($1) AND approval_session_id IS NOT NULL',
    [approval_ids]
  );
  for (const row of affected.rows) {
    await updateSessionCounters(row.approval_session_id);
  }

  res.json({
    message: 'Photos approved successfully',
    approved_count: result.rowCount,
  });
});

// Get approval stats
router.get('/stats/summary', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { as_photographer = 'false' } = req.query;

  const field = as_photographer === 'true' ? 'photographer_id' : 'client_id';

  const result = await pool.query(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE pa.status = 'pending') as pending,
      COUNT(*) FILTER (WHERE pa.status = 'approved') as approved,
      COUNT(*) FILTER (WHERE pa.status = 'rejected') as rejected,
      COUNT(*) FILTER (WHERE pa.status = 'changes_requested') as changes_requested
    FROM photo_approvals pa
    LEFT JOIN photo_approval_sessions pas ON pa.approval_session_id = pas.id
    WHERE (pa.${field} = $1 OR pas.${field} = $1)`,
    [userId]
  );

  res.json(result.rows[0]);
});

// Update photo status (photographer only)
router.put('/:id/status', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'approved', 'rejected', 'changes_requested'];
  if (!validStatuses.includes(status)) {
    throw new AppError(400, 'Invalid status');
  }

  const result = await pool.query(
    `UPDATE photo_approvals
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND photographer_id = $3
     RETURNING *`,
    [status, id, photographerId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Approval not found or forbidden');
  }

  res.json(result.rows[0]);
});

// ========== APPROVAL SESSIONS ==========

// Create approval session
router.post('/sessions', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { client_name, client_phone, title, description, order_id, task_id, deadline, chat_session_id, sla_hours, defer_send } = req.body;

  if (!client_name) {
    throw new AppError(400, 'client_name is required');
  }

  const publicToken = crypto.randomBytes(24).toString('hex');

  // Auto-detect chat_session_id from order if not provided
  let resolvedChatSessionId = chat_session_id || null;
  if (!resolvedChatSessionId && order_id) {
    const orderRow = await pool.query(
      `SELECT chat_session_id FROM photo_print_orders
       WHERE (CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN id = $1::uuid ELSE false END)
          OR order_id = $1
       LIMIT 1`,
      [order_id]
    );
    if (orderRow.rows.length > 0) {
      resolvedChatSessionId = orderRow.rows[0].chat_session_id;
    }
  }

  // Cascading client_id lookup: phone → chat user_id → contact user_id
  const clientId = await resolveClientId({
    client_phone: client_phone || null,
    chat_session_id: resolvedChatSessionId,
  });

  // Resolve contact_id from conversation
  let contactId: string | null = null;
  if (resolvedChatSessionId) {
    const convRow = await pool.query(
      'SELECT contact_id FROM conversations WHERE id = $1 AND contact_id IS NOT NULL LIMIT 1',
      [resolvedChatSessionId]
    );
    if (convRow.rows[0]) contactId = convRow.rows[0].contact_id;
  }

  const result = await pool.query(
    `INSERT INTO photo_approval_sessions
      (public_token, client_name, client_phone, client_id, photographer_id, title, description, order_id, task_id, deadline, chat_session_id, sla_hours, contact_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [publicToken, client_name, client_phone || null, clientId, req.user.id,
     title || `Фотосессия ${new Date().toLocaleDateString('ru-RU')}`,
     description || null, order_id || null, task_id || null, deadline || null,
     resolvedChatSessionId, sla_hours || 48, contactId]
  );

  const session = result.rows[0];
  const shareUrl = `/photo-review/${publicToken}`;

  // Если заказ привязан — автоотправить ссылку в чат клиента.
  // defer_send=true: оператор загрузит фото и сам нажмёт «Отправить клиенту»
  // (поток «как в чате»), поэтому преждевременную ссылку не шлём.
  if (order_id && defer_send !== true) {
    autosendApprovalLink(order_id, client_name, shareUrl, req).catch(err =>
      log.error('[PhotoApprovals] autosend chat error:', err.message)
    );
  }

  res.status(201).json({
    success: true,
    session: { ...session, shareUrl },
  });
});

/**
 * Автоматически отправляет ссылку на согласование в чат клиента,
 * если у заказа есть привязанный chat_session_id.
 */
async function autosendApprovalLink(orderId: string, clientName: string, shareUrl: string, req: import('express').Request): Promise<void> {
  const orderRow = await pool.query(
    `SELECT chat_session_id FROM photo_print_orders
     WHERE (CASE WHEN $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN id = $1::uuid ELSE false END)
        OR order_id = $1
     LIMIT 1`,
    [orderId]
  );
  if (!orderRow.rows.length) return;

  const chatSessionId = orderRow.rows[0].chat_session_id as string | null;
  if (!chatSessionId) return;

  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const fullLink = `${baseUrl}${shareUrl}`;
  const text = `Здравствуйте, ${clientName}! 📸\nВаши фотографии обработаны и готовы для просмотра.\nПерейдите по ссылке для согласования результата:\n${fullLink}`;

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
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [chatSessionId, text, metadataJson]
  );

  // Обновить сессию: link_sent_via + link_sent_at
  await pool.query(
    `UPDATE photo_approval_sessions SET link_sent_via = 'chat', link_sent_at = NOW() WHERE public_token = $1`,
    [shareUrl.replace('/photo-review/', '')]
  );

  // Socket.IO
  const socketServer = req.app.socketServer;

  if (socketServer && msgResult.rows.length > 0) {
    const msg = msgResult.rows[0];
    socketServer.getIO().to(`visitor:${chatSessionId}`).emit('operator:message', {
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
  }

  // Web Push (fire-and-forget)
  try {
    const { sendVisitorChatPush } = await import('../services/visitor-push.service.js');
    await sendVisitorChatPush(chatSessionId, {
      title: 'Ваши фото готовы',
      body: 'Нажмите, чтобы посмотреть и согласовать фотографии',
      tag: `approval-${chatSessionId}`,
      url: shareUrl,
    });
  } catch (_e) { /* push не критичен */ }
}

// List approval sessions
router.get('/sessions', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { status, search, limit = '50', offset = '0' } = req.query;
  const params: unknown[] = [];
  let paramIdx = 1;
  let sql = `SELECT id, public_token, client_name, client_phone, client_id, photographer_id, order_id, task_id, status, title, description, deadline, total_photos, approved_count, rejected_count, link_sent_via, link_sent_at, first_viewed_at, completed_at, created_at, updated_at, chat_session_id FROM photo_approval_sessions WHERE deleted_at IS NULL`;

  if (req.user.role !== 'admin') {
    sql += ` AND photographer_id = $${paramIdx++}`;
    params.push(req.user.id);
  }

  if (status) {
    sql += ` AND status = $${paramIdx++}`;
    params.push(status);
  }

  if (search) {
    sql += ` AND (LOWER(client_name) LIKE $${paramIdx} OR LOWER(client_phone) LIKE $${paramIdx} OR LOWER(title) LIKE $${paramIdx})`;
    params.push(`%${(search as string).toLowerCase()}%`);
    paramIdx++;
  }

  if (req.query['order_id']) {
    sql += ` AND order_id = $${paramIdx++}::uuid`;
    params.push(req.query['order_id']);
  }

  if (req.query['chat_session_id']) {
    sql += ` AND chat_session_id = $${paramIdx++}::uuid`;
    params.push(req.query['chat_session_id']);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit as string) || 50, parseInt(offset as string) || 0);

  const result = await pool.query(sql, params);
  res.json({ success: true, data: result.rows, total: result.rowCount });
});

// Get session detail with photos
router.get('/sessions/:sessionId', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res): Promise<void> => {
  const { sessionId } = req.params;

  const session = await pool.query(
    'SELECT id, public_token, client_name, client_phone, client_id, photographer_id, order_id, task_id, status, title, description, deadline, total_photos, approved_count, rejected_count, link_sent_via, link_sent_at, first_viewed_at, completed_at, created_at, updated_at, chat_session_id FROM photo_approval_sessions WHERE id = $1 AND deleted_at IS NULL', [sessionId]
  );
  if (session.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  const photos = await pool.query(
    `SELECT pa.*,
            (SELECT json_agg(paa.*) FROM photo_approval_annotations paa WHERE paa.approval_id = pa.id) as annotations,
            COALESCE(
              (SELECT json_agg(pav.* ORDER BY pav.sort_order)
                 FROM photo_approval_variants pav WHERE pav.approval_id = pa.id),
              '[]'::json
            ) as variants
     FROM photo_approvals pa WHERE pa.approval_session_id = $1 ORDER BY pa.created_at ASC`,
    [sessionId]
  );

  res.json({
    success: true,
    session: { ...session.rows[0], shareUrl: `/photo-review/${session.rows[0].public_token}` },
    photos: photos.rows,
  });
});

// Upload photo to session (JSON with s3Key from presigned upload)
// Supports role='original' or 'retouched' (default)
router.post('/sessions/:sessionId/photos', authenticateToken, requirePermission('bookings:manage'),
  approvalUploadLimiter, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { sessionId } = req.params;
  const body: SessionPhotoBody = req.body;
  const { s3Key } = body;
  const role = body.role || 'retouched';

  if (!s3Key || typeof s3Key !== 'string' || !s3Key.startsWith('approvals/')) {
    throw new AppError(400, 's3Key required (from presigned upload)');
  }

  // Verify file exists in S3
  const head = await storageService.headObject(s3Key);
  if (!head) throw new AppError(400, 'File not found in S3');

  const photoUrl = storageService.getPublicUrl(s3Key);

  // Verify session exists
  const sessionCheck = await pool.query(
    'SELECT id, client_id, original_photo_url, original_thumbnail_url FROM photo_approval_sessions WHERE id = $1', [sessionId]
  );
  if (sessionCheck.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  // Generate thumbnail from S3 object
  let thumbUrl: string | null = null;
  try {
    const { buffer } = await storageService.downloadToBuffer(s3Key);
    const { thumbnailUrl } = await generateThumbnail(buffer);
    thumbUrl = thumbnailUrl;
  } catch (e) {
    log.error('[PhotoApprovals] thumbnail generation failed:', { error: String(e) });
  }

  if (role === 'original') {
    // Save original photo URL on session
    await pool.query(
      `UPDATE photo_approval_sessions SET original_photo_url = $1, original_thumbnail_url = $2, updated_at = NOW() WHERE id = $3`,
      [photoUrl, thumbUrl, sessionId]
    );
    // Backfill existing photos in session that lack original
    await pool.query(
      `UPDATE photo_approvals SET original_photo_url = $1, original_thumbnail_url = $2 WHERE approval_session_id = $3 AND original_photo_url IS NULL`,
      [photoUrl, thumbUrl, sessionId]
    );
    res.status(201).json({
      success: true,
      original: { url: photoUrl, thumbnailUrl: thumbUrl || null },
    });
    return;
  }

  const sess = sessionCheck.rows[0];
  const result = await pool.query(
    `INSERT INTO photo_approvals
      (client_id, photographer_id, approval_session_id, retouched_photo_url, thumbnail_url, original_photo_url, original_thumbnail_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [sess.client_id, req.user.id, sessionId, photoUrl, thumbUrl, sess.original_photo_url, sess.original_thumbnail_url]
  );

  // Update counter
  await pool.query(
    `UPDATE photo_approval_sessions SET total_photos = total_photos + 1, updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );

  res.status(201).json({ success: true, photo: result.rows[0] });

  // P1 SECURITY FIX: async queue for auto-validation (prevent unbounded concurrent validation)
  photoValidationQueue.add(() =>
    validateFaceAndSave(photoUrl, { photoApprovalId: result.rows[0].id })
  ).catch(err => log.error('[FaceValidation] auto-validate failed:', { error: String(err) }));
});

// Delete photo from session
router.delete('/sessions/:sessionId/photos/:photoId', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  const { sessionId, photoId } = req.params;

  const result = await pool.query(
    `DELETE FROM photo_approvals WHERE id = $1 AND approval_session_id = $2 RETURNING retouched_photo_url`,
    [photoId, sessionId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Photo not found');
  }

  // Update counter
  await pool.query(
    `UPDATE photo_approval_sessions SET total_photos = GREATEST(total_photos - 1, 0), updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );

  // Delete file from storage (S3 or local)
  const fileUrl = result.rows[0].retouched_photo_url as string;
  if (fileUrl) {
    if (storageService.isS3Url(fileUrl)) {
      const key = storageService.keyFromUrl(fileUrl);
      if (key) await storageService.delete(key);
    } else {
      const filePath = path.join(process.cwd(), fileUrl);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        log.warn('[PhotoApprovals] local approval file delete failed', { error: String(error) });
      }
    }
  }

  res.json({ success: true });
});

// ========== VARIANT MANAGEMENT ==========

// Upload variant for a photo (JSON with s3Key from presigned upload)
router.post('/sessions/:sessionId/photos/:photoId/variants', authenticateToken, requirePermission('bookings:manage'),
  approvalUploadLimiter, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { sessionId, photoId } = req.params;
  const body: VariantUploadBody = req.body;
  const { s3Key } = body;
  const label = body.label || null;

  if (!s3Key || typeof s3Key !== 'string' || !s3Key.startsWith('approvals/')) {
    throw new AppError(400, 's3Key required (from presigned upload)');
  }

  // Verify file exists in S3
  const head = await storageService.headObject(s3Key);
  if (!head) throw new AppError(400, 'Variant file not found in S3');

  const variantUrl = storageService.getPublicUrl(s3Key);

  // Verify photo belongs to session
  const photoCheck = await pool.query(
    'SELECT id FROM photo_approvals WHERE id = $1 AND approval_session_id = $2', [photoId, sessionId]
  );
  if (photoCheck.rows.length === 0) {
    throw new AppError(404, 'Photo not found in session');
  }

  let thumbUrl: string | null = null;
  try {
    const { buffer } = await storageService.downloadToBuffer(s3Key);
    const { thumbnailUrl } = await generateThumbnail(buffer);
    thumbUrl = thumbnailUrl;
  } catch (e) {
    log.error('[PhotoApprovals] variant thumbnail failed:', { error: String(e) });
  }

  // Get next sort_order
  const orderResult = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM photo_approval_variants WHERE approval_id = $1',
    [photoId]
  );

  const result = await pool.query(
    `INSERT INTO photo_approval_variants
      (approval_id, variant_url, thumbnail_url, label, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [photoId, variantUrl, thumbUrl, label, orderResult.rows[0].next_order]
  );

  res.status(201).json({ success: true, variant: result.rows[0] });
});

// Delete variant
router.delete('/sessions/:sessionId/photos/:photoId/variants/:variantId', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  const { sessionId, photoId, variantId } = req.params;

  const result = await pool.query(
    `DELETE FROM photo_approval_variants
     WHERE id = $1 AND approval_id = $2
       AND EXISTS (SELECT 1 FROM photo_approvals WHERE id = $2 AND approval_session_id = $3)
     RETURNING variant_url, thumbnail_url`,
    [variantId, photoId, sessionId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Variant not found');
  }

  // Cleanup S3
  const row = result.rows[0];
  for (const url of [row.variant_url, row.thumbnail_url]) {
    if (url && storageService.isS3Url(url)) {
      const key = storageService.keyFromUrl(url);
      if (key) {
        try {
          await storageService.delete(key);
        } catch (error) {
          log.warn('[PhotoApprovals] variant file delete failed', { error: String(error) });
        }
      }
    }
  }

  res.json({ success: true });
});

// ========== OPERATOR CLARIFICATION ==========

// Send clarification question from operator to client (chat + annotation)
router.post('/sessions/:sessionId/photos/:photoId/clarification',
  authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { sessionId, photoId } = req.params;
  const text = getOptionalStringField(req.body, 'text');
  if (!text?.trim()) throw new AppError(400, 'text is required');

  // Verify photo belongs to session
  const photo = await pool.query(
    'SELECT id FROM photo_approvals WHERE id = $1 AND approval_session_id = $2',
    [photoId, sessionId]
  );
  if (!photo.rows.length) throw new AppError(404, 'Photo not found');

  // Save as annotation
  const annotation = JSON.stringify({ comment: text.trim(), type: 'operator_clarification' });
  const result = await pool.query(
    `INSERT INTO photo_approval_annotations (approval_id, annotation) VALUES ($1, $2::jsonb) RETURNING id`,
    [photoId, annotation]
  );

  // Send to chat if linked
  const session = await pool.query(
    'SELECT chat_session_id FROM photo_approval_sessions WHERE id = $1',
    [sessionId]
  );
  const chatSessionId = session.rows[0]?.chat_session_id;
  if (chatSessionId) {
    const msgRow = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content)
       VALUES ($1, 'operator', $2, 'text', $3) RETURNING *`,
      [chatSessionId, req.user.display_name || 'Оператор', `Уточнение по фото: ${text.trim()}`]
    );
    try {
      const socketServer = req.app.socketServer;
      if (socketServer && msgRow.rows[0]) {
        await broadcastChatMessage({ sessionId: chatSessionId, message: msgRow.rows[0] });
      }
    } catch (_e) { /* WS emit best-effort */ }
  }

  res.json({ success: true, annotationId: result.rows[0].id });
});

// ========== DELIVER FINAL PHOTO ==========

// Quick delivery of final photo to client from CRM chat (JSON with s3Key from presigned upload)
router.post('/deliver-final', authenticateToken, requirePermission('bookings:manage'),
  approvalUploadLimiter, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const body: DeliverFinalBody = req.body;
  const { s3Key, title, chat_session_id: chatSessionId } = body;

  if (!s3Key || typeof s3Key !== 'string' || !s3Key.startsWith('approvals/')) {
    throw new AppError(400, 's3Key required (from presigned upload)');
  }
  if (!title || typeof title !== 'string' || !title.trim()) throw new AppError(400, 'title is required');
  if (!chatSessionId || typeof chatSessionId !== 'string') throw new AppError(400, 'chat_session_id is required');

  // Verify file exists in S3
  const head = await storageService.headObject(s3Key);
  if (!head) throw new AppError(400, 'File not found in S3');

  const result = await deliverFinalPhoto({
    chatSessionId,
    title: title.trim(),
    s3Key,
    s3Url: storageService.getPublicUrl(s3Key),
    photographerId: req.user.id,
  });

  res.json({ success: true, data: result });
});

// ========== DELIVER FINAL PHOTOS (batch) ==========

// Batch delivery of final photos to client from CRM chat.
// Frontend uploads files via presigned PUT, then calls this with s3Keys.
router.post('/deliver-finals', authenticateToken, requirePermission('bookings:manage'),
  approvalUploadLimiter, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const body: DeliverFinalsBody = req.body;
  const { chatSessionId, title, photos } = body;

  if (!chatSessionId || typeof chatSessionId !== 'string') {
    throw new AppError(400, 'chatSessionId is required');
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new AppError(400, 'title is required');
  }
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new AppError(400, 'photos array is required and must not be empty');
  }
  if (photos.length > 100) {
    throw new AppError(400, 'Cannot deliver more than 100 photos at once');
  }
  for (const photo of photos) {
    if (!photo.s3Key || typeof photo.s3Key !== 'string' || !photo.s3Key.startsWith('approvals/')) {
      throw new AppError(400, `Invalid s3Key: ${photo.s3Key}. Must start with "approvals/"`);
    }
  }

  // Verify all files exist in S3 (parallel HEAD requests)
  await Promise.all(
    photos.map(async (photo) => {
      const head = await storageService.headObject(photo.s3Key);
      if (!head) throw new AppError(400, `File not found in S3: ${photo.s3Key}`);
    }),
  );

  const result = await deliverFinalPhotos({
    chatSessionId,
    title: title.trim(),
    photos,
    photographerId: req.user.id,
  });

  res.json({ success: true, data: result });
});

// ========== SEND TO CHAT ==========

// Send approval gallery as interactive message in chat.
// Delegates to sendGalleryToChat() which handles v2 messages, Socket.IO,
// push notifications, and external delivery with inline buttons (Telegram/VK/Max).
router.post('/sessions/:sessionId/send-to-chat', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { sessionId } = req.params;
  const result = await sendGalleryToChat({ sessionId });
  // Отправили фото на согласование → заказ автоматически переходит в «Готов».
  await syncOrderStatusForApproval({ sessionId, trigger: 'sent', actorUserId: req.user?.id ?? null });
  res.json({ success: true, messageId: result.messageId, reviewUrl: result.reviewUrl });
});

// ========== REVISION HISTORY ==========

// Get revision history
router.get('/sessions/:sessionId/history', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  const { sessionId } = req.params;

  const revisions = await pool.query(
    `SELECT r.*, u.display_name as created_by_name
     FROM photo_approval_revisions r
     LEFT JOIN users u ON r.created_by = u.id
     WHERE r.approval_id IN (SELECT id FROM photo_approvals WHERE approval_session_id = $1)
     ORDER BY r.created_at DESC`,
    [sessionId]
  );

  res.json({ success: true, revisions: revisions.rows });
});

// ========== PIPELINE DASHBOARD ==========

// Get pipeline data with aggregation
router.get('/pipeline', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const search = getQueryString(req.query['search']);
  const dateFrom = getQueryString(req.query['date_from']);
  const dateTo = getQueryString(req.query['date_to']);
  const service = getPipelineServiceFilter(req.query['service']);
  const linkSentOnly = isTruthyQuery(req.query['link_sent']);
  const params: unknown[] = [];
  let paramIdx = 1;

  let whereClauses = '';
  if (req.user.role !== 'admin') {
    whereClauses += ` AND s.photographer_id = $${paramIdx++}`;
    params.push(req.user.id);
  }
  if (search) {
    whereClauses += ` AND (
      LOWER(COALESCE(s.client_name, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(s.client_phone, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(s.title, '')) LIKE $${paramIdx}
      OR LOWER(COALESCE(po.order_id, s.order_id, '')) LIKE $${paramIdx}
    )`;
    params.push(`%${search.toLowerCase()}%`);
    paramIdx++;
  }
  if (dateFrom) {
    whereClauses += ` AND s.created_at >= $${paramIdx++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    whereClauses += ` AND s.created_at <= $${paramIdx++}`;
    params.push(dateTo);
  }
  if (linkSentOnly) {
    whereClauses += ` AND s.link_sent_at IS NOT NULL`;
  }
  if (service === 'photo-docs') {
    whereClauses += `
      AND (
        LOWER(COALESCE(s.title, '')) LIKE '%фото на документ%'
        OR LOWER(COALESCE(s.description, '')) LIKE '%фото на документ%'
        OR LOWER(COALESCE(po.description, '')) LIKE '%фото на документ%'
        OR po.document_template_id IS NOT NULL
        OR po.photo_size IS NOT NULL
        OR LOWER(COALESCE(po.service_type, '')) IN ('photo-docs', 'document_photo', 'photo_documents')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(po.items) = 'array' THEN po.items ELSE '[]'::jsonb END
          ) item
          WHERE item->>'slug' = 'photo-docs'
             OR item->>'categorySlug' = 'photo-docs'
             OR item->>'category_slug' = 'photo-docs'
             OR item->>'service_type' = 'photo-docs'
             OR LOWER(COALESCE(item->>'name', '')) LIKE '%фото на документ%'
             OR LOWER(COALESCE(item->>'service', '')) LIKE '%фото на документ%'
             OR NULLIF(item->>'document', '') IS NOT NULL
        )
      )`;
  }

  const orderJoinSql = `
     LEFT JOIN photo_print_orders po
       ON po.order_id = s.order_id
       OR po.id = CASE WHEN s.order_id ~* '${UUID_SQL_PATTERN}' THEN s.order_id::uuid ELSE NULL END`;

  // Sessions grouped by status
  const sessions = await pool.query(
    `SELECT s.*,
       u.display_name as photographer_name,
       po.order_id as order_ref,
       po.status as order_status,
       po.payment_status,
       COALESCE(
         po.service_type,
         po.description,
         po.items->0->>'name',
         po.items->0->>'service',
         s.title
       ) as service_summary,
       EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600 as hours_elapsed,
       (SELECT COUNT(*) FROM photo_approval_variants v
        JOIN photo_approvals pa ON v.approval_id = pa.id
        WHERE pa.approval_session_id = s.id) as total_variants,
       (SELECT string_agg(DISTINCT vcs.source, ',')
        FROM conversations vcs WHERE vcs.id = s.chat_session_id) as channel
     FROM photo_approval_sessions s
     LEFT JOIN users u ON s.photographer_id = u.id
     ${orderJoinSql}
     WHERE s.deleted_at IS NULL ${whereClauses}
     ORDER BY
       CASE s.status
         WHEN 'pending' THEN 1
         WHEN 'in_review' THEN 2
         WHEN 'changes_requested' THEN 3
         WHEN 'partially_approved' THEN 4
         WHEN 'approved' THEN 5
         WHEN 'completed' THEN 6
       END,
       s.created_at DESC`,
    params
  );

  // Stats
  const stats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE s.status IN ('pending','in_review','changes_requested')) as active,
       COUNT(*) FILTER (WHERE s.status = 'approved') as approved_total,
       COUNT(*) as total,
       AVG(EXTRACT(EPOCH FROM (COALESCE(s.completed_at, NOW()) - s.created_at)) / 3600)
         FILTER (WHERE s.status IN ('approved','completed','partially_approved')) as avg_hours,
       COUNT(*) FILTER (WHERE s.expired_at IS NOT NULL) as expired_count
     FROM photo_approval_sessions s
     ${orderJoinSql}
     WHERE s.deleted_at IS NULL ${whereClauses}`,
    params
  );

  res.json({
    success: true,
    sessions: sessions.rows,
    stats: stats.rows[0],
  });
});


// Download approved photos from session (authenticated client)
router.get('/sessions/:sessionId/download', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { sessionId } = req.params;

  const session = await db.queryOne<DownloadSessionRow>(
    `SELECT id, status, client_id, contact_id, download_expires_at, title
     FROM photo_approval_sessions WHERE id = $1 AND deleted_at IS NULL`,
    [sessionId],
  );
  if (!session) throw new AppError(404, 'Session not found');

  // Access check: session.client_id = user OR user's contact
  const userId = req.user.id;
  let hasAccess = session.client_id === userId;
  if (!hasAccess) {
    const contact = await db.queryOne<IdOnly>(
      'SELECT id FROM contacts WHERE user_id = $1 LIMIT 1', [userId],
    );
    if (contact && session.contact_id === contact.id) hasAccess = true;
  }
  if (!hasAccess) throw new AppError(403, 'Access denied');

  if (!['approved', 'completed'].includes(session.status ?? '')) {
    throw new AppError(400, 'Photos are not yet approved');
  }

  if (session.download_expires_at && new Date(session.download_expires_at) < new Date()) {
    throw new AppError(410, 'Download link has expired');
  }

  const photos = await db.query<ApprovedDownloadPhotoRow>(
    `SELECT id, retouched_photo_url, thumbnail_url, status
     FROM photo_approvals
     WHERE approval_session_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [session.id],
  );

  if (photos.length === 0) throw new AppError(404, 'No approved photos found');

  res.json({
    success: true,
    title: session.title,
    expiresAt: session.download_expires_at,
    photos: photos.map(p => ({
      id: p.id,
      url: p.retouched_photo_url,
      thumbnailUrl: p.thumbnail_url,
    })),
  });
});
// Get approval by ID (MUST be after all static GET routes to avoid catching /sessions, /pipeline, /stats)
router.get('/:id', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;

  const result = await pool.query(
    `SELECT
      pa.*,
      u.display_name as client_name,
      ps.date as session_date,
      p.file_url, p.thumbnail_url, p.metadata
    FROM photo_approvals pa
    LEFT JOIN users u ON pa.client_id = u.id
    LEFT JOIN photo_sessions ps ON pa.session_id = ps.id
    LEFT JOIN photos p ON pa.photo_id = p.id
    WHERE pa.id = $1
      AND (pa.client_id = $2 OR pa.photographer_id = $2 OR $3 = 'admin')`,
    [id, userId, req.user.role]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  res.json(result.rows[0]);
});

// ========== PRE-SIGNED S3 UPLOAD FOR APPROVALS ==========

/**
 * Pre-signed S3 upload for approval photos
 * POST /api/photo-approvals/direct-upload/presign
 * POST /api/photo-approvals/direct-upload/complete
 */
const approvalPresignedRouter = createPresignedUploadRoutes({
  prefix: 'approvals',
  allowedMimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']),
  maxFileSize: 20 * 1024 * 1024,
  maxFiles: 20,
  auth: [authenticateToken, requirePermission('bookings:manage')],
  rateLimiter: createUploadLimiter('ul-approv:', 100, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], req: Request, res: Response) => {
    const sessionId = getOptionalStringField(req.body, 'sessionId');
    if (!sessionId) throw new AppError(400, 'sessionId required');

    const sessionCheck = await pool.query(
      'SELECT id, client_id, original_photo_url, original_thumbnail_url FROM photo_approval_sessions WHERE id = $1',
      [sessionId],
    );
    if (sessionCheck.rows.length === 0) throw new AppError(404, 'Session not found');

    const sess = sessionCheck.rows[0];
    requireRequestUser(req);

    const results: unknown[] = [];
    for (const file of files) {
      // Generate thumbnail from S3 object
      let thumbUrl: string | null = null;
      try {
        const { buffer } = await storageService.downloadToBuffer(file.s3Key);
        const { thumbnailUrl } = await generateThumbnail(buffer);
        thumbUrl = thumbnailUrl;
      } catch (e) {
        log.error('thumbnail generation failed for presigned upload', { error: e });
      }

      const result = await pool.query(
        `INSERT INTO photo_approvals
          (client_id, photographer_id, approval_session_id, retouched_photo_url, thumbnail_url,
           original_photo_url, original_thumbnail_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [sess.client_id, req.user.id, sessionId, file.s3Url, thumbUrl,
         sess.original_photo_url, sess.original_thumbnail_url],
      );
      results.push(result.rows[0]);
    }

    // Update counter
    await pool.query(
      `UPDATE photo_approval_sessions SET total_photos = total_photos + $1, updated_at = NOW() WHERE id = $2`,
      [files.length, sessionId],
    );

    res.json({ success: true, photos: results, count: files.length });
  },
});
router.use('/direct-upload', approvalPresignedRouter);

// ========== RETOUCHING UPLOAD ENDPOINTS (legacy) ==========

// Employee uploads retouched photo for client approval
router.post('/upload', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { client_id, original_photo_url, retouched_photo_url, retouch_type, order_id, session_id } = req.body;

  if (!client_id || !retouched_photo_url) {
    throw new AppError(400, 'client_id and retouched_photo_url are required');
  }

  const validTypes = ['basic', 'pro', 'premium'];
  const type = validTypes.includes(retouch_type) ? retouch_type : 'basic';

  const result = await pool.query(
    `INSERT INTO photo_approvals (
      client_id, photographer_id, session_id, order_id,
      original_photo_url, retouched_photo_url, retouch_type,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING *`,
    [
      client_id,
      req.user.id,
      session_id || null,
      order_id || null,
      original_photo_url || null,
      retouched_photo_url,
      type,
    ]
  );

  // Notify client
  NotificationService.create({
    userId: client_id,
    title: 'Ретушь готова',
    body: 'Ваши фото после ретуши готовы для проверки',
    type: 'retouch_approval',
    data: { approval_id: result.rows[0].id, retouch_type: type },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  res.status(201).json(result.rows[0]);
});

// Employee re-uploads after changes requested
router.put('/:id/reupload', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { id } = req.params;
  const { retouched_photo_url } = req.body;

  if (!retouched_photo_url) {
    throw new AppError(400, 'retouched_photo_url is required');
  }

  // Check current status
  const approvalCheck = await pool.query(
    'SELECT client_id, status FROM photo_approvals WHERE id = $1',
    [id]
  );

  if (approvalCheck.rows.length === 0) {
    throw new AppError(404, 'Approval not found');
  }

  const approval = approvalCheck.rows[0];
  if (approval.status !== 'changes_requested' && approval.status !== 'rejected') {
    throw new AppError(400, 'Can only re-upload when status is changes_requested or rejected');
  }

  // Snapshot current state as revision before overwriting
  const currentVariants = await pool.query(
    `SELECT id, variant_url, thumbnail_url, label, sort_order, is_selected
     FROM photo_approval_variants WHERE approval_id = $1 ORDER BY sort_order`,
    [id]
  );
  const currentAnnotations = await pool.query(
    `SELECT id, annotation, created_at FROM photo_approval_annotations WHERE approval_id = $1 ORDER BY created_at`,
    [id]
  );

  await pool.query(
    `INSERT INTO photo_approval_revisions
       (approval_id, revision_number, variants_snapshot, client_comment, annotations_snapshot, status, created_by)
     VALUES ($1,
       (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM photo_approval_revisions WHERE approval_id = $1),
       $2, $3, $4, $5, $6)`,
    [id, JSON.stringify(currentVariants.rows), approval.comment || null,
     JSON.stringify(currentAnnotations.rows), approval.status, req.user.id]
  );

  const result = await pool.query(
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
    [retouched_photo_url, id]
  );

  // Notify client
  NotificationService.create({
    userId: approval.client_id,
    title: 'Ретушь обновлена',
    body: 'Фото после доработки готово для повторной проверки',
    type: 'retouch_approval',
    data: { approval_id: id },
  }).catch(err => log.error('[PhotoApprovals] Notification error', { error: String(err) }));

  res.json(result.rows[0]);
});

// ========== DELETE SESSION (soft delete) ==========

router.delete('/sessions/:sessionId', authenticateToken, requirePermission('bookings:manage'),
  async (req: AuthRequest, res): Promise<void> => {
  const sessionIdentifier = req.params.sessionId;
  let resolvedChatSessionId: string | null = null;
  let deletedMessages: IdOnly[] = [];
  let deletedSessionId = sessionIdentifier;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const session = await client.query<ApprovalDeleteSessionRow>(
      `SELECT id, chat_session_id, public_token
       FROM photo_approval_sessions
       WHERE (id::text = $1 OR public_token = $1)
         AND deleted_at IS NULL
       FOR UPDATE`,
      [sessionIdentifier],
    );
    if (session.rows.length === 0) {
      throw new AppError(404, 'Session not found');
    }

    const sess = session.rows[0];
    deletedSessionId = sess.id;

    await client.query(
      `UPDATE photo_approval_variants
       SET is_selected = FALSE, selected_at = NULL
       WHERE approval_id IN (
         SELECT id FROM photo_approvals WHERE approval_session_id = $1
       )`,
      [sess.id],
    );

    await client.query(
      `UPDATE photo_approvals
       SET status = 'pending',
           comment = NULL,
           approved_at = NULL,
           rejected_at = NULL,
           approved_by = NULL,
           approved_by_role = NULL,
           selected_variant_id = NULL,
           updated_at = NOW()
       WHERE approval_session_id = $1`,
      [sess.id],
    );

    await client.query(
      `UPDATE photo_approval_sessions
       SET deleted_at = NOW(),
           status = 'cancelled',
           approved_count = 0,
           rejected_count = 0,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [sess.id],
    );

    if (sess.chat_session_id) {
      const convRow = await client.query<IdOnly>(
        'SELECT id FROM conversations WHERE id = $1 OR legacy_session_id = $1 LIMIT 1',
        [sess.chat_session_id],
      );
      const convId = convRow.rows[0]?.id || sess.chat_session_id;
      resolvedChatSessionId = convId;

      const deletedMsgs = await client.query<IdOnly>(
        `UPDATE messages
         SET deleted_at = NOW()
         WHERE conversation_id = $1
           AND deleted_at IS NULL
           AND (
             metadata->'interactive'->>'sessionId' = $2
             OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(metadata->'interactive'->'buttons') = 'array'
                   THEN metadata->'interactive'->'buttons'
                   ELSE '[]'::jsonb
                 END
               ) AS button
               WHERE button->>'id' IN ('download_photo', 'download_photos')
                 AND button->>'url' LIKE '%/photo-review/' || $3 || '%'
             )
           )
         RETURNING id`,
        [convId, sess.id, sess.public_token],
      );
      deletedMessages = deletedMsgs.rows;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
      log.warn('[PhotoApprovals] Session delete rollback failed', { sessionIdentifier, error: String(rollbackErr) });
    });
    throw err;
  } finally {
    client.release();
  }

  // Broadcast message deletion via Socket.IO so chat UI updates in real-time.
  interface SocketIO { to(room: string): { emit(event: string, data: unknown): void } }
  interface SocketSrv { getIO(): SocketIO }
  const socketServer: SocketSrv | undefined = req.app['socketServer'];
  if (socketServer && resolvedChatSessionId && deletedMessages.length > 0) {
    const io = socketServer.getIO();
    for (const msg of deletedMessages) {
      io.to('admin:visitor-chats').emit('message:deleted', { sessionId: resolvedChatSessionId, messageId: msg.id });
      io.to(`visitor:${resolvedChatSessionId}`).emit('message:deleted', { sessionId: resolvedChatSessionId, messageId: msg.id });
    }
  }

  log.info('[PhotoApprovals] Session cancelled and soft-deleted', { sessionId: deletedSessionId, deletedMessages: deletedMessages.length });
  res.json({ success: true });
});

export default router;
