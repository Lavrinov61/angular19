/** View types for task & shift domain — composed from Kanel + JSONB contracts. */

import type WorkTasks from '../generated/public/WorkTasks.js';
import type { WorkTasksId } from '../generated/public/WorkTasks.js';
import type TaskNotes from '../generated/public/TaskNotes.js';
import type { TaskNotesId } from '../generated/public/TaskNotes.js';
import type TaskHandoffs from '../generated/public/TaskHandoffs.js';
import type { TaskHandoffsId } from '../generated/public/TaskHandoffs.js';
import type TaskLinks from '../generated/public/TaskLinks.js';
import type { TaskLinksId } from '../generated/public/TaskLinks.js';
import type ChatTaskLinks from '../generated/public/ChatTaskLinks.js';
import type { ChatTaskLinksId } from '../generated/public/ChatTaskLinks.js';
import type EmployeeShifts from '../generated/public/EmployeeShifts.js';
import type { EmployeeShiftsId } from '../generated/public/EmployeeShifts.js';
import type ShiftBriefings from '../generated/public/ShiftBriefings.js';
import type { ShiftBriefingsId } from '../generated/public/ShiftBriefings.js';
import type ScheduleRequests from '../generated/public/ScheduleRequests.js';
import type { ScheduleRequestsId } from '../generated/public/ScheduleRequests.js';
import type { UsersId } from '../generated/public/Users.js';
import type { TaskMetadata } from '../jsonb/task-metadata.js';
import type { RequestedShift, ShiftBriefingData, HandoffBriefRow as HandoffBriefJsonb } from '../jsonb/schedule-jsonb.js';
import type { LinkedAccounts } from '../jsonb/user-jsonb.js';

// Re-export branded IDs for convenience
export type { WorkTasksId } from '../generated/public/WorkTasks.js';
export type { TaskNotesId } from '../generated/public/TaskNotes.js';
export type { TaskHandoffsId } from '../generated/public/TaskHandoffs.js';
export type { TaskLinksId } from '../generated/public/TaskLinks.js';
export type { ChatTaskLinksId } from '../generated/public/ChatTaskLinks.js';
export type { EmployeeShiftsId } from '../generated/public/EmployeeShifts.js';
export type { ShiftBriefingsId } from '../generated/public/ShiftBriefings.js';
export type { ScheduleRequestsId } from '../generated/public/ScheduleRequests.js';
export type { UsersId } from '../generated/public/Users.js';

// EmployeeShifts table row re-exported for backward compat
type EmployeeShiftRow = EmployeeShifts;
export type { EmployeeShiftRow };

/** Fields from WorkTasks that have DEFAULT in PG — non-nullable in query results. */
type WorkTaskDefaultOverrides = {
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
};

// ── Work Tasks ─────────────────────────────────────────────────────────────

/** WorkTasks row with JSONB metadata override + non-nullable DEFAULT fields. */
export interface WorkTaskWithMeta extends Omit<WorkTasks, 'metadata' | keyof WorkTaskDefaultOverrides> {
  metadata: TaskMetadata | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

/** WorkTasks row extended with JOINed display columns + JSONB override. */
export interface WorkTaskWithJoins extends Omit<WorkTasks, 'metadata' | keyof WorkTaskDefaultOverrides> {
  metadata: TaskMetadata | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  assigned_to_name: string | null;
  created_by_name: string | null;
  studio_name: string | null;
  location_code: string | null;
}

/** Lightweight task projection for list queries. */
export interface WorkTaskBrief {
  id: WorkTasksId;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  task_type: string;
  client_name: string | null;
  client_phone: string | null;
  due_date: string | null;
  assigned_to: WorkTasks['assigned_to'];
  assigned_studio_id: WorkTasks['assigned_studio_id'];
  description: string | null;
  metadata: TaskMetadata | null;
  created_at: string;
  updated_at: string;
}

// ── Task Notes ─────────────────────────────────────────────────────────────

/** Task note row with JOINed author name. */
export interface TaskNoteRow extends Pick<TaskNotes, 'id' | 'task_id' | 'author_id' | 'note_type' | 'content' | 'metadata' | 'created_at'> {
  author_name?: string | null;
}

// ── Task Handoffs ──────────────────────────────────────────────────────────

/** Task handoff row with JOINed display names. */
export interface TaskHandoffRow extends Pick<TaskHandoffs, 'id' | 'task_id' | 'from_employee_id' | 'to_employee_id' | 'from_shift_id' | 'handoff_note' | 'ai_context_summary' | 'acknowledged' | 'acknowledged_at' | 'acknowledged_by' | 'created_at'> {
  from_name?: string | null;
  to_name?: string | null;
  acknowledged_by_name?: string | null;
}

// ── Task Links ─────────────────────────────────────────────────────────────

/** Task link row with linked task details. */
export interface TaskLinkRow {
  link_id: TaskLinksId;
  link_type: string | null;
  linked_at: string | null;
  id: WorkTasksId;
  task_number: number;
  title: string;
  status: string | null;
  priority: string | null;
  client_name: string | null;
  due_date: string | null;
  assigned_to_name: string | null;
}

/** Chat-task link row with conversation details. */
export interface ChatTaskLinkRow extends Pick<ChatTaskLinks, 'id' | 'task_id' | 'chat_session_id' | 'bitrix_chat_id' | 'messenger_type' | 'linked_by'> {
  visitor_name: string | null;
  visitor_phone: string | null;
  chat_channel: string | null;
  chat_status: string | null;
}

// ── Analytics ──────────────────────────────────────────────────────────────

export interface TaskAnalyticsOverview {
  total: number;
  completed: number;
  cancelled: number;
  active: number;
  avg_completion_hours: number | null;
  sla_met_percent: number | null;
  overdue_count: number;
}

export interface TaskAnalyticsByType {
  task_type: string;
  count: number;
  completed: number;
  avg_hours: number | null;
}

export interface TaskAnalyticsByPriority {
  priority: string;
  count: number;
  completed: number;
  avg_hours: number | null;
  sla_met: number | null;
}

export interface TaskAnalyticsByEmployee {
  employee_id: string;
  name: string | null;
  total: number;
  completed: number;
  avg_hours: number | null;
  active: number;
}

export interface TaskAnalyticsByDay {
  date: string;
  created: number;
  completed: number;
}

// ── Schedule Requests ──────────────────────────────────────────────────────

/** Schedule request with JSONB override for requested_shifts. */
export interface ScheduleRequestWithMeta extends Omit<ScheduleRequests, 'requested_shifts'> {
  requested_shifts: RequestedShift[];
}

/** Raw schedule request row before JSONB normalization. */
export interface ScheduleRequestRawRow extends Omit<ScheduleRequests, 'requested_shifts'> {
  requested_shifts: unknown;
}

/** Schedule request extended with JOINed display columns. */
export interface ScheduleRequestWithJoins extends ScheduleRequestWithMeta {
  employee_name: string | null;
  employee_phone: string | null;
  admin_name: string | null;
}

// ── Employee Shifts ────────────────────────────────────────────────────────

/** Employee shift extended with JOINed display columns. */
export interface EmployeeShiftWithJoins extends EmployeeShifts {
  employee_name: string | null;
  employee_phone: string | null;
  studio_name: string | null;
  location_code: string | null;
  linked_accounts?: LinkedAccounts | null;
}

/** Shift briefing row with JSONB structured_data override. */
export interface ShiftBriefingRow extends Omit<ShiftBriefings, 'structured_data'> {
  structured_data: ShiftBriefingData | null;
}

/** Structured briefing data (non-AI fallback). */
export interface ShiftBriefingFallback {
  active_tasks: string;
  urgent_tasks: string;
  handed_off_tasks: string;
  todays_bookings: string;
}

// ── Briefing helpers ───────────────────────────────────────────────────────

export interface BookingBriefRow {
  id: string;
  start_time: string;
  status: string;
  client_name: string | null;
}

/** HandoffBriefRow used in API responses (same shape as JSONB HandoffBriefRow). */
export type { HandoffBriefJsonb as HandoffBriefRow };

export interface PendingHandoffRow {
  id: TaskHandoffsId;
  handoff_note: string | null;
  created_at: string | null;
  task_id: WorkTasksId;
  task_number: number;
  title: string;
  client_name: string | null;
  from_name: string | null;
}

// ── Dashboard helpers ──────────────────────────────────────────────────────

export interface EmployeeDashboardTaskSummary {
  total: string;
  urgent: string;
  waiting: string;
}

export interface ShiftCheckoutSummaryRow {
  hours_worked: string;
  pos_count: string;
  pos_total: string;
  commission_total: string;
  online_count: string;
  online_total: string;
}

export interface PhotoPrintOrderBrief {
  order_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  total_price: string | null;
  status: string | null;
  payment_status: string | null;
  priority: string;
  created_at: string | null;
}

export interface TodayOrderStats {
  orders_today: string;
  revenue_today: string;
}

export interface StaffListRow {
  id: UsersId;
  display_name: string | null;
  role: string;
}
