import db from '../database/db.js';

import { createLogger } from '../utils/logger.js';
interface AuditEntry {
  userId?: string;
  userName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

const logger = createLogger('audit.service');
/** Fire-and-forget audit log */
export function logAudit(entry: AuditEntry): void {
  db.query(
    `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.userId || null,
      entry.userName || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      JSON.stringify(entry.details || {}),
      entry.ip || null,
      entry.userAgent || null,
    ]
  ).catch(err => logger.error('[Audit] Failed to log:', err.message));
}

interface AuditFilters {
  userId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export async function getAuditLog(filters: AuditFilters): Promise<{ items: AuditRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.userId) {
    conditions.push(`user_id = $${idx++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`action = $${idx++}`);
    params.push(filters.action);
  }
  if (filters.entityType) {
    conditions.push(`entity_type = $${idx++}`);
    params.push(filters.entityType);
  }
  if (filters.dateFrom) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [rows, countResult] = await Promise.all([
    db.query<AuditRow>(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, details, ip, created_at
       FROM audit_log ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_log ${where}`,
      params
    ),
  ]);

  return {
    items: rows,
    total: parseInt(countResult[0]?.count || '0', 10),
  };
}
