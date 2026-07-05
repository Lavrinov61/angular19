import { pool } from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { generateThumbnail } from './approval-thumbnail.service.js';
import { storageService } from './storage.service.js';
import { createLogger } from '../utils/logger.js';
import type PhotoApprovalSessions from '../types/generated/public/PhotoApprovalSessions.js';

const log = createLogger('approval-original');

export interface ApprovalOriginalResult {
  url: string;
  thumbnailUrl: string | null;
}

export async function saveApprovalOriginalFromUrl(
  sessionId: string,
  photoUrl: string,
): Promise<ApprovalOriginalResult> {
  const key = storageService.keyFromUrl(photoUrl);
  if (!key) {
    throw new AppError(400, 'photo_url must be from our storage');
  }

  const session = await pool.query<Pick<PhotoApprovalSessions, 'id'>>(
    'SELECT id FROM photo_approval_sessions WHERE id = $1 AND deleted_at IS NULL',
    [sessionId],
  );
  if (session.rows.length === 0) {
    throw new AppError(404, 'Session not found');
  }

  let thumbnailUrl: string | null = null;
  try {
    const { buffer } = await storageService.downloadToBuffer(key);
    const thumb = await generateThumbnail(buffer);
    thumbnailUrl = thumb.thumbnailUrl;
  } catch (error) {
    log.error('[PhotoApprovals] original thumbnail generation failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await pool.query(
    `UPDATE photo_approval_sessions
     SET original_photo_url = $1, original_thumbnail_url = $2, updated_at = NOW()
     WHERE id = $3`,
    [photoUrl, thumbnailUrl, sessionId],
  );
  await pool.query(
    `UPDATE photo_approvals
     SET original_photo_url = $1, original_thumbnail_url = $2
     WHERE approval_session_id = $3 AND original_photo_url IS NULL`,
    [photoUrl, thumbnailUrl, sessionId],
  );

  return { url: photoUrl, thumbnailUrl };
}
