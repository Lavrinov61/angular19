import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// ─── Types ──────────────────────────────────────────────────────────

export interface KpiMetric {
  code: string;
  name: string;
  nameRu: string;
  category: string;
  unit: string;
  direction: 'higher_better' | 'lower_better';
  value: number;
  sampleSize: number;
  target: number | null;
  targetPct: number;
  trend: 'up' | 'down' | 'flat';
}

export interface CompositeScore {
  compositeScore: number;
  rating: 'exceptional' | 'good' | 'meeting' | 'below' | 'critical';
  categoryScores: Record<string, number>;
  weightsSnapshot: Record<string, number>;
}

export interface KpiDashboardResponse {
  metrics: KpiMetric[];
  compositeScore: CompositeScore;
  period: { type: string; start: string; end: string };
}

export interface KpiTrendPoint {
  date: string;
  value: number;
  target: number | null;
}

export interface KpiTrendResponse {
  metric: { code: string; nameRu: string; unit: string } | null;
  points: KpiTrendPoint[];
  comparison: { current: number; previous: number; changePct: number } | null;
}

export interface KpiHistoryEntry {
  periodStart: string;
  compositeScore: number;
  rating: string;
  categoryScores: Record<string, number>;
}

export interface KpiAlert {
  id: string;
  employeeId: string;
  employeeName: string;
  metricCode: string;
  alertType: string;
  severity: 'info' | 'warning' | 'critical';
  periodType: string;
  periodStart: string;
  currentValue: number;
  targetValue: number | null;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface TeamEmployee {
  id: string;
  displayName: string;
  photoUrl: string | null;
  role: string;
  compositeScore: number;
  rating: string;
  topMetric: { code: string; value: number } | null;
  weakestMetric: { code: string; value: number } | null;
  alertCount: number;
}

export interface TeamOverviewResponse {
  employees: TeamEmployee[];
  teamAverage: number;
  period: { type: string; start: string; end: string };
}

export interface LeaderboardEntry {
  rank: number;
  employeeId: string;
  displayName: string;
  photoUrl: string | null;
  value: number;
  rating?: string;
  target?: number | null;
}

export interface MetricDefinition {
  code: string;
  name: string;
  nameRu: string;
  category: string;
  unit: string;
  direction: string;
  defaultWeight: number;
  applicableRoles: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface KpiTarget {
  id: string;
  metric_code: string;
  scope: string;
  scope_value: string | null;
  target_value: number;
  stretch_value: number | null;
  minimum_value: number | null;
  effective_from: string;
  effective_until: string | null;
}

export interface WeightProfile {
  id: string;
  name: string;
  scope: string;
  scope_value: string | null;
  weights: Record<string, number>;
  is_active: boolean;
}

// ─── Service ────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class KpiApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/kpi';

  // ─── Employee self-view ─────────────────────────────────────────

  getMyDashboard(period = 'today'): Observable<KpiDashboardResponse> {
    return this.http.get<KpiDashboardResponse>(`${this.base}/my/dashboard`, { params: { period } });
  }

  getMyTrends(metric: string, period = 'daily', count = 30): Observable<KpiTrendResponse> {
    return this.http.get<KpiTrendResponse>(`${this.base}/my/trends`, {
      params: { metric, period, count: count.toString() },
    });
  }

  getMyHistory(periodType = 'weekly', from?: string, to?: string): Observable<{ compositeScores: KpiHistoryEntry[]; alerts: KpiAlert[] }> {
    const params: Record<string, string> = { periodType };
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.http.get<{ compositeScores: KpiHistoryEntry[]; alerts: KpiAlert[] }>(`${this.base}/my/history`, { params });
  }

  // ─── Team view ──────────────────────────────────────────────────

  getTeamOverview(period = 'month'): Observable<TeamOverviewResponse> {
    return this.http.get<TeamOverviewResponse>(`${this.base}/team/overview`, { params: { period } });
  }

  getTeamCompare(employeeIds: string[], metric: string, periodType = 'daily', count = 14): Observable<{
    metric: MetricDefinition | null;
    series: { employeeId: string; displayName: string; points: { date: string; value: number }[] }[];
  }> {
    return this.http.get<{
      metric: MetricDefinition | null;
      series: { employeeId: string; displayName: string; points: { date: string; value: number }[] }[];
    }>(`${this.base}/team/compare`, {
      params: { employeeIds: employeeIds.join(','), metric, periodType, count: count.toString() },
    });
  }

  getTeamLeaderboard(metric = 'composite', period = 'month'): Observable<{
    metric: string;
    entries: LeaderboardEntry[];
  }> {
    return this.http.get<{ metric: string; entries: LeaderboardEntry[] }>(
      `${this.base}/team/leaderboard`,
      { params: { metric, period } },
    );
  }

  getEmployeeDetail(id: string, period = 'month'): Observable<{
    employee: { id: string; displayName: string; role: string; photoUrl: string | null };
    metrics: KpiMetric[];
    compositeScore: CompositeScore;
    period: { type: string; start: string; end: string };
  }> {
    return this.http.get<{
      employee: { id: string; displayName: string; role: string; photoUrl: string | null };
      metrics: KpiMetric[];
      compositeScore: CompositeScore;
      period: { type: string; start: string; end: string };
    }>(`${this.base}/employee/${id}/detail`, { params: { period } });
  }

  // ─── Alerts ─────────────────────────────────────────────────────

  getAlerts(params?: { status?: string; severity?: string; limit?: number }): Observable<{ alerts: KpiAlert[] }> {
    const p: Record<string, string> = {};
    if (params?.status) p['status'] = params.status;
    if (params?.severity) p['severity'] = params.severity;
    if (params?.limit) p['limit'] = params.limit.toString();
    return this.http.get<{ alerts: KpiAlert[] }>(`${this.base}/alerts`, { params: p });
  }

  acknowledgeAlert(id: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/alerts/${id}/acknowledge`, {});
  }

  // ─── Admin ──────────────────────────────────────────────────────

  getAdminMetrics(): Observable<{ metrics: MetricDefinition[] }> {
    return this.http.get<{ metrics: MetricDefinition[] }>(`${this.base}/admin/metrics`);
  }

  updateAdminMetric(code: string, body: Partial<{ defaultWeight: number; isActive: boolean; applicableRoles: string[] }>): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/admin/metrics/${code}`, body);
  }

  getTargets(params?: { metricCode?: string; scope?: string }): Observable<{ targets: KpiTarget[] }> {
    return this.http.get<{ targets: KpiTarget[] }>(`${this.base}/admin/targets`, { params: params as Record<string, string> });
  }

  createTarget(body: {
    metricCode: string; scope: string; scopeValue?: string;
    targetValue: number; stretchValue?: number; minimumValue?: number;
    effectiveFrom: string; effectiveUntil?: string;
  }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/admin/targets`, body);
  }

  updateTarget(id: string, body: {
    targetValue?: number; stretchValue?: number | null; minimumValue?: number | null;
    effectiveFrom?: string; effectiveUntil?: string | null;
  }): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.base}/admin/targets/${id}`, body);
  }

  deleteTarget(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/admin/targets/${id}`);
  }

  getWeightProfiles(): Observable<{ profiles: WeightProfile[] }> {
    return this.http.get<{ profiles: WeightProfile[] }>(`${this.base}/admin/weight-profiles`);
  }

  updateWeightProfile(id: string, body: { weights: Record<string, number>; name?: string }): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.base}/admin/weight-profiles/${id}`, body);
  }
}
