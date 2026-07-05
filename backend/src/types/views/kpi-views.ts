/** View types for KPI & gamification domains. */

import type KpiCompositeScores from '../generated/public/KpiCompositeScores.js';

// ── KPI Computation ────────────────────────────────────────────────────

/** Metric definition row projection (active definitions query).
 *  Standalone because Kanel marks applicable_roles/is_active/sort_order nullable. */
export interface MetricDefinitionRow {
  code: string;
  name: string;
  name_ru: string;
  category: string;
  unit: string;
  direction: string;
  default_weight: string;
  applicable_roles: string[];
  is_active: boolean;
  sort_order: number;
}

/** Metric code only (for applicable-metrics query). */
export interface MetricCodeRow {
  code: string;
}

/** Snapshot row projection (history queries). */
export interface SnapshotRow {
  metric_code: string;
  period_start: string;
  value: string;
  sample_size: number;
}

/** Composite score history row. */
export interface CompositeHistoryRow {
  period_start: string;
  composite_score: string;
  rating: string;
  category_scores: Record<string, number>;
}

/** Staff user for KPI (active employees/photographers/admins/managers). */
export interface StaffUserRow {
  id: string;
  role: string;
  display_name: string;
  photo_url: string | null;
}

/** Distinct shift dates for streak computation. */
export interface ShiftDateRow {
  shift_date: string;
}

// ── Gamification ───────────────────────────────────────────────────────

/** Quest that was just completed (progress == target check). */
export interface QuestCompletedRow {
  id: string;
  xp_reward: number;
}

/** Distinct day from XP log (streak computation). */
export interface XpDayRow {
  day: string;
}

/** Total XP sum (single-field projection). */
export interface XpTotalRow {
  total: number;
}

/** Leaderboard entry from XP log aggregation. */
export interface LeaderboardRow {
  employee_id: string;
  display_name: string;
  photo_url: string | null;
  total_xp: string;
}

/** Uncompleted quest for aggregate evaluation. */
export interface UncompletedQuestRow {
  id: string;
  quest_type: string;
  xp_reward: number;
  target: number;
  progress: number;
}

/** Locked achievement row for achievement checking. */
export interface LockedAchievementRow {
  id: string;
  code: string;
  condition: unknown;
  xp_reward: number;
}

/** Composite score value (single-field projection). */
export type CompositeScoreValue = Pick<KpiCompositeScores, 'composite_score'>;

// ── Employee Profile (my-profile endpoint) ──────────────────────────

/** Aggregated employee profile from CTE-based SQL query. */
export interface EmployeeProfileRow {
  total_shifts: string;
  completed_shifts: string;
  total_hours: string;
  avg_shift_duration: string;
  attendance_pct: string;
  punctuality_pct: string;
  current_streak: string;
  longest_streak: string;
  total_xp: string;
  xp_this_month: string;
  leaderboard_rank: string;
  total_revenue: string;
  orders_count: string;
  quests_completed_total: string;
}

/** XP log entry for activity feed. */
export interface XpLogEntryRow {
  xp_amount: number;
  action_type: string;
  entity_id: string | null;
  description: string | null;
  created_at: string;
}

/** Shift history row with studio join. */
export interface ShiftHistoryRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_at: string;
  studio_name: string | null;
  location_code: string | null;
}

/** Count row for pagination total. */
export interface CountRow {
  count: string;
}
