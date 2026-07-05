/**
 * kpi-computation.service.ts — Enterprise KPI computation engine
 *
 * 28 metrics across 6 categories, computed per employee for date ranges.
 * Used by: kpi-snapshot-scheduler (daily/weekly/monthly) + real-time API.
 */

import db from '../database/db.js';
import type {
  MetricDefinitionRow, MetricCodeRow, SnapshotRow,
  CompositeHistoryRow, StaffUserRow, ShiftDateRow,
} from '../types/views/index.js';

const TAG = '[KPI]';

// ─── Types ──────────────────────────────────────────────────────────

export interface MetricResult {
  code: string;
  value: number;
  sampleSize: number;
}

export interface MetricDefinition {
  code: string;
  name: string;
  nameRu: string;
  category: string;
  unit: string;
  direction: 'higher_better' | 'lower_better';
  defaultWeight: number;
  applicableRoles: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface TargetConfig {
  targetValue: number;
  stretchValue: number | null;
  minimumValue: number | null;
}

export interface CompositeResult {
  compositeScore: number;
  rating: string;
  categoryScores: Record<string, number>;
  weightsSnapshot: Record<string, number>;
}

export interface AlertInput {
  employeeId: string;
  metricCode: string;
  alertType: 'underperformance' | 'excellence' | 'trend_decline' | 'target_missed';
  severity: 'info' | 'warning' | 'critical';
  periodType: string;
  periodStart: string;
  currentValue: number;
  targetValue: number | null;
  message: string;
}

type ComputeFn = (employeeId: string, start: string, end: string) => Promise<MetricResult>;

// ─── Metric Computer Registry ───────────────────────────────────────

const METRIC_COMPUTERS: Record<string, ComputeFn> = {
  // Productivity
  prod_tasks_completed: computeTasksCompleted,
  prod_orders_processed: computeOrdersProcessed,
  prod_chats_resolved: computeChatsResolved,
  prod_bookings_conducted: computeBookingsConducted,
  prod_messages_sent: computeMessagesSent,
  prod_approval_sessions: computeApprovalSessions,
  // Quality
  qual_approval_rate: computeApprovalRate,
  qual_first_time_right: computeFirstTimeRight,
  qual_revision_rate: computeRevisionRate,
  qual_rework_count: computeReworkCount,
  qual_quest_completion: computeQuestCompletion,
  // Speed
  speed_chat_first_response: computeChatFirstResponse,
  speed_chat_resolution: computeChatResolution,
  speed_order_turnaround: computeOrderTurnaround,
  speed_approval_turnaround: computeApprovalTurnaround,
  speed_task_completion: computeTaskCompletionTime,
  // Revenue
  rev_total: computeRevTotal,
  rev_avg_check: computeAvgCheck,
  rev_collection_rate: computeCollectionRate,
  rev_upsell_count: computeUpsellCount,
  // Satisfaction
  sat_avg_rating: computeAvgRating,
  sat_feedback_count: computeFeedbackCount,
  sat_csat: computeCsat,
  sat_nps_proxy: computeNpsProxy,
  // Attendance
  att_shift_completion: computeShiftCompletion,
  att_hours_worked: computeHoursWorked,
  att_streak: computeStreak,
  att_punctuality: computePunctuality,
};

// ─── Public API ─────────────────────────────────────────────────────

export async function computeMetric(
  employeeId: string,
  metricCode: string,
  start: string,
  end: string,
): Promise<MetricResult> {
  const fn = METRIC_COMPUTERS[metricCode];
  if (!fn) throw new Error(`Unknown metric: ${metricCode}`);
  return fn(employeeId, start, end);
}

export async function computeAllMetrics(
  employeeId: string,
  start: string,
  end: string,
  applicableMetrics?: string[],
): Promise<MetricResult[]> {
  const codes = applicableMetrics || Object.keys(METRIC_COMPUTERS);
  const results = await Promise.allSettled(
    codes.map(code => computeMetric(employeeId, code, start, end)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<MetricResult> => r.status === 'fulfilled')
    .map(r => r.value);
}

export async function getMetricDefinitions(activeOnly = true): Promise<MetricDefinition[]> {
  const rows = await db.query<MetricDefinitionRow>(
    `SELECT code, name, name_ru, category, unit, direction, default_weight,
            applicable_roles, is_active, sort_order
     FROM kpi_metric_definitions
     ${activeOnly ? 'WHERE is_active = true' : ''}
     ORDER BY sort_order`,
  );
  return rows.map(r => ({
    code: r.code,
    name: r.name,
    nameRu: r.name_ru,
    category: r.category,
    unit: r.unit,
    direction: r.direction as 'higher_better' | 'lower_better',
    defaultWeight: parseFloat(r.default_weight),
    applicableRoles: r.applicable_roles,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
}

export async function getApplicableMetrics(role: string): Promise<string[]> {
  const rows = await db.query<MetricCodeRow>(
    `SELECT code FROM kpi_metric_definitions
     WHERE is_active = true AND $1 = ANY(applicable_roles)
     ORDER BY sort_order`,
    [role],
  );
  return rows.map(r => r.code);
}

// ─── Target Resolution ──────────────────────────────────────────────

export async function resolveTarget(
  metricCode: string,
  employeeId: string,
  role: string,
  date: string,
): Promise<TargetConfig | null> {
  // Most specific wins: employee > role > global
  const row = await db.queryOne<{
    target_value: string;
    stretch_value: string | null;
    minimum_value: string | null;
  }>(
    `SELECT target_value, stretch_value, minimum_value
     FROM kpi_targets
     WHERE metric_code = $1
       AND effective_from <= $4::date
       AND (effective_until IS NULL OR effective_until >= $4::date)
       AND (
         (scope = 'employee' AND scope_value = $2)
         OR (scope = 'role' AND scope_value = $3)
         OR (scope = 'global' AND scope_value IS NULL)
       )
     ORDER BY
       CASE scope WHEN 'employee' THEN 1 WHEN 'role' THEN 2 ELSE 3 END
     LIMIT 1`,
    [metricCode, employeeId, role, date],
  );
  if (!row) return null;
  return {
    targetValue: parseFloat(row.target_value),
    stretchValue: row.stretch_value ? parseFloat(row.stretch_value) : null,
    minimumValue: row.minimum_value ? parseFloat(row.minimum_value) : null,
  };
}

// ─── Normalization & Composite Score ────────────────────────────────

export function normalizeValue(
  value: number,
  direction: 'higher_better' | 'lower_better',
  target: number,
): number {
  if (target === 0) return 0;
  if (direction === 'higher_better') {
    return Math.min(100, (value / target) * 100);
  }
  // lower_better: target is the ideal value, higher actual = worse
  if (value <= 0) return 100; // division guard
  return Math.min(100, (target / value) * 100);
}

export async function getWeights(role: string): Promise<Record<string, number>> {
  // Try role-specific profile first, fallback to global
  const row = await db.queryOne<{ weights: Record<string, number> }>(
    `SELECT weights FROM kpi_weight_profiles
     WHERE is_active = true
       AND ((scope = 'role' AND scope_value = $1) OR (scope = 'global' AND scope_value IS NULL))
     ORDER BY CASE scope WHEN 'role' THEN 1 ELSE 2 END
     LIMIT 1`,
    [role],
  );
  return row?.weights || {};
}

export async function computeCompositeScore(
  employeeId: string,
  role: string,
  metrics: MetricResult[],
  definitions: MetricDefinition[],
  date: string,
): Promise<CompositeResult> {
  const weights = await getWeights(role);
  const defMap = new Map(definitions.map(d => [d.code, d]));

  let totalWeighted = 0;
  let totalWeight = 0;
  const categoryWeighted: Record<string, number> = {};
  const categoryWeight: Record<string, number> = {};

  for (const m of metrics) {
    const def = defMap.get(m.code);
    if (!def) continue;

    // Skip metrics with no source data — zero-sample metrics must not
    // penalize the composite score. An employee with 0 orders is not
    // "failing at orders" — they simply had no orders to process.
    if (m.sampleSize === 0 && m.value === 0) continue;

    const w = weights[m.code] ?? def.defaultWeight;
    const target = await resolveTarget(m.code, employeeId, role, date);
    if (!target) continue;

    const normalized = normalizeValue(m.value, def.direction, target.targetValue);
    totalWeighted += normalized * w;
    totalWeight += w;

    if (!categoryWeighted[def.category]) {
      categoryWeighted[def.category] = 0;
      categoryWeight[def.category] = 0;
    }
    categoryWeighted[def.category] += normalized * w;
    categoryWeight[def.category] += w;
  }

  const compositeScore = totalWeight > 0 ? Math.round((totalWeighted / totalWeight) * 100) / 100 : 0;
  const categoryScores: Record<string, number> = {};
  for (const cat of Object.keys(categoryWeighted)) {
    categoryScores[cat] = categoryWeight[cat] > 0
      ? Math.round((categoryWeighted[cat] / categoryWeight[cat]) * 100) / 100
      : 0;
  }

  let rating: string;
  if (compositeScore >= 90) rating = 'exceptional';
  else if (compositeScore >= 75) rating = 'good';
  else if (compositeScore >= 60) rating = 'meeting';
  else if (compositeScore >= 40) rating = 'below';
  else rating = 'critical';

  return { compositeScore, rating, categoryScores, weightsSnapshot: weights };
}

// ─── Alert Generation ───────────────────────────────────────────────

export async function generateAlerts(
  employeeId: string,
  role: string,
  metrics: MetricResult[],
  definitions: MetricDefinition[],
  periodType: string,
  periodStart: string,
): Promise<AlertInput[]> {
  const alerts: AlertInput[] = [];
  const defMap = new Map(definitions.map(d => [d.code, d]));

  for (const m of metrics) {
    const def = defMap.get(m.code);
    if (!def) continue;

    // Skip metrics with no source data — no alerts for missing activity
    if (m.sampleSize === 0 && m.value === 0) continue;

    const target = await resolveTarget(m.code, employeeId, role, periodStart);
    if (!target) continue;

    const normalized = normalizeValue(m.value, def.direction, target.targetValue);

    // Underperformance
    if (target.minimumValue !== null) {
      const minNorm = normalizeValue(
        def.direction === 'higher_better' ? target.minimumValue : target.minimumValue,
        def.direction,
        target.targetValue,
      );
      if (normalized < minNorm) {
        const severity = normalized < minNorm * 0.5 ? 'critical' : 'warning';
        alerts.push({
          employeeId,
          metricCode: m.code,
          alertType: 'underperformance',
          severity,
          periodType,
          periodStart,
          currentValue: m.value,
          targetValue: target.targetValue,
          message: `${def.nameRu}: ${formatValue(m.value, def.unit)} (цель: ${formatValue(target.targetValue, def.unit)})`,
        });
      }
    }

    // Excellence
    if (target.stretchValue !== null) {
      const stretchNorm = normalizeValue(
        def.direction === 'higher_better' ? target.stretchValue : target.stretchValue,
        def.direction,
        target.targetValue,
      );
      if (normalized >= stretchNorm) {
        alerts.push({
          employeeId,
          metricCode: m.code,
          alertType: 'excellence',
          severity: 'info',
          periodType,
          periodStart,
          currentValue: m.value,
          targetValue: target.stretchValue,
          message: `${def.nameRu}: отличный результат ${formatValue(m.value, def.unit)}!`,
        });
      }
    }
  }

  return alerts;
}

export async function saveAlerts(alerts: AlertInput[]): Promise<void> {
  for (const a of alerts) {
    await db.query(
      `INSERT INTO kpi_alerts
         (employee_id, metric_code, alert_type, severity, period_type, period_start,
          current_value, target_value, message)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [a.employeeId, a.metricCode, a.alertType, a.severity, a.periodType,
       a.periodStart, a.currentValue, a.targetValue, a.message],
    );
  }
}

function formatValue(value: number, unit: string): string {
  switch (unit) {
    case 'percent': return `${Math.round(value)}%`;
    case 'seconds': {
      if (value < 60) return `${Math.round(value)} сек`;
      if (value < 3600) return `${Math.round(value / 60)} мин`;
      return `${(value / 3600).toFixed(1)} ч`;
    }
    case 'rubles': return `${Math.round(value)} ₽`;
    case 'hours': return `${value.toFixed(1)} ч`;
    default: return `${Math.round(value * 100) / 100}`;
  }
}

// ─── Snapshot Persistence ───────────────────────────────────────────

export async function saveSnapshots(
  employeeId: string,
  metrics: MetricResult[],
  periodType: string,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  for (const m of metrics) {
    await db.query(
      `INSERT INTO kpi_snapshots
         (employee_id, metric_code, period_type, period_start, period_end, value, sample_size)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7)
       ON CONFLICT (employee_id, metric_code, period_type, period_start)
       DO UPDATE SET value = $6, sample_size = $7, computed_at = NOW()`,
      [employeeId, m.code, periodType, periodStart, periodEnd, m.value, m.sampleSize],
    );
  }
}

export async function saveCompositeScore(
  employeeId: string,
  periodType: string,
  periodStart: string,
  periodEnd: string,
  composite: CompositeResult,
): Promise<void> {
  await db.query(
    `INSERT INTO kpi_composite_scores
       (employee_id, period_type, period_start, period_end,
        composite_score, rating, category_scores, weights_snapshot)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8)
     ON CONFLICT (employee_id, period_type, period_start)
     DO UPDATE SET composite_score = $5, rating = $6, category_scores = $7,
                   weights_snapshot = $8, computed_at = NOW()`,
    [employeeId, periodType, periodStart, periodEnd,
     composite.compositeScore, composite.rating,
     JSON.stringify(composite.categoryScores),
     JSON.stringify(composite.weightsSnapshot)],
  );
}

export async function getSnapshots(
  employeeId: string,
  periodType: string,
  count: number,
  metricCode?: string,
): Promise<Array<{ metricCode: string; periodStart: string; value: number; sampleSize: number }>> {
  const rows = await db.query<SnapshotRow>(
    `SELECT metric_code, period_start::text, value, sample_size
     FROM kpi_snapshots
     WHERE employee_id = $1 AND period_type = $2
       ${metricCode ? 'AND metric_code = $4' : ''}
     ORDER BY period_start DESC
     LIMIT $3`,
    metricCode ? [employeeId, periodType, count, metricCode] : [employeeId, periodType, count],
  );
  return rows.map(r => ({
    metricCode: r.metric_code,
    periodStart: r.period_start,
    value: parseFloat(r.value),
    sampleSize: r.sample_size,
  }));
}

export async function getCompositeHistory(
  employeeId: string,
  periodType: string,
  from: string,
  to: string,
): Promise<Array<{
  periodStart: string; compositeScore: number; rating: string;
  categoryScores: Record<string, number>;
}>> {
  const rows = await db.query<CompositeHistoryRow>(
    `SELECT period_start::text, composite_score, rating, category_scores
     FROM kpi_composite_scores
     WHERE employee_id = $1 AND period_type = $2
       AND period_start >= $3::date AND period_start <= $4::date
     ORDER BY period_start DESC`,
    [employeeId, periodType, from, to],
  );
  return rows.map(r => ({
    periodStart: r.period_start,
    compositeScore: parseFloat(r.composite_score),
    rating: r.rating,
    categoryScores: r.category_scores,
  }));
}

// ─── Staff Users ────────────────────────────────────────────────────

export async function getStaffUsers(): Promise<Array<{ id: string; role: string; displayName: string; photoUrl: string | null }>> {
  const rows = await db.query<StaffUserRow>(
    `SELECT id, role, display_name, photo_url FROM users
     WHERE role IN ('employee','photographer','admin','manager') AND is_active = true`,
  );
  return rows.map(r => ({
    id: r.id,
    role: r.role,
    displayName: r.display_name || 'Сотрудник',
    photoUrl: r.photo_url,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// METRIC COMPUTATION FUNCTIONS (28)
// All: (employeeId, start, end) → { code, value, sampleSize }
// Dates are inclusive: start <= x <= end (or x::date BETWEEN)
// ═══════════════════════════════════════════════════════════════════════

// ─── Productivity ───────────────────────────────────────────────────

async function computeTasksCompleted(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM work_tasks
     WHERE assigned_to = $1 AND status = 'completed'
       AND completed_at >= $2::date AND completed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_tasks_completed', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeOrdersProcessed(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM photo_print_orders
     WHERE (processed_by = $1 OR assigned_employee_id = $1)
       AND processed_at >= $2::date AND processed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_orders_processed', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeChatsResolved(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM conversations
     WHERE assigned_operator_id = $1 AND status IN ('resolved','closed')
       AND resolved_at >= $2::date AND resolved_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_chats_resolved', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeBookingsConducted(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM bookings
     WHERE photographer_id IN (SELECT id FROM photographers WHERE user_id = $1)
       AND status = 'completed'
       AND start_time >= $2::date AND start_time < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_bookings_conducted', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeMessagesSent(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM messages
     WHERE sender_id = $1::text AND sender_type = 'operator'
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_messages_sent', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeApprovalSessions(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM photo_approval_sessions
     WHERE photographer_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'prod_approval_sessions', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

// ─── Quality ────────────────────────────────────────────────────────

async function computeApprovalRate(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ approved: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved') AS approved,
       COUNT(*) AS total
     FROM photo_approvals
     WHERE photographer_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  const approved = parseInt(row?.approved || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'qual_approval_rate', value: total > 0 ? Math.round((approved / total) * 100) : 0, sampleSize: total };
}

async function computeFirstTimeRight(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ ftr: string; total: string }>(
    `SELECT
       COUNT(DISTINCT approval_session_id) FILTER (WHERE status = 'approved' AND revision_round = 1) AS ftr,
       COUNT(DISTINCT approval_session_id) AS total
     FROM photo_approvals
     WHERE photographer_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  const ftr = parseInt(row?.ftr || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'qual_first_time_right', value: total > 0 ? Math.round((ftr / total) * 100) : 0, sampleSize: total };
}

async function computeRevisionRate(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_rounds: string; cnt: string }>(
    `SELECT AVG(current_revision_round) AS avg_rounds, COUNT(*) AS cnt
     FROM photo_approval_sessions
     WHERE photographer_id = $1 AND status IN ('approved','completed')
       AND completed_at >= $2::date AND completed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'qual_revision_rate',
    value: parseFloat(row?.avg_rounds || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeReworkCount(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM photo_approvals
     WHERE photographer_id = $1 AND status = 'changes_requested'
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'qual_rework_count', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeQuestCompletion(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ completed: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE completed) AS completed,
       COUNT(*) AS total
     FROM employee_daily_quests
     WHERE employee_id = $1
       AND quest_date >= $2::date AND quest_date <= $3::date`,
    [eid, start, end],
  );
  const completed = parseInt(row?.completed || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'qual_quest_completion', value: total > 0 ? Math.round((completed / total) * 100) : 0, sampleSize: total };
}

// ─── Speed ──────────────────────────────────────────────────────────

async function computeChatFirstResponse(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_secs: string; cnt: string }>(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) AS avg_secs,
       COUNT(*) AS cnt
     FROM conversations
     WHERE assigned_operator_id = $1
       AND first_response_at IS NOT NULL
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'speed_chat_first_response',
    value: parseFloat(row?.avg_secs || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeChatResolution(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_secs: string; cnt: string }>(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) AS avg_secs,
       COUNT(*) AS cnt
     FROM conversations
     WHERE assigned_operator_id = $1
       AND resolved_at IS NOT NULL
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'speed_chat_resolution',
    value: parseFloat(row?.avg_secs || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeOrderTurnaround(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_secs: string; cnt: string }>(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) AS avg_secs,
       COUNT(*) AS cnt
     FROM photo_print_orders
     WHERE (processed_by = $1 OR assigned_employee_id = $1)
       AND processed_at IS NOT NULL
       AND processed_at >= $2::date AND processed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'speed_order_turnaround',
    value: parseFloat(row?.avg_secs || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeApprovalTurnaround(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_secs: string; cnt: string }>(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) AS avg_secs,
       COUNT(*) AS cnt
     FROM photo_approval_sessions
     WHERE photographer_id = $1
       AND completed_at IS NOT NULL
       AND completed_at >= $2::date AND completed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'speed_approval_turnaround',
    value: parseFloat(row?.avg_secs || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeTaskCompletionTime(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_secs: string; cnt: string }>(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) AS avg_secs,
       COUNT(*) AS cnt
     FROM work_tasks
     WHERE assigned_to = $1 AND completed_at IS NOT NULL
       AND completed_at >= $2::date AND completed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'speed_task_completion',
    value: parseFloat(row?.avg_secs || '0'),
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

// ─── Revenue ────────────────────────────────────────────────────────

async function computeRevTotal(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ total: string; cnt: string }>(
    `SELECT COALESCE(SUM(total_price), 0) AS total, COUNT(*) AS cnt
     FROM photo_print_orders
     WHERE (assigned_employee_id = $1 OR processed_by = $1)
       AND payment_status = 'paid'
       AND processed_at >= $2::date AND processed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'rev_total', value: parseFloat(row?.total || '0'), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeAvgCheck(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_price: string; cnt: string }>(
    `SELECT COALESCE(AVG(total_price), 0) AS avg_price, COUNT(*) AS cnt
     FROM photo_print_orders
     WHERE (assigned_employee_id = $1 OR processed_by = $1)
       AND payment_status = 'paid'
       AND processed_at >= $2::date AND processed_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'rev_avg_check', value: parseFloat(row?.avg_price || '0'), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeCollectionRate(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ paid: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid,
       COUNT(*) AS total
     FROM photo_print_orders
     WHERE (assigned_employee_id = $1 OR processed_by = $1)
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  const paid = parseInt(row?.paid || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'rev_collection_rate', value: total > 0 ? Math.round((paid / total) * 100) : 0, sampleSize: total };
}

async function computeUpsellCount(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM bookings
     WHERE photographer_id IN (SELECT id FROM photographers WHERE user_id = $1)
       AND service_name ILIKE '%портрет%'
       AND status != 'cancelled'
       AND start_time >= $2::date AND start_time < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'rev_upsell_count', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

// ─── Satisfaction ───────────────────────────────────────────────────

async function computeAvgRating(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_rating: string; cnt: string }>(
    `SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS cnt
     FROM customer_feedback
     WHERE employee_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'sat_avg_rating',
    value: Math.round(parseFloat(row?.avg_rating || '0') * 10) / 10,
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeFeedbackCount(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM customer_feedback
     WHERE employee_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return { code: 'sat_feedback_count', value: parseInt(row?.cnt || '0', 10), sampleSize: parseInt(row?.cnt || '0', 10) };
}

async function computeCsat(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ avg_csat: string; cnt: string }>(
    `SELECT COALESCE(AVG(csat_score), 0) AS avg_csat, COUNT(*) AS cnt
     FROM conversations
     WHERE assigned_operator_id = $1
       AND csat_score IS NOT NULL
       AND csat_submitted_at >= $2::date AND csat_submitted_at < ($3::date + 1)`,
    [eid, start, end],
  );
  return {
    code: 'sat_csat',
    value: Math.round(parseFloat(row?.avg_csat || '0') * 10) / 10,
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeNpsProxy(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ five_star: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE rating = 5) AS five_star,
       COUNT(*) AS total
     FROM customer_feedback
     WHERE employee_id = $1
       AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [eid, start, end],
  );
  const fiveStar = parseInt(row?.five_star || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'sat_nps_proxy', value: total > 0 ? Math.round((fiveStar / total) * 100) : 0, sampleSize: total };
}

// ─── Attendance ─────────────────────────────────────────────────────

async function computeShiftCompletion(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ completed: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) AS total
     FROM employee_shifts
     WHERE employee_id = $1 AND status != 'cancelled'
       AND shift_date >= $2::date AND shift_date <= $3::date`,
    [eid, start, end],
  );
  const completed = parseInt(row?.completed || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'att_shift_completion', value: total > 0 ? Math.round((completed / total) * 100) : 0, sampleSize: total };
}

async function computeHoursWorked(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ total_hours: string; cnt: string }>(
    `SELECT
       COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600), 0) AS total_hours,
       COUNT(*) AS cnt
     FROM employee_shifts
     WHERE employee_id = $1 AND status = 'completed'
       AND shift_date >= $2::date AND shift_date <= $3::date`,
    [eid, start, end],
  );
  return {
    code: 'att_hours_worked',
    value: Math.round(parseFloat(row?.total_hours || '0') * 10) / 10,
    sampleSize: parseInt(row?.cnt || '0', 10),
  };
}

async function computeStreak(eid: string, _start: string, end: string): Promise<MetricResult> {
  // Count consecutive days with completed shifts up to end date
  const rows = await db.query<ShiftDateRow>(
    `SELECT DISTINCT shift_date::text FROM employee_shifts
     WHERE employee_id = $1 AND status = 'completed' AND shift_date <= $2::date
     ORDER BY shift_date DESC
     LIMIT 60`,
    [eid, end],
  );
  let streak = 0;
  const today = new Date(end);
  for (let i = 0; i < rows.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split('T')[0];
    if (rows[i].shift_date === expectedStr) {
      streak++;
    } else {
      break;
    }
  }
  return { code: 'att_streak', value: streak, sampleSize: rows.length };
}

async function computePunctuality(eid: string, start: string, end: string): Promise<MetricResult> {
  const row = await db.queryOne<{ on_time: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL AND checked_in_at::time <= start_time + interval '5 minutes') AS on_time,
       COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL) AS total
     FROM employee_shifts
     WHERE employee_id = $1 AND status IN ('active','completed')
       AND shift_date >= $2::date AND shift_date <= $3::date`,
    [eid, start, end],
  );
  const onTime = parseInt(row?.on_time || '0', 10);
  const total = parseInt(row?.total || '0', 10);
  return { code: 'att_punctuality', value: total > 0 ? Math.round((onTime / total) * 100) : 0, sampleSize: total };
}
