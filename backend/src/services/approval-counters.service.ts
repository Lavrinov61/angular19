import { pool } from '../database/db.js';
import db from '../database/db.js';
import type { PhotoStatusRow } from '../types/views/approval-views.js';
import { syncOrderStatusForApproval } from './order-status.service.js';

/** Пересчитать счётчики и статус сессии согласования */
export async function updateSessionCounters(sessionId: string): Promise<void> {
  const stats = await db.queryOne<{ total: string; approved: string; pending: string }>(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'approved') as approved,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
     FROM photo_approvals WHERE approval_session_id = $1`,
    [sessionId]
  );
  const total = parseInt(stats?.total || '0');
  const approved = parseInt(stats?.approved || '0');
  const pending = parseInt(stats?.pending || '0');

  let status = 'in_review';
  if (approved === total && total > 0) status = 'approved';
  else if (pending === 0 && approved > 0) status = 'partially_approved';
  else if (pending === 0 && approved === 0) status = 'changes_requested';

  await db.query(
    `UPDATE photo_approval_sessions SET status = $2, approved_count = $3,
       rejected_count = (SELECT COUNT(*) FROM photo_approvals WHERE approval_session_id = $1 AND status = 'rejected'),
       updated_at = NOW() WHERE id = $1`,
    [sessionId, status, approved]
  );

  // Подтянуть статус заказа под ответ клиента: одобрил → «Завершён», правки → «В работе».
  // Никогда не бросает — сбой синка не должен ломать пересчёт согласования.
  await syncOrderStatusForApproval({ sessionId, trigger: 'reviewed' });
}

/** Load photo statuses for a session (used by WS broadcast after review actions). */
export async function loadPhotoStatuses(sessionId: string): Promise<PhotoStatusRow[]> {
  return db.query<PhotoStatusRow>(
    `SELECT id, status, thumbnail_url
     FROM photo_approvals
     WHERE approval_session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  );
}

/** Привязать approval-сессии к клиенту по номеру телефона (нормализация: последние 10 цифр) */
export async function linkApprovalSessionsByPhone(userId: string, phone: string): Promise<number> {
  if (!phone) return 0;
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length < 10) return 0;

  const result = await pool.query(
    `UPDATE photo_approval_sessions SET client_id = $1, updated_at = NOW()
     WHERE RIGHT(REGEXP_REPLACE(client_phone, '\\D', '', 'g'), 10) = $2
       AND client_id IS NULL
     RETURNING id`,
    [userId, last10]
  );
  if (result.rowCount && result.rowCount > 0) {
    await pool.query(
      `UPDATE photo_approvals pa SET client_id = $1
       FROM photo_approval_sessions pas
       WHERE pa.approval_session_id = pas.id
         AND RIGHT(REGEXP_REPLACE(pas.client_phone, '\\D', '', 'g'), 10) = $2
         AND pa.client_id IS NULL`,
      [userId, last10]
    );
  }
  return result.rowCount ?? 0;
}
