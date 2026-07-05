import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface FunnelStep {
  id: number;
  label: string;
  value: number;
}

export interface FunnelData {
  type: 'online' | 'studio';
  period: string;
  steps: FunnelStep[];
}

export interface CohortPeriod {
  offset: number;
  retained: number;
  rate: number;
}

export interface CohortRow {
  cohort: string;
  cohortSize: number;
  periods: CohortPeriod[];
}

export interface CohortData {
  groupBy: 'week' | 'month';
  period: string;
  cohorts: CohortRow[];
}

export interface RetentionBucket {
  period: string;
  returned: number;
  rate: number;
}

export interface RetentionData {
  period: string;
  totalCustomers: number;
  chatToOrderRate: number;
  retention: RetentionBucket[];
}

export interface ChannelStat {
  channel: string;
  sessions: number;
  orders: number;
  revenue: number;
  conversionRate: number;
  avgCsat: number | null;
}

export interface ChannelData {
  period: string;
  onlineChannels: ChannelStat[];
  posTotal: { receipts: number; revenue: number };
}

export interface RevenueChannelRow {
  channel: string;
  orders: number;
  revenue: number;
  avgCheck: number;
  share: number;
}

export interface PosStudioRow {
  studio: string;
  count: number;
  revenue: number;
}

export interface RevenueAttributionData {
  period: string;
  channels: RevenueChannelRow[];
  posStudios: PosStudioRow[];
  totalRevenue: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  private http = inject(HttpClient);
  private base = '/api/crm/analytics';

  getFunnel(type: 'online' | 'studio', period: string): Observable<FunnelData> {
    const params = new HttpParams().set('type', type).set('period', period);
    return this.http.get<{ success: boolean } & FunnelData>(`${this.base}/funnel`, { params })
      .pipe(map(r => ({ type: r.type, period: r.period, steps: r.steps })));
  }

  getCohorts(groupBy: 'week' | 'month', period: string): Observable<CohortData> {
    const params = new HttpParams().set('groupBy', groupBy).set('period', period);
    return this.http.get<{ success: boolean } & CohortData>(`${this.base}/cohorts`, { params })
      .pipe(map(r => ({ groupBy: r.groupBy, period: r.period, cohorts: r.cohorts })));
  }

  getRetention(period: string): Observable<RetentionData> {
    const params = new HttpParams().set('period', period);
    return this.http.get<{ success: boolean } & RetentionData>(`${this.base}/retention`, { params })
      .pipe(map(r => ({
        period:         r.period,
        totalCustomers: r.totalCustomers,
        chatToOrderRate: r.chatToOrderRate,
        retention:      r.retention,
      })));
  }

  getChannels(period: string): Observable<ChannelData> {
    const params = new HttpParams().set('period', period);
    return this.http.get<{ success: boolean } & ChannelData>(`${this.base}/channels`, { params })
      .pipe(map(r => ({
        period:         r.period,
        onlineChannels: r.onlineChannels,
        posTotal:       r.posTotal,
      })));
  }

  getRevenueAttribution(period: string): Observable<RevenueAttributionData> {
    const params = new HttpParams().set('period', period);
    return this.http.get<{ success: boolean; data: RevenueAttributionData }>(
      `${this.base}/revenue-attribution`, { params },
    ).pipe(map(r => r.data));
  }
}
