import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PayoutRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_photo: string | null;
  period: string;
  total_sales: number;
  total_receipts: number;
  total_commission: number;
  plan_target: number | null;
  plan_percent: number | null;
  plan_bonus: number;
  status: 'draft' | 'approved' | 'paid';
  approved_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  transfer_reference: string | null;
  net_amount: number | null;
  payout_account: {
    method: string;
    bank_name: string | null;
    account_identifier: string | null;
    recipient_name: string;
  } | null;
}

export interface BankAccount {
  id: string;
  method: string;
  bank_name: string | null;
  account_identifier: string | null;
  recipient_name: string;
  is_primary: boolean;
  updated_at: string;
}

export interface BankAccountUpdate {
  method: string;
  bank_name?: string;
  account_identifier?: string;
  recipient_name: string;
}

export interface MarkPaidData {
  payment_method: string;
  transfer_reference?: string;
  payment_notes?: string;
  net_amount: number;
}

@Injectable({ providedIn: 'root' })
export class PayrollApiService {
  private readonly http = inject(HttpClient);
  private readonly API = '/api/payroll';

  // Employee
  getMyPayouts(period?: string): Observable<{ payouts: PayoutRecord[] }> {
    let params = new HttpParams();
    if (period) params = params.set('period', period);
    return this.http.get<{ payouts: PayoutRecord[] }>(`${this.API}/my/payouts`, { params });
  }

  getMyBankAccount(): Observable<{ accounts: BankAccount[] }> {
    return this.http.get<{ accounts: BankAccount[] }>(`${this.API}/my/bank-accounts`);
  }

  updateMyBankAccount(data: BankAccountUpdate): Observable<{ account: BankAccount }> {
    return this.http.put<{ account: BankAccount }>(`${this.API}/my/bank-accounts`, data);
  }

  // Admin
  getPayouts(period: string, status?: string): Observable<{ payouts: PayoutRecord[] }> {
    let params = new HttpParams().set('period', period);
    if (status) params = params.set('status', status);
    return this.http.get<{ payouts: PayoutRecord[] }>(`${this.API}/payouts`, { params });
  }

  markPaid(id: string, data: MarkPaidData): Observable<{ success: boolean; payout: PayoutRecord }> {
    return this.http.post<{ success: boolean; payout: PayoutRecord }>(`${this.API}/payouts/${id}/pay`, data);
  }
}
