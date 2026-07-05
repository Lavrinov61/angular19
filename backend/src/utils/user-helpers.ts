import db from '../database/db.js';

/**
 * Returns IDs of all active admin and manager users.
 * Used by escalation, notifications, and broadcast logic.
 */
export async function getAdminAndManagerIds(): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('admin', 'manager') AND status = 'active'`
  );
  return result.map(r => r.id);
}
