/**
 * crm-dashboard-batch.routes.ts — Single-request CRM dashboard data loader.
 *
 * GET /api/crm/dashboard/batch
 *
 * Replaces 6 parallel HTTP calls from DashboardDataService.init():
 *   workday, dailySummary, upcomingBookings, myTasks, orderQueue, gamification
 *
 * KPI and satisfaction are mock on the frontend, so not included here.
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { cacheGetOrFetch } from '../services/redis-cache.service.js';
import db from '../database/db.js';
import { getDailySummary, type DailySummary } from '../services/crm-reports.service.js';
import { getMyStats, type GamificationStats } from '../services/employee-gamification.service.js';
import { generateShiftBriefing } from '../services/task-ai.service.js';

const router = Router();
const log = createLogger('crm-dashboard-batch');

router.use(authenticateToken, requirePermission('inbox:view'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function isStaff(role: string): boolean {
  return ['admin', 'employee', 'photographer'].includes(role);
}

/** Current shift for employee (today, scheduled or active). */
async function getCurrentShift(employeeId: string): Promise<ShiftRow | null> {
  return db.queryOne<ShiftRow>(
    `SELECT es.*, s.name as studio_name, s.location_code
     FROM employee_shifts es
     JOIN studios s ON s.id = es.studio_id
     WHERE es.employee_id = $1 AND es.shift_date = CURRENT_DATE
       AND es.status IN ('scheduled', 'active')
     ORDER BY CASE es.status WHEN 'active' THEN 0 ELSE 1 END
     LIMIT 1`,
    [employeeId],
  );
}

// ── Row interfaces ───────────────────────────────────────────────────────────

interface ShiftRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_date: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  studio_name: string;
  location_code: string | null;
}

interface WorkTaskRow {
  id: string;
  task_number: number;
  task_type: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  client_name: string | null;
  client_phone: string | null;
  assigned_to: string | null;
  assigned_studio_id: string | null;
  studio_name: string | null;
  location_code: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface EnrichedWorkTask extends WorkTaskRow {
  time_remaining_ms: number | null;
  is_overdue: boolean;
}

interface WorkTaskCountRow {
  count: string;
}

interface ShiftBriefingSummaryRow {
  summary: string;
}

interface WorkdayResult {
  shift: ShiftRow | null;
  tasks: EnrichedWorkTask[];
  summary: {
    total: number;
    urgent: number;
    overdue: number;
    completed_today: number;
  };
  ai_briefing: string | null;
}

interface UpcomingBookingRow {
  id: string;
  client_name: string;
  client_phone: string | null;
  service_name: string | null;
  start_time: string;
  status: string;
}

interface OrderQueueRow {
  id: string;
  order_id: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  total_price: number;
  status: string;
  payment_status: string;
  priority: string;
  items: unknown;
  comments: string | null;
  delivery_address: string | null;
  delivery_cost: number | null;
  tracking_number: string | null;
  promo_code: string | null;
  promo_discount: number | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  assigned_employee_id: string | null;
  assigned_at: string | null;
  chat_session_id: string | null;
  assigned_employee_name: string | null;
  sla_deadline: string | null;
  time_remaining_ms: number | null;
  is_overdue: boolean;
  resolved_phone: string | null;
  resolved_user_id: string | null;
  deadline: string | null;
  photo_url: string | null;
}

interface BatchData {
  workday: WorkdayResult;
  dailySummary: DailySummary;
  upcomingBookings: UpcomingBookingRow[];
  myTasks: WorkTaskRow[];
  orderQueue: OrderQueueRow[];
  gamification: GamificationStats;
}

// ── Data fetchers ────────────────────────────────────────────────────────────

async function fetchWorkday(userId: string): Promise<WorkdayResult> {
  const shift = await getCurrentShift(userId);

  const tasks = await db.query<WorkTaskRow>(
    `SELECT t.id, t.task_number, t.task_type, t.title, t.description,
            t.priority, t.status, t.due_date, t.client_name, t.client_phone,
            t.assigned_to, t.assigned_studio_id, t.created_at, t.updated_at,
            s.name as studio_name, s.location_code,
            u_created.display_name as created_by_name
     FROM work_tasks t
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     LEFT JOIN users u_created ON u_created.id = t.created_by
     WHERE (t.assigned_to = $1 OR (t.assigned_studio_id = $2 AND t.assigned_to IS NULL))
       AND t.status NOT IN ('completed', 'cancelled')
     ORDER BY
       CASE WHEN t.due_date IS NOT NULL AND t.due_date < NOW() THEN 0 ELSE 1 END,
       t.due_date ASC NULLS LAST,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at ASC`,
    [userId, shift?.studio_id || '00000000-0000-0000-0000-000000000000'],
  );

  const completedToday = await db.queryOne<WorkTaskCountRow>(
    `SELECT COUNT(*) as count FROM work_tasks
     WHERE assigned_to = $1 AND status = 'completed'
       AND completed_at >= CURRENT_DATE`,
    [userId],
  );

  const now = Date.now();
  const enrichedTasks: EnrichedWorkTask[] = tasks.map((t) => {
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
      [shift.id],
    );
    if (briefing) {
      aiBriefing = briefing.summary;
    } else {
      const aiResult = await generateShiftBriefing(userId, shift.studio_id, shift.shift_date);
      if (aiResult) {
        aiBriefing = aiResult.summary;
        await db.query(
          `INSERT INTO shift_briefings (shift_id, employee_id, studio_id, briefing_date, summary, structured_data)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (shift_id) DO UPDATE SET summary = $5, structured_data = $6`,
          [shift.id, userId, shift.studio_id, shift.shift_date, aiResult.summary, JSON.stringify(aiResult.structuredData)],
        );
      }
    }
  }

  return {
    shift,
    tasks: enrichedTasks,
    summary: {
      total: tasks.length,
      urgent: urgentCount,
      overdue: overdueCount,
      completed_today: parseInt(completedToday?.count || '0', 10),
    },
    ai_briefing: aiBriefing,
  };
}

async function fetchMyTasks(userId: string): Promise<WorkTaskRow[]> {
  return db.query<WorkTaskRow>(
    `SELECT t.id, t.task_number, t.task_type, t.title, t.description,
            t.priority, t.status, t.due_date, t.client_name, t.client_phone,
            t.assigned_to, t.assigned_studio_id, t.created_at, t.updated_at,
            s.name as studio_name, s.location_code
     FROM work_tasks t
     LEFT JOIN studios s ON s.id = t.assigned_studio_id
     WHERE t.assigned_to = $1 AND t.status NOT IN ('completed', 'cancelled')
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.created_at ASC`,
    [userId],
  );
}

async function fetchUpcomingBookings(): Promise<UpcomingBookingRow[]> {
  return db.query<UpcomingBookingRow>(
    `SELECT b.id, b.client_name, b.client_phone, b.service_name, b.start_time, b.status
     FROM bookings b
     WHERE b.start_time::date = CURRENT_DATE
       AND b.status IN ('confirmed', 'pending')
       AND b.start_time >= NOW()
     ORDER BY b.start_time ASC
     LIMIT 8`,
  );
}

async function fetchOrderQueue(): Promise<OrderQueueRow[]> {
  return db.query<OrderQueueRow>(
    `SELECT p.id, p.order_id, p.contact_name, p.contact_phone, p.contact_email,
            p.total_price, p.status, p.payment_status, p.priority,
            p.items, p.comments, p.delivery_address, p.delivery_cost,
            p.tracking_number, p.promo_code, p.promo_discount,
            p.created_at, p.updated_at, p.paid_at,
            p.assigned_employee_id, p.assigned_at, p.chat_session_id,
            u.display_name as assigned_employee_name,
            COALESCE(t.sla_deadline, t.due_date) as sla_deadline,
            CASE WHEN COALESCE(t.sla_deadline, t.due_date) IS NOT NULL THEN
              EXTRACT(EPOCH FROM (COALESCE(t.sla_deadline, t.due_date) - NOW())) * 1000
            ELSE NULL END as time_remaining_ms,
            CASE WHEN COALESCE(t.sla_deadline, t.due_date) IS NOT NULL AND COALESCE(t.sla_deadline, t.due_date) < NOW() THEN true
            ELSE false END as is_overdue,
            COALESCE((t.metadata->>'escalation_level')::int, 0) as escalation_level,
            COALESCE(p.contact_phone, c.visitor_phone) as resolved_phone,
            c.user_id as resolved_user_id,
            COALESCE(t.sla_deadline, p.estimated_ready_at, p.created_at + interval '30 minutes') as deadline,
            (SELECT attachment_url FROM messages
             WHERE conversation_id = p.chat_session_id AND message_type = 'image'
             ORDER BY created_at DESC LIMIT 1) as photo_url
     FROM photo_print_orders p
     LEFT JOIN users u ON u.id = p.assigned_employee_id
     LEFT JOIN work_tasks t ON t.print_order_id = p.id
       AND t.status NOT IN ('completed', 'cancelled')
     LEFT JOIN conversations c ON c.id = p.chat_session_id
     WHERE p.status IN ('new', 'pending_payment', 'paid', 'processing', 'ready')
       AND p.payment_status IN ('pending', 'paid', 'none')
     ORDER BY
       CASE p.priority
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'normal' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       COALESCE(t.sla_deadline, t.due_date) ASC NULLS LAST,
       p.created_at DESC
     LIMIT 20`,
  );
}

// ── Main endpoint ────────────────────────────────────────────────────────────

/**
 * GET /api/crm/dashboard/batch
 *
 * Returns all dashboard data in a single request.
 * Replaces 6 parallel HTTP calls from DashboardDataService.init():
 *   workday, dailySummary, upcomingBookings, myTasks, orderQueue, gamification
 *
 * Cached per user for 30 seconds with 10s early refresh.
 */
router.get('/batch', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    res.status(403).json({ success: false, error: 'Staff access required' });
    return;
  }

  const userId = req.user.id;
  const cacheKey = `crm:dashboard:batch:${userId}`;

  const data = await cacheGetOrFetch<BatchData>(cacheKey, 30, 10, async () => {
    const [workday, dailySummary, upcomingBookings, myTasks, orderQueue, gamification] =
      await Promise.all([
        fetchWorkday(userId),
        getDailySummary(),
        fetchUpcomingBookings(),
        fetchMyTasks(userId),
        fetchOrderQueue(),
        getMyStats(userId),
      ]);

    return { workday, dailySummary, upcomingBookings, myTasks, orderQueue, gamification };
  });

  log.info('batch dashboard loaded', { userId });
  res.json({ success: true, data });
});

// ── Metrics endpoint (F69) ──────────────────────────────────────────────────

import type { OrderAggregateRow, PosAggregateRow, CountRow } from '../types/views/index.js';

interface PeriodMetrics {
  orders: number;
  revenue: number;
  avgCheck: number;
  posReceipts: number;
  posRevenue: number;
  chatSessions?: number;
  chatMessages?: number;
}

interface DashboardMetrics {
  today: PeriodMetrics;
  week: PeriodMetrics;
  conversionRate: number;
}

async function fetchOrderAggregate(daysBack: number): Promise<OrderAggregateRow> {
  const dateCondition = daysBack === 0
    ? `created_at::date = CURRENT_DATE`
    : `created_at >= CURRENT_DATE - ${daysBack}`;

  const row = await db.queryOne<OrderAggregateRow>(
    `SELECT COUNT(*)::text AS count,
            COALESCE(SUM(total_price), 0)::text AS revenue,
            COALESCE(AVG(total_price), 0)::text AS avg_check
     FROM photo_print_orders
     WHERE ${dateCondition} AND payment_status = 'paid'`,
  );
  return row ?? { count: '0', revenue: '0', avg_check: '0' };
}

async function fetchPosAggregate(daysBack: number): Promise<PosAggregateRow> {
  const dateCondition = daysBack === 0
    ? `created_at::date = CURRENT_DATE`
    : `created_at >= CURRENT_DATE - ${daysBack}`;

  const row = await db.queryOne<PosAggregateRow>(
    `SELECT COUNT(*)::text AS count,
            COALESCE(SUM(total::numeric), 0)::text AS revenue
     FROM pos_receipts
     WHERE ${dateCondition} AND voided_at IS NULL AND (is_refund IS NULL OR is_refund = false)`,
  );
  return row ?? { count: '0', revenue: '0' };
}

async function fetchCount(table: string, daysBack: number, extraWhere?: string): Promise<number> {
  const dateCondition = daysBack === 0
    ? `created_at::date = CURRENT_DATE`
    : `created_at >= CURRENT_DATE - ${daysBack}`;

  const row = await db.queryOne<CountRow>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${dateCondition}${extraWhere ? ` AND ${extraWhere}` : ''}`,
  );
  return parseInt(row?.count ?? '0', 10);
}

function toPeriodMetrics(
  orders: OrderAggregateRow,
  pos: PosAggregateRow,
  chatSessions?: number,
  chatMessages?: number,
): PeriodMetrics {
  const result: PeriodMetrics = {
    orders: parseInt(orders.count, 10),
    revenue: parseFloat(orders.revenue),
    avgCheck: Math.round(parseFloat(orders.avg_check)),
    posReceipts: parseInt(pos.count, 10),
    posRevenue: parseFloat(pos.revenue),
  };
  if (chatSessions !== undefined) result.chatSessions = chatSessions;
  if (chatMessages !== undefined) result.chatMessages = chatMessages;
  return result;
}

/**
 * GET /api/crm/dashboard/metrics
 *
 * Aggregated metrics: orders, revenue, POS, chats, conversion.
 * Cached globally for 60 seconds.
 */
router.get('/metrics', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    res.status(403).json({ success: false, error: 'Staff access required' });
    return;
  }

  const cacheKey = 'crm:dashboard:metrics';

  const data = await cacheGetOrFetch<DashboardMetrics>(cacheKey, 60, 15, async () => {
    const [todayOrders, todayPos, weekOrders, weekPos, todaySessions, todayMessages, weekVisitors] =
      await Promise.all([
        fetchOrderAggregate(0),
        fetchPosAggregate(0),
        fetchOrderAggregate(7),
        fetchPosAggregate(7),
        fetchCount('conversations', 0),
        fetchCount('messages', 0, `sender_type = 'operator'`),
        fetchCount('visitor_chat_sessions', 7),
      ]);

    const today = toPeriodMetrics(todayOrders, todayPos, todaySessions, todayMessages);
    const week = toPeriodMetrics(weekOrders, weekPos);

    const conversionRate = weekVisitors > 0
      ? Math.round((week.orders / weekVisitors) * 1000) / 10
      : 0;

    return { today, week, conversionRate };
  });

  res.json({ success: true, data });
});

export default router;
