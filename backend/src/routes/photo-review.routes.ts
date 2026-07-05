import { Router, Request, Response, NextFunction } from 'express';
import db from '../database/db.js';
import { optionalAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { updateSessionCounters } from '../services/approval-counters.service.js';
import { syncOrderStatusForApproval } from '../services/order-status.service.js';
import { deliverToExternalChannel } from '../services/photo-approval.service.js';
import { sendVisitorChatPush } from '../services/visitor-push.service.js';
import { markRetouchRevision } from '../services/retouch.service.js';
import type PhotoApprovals from '../types/generated/public/PhotoApprovals.js';
import type { PhotoApprovalsId } from '../types/generated/public/PhotoApprovals.js';
import type PhotoApprovalSessions from '../types/generated/public/PhotoApprovalSessions.js';
import type Messages from '../types/generated/public/Messages.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { NotificationService } from '../services/notification.service.js';
import type Conversations from '../types/generated/public/Conversations.js';
import type CustomerFeedback from '../types/generated/public/CustomerFeedback.js';
import type { IdOnly } from '../types/db-common.types.js';
import { createLogger } from '../utils/logger.js';
import { getIdentityLinkRequestContext, hashPublicToken, logIdentityLinkEvent } from '../services/identity-link-audit.service.js';

const router = Router();
const logger = createLogger('photo-review.routes');

type SocketIO = { to: (room: string) => { emit: (event: string, data: unknown) => void } };

interface SocketServerLookup {
  getIO?: () => SocketIO;
}

interface ApprovalSession {
  id: string;
  public_token: string;
  client_name: string;
  client_phone: string;
  status: string;
  title: string;
  photographer_id: string;
  chat_session_id: string | null;
}

interface ReviewRequest extends Request {
  approvalSession?: ApprovalSession;
  user?: { id: string; role: string; display_name?: string; email?: string };
}

interface MessageMetadata {
  [key: string]: unknown;
}

interface BroadcastableMessage extends Messages {
  readonly [key: string]: unknown;
}

interface ApprovalReviewSessionRow {
  id: string;
  client_name: string;
  status: string;
  title: string;
  description: string;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  first_viewed_at: string | null;
  created_at: string;
}

interface SessionClientIdRow {
  id: string;
  client_id: string | null;
  chat_session_id: string | null;
}

interface ReviewPhotoRow {
  id: string;
  status: string;
  comment: string | null;
  retouched_photo_url: string;
  original_photo_url: string | null;
  retouch_type: string | null;
  created_at: string;
  thumbnail_url: string | null;
  original_thumbnail_url: string | null;
  revision_count: number;
  selected_variant_id: string | null;
}

interface PhotoAnnotationRow {
  id: string;
  approval_id: string;
  annotation: MessageMetadata;
  created_at: string;
}

interface PhotoVariantOptionRow {
  id: string;
  approval_id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string;
  sort_order: number;
  is_selected: boolean;
  selected_at: string | null;
}

interface ApprovalStatsRow {
  total: string;
  approved: string;
  rejected: string;
}

interface RejectedPhotoRow {
  id: string;
  comment: string | null;
}

interface VariantSelectionRow extends IdOnly {
  label: string;
}

function isSocketServerLookup(value: unknown): value is SocketServerLookup {
  return typeof value === 'object' && value !== null && 'getIO' in value;
}

function getIO(req: Request): SocketIO | undefined {
  const ss: unknown = Reflect.get(req.app, 'socketServer');
  return isSocketServerLookup(ss) ? ss.getIO?.() : undefined;
}

function emitApprovalEvent(req: Request, session: ApprovalSession, action: string, photoId?: string): void {
  try {
    const io = getIO(req);
    if (io) {
      io.to('admin:visitor-chats').emit('approval:photo-reviewed', {
        sessionId: session.id,
        chatSessionId: session.chat_session_id,
        clientName: session.client_name,
        title: session.title,
        action,
        photoId,
      });
    }
  } catch (_e) { /* socket not available */ }
}

async function insertChatNotification(req: Request, session: ApprovalSession, reason: string | null): Promise<void> {
  if (!session.chat_session_id) return;

  const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
  const reviewUrl = `${baseUrl}/photo-review/${session.public_token}`;

  const text = `✏️ Клиент запросил доработку фото${reason ? `:\n«${reason}»` : ''}\n\nОткрыть согласование:`;
  const metadata = JSON.stringify({
    interactive: {
      type: 'buttons',
      buttons: [
        { id: 'view_approval', label: '📷 Открыть ретушь', url: reviewUrl, color: '#f59e0b' },
      ],
    },
  });

  const msgRow = await db.queryOne<BroadcastableMessage>(
    `INSERT INTO messages
       (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3)
     RETURNING *`,
    [session.chat_session_id, text, metadata]
  );

  try {
    if (msgRow) {
      await broadcastChatMessage({ sessionId: session.chat_session_id!, message: msgRow });
    }
  } catch { /* pub/sub not available */ }
}

/** Notify photographer (and chat operator if different) about approval event */
async function notifyEmployee(
  session: ApprovalSession,
  title: string,
  body: string,
  action: string,
): Promise<void> {
  const data = { sessionId: session.id, action, chatSessionId: session.chat_session_id };
  const notifiedIds = new Set<string>();

  // 1. Notify photographer
  if (session.photographer_id) {
    notifiedIds.add(session.photographer_id);
    await NotificationService.create({
      userId: session.photographer_id, title, body, type: 'retouch_approval', data,
    });
  }

  // 2. Notify assigned chat operator (if different from photographer)
  if (session.chat_session_id) {
    const conv = await db.queryOne<Pick<Conversations, 'assigned_operator_id'>>(
      `SELECT assigned_operator_id FROM conversations WHERE id = $1`,
      [session.chat_session_id],
    );
    if (conv?.assigned_operator_id && !notifiedIds.has(conv.assigned_operator_id)) {
      await NotificationService.create({
        userId: conv.assigned_operator_id, title, body, type: 'retouch_approval', data,
      });
    }
  }
}

async function validateToken(req: ReviewRequest, res: Response, next: NextFunction): Promise<void> {
  const { token } = req.params;
  if (!token || token.length < 10) {
    res.status(400).json({ success: false, error: 'Invalid token' });
    return;
  }

  const session = await db.queryOne<ApprovalSession>(
    `SELECT id, public_token, client_name, client_phone, status, title, photographer_id, chat_session_id
     FROM photo_approval_sessions WHERE public_token = $1`,
    [token]
  );

  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }

  if (session.status === 'completed') {
    res.status(410).json({ success: false, error: 'Review already completed' });
    return;
  }

  req.approvalSession = session;
  next();
}

/**
 * GET /api/photo-review/:token
 * Public: session + photos + annotations
 */
router.get('/:token', optionalAuth, async (req: ReviewRequest, res: Response) => {
  const { token } = req.params;

  const session = await db.queryOne<ApprovalReviewSessionRow>(
    `SELECT id, client_name, status, title, description,
            total_photos, approved_count, rejected_count, first_viewed_at, created_at
     FROM photo_approval_sessions WHERE public_token = $1`,
    [token]
  );

  if (!session) {
    throw new AppError(404, 'Session not found');
  }

  // Audit: log view access (fire-and-forget with error logging)
  db.query(
    `INSERT INTO photo_access_audit (approval_session_id, accessed_by_user_id, accessed_by_role, access_type, access_method, ip_address, user_agent)
     VALUES ($1, $2, $3, 'view', 'public_token', $4, $5)`,
    [session.id, req.user?.id ?? null, req.user?.role ?? 'anonymous', req.ip, req.headers['user-agent'] ?? null]
  ).catch(err => logger.warn('[photo-review] audit insert error', { error: String(err) }));

  // Mark first view
  if (!session.first_viewed_at) {
    await db.query(
      `UPDATE photo_approval_sessions SET first_viewed_at = NOW(), status = 'in_review', updated_at = NOW()
       WHERE id = $1 AND first_viewed_at IS NULL`,
      [session.id]
    );
    session.status = 'in_review';

    try {
      const io = getIO(req);
      if (io) {
        io.to('admin:visitor-chats').emit('approval:session-viewed', {
          sessionId: session.id, clientName: session.client_name, title: session.title,
        });
      }
    } catch (_e) { /* */ }
  }

  // Auto-link: if user is authenticated and session has no client_id, bind them
  if (req.user?.id) {
    const sessMeta = await db.queryOne<SessionClientIdRow>(
      'SELECT id, client_id, chat_session_id FROM photo_approval_sessions WHERE public_token = $1', [token],
    );
    if (sessMeta && !sessMeta.client_id) {
      const updatedSession = await db.queryOne<SessionClientIdRow>(
        `UPDATE photo_approval_sessions SET client_id = $1, updated_at = NOW()
         WHERE public_token = $2 AND client_id IS NULL
         RETURNING id, client_id, chat_session_id`,
        [req.user.id, token],
      );
      if (updatedSession) {
        await db.query(
          `UPDATE photo_approvals SET client_id = $1
           WHERE approval_session_id = $2 AND client_id IS NULL`,
          [req.user.id, session.id],
        );

        const auditRequest = getIdentityLinkRequestContext(req);
        await logIdentityLinkEvent({
          action: 'identity_link_session',
          source: 'photo_review_auto_link',
          entityType: 'photo_approval_session',
          entityId: updatedSession.id,
          actorUserId: req.user.id,
          actorUserName: req.user.display_name ?? req.user.email ?? null,
          actorRole: req.user.role,
          ip: auditRequest.ip,
          userAgent: auditRequest.userAgent,
          approvalSessionId: updatedSession.id,
          conversationId: updatedSession.chat_session_id,
          previousClientId: sessMeta.client_id,
          newClientId: req.user.id,
          reason: 'authenticated_photo_review_view',
          result: 'linked',
          tokenHash: hashPublicToken(token),
        });
      }
    } else if (sessMeta && sessMeta.client_id !== req.user.id) {
      const auditRequest = getIdentityLinkRequestContext(req);
      await logIdentityLinkEvent({
        action: 'identity_link_skipped',
        source: 'photo_review_auto_link',
        entityType: 'photo_approval_session',
        entityId: sessMeta.id,
        actorUserId: req.user.id,
        actorUserName: req.user.display_name ?? req.user.email ?? null,
        actorRole: req.user.role,
        ip: auditRequest.ip,
        userAgent: auditRequest.userAgent,
        approvalSessionId: sessMeta.id,
        conversationId: sessMeta.chat_session_id,
        previousClientId: sessMeta.client_id,
        newClientId: req.user.id,
        reason: 'session_already_linked_to_other_user',
        result: 'blocked',
        tokenHash: hashPublicToken(token),
      });
    }
  }

  // Photos
  const photos = await db.query<ReviewPhotoRow>(
    `SELECT id, status, comment, retouched_photo_url, original_photo_url, retouch_type, created_at,
            thumbnail_url, original_thumbnail_url, revision_count, selected_variant_id
     FROM photo_approvals WHERE approval_session_id = $1 ORDER BY created_at ASC`,
    [session.id]
  );

  // Annotations
  const photoIds = photos.map(p => p.id);
  let annotations: PhotoAnnotationRow[] = [];
  if (photoIds.length > 0) {
    annotations = await db.query<PhotoAnnotationRow>(
      `SELECT id, approval_id, annotation, created_at
       FROM photo_approval_annotations WHERE approval_id = ANY($1) ORDER BY created_at ASC`,
      [photoIds]
    );
  }

  const annotMap = new Map<string, typeof annotations>();
  for (const a of annotations) {
    const list = annotMap.get(a.approval_id) || [];
    list.push(a);
    annotMap.set(a.approval_id, list);
  }

  // Variants for each photo
  let variants: PhotoVariantOptionRow[] = [];
  if (photoIds.length > 0) {
    variants = await db.query<PhotoVariantOptionRow>(
      `SELECT id, approval_id, variant_url, thumbnail_url, label, sort_order, is_selected, selected_at
       FROM photo_approval_variants WHERE approval_id = ANY($1) ORDER BY sort_order ASC`,
      [photoIds]
    );
  }

  const variantMap = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = variantMap.get(v.approval_id) || [];
    list.push(v);
    variantMap.set(v.approval_id, list);
  }

  const photosWithNested = photos.map(p => ({
    ...p,
    annotations: annotMap.get(p.id) || [],
    variants: variantMap.get(p.id) || [],
  }));

  res.json({
    success: true,
    session: {
      id: session.id, title: session.title, description: session.description,
      clientName: session.client_name, status: session.status,
      totalPhotos: session.total_photos, approvedCount: session.approved_count,
      rejectedCount: session.rejected_count, createdAt: session.created_at,
    },
    photos: photosWithNested,
  });
});

/**
 * POST /api/photo-review/:token/photos/:photoId/approve
 * Client selects the final variant — auto-completes the session.
 * Deletes non-selected variants, notifies chat, updates order.
 */
router.post('/:token/photos/:photoId/approve', validateToken, async (req: ReviewRequest, res: Response) => {
  const { photoId } = req.params;
  const { comment } = req.body;
  const s = req.approvalSession!;

  // Idempotency: if session is already approved/completed — return success without side-effects
  if (s.status === 'approved' || s.status === 'completed') {
    await syncOrderStatusForApproval({ sessionId: s.id, trigger: 'reviewed' });
    res.json({ success: true, completed: true, idempotent: true });
    return;
  }

  // 1. Approve the selected photo
  const result = await db.queryOne<Pick<PhotoApprovals, 'id' | 'retouched_photo_url'>>(
    `UPDATE photo_approvals SET status = 'approved', comment = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND approval_session_id = $3 AND status != 'approved' RETURNING id, retouched_photo_url`,
    [photoId, comment || null, s.id]
  );
  if (!result) { throw new AppError(404, 'Photo not found'); }

  // 2. Delete non-selected variants (annotations → variants → photos)
  const othersIds = (await db.query<Pick<PhotoApprovals, 'id'>>(
    `SELECT id FROM photo_approvals WHERE approval_session_id = $1 AND id != $2`,
    [s.id, photoId]
  )).map(r => r.id);

  if (othersIds.length > 0) {
    await db.query(`DELETE FROM photo_approval_annotations WHERE approval_id = ANY($1)`, [othersIds]);
    await db.query(`DELETE FROM photo_approval_variants WHERE approval_id = ANY($1)`, [othersIds]);
    await db.query(`DELETE FROM photo_approvals WHERE id = ANY($1)`, [othersIds]);
  }

  // 3. Auto-complete the session + set download expiry (30 days)
  await db.query(
    `UPDATE photo_approval_sessions
     SET status = 'approved', completed_at = NOW(), updated_at = NOW(),
         approved_count = 1, rejected_count = 0, total_photos = 1,
         download_expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1`,
    [s.id]
  );
  await syncOrderStatusForApproval({ sessionId: s.id, trigger: 'reviewed' });

  // 4. Socket.IO → CRM
  emitApprovalEvent(req, s, 'approved', photoId);
  try {
    const io = getIO(req);
    if (io) {
      io.to('admin:visitor-chats').emit('approval:session-completed', {
        sessionId: s.id, clientName: s.client_name, title: s.title,
        status: 'approved', approved: 1, total: 1,
      });
    }
  } catch (err) { logger.warn('[photo-review] socket emit error', { error: String(err) }); }

  // 5. Bot message → chat (for employee + client)
  if (s.chat_session_id) {
    const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
    const downloadUrl = `${baseUrl}/photo-review/${s.public_token}`;
    const myPhotosUrl = `${baseUrl}/user-profile/my-photos`;
    const text = `✅ Отличный выбор! Ваша фотография готова.\n\nВы можете скачать её в разделе «Мои фотографии».`;
    const photoUrl = result.retouched_photo_url || null;
    const metadata = JSON.stringify({
      interactive: {
        type: 'buttons',
        sessionId: s.id,
        approvalAction: 'final_delivery',
        buttons: [
          { id: 'view_my_photos', label: '📷 Мои фотографии', url: myPhotosUrl, color: '#f59e0b' },
          { id: 'download_photo', label: '📥 Скачать фотографию', url: downloadUrl, color: '#6b7280' },
        ],
      },
    });
    const msgRow = await db.queryOne<BroadcastableMessage>(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content, metadata, attachment_url)
       VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3, $4) RETURNING *`,
      [s.chat_session_id, text, metadata, photoUrl]
    );
    try {
      const io2 = getIO(req);
      if (io2 && msgRow) {
        await broadcastChatMessage({ sessionId: s.chat_session_id!, message: msgRow });
      }
    } catch (err) { logger.warn('[photo-review] chat notify error', { error: String(err) }); }

    // Omnichannel delivery (Telegram/VK/Max)
    if (msgRow) {
      const omniBaseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
      deliverToExternalChannel({
        chatSessionId: s.chat_session_id!,
        text: `✅ Отличный выбор! Ваша фотография готова.\n\nСкачайте её в разделе «Мои фотографии».`,
        buttonLabel: '📷 Мои фотографии',
        url: `${omniBaseUrl}/user-profile/my-photos`,
        sourceMessageId: String(msgRow['id']),
      }).catch(err => logger.warn('[photo-review] omnichannel approve error', { error: String(err) }));
    }
  }

  // 6. Persistent notification → photographer + operator
  await notifyEmployee(s,
    '📥 Скачать и распечатать',
    `${s.client_name || 'Клиент'} выбрал финальный вариант. Скачайте и распечатайте.`,
    'final_selected',
  );

  // 7. Web Push to visitor
  if (s.chat_session_id) {
    sendVisitorChatPush(s.chat_session_id, {
      title: 'Фото одобрено!',
      body: 'Скачайте в разделе «Мои фотографии»',
      tag: `approval-approved-${s.id}`,
      url: '/user-profile/my-photos',
    }).catch(err => logger.warn('[photo-review] visitor push approve error', { error: String(err) }));
  }

  res.json({ success: true, completed: true });
});

/**
 * POST /api/photo-review/:token/photos/:photoId/reject
 */
router.post('/:token/photos/:photoId/reject', validateToken, async (req: ReviewRequest, res: Response) => {
  const { photoId } = req.params;
  const { reason } = req.body;
  const s = req.approvalSession!;

  const result = await db.queryOne<IdOnly>(
    `UPDATE photo_approvals SET status = 'rejected', comment = $2, rejected_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND approval_session_id = $3 RETURNING id`,
    [photoId, reason || null, s.id]
  );

  if (!result) { throw new AppError(404, 'Photo not found'); }

  await updateSessionCounters(s.id);
  emitApprovalEvent(req, s, 'rejected', photoId);
  await insertChatNotification(req, s, reason || null);

  // Persistent notification → photographer + operator
  const reasonSnippet = typeof reason === 'string' && reason ? `: ${reason.slice(0, 80)}` : '';
  await notifyEmployee(s,
    '✏️ Требуется доработка',
    `${s.client_name || 'Клиент'} запросил доработку${reasonSnippet}`,
    'revision_requested',
  );

  // Вернуть связанную задачу ретуши в работу + сбросить обратный отсчёт на карточке заказа.
  // Идемпотентно: сработает только пока задача в статусе 'waiting'.
  const revision = await markRetouchRevision({
    approvalSessionId: s.id,
    reason: typeof reason === 'string' ? reason : null,
    changedBy: null,
  });
  if (revision) {
    const io = getIO(req);
    io?.to('employee:dashboard').emit('retouch:revision_requested', {
      taskId: revision.taskId,
      reason: typeof reason === 'string' ? reason : null,
    });
  }

  res.json({ success: true });
});

/**
 * POST /api/photo-review/:token/photos/:photoId/comment
 */
router.post('/:token/photos/:photoId/comment', validateToken, async (req: ReviewRequest, res: Response) => {
  const { photoId } = req.params;
  const { comment } = req.body;
  const s = req.approvalSession!;

  if (!comment) { throw new AppError(400, 'comment is required'); }

  const annotation = JSON.stringify({ comment, type: 'text' });
  const result = await db.queryOne<IdOnly>(
    `INSERT INTO photo_approval_annotations (approval_id, annotation)
     SELECT $1, $2::jsonb FROM photo_approvals WHERE id = $1 AND approval_session_id = $3
     RETURNING id`,
    [photoId, annotation, s.id]
  );

  if (!result) { throw new AppError(404, 'Photo not found'); }

  emitApprovalEvent(req, s, 'commented', photoId);
  res.json({ success: true, annotationId: result.id });
});

/**
 * POST /api/photo-review/:token/approve-all
 */
router.post('/:token/approve-all', validateToken, async (req: ReviewRequest, res: Response) => {
  const s = req.approvalSession!;

  const result = await db.query<IdOnly>(
    `UPDATE photo_approvals SET status = 'approved', approved_at = NOW(), updated_at = NOW()
     WHERE approval_session_id = $1 AND status IN ('pending', 'changes_requested') RETURNING id`,
    [s.id]
  );

  await db.query(
    `UPDATE photo_approval_sessions SET approved_count = total_photos, status = 'approved',
       completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [s.id]
  );
  await syncOrderStatusForApproval({ sessionId: s.id, trigger: 'reviewed' });

  emitApprovalEvent(req, s, 'all_approved');
  res.json({ success: true, approvedCount: result.length });
});

/**
 * POST /api/photo-review/:token/complete
 */
router.post('/:token/complete', validateToken, async (req: ReviewRequest, res: Response) => {
  const s = req.approvalSession!;

  // Idempotency: if session is already in a terminal state — return success without side-effects
  if (['approved', 'completed', 'partially_approved'].includes(s.status)) {
    res.json({ success: true, status: s.status, idempotent: true });
    return;
  }

  const stats = await db.queryOne<ApprovalStatsRow>(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'approved') as approved,
            COUNT(*) FILTER (WHERE status = 'rejected') as rejected
     FROM photo_approvals WHERE approval_session_id = $1`,
    [s.id]
  );

  const total = parseInt(stats?.total || '0');
  const approved = parseInt(stats?.approved || '0');
  let finalStatus = 'completed';
  if (approved === total && total > 0) finalStatus = 'approved';
  else if (approved > 0) finalStatus = 'partially_approved';
  else finalStatus = 'changes_requested';

  await db.query(
    `UPDATE photo_approval_sessions SET status = $2, completed_at = NOW(), updated_at = NOW(),
       approved_count = $3, rejected_count = $4,
       download_expires_at = CASE WHEN $2 IN ('approved', 'partially_approved') THEN NOW() + INTERVAL '30 days' ELSE download_expires_at END
     WHERE id = $1`,
    [s.id, finalStatus, approved, parseInt(stats?.rejected || '0')]
  );
  await syncOrderStatusForApproval({ sessionId: s.id, trigger: 'reviewed' });

  try {
    const io = getIO(req);
    if (io) {
      io.to('admin:visitor-chats').emit('approval:session-completed', {
        sessionId: s.id, clientName: s.client_name, title: s.title,
        status: finalStatus, approved, total,
      });
    }
  } catch (_e) { /* */ }

  // Notify chat: approved → link to "Мои фотографии"
  if (s.chat_session_id && (finalStatus === 'approved' || finalStatus === 'partially_approved')) {
    const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
    const myPhotosUrl = `${baseUrl}/user-profile/my-photos`;
    const approvedText = approved === total
      ? `✅ Все ${approved} фото одобрены!\n\nВы всегда можете скачать свои фотографии в разделе «Мои фотографии».`
      : `✅ ${approved} из ${total} фото одобрены.\n\nВы всегда можете скачать свои фотографии в разделе «Мои фотографии».`;
    const approvedMeta = JSON.stringify({
      interactive: {
        type: 'buttons',
        sessionId: s.id,
        approvalAction: 'final_delivery',
        buttons: [
          { id: 'view_my_photos', label: '📷 Мои фотографии', url: myPhotosUrl, color: '#f59e0b' },
        ],
      },
    });
    const approvedMsg = await db.queryOne<BroadcastableMessage>(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content, metadata)
       VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3) RETURNING *`,
      [s.chat_session_id, approvedText, approvedMeta]
    );
    try {
      const ioApproved = getIO(req);
      if (ioApproved && approvedMsg) {
        await broadcastChatMessage({ sessionId: s.chat_session_id!, message: approvedMsg });
      }
    } catch (_e) { /* */ }

    // Omnichannel delivery (Telegram/VK/Max)
    if (approvedMsg) {
      deliverToExternalChannel({
        chatSessionId: s.chat_session_id!,
        text: approvedText,
        buttonLabel: '📷 Мои фотографии',
        url: myPhotosUrl,
        sourceMessageId: String(approvedMsg['id']),
      }).catch(err => logger.warn('[photo-review] omnichannel complete-approved error', { error: String(err) }));
    }
  }

  // Notify chat if there are rejected photos
  if (s.chat_session_id && (finalStatus === 'changes_requested' || finalStatus === 'partially_approved')) {
    const rejectedPhotos = await db.query<RejectedPhotoRow>(
      `SELECT id, comment FROM photo_approvals WHERE approval_session_id = $1 AND status = 'rejected'`,
      [s.id]
    );
    if (rejectedPhotos.length > 0) {
      const baseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
      const reviewUrl = `${baseUrl}/photo-review/${s.public_token}`;
      const reasons = rejectedPhotos.filter(p => p.comment).map(p => `• ${p.comment}`).join('\n');
      const text = `✏️ Результат проверки: ${rejectedPhotos.length} фото на доработку${reasons ? `\n\n${reasons}` : ''}\n\nОткрыть согласование:`;
      const metadata = JSON.stringify({
        interactive: {
          type: 'buttons',
          buttons: [
            { id: 'view_approval', label: '📷 Открыть ретушь', url: reviewUrl, color: '#f59e0b' },
          ],
        },
      });
      const msgRow = await db.queryOne<BroadcastableMessage>(
        `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content, metadata)
         VALUES ($1, 'bot', 'Своё Фото', 'interactive', $2, $3) RETURNING *`,
        [s.chat_session_id, text, metadata]
      );
      try {
        const io2 = getIO(req);
        if (io2 && msgRow) {
          await broadcastChatMessage({ sessionId: s.chat_session_id!, message: msgRow });
        }
      } catch (_e) { /* */ }

      // Omnichannel delivery (Telegram/VK/Max)
      if (msgRow) {
        const omniBaseUrl = process.env['BASE_URL'] || 'https://svoefoto.ru';
        deliverToExternalChannel({
          chatSessionId: s.chat_session_id!,
          text,
          buttonLabel: '📷 Открыть ретушь',
          url: `${omniBaseUrl}/photo-review/${s.public_token}`,
          sourceMessageId: String(msgRow['id']),
        }).catch(err => logger.warn('[photo-review] omnichannel complete-rejected error', { error: String(err) }));
      }
    }
  }

  // Persistent notification → photographer + operator
  if (finalStatus === 'approved') {
    await notifyEmployee(s,
      '📥 Скачать и распечатать',
      `${s.client_name || 'Клиент'} одобрил все ${approved} фото. Скачайте и распечатайте.`,
      'final_selected',
    );
  } else if (finalStatus === 'changes_requested' || finalStatus === 'partially_approved') {
    const rejected = total - approved;
    await notifyEmployee(s,
      '✏️ Требуется доработка',
      `${s.client_name || 'Клиент'}: ${rejected} из ${total} фото на доработку`,
      'revision_requested',
    );
  }

  // Web Push to visitor (if approved or partially approved)
  if (s.chat_session_id && (finalStatus === 'approved' || finalStatus === 'partially_approved')) {
    sendVisitorChatPush(s.chat_session_id, {
      title: approved === total ? 'Все фото одобрены!' : `${approved} из ${total} фото одобрены`,
      body: 'Скачайте в разделе «Мои фотографии»',
      tag: `approval-complete-${s.id}`,
      url: '/user-profile/my-photos',
    }).catch(err => logger.warn('[photo-review] visitor push error', { error: String(err) }));
  }

  res.json({ success: true, status: finalStatus });
});

/**
 * POST /api/photo-review/:token/photos/:photoId/select-variant
 * Client selects a specific variant
 */
router.post('/:token/photos/:photoId/select-variant', validateToken, async (req: ReviewRequest, res: Response) => {
  const { photoId } = req.params;
  const { variantId } = req.body;
  const s = req.approvalSession!;

  if (!variantId) { throw new AppError(400, 'variantId is required'); }

  // Verify variant belongs to this photo
  const variant = await db.queryOne<VariantSelectionRow>(
    `SELECT v.id, v.label FROM photo_approval_variants v
     JOIN photo_approvals pa ON v.approval_id = pa.id
     WHERE v.id = $1 AND pa.id = $2 AND pa.approval_session_id = $3`,
    [variantId, photoId, s.id]
  );

  if (!variant) { throw new AppError(404, 'Variant not found'); }

  // Deselect all variants for this photo, select the chosen one
  await db.query(
    `UPDATE photo_approval_variants SET is_selected = FALSE, selected_at = NULL WHERE approval_id = $1`,
    [photoId]
  );
  await db.query(
    `UPDATE photo_approval_variants SET is_selected = TRUE, selected_at = NOW() WHERE id = $1`,
    [variantId]
  );

  // Update approval record
  await db.query(
    `UPDATE photo_approvals SET selected_variant_id = $1, updated_at = NOW() WHERE id = $2`,
    [variantId, photoId]
  );

  // Emit WS event
  try {
    const io = getIO(req);
    if (io) {
      io.to('admin:visitor-chats').emit('approval:variant-selected', {
        sessionId: s.id,
        photoId,
        variantId,
        label: variant.label,
        clientName: s.client_name,
      });
    }
  } catch (_e) { /* */ }

  emitApprovalEvent(req, s, 'variant_selected', photoId);
  res.json({ success: true });
});

/**
 * POST /api/photo-review/:token/photos/:photoId/annotate
 * Client adds a visual annotation (pin on photo)
 */
router.post('/:token/photos/:photoId/annotate', validateToken, async (req: ReviewRequest, res: Response) => {
  const { photoId } = req.params;
  const { x, y, comment } = req.body;
  const s = req.approvalSession!;

  if (x == null || y == null) {
    throw new AppError(400, 'x and y coordinates are required');
  }

  const annotation = JSON.stringify({ x, y, comment: comment || '', type: 'pin' });
  const result = await db.queryOne<IdOnly>(
    `INSERT INTO photo_approval_annotations (approval_id, annotation)
     SELECT $1, $2::jsonb FROM photo_approvals WHERE id = $1 AND approval_session_id = $3
     RETURNING id`,
    [photoId, annotation, s.id]
  );

  if (!result) { throw new AppError(404, 'Photo not found'); }

  // Emit real-time
  try {
    const io = getIO(req);
    if (io) {
      io.to('admin:visitor-chats').emit('approval:annotation-added', {
        sessionId: s.id, photoId, annotationId: result.id,
        x, y, comment, clientName: s.client_name,
      });
    }
  } catch (_e) { /* */ }

  res.json({ success: true, annotationId: result.id });
});

/**
 * POST /api/photo-review/:token/feedback
 * Public: client NPS feedback after completing review (no validateToken — session is already completed)
 */
router.post('/:token/feedback', async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rating, comment } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    throw new AppError(400, 'rating must be 1-5');
  }

  const sanitizedComment = (comment && typeof comment === 'string')
    ? comment.trim().slice(0, 2000) || null
    : null;

  const session = await db.queryOne<Pick<PhotoApprovalSessions, 'id' | 'client_name' | 'client_phone'>>(
    `SELECT id, client_name, client_phone FROM photo_approval_sessions WHERE public_token = $1`,
    [token]
  );
  if (!session) throw new AppError(404, 'Session not found');

  // Idempotent: skip if already submitted for this session
  const existing = await db.queryOne<Pick<CustomerFeedback, 'id'>>(
    `SELECT id FROM customer_feedback WHERE entity_type = 'photo_approval_session' AND entity_id = $1`,
    [session.id]
  );
  if (existing) {
    res.json({ success: true, duplicate: true });
    return;
  }

  await db.query(
    `INSERT INTO customer_feedback (client_name, client_phone, rating, source, entity_type, entity_id, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [session.client_name, session.client_phone, rating, 'photo_review_nps', 'photo_approval_session', session.id, sanitizedComment]
  );

  res.json({ success: true });
});

/**
 * GET /api/photo-review/:token/download
 * Public: returns presigned S3 URLs for approved/completed session photos.
 * No auth required — public_token (192-bit entropy) is the access credential.
 * Respects download_expires_at TTL (30 days from approval).
 */
router.get('/:token/download', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length < 10) {
    throw new AppError(400, 'Invalid token');
  }

  const session = await db.queryOne<Pick<PhotoApprovalSessions, 'id' | 'status' | 'download_expires_at' | 'title'>>(
    `SELECT id, status, download_expires_at, title
     FROM photo_approval_sessions WHERE public_token = $1`,
    [token]
  );

  if (!session) {
    throw new AppError(404, 'Session not found');
  }

  if (!['approved', 'completed'].includes(session.status ?? '')) {
    throw new AppError(400, 'Photos are not yet approved');
  }

  if (session.download_expires_at && new Date(session.download_expires_at) < new Date()) {
    throw new AppError(410, 'Download link has expired');
  }

  // Audit: log download access
  db.query(
    `INSERT INTO photo_access_audit (approval_session_id, accessed_by_role, access_type, access_method, ip_address, user_agent)
     VALUES ($1, 'anonymous', 'download', 'public_token', $2, $3)`,
    [session.id, req.ip, req.headers['user-agent'] ?? null]
  ).catch(err => logger.warn('[photo-review] audit download insert error', { error: String(err) }));

  const photos = await db.query<Pick<PhotoApprovals, 'id' | 'retouched_photo_url' | 'thumbnail_url' | 'original_photo_url' | 'status'>>(
    `SELECT id, retouched_photo_url, thumbnail_url, original_photo_url, status
     FROM photo_approvals
     WHERE approval_session_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [session.id]
  );

  if (photos.length === 0) {
    throw new AppError(404, 'No approved photos found');
  }

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

export default router;
