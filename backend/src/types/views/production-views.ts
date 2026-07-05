/** View types for production domain (printing houses, orders, analytics). */

// ── Product Comparison ─────────────────────────────────────────────────

/** Row from compareProductsByCategory JOIN. */
export interface ProductComparisonRow {
  house_id: string;
  house_name: string;
  product_id: string;
  product_name: string;
  base_price: number;
  lead_time_days: number;
  available_formats: string[];
}

// ── Analytics aggregates ───────────────────────────────────────────────

/** Spending grouped by printing house. */
export interface SpendingByHouseRow {
  house_id: string;
  house_name: string;
  total: string;
  order_count: string;
}

/** Spending grouped by product category. */
export interface SpendingByCategoryRow {
  category: string;
  total: string;
  order_count: string;
}

/** Delivery on-time / delay aggregate. */
export interface DeliveryPerformanceRow {
  on_time_count: string;
  total_delivered: string;
  avg_delay_days: string;
}

/** Quality rating / defect aggregate. */
export interface QualityMetricsRow {
  avg_rating: string;
  defect_count: string;
  total_rated: string;
}

/** Monthly cost + count trend. */
export interface MonthlyTrendRow {
  month: string;
  total_cost: string;
  order_count: string;
}

/** Order status distribution. */
export interface StatusDistributionRow {
  status: string;
  count: string;
}

/** Average lead time in days. */
export interface AvgLeadTimeRow {
  avg_days: string;
}

/** Monthly spending for a single house. */
export interface MonthlySpendRow {
  month: string;
  total: string;
  count: string;
}

// ── Quality Alerts (production-ai) ─────────────────────────────────────

/** Metrics for quality alert generation (30d vs 60d). */
export interface QualityAlertMetricsRow {
  house_id: string;
  house_name: string;
  avg_rating_recent: string | null;
  avg_rating_prev: string | null;
  defect_rate_recent: string | null;
  defect_rate_prev: string | null;
  avg_delay_recent: string | null;
}
