/** Employee earnings view types */

import type { UsersId } from '../generated/public/Users.js';

/** НДФЛ прогрессивная шкала 2026 */
export interface NdflBracket {
  readonly threshold: number;
  readonly rate: number;
}

/** Детали НДФЛ расчёта */
export interface NdflDetails {
  ytd_income_before: number;
  ytd_income_after: number;
  effective_rate: number;
  ndfl_amount: number;
  brackets_applied: readonly { bracket_rate: number; taxable_in_bracket: number; tax: number }[];
}

/** Страховые взносы работодателя */
export interface EmployerContributions {
  pension: number;
  medical: number;
  social: number;
  injury: number;
  total: number;
}

/** Пенсионные баллы */
export interface PensionPoints {
  monthly: number;
  ytd: number;
  point_value_rub: number;
  estimated_monthly_pension_increment: number;
}

/** Расширенный DTO заработка сотрудника */
export interface EmployeeEarningsView {
  month: string;
  daily_rate: number;
  commission_rate: number;
  completed_shifts: number;
  total_shifts: number;
  working_days_in_month: number;
  base_pay: number;
  pos_revenue: number;
  manual_revenue: number;
  revenue: number;
  commission: number;
  trial_shifts: number;
  trial_bonus: number;
  gross_earnings: number;
  ndfl: NdflDetails;
  net_earnings: number;
  employer_contributions: EmployerContributions;
  total_company_cost: number;
  pension_points: PensionPoints;
  studio_name: string | null;
  location_code: string | null;
  online_revenue: number;
  online_commission: number;
  online_orders_count: number;
}

/** SQL-результат для /my/earnings с YTD CTE */
export interface EarningsQueryRow {
  daily_rate: string;
  commission_rate: string;
  completed_shifts: string;
  total_shifts: string;
  base_pay: string;
  revenue: string;
  orders_count: string;
  manual_revenue: string;
  studio_name: string | null;
  location_code: string | null;
  trial_shifts: string;
  working_days: string;
  ytd_base_pay: string;
  ytd_commission: string;
  ytd_trial_bonus: string;
  ytd_manual_revenue: string;
  online_revenue: string;
  online_commission: string;
  online_orders_count: string;
}

/** Admin: row from all-employees earnings CTE */
export interface AdminEmployeeEarningsRow {
  employee_id: string;
  display_name: string;
  role: string;
  photo_url: string | null;
  daily_rate: string;
  commission_rate: string;
  completed_shifts: string;
  total_shifts: string;
  base_pay: string;
  revenue: string;
  orders_count: string;
  manual_revenue: string;
  trial_shifts: string;
  online_revenue: string;
  online_commission: string;
  online_orders_count: string;
}

/** Online earnings summary for a single shift */
export interface OnlineEarningsSummaryRow {
  count: string;
  amount: string;
  commission: string;
}

/** Manual revenue row */
export interface ManualRevenueRow {
  id: string;
  employee_id: string;
  month: string;
  amount: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

/** Active shift lookup result — employee_id only */
export interface ActiveShiftLookup {
  employee_id: UsersId;
}

/** Shift earnings aggregation for WS push */
export interface ShiftEarningsAggregation {
  id: string;
  online_earnings: string;
  online_count: string;
  commission: string;
}

/** Task owner lookup */
export interface TaskOwnerLookup {
  assigned_to: UsersId;
}

/** Admin: compensation record */
export interface EmployeeCompensationRow {
  id: string;
  employee_id: string;
  daily_rate: string;
  commission_rate: string;
  effective_from: string;
  effective_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TaxDeductionRow {
  id: string;
  deduction_category: string;
  amount: string;
  refund_amount: string | null;
  description: string;
  tax_year: number;
  status: string;
  document_url: string | null;
  notes: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface TaxDeductionCreateRow {
  id: string;
  deduction_category: string;
  amount: string;
  refund_amount: string | null;
  status: string;
  created_at: string;
}
