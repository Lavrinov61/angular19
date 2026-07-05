import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { PaginatedResponse } from '../types/index.js';
import { NotificationService } from '../services/notification.service.js';
import { generateHandoffSummary } from '../services/task-ai.service.js';

import { getClientContext } from '../services/client-context.service.js';
import { generateShiftBriefing } from '../services/task-ai.service.js';
import { scoreTaskPriority, autoAssignTask } from '../services/ai-crm.service.js';
import { pool } from '../database/db.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { broadcastChatMessage } from '../services/chat-broadcast.service.js';
import { createLogger } from '../utils/logger.js';
import type { WorkTaskWithJoins } from '../types/views/task-views.js';

const log = createLogger('tasks');

const router = express.Router();

type MyTasksScope = 'assigned' | 'created' | 'all';
type TaskViewerRelation = 'assignee' | 'creator' | 'assignee_creator';
type TaskBoardStatus = 'open' | 'assigned' | 'in_progress' | 'waiting' | 'handed_off';

interface CountTotalRow {
  total: string;
}

interface CountRow {
  count: string;
}

interface ShiftBriefingSummaryRow {
  summary: string;
}

interface CurrentShiftRow {
  id: string;
  studio_id: string;
  shift_date: string;
  status: string;
  shift_kind: 'studio' | 'virtual';
  is_virtual: boolean;
  studio_name: string;
  studio_address: string | null;
  location_code: string;
  // Признак, что у студии смены реально активна фискальная касса (ATOL):
  // настройки фискалки включены и привязанный POS-агент активен. Источник правды —
  // pos_fiscal_settings + agents, а не хардкод во фронте.
  fiscal_enabled: boolean;
  fiscal_device_label: string | null;
}

interface TodayShiftStateRow {
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
}

interface MyTaskRow extends WorkTaskWithJoins {
  viewer_relation: TaskViewerRelation;
}

interface EnrichedWorkdayTask extends WorkTaskWithJoins {
  time_remaining_ms: number | null;
  is_overdue: boolean;
}

interface TaskEventPayload {
  assigned_studio_id: WorkTaskWithJoins['assigned_studio_id'];
  [field: string]: unknown;
}

interface WorkTaskEventRow extends WorkTaskWithJoins, TaskEventPayload {}

interface TaskUpdateLookupRow {
  id: string;
  task_number: number;
  title: string;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
}

interface ClientPhoneRow {
  client_phone: string | null;
}

interface CreatedMessageRow {
  id: string;
  created_at: Date;
}

// Helper: check if user is employee/admin/manager/photographer
function isStaff(role: string): boolean {
  return ['admin', 'manager', 'employee', 'photographer'].includes(role);
}

function isTaskBoardStatus(status: string): status is TaskBoardStatus {
  return status === 'open' || status === 'assigned' || status === 'in_progress' || status === 'waiting' || status === 'handed_off';
}

function hasDbErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === code;
}

// Helper: get current shift for employee
async function getCurrentShift(employeeId: string): Promise<CurrentShiftRow | null> {
  return db.queryOne<CurrentShiftRow>(
    `SELECT es.*, es.shift_date::text AS shift_date,
            es.shift_kind,
            (es.shift_kind = 'virtual') AS is_virtual,
            s.name as studio_name, s.address as studio_address, s.location_code,
            (pfs.enabled IS TRUE AND ag.id IS NOT NULL AND ag.is_active IS TRUE) AS fiscal_enabled,
            CASE WHEN pfs.enabled IS TRUE AND ag.id IS NOT NULL AND ag.is_active IS TRUE
                 THEN ag.name ELSE NULL END AS fiscal_device_label
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     LEFT JOIN pos_fiscal_settings pfs ON pfs.studio_id = s.id
     LEFT JOIN agents ag ON ag.id = pfs.agent_id
     WHERE es.employee_id = $1 AND es.shift_date = CURRENT_DATE
       AND es.status IN ('scheduled', 'active')
     ORDER BY CASE es.status WHEN 'active' THEN 0 ELSE 1 END
     LIMIT 1`,
    [employeeId]
  );
}

// Helper: emit socket event for task changes
function emitTaskEvent(req: express.Request, event: 'task:created' | 'task:updated' | 'task:assigned' | 'task:handoff', task: TaskEventPayload): void {
  try {
    const socketServer = req.app.socketServer;
    if (socketServer && task) {
      socketServer.sendTaskEvent(String(task.assigned_studio_id || 'all'), event, task);
    }
  } catch (err) {
    log.error('[Tasks] Socket emit error:', { error: String(err) });
  }
}

// All task endpoints require authentication and tasks:manage permission
router.use(authenticateToken, requirePermission('tasks:manage'));

// ============================================================================
// GET /api/tasks/employees — List active employees for assignment
// ============================================================================
router.get('/employees', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const rows = await db.query(
    `SELECT id, display_name, email, role FROM users
     WHERE role IN ('admin', 'manager', 'employee', 'photographer')
       AND is_active = true
       AND is_system = false
     ORDER BY display_name`,
  );
  res.json({ success: true, data: rows });
});

// ============================================================================
// GET /api/tasks — List tasks with filters
// ============================================================================
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { status, studio_id, assigned_to, task_type, priority, page = 1, limit = 20 } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = Math.min(parseInt(limit as string, 10), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`t.status = $${idx++}`);
    params.push(status);
  }

  if (studio_id) {
    conditions.push(`t.assigned_studio_id = $${idx++}`);
    params.push(studio_id);
  }

  if (assigned_to) {
    conditions.push(`t.assigned_to = $${idx++}`);
    params.push(assigned_to);
  }

  if (task_type) {
    conditions.push(`t.task_type = $${idx++}`);
    params.push(task_type);
  }

  if (priority) {
    conditions.push(`t.priority = $${idx++}`);
    params.push(priority);
  }

  // Non-admin employees see their studio's tasks + tasks assigned to them
  if (req.user.role !== 'admin') {
    const shift = await getCurrentShift(req.user.id);
    if (shift) {
      conditions.push(`(t.assigned_studio_id = $${idx++} OR t.assigned_to = $${idx++})`);
      params.push(shift.studio_id, req.user.id);
    } else {
      conditions.push(`t.assigned_to = $${idx++}`);
      params.push(req.user.id);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.queryOne<CountTotalRow>(
    `SELECT COUNT(*) as total FROM work_tasks t ${where}`,
    params
  );
  const total = parseInt(countResult?.total || '0', 10);

  const tasks = await db.query<WorkTaskWithJoins>(
    `SELECT t.*,
            u_assigned.display_name as assigned_to_name,
            u_created.display_name as created_by_name,
            s.name as studio_name, s.location_code
     FROM work_tasks t
     LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
     LEFT JOIN users u_created ON u_created.id = t.created_by
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     ${where}
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limitNum, offset]
  );

  const response: PaginatedResponse<WorkTaskWithJoins> = {
    success: true,
    data: tasks,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  };

  res.json(response);
});

// ============================================================================
// GET /api/tasks/board — Kanban view (grouped by status)
// ============================================================================
router.get('/board', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { studio_id } = req.query;

  let studioFilter = '';
  const params: unknown[] = [];
  let idx = 1;

  if (studio_id) {
    studioFilter = `AND t.assigned_studio_id = $${idx++}`;
    params.push(studio_id);
  } else if (req.user.role !== 'admin') {
    const shift = await getCurrentShift(req.user.id);
    if (shift) {
      studioFilter = `AND (t.assigned_studio_id = $${idx++} OR t.assigned_to = $${idx++})`;
      params.push(shift.studio_id, req.user.id);
    }
  }

  const tasks = await db.query<WorkTaskWithJoins>(
    `SELECT t.*,
            u_assigned.display_name as assigned_to_name,
            s.name as studio_name, s.location_code
     FROM work_tasks t
     LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     WHERE t.status NOT IN ('completed', 'cancelled') ${studioFilter}
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at ASC`,
    params
  );

  // Group by status
  const board: Record<TaskBoardStatus, WorkTaskWithJoins[]> = {
    open: [],
    assigned: [],
    in_progress: [],
    waiting: [],
    handed_off: [],
  };

  for (const task of tasks) {
    if (isTaskBoardStatus(task.status)) {
      board[task.status].push(task);
    }
  }

  res.json({ success: true, data: board });
});

// ============================================================================
// GET /api/tasks/my — My assigned/created tasks
// ============================================================================
router.get('/my', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const scopeRaw = typeof req.query['scope'] === 'string' ? req.query['scope'] : 'assigned';
  if (scopeRaw !== 'assigned' && scopeRaw !== 'created' && scopeRaw !== 'all') {
    throw new AppError(400, 'Invalid task scope');
  }

  const scope: MyTasksScope = scopeRaw;
  const relationWhere = scope === 'assigned'
    ? 't.assigned_to = $1'
    : scope === 'created'
      ? 't.created_by = $1'
      : '(t.assigned_to = $1 OR t.created_by = $1)';

  const tasks = await db.query<MyTaskRow>(
    `SELECT t.*,
            u_assigned.display_name as assigned_to_name,
            u_created.display_name as created_by_name,
            s.name as studio_name, s.location_code,
            CASE
              WHEN t.assigned_to = $1 AND t.created_by = $1 THEN 'assignee_creator'
              WHEN t.created_by = $1 THEN 'creator'
              ELSE 'assignee'
            END as viewer_relation
     FROM work_tasks t
     LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
     LEFT JOIN users u_created ON u_created.id = t.created_by
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     WHERE ${relationWhere} AND t.status NOT IN ('completed', 'cancelled')
     ORDER BY
       CASE WHEN t.assigned_to = $1 THEN 0 ELSE 1 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at ASC`,
    [req.user.id]
  );

  res.json({ success: true, data: tasks });
});

// ============================================================================
// GET /api/tasks/workday — Employee workday view (shift + tasks + timers)
// ============================================================================
router.get('/workday', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const shift = await getCurrentShift(req.user.id);
  const todayShiftState = await db.queryOne<TodayShiftStateRow>(
    `SELECT status
     FROM employee_shifts
     WHERE employee_id = $1 AND shift_date = CURRENT_DATE
     ORDER BY
       CASE status
         WHEN 'active' THEN 0
         WHEN 'scheduled' THEN 1
         WHEN 'completed' THEN 2
         ELSE 3
       END
     LIMIT 1`,
    [req.user.id]
  );
  const todayShiftStatus = todayShiftState?.status ?? null;
  const canStartWorkday = todayShiftStatus === null
    || todayShiftStatus === 'scheduled'
    || todayShiftStatus === 'completed'
    || todayShiftStatus === 'cancelled';

  // All tasks assigned to this employee (active)
  const tasks = await db.query<WorkTaskWithJoins>(
    `SELECT t.*,
            s.name as studio_name, s.location_code,
            u_created.display_name as created_by_name
     FROM work_tasks t
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     LEFT JOIN users u_created ON u_created.id = t.created_by
     WHERE (t.assigned_to = $1 OR (t.assigned_studio_id = $2::uuid AND t.assigned_to IS NULL))
       AND t.status NOT IN ('completed', 'cancelled')
     ORDER BY
       CASE WHEN t.due_date IS NOT NULL AND t.due_date < NOW() THEN 0 ELSE 1 END,
       t.due_date ASC NULLS LAST,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at ASC`,
    [req.user.id, shift?.studio_id || '00000000-0000-0000-0000-000000000000']
  );

  // Completed today count
  const completedToday = await db.queryOne<CountRow>(
    `SELECT COUNT(*) as count FROM work_tasks
     WHERE assigned_to = $1 AND status = 'completed'
       AND completed_at >= CURRENT_DATE`,
    [req.user.id]
  );

  const now = Date.now();
  const enrichedTasks: EnrichedWorkdayTask[] = tasks.map((t) => {
    const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
    return {
      ...t,
      time_remaining_ms: dueMs ? dueMs - now : null,
      is_overdue: dueMs ? dueMs < now : false,
    };
  });

  const urgentCount = tasks.filter((t) => t.priority === 'urgent').length;
  const overdueCount = enrichedTasks.filter((t) => t.is_overdue).length;

  // AI briefing (from shift_briefings if available)
  let aiBriefing: string | null = null;
  if (shift) {
    const briefing = await db.queryOne<ShiftBriefingSummaryRow>(
      `SELECT summary FROM shift_briefings WHERE shift_id = $1`,
      [shift.id]
    );
    if (briefing) {
      aiBriefing = briefing.summary;
    } else {
      // Generate on-demand
      const aiResult = await generateShiftBriefing(req.user.id, shift.studio_id, shift.shift_date);
      if (aiResult) {
        aiBriefing = aiResult.summary;
        // Save for reuse
        await db.query(
          `INSERT INTO shift_briefings (shift_id, employee_id, studio_id, briefing_date, summary, structured_data)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (shift_id) DO UPDATE SET summary = $5, structured_data = $6`,
          [shift.id, req.user.id, shift.studio_id, shift.shift_date, aiResult.summary, JSON.stringify(aiResult.structuredData)]
        );
      }
    }
  }

  res.json({
    success: true,
    data: {
      shift: shift || null,
      today_shift_status: todayShiftStatus,
      can_start_workday: canStartWorkday,
      tasks: enrichedTasks,
      summary: {
        total: tasks.length,
        urgent: urgentCount,
        overdue: overdueCount,
        completed_today: parseInt(completedToday?.count || '0', 10),
      },
      ai_briefing: aiBriefing,
    },
  });
});

// ============================================================================
// GET /api/tasks/analytics — Task analytics (KPI, by type/priority/employee/day)
// ============================================================================
router.get('/analytics', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { date_from, date_to, studio_id, employee_id } = req.query as Record<string, string>;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (date_from) { conditions.push(`t.created_at >= $${idx++}`); params.push(date_from); }
  if (date_to) { conditions.push(`t.created_at <= $${idx++}::date + INTERVAL '1 day'`); params.push(date_to); }
  if (studio_id) { conditions.push(`t.assigned_studio_id = $${idx++}`); params.push(studio_id); }
  if (employee_id) { conditions.push(`t.assigned_to = $${idx++}`); params.push(employee_id); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // 1. Overview
  const overview = await db.queryOne(`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int as completed,
      COUNT(*) FILTER (WHERE t.status = 'cancelled')::int as cancelled,
      COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'cancelled'))::int as active,
      ROUND(EXTRACT(EPOCH FROM AVG(t.completed_at - t.created_at) FILTER (WHERE t.completed_at IS NOT NULL)) / 3600, 1) as avg_completion_hours,
      CASE
        WHEN COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date) / COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL), 1)
        ELSE NULL
      END as sla_met_percent,
      COUNT(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < NOW() AND t.status NOT IN ('completed', 'cancelled'))::int as overdue_count
    FROM work_tasks t ${where}
  `, params);

  // 2. By type
  const byType = await db.query(`
    SELECT
      t.task_type,
      COUNT(*)::int as count,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int as completed,
      ROUND(EXTRACT(EPOCH FROM AVG(t.completed_at - t.created_at) FILTER (WHERE t.completed_at IS NOT NULL)) / 3600, 1) as avg_hours
    FROM work_tasks t ${where}
    GROUP BY t.task_type
    ORDER BY count DESC
  `, params);

  // 3. By priority
  const byPriority = await db.query(`
    SELECT
      t.priority,
      COUNT(*)::int as count,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int as completed,
      ROUND(EXTRACT(EPOCH FROM AVG(t.completed_at - t.created_at) FILTER (WHERE t.completed_at IS NOT NULL)) / 3600, 1) as avg_hours,
      CASE
        WHEN COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL AND t.completed_at <= t.due_date) / COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL AND t.due_date IS NOT NULL), 1)
        ELSE NULL
      END as sla_met
    FROM work_tasks t ${where}
    GROUP BY t.priority
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
  `, params);

  // 4. By employee
  const byEmployee = await db.query(`
    SELECT
      t.assigned_to as employee_id,
      u.display_name as name,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int as completed,
      ROUND(EXTRACT(EPOCH FROM AVG(t.completed_at - t.created_at) FILTER (WHERE t.completed_at IS NOT NULL)) / 3600, 1) as avg_hours,
      COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'cancelled'))::int as active
    FROM work_tasks t
    JOIN users u ON u.id = t.assigned_to
    ${where ? where + ' AND t.assigned_to IS NOT NULL' : 'WHERE t.assigned_to IS NOT NULL'}
    GROUP BY t.assigned_to, u.display_name
    ORDER BY total DESC
  `, params);

  // 5. By day (last N days within range)
  const byDay = await db.query(`
    SELECT
      DATE(t.created_at) as date,
      COUNT(*)::int as created,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int as completed
    FROM work_tasks t ${where}
    GROUP BY DATE(t.created_at)
    ORDER BY date DESC
    LIMIT 90
  `, params);

  res.json({
    success: true,
    data: {
      overview: overview || {},
      by_type: byType,
      by_priority: byPriority,
      by_employee: byEmployee,
      by_day: byDay.reverse(),
    },
  });
});

// ============================================================================
// GET /api/tasks/by-number/:number — Find task by human-readable number
// ============================================================================
router.get('/by-number/:number', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const taskNumber = parseInt(req.params['number'], 10);
  if (isNaN(taskNumber)) {
    throw new AppError(400, 'Invalid task number');
  }

  const task = await db.queryOne(
    `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.task_type,
            t.client_name, t.due_date, t.assigned_to, t.assigned_studio_id,
            u.display_name as assigned_to_name
     FROM work_tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.task_number = $1`,
    [taskNumber]
  );

  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  res.json({ success: true, data: task });
});

// ============================================================================
// GET /api/tasks/:id — Task details with notes, handoffs, chat links
// ============================================================================
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;

  const task = await db.queryOne(
    `SELECT t.*,
            u_assigned.display_name as assigned_to_name,
            u_created.display_name as created_by_name,
            s.name as studio_name, s.location_code
     FROM work_tasks t
     LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
     LEFT JOIN users u_created ON u_created.id = t.created_by
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     WHERE t.id = $1`,
    [id]
  );

  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  // Get notes
  const notes = await db.query(
    `SELECT n.*, u.display_name as author_name
     FROM task_notes n
     JOIN users u ON u.id = n.author_id
     WHERE n.task_id = $1
     ORDER BY n.created_at ASC`,
    [id]
  );

  // Get handoffs
  const handoffs = await db.query(
    `SELECT h.*,
            u_from.display_name as from_name,
            u_to.display_name as to_name,
            u_ack.display_name as acknowledged_by_name
     FROM task_handoffs h
     JOIN users u_from ON u_from.id = h.from_employee_id
     LEFT JOIN users u_to ON u_to.id = h.to_employee_id
     LEFT JOIN users u_ack ON u_ack.id = h.acknowledged_by
     WHERE h.task_id = $1
     ORDER BY h.created_at DESC`,
    [id]
  );

  // Get chat links
  const chatLinks = await db.query(
    `SELECT cl.*,
            vcs.visitor_name, vcs.visitor_phone, vcs.channel as chat_channel, vcs.status as chat_status
     FROM chat_task_links cl
     LEFT JOIN conversations vcs ON vcs.id = cl.chat_session_id
     WHERE cl.task_id = $1`,
    [id]
  );

  res.json({
    success: true,
    data: { ...task, notes, handoffs, chat_links: chatLinks },
  });
});

// ============================================================================
// POST /api/tasks — Create a task
// ============================================================================
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const {
    task_type, title, description, client_name, client_phone, client_channel,
    assigned_to, assigned_studio_id, priority, due_date, metadata,
    order_id, print_order_id, booking_id, chat_session_id, client_id,
  } = req.body;

  if (!task_type || !title) {
    throw new AppError(400, 'task_type and title are required');
  }

  // Default studio from current shift if not specified
  let studioId = assigned_studio_id;
  if (!studioId) {
    const shift = await getCurrentShift(req.user.id);
    if (shift) studioId = shift.studio_id;
  }

  const task = await db.queryOne(
    `INSERT INTO work_tasks (
       task_type, title, description, client_name, client_phone, client_channel,
       assigned_to, assigned_studio_id, priority, due_date, metadata,
       order_id, print_order_id, booking_id, chat_session_id, client_id,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      task_type, title, description || null, client_name || null, client_phone || null, client_channel || null,
      assigned_to || null, studioId || null, priority || 'normal', due_date || null,
      JSON.stringify(metadata || {}),
      order_id || null, print_order_id || null, booking_id || null, chat_session_id || null, client_id || null,
      req.user.id,
    ]
  );

  // Auto-set status to 'assigned' if assigned_to is set
  if (assigned_to && task) {
    await db.query(
      `UPDATE work_tasks SET status = 'assigned' WHERE id = $1`,
      [task.id]
    );
    task.status = 'assigned';

    // Notify assigned employee (in-app + Telegram push)
    NotificationService.createOrGroup({
      userId: assigned_to,
      title: 'Новая задача',
      body: `Вам назначена задача: ${title}`,
      type: 'task_assigned',
      data: { taskId: task.id, taskType: task_type },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));

  }

  // AI Auto-Priority: если приоритет не задан явно — AI определит
  if (!priority && task) {
    scoreTaskPriority(title, description || '', client_phone).then(async (score) => {
      if (score.priority !== 'normal' && score.confidence >= 0.7) {
        await db.query(
          `UPDATE work_tasks SET priority = $1, updated_at = NOW() WHERE id = $2`,
          [score.priority, task.id],
        );
        task.priority = score.priority;
        log.info(`[Tasks] AI set priority "${score.priority}" for #${task.task_number}: ${score.reason}`);
        emitTaskEvent(req, 'task:updated', task);
      }
    }).catch(err => log.error('[Tasks] AI priority error', { error: String(err) }));
  }

  // AI Auto-Assign: если никто не назначен — AI найдёт лучшего
  if (!assigned_to && task) {
    autoAssignTask(task.id).then(async (empId) => {
      if (empId) {
        task.assigned_to = empId;
        task.status = 'assigned';
        log.info(`[Tasks] AI auto-assigned #${task.task_number} to ${empId}`);
        emitTaskEvent(req, 'task:updated', task);

        // Уведомить назначенного
        NotificationService.createOrGroup({
          userId: empId,
          title: 'AI назначил задачу',
          body: `Вам автоназначена задача: ${title}`,
          type: 'task_assigned',
          data: { taskId: task.id, taskType: task_type, autoAssigned: true },
        }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));

      }
    }).catch(err => log.error('[Tasks] AI auto-assign error', { error: String(err) }));
  }

  log.info(`[Tasks] Created task #${task.task_number} "${title}" by ${req.user.id}`);
  emitTaskEvent(req, 'task:created', task);

  enqueueCrmEvent('task', task.id, 'task_created', {
    client_name: task.client_name || null,
    client_phone: task.client_phone || null,
    preview: `#${task.task_number} ${title}`,
    status: task.status,
    priority: priority === 'urgent' ? 0 : priority === 'high' ? 1 : priority === 'normal' ? 2 : 3,
    sort_time: new Date().toISOString(),
    channel: task.client_channel || null,
    assigned_to: task.assigned_to || null,
    assigned_to_name: null,
    unread: false,
    metadata: { taskNumber: task.task_number, taskType: task_type },
  }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));

  res.status(201).json({ success: true, data: task });
});

// ============================================================================
// PUT /api/tasks/:id — Update task
// ============================================================================
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const {
    title, description, priority, due_date, client_name, client_phone,
    client_channel, assigned_studio_id, metadata,
  } = req.body;

  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (title !== undefined) { fields.push(`title = $${idx++}`); params.push(title); }
  if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
  if (priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(priority); }
  if (due_date !== undefined) { fields.push(`due_date = $${idx++}`); params.push(due_date); }
  if (client_name !== undefined) { fields.push(`client_name = $${idx++}`); params.push(client_name); }
  if (client_phone !== undefined) { fields.push(`client_phone = $${idx++}`); params.push(client_phone); }
  if (client_channel !== undefined) { fields.push(`client_channel = $${idx++}`); params.push(client_channel); }
  if (assigned_studio_id !== undefined) { fields.push(`assigned_studio_id = $${idx++}`); params.push(assigned_studio_id); }
  if (metadata !== undefined) { fields.push(`metadata = $${idx++}`); params.push(JSON.stringify(metadata)); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  const current = await db.queryOne<TaskUpdateLookupRow>(
    `SELECT id, task_number, title, status, assigned_to, created_by
     FROM work_tasks
     WHERE id = $1`,
    [id]
  );
  if (!current) {
    throw new AppError(404, 'Task not found');
  }
  if (['completed', 'cancelled'].includes(current.status)) {
    throw new AppError(400, 'Нельзя редактировать завершённую или отменённую задачу');
  }

  params.push(id);
  const task = await db.queryOne<WorkTaskEventRow>(
    `UPDATE work_tasks SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    params
  );

  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  const changedLabels = [
    title !== undefined ? 'название' : null,
    description !== undefined ? 'описание' : null,
    priority !== undefined ? 'приоритет' : null,
    due_date !== undefined ? 'срок' : null,
    client_name !== undefined ? 'клиент' : null,
    client_phone !== undefined ? 'телефон' : null,
    client_channel !== undefined ? 'канал' : null,
    assigned_studio_id !== undefined ? 'студия' : null,
    metadata !== undefined ? 'метаданные' : null,
  ].filter((label): label is string => label !== null);

  await db.query(
    `INSERT INTO task_notes (task_id, author_id, note_type, content, metadata)
     VALUES ($1, $2, 'system', $3, $4)`,
    [
      id,
      req.user.id,
      `Задача отредактирована: ${changedLabels.join(', ')}`,
      JSON.stringify({ fields: changedLabels }),
    ]
  );

  if (task.assigned_to && task.assigned_to !== req.user.id) {
    NotificationService.createOrGroup({
      userId: task.assigned_to,
      title: 'Задача изменена',
      body: `Задача #${task.task_number}: ${changedLabels.join(', ')}`,
      type: 'system',
      data: { taskId: task.id },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));
  }

  if (task.created_by && task.created_by !== req.user.id && task.created_by !== task.assigned_to) {
    NotificationService.createOrGroup({
      userId: task.created_by,
      title: 'Ваша задача изменена',
      body: `Задача #${task.task_number}: ${changedLabels.join(', ')}`,
      type: 'system',
      data: { taskId: task.id },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));
  }

  emitTaskEvent(req, 'task:updated', task);
  res.json({ success: true, data: task });
});

// ============================================================================
// PUT /api/tasks/:id/status — Change task status
// ============================================================================
router.put('/:id/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    throw new AppError(400, 'Status is required');
  }

  const current = await db.queryOne('SELECT id, task_number, status FROM work_tasks WHERE id = $1', [id]);
  if (!current) {
    throw new AppError(404, 'Task not found');
  }

  const completedAt = status === 'completed' ? 'NOW()' : 'completed_at';
  const task = await db.queryOne(
    `UPDATE work_tasks SET status = $1, completed_at = ${completedAt}, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, id]
  );

  // Log status change as note
  await db.query(
    `INSERT INTO task_notes (task_id, author_id, note_type, content, metadata)
     VALUES ($1, $2, 'status_change', $3, $4)`,
    [id, req.user.id, `Статус изменён: ${current.status} → ${status}`,
     JSON.stringify({ from: current.status, to: status })]
  );

  // Уведомляем клиента в чате о смене статуса
  if (task && task.chat_session_id && ['in_progress', 'completed', 'waiting'].includes(status)) {
    notifyVisitorAboutTaskStatus(req, task.chat_session_id, status, task.title).catch(err =>
      log.error('[Tasks] Visitor notification failed:', { error: String(err) })
    );
  }

  // Gamification: award XP on task completion
  if (status === 'completed' && task?.assigned_to) {
    import('../services/employee-gamification.service.js').then(({ awardXP }) => {
      const action = current.priority === 'urgent' ? 'task_urgent' : 'task_completed';
      awardXP(task.assigned_to, action, task.id, `Задача #${task.task_number} завершена`)
        .catch(err => log.error('[Tasks] XP award error', { error: String(err) }));
    }).catch(err => log.error('[Tasks] Gamification import error', { error: String(err) }));
  }

  emitTaskEvent(req, 'task:updated', task);

  if (status === 'completed' || status === 'cancelled') {
    enqueueCrmEvent('task', id, 'task_completed', undefined, true)
      .catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
  } else {
    enqueueCrmEvent('task', id, 'task_updated', {
      status,
      sort_time: new Date().toISOString(),
    }).catch(err => log.warn('enqueueCrmEvent failed', { error: String(err) }));
  }

  res.json({ success: true, data: task });
});

// ============================================================================
// PUT /api/tasks/:id/assign — Assign task to employee
// ============================================================================
router.put('/:id/assign', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  let { assigned_to } = req.body;

  // 'self' → actual user ID
  if (assigned_to === 'self') {
    assigned_to = req.user!.id;
  }

  // assigned_to can be null (unassign) or a user ID
  const newStatus = assigned_to ? 'assigned' : 'open';

  // Race condition protection: only assign if task is still available
  const task = assigned_to
    ? await db.queryOne(
        `UPDATE work_tasks SET assigned_to = $1, status = $2, updated_at = NOW()
         WHERE id = $3 AND (assigned_to IS NULL OR assigned_to = $1 OR status IN ('open', 'handed_off'))
         RETURNING *`,
        [assigned_to, newStatus, id]
      )
    : await db.queryOne(
        `UPDATE work_tasks SET assigned_to = NULL, status = 'open', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );

  if (!task) {
    const exists = await db.queryOne('SELECT id, task_number, assigned_to FROM work_tasks WHERE id = $1', [id]);
    if (!exists) {
      throw new AppError(404, 'Task not found');
    }
    throw new AppError(409, 'Задача уже взята другим сотрудником');
  }

  // Log assignment
  const assigneeName = assigned_to
    ? (await db.queryOne('SELECT display_name FROM users WHERE id = $1', [assigned_to]))?.display_name || 'сотрудник'
    : null;

  await db.query(
    `INSERT INTO task_notes (task_id, author_id, note_type, content, metadata)
     VALUES ($1, $2, 'system', $3, $4)`,
    [id, req.user.id,
     assigned_to ? `Назначена на: ${assigneeName}` : 'Назначение снято',
     JSON.stringify({ assigned_to, assigned_by: req.user.id })]
  );

  // Notify assigned employee (in-app + Telegram push)
  if (assigned_to && assigned_to !== req.user.id) {
    NotificationService.createOrGroup({
      userId: assigned_to,
      title: 'Задача назначена на вас',
      body: `Задача #${task.task_number}: ${task.title}`,
      type: 'task_assigned',
      data: { taskId: task.id },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));

  }

  emitTaskEvent(req, 'task:assigned', task);
  res.json({ success: true, data: task });
});

// ============================================================================
// POST /api/tasks/:id/notes — Add a note
// ============================================================================
router.post('/:id/notes', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const { content, note_type } = req.body;

  if (!content) {
    throw new AppError(400, 'Content is required');
  }

  // Verify task exists
  const task = await db.queryOne('SELECT id, task_number, title, assigned_to FROM work_tasks WHERE id = $1', [id]);
  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  const note = await db.queryOne(
    `INSERT INTO task_notes (task_id, author_id, note_type, content)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, req.user.id, note_type || 'comment', content]
  );

  // Notify assigned employee if someone else adds a note
  if (task.assigned_to && task.assigned_to !== req.user.id) {
    NotificationService.createOrGroup({
      userId: task.assigned_to,
      title: 'Новая заметка',
      body: `Задача #${task.task_number}: ${content.substring(0, 100)}`,
      type: 'colleague_note',
      data: { taskId: id },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));
  }

  res.status(201).json({ success: true, data: note });
});

// ============================================================================
// POST /api/tasks/:id/handoff — Handoff task to next shift
// ============================================================================
router.post('/:id/handoff', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const { handoff_note, to_employee_id } = req.body;

  if (!handoff_note) {
    throw new AppError(400, 'handoff_note is required');
  }

  const task = await db.queryOne('SELECT id, task_number, title, status, assigned_to, assigned_studio_id, priority, chat_session_id, task_type FROM work_tasks WHERE id = $1', [id]);
  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  const shift = await getCurrentShift(req.user.id);

  const handoff = await db.queryOne(
    `INSERT INTO task_handoffs (task_id, from_employee_id, to_employee_id, from_shift_id, handoff_note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, req.user.id, to_employee_id || null, shift?.id || null, handoff_note]
  );

  // Update task status
  await db.query(
    `UPDATE work_tasks SET status = 'handed_off', updated_at = NOW() WHERE id = $1`,
    [id]
  );

  // Log handoff as note
  await db.query(
    `INSERT INTO task_notes (task_id, author_id, note_type, content, metadata)
     VALUES ($1, $2, 'handoff', $3, $4)`,
    [id, req.user.id, `Передача: ${handoff_note}`,
     JSON.stringify({ handoff_id: handoff.id, to_employee_id })]
  );

  // Notify target employee (in-app + Telegram push)
  if (to_employee_id) {
    NotificationService.createOrGroup({
      userId: to_employee_id,
      title: 'Задача передана вам',
      body: `Задача #${task.task_number}: ${handoff_note.substring(0, 100)}`,
      type: 'task_handoff',
      data: { taskId: id, handoffId: handoff.id },
    }).catch(err => log.error('[Tasks] Notification error', { error: String(err) }));

  }

  // AI-сводка (асинхронно, не блокируем ответ)
  generateHandoffSummary(id, handoff_note).then(async (summary) => {
    if (summary) {
      await db.query(
        `UPDATE task_handoffs SET ai_context_summary = $1 WHERE id = $2`,
        [summary, handoff.id],
      );
      await db.query(
        `UPDATE work_tasks SET ai_summary = $1, updated_at = NOW() WHERE id = $2`,
        [summary, id],
      );
      // Добавляем AI-сводку как заметку
      await db.query(
        `INSERT INTO task_notes (task_id, author_id, note_type, content)
         VALUES ($1, NULL, 'ai_summary', $2)`,
        [id, summary],
      );
      log.info(`[Tasks] AI handoff summary saved for task ${id}`);
    }
  }).catch(err => log.error('[Tasks] AI handoff summary error', { error: String(err) }));

  log.info(`[Tasks] Handoff task #${task.task_number} from ${req.user.id} to ${to_employee_id || 'next shift'}`);

  // Emit with updated status
  const updatedTask = await db.queryOne(
    `SELECT id, task_number, title, status, assigned_to, assigned_studio_id, priority, task_type,
            client_name, client_phone, due_date, created_at, updated_at
     FROM work_tasks WHERE id = $1`,
    [id]
  );
  emitTaskEvent(req, 'task:handoff', updatedTask || task);

  res.status(201).json({ success: true, data: handoff });
});

// ============================================================================
// PUT /api/tasks/:id/handoff/:hid/ack — Acknowledge handoff
// ============================================================================
router.put('/:id/handoff/:hid/ack', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id, hid } = req.params;

  const handoff = await db.queryOne(
    `UPDATE task_handoffs SET acknowledged = TRUE, acknowledged_at = NOW(), acknowledged_by = $1
     WHERE id = $2 AND task_id = $3
     RETURNING *`,
    [req.user.id, hid, id]
  );

  if (!handoff) {
    throw new AppError(404, 'Handoff not found');
  }

  // Assign task to acknowledging employee and set to in_progress
  await db.query(
    `UPDATE work_tasks SET assigned_to = $1, status = 'in_progress', updated_at = NOW()
     WHERE id = $2`,
    [req.user.id, id]
  );

  // Log acknowledgment
  await db.query(
    `INSERT INTO task_notes (task_id, author_id, note_type, content)
     VALUES ($1, $2, 'system', 'Передача принята')`,
    [id, req.user.id]
  );

  res.json({ success: true, data: handoff });
});

// ============================================================================
// POST /api/tasks/from-order/:orderId — Create task from existing order
// ============================================================================
router.post('/from-order/:orderId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { orderId } = req.params;
  const { assigned_studio_id, priority } = req.body;

  // Try orders table first
  let order = await db.queryOne(
    `SELECT o.*, u.display_name as client_name_from_user, u.phone as client_phone_from_user
     FROM orders o
     LEFT JOIN users u ON u.id = o.client_id
     WHERE o.id = $1`,
    [orderId]
  );

  let taskType = 'photo_order';
  let title = '';
  let clientName = '';
  let clientPhone = '';

  if (order) {
    const meta = order.metadata || {};
    clientName = meta.contact?.name || order.client_name_from_user || '';
    clientPhone = meta.contact?.phone || order.client_phone_from_user || '';
    title = `Заказ — ${clientName || 'Клиент'}`;
  } else {
    // Try photo_print_orders
    order = await db.queryOne('SELECT id, order_id, contact_name, contact_phone FROM photo_print_orders WHERE id = $1', [orderId]);
    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    clientName = order.contact_name || '';
    clientPhone = order.contact_phone || '';
    title = `Печать ${order.order_id} — ${clientName || 'Клиент'}`;
  }

  const shift = await getCurrentShift(req.user.id);

  const task = await db.queryOne(
    `INSERT INTO work_tasks (
       task_type, title, client_name, client_phone, client_channel,
       assigned_studio_id, priority, order_id, created_by
     ) VALUES ($1, $2, $3, $4, 'online', $5, $6, $7, $8)
     RETURNING *`,
    [taskType, title, clientName, clientPhone,
     assigned_studio_id || shift?.studio_id || null,
     priority || 'normal', orderId, req.user.id]
  );

  log.info(`[Tasks] Created task #${task.task_number} from order ${orderId}`);

  res.status(201).json({ success: true, data: task });
});

// ============================================================================
// GET /api/tasks/:id/client-context — Full client context from 3 databases
// ============================================================================
router.get('/:id/client-context', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const task = await db.queryOne<ClientPhoneRow>('SELECT client_phone FROM work_tasks WHERE id = $1', [id]);

  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  if (!task.client_phone) {
    res.json({ success: true, data: null, message: 'No client phone on task' });
    return;
  }

  const context = await getClientContext(task.client_phone, id);
  res.json({ success: true, data: context });
});

// ============================================================================
// GET /api/tasks/:id/linked — List linked tasks
// ============================================================================
router.get('/:id/linked', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;

  const links = await db.query(
    `SELECT tl.id as link_id, tl.link_type, tl.created_at as linked_at,
            t.id, t.task_number, t.title, t.status, t.priority, t.client_name, t.due_date,
            u.display_name as assigned_to_name
     FROM task_links tl
     JOIN work_tasks t ON t.id = CASE WHEN tl.task_a_id = $1 THEN tl.task_b_id ELSE tl.task_a_id END
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE tl.task_a_id = $1 OR tl.task_b_id = $1
     ORDER BY tl.created_at DESC`,
    [id]
  );

  res.json({ success: true, data: links });
});

// ============================================================================
// POST /api/tasks/:id/link — Link two tasks
// ============================================================================
router.post('/:id/link', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { id } = req.params;
  const { target_task_id, link_type } = req.body;

  if (!target_task_id) {
    throw new AppError(400, 'target_task_id is required');
  }

  if (id === target_task_id) {
    throw new AppError(400, 'Cannot link task to itself');
  }

  // Ensure consistent ordering (smaller UUID first) to avoid duplicate rows
  const [taskA, taskB] = id < target_task_id ? [id, target_task_id] : [target_task_id, id];

  const link = await db.queryOne(
    `INSERT INTO task_links (task_a_id, task_b_id, link_type, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_a_id, task_b_id) DO UPDATE SET link_type = $3
       RETURNING *`,
    [taskA, taskB, link_type || 'related', req.user.id]
  ).catch((err: unknown) => {
    if (hasDbErrorCode(err, '23503')) {
      throw new AppError(404, 'One of the tasks not found');
    }
    throw err;
  });

  res.status(201).json({ success: true, data: link });
});

// ============================================================================
// DELETE /api/tasks/:id/link/:linkId — Unlink tasks
// ============================================================================
router.delete('/:id/link/:linkId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const { linkId } = req.params;

  const result = await db.queryOne(
    `DELETE FROM task_links WHERE id = $1 RETURNING id`,
    [linkId]
  );

  if (!result) {
    throw new AppError(404, 'Link not found');
  }

  res.json({ success: true });
});

// ============================================================================
// POST /api/tasks/:id/merge — Merge source task into this task (survivor)
// ============================================================================
router.post('/:id/merge', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const survivorId = req.params['id'];
  const { source_task_id } = req.body;

  if (!source_task_id) {
    throw new AppError(400, 'source_task_id is required');
  }

  if (survivorId === source_task_id) {
    throw new AppError(400, 'Cannot merge task with itself');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both tasks exist
    const survivor = (await client.query('SELECT id, task_number, title, status, metadata FROM work_tasks WHERE id = $1', [survivorId])).rows[0];
    const source = (await client.query('SELECT id, task_number, title, status, metadata FROM work_tasks WHERE id = $1', [source_task_id])).rows[0];

    if (!survivor || !source) {
      await client.query('ROLLBACK');
      throw new AppError(404, 'One of the tasks not found');
    }

    // 1. Copy all notes from source to survivor
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content, metadata, created_at)
       SELECT $1, author_id, note_type,
              '[Из задачи #' || $3 || '] ' || content,
              metadata, created_at
       FROM task_notes WHERE task_id = $2`,
      [survivorId, source_task_id, source.task_number]
    );

    // 2. Copy chat_task_links from source to survivor
    await client.query(
      `INSERT INTO chat_task_links (task_id, chat_session_id, bitrix_chat_id, messenger_type, linked_by)
       SELECT $1, chat_session_id, bitrix_chat_id, messenger_type, $3
       FROM chat_task_links WHERE task_id = $2
       ON CONFLICT DO NOTHING`,
      [survivorId, source_task_id, req.user.id]
    );

    // 3. Create merged link
    const [taskA, taskB] = survivorId < source_task_id ? [survivorId, source_task_id] : [source_task_id, survivorId];
    await client.query(
      `INSERT INTO task_links (task_a_id, task_b_id, link_type, created_by)
       VALUES ($1, $2, 'merged', $3)
       ON CONFLICT (task_a_id, task_b_id) DO UPDATE SET link_type = 'merged'`,
      [taskA, taskB, req.user.id]
    );

    // 4. Cancel source task
    await client.query(
      `UPDATE work_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [source_task_id]
    );

    // 5. System note on source
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [source_task_id, req.user.id, `Склеена в задачу #${survivor.task_number}`]
    );

    // 6. System note on survivor
    await client.query(
      `INSERT INTO task_notes (task_id, author_id, note_type, content)
       VALUES ($1, $2, 'system', $3)`,
      [survivorId, req.user.id, `Задача #${source.task_number} склеена сюда`]
    );

    // 7. Merge metadata
    const mergedMeta = { ...(source.metadata || {}), ...(survivor.metadata || {}), merged_from: source_task_id };
    await client.query(
      `UPDATE work_tasks SET metadata = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(mergedMeta), survivorId]
    );

    await client.query('COMMIT');

    const updatedSurvivor = await db.queryOne(
      `SELECT id, task_number, title, status, assigned_to, assigned_studio_id, priority, task_type,
              client_name, client_phone, due_date, metadata, created_at, updated_at
       FROM work_tasks WHERE id = $1`,
      [survivorId]
    );
    log.info(`[Tasks] Merged task #${source.task_number} into #${survivor.task_number}`);

    emitTaskEvent(req, 'task:updated', updatedSurvivor);
    res.json({ success: true, data: updatedSurvivor });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ============================================================================
// Уведомление клиента в чате о смене статуса задачи
// ============================================================================

const STATUS_MESSAGES: Record<string, string> = {
  in_progress: '🔧 **Ваш заказ в работе!**\nНаш специалист приступил к обработке.',
  completed: '✅ **Ваш заказ готов!**\nРезультат отправлен в этот чат. Если нужны правки — напишите нам.',
  waiting: '⏳ **Ожидаем вашего подтверждения**\nПожалуйста, проверьте результат и подтвердите или запросите правки.',
};

async function notifyVisitorAboutTaskStatus(
  req: express.Request,
  chatSessionId: string,
  status: string,
  taskTitle: string,
): Promise<void> {
  const content = STATUS_MESSAGES[status];
  if (!content) return;

  // Сохраняем сообщение в БД
  const msgResult = await db.queryOne<CreatedMessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content)
     VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
     RETURNING id, created_at`,
    [chatSessionId, content]
  );

  // Отправляем через WebSocket
  const socketServer = req.app.socketServer;
  if (socketServer && msgResult) {
    socketServer.getIO().to(`visitor:${chatSessionId}`).emit('operator:message', {
      sessionId: chatSessionId,
      content,
      senderName: 'Своё Фото',
      senderType: 'bot',
      messageType: 'text',
      attachmentUrl: null,
      timestamp: msgResult.created_at,
      id: msgResult.id,
    });

    broadcastChatMessage({
      sessionId: chatSessionId,
      message: {
        id: msgResult.id,
        sender_type: 'bot',
        sender_name: 'Своё Фото',
        content,
        message_type: 'text',
        created_at: msgResult.created_at,
      },
    }).catch(err => log.error('[Tasks] CRM broadcast failed', { error: String(err) }));
  }

  // Push-уведомление
  try {
    const { sendVisitorChatPush } = await import('../services/visitor-push.service.js');
    const shortText = status === 'completed' ? 'Ваш заказ готов!' : status === 'in_progress' ? 'Заказ в работе' : 'Ожидаем подтверждения';
    sendVisitorChatPush(chatSessionId, {
      title: 'Своё Фото',
      body: shortText,
    }).catch(err => log.error('[Tasks] Push notification failed', { error: String(err) }));
  } catch {
    // visitor-push.service may not be available
  }

  log.info(`[Tasks] Visitor notified about status "${status}" for session ${chatSessionId}`);
}

export default router;
