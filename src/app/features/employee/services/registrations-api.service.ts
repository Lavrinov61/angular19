import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface UtmSourceBucket {
  source: string;
  count: number;
}

export interface RegistrationSummary {
  totalUsers: number;
  newInPeriod: number;
  previousPeriodNew: number;
  clients: number;
  staff: number;
  viaYandex: number;
  viaTelegram: number;
  viaGoogle: number;
  viaApple: number;
  viaVk: number;
  viaSber: number;
  viaMts: number;
  viaPhone: number;
  viaEmail: number;
  viaEmailUnverified: number;
  emailVerified: number;
  hasPhone: number;
  conversionPct: number;
  avgDaysToConversion: number | null;
  repeatVisitors: number;
  topUtmSources: UtmSourceBucket[];
}

export interface DailyRegistration {
  day: string;
  count: number;
}

export interface RoleBreakdown {
  role: string;
  count: number;
}

export interface RegistrationStatsData {
  period: string;
  summary: RegistrationSummary;
  daily: DailyRegistration[];
  byRole: RoleBreakdown[];
}

export type AuthProvider =
  | 'yandex' | 'telegram' | 'google' | 'apple'
  | 'vk' | 'sber' | 'mts' | 'email' | 'phone';

export interface RecentRegistration {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  email_verified: boolean;
  phone_verified: boolean;
  is_active: boolean;
  auth_provider: AuthProvider;
  created_at: string;
  last_login_at?: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  has_order: boolean;
}

export interface RecentRegistrationsData {
  data: RecentRegistration[];
  total: number;
  page: number;
  limit: number;
}

export type RegFilterRole = 'client' | 'employee' | 'admin' | 'photographer';
export type RegFilterProvider = AuthProvider;

export interface RegFilters {
  role?: RegFilterRole | null;
  provider?: RegFilterProvider | null;
  search?: string | null;
  verified?: boolean | null;
  hasOrder?: boolean | null;
}

export type FunnelStageKey = 'registered' | 'emailVerified' | 'hasPhone' | 'hasOrder';

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  pct: number;
}

export interface FunnelData {
  period: string;
  stages: FunnelStage[];
}

@Injectable({ providedIn: 'root' })
export class RegistrationsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/crm/registrations';

  getStats(period: string): Observable<RegistrationStatsData> {
    const params = new HttpParams().set('period', period);
    return this.http
      .get<{ success: boolean } & RegistrationStatsData>(`${this.base}/stats`, { params })
      .pipe(map(r => ({ period: r.period, summary: r.summary, daily: r.daily, byRole: r.byRole })));
  }

  getRecent(
    period: string,
    page = 1,
    limit = 50,
    filters?: RegFilters,
  ): Observable<RecentRegistrationsData> {
    let params = new HttpParams()
      .set('period', period)
      .set('page', String(page))
      .set('limit', String(limit));
    if (filters?.role)     params = params.set('role', filters.role);
    if (filters?.provider) params = params.set('provider', filters.provider);
    if (filters?.search)   params = params.set('search', filters.search);
    if (filters?.verified !== null && filters?.verified !== undefined) {
      params = params.set('verified', String(filters.verified));
    }
    if (filters?.hasOrder !== null && filters?.hasOrder !== undefined) {
      params = params.set('hasOrder', String(filters.hasOrder));
    }
    return this.http
      .get<{ success: boolean } & RecentRegistrationsData>(`${this.base}/recent`, { params })
      .pipe(map(r => ({ data: r.data, total: r.total, page: r.page, limit: r.limit })));
  }

  getFunnel(period: string): Observable<FunnelData> {
    const params = new HttpParams().set('period', period);
    return this.http
      .get<{ success: boolean; period: string; stages: FunnelStage[] }>(`${this.base}/funnel`, { params })
      .pipe(map(r => ({ period: r.period, stages: r.stages })));
  }
}
