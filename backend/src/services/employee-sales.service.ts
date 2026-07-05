/**
 * Employee Sales & Commission Service
 *
 * Tracks per-receipt sales attribution, commission calculation,
 * dashboards, leaderboards, and monthly payout management.
 */

import { PoolClient } from 'pg';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { PosReceiptsId } from '../types/generated/public/PosReceipts.js';
import type { IdResult } from '../types/views/index.js';
import type {
  EmployeeSalesHistoryPaymentLinkRow,
  EmployeeSalesHistoryPrintOrderRow,
  EmployeeSalesHistoryReceiptRow,
} from '../types/views/employee-sales-views.js';

const logger = createLogger('employee-sales');

// ─── Types ────────────────────────────────────────────────────────────────

/** Row shape returned from employee_sales table */
interface EmployeeSaleRow {
  id: string;
  receipt_id: PosReceiptsId;
  employee_id: UsersId;
  receipt_total: string;
  commission_rate: string;
  commission_amount: string;
  category_slug: string | null;
  created_at: string;
}

/** Commission rule from employee_commission_rules table */
interface CommissionRuleRow {
  id: string;
  employee_id: UsersId | null;
  role: string | null;
  category_slug: string | null;
  rate: string;
  min_receipt_total: string;
  is_active: boolean;
  priority: number;
}

interface SalesDashboardRow {
  receipts_count: string;
  total_sales: string;
  avg_receipt: string;
  total_commission: string;
  paid_invoices_count: string;
  paid_invoices_total: string;
  paid_invoices_avg: string;
  pending_links_count: string;
  pending_links_total: string;
  issued_invoices_count: string;
  issued_invoices_total: string;
}

interface CommissionPayoutSummaryRow {
  total_sales: string;
  total_receipts: string;
  total_commission: string;
  plan_target: string | null;
  plan_percent: string;
  plan_bonus: string;
  status: string;
}

interface SalesAggregateRow {
  total_sales: string;
  total_receipts: string;
  total_commission: string;
}

interface EmployeeSalesLeaderboardRow {
  employee_id: UsersId;
  display_name: string;
  photo_url: string | null;
  receipts_count: string;
  total_sales: string;
  total_commission: string;
}

interface PayoutStatusRow {
  status: string;
}

/** Dashboard aggregation for a single day */
export interface SalesDashboard {
  receipts_count: number;
  total_sales: number;
  avg_receipt: number;
  total_commission: number;
  paid_invoices_count: number;
  paid_invoices_total: number;
  paid_invoices_avg: number;
  pending_links_count: number;
  pending_links_total: number;
  issued_invoices_count: number;
  issued_invoices_total: number;
}

export interface EmployeeSalesHistory {
  receipts: EmployeeSalesHistoryReceiptRow[];
  links: EmployeeSalesHistoryPaymentLinkRow[];
  orders: EmployeeSalesHistoryPrintOrderRow[];
}

/** Monthly stats with plan progress */
export interface MonthlyStats {
  period: string;
  total_sales: number;
  total_receipts: number;
  total_commission: number;
  plan_target: number | null;
  plan_percent: number;
  plan_bonus: number;
  status: string;
}

/** Leaderboard entry */
export interface LeaderboardEntry {
  employee_id: UsersId;
  display_name: string;
  photo_url: string | null;
  receipts_count: number;
  total_sales: number;
  total_commission: number;
  rank: number;
}

// ─── Service ──────────────────────────────────────────────────────────────

/**
 * Full personal sales history for the current employee.
 * This mirrors the admin sales overview data, but applies employee ownership
 * in SQL so staff can always see their own work without reports:view.
 */
export async function getHistory(
  employeeId: string,
  dateFrom: string,
  dateTo: string,
  limit = 500,
): Promise<EmployeeSalesHistory> {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.trunc(limit)))
    : 500;

  const params: unknown[] = [employeeId, dateFrom, dateTo, safeLimit];

  const [receipts, links, orders] = await Promise.all([
    db.query<EmployeeSalesHistoryReceiptRow>(
      `SELECT r.id, r.receipt_number, r.shift_id, r.employee_id, u.display_name AS employee_name,
              r.studio_id, s.name AS studio_name,
              r.customer_phone, r.customer_name, r.loyalty_profile_id, r.subscription_id,
              r.is_refund, r.refund_receipt_id, r.subtotal, r.discount_total,
              r.points_discount, r.subscription_credit_used, r.total,
              r.fiscal_receipt_url, r.fiscal_receipt_number, r.fiscal_sign, r.fiscal_source,
              r.fiscal_status, r.fiscal_attempts, r.fiscal_last_error,
              r.void_reason, r.voided_at, r.created_at,
              COALESCE(ri.items, '[]'::json) AS items,
              COALESCE(rp.payments, '[]'::json) AS payments
       FROM pos_receipts r
       LEFT JOIN users u ON u.id = r.employee_id
       LEFT JOIN studios s ON s.id = r.studio_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'product_id', i.product_id,
           'product_name', i.product_name,
           'quantity', i.quantity,
           'unit_price', i.unit_price,
           'discount_amount', i.discount_amount,
           'discount_percent', i.discount_percent,
           'points_used', i.points_used,
           'subscription_credits_used', i.subscription_credits_used,
           'total', i.total,
           'vat_rate', i.vat_rate,
           'vat_amount', i.vat_amount,
           'discount_type', i.discount_type,
           'discount_label', i.discount_label,
           'print_fill_percent', i.print_fill_percent
         ) ORDER BY i.sort_order NULLS LAST, i.id) AS items
         FROM pos_receipt_items i
         WHERE i.receipt_id = r.id
       ) ri ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'payment_type', p.payment_type,
           'amount', p.amount,
           'card_info', p.card_info,
           'transaction_id', p.transaction_id,
           'status', p.status
         ) ORDER BY p.amount DESC, p.id) AS payments
         FROM pos_receipt_payments p
         WHERE p.receipt_id = r.id
       ) rp ON true
       WHERE r.employee_id = $1::uuid
         AND r.created_at >= $2::timestamptz
         AND r.created_at <= $3::timestamptz
       ORDER BY r.created_at DESC
       LIMIT $4::int`,
      params,
    ),
    db.query<EmployeeSalesHistoryPaymentLinkRow>(
      `SELECT pl.id, pl.order_ref, pl.amount::text AS amount, pl.currency, pl.services, pl.description,
              pl.conversation_id, pl.contact_phone, pl.contact_name, pl.contact_email,
              pl.created_by, pl.status, pl.payment_id, pl.payment_method, pl.payment_card_info,
              pl.paid_at, pl.expires_at, pl.order_ref_linked, pl.metadata, pl.created_at, pl.updated_at,
              c.contact_id, u.display_name AS created_by_name,
              payment_shift.studio_id AS studio_id, shift_studio.name AS studio_name,
              COALESCE(ac.channels, ARRAY[]::text[]) AS available_channels
       FROM payment_links pl
       LEFT JOIN conversations c ON c.id = pl.conversation_id
       LEFT JOIN users u ON u.id = pl.created_by
       LEFT JOIN employee_shifts payment_shift ON payment_shift.id = pl.employee_shift_id
       LEFT JOIN studios shift_studio ON shift_studio.id = payment_shift.studio_id
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT conv.channel::text ORDER BY conv.channel::text) AS channels
         FROM conversations conv
         WHERE conv.contact_id = c.contact_id AND conv.status != 'closed'
       ) ac ON true
       WHERE (
         pl.created_by = $1::uuid
         OR EXISTS (
           SELECT 1
           FROM employee_shifts own_shift
           WHERE own_shift.id = pl.employee_shift_id
             AND own_shift.employee_id = $1::uuid
         )
       )
         AND pl.created_at >= $2::timestamptz
         AND pl.created_at <= $3::timestamptz
       ORDER BY pl.created_at DESC
       LIMIT $4::int`,
      params,
    ),
    db.query<EmployeeSalesHistoryPrintOrderRow>(
      `SELECT p.order_id, p.contact_name, p.contact_phone, p.contact_email,
              p.total_price, p.status, p.payment_status, p.priority,
              p.items, p.comments, p.delivery_address, p.delivery_cost,
              p.tracking_number, p.receipt_url, p.payment_card_info,
              p.promo_code, p.promo_discount, p.telegram_username,
              p.created_at, p.updated_at, p.paid_at, p.completed_at, p.id,
              p.assigned_employee_id, p.assigned_at, p.chat_session_id,
              p.reminder_sent_at, p.processing_started_at, p.processing_duration_minutes,
              p.description, p.source, p.wishes, p.medals_required, p.medals_description,
              p.uniform_description, p.document_template_id, p.photo_size,
              COALESCE(
                payment_meta.payment_method,
                CASE
                  WHEN p.payment_mode IN ('cash', 'card', 'sbp', 'transfer', 'online', 'subscription')
                    THEN p.payment_mode
                  ELSE NULL
                END
              ) AS payment_method,
              payment_meta.payment_channel,
              payment_meta.event_type AS payment_event_type,
              payment_meta.recorded_at AS payment_recorded_at,
              payment_meta.recorded_by AS payment_recorded_by,
              payment_user.display_name AS payment_recorded_by_name,
              dt.name as document_template_name,
              COALESCE(active_assignment.studio_id, delivery_studio.id) AS order_studio_id,
              COALESCE(assignment_studio.name, delivery_studio.name) AS order_studio_name,
              COALESCE(assignment_studio.address, delivery_studio.address) AS order_studio_address,
              COALESCE(assignment_studio.location_code, delivery_studio.location_code) AS order_location_code,
              u.display_name as assigned_employee_name,
              COALESCE(p.contact_phone, vcs.visitor_phone) as resolved_phone,
              vcs.user_id as resolved_user_id,
              COALESCE((t.metadata->>'escalation_level')::int, 0) as escalation_level,
              COALESCE(t.sla_deadline, p.estimated_ready_at, p.created_at + interval '30 minutes') as deadline,
              (SELECT attachment_url FROM messages
               WHERE conversation_id = p.chat_session_id AND message_type = 'image'
               ORDER BY created_at DESC LIMIT 1) as photo_url
       FROM photo_print_orders p
       LEFT JOIN users u ON u.id = p.assigned_employee_id
       LEFT JOIN work_tasks t ON t.print_order_id = p.id
         AND t.status NOT IN ('completed', 'cancelled')
       LEFT JOIN conversations vcs ON vcs.id = p.chat_session_id
       LEFT JOIN document_templates dt ON dt.id = p.document_template_id
       LEFT JOIN LATERAL (
         SELECT pe.event_type,
                pe.created_at AS recorded_at,
                COALESCE(pe.metadata->>'payment_method', pe.metadata->>'method') AS payment_method,
                pe.metadata->>'channel' AS payment_channel,
                COALESCE(pe.metadata->>'recorded_by', pe.metadata->>'marked_by') AS recorded_by
         FROM payment_events pe
         WHERE pe.order_id = p.order_id
           AND pe.event_type IN ('payment_confirmed', 'mark_paid_external', 'pos_auto_mark_paid')
         ORDER BY pe.created_at DESC NULLS LAST
         LIMIT 1
       ) payment_meta ON true
       LEFT JOIN users payment_user ON payment_user.id::text = payment_meta.recorded_by
       LEFT JOIN LATERAL (
         SELECT oa.studio_id
         FROM order_assignments oa
         WHERE oa.order_id = p.order_id
           AND oa.status NOT IN ('completed', 'cancelled')
         ORDER BY oa.assigned_at DESC NULLS LAST, oa.created_at DESC NULLS LAST
         LIMIT 1
       ) active_assignment ON true
       LEFT JOIN studios assignment_studio ON assignment_studio.id = active_assignment.studio_id
       LEFT JOIN LATERAL (
         SELECT s.id, s.name, s.address, s.location_code
         FROM studios s
         WHERE active_assignment.studio_id IS NULL
           AND p.delivery_address IS NOT NULL
           AND (
             p.delivery_address ILIKE '%' || s.address || '%'
             OR s.address ILIKE '%' || p.delivery_address || '%'
             OR p.delivery_address ILIKE '%' || s.name || '%'
           )
         ORDER BY length(COALESCE(s.address, '')) DESC
         LIMIT 1
       ) delivery_studio ON true
       WHERE NOT EXISTS (
           SELECT 1
           FROM payment_links linked
           WHERE linked.order_ref_linked = p.order_id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM payment_events pos_paid
           WHERE pos_paid.order_id = p.order_id
             AND pos_paid.event_type = 'pos_auto_mark_paid'
         )
         AND COALESCE(p.receipt_url, '') NOT LIKE '/pos/receipts/%'
         AND (
           p.initiated_by = $1::uuid
           OR p.assigned_employee_id = $1::uuid
           OR EXISTS (
             SELECT 1
             FROM employee_shifts own_shift
             WHERE own_shift.id = p.employee_shift_id
               AND own_shift.employee_id = $1::uuid
           )
           OR EXISTS (
             SELECT 1
             FROM payment_events own_payment
             WHERE own_payment.order_id = p.order_id
               AND own_payment.event_type IN ('payment_confirmed', 'mark_paid_external')
               AND COALESCE(
                 own_payment.metadata->>'recorded_by',
                 own_payment.metadata->>'marked_by'
               ) = ($1::uuid)::text
           )
         )
         AND p.created_at >= $2::timestamptz
         AND p.created_at <= $3::timestamptz
       ORDER BY p.created_at DESC NULLS LAST
       LIMIT $4::int`,
      params,
    ),
  ]);

  return { receipts, links, orders };
}

/**
 * Record a sale attribution in the employee_sales table.
 * Must be called INSIDE a transaction (receives PoolClient).
 */
export async function recordSale(
  receiptId: string,
  employeeId: string,
  receiptTotal: number,
  categorySlug: string | null,
  client: PoolClient,
  source: 'pos' | 'online' | 'manual' = 'pos',
  shiftIdOverride: string | null = null,
): Promise<void> {
  const rate = await getCommissionRate(employeeId, categorySlug, receiptTotal, client);

  let shiftId = shiftIdOverride;
  if (!shiftId) {
    const shiftRow = await client.query<IdResult>(
      `SELECT id FROM employee_shifts
       WHERE employee_id = $1
         AND shift_date = (NOW() AT TIME ZONE 'Europe/Moscow')::date
         AND (
           status IN ('active', 'scheduled')
           OR (status = 'completed' AND checked_out_at > NOW() - interval '2 hours')
         )
       ORDER BY CASE WHEN status = 'active' THEN 0 WHEN status = 'scheduled' THEN 1 ELSE 2 END
       LIMIT 1`,
      [employeeId],
    );
    shiftId = shiftRow.rows[0]?.id ?? null;
  }

  await client.query(
    `INSERT INTO employee_sales
       (receipt_id, employee_id, receipt_total, commission_rate, category_slug, shift_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (receipt_id) DO NOTHING`,
    [receiptId, employeeId, receiptTotal, rate, categorySlug, shiftId, source],
  );

  logger.info('Sale recorded', {
    receiptId, employeeId, receiptTotal,
    commissionRate: rate, categorySlug, shiftId, source,
  });
}

/**
 * Find the best matching commission rate for an employee.
 * Cascade: employee-specific (priority DESC) → role-based → global.
 * Accepts optional PoolClient for transactional reads.
 */
export async function getCommissionRate(
  employeeId: string,
  categorySlug: string | null,
  receiptTotal?: number,
  client?: PoolClient,
): Promise<number> {
  const queryFn = client
    ? <T>(sql: string, params: unknown[]) => client.query(sql, params).then(r => r.rows as T[])
    : <T>(sql: string, params: unknown[]) => db.query<T>(sql, params);

  // Fetch the employee's role for role-based fallback
  const userRows = await queryFn<{ role: string }>(
    `SELECT role FROM users WHERE id = $1`,
    [employeeId],
  );
  const userRole = userRows[0]?.role ?? null;

  // Find best matching rule: priority DESC, most specific first
  const rules = await queryFn<CommissionRuleRow>(
    `SELECT * FROM employee_commission_rules
     WHERE is_active = true
       AND (employee_id = $1 OR employee_id IS NULL)
       AND (role = $2 OR role IS NULL)
       AND (category_slug = $3 OR category_slug IS NULL)
       AND min_receipt_total <= $4
     ORDER BY priority DESC, employee_id IS NULL ASC, role IS NULL ASC, category_slug IS NULL ASC
     LIMIT 1`,
    [employeeId, userRole, categorySlug, receiptTotal ?? 0],
  );

  if (rules.length === 0) return 0;

  return parseFloat(rules[0].rate);
}

/**
 * Dashboard: today's (or specific date) sales summary for an employee.
 */
export async function getDashboard(
  employeeId: string,
  date?: string,
): Promise<SalesDashboard> {
  const targetDate = date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

  const row = await db.queryOne<SalesDashboardRow>(
    `WITH params AS (
       SELECT $1::uuid AS employee_id, $2::date AS target_date
     ),
     employee_payment_links AS (
       SELECT
         p.employee_id,
         pl.id::text AS source_id,
         pl.amount::numeric AS amount,
         pl.status,
         pl.created_at,
         pl.updated_at,
         pl.paid_at
       FROM payment_links pl
       JOIN params p ON true
       WHERE (
         pl.created_by = p.employee_id
         OR EXISTS (
           SELECT 1
           FROM employee_shifts shift
           WHERE shift.id = pl.employee_shift_id
             AND shift.employee_id = p.employee_id
         )
       )
     ),
     employee_print_orders AS (
       SELECT
         p.employee_id,
         ppo.id::text AS source_id,
         ppo.order_id,
         COALESCE(ppo.total_price, 0)::numeric AS amount,
         ppo.status,
         ppo.payment_status,
         ppo.created_at,
         ppo.updated_at,
         ppo.paid_at
       FROM photo_print_orders ppo
       JOIN params p ON true
       WHERE NOT EXISTS (
           SELECT 1
           FROM payment_links linked
           WHERE linked.order_ref_linked = ppo.order_id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM payment_events pos_paid
           WHERE pos_paid.order_id = ppo.order_id
             AND pos_paid.event_type = 'pos_auto_mark_paid'
         )
         AND COALESCE(ppo.receipt_url, '') NOT LIKE '/pos/receipts/%'
         AND (
           ppo.initiated_by = p.employee_id
           OR ppo.assigned_employee_id = p.employee_id
           OR EXISTS (
             SELECT 1
             FROM employee_shifts shift
             WHERE shift.id = ppo.employee_shift_id
               AND shift.employee_id = p.employee_id
           )
           OR EXISTS (
             SELECT 1
             FROM payment_events own_payment
             WHERE own_payment.order_id = ppo.order_id
               AND own_payment.event_type IN ('payment_confirmed', 'mark_paid_external')
               AND COALESCE(
                 own_payment.metadata->>'recorded_by',
                 own_payment.metadata->>'marked_by'
               ) = p.employee_id::text
           )
         )
     ),
     paid_source_rows AS (
       SELECT
         sale.receipt_id::text AS source_id,
         sale.receipt_total::numeric AS amount,
         COALESCE(sale.commission_amount, 0)::numeric AS commission
       FROM employee_sales sale
       JOIN params p ON p.employee_id = sale.employee_id
       WHERE (sale.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date

       UNION ALL

       SELECT
         pl.source_id,
         pl.amount,
         0::numeric AS commission
       FROM employee_payment_links pl
       JOIN params p ON p.employee_id = pl.employee_id
       WHERE pl.status = 'paid'
         AND (COALESCE(pl.paid_at, pl.updated_at, pl.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date
         AND NOT EXISTS (
           SELECT 1
           FROM employee_sales sale
           WHERE sale.receipt_id::text = pl.source_id
         )

       UNION ALL

       SELECT
         ppo.source_id,
         ppo.amount,
         0::numeric AS commission
       FROM employee_print_orders ppo
       JOIN params p ON p.employee_id = ppo.employee_id
       WHERE ppo.payment_status = 'paid'
         AND (COALESCE(ppo.paid_at, ppo.updated_at, ppo.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date
         AND NOT EXISTS (
           SELECT 1
           FROM employee_sales sale
           WHERE sale.receipt_id::text = ppo.source_id
         )
     ),
     paid_sales AS (
       SELECT
         COUNT(*)::int AS receipts_count,
         COALESCE(SUM(amount), 0) AS total_sales,
         COALESCE(AVG(amount), 0) AS avg_receipt,
         COALESCE(SUM(commission), 0) AS total_commission
       FROM paid_source_rows
     ),
     paid_invoices AS (
       SELECT
         COUNT(*)::int AS paid_invoices_count,
         COALESCE(SUM(amount), 0) AS paid_invoices_total,
         COALESCE(AVG(amount), 0) AS paid_invoices_avg
       FROM (
         SELECT pl.source_id, pl.amount
         FROM employee_payment_links pl
         JOIN params p ON p.employee_id = pl.employee_id
         WHERE pl.status = 'paid'
           AND (pl.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
           AND (COALESCE(pl.paid_at, pl.updated_at, pl.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date
         UNION ALL
         SELECT ppo.source_id, ppo.amount
         FROM employee_print_orders ppo
         JOIN params p ON p.employee_id = ppo.employee_id
         WHERE ppo.payment_status = 'paid'
           AND (ppo.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
           AND (COALESCE(ppo.paid_at, ppo.updated_at, ppo.created_at) AT TIME ZONE 'Europe/Moscow')::date = p.target_date
       ) paid
     ),
     pending_invoices AS (
       SELECT
         COUNT(*)::int AS pending_links_count,
         COALESCE(SUM(amount), 0) AS pending_links_total
       FROM (
         SELECT pl.source_id, pl.amount
         FROM employee_payment_links pl
         JOIN params p ON p.employee_id = pl.employee_id
         WHERE pl.status = 'pending'
           AND (pl.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
         UNION ALL
         SELECT ppo.source_id, ppo.amount
         FROM employee_print_orders ppo
         JOIN params p ON p.employee_id = ppo.employee_id
         WHERE ppo.status IN ('pending_payment', 'payment_failed')
           AND ppo.payment_status IS DISTINCT FROM 'paid'
           AND (ppo.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
       ) pending
     ),
     issued_invoices AS (
       SELECT
         COUNT(*)::int AS issued_invoices_count,
         COALESCE(SUM(amount), 0) AS issued_invoices_total
       FROM (
         SELECT pl.source_id, pl.amount
         FROM employee_payment_links pl
         JOIN params p ON p.employee_id = pl.employee_id
         WHERE pl.status IN ('pending', 'paid')
           AND (pl.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
         UNION ALL
         SELECT ppo.source_id, ppo.amount
         FROM employee_print_orders ppo
         JOIN params p ON p.employee_id = ppo.employee_id
         WHERE ppo.status IN ('pending_payment', 'payment_failed', 'paid')
           AND COALESCE(ppo.payment_status, 'none') IN ('none', 'pending', 'failed', 'paid', 'confirmed')
           AND (ppo.created_at AT TIME ZONE 'Europe/Moscow')::date = p.target_date
       ) issued
     )
     SELECT
       paid_sales.receipts_count,
       paid_sales.total_sales,
       paid_sales.avg_receipt,
       paid_sales.total_commission,
       paid_invoices.paid_invoices_count,
       paid_invoices.paid_invoices_total,
       paid_invoices.paid_invoices_avg,
       pending_invoices.pending_links_count,
       pending_invoices.pending_links_total,
       issued_invoices.issued_invoices_count,
       issued_invoices.issued_invoices_total
     FROM paid_sales
     CROSS JOIN paid_invoices
     CROSS JOIN pending_invoices
     CROSS JOIN issued_invoices`,
    [employeeId, targetDate],
  );

  return {
    receipts_count: parseInt(row?.receipts_count ?? '0', 10),
    total_sales: parseFloat(row?.total_sales ?? '0'),
    avg_receipt: Math.round(parseFloat(row?.avg_receipt ?? '0') * 100) / 100,
    total_commission: parseFloat(row?.total_commission ?? '0'),
    paid_invoices_count: parseInt(row?.paid_invoices_count ?? '0', 10),
    paid_invoices_total: parseFloat(row?.paid_invoices_total ?? '0'),
    paid_invoices_avg: Math.round(parseFloat(row?.paid_invoices_avg ?? '0') * 100) / 100,
    pending_links_count: parseInt(row?.pending_links_count ?? '0', 10),
    pending_links_total: parseFloat(row?.pending_links_total ?? '0'),
    issued_invoices_count: parseInt(row?.issued_invoices_count ?? '0', 10),
    issued_invoices_total: parseFloat(row?.issued_invoices_total ?? '0'),
  };
}

/**
 * Monthly stats for an employee. Returns payout record if exists,
 * otherwise computes from employee_sales.
 */
export async function getMonthlyStats(
  employeeId: string,
  period: string,
): Promise<MonthlyStats> {
  // Check for existing payout record
  const payout = await db.queryOne<CommissionPayoutSummaryRow>(
    `SELECT total_sales, total_receipts, total_commission,
            plan_target, plan_percent, plan_bonus, status
     FROM employee_commission_payouts
     WHERE employee_id = $1 AND period = $2`,
    [employeeId, period],
  );

  if (payout) {
    return {
      period,
      total_sales: parseFloat(payout.total_sales),
      total_receipts: parseInt(payout.total_receipts, 10),
      total_commission: parseFloat(payout.total_commission),
      plan_target: payout.plan_target ? parseFloat(payout.plan_target) : null,
      plan_percent: parseFloat(payout.plan_percent),
      plan_bonus: parseFloat(payout.plan_bonus),
      status: payout.status,
    };
  }

  // No payout record yet — compute from raw sales
  const agg = await db.queryOne<SalesAggregateRow>(
    `SELECT
       COALESCE(SUM(receipt_total), 0) AS total_sales,
       COUNT(*)::int AS total_receipts,
       COALESCE(SUM(commission_amount), 0) AS total_commission
     FROM employee_sales
     WHERE employee_id = $1
       AND to_char(created_at, 'YYYY-MM') = $2`,
    [employeeId, period],
  );

  return {
    period,
    total_sales: parseFloat(agg?.total_sales ?? '0'),
    total_receipts: parseInt(agg?.total_receipts ?? '0', 10),
    total_commission: parseFloat(agg?.total_commission ?? '0'),
    plan_target: null,
    plan_percent: 0,
    plan_bonus: 0,
    status: 'draft',
  };
}

/**
 * Leaderboard: top employees by total sales for a given studio and period.
 */
export async function getLeaderboard(
  studioId: string,
  period: string,
): Promise<LeaderboardEntry[]> {
  const rows = await db.query<EmployeeSalesLeaderboardRow>(
    `SELECT
       es.employee_id,
       u.display_name,
       u.photo_url,
       COUNT(*)::int AS receipts_count,
       SUM(es.receipt_total) AS total_sales,
       SUM(es.commission_amount) AS total_commission
     FROM employee_sales es
     JOIN pos_receipts pr ON pr.id = es.receipt_id
     JOIN users u ON u.id = es.employee_id
     WHERE pr.studio_id = $1
       AND to_char(es.created_at, 'YYYY-MM') = $2
     GROUP BY es.employee_id, u.display_name, u.photo_url
     ORDER BY total_sales DESC`,
    [studioId, period],
  );

  return rows.map((r, i) => ({
    employee_id: r.employee_id,
    display_name: r.display_name,
    photo_url: r.photo_url,
    receipts_count: parseInt(r.receipts_count, 10),
    total_sales: parseFloat(r.total_sales),
    total_commission: parseFloat(r.total_commission),
    rank: i + 1,
  }));
}

/**
 * Calculate (upsert) monthly payout for an employee.
 */
export async function calculatePayout(
  employeeId: string,
  period: string,
): Promise<{ id: string }> {
  const agg = await db.queryOne<SalesAggregateRow>(
    `SELECT
       COALESCE(SUM(receipt_total), 0) AS total_sales,
       COUNT(*)::int AS total_receipts,
       COALESCE(SUM(commission_amount), 0) AS total_commission
     FROM employee_sales
     WHERE employee_id = $1
       AND to_char(created_at, 'YYYY-MM') = $2`,
    [employeeId, period],
  );

  const result = await db.queryOne<IdResult>(
    `INSERT INTO employee_commission_payouts
       (employee_id, period, total_sales, total_receipts, total_commission)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, period) DO UPDATE SET
       total_sales = EXCLUDED.total_sales,
       total_receipts = EXCLUDED.total_receipts,
       total_commission = EXCLUDED.total_commission
     RETURNING id`,
    [
      employeeId,
      period,
      parseFloat(agg?.total_sales ?? '0'),
      parseInt(agg?.total_receipts ?? '0', 10),
      parseFloat(agg?.total_commission ?? '0'),
    ],
  );

  if (!result) {
    throw new AppError(500, 'Failed to calculate payout');
  }

  return { id: result.id };
}

/**
 * Approve a payout (admin action).
 */
export async function approvePayout(
  payoutId: string,
  approvedBy: string,
): Promise<void> {
  const result = await db.queryOne<PayoutStatusRow>(
    `UPDATE employee_commission_payouts
     SET status = 'approved', approved_by = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'draft'
     RETURNING status`,
    [payoutId, approvedBy],
  );

  if (!result) {
    const check = await db.queryOne<PayoutStatusRow>(
      `SELECT status FROM employee_commission_payouts WHERE id = $1`,
      [payoutId],
    );
    if (!check) throw new AppError(404, 'Payout not found');
    throw new AppError(400, `Payout already ${check.status}`);
  }

  logger.info('Payout approved', { payoutId, approvedBy });
}

/**
 * Reverse a sale attribution (on receipt refund).
 * Must be called INSIDE a transaction (receives PoolClient).
 */
export async function reverseSale(
  receiptId: string,
  client: PoolClient,
): Promise<void> {
  const deleted = await client.query<EmployeeSaleRow>(
    `DELETE FROM employee_sales WHERE receipt_id = $1 RETURNING *`,
    [receiptId],
  );

  if (deleted.rows.length > 0) {
    logger.info('Sale reversed', {
      receiptId,
      employeeId: deleted.rows[0].employee_id,
      amount: deleted.rows[0].receipt_total,
    });
  }
}

// ─── Commission Rules CRUD ────────────────────────────────────────────────

export async function getCommissionRules(): Promise<CommissionRuleRow[]> {
  return db.query<CommissionRuleRow>(
    `SELECT * FROM employee_commission_rules ORDER BY priority DESC, employee_id IS NULL ASC`,
  );
}

export async function createCommissionRule(data: {
  employee_id?: string | null;
  role?: string | null;
  category_slug?: string | null;
  rate: number;
  min_receipt_total?: number;
  priority?: number;
}): Promise<{ id: string }> {
  const result = await db.queryOne<IdResult>(
    `INSERT INTO employee_commission_rules
       (employee_id, role, category_slug, rate, min_receipt_total, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      data.employee_id ?? null,
      data.role ?? null,
      data.category_slug ?? null,
      data.rate,
      data.min_receipt_total ?? 0,
      data.priority ?? 0,
    ],
  );
  return { id: result!.id };
}

export async function updateCommissionRule(
  id: string,
  data: {
    rate?: number;
    min_receipt_total?: number;
    is_active?: boolean;
    priority?: number;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.rate !== undefined) { sets.push(`rate = $${idx++}`); params.push(data.rate); }
  if (data.min_receipt_total !== undefined) { sets.push(`min_receipt_total = $${idx++}`); params.push(data.min_receipt_total); }
  if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.is_active); }
  if (data.priority !== undefined) { sets.push(`priority = $${idx++}`); params.push(data.priority); }

  if (sets.length === 0) throw new AppError(400, 'No fields to update');

  params.push(id);
  await db.query(
    `UPDATE employee_commission_rules SET ${sets.join(', ')} WHERE id = $${idx}`,
    params,
  );
}

export async function deactivateCommissionRule(id: string): Promise<void> {
  await db.query(
    `UPDATE employee_commission_rules SET is_active = false WHERE id = $1`,
    [id],
  );
}

export async function getPayouts(period: string): Promise<unknown[]> {
  return db.query(
    `SELECT p.*, u.display_name AS employee_name, u.photo_url
     FROM employee_commission_payouts p
     JOIN users u ON u.id = p.employee_id
     WHERE p.period = $1
     ORDER BY p.total_sales DESC`,
    [period],
  );
}
