import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import {
  AlertsQueryParams,
  BurnRateResponse,
  FleetAlert,
  JobsQueryParams,
  PrintJob,
  PrinterDetail,
  PrinterListItem,
  RefreshTelemetryResponse,
  ReplaceSupplyRequest,
  ReplaceSupplyResponse,
  TelemetryInterval,
  TelemetryTimeseriesResponse,
} from '../models/fleet.models';
import { DashboardSummary } from '../models/fleet-p1.models';

interface EnvelopeSuccess<T> { success: true; data: T }
interface EnvelopeRefresh extends RefreshTelemetryResponse { success: true }
interface EnvelopeReplace extends ReplaceSupplyResponse { success: true }

@Injectable({ providedIn: 'root' })
export class FleetApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/fleet';

  listPrinters(): Observable<PrinterListItem[]> {
    return this.http
      .get<EnvelopeSuccess<PrinterListItem[]>>(`${this.base}/printers`)
      .pipe(map(r => r.data));
  }

  getPrinter(id: string, include: ('telemetry' | 'alerts' | 'replacements' | 'jobs')[] = ['telemetry', 'alerts', 'replacements', 'jobs']): Observable<PrinterDetail> {
    const params = include.length > 0 ? new HttpParams().set('include', include.join(',')) : undefined;
    return this.http
      .get<EnvelopeSuccess<PrinterDetail>>(`${this.base}/printers/${id}`, { params })
      .pipe(map(r => r.data));
  }

  getTelemetry(id: string, interval: TelemetryInterval = 'raw', from?: string, to?: string): Observable<TelemetryTimeseriesResponse> {
    let params = new HttpParams().set('interval', interval);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http
      .get<EnvelopeSuccess<TelemetryTimeseriesResponse>>(`${this.base}/printers/${id}/telemetry`, { params })
      .pipe(map(r => r.data));
  }

  getJobs(id: string, query: JobsQueryParams = {}): Observable<PrintJob[]> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.limit) params = params.set('limit', String(query.limit));
    if (query.source) params = params.set('source', query.source);
    return this.http
      .get<EnvelopeSuccess<PrintJob[]>>(`${this.base}/printers/${id}/jobs`, { params })
      .pipe(map(r => r.data));
  }

  getAlerts(id: string, query: AlertsQueryParams = {}): Observable<FleetAlert[]> {
    let params = new HttpParams();
    if (query.active) params = params.set('active', query.active);
    if (query.since) params = params.set('since', query.since);
    return this.http
      .get<EnvelopeSuccess<FleetAlert[]>>(`${this.base}/printers/${id}/alerts`, { params })
      .pipe(map(r => r.data));
  }

  replaceSupply(id: string, body: ReplaceSupplyRequest): Observable<ReplaceSupplyResponse> {
    return this.http.post<EnvelopeReplace>(`${this.base}/printers/${id}/supplies/replace`, body)
      .pipe(map(r => ({ data: r.data, auto_resolved_alerts: r.auto_resolved_alerts })));
  }

  refreshTelemetry(id: string): Observable<RefreshTelemetryResponse> {
    return this.http.post<EnvelopeRefresh>(`${this.base}/printers/${id}/telemetry/refresh`, {})
      .pipe(map(r => ({ triggered: r.triggered, snapshot: r.snapshot, reason: r.reason })));
  }

  getBurnRate(id: string): Observable<BurnRateResponse> {
    return this.http
      .get<EnvelopeSuccess<BurnRateResponse>>(`${this.base}/printers/${id}/burn-rate`)
      .pipe(map(r => r.data));
  }

  getDashboardSummary(studioId?: string): Observable<DashboardSummary> {
    const params = studioId ? new HttpParams().set('studio_id', studioId) : undefined;
    return this.http
      .get<EnvelopeSuccess<DashboardSummary>>(`${this.base}/dashboard/summary`, params ? { params } : {})
      .pipe(map(r => r.data));
  }
}
