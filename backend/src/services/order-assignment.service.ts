import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';

// ─── TYPES ────────────────────────────────────────────

export interface OrderAssignment {
  id: string;
  order_id: string;
  order_type: 'print' | 'retouch' | 'photo' | 'marketplace' | 'scan' | 'design' | 'other';
  order_summary: string | null;
  source: 'online' | 'pos' | 'chat' | 'phone' | 'walk_in';
  studio_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  deadline_at: string | null;
  estimated_minutes: number | null;
  status: 'pending' | 'in_progress' | 'help_needed' | 'completed' | 'cancelled';
  completed_at: string | null;
  help_request: string | null;
  help_requested_at: string | null;
  helpers: string[];
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // JOIN fields
  employee_name?: string;
  studio_name?: string;
}

// ─── FUNCTIONS ────────────────────────────────────────

export async function createAssignment(data: {
  order_id: string;
  order_type: OrderAssignment['order_type'];
  order_summary?: string;
  source?: OrderAssignment['source'];
  studio_id?: string;
  deadline_at?: string;
  estimated_minutes?: number;
  priority?: number;
  metadata?: Record<string, unknown>;
}): Promise<OrderAssignment> {
  const result = await db.queryOne<OrderAssignment>(
    `INSERT INTO order_assignments
       (order_id, order_type, order_summary, source, studio_id,
        deadline_at, estimated_minutes, priority, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.order_id,
      data.order_type,
      data.order_summary ?? null,
      data.source ?? 'online',
      data.studio_id ?? null,
      data.deadline_at ?? null,
      data.estimated_minutes ?? null,
      data.priority ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  );
  if (!result) throw new AppError(500, 'Failed to create assignment');
  return result;
}

export async function takeOrder(assignmentId: string, employeeId: string): Promise<OrderAssignment> {
  const result = await db.queryOne<OrderAssignment>(
    `UPDATE order_assignments
     SET assigned_to = $2, assigned_at = NOW(), status = 'in_progress', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [assignmentId, employeeId]
  );
  if (!result) throw new AppError(409, 'Задание уже взято или не найдено');
  return result;
}

export async function completeOrder(assignmentId: string, employeeId: string): Promise<OrderAssignment> {
  const result = await db.queryOne<OrderAssignment>(
    `UPDATE order_assignments
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND assigned_to = $2 AND status IN ('in_progress','help_needed')
     RETURNING *`,
    [assignmentId, employeeId]
  );
  if (!result) throw new AppError(404, 'Задание не найдено или не ваше');
  return result;
}

export async function requestHelp(assignmentId: string, employeeId: string, message: string): Promise<void> {
  const result = await db.queryOne<{ id: string }>(
    `UPDATE order_assignments
     SET status = 'help_needed', help_request = $3, help_requested_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND assigned_to = $2 AND status = 'in_progress'
     RETURNING id`,
    [assignmentId, employeeId, message]
  );
  if (!result) throw new AppError(404, 'Задание не найдено или не ваше');
}

export async function joinOrder(assignmentId: string, helperId: string): Promise<void> {
  const result = await db.queryOne<{ id: string }>(
    `UPDATE order_assignments
     SET helpers = array_append(helpers, $2::uuid), updated_at = NOW()
     WHERE id = $1 AND status = 'help_needed'
       AND NOT ($2::uuid = ANY(helpers))
     RETURNING id`,
    [assignmentId, helperId]
  );
  if (!result) throw new AppError(409, 'Задание не требует помощи или вы уже присоединились');
}

export async function getPendingOrders(studioId?: string): Promise<OrderAssignment[]> {
  return db.query<OrderAssignment>(
    `SELECT oa.*,
            u.display_name as employee_name,
            s.name as studio_name
     FROM order_assignments oa
     LEFT JOIN users u ON oa.assigned_to = u.id
     LEFT JOIN studios s ON oa.studio_id = s.id
     WHERE oa.status IN ('pending','help_needed')
       ${studioId ? 'AND oa.studio_id = $1' : ''}
     ORDER BY oa.priority DESC, oa.deadline_at ASC NULLS LAST, oa.created_at ASC`,
    studioId ? [studioId] : []
  );
}

export async function getMyOrders(employeeId: string): Promise<OrderAssignment[]> {
  return db.query<OrderAssignment>(
    `SELECT oa.*, s.name as studio_name
     FROM order_assignments oa
     LEFT JOIN studios s ON oa.studio_id = s.id
     WHERE oa.assigned_to = $1
       AND oa.status IN ('in_progress','help_needed')
     ORDER BY oa.deadline_at ASC NULLS LAST, oa.created_at ASC`,
    [employeeId]
  );
}

export async function cancelAssignment(assignmentId: string): Promise<void> {
  await db.query(
    `UPDATE order_assignments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [assignmentId]
  );
}
