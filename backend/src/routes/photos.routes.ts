import express, { Response } from 'express';
import { pool } from '../database/db.js';
import db from '../database/db.js';
import { authenticateToken, AuthRequest, requireUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { storageService } from '../services/storage.service.js';
import type PhotoSessions from '../types/generated/public/PhotoSessions.js';
import type PhotoApprovalSessions from '../types/generated/public/PhotoApprovalSessions.js';
import type { ClassicPhotoDownloadRow, ApprovalPhotoDownloadRow, DownloadablePhotoRow } from '../types/views/approval-views.js';

/** Unified client session row returned by GET /sessions (camelCase for frontend). */
interface ClientSessionRow {
  id: string;
  title: string;
  date: string;
  status: 'processing' | 'ready' | 'delivered';
  photoCount: number;
  thumbnailUrl: string | null;
  sessionType: string;
  photographer: string;
  clientId: string;
  createdAt: string;
  updatedAt: string;
}

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get client photo sessions (UNION: photo_sessions + delivered photo_approval_sessions)
router.get('/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { rows } = await pool.query<ClientSessionRow>(
    `WITH sessions AS (
       -- Classic photo sessions
       SELECT
         ps.id::text                                  AS id,
         COALESCE(ps.location, 'Фотосессия')          AS title,
         ps.date::text                                 AS date,
         CASE ps.status
           WHEN 'pending'    THEN 'processing'
           WHEN 'processing' THEN 'processing'
           WHEN 'ready'      THEN 'ready'
           WHEN 'delivered'  THEN 'delivered'
           ELSE 'processing'
         END                                           AS status,
         (SELECT COUNT(*)::int FROM photos p WHERE p.session_id = ps.id) AS "photoCount",
         NULL::text                                    AS "thumbnailUrl",
         'session'                                     AS "sessionType",
         COALESCE(u.display_name, 'Фотограф')         AS photographer,
         ps.client_id::text                            AS "clientId",
         ps.created_at::text                           AS "createdAt",
         ps.updated_at::text                           AS "updatedAt"
       FROM photo_sessions ps
       LEFT JOIN photographers ph ON ps.photographer_id = ph.id
       LEFT JOIN users u ON ph.user_id = u.id
       WHERE ps.client_id = $1

       UNION ALL

       -- Delivered finals from approval sessions
       SELECT
         pas.id::text                                  AS id,
         COALESCE(pas.title, 'Фото')                  AS title,
         COALESCE(pas.completed_at, pas.created_at)::text AS date,
         'delivered'                                   AS status,
         COALESCE(pas.total_photos, 0)                 AS "photoCount",
         (SELECT pa.thumbnail_url
          FROM photo_approvals pa
          WHERE pa.approval_session_id = pas.id
          ORDER BY pa.created_at ASC LIMIT 1)          AS "thumbnailUrl",
         'delivery'                                    AS "sessionType",
         COALESCE(pu.display_name, 'Фотограф')        AS photographer,
         pas.client_id::text                           AS "clientId",
         pas.created_at::text                          AS "createdAt",
         pas.updated_at::text                          AS "updatedAt"
       FROM photo_approval_sessions pas
       LEFT JOIN users pu ON pas.photographer_id = pu.id
       WHERE (pas.client_id = $1 OR pas.contact_id = (SELECT id FROM contacts WHERE user_id = $1 LIMIT 1))
         AND pas.status IN ('completed', 'approved', 'partially_approved')
     )
     SELECT * FROM sessions ORDER BY date DESC`,
    [req.user.id],
  );

  // Sign S3 thumbnail URLs
  for (const row of rows) {
    if (row.thumbnailUrl && storageService.isS3Url(row.thumbnailUrl)) {
      try { row.thumbnailUrl = await storageService.resolveSignedUrl(row.thumbnailUrl); } catch { /* keep original */ }
    }
  }

  res.json({ success: true, data: rows });
});

// Get session photos (supports both photo_sessions and photo_approval_sessions)
router.get('/sessions/:sessionId/photos', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { sessionId } = req.params;

  // Try classic photo_sessions first
  const classicSession = await db.queryOne(
    'SELECT id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (classicSession) {
    const photos = await db.query(
      `SELECT p.*, f.file_name, f.original_name, f.file_size, f.mime_type
       FROM photos p
       LEFT JOIN files f ON p.file_id = f.id
       WHERE p.session_id = $1
       ORDER BY p.uploaded_at ASC`,
      [sessionId]
    );
    res.json({ success: true, data: photos });
    return;
  }

  // Try photo_approval_sessions (delivered finals) — dual identity: client_id OR contact_id
  const approvalSession = await db.queryOne(
    `SELECT pas.id FROM photo_approval_sessions pas
     WHERE pas.id = $1
       AND pas.status IN ('completed', 'approved', 'partially_approved')
       AND (pas.client_id = $2 OR pas.contact_id = (SELECT id FROM contacts WHERE user_id = $2 LIMIT 1))`,
    [sessionId, req.user.id]
  );

  if (!approvalSession) {
    throw new AppError(403, 'You do not have permission to view these photos');
  }

  // Return retouched photos: all for 'completed' sessions, only approved for 'approved'
  const { rows } = await pool.query(
    `SELECT
       pa.id,
       pa.approval_session_id AS "sessionId",
       pa.retouched_photo_url AS "originalUrl",
       pa.retouched_photo_url AS "processedUrl",
       COALESCE(pa.thumbnail_url, pa.retouched_photo_url) AS "thumbnailUrl",
       pa.status,
       pa.created_at AS "uploadedAt"
     FROM photo_approvals pa
     JOIN photo_approval_sessions pas ON pas.id = pa.approval_session_id
     WHERE pa.approval_session_id = $1
       AND (pas.status = 'completed' OR pa.status = 'approved')
     ORDER BY pa.created_at ASC`,
    [sessionId]
  );

  // Sign S3 URLs (camelCase fields)
  for (const row of rows) {
    for (const field of ['originalUrl', 'processedUrl', 'thumbnailUrl'] as const) {
      if (row[field] && storageService.isS3Url(row[field])) {
        try { row[field] = await storageService.resolveSignedUrl(row[field]); } catch { /* keep original */ }
      }
    }
  }

  res.json({ success: true, data: rows });
});

// Get download URLs for session photos (signed S3 links)
router.get('/sessions/:sessionId/download', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { sessionId } = req.params;

  // Try classic photo_sessions first
  const classicSession = await db.queryOne(
    'SELECT id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (classicSession) {
    const photos = await pool.query<ClassicPhotoDownloadRow>(
      `SELECT p.id, p.file_url, f.original_name
       FROM photos p
       LEFT JOIN files f ON p.file_id = f.id
       WHERE p.session_id = $1
       ORDER BY p.uploaded_at ASC`,
      [sessionId]
    );

    const downloadPhotos: DownloadablePhotoRow[] = [];
    for (const row of photos.rows) {
      let url = row.file_url;
      if (url && storageService.isS3Url(url)) {
        try { url = await storageService.resolveSignedUrl(url); } catch { /* keep original */ }
      }
      downloadPhotos.push({
        id: row.id,
        url,
        file_name: row.original_name || `photo-${row.id}.jpg`,
      });
    }

    res.json({ success: true, data: { photos: downloadPhotos } });
    return;
  }

  // Try photo_approval_sessions
  const approvalSession = await db.queryOne(
    `SELECT id FROM photo_approval_sessions WHERE id = $1
       AND (client_id = $2 OR contact_id = (SELECT id FROM contacts WHERE user_id = $2 LIMIT 1))
       AND status IN ('completed', 'approved', 'partially_approved')`,
    [sessionId, req.user.id]
  );

  if (!approvalSession) {
    throw new AppError(403, 'You do not have permission to download these photos');
  }

  const { rows } = await pool.query<ApprovalPhotoDownloadRow>(
    `SELECT pa.id, pa.retouched_photo_url,
            COALESCE(pas.title, 'photo') AS title
     FROM photo_approvals pa
     JOIN photo_approval_sessions pas ON pas.id = pa.approval_session_id
     WHERE pa.approval_session_id = $1
       AND (pas.status = 'completed' OR pa.status = 'approved')
     ORDER BY pa.created_at ASC`,
    [sessionId]
  );

  const downloadPhotos: DownloadablePhotoRow[] = [];
  for (const row of rows) {
    let url = row.retouched_photo_url || '';
    if (url && storageService.isS3Url(url)) {
      try { url = await storageService.resolveSignedUrl(url); } catch { /* keep original */ }
    }
    downloadPhotos.push({
      id: row.id,
      url,
      file_name: `${row.title || 'photo'}-${row.id.slice(0, 8)}.jpg`,
    });
  }

  res.json({ success: true, data: { photos: downloadPhotos } });
});

// Toggle photo selection
router.put('/:photoId/select', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { photoId } = req.params;
  const { selected } = req.body;

  if (selected === undefined) {
    throw new AppError(400, 'Selected field is required');
  }

  // Verify photo belongs to user's session
  const photo = await db.queryOne(
    `SELECT p.id FROM photos p
     JOIN photo_sessions ps ON p.session_id = ps.id
     WHERE p.id = $1 AND ps.client_id = $2`,
    [photoId, req.user.id]
  );

  if (!photo) {
    throw new AppError(403, 'You do not have permission to modify this photo');
  }

  const updated = await db.queryOne(
    'UPDATE photos SET selected = $1 WHERE id = $2 RETURNING *',
    [selected, photoId]
  );

  res.json({ success: true, data: updated });
});

// =============================================================================
// DOWNLOAD SELECTED PHOTOS
// =============================================================================

// Download only selected photos from a session (signed S3 links)
router.get('/sessions/:sessionId/download-selected', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { sessionId } = req.params;

  // Verify session belongs to user
  const session = await db.queryOne(
    'SELECT id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (!session) {
    throw new AppError(403, 'You do not have permission to download these photos');
  }

  const photos = await pool.query<ClassicPhotoDownloadRow & { selected: boolean }>(
    `SELECT p.id, p.file_url, f.original_name
     FROM photos p
     LEFT JOIN files f ON p.file_id = f.id
     WHERE p.session_id = $1 AND p.selected = true
     ORDER BY p.uploaded_at ASC`,
    [sessionId]
  );

  const downloadPhotos: DownloadablePhotoRow[] = [];
  for (const row of photos.rows) {
    let url = row.file_url;
    if (url && storageService.isS3Url(url)) {
      try { url = await storageService.resolveSignedUrl(url); } catch { /* keep original */ }
    }
    downloadPhotos.push({
      id: row.id,
      url,
      file_name: row.original_name || `photo-${row.id}.jpg`,
    });
  }

  res.json({ success: true, data: { photos: downloadPhotos } });
});

// =============================================================================
// PHOTO STATS
// =============================================================================

// Get photo statistics for authenticated client
router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { rows } = await pool.query<{
    totalSessions: string;
    totalPhotos: string;
    selectedPhotos: string;
    deliveredSessions: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM photo_sessions WHERE client_id = $1) AS "totalSessions",
       (SELECT COUNT(*)::text FROM photos p JOIN photo_sessions ps ON p.session_id = ps.id WHERE ps.client_id = $1) AS "totalPhotos",
       (SELECT COUNT(*)::text FROM photos p JOIN photo_sessions ps ON p.session_id = ps.id WHERE ps.client_id = $1 AND p.selected = true) AS "selectedPhotos",
       (SELECT COUNT(*)::text FROM photo_sessions WHERE client_id = $1 AND status = 'delivered') AS "deliveredSessions"`,
    [req.user.id]
  );

  const stats = rows[0] || { totalSessions: '0', totalPhotos: '0', selectedPhotos: '0', deliveredSessions: '0' };

  res.json({
    success: true,
    data: {
      totalSessions: parseInt(stats.totalSessions),
      totalPhotos: parseInt(stats.totalPhotos),
      selectedPhotos: parseInt(stats.selectedPhotos),
      deliveredSessions: parseInt(stats.deliveredSessions),
    },
  });
});

// =============================================================================
// PHOTO FEEDBACK (per-photo rating + preferences)
// =============================================================================

// Save feedback for a specific photo
router.post('/:photoId/feedback', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { photoId } = req.params;
  const { rating, comment, preferences } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    throw new AppError(400, 'rating must be 1-5');
  }

  // Verify photo belongs to user's session
  const photo = await db.queryOne<{ id: string; session_id: string }>(
    `SELECT p.id, p.session_id FROM photos p
     JOIN photo_sessions ps ON p.session_id = ps.id
     WHERE p.id = $1 AND ps.client_id = $2`,
    [photoId, req.user.id]
  );

  if (!photo) {
    throw new AppError(403, 'You do not have permission to leave feedback on this photo');
  }

  // Store feedback in photo metadata
  await db.query(
    `UPDATE photos SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{feedback}',
       $2::jsonb
     ) WHERE id = $1`,
    [photoId, JSON.stringify({ rating, comment: comment || null, preferences: preferences || [], createdAt: new Date().toISOString() })]
  );

  res.json({ success: true });
});

// =============================================================================
// SESSION REVIEW (feedback)
// =============================================================================

// Submit a review/feedback for a photo session
router.post('/sessions/:sessionId/review', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { sessionId } = req.params;
  const { rating, comment } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    throw new AppError(400, 'rating must be 1-5');
  }

  // Verify session belongs to user
  const session = await db.queryOne<{ id: string }>(
    'SELECT id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (!session) {
    throw new AppError(403, 'You do not have permission to review this session');
  }

  // Idempotent: skip if already submitted for this session
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM customer_feedback WHERE entity_type = 'photo_session' AND entity_id = $1`,
    [sessionId]
  );

  if (existing) {
    res.json({ success: true, duplicate: true });
    return;
  }

  await db.query(
    `INSERT INTO customer_feedback (client_id, rating, comment, source, entity_type, entity_id)
     VALUES ($1, $2, $3, 'session_review', 'photo_session', $4)`,
    [req.user.id, rating, comment || null, sessionId]
  );

  res.json({ success: true });
});

// =============================================================================
// REQUEST REPROCESSING
// =============================================================================

// Request reprocessing of specific photos in a session
router.post('/sessions/:sessionId/reprocess', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { sessionId } = req.params;
  const { photoIds, instructions } = req.body;

  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new AppError(400, 'photoIds array is required');
  }

  // Verify session belongs to user
  const session = await db.queryOne<{ id: string; photographer_id: string }>(
    'SELECT id, photographer_id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (!session) {
    throw new AppError(403, 'You do not have permission to request reprocessing');
  }

  // Verify all photoIds belong to this session
  const { rows: validPhotos } = await pool.query<{ id: string }>(
    'SELECT id FROM photos WHERE session_id = $1 AND id = ANY($2)',
    [sessionId, photoIds]
  );

  if (validPhotos.length !== photoIds.length) {
    throw new AppError(400, 'Some photo IDs do not belong to this session');
  }

  // Store the reprocessing request as metadata on the session
  await db.query(
    `UPDATE photo_sessions SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{reprocess_requests}',
       COALESCE(metadata->'reprocess_requests', '[]'::jsonb) || $2::jsonb
     ), updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify([{ photoIds, instructions: instructions || null, requestedAt: new Date().toISOString() }])]
  );

  res.json({ success: true });
});

// =============================================================================
// PHOTO PERMISSIONS
// =============================================================================

// Get all permissions for the authenticated user
router.get('/permissions', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const permissions = await db.query<{
    id: string; user_id: string; session_id: string | null; photo_ids: string[];
    type: string; purposes: string[]; status: string; comments: string | null;
    signature_image: string | null; signed_at: string | null;
    expires_at: string | null; granted_at: string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, user_id, session_id, photo_ids, type, purposes, status, comments,
            signature_image, signed_at, expires_at, granted_at, created_at, updated_at
     FROM permissions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );

  // Map to frontend model
  const data = permissions.map(p => ({
    id: p.id,
    userId: p.user_id,
    sessionId: p.session_id,
    photoIds: p.photo_ids,
    type: p.type,
    purposes: p.purposes,
    status: p.status,
    comments: p.comments,
    signature: p.signed_at ? { signedAt: p.signed_at, signatureImage: p.signature_image } : undefined,
    expiresAt: p.expires_at,
    createdAt: p.created_at,
  }));

  res.json({ success: true, data });
});

// Get a single permission by ID
router.get('/permissions/:permissionId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { permissionId } = req.params;

  const p = await db.queryOne<{
    id: string; user_id: string; session_id: string | null; photo_ids: string[];
    type: string; purposes: string[]; status: string; comments: string | null;
    signature_image: string | null; signed_at: string | null;
    expires_at: string | null; granted_at: string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, user_id, session_id, photo_ids, type, purposes, status, comments,
            signature_image, signed_at, expires_at, granted_at, created_at, updated_at
     FROM permissions
     WHERE id = $1 AND user_id = $2`,
    [permissionId, req.user.id]
  );

  if (!p) {
    throw new AppError(404, 'Permission not found');
  }

  res.json({
    success: true,
    data: {
      id: p.id,
      userId: p.user_id,
      sessionId: p.session_id,
      photoIds: p.photo_ids,
      type: p.type,
      purposes: p.purposes,
      status: p.status,
      comments: p.comments,
      signature: p.signed_at ? { signedAt: p.signed_at, signatureImage: p.signature_image } : undefined,
      expiresAt: p.expires_at,
      createdAt: p.created_at,
    },
  });
});

// Create a new permission
router.post('/permissions', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { sessionId, photoIds, type, purposes, expiresAt } = req.body;

  if (!type) {
    throw new AppError(400, 'type is required');
  }
  if (!Array.isArray(purposes) || purposes.length === 0) {
    throw new AppError(400, 'purposes array is required');
  }

  const result = await db.queryOne<{ id: string; created_at: string }>(
    `INSERT INTO permissions (user_id, session_id, photo_ids, type, purposes, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING id, created_at`,
    [
      req.user.id,
      sessionId || null,
      photoIds || [],
      type,
      purposes,
      expiresAt || null,
    ]
  );

  res.status(201).json({
    success: true,
    data: {
      id: result!.id,
      userId: req.user.id,
      sessionId: sessionId || null,
      photoIds: photoIds || [],
      type,
      purposes,
      status: 'pending',
      createdAt: result!.created_at,
    },
  });
});

// Update permission status
router.put('/permissions/:permissionId/status', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { permissionId } = req.params;
  const { status, comments } = req.body;

  const validStatuses = ['pending', 'approved', 'declined', 'expired', 'revoked'];
  if (!status || !validStatuses.includes(status)) {
    throw new AppError(400, `status must be one of: ${validStatuses.join(', ')}`);
  }

  const result = await db.queryOne<{ id: string; status: string; updated_at: string }>(
    `UPDATE permissions
     SET status = $1, comments = COALESCE($2, comments),
         granted_at = ${status === 'approved' ? 'NOW()' : 'granted_at'},
         updated_at = NOW()
     WHERE id = $3 AND user_id = $4
     RETURNING id, status, updated_at`,
    [status, comments || null, permissionId, req.user.id]
  );

  if (!result) {
    throw new AppError(404, 'Permission not found');
  }

  res.json({ success: true, data: result });
});

// Sign a permission (add signature)
router.post('/permissions/:permissionId/sign', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { permissionId } = req.params;
  const { signatureImage } = req.body;

  if (!signatureImage) {
    throw new AppError(400, 'signatureImage is required');
  }

  const result = await db.queryOne<{ id: string; status: string }>(
    `UPDATE permissions
     SET signature_image = $1, signed_at = NOW(), status = 'approved', granted_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING id, status`,
    [signatureImage, permissionId, req.user.id]
  );

  if (!result) {
    throw new AppError(404, 'Permission not found');
  }

  res.json({ success: true, data: result });
});

// Revoke a permission
router.post('/permissions/:permissionId/revoke', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { permissionId } = req.params;
  const { reason } = req.body;

  const result = await db.queryOne<{ id: string; status: string }>(
    `UPDATE permissions
     SET status = 'revoked', revoked_at = NOW(), revoke_reason = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND status != 'revoked'
     RETURNING id, status`,
    [reason || null, permissionId, req.user.id]
  );

  if (!result) {
    throw new AppError(404, 'Permission not found or already revoked');
  }

  res.json({ success: true, data: result });
});

// =============================================================================
// PHOTO SELECTIONS
// =============================================================================

// Get all photo selections for authenticated user
router.get('/selections', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const selections = await db.query<{
    id: string; user_id: string; session_id: string;
    selected_photo_ids: string[]; status: string;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, user_id, session_id, selected_photo_ids, status, created_at, updated_at
     FROM photo_selections
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );

  // Enrich with photo details for each selection
  const data = await Promise.all(selections.map(async (sel) => {
    let selectedPhotos: Array<{ id: string; photoId: string; thumbnailUrl: string; originalUrl: string }> = [];
    if (sel.selected_photo_ids && sel.selected_photo_ids.length > 0) {
      const photos = await db.query<{ id: string; thumbnail_url: string | null; file_url: string }>(
        `SELECT id, thumbnail_url, file_url FROM photos WHERE id = ANY($1)`,
        [sel.selected_photo_ids]
      );
      selectedPhotos = photos.map(p => ({
        id: p.id,
        photoId: p.id,
        thumbnailUrl: p.thumbnail_url || p.file_url,
        originalUrl: p.file_url,
      }));
    }

    return {
      id: sel.id,
      sessionId: sel.session_id,
      userId: sel.user_id,
      selectedPhotos,
      totalPrice: 0,
      status: sel.status,
      createdAt: sel.created_at,
      updatedAt: sel.updated_at,
    };
  }));

  res.json({ success: true, data });
});

// Get a single photo selection by ID
router.get('/selections/:selectionId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { selectionId } = req.params;

  const sel = await db.queryOne<{
    id: string; user_id: string; session_id: string;
    selected_photo_ids: string[]; status: string;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, user_id, session_id, selected_photo_ids, status, created_at, updated_at
     FROM photo_selections
     WHERE id = $1 AND user_id = $2`,
    [selectionId, req.user.id]
  );

  if (!sel) {
    throw new AppError(404, 'Selection not found');
  }

  let selectedPhotos: Array<{ id: string; photoId: string; thumbnailUrl: string; originalUrl: string }> = [];
  if (sel.selected_photo_ids && sel.selected_photo_ids.length > 0) {
    const photos = await db.query<{ id: string; thumbnail_url: string | null; file_url: string }>(
      `SELECT id, thumbnail_url, file_url FROM photos WHERE id = ANY($1)`,
      [sel.selected_photo_ids]
    );
    selectedPhotos = photos.map(p => ({
      id: p.id,
      photoId: p.id,
      thumbnailUrl: p.thumbnail_url || p.file_url,
      originalUrl: p.file_url,
    }));
  }

  res.json({
    success: true,
    data: {
      id: sel.id,
      sessionId: sel.session_id,
      userId: sel.user_id,
      selectedPhotos,
      totalPrice: 0,
      status: sel.status,
      createdAt: sel.created_at,
      updatedAt: sel.updated_at,
    },
  });
});

// Create a new photo selection
router.post('/selections', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { sessionId, selectedPhotos, status } = req.body;

  if (!sessionId) {
    throw new AppError(400, 'sessionId is required');
  }

  // Verify session belongs to user
  const session = await db.queryOne<{ id: string }>(
    'SELECT id FROM photo_sessions WHERE id = $1 AND client_id = $2',
    [sessionId, req.user.id]
  );

  if (!session) {
    throw new AppError(403, 'You do not have permission to create selections for this session');
  }

  // Extract photo IDs from selectedPhotos array
  const photoIds: string[] = Array.isArray(selectedPhotos)
    ? selectedPhotos.map((p: { photoId?: string; id?: string }) => p.photoId || p.id).filter((v: string | undefined): v is string => !!v)
    : [];

  const result = await db.queryOne<{ id: string; created_at: string; updated_at: string }>(
    `INSERT INTO photo_selections (user_id, session_id, selected_photo_ids, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at, updated_at`,
    [req.user.id, sessionId, photoIds, status || 'pending_payment']
  );

  res.status(201).json({
    success: true,
    data: {
      id: result!.id,
      sessionId,
      userId: req.user.id,
      selectedPhotos: selectedPhotos || [],
      totalPrice: 0,
      status: status || 'pending_payment',
      createdAt: result!.created_at,
      updatedAt: result!.updated_at,
    },
  });
});

// Update a photo selection
router.put('/selections/:selectionId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const { selectionId } = req.params;
  const { selectedPhotos, status } = req.body;

  // Build dynamic SET clause
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  if (selectedPhotos !== undefined) {
    const photoIds: string[] = Array.isArray(selectedPhotos)
      ? selectedPhotos.map((p: { photoId?: string; id?: string }) => p.photoId || p.id).filter((v: string | undefined): v is string => !!v)
      : [];
    sets.push(`selected_photo_ids = $${idx}`);
    params.push(photoIds);
    idx++;
  }

  if (status !== undefined) {
    sets.push(`status = $${idx}`);
    params.push(status);
    idx++;
  }

  params.push(selectionId);
  params.push(req.user.id);

  const result = await db.queryOne<{ id: string; status: string; updated_at: string }>(
    `UPDATE photo_selections SET ${sets.join(', ')}
     WHERE id = $${idx} AND user_id = $${idx + 1}
     RETURNING id, status, updated_at`,
    params
  );

  if (!result) {
    throw new AppError(404, 'Selection not found');
  }

  res.json({ success: true, data: result });
});

export default router;
