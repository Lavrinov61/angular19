import db from '../database/db.js';
import type {
  CashReconciliationQueryRow,
  DailySummaryQueryRow,
  RevenueReportQueryRow,
  TopProductQueryRow,
} from '../types/views/crm-views.js';

// ─── TYPES ────────────────────────────────────────────

const CASH_RECONCILIATION_TOLERANCE_RUB = 1;
const POSSIBLE_TIP_LIMIT_RUB = 500;

export interface RevenueRow {
  period: string;
  pos_revenue: number;
  pos_refunds: number;
  online_revenue: number;
  print_revenue: number;
  booking_revenue: number;
  total: number;
}

export interface PaymentBreakdown {
  cash: number;
  cash_pos_fiscal: number;
  cash_pos_non_fiscal: number;
  cash_chat_fiscal: number;
  cash_chat_non_fiscal: number;
  card: number;
  sbp: number;
  online: number;
  subscription: number;
  transfer: number;
}

export interface DailySummary {
  today: {
    revenue: number;
    refunds: number;
    net: number;
    receipts: number;
    orders: number;
    avg_check: number;
    payments: PaymentBreakdown;
  };
  yesterday: { revenue: number; receipts: number; orders: number };
  last_week_avg: { revenue: number; receipts: number; orders: number };
  pending_orders: number;
}

export interface TopProduct {
  product_name: string;
  product_id: string | null;
  quantity: number;
  revenue: number;
}

export type CashReconciliationStatus =
  | 'open'
  | 'missing_open'
  | 'missing_close'
  | 'balanced'
  | 'possible_tip'
  | 'surplus'
  | 'shortage';

export interface CashReconciliationRow {
  shift_id: string;
  shift_date: string;
  employee_id: string;
  employee_name: string;
  studio_id: string | null;
  studio_name: string;
  workday_status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cash_at_open: number | null;
  cash_at_close: number | null;
  cash_payments: number;
  cash_pos_fiscal_payments: number;
  cash_pos_non_fiscal_payments: number;
  cash_chat_fiscal_payments: number;
  cash_chat_non_fiscal_payments: number;
  cash_withdrawals: number;
  expected_cash: number | null;
  difference: number | null;
  receipts_count: number;
  status: CashReconciliationStatus;
  status_label: string;
}

export interface CashReconciliationSummary {
  total: number;
  balanced: number;
  possible_tip: number;
  shortage: number;
  surplus: number;
  missing_open: number;
  missing_close: number;
  open: number;
  issues: number;
}

export interface CashReconciliationReport {
  rows: CashReconciliationRow[];
  summary: CashReconciliationSummary;
  tolerance: number;
  possible_tip_limit: number;
}

function toNullableNumber(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: string | number | null): number {
  return toNullableNumber(value) ?? 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function classifyCashReconciliation(row: {
  workday_status: string;
  cash_at_open: number | null;
  cash_at_close: number | null;
  expected_cash: number | null;
  difference: number | null;
}): Pick<CashReconciliationRow, 'status' | 'status_label'> {
  if (row.cash_at_open == null) {
    return { status: 'missing_open', status_label: 'Нет старта' };
  }

  if (row.cash_at_close == null) {
    if (row.workday_status === 'completed') {
      return { status: 'missing_close', status_label: 'Нет закрытия' };
    }
    return { status: 'open', status_label: 'Смена открыта' };
  }

  if (row.expected_cash == null || row.difference == null) {
    return { status: 'missing_open', status_label: 'Нет расчёта' };
  }

  if (Math.abs(row.difference) <= CASH_RECONCILIATION_TOLERANCE_RUB) {
    return { status: 'balanced', status_label: 'Верно' };
  }

  if (row.difference > 0 && row.difference <= POSSIBLE_TIP_LIMIT_RUB) {
    return { status: 'possible_tip', status_label: 'Возможно чаевые' };
  }

  if (row.difference > 0) {
    return { status: 'surplus', status_label: 'Излишек' };
  }

  return { status: 'shortage', status_label: 'Недостача' };
}

// ─── REVENUE BY PERIOD ───────────────────────────────

export async function getRevenueReport(
  from: string,
  to: string,
  groupBy: 'day' | 'week' | 'month' = 'day',
): Promise<RevenueRow[]> {
  const trunc = groupBy === 'week' ? 'week' : groupBy === 'month' ? 'month' : 'day';

  const query = `
    WITH date_range AS (
      SELECT generate_series(
        DATE_TRUNC('${trunc}', $1::date),
        DATE_TRUNC('${trunc}', $2::date),
        '1 ${trunc}'::interval
      ) AS period
    ),
    pos AS (
      SELECT
        DATE_TRUNC('${trunc}', r.created_at) AS period,
        COALESCE(SUM(r.total) FILTER (WHERE NOT r.is_refund), 0) AS revenue,
        COALESCE(SUM(r.total) FILTER (WHERE r.is_refund), 0) AS refunds
      FROM pos_receipts r
      WHERE r.created_at >= $1::date AND r.created_at < ($2::date + 1)
      GROUP BY 1
    ),
    online AS (
      SELECT
        DATE_TRUNC('${trunc}', o.created_at) AS period,
        COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'paid'), 0) AS revenue
      FROM orders o
      WHERE o.created_at >= $1::date AND o.created_at < ($2::date + 1)
      GROUP BY 1
    ),
    print_orders AS (
      SELECT
        DATE_TRUNC('${trunc}', po.created_at) AS period,
        COALESCE(SUM(po.total_price) FILTER (WHERE po.payment_status = 'paid'), 0) AS revenue
      FROM photo_print_orders po
      WHERE po.created_at >= $1::date AND po.created_at < ($2::date + 1)
      GROUP BY 1
    ),
    bookings AS (
      SELECT
        DATE_TRUNC('${trunc}', b.booking_date) AS period,
        COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'completed'), 0) AS revenue
      FROM bookings b
      WHERE b.booking_date >= $1::date AND b.booking_date < ($2::date + 1)
      GROUP BY 1
    )
    SELECT
      TO_CHAR(d.period, 'YYYY-MM-DD') AS period,
      COALESCE(p.revenue, 0)::numeric AS pos_revenue,
      COALESCE(p.refunds, 0)::numeric AS pos_refunds,
      COALESCE(o.revenue, 0)::numeric AS online_revenue,
      COALESCE(pr.revenue, 0)::numeric AS print_revenue,
      COALESCE(bk.revenue, 0)::numeric AS booking_revenue,
      (COALESCE(p.revenue, 0) - COALESCE(p.refunds, 0) + COALESCE(o.revenue, 0) + COALESCE(pr.revenue, 0) + COALESCE(bk.revenue, 0))::numeric AS total
    FROM date_range d
    LEFT JOIN pos p ON p.period = d.period
    LEFT JOIN online o ON o.period = d.period
    LEFT JOIN print_orders pr ON pr.period = d.period
    LEFT JOIN bookings bk ON bk.period = d.period
    ORDER BY d.period
  `;

  const rows = await db.query<RevenueReportQueryRow>(query, [from, to]);
  return rows.map((r) => ({
    period: r.period,
    pos_revenue: Number(r.pos_revenue),
    pos_refunds: Number(r.pos_refunds),
    online_revenue: Number(r.online_revenue),
    print_revenue: Number(r.print_revenue),
    booking_revenue: Number(r.booking_revenue),
    total: Number(r.total),
  }));
}

// ─── DAILY SUMMARY ───────────────────────────────────

export async function getDailySummary(): Promise<DailySummary> {
  const query = `
    WITH today_pos AS (
      SELECT
        COALESCE(SUM(r.total) FILTER (WHERE NOT r.is_refund), 0) AS revenue,
        COALESCE(SUM(r.total) FILTER (WHERE r.is_refund), 0) AS refunds,
        COUNT(*) FILTER (WHERE NOT r.is_refund) AS receipts
      FROM pos_receipts r
      WHERE r.created_at::date = CURRENT_DATE
    ),
    chat_cash_receipts AS (
      SELECT DISTINCT m.metadata #>> '{payment,receiptId}' AS receipt_id
      FROM messages m
      WHERE m.created_at::date = CURRENT_DATE
        AND m.metadata #>> '{payment,source}' = 'pos_receipt'
        AND m.metadata #>> '{payment,method}' = 'cash'
        AND NULLIF(m.metadata #>> '{payment,receiptId}', '') IS NOT NULL
    ),
    today_payments AS (
      SELECT
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'cash'), 0) AS cash,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.payment_type = 'cash'
            AND ccr.receipt_id IS NULL
            AND COALESCE(r.fiscal_status, 'pending') <> 'skipped'
        ), 0) AS cash_pos_fiscal,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.payment_type = 'cash'
            AND ccr.receipt_id IS NULL
            AND r.fiscal_status = 'skipped'
        ), 0) AS cash_pos_non_fiscal,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.payment_type = 'cash'
            AND ccr.receipt_id IS NOT NULL
            AND COALESCE(r.fiscal_status, 'pending') <> 'skipped'
        ), 0) AS cash_chat_fiscal,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.payment_type = 'cash'
            AND ccr.receipt_id IS NOT NULL
            AND r.fiscal_status = 'skipped'
        ), 0) AS cash_chat_non_fiscal,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'card'), 0) AS card,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'sbp'), 0) AS sbp,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'online'), 0) AS online,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'subscription'), 0) AS subscription,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'transfer'), 0) AS transfer
      FROM pos_receipt_payments p
      JOIN pos_receipts r ON r.id = p.receipt_id
      LEFT JOIN chat_cash_receipts ccr ON ccr.receipt_id = r.id::text
      WHERE r.created_at::date = CURRENT_DATE AND NOT r.is_refund
    ),
    today_orders AS (
      SELECT COUNT(*) AS cnt
      FROM photo_print_orders
      WHERE created_at::date = CURRENT_DATE AND payment_status = 'paid'
    ),
    yesterday_pos AS (
      SELECT
        COALESCE(SUM(total) FILTER (WHERE NOT is_refund), 0) AS revenue,
        COUNT(*) FILTER (WHERE NOT is_refund) AS receipts
      FROM pos_receipts
      WHERE created_at::date = CURRENT_DATE - 1
    ),
    yesterday_orders AS (
      SELECT COUNT(*) AS cnt
      FROM photo_print_orders
      WHERE created_at::date = CURRENT_DATE - 1 AND payment_status = 'paid'
    ),
    week_pos AS (
      SELECT
        COALESCE(AVG(daily_rev), 0) AS avg_revenue,
        COALESCE(AVG(daily_cnt), 0) AS avg_receipts
      FROM (
        SELECT
          created_at::date AS d,
          SUM(total) FILTER (WHERE NOT is_refund) AS daily_rev,
          COUNT(*) FILTER (WHERE NOT is_refund) AS daily_cnt
        FROM pos_receipts
        WHERE created_at::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE - 1
        GROUP BY created_at::date
      ) sub
    ),
    week_orders AS (
      SELECT COALESCE(AVG(daily_cnt), 0) AS avg_orders
      FROM (
        SELECT created_at::date AS d, COUNT(*) AS daily_cnt
        FROM photo_print_orders
        WHERE created_at::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE - 1
          AND payment_status = 'paid'
        GROUP BY created_at::date
      ) sub
    ),
    pending AS (
      SELECT COUNT(*) AS cnt
      FROM photo_print_orders
      WHERE status NOT IN ('delivered', 'cancelled') AND payment_status = 'paid'
    )
    SELECT
      tp.revenue AS today_revenue, tp.refunds AS today_refunds, tp.receipts AS today_receipts,
      tpay.cash, tpay.cash_pos_fiscal, tpay.cash_pos_non_fiscal,
      tpay.cash_chat_fiscal, tpay.cash_chat_non_fiscal,
      tpay.card, tpay.sbp, tpay.online, tpay.subscription, tpay.transfer,
      tod.cnt AS today_orders,
      yp.revenue AS yesterday_revenue, yp.receipts AS yesterday_receipts,
      yod.cnt AS yesterday_orders,
      wp.avg_revenue AS week_avg_revenue, wp.avg_receipts AS week_avg_receipts,
      wod.avg_orders AS week_avg_orders,
      pend.cnt AS pending_orders
    FROM today_pos tp
    CROSS JOIN today_payments tpay
    CROSS JOIN today_orders tod
    CROSS JOIN yesterday_pos yp
    CROSS JOIN yesterday_orders yod
    CROSS JOIN week_pos wp
    CROSS JOIN week_orders wod
    CROSS JOIN pending pend
  `;

  const rows = await db.query<DailySummaryQueryRow>(query);
  const r = rows[0];

  const todayRevenue = Number(r.today_revenue);
  const todayReceipts = Number(r.today_receipts);

  return {
    today: {
      revenue: todayRevenue,
      refunds: Number(r.today_refunds),
      net: todayRevenue - Number(r.today_refunds),
      receipts: todayReceipts,
      orders: Number(r.today_orders),
      avg_check: todayReceipts > 0 ? Math.round(todayRevenue / todayReceipts) : 0,
      payments: {
        cash: Number(r.cash),
        cash_pos_fiscal: Number(r.cash_pos_fiscal),
        cash_pos_non_fiscal: Number(r.cash_pos_non_fiscal),
        cash_chat_fiscal: Number(r.cash_chat_fiscal),
        cash_chat_non_fiscal: Number(r.cash_chat_non_fiscal),
        card: Number(r.card),
        sbp: Number(r.sbp),
        online: Number(r.online),
        subscription: Number(r.subscription),
        transfer: Number(r.transfer),
      },
    },
    yesterday: {
      revenue: Number(r.yesterday_revenue),
      receipts: Number(r.yesterday_receipts),
      orders: Number(r.yesterday_orders),
    },
    last_week_avg: {
      revenue: Math.round(Number(r.week_avg_revenue)),
      receipts: Math.round(Number(r.week_avg_receipts)),
      orders: Math.round(Number(r.week_avg_orders)),
    },
    pending_orders: Number(r.pending_orders),
  };
}

// ─── CASH RECONCILIATION ─────────────────────────────

export async function getCashReconciliationReport(
  from: string,
  to: string,
): Promise<CashReconciliationReport> {
  const query = `
    SELECT
      es.id::text AS shift_id,
      es.shift_date::text AS shift_date,
      es.employee_id::text AS employee_id,
      COALESCE(u.display_name, u.email, 'Сотрудник') AS employee_name,
      es.studio_id::text AS studio_id,
      COALESCE(st.name, 'Адрес не указан') AS studio_name,
      es.status AS workday_status,
      es.checked_in_at::text AS checked_in_at,
      es.checked_out_at::text AS checked_out_at,
      es.cash_at_open::text AS cash_at_open,
      es.cash_at_close::text AS cash_at_close,
      COALESCE(pos.cash_payments, 0)::text AS cash_payments,
      COALESCE(pos.cash_pos_fiscal_payments, 0)::text AS cash_pos_fiscal_payments,
      COALESCE(pos.cash_pos_non_fiscal_payments, 0)::text AS cash_pos_non_fiscal_payments,
      COALESCE(pos.cash_chat_fiscal_payments, 0)::text AS cash_chat_fiscal_payments,
      COALESCE(pos.cash_chat_non_fiscal_payments, 0)::text AS cash_chat_non_fiscal_payments,
      COALESCE(mov.cash_withdrawals, 0)::text AS cash_withdrawals,
      COALESCE(pos.receipts_count, 0)::int AS receipts_count
    FROM employee_shifts es
    LEFT JOIN users u ON u.id = es.employee_id
    LEFT JOIN studios st ON st.id = es.studio_id
    LEFT JOIN LATERAL (
      WITH receipt_scope AS (
        SELECT
          r.*,
          EXISTS (
            SELECT 1
            FROM messages m
            WHERE m.metadata #>> '{payment,source}' = 'pos_receipt'
              AND m.metadata #>> '{payment,method}' = 'cash'
              AND m.metadata #>> '{payment,receiptId}' = r.id::text
          ) AS is_chat_cash
        FROM pos_receipts r
        WHERE r.shift_id = es.pos_shift_id
           OR (
             r.shift_id IS NULL
             AND r.employee_id = es.employee_id
             AND r.studio_id = es.studio_id
             AND r.created_at >= COALESCE(es.checked_in_at, es.shift_date::timestamp)
             AND r.created_at < COALESCE(es.checked_out_at, es.shift_date::timestamp + INTERVAL '1 day')
           )
      )
      SELECT
        COALESCE(
          SUM(rp.amount) FILTER (
            WHERE rp.payment_type = 'cash'
              AND rp.status = 'completed'
              AND r.voided_at IS NULL
          ),
          0
        ) AS cash_payments,
        COALESCE(
          SUM(rp.amount) FILTER (
            WHERE rp.payment_type = 'cash'
              AND rp.status = 'completed'
              AND r.voided_at IS NULL
              AND NOT r.is_chat_cash
              AND COALESCE(r.fiscal_status, 'pending') <> 'skipped'
          ),
          0
        ) AS cash_pos_fiscal_payments,
        COALESCE(
          SUM(rp.amount) FILTER (
            WHERE rp.payment_type = 'cash'
              AND rp.status = 'completed'
              AND r.voided_at IS NULL
              AND NOT r.is_chat_cash
              AND r.fiscal_status = 'skipped'
          ),
          0
        ) AS cash_pos_non_fiscal_payments,
        COALESCE(
          SUM(rp.amount) FILTER (
            WHERE rp.payment_type = 'cash'
              AND rp.status = 'completed'
              AND r.voided_at IS NULL
              AND r.is_chat_cash
              AND COALESCE(r.fiscal_status, 'pending') <> 'skipped'
          ),
          0
        ) AS cash_chat_fiscal_payments,
        COALESCE(
          SUM(rp.amount) FILTER (
            WHERE rp.payment_type = 'cash'
              AND rp.status = 'completed'
              AND r.voided_at IS NULL
              AND r.is_chat_cash
              AND r.fiscal_status = 'skipped'
          ),
          0
        ) AS cash_chat_non_fiscal_payments,
        (COUNT(DISTINCT r.id) FILTER (
          WHERE r.voided_at IS NULL
            AND NOT r.is_refund
        ))::int AS receipts_count
      FROM receipt_scope r
      LEFT JOIN pos_receipt_payments rp ON rp.receipt_id = r.id
    ) pos ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(m.amount), 0) AS cash_withdrawals
      FROM pos_cash_movements m
      WHERE m.shift_id = es.pos_shift_id
        AND m.movement_type = 'withdrawal'
    ) mov ON true
    WHERE es.shift_date >= $1::date
      AND es.shift_date <= $2::date
      AND es.status IN ('active', 'completed')
    ORDER BY es.shift_date DESC, st.name NULLS LAST, employee_name
    LIMIT 200
  `;

  const queryRows = await db.query<CashReconciliationQueryRow>(query, [from, to]);
  const rows = queryRows.map((row): CashReconciliationRow => {
    const cashAtOpen = toNullableNumber(row.cash_at_open);
    const cashAtClose = toNullableNumber(row.cash_at_close);
    const cashPayments = roundMoney(toNumber(row.cash_payments));
    const cashPosFiscalPayments = roundMoney(toNumber(row.cash_pos_fiscal_payments));
    const cashPosNonFiscalPayments = roundMoney(toNumber(row.cash_pos_non_fiscal_payments));
    const cashChatFiscalPayments = roundMoney(toNumber(row.cash_chat_fiscal_payments));
    const cashChatNonFiscalPayments = roundMoney(toNumber(row.cash_chat_non_fiscal_payments));
    const cashWithdrawals = roundMoney(toNumber(row.cash_withdrawals));
    const expectedCash = cashAtOpen == null
      ? null
      : roundMoney(cashAtOpen + cashPayments - cashWithdrawals);
    const difference = cashAtClose == null || expectedCash == null
      ? null
      : roundMoney(cashAtClose - expectedCash);
    const status = classifyCashReconciliation({
      workday_status: row.workday_status,
      cash_at_open: cashAtOpen,
      cash_at_close: cashAtClose,
      expected_cash: expectedCash,
      difference,
    });

    return {
      shift_id: row.shift_id,
      shift_date: row.shift_date,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      studio_id: row.studio_id,
      studio_name: row.studio_name,
      workday_status: row.workday_status,
      checked_in_at: row.checked_in_at,
      checked_out_at: row.checked_out_at,
      cash_at_open: cashAtOpen,
      cash_at_close: cashAtClose,
      cash_payments: cashPayments,
      cash_pos_fiscal_payments: cashPosFiscalPayments,
      cash_pos_non_fiscal_payments: cashPosNonFiscalPayments,
      cash_chat_fiscal_payments: cashChatFiscalPayments,
      cash_chat_non_fiscal_payments: cashChatNonFiscalPayments,
      cash_withdrawals: cashWithdrawals,
      expected_cash: expectedCash,
      difference,
      receipts_count: Number(row.receipts_count),
      status: status.status,
      status_label: status.status_label,
    };
  });

  const summary = rows.reduce<CashReconciliationSummary>((acc, row) => {
    acc.total += 1;
    acc[row.status] += 1;
    if (!['balanced', 'possible_tip', 'open'].includes(row.status)) {
      acc.issues += 1;
    }
    return acc;
  }, {
    total: 0,
    balanced: 0,
    possible_tip: 0,
    shortage: 0,
    surplus: 0,
    missing_open: 0,
    missing_close: 0,
    open: 0,
    issues: 0,
  });

  return {
    rows,
    summary,
    tolerance: CASH_RECONCILIATION_TOLERANCE_RUB,
    possible_tip_limit: POSSIBLE_TIP_LIMIT_RUB,
  };
}

// ─── TOP PRODUCTS ────────────────────────────────────

export async function getTopProducts(
  from: string,
  to: string,
  limit = 20,
): Promise<TopProduct[]> {
  const query = `
    SELECT
      ri.product_name,
      ri.product_id,
      SUM(ri.quantity)::int AS quantity,
      SUM(ri.total)::numeric AS revenue
    FROM pos_receipt_items ri
    JOIN pos_receipts r ON r.id = ri.receipt_id
    WHERE r.created_at >= $1::date AND r.created_at < ($2::date + 1)
      AND NOT r.is_refund
    GROUP BY ri.product_name, ri.product_id
    ORDER BY revenue DESC
    LIMIT $3
  `;

  const rows = await db.query<TopProductQueryRow>(query, [from, to, limit]);
  return rows.map((r) => ({
    product_name: r.product_name,
    product_id: r.product_id,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
  }));
}
