import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class CrmReportsApiService {
  private readonly http = inject(HttpClient);

  getRevenue(from: string, to: string, groupBy: 'day' | 'week' | 'month' = 'day'): Observable<RevenueRow[]> {
    return this.http.get<{ success: boolean; data: RevenueRow[] }>(
      `/api/crm/reports/revenue`, { params: { from, to, groupBy } },
    ).pipe(map(r => r.data));
  }

  getDailySummary(): Observable<DailySummary> {
    return this.http.get<{ success: boolean; data: DailySummary }>(
      `/api/crm/reports/daily-summary`,
    ).pipe(map(r => r.data));
  }

  getTopProducts(from: string, to: string, limit = 20): Observable<TopProduct[]> {
    return this.http.get<{ success: boolean; data: TopProduct[] }>(
      `/api/crm/reports/products`, { params: { from, to, limit: limit.toString() } },
    ).pipe(map(r => r.data));
  }

  getCashControl(from: string, to: string): Observable<CashReconciliationReport> {
    return this.http.get<{ success: boolean; data: CashReconciliationReport }>(
      `/api/crm/reports/cash-control`, { params: { from, to } },
    ).pipe(map(r => r.data));
  }
}
