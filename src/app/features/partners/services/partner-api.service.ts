import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PartnerProfile {
  id: number;
  user_id: string;
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
  inn: string | null;
  self_employed_status: 'not_checked' | 'pending' | 'verified' | 'rejected';
  self_employed_verified_at: string | null;
  created_at: string;
}

export interface PartnerReferral {
  id: number;
  partner_id: number;
  order_id: number | null;
  order_type: string;
  order_amount: string;
  commission_amount: string;
  promo_code: string | null;
  client_phone: string | null;
  status: string;
  created_at: string;
}

export interface PartnerPayout {
  id: number;
  partner_id: number;
  amount: string;
  method: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  processed_at: string | null;
  created_at: string;
  processed_by_name: string | null;
}

export interface MonthlyStats {
  month: string;
  referral_count: string;
  total_amount: string;
  total_commission: string;
}

@Injectable({ providedIn: 'root' })
export class PartnerApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/partner';

  getProfile(): Observable<PartnerProfile> {
    return this.http.get<{ data: PartnerProfile }>(`${this.base}/me`).pipe(map(r => r.data));
  }

  register(type: PartnerProfile['type'], inn?: string): Observable<PartnerProfile> {
    return this.http.post<{ data: PartnerProfile }>(`${this.base}/register`, { type, ...(inn && { inn }) }).pipe(map(r => r.data));
  }

  verifyInn(inn: string): Observable<{ self_employed_status: string; message: string }> {
    return this.http.post<{ data: { self_employed_status: string; message: string } }>(
      `${this.base}/me/verify-inn`, { inn }
    ).pipe(map(r => r.data));
  }

  getReferrals(limit = 20, offset = 0): Observable<{ data: PartnerReferral[]; total: number; total_commission: string }> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ data: PartnerReferral[]; total: number; total_commission: string }>(`${this.base}/me/referrals`, { params });
  }

  getPayouts(): Observable<PartnerPayout[]> {
    return this.http.get<{ data: PartnerPayout[] }>(`${this.base}/me/payouts`).pipe(map(r => r.data));
  }

  requestPayout(amount: number, method: string): Observable<{ id: number }> {
    return this.http.post<{ data: { id: number } }>(`${this.base}/me/payouts`, { amount, method }).pipe(map(r => r.data));
  }

  updateProfile(payoutDetails: Record<string, unknown>): Observable<PartnerProfile> {
    return this.http.patch<{ data: PartnerProfile }>(`${this.base}/me/profile`, { payout_details: payoutDetails }).pipe(map(r => r.data));
  }

  getStats(): Observable<MonthlyStats[]> {
    return this.http.get<{ data: MonthlyStats[] }>(`${this.base}/me/stats`).pipe(map(r => r.data));
  }

  // ПЛАН 8: новые методы

  regeneratePromo(): Observable<{ promo_code: string; referral_url: string }> {
    return this.http.post<{ data: { promo_code: string; referral_url: string } }>(
      `${this.base}/me/regenerate-promo`, {}
    ).pipe(map(r => r.data));
  }

  getLandingLinks(): Observable<{ title: string; url: string }[]> {
    return this.http.get<{ data: { title: string; url: string }[] }>(
      `${this.base}/me/landing-links`
    ).pipe(map(r => r.data));
  }

  verifyBank(method: string, details: Record<string, unknown>): Observable<PartnerProfile> {
    return this.http.post<{ data: PartnerProfile }>(
      `${this.base}/me/verify-bank`, { method, details }
    ).pipe(map(r => r.data));
  }
}
