/** View types for AI CRM service. */

// ── Chat context ──────────────────────────────────────────────────────

/** Structured JSON context stored with a conversation for AI summaries. */
export interface AiCrmConversationContextJson {
  readonly [key: string]: unknown;
}

/** Conversation fields used to enrich AI summaries. */
export interface AiCrmConversationSummaryRow {
  visitor_name: string | null;
  channel: string | null;
  selected_service: string | null;
  selected_price: string | null;
  context: AiCrmConversationContextJson | null;
}

// ── Assignment suggestions ─────────────────────────────────────────────

/** Work task fields used for assignment suggestions. */
export interface AssignmentTaskRow {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  assigned_studio_id: string | null;
  description: string | null;
}

/** Employee currently on shift (for task auto-assignment). */
export interface OnShiftEmployeeRow {
  id: string;
  user_id: string;
  name: string;
  studio_id: string;
}

/** Brief employee info (fallback when no active shifts). */
export interface EmployeeBriefRow {
  id: string;
  name: string;
}

/** Active task count for employee load scoring. */
export interface TaskCountRow {
  cnt: string;
}

/** Order history summary for priority scoring. */
export interface OrderHistoryStatsRow {
  cnt: string;
  total: string;
}

// ── Follow-up candidates ───────────────────────────────────────────────

/** Abandoned chat (last message from bot/operator, no visitor reply). */
export interface AbandonedChatRow {
  session_id: string;
  visitor_name: string;
}

/** No-show booking (overdue today, not completed/cancelled). */
export interface NoShowBookingRow {
  id: string;
  client_name: string;
  start_time: string;
}

// ── Insights ───────────────────────────────────────────────────────────

/** Daily order stats with revenue. */
export interface DailyOrderStatsRow {
  day: string;
  cnt: string;
  revenue: string;
}

/** Daily count (bookings or chats). */
export interface DailyCountRow {
  day: string;
  cnt: string;
}
