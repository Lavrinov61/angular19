import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';
import { ApiResponse } from '../../../core/services/api.service';

export type EmployeeShiftKind = 'studio' | 'virtual';

export interface EmployeeShift {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_phone?: string;
  studio_id: string;
  studio_name?: string;
  studio_address?: string | null;
  location_code?: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  shift_kind?: EmployeeShiftKind;
  is_virtual?: boolean;
  notes?: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  cash_at_open: number | null;
  cash_at_close: number | null;
  base_pay_rate: number | null;
  online_earnings: number;
  online_count: number;
  commission_total: number;
  sales_total: number;
  receipts_count: number;
  created_at: string;
  updated_at: string;
}

type ShiftCheckOutResponse = ApiResponse<EmployeeShift & { pending_tasks: unknown[]; warning?: string }>;

const CHECKOUT_TIMEOUT_RETRY_DELAY_MS = 1000;

function isGatewayTimeout(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 504;
}

export interface ShiftBriefing {
  id: string;
  shift_id: string;
  employee_id: string;
  studio_id: string;
  briefing_date: string;
  summary: string;
  structured_data: {
    active_tasks: number;
    urgent_tasks: unknown[];
    handed_off_tasks: unknown[];
    todays_bookings: unknown[];
  };
  is_read: boolean;
  read_at?: string;
}

export interface RecentOrder {
  order_id: string;
  contact_name: string;
  contact_phone: string;
  total_price: number;
  status: string;
  payment_status: string;
  priority: string;
  created_at: string;
}

export interface ScheduleRequestedShift {
  date: string;
  start_time: string;
  end_time: string;
  studio_id?: string;
  action?: 'work' | 'change_address' | 'cancel_shift';
  shift_id?: string;
  current_studio_id?: string;
  reason?: string;
}

export interface ScheduleRequest {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_phone?: string;
  shift_pattern: '2/2' | '1/1' | '3/3' | '5/2' | 'custom';
  pattern_start_date: string;
  end_date?: string;
  requested_shifts: ScheduleRequestedShift[];
  status: 'pending' | 'approved' | 'rejected' | 'revision_requested';
  admin_id?: string | null;
  admin_name?: string;
  admin_comment?: string;
  created_at: string;
  updated_at: string;
}

export interface ShiftStudio {
  id: string;
  name: string;
  address: string | null;
  location_code: string | null;
  status: string;
  shift_rate: number;
  is_virtual?: boolean;
}

export interface EmployeeDashboard {
  shift: EmployeeShift | null;
  my_tasks: unknown[];
  pending_handoffs: unknown[];
  unread_briefing: { id: string; summary: string } | null;
  colleague: { display_name: string; phone: string; studio_name: string; location_code: string | null } | null;
  tasks_summary: { total: number; urgent: number; waiting: number } | null;
  recent_orders: RecentOrder[];
  today_stats: { orders_today: number; revenue_today: number };
}

export interface NdflDetails {
  ytd_income_before: number;
  ytd_income_after: number;
  effective_rate: number;
  ndfl_amount: number;
  brackets_applied: readonly { bracket_rate: number; taxable_in_bracket: number; tax: number }[];
}

export interface EmployerContributions {
  pension: number;
  medical: number;
  social: number;
  injury: number;
  total: number;
}

export interface PensionPoints {
  monthly: number;
  ytd: number;
  point_value_rub: number;
  estimated_monthly_pension_increment: number;
}

export interface EmployeeEarnings {
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
  /** @deprecated Use gross_earnings instead */
  total_earnings: number;
  gross_earnings: number;
  ndfl: NdflDetails;
  net_earnings: number;
  employer_contributions: EmployerContributions;
  total_company_cost: number;
  pension_points: PensionPoints;
  online_revenue: number;
  online_commission: number;
  online_orders_count: number;
  studio_name: string | null;
  location_code: string | null;
}

export interface TaxDeduction {
  id: string;
  deduction_category: string;
  amount: number;
  refund_amount: number;
  description: string;
  tax_year: number;
  status: 'pending' | 'approved' | 'applied' | 'rejected';
  category_label: string;
  document_url: string | null;
  notes: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface AdminEmployeeEarnings {
  employee_id: string;
  display_name: string;
  role: string;
  photo_url: string | null;
  daily_rate: number;
  commission_rate: number;
  completed_shifts: number;
  total_shifts: number;
  base_pay: number;
  pos_revenue: number;
  manual_revenue: number;
  revenue: number;
  commission: number;
  trial_shifts: number;
  trial_bonus: number;
  total_earnings: number;
  orders_count: number;
  online_revenue: number;
  online_commission: number;
  online_orders_count: number;
}

export interface EmployeeCompensation {
  id: string;
  employee_id: string;
  daily_rate: number;
  commission_rate: number;
  effective_from: string;
  effective_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class ShiftsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/shifts';

  getShifts(params?: { studio_id?: string; date_from?: string; date_to?: string; employee_id?: string }): Observable<ApiResponse<EmployeeShift[]>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) httpParams = httpParams.set(key, String(value));
      });
    }
    return this.http.get<ApiResponse<EmployeeShift[]>>(this.apiUrl, { params: httpParams });
  }

  getToday(): Observable<ApiResponse<EmployeeShift[]>> {
    return this.http.get<ApiResponse<EmployeeShift[]>>(`${this.apiUrl}/today`);
  }

  getMyShifts(dateFrom?: string, dateTo?: string): Observable<ApiResponse<EmployeeShift[]>> {
    let params = new HttpParams();
    if (dateFrom) params = params.set('date_from', dateFrom);
    if (dateTo) params = params.set('date_to', dateTo);
    return this.http.get<ApiResponse<EmployeeShift[]>>(`${this.apiUrl}/my`, { params });
  }

  createShift(shift: Partial<EmployeeShift>): Observable<ApiResponse<EmployeeShift>> {
    return this.http.post<ApiResponse<EmployeeShift>>(this.apiUrl, shift);
  }

  createBulk(shifts: Partial<EmployeeShift>[]): Observable<ApiResponse<EmployeeShift[]>> {
    return this.http.post<ApiResponse<EmployeeShift[]>>(`${this.apiUrl}/bulk`, { shifts });
  }

  startWorkday(studioId: string | undefined, warningAcknowledged: boolean, cashAtOpen: number): Observable<ApiResponse<EmployeeShift>> {
    const body: { studio_id?: string; warning_acknowledged?: true; cash_at_open: number } = {
      cash_at_open: cashAtOpen,
    };
    if (studioId) body.studio_id = studioId;
    if (warningAcknowledged) body.warning_acknowledged = true;
    return this.http.post<ApiResponse<EmployeeShift>>(
      `${this.apiUrl}/workday/start`,
      body,
    );
  }

  getShiftStudios(): Observable<ApiResponse<ShiftStudio[]>> {
    return this.http.get<ApiResponse<ShiftStudio[]>>(`${this.apiUrl}/studios`);
  }

  updateShift(id: string, updates: Partial<EmployeeShift>): Observable<ApiResponse<EmployeeShift>> {
    return this.http.put<ApiResponse<EmployeeShift>>(`${this.apiUrl}/${id}`, updates);
  }

  updateMyShift(id: string, updates: Pick<Partial<EmployeeShift>, 'studio_id' | 'start_time' | 'end_time'>): Observable<ApiResponse<EmployeeShift>> {
    return this.http.put<ApiResponse<EmployeeShift>>(`${this.apiUrl}/my/${id}`, updates);
  }

  deleteShift(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/${id}`);
  }

  checkIn(id: string, cashAtOpen: number): Observable<ApiResponse<EmployeeShift>> {
    return this.http.post<ApiResponse<EmployeeShift>>(`${this.apiUrl}/${id}/check-in`, { cash_at_open: cashAtOpen });
  }

  checkOut(id: string, cashAtClose: number): Observable<ShiftCheckOutResponse> {
    return this.http.post<ShiftCheckOutResponse>(`${this.apiUrl}/${id}/check-out`, {
      cash_at_close: cashAtClose,
    }).pipe(
      retry({
        count: 1,
        delay: (error: unknown) => isGatewayTimeout(error)
          ? timer(CHECKOUT_TIMEOUT_RETRY_DELAY_MS)
          : throwError(() => error),
      }),
    );
  }

  getBriefing(id: string): Observable<ApiResponse<ShiftBriefing>> {
    return this.http.get<ApiResponse<ShiftBriefing>>(`${this.apiUrl}/${id}/briefing`);
  }

  markBriefingRead(id: string): Observable<ApiResponse<ShiftBriefing>> {
    return this.http.post<ApiResponse<ShiftBriefing>>(`${this.apiUrl}/${id}/briefing/read`, {});
  }

  getDashboard(): Observable<ApiResponse<EmployeeDashboard>> {
    return this.http.get<ApiResponse<EmployeeDashboard>>(`${this.apiUrl}/employee-dashboard`);
  }

  // ===== Earnings =====

  getMyEarnings(month: string): Observable<ApiResponse<EmployeeEarnings>> {
    return this.http.get<ApiResponse<EmployeeEarnings>>(`${this.apiUrl}/my/earnings`, {
      params: { month },
    });
  }

  // ===== Schedule Requests =====

  createScheduleRequest(data: {
    shift_pattern: string;
    pattern_start_date: string;
    end_date?: string;
    start_time?: string;
    end_time?: string;
    studio_id?: string;
    requested_shifts?: ScheduleRequestedShift[];
  }): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.post<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests`, data);
  }

  proposeScheduleRequest(data: {
    employee_id: string;
    requested_shifts: ScheduleRequestedShift[];
    comment?: string;
  }): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.post<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/propose`, data);
  }

  getMyScheduleRequests(): Observable<ApiResponse<ScheduleRequest[]>> {
    return this.http.get<ApiResponse<ScheduleRequest[]>>(`${this.apiUrl}/requests/my`);
  }

  getScheduleRequests(filters?: { status?: string; employee_id?: string }): Observable<ApiResponse<ScheduleRequest[]>> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.employee_id) params = params.set('employee_id', filters.employee_id);
    return this.http.get<ApiResponse<ScheduleRequest[]>>(`${this.apiUrl}/requests`, { params });
  }

  approveScheduleRequest(id: string, studioId?: string): Observable<ApiResponse<ScheduleRequest>> {
    const body = studioId ? { studio_id: studioId } : {};
    return this.http.put<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/${id}/approve`, body);
  }

  rejectScheduleRequest(id: string, comment: string): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.put<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/${id}/reject`, { comment });
  }

  requestRevision(id: string, comment: string): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.put<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/${id}/revision`, { comment });
  }

  acceptScheduleProposal(id: string): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.put<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/${id}/accept`, {});
  }

  declineScheduleProposal(id: string, comment?: string): Observable<ApiResponse<ScheduleRequest>> {
    return this.http.put<ApiResponse<ScheduleRequest>>(`${this.apiUrl}/requests/${id}/decline`, {
      ...(comment ? { comment } : {}),
    });
  }

  // ===== Tax Deductions (Налоговые вычеты) =====

  getMyTaxDeductions(year: number): Observable<ApiResponse<TaxDeduction[]>> {
    return this.http.get<ApiResponse<TaxDeduction[]>>(`${this.apiUrl}/my/tax-deductions`, {
      params: { year: year.toString() },
    });
  }

  createTaxDeduction(data: {
    deduction_category: string;
    amount: number;
    description: string;
    tax_year?: number;
    document_url?: string;
  }): Observable<ApiResponse<TaxDeduction>> {
    return this.http.post<ApiResponse<TaxDeduction>>(`${this.apiUrl}/my/tax-deductions`, data);
  }

  deleteTaxDeduction(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/my/tax-deductions/${id}`);
  }

  // ===== Admin Bonuses =====

  getAdminEarnings(month: string): Observable<ApiResponse<AdminEmployeeEarnings[]>> {
    return this.http.get<ApiResponse<AdminEmployeeEarnings[]>>(`${this.apiUrl}/admin/earnings`, {
      params: { month },
    });
  }

  getCompensation(employeeId: string): Observable<ApiResponse<EmployeeCompensation[]>> {
    return this.http.get<ApiResponse<EmployeeCompensation[]>>(`${this.apiUrl}/admin/compensation/${employeeId}`);
  }

  updateCompensation(employeeId: string, data: {
    daily_rate: number;
    commission_rate: number;
    notes?: string;
  }): Observable<ApiResponse<EmployeeCompensation>> {
    return this.http.put<ApiResponse<EmployeeCompensation>>(`${this.apiUrl}/admin/compensation/${employeeId}`, data);
  }

  getOnlineEarnings(shiftId: string): Observable<ApiResponse<{ count: number; amount: number; commission: number }>> {
    return this.http.get<ApiResponse<{ count: number; amount: number; commission: number }>>(`${this.apiUrl}/${shiftId}/online-earnings`);
  }

  getMyHistory(params?: { month?: string; limit?: number; offset?: number }): Observable<ApiResponse<{ data: EmployeeShift[]; total: number }>> {
    let httpParams = new HttpParams();
    if (params?.month) httpParams = httpParams.set('month', params.month);
    if (params?.limit) httpParams = httpParams.set('limit', params.limit.toString());
    if (params?.offset) httpParams = httpParams.set('offset', params.offset.toString());
    return this.http.get<ApiResponse<{ data: EmployeeShift[]; total: number }>>(`${this.apiUrl}/my/history`, { params: httpParams });
  }

  upsertManualRevenue(data: {
    employee_id: string;
    month: string;
    amount: number;
    description?: string;
  }): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/admin/manual-revenue`, data);
  }

  // ===== Enterprise: Conflict Detection =====

  checkConflicts(employeeId: string, dates: string[], excludeShiftId?: string): Observable<ApiResponse<{ conflicts: unknown[]; has_conflicts: boolean }>> {
    return this.http.post<ApiResponse<{ conflicts: unknown[]; has_conflicts: boolean }>>(`${this.apiUrl}/check-conflicts`, {
      employee_id: employeeId,
      dates,
      exclude_shift_id: excludeShiftId,
    });
  }

  // ===== Enterprise: Bulk Operations =====

  bulkApproveRequests(requestIds: string[], studioId: string): Observable<ApiResponse<{ approved: number; failed: unknown[]; total_shifts_created: number }>> {
    return this.http.post<ApiResponse<{ approved: number; failed: unknown[]; total_shifts_created: number }>>(`${this.apiUrl}/requests/bulk-approve`, {
      request_ids: requestIds,
      studio_id: studioId,
    });
  }

  // ===== Enterprise: Admin Weekly Summary =====

  getWeeklySummary(weekStart: string, studioId?: string): Observable<ApiResponse<unknown>> {
    let params = new HttpParams().set('week_start', weekStart);
    if (studioId) params = params.set('studio_id', studioId);
    return this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/admin/weekly-summary`, { params });
  }

  // ===== Enterprise: Shift Notes & History =====

  updateShiftNotes(shiftId: string, notes: string): Observable<ApiResponse<EmployeeShift>> {
    return this.http.patch<ApiResponse<EmployeeShift>>(`${this.apiUrl}/${shiftId}/notes`, { notes });
  }

  getShiftHistory(shiftId: string): Observable<ApiResponse<unknown[]>> {
    return this.http.get<ApiResponse<unknown[]>>(`${this.apiUrl}/${shiftId}/history`);
  }

  // ===== Enterprise: Cancel Schedule Request =====

  cancelScheduleRequest(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/requests/${id}`);
  }
}
