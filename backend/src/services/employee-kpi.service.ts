/**
 * employee-kpi.service.ts — Real-time KPI computation + customer feedback collection
 *
 * Data sources:
 * - retouchConversion: photo_approvals (approved / total, 30d)
 * - reviewsCollected:  customer_feedback today (review_click, manual, approval_approved)
 * - reviewsTarget:     employee_daily_quests or default 5
 * - portraitUpsells:    bookings with portrait services today
 * - satisfactionScore:  review_platform_stats weighted average
 *
 * Satisfaction feed: customer_feedback table (auto + manual entries)
 */

import db from '../database/db.js';

const TAG = '[EmployeeKPI]';

// ─── Types ──────────────────────────────────────────────────────────

export interface EmployeeKpi {
  retouchConversion: number;
  reviewsCollected: number;
  reviewsTarget: number;
  portraitUpsells: number;
  satisfactionScore: number;
}

export interface SatisfactionEntry {
  id: string;
  clientName: string;
  rating: number;
  service: string;
  source: string;
  time: string;
  comment: string | null;
}

export interface RecordFeedbackOpts {
  clientName?: string;
  clientPhone?: string;
  clientId?: string;
  employeeId?: string;
  rating: number;
  service?: string;
  source: string;
  entityType?: string;
  entityId?: string;
  comment?: string;
}

// ─── KPI Computation (delegates to enterprise kpi-computation.service) ─

import { computeMetric as computeKpiMetric } from './kpi-computation.service.js';

import { createLogger } from '../utils/logger.js';

const logger = createLogger('employee-kpi.service');

export async function getEmployeeKpi(employeeId: string): Promise<EmployeeKpi> {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [retouch, reviews, satisfaction, upsells] = await Promise.all([
    computeKpiMetric(employeeId, 'qual_approval_rate', thirtyDaysAgo, today)
      .then(r => r.value).catch(() => 0),
    computeKpiMetric(employeeId, 'sat_feedback_count', today, today)
      .then(r => r.value).catch(() => 0),
    computeKpiMetric(employeeId, 'sat_avg_rating', thirtyDaysAgo, today)
      .then(r => r.value).catch(() => 0),
    computeKpiMetric(employeeId, 'rev_upsell_count', today, today)
      .then(r => r.value).catch(() => 0),
  ]);

  const targetRow = await db.queryOne<{ target: number }>(
    `SELECT target FROM employee_daily_quests
     WHERE employee_id = $1 AND quest_date = CURRENT_DATE AND quest_type = 'collect_reviews'`,
    [employeeId],
  );

  return {
    retouchConversion: retouch,
    reviewsCollected: reviews,
    reviewsTarget: targetRow?.target ?? 5,
    portraitUpsells: upsells,
    satisfactionScore: satisfaction,
  };
}

// ─── Satisfaction Feed ──────────────────────────────────────────────

export async function getSatisfactionFeed(limit = 20): Promise<SatisfactionEntry[]> {
  const rows = await db.query<{
    id: string;
    client_name: string;
    rating: number;
    service: string;
    source: string;
    comment: string | null;
    created_at: string;
  }>(
    `SELECT id, client_name, rating, service, source, comment, created_at
     FROM customer_feedback
     WHERE source IN ('manual', 'nps_positive', 'nps_negative', 'review_click')
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );

  return rows.map(r => ({
    id: r.id,
    clientName: r.client_name || 'Клиент',
    rating: r.rating,
    service: r.service || '',
    source: r.source,
    time: new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    comment: r.comment,
  }));
}

// ─── Record Feedback ────────────────────────────────────────────────

export async function recordFeedback(opts: RecordFeedbackOpts): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO customer_feedback
       (client_name, client_phone, client_id, employee_id, rating, service, source, entity_type, entity_id, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      opts.clientName || null,
      opts.clientPhone || null,
      opts.clientId || null,
      opts.employeeId || null,
      opts.rating,
      opts.service || null,
      opts.source,
      opts.entityType || null,
      opts.entityId || null,
      opts.comment || null,
    ],
  );
  logger.info(`${TAG} Recorded feedback: ${opts.source}, rating=${opts.rating}, client=${opts.clientName}`);
  return row!.id;
}

// ─── Auto-feedback helpers (called from hooks) ──────────────────────

export async function recordApprovalFeedback(
  sessionId: string,
  finalStatus: string,
  clientName: string,
  clientId: string | null,
  photographerId: string | null,
): Promise<void> {
  const ratingMap: Record<string, number> = {
    approved: 5,
    partially_approved: 4,
    changes_requested: 3,
  };
  const sourceMap: Record<string, string> = {
    approved: 'approval_approved',
    partially_approved: 'approval_approved',
    changes_requested: 'approval_changes',
  };
  const rating = ratingMap[finalStatus];
  const source = sourceMap[finalStatus];
  if (!rating || !source) return;

  // Deduplicate: one feedback per approval session completion
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM customer_feedback
     WHERE entity_type = 'approval_session' AND entity_id = $1`,
    [sessionId],
  );
  if (existing) return;

  await recordFeedback({
    clientName,
    clientId: clientId || undefined,
    employeeId: photographerId || undefined,
    rating,
    service: 'Ретушь',
    source,
    entityType: 'approval_session',
    entityId: sessionId,
  });
}

export async function recordOrderCompletedFeedback(
  orderId: string,
  contactName: string | null,
  contactPhone: string | null,
  employeeId: string,
): Promise<void> {
  // Deduplicate
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM customer_feedback
     WHERE entity_type = 'order' AND entity_id = $1::uuid`,
    [orderId],
  );
  if (existing) return;

  await recordFeedback({
    clientName: contactName || 'Клиент',
    clientPhone: contactPhone || undefined,
    employeeId,
    rating: 4,
    service: 'Заказ',
    source: 'order_completed',
    entityType: 'order',
    entityId: orderId,
  });
}

export async function recordReviewClickFeedback(
  clientName: string | null,
  clientPhone: string | null,
  reviewRequestId: string,
  employeeId?: string | null,
): Promise<void> {
  // Deduplicate
  const existing = await db.queryOne<{ id: string }>(
    `SELECT id FROM customer_feedback
     WHERE entity_type = 'review_request' AND entity_id = $1::uuid`,
    [reviewRequestId],
  );
  if (existing) return;

  await recordFeedback({
    clientName: clientName || 'Клиент',
    clientPhone: clientPhone || undefined,
    employeeId: employeeId || undefined,
    rating: 5,
    service: 'Отзыв',
    source: 'review_click',
    entityType: 'review_request',
    entityId: reviewRequestId,
  });
}
