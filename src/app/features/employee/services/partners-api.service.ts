import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Partner {
  id: number;
  user_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  type: 'referral' | 'business' | 'affiliate' | 'promoter' | 'agent' | 'online';
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
  commission_rate: string;
  balance: string;
  total_earned: string;
  promo_code: string | null;
  referral_url: string | null;
  payout_details: Record<string, unknown>;
  notes: string | null;
  user_name?: string;
  approved_by_name?: string;
  referral_count?: number;
  paid_out?: string;
  created_at: string;
  updated_at: string;
}

export interface PartnerReferral {
  id: number;
  partner_id: number;
  order_id: number | null;
  order_type: string;
  order_amount: string;
  commission_amount: string;
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
  promo_code: string | null;
  client_phone: string | null;
  created_at: string;
}

export interface PartnerPayout {
  id: number;
  partner_id: number;
  amount: string;
  method: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  processed_by_name?: string;
  processed_at: string | null;
  created_at: string;
}

export interface CommissionRule {
  id: number;
  partner_id: number;
  service_category_slug: string | null;
  order_type: string | null;
  commission_percent: string | null;
  commission_fixed: string | null;
  min_order_amount: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CommissionRulePayload {
  service_category_slug?: string | null;
  order_type?: string | null;
  commission_percent?: number | null;
  commission_fixed?: number | null;
  min_order_amount?: number;
  is_active?: boolean;
  priority?: number;
}

@Injectable({ providedIn: 'root' })
export class PartnersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/partners';

  list(params: { status?: string; type?: string; search?: string } = {}): Observable<{ data: Partner[]; total: number }> {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.type) q.set('type', params.type);
    if (params.search) q.set('search', params.search);
    const qs = q.toString() ? `?${q}` : '';
    return this.http.get<{ success: boolean; data: Partner[]; total: number }>(`${this.base}/${qs}`).pipe(
      map(r => ({ data: r.data, total: r.total })),
    );
  }

  get(id: number): Observable<Partner> {
    return this.http.get<{ success: boolean; data: Partner }>(`${this.base}/${id}`).pipe(map(r => r.data));
  }

  create(data: Partial<Omit<Partner, 'commission_rate'>> & { commission_rate?: number }): Observable<Partner> {
    return this.http.post<{ success: boolean; data: Partner }>(this.base, data).pipe(map(r => r.data));
  }

  update(id: number, data: Partial<Omit<Partner, 'commission_rate'>> & { commission_rate?: number }): Observable<Partner> {
    return this.http.patch<{ success: boolean; data: Partner }>(`${this.base}/${id}`, data).pipe(map(r => r.data));
  }

  approve(id: number, status: 'approved' | 'suspended' | 'rejected'): Observable<Partner> {
    return this.http.post<{ success: boolean; data: Partner }>(`${this.base}/${id}/approve`, { status }).pipe(map(r => r.data));
  }

  getReferrals(id: number): Observable<{ data: PartnerReferral[]; total: number; total_commission: string }> {
    return this.http.get<{ success: boolean; data: PartnerReferral[]; total: number; total_commission: string }>(
      `${this.base}/${id}/referrals`,
    ).pipe(map(r => ({ data: r.data, total: r.total, total_commission: r.total_commission })));
  }

  getPayouts(id: number): Observable<PartnerPayout[]> {
    return this.http.get<{ success: boolean; data: PartnerPayout[] }>(`${this.base}/${id}/payouts`).pipe(map(r => r.data));
  }

  createPayout(id: number, amount: number, method: string): Observable<{ id: number }> {
    return this.http.post<{ success: boolean; data: { id: number } }>(
      `${this.base}/${id}/payouts`, { amount, method },
    ).pipe(map(r => r.data));
  }

  processPayout(payoutId: number, status: 'completed' | 'failed' | 'cancelled'): Observable<void> {
    return this.http.patch<void>(`${this.base}/payouts/${payoutId}`, { status });
  }

  // Commission Rules
  getCommissionRules(partnerId: number): Observable<CommissionRule[]> {
    return this.http.get<{ success: boolean; data: CommissionRule[] }>(
      `${this.base}/${partnerId}/commission-rules`,
    ).pipe(map(r => r.data));
  }

  createCommissionRule(partnerId: number, data: CommissionRulePayload): Observable<CommissionRule> {
    return this.http.post<{ success: boolean; data: CommissionRule }>(
      `${this.base}/${partnerId}/commission-rules`, data,
    ).pipe(map(r => r.data));
  }

  updateCommissionRule(partnerId: number, ruleId: number, data: CommissionRulePayload): Observable<CommissionRule> {
    return this.http.patch<{ success: boolean; data: CommissionRule }>(
      `${this.base}/${partnerId}/commission-rules/${ruleId}`, data,
    ).pipe(map(r => r.data));
  }

  deleteCommissionRule(partnerId: number, ruleId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partnerId}/commission-rules/${ruleId}`);
  }
}
