import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ReplaySession {
  id: string;
  visitor_id: string;
  user_id: string | null;
  landing_page: string | null;
  device_type: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  total_pages: number;
  total_clicks: number;
  chunk_count: number;
  has_error: boolean;
  is_complete: boolean;
  user_name?: string | null;
  user_phone?: string | null;
  user_agent?: string | null;
  screen_width?: number | null;
  screen_height?: number | null;
}

export interface ReplayChunk {
  chunk_index: number;
  events: unknown[];
  event_count: number;
  start_time: number | null;
  end_time: number | null;
}

export interface TimelineItem {
  event_type: string;
  page_path: string | null;
  page_title: string | null;
  element_text: string | null;
  click_x: number | null;
  click_y: number | null;
  timestamp: string;
  time_on_page_ms: number | null;
}

export interface HeatmapClick {
  nx: number;  // нормализованная x (0–1000)
  ny: number;  // нормализованная y (0–1000)
  count: number;
  page_path: string;
}

export interface HeatmapPage {
  page_path: string;
  total_clicks: number;
}

export interface FunnelStep {
  step: string;
  visitors: number;
}

export interface TopPage {
  page_path: string;
  visits: number;
  unique_visitors: number;
  avg_time_sec: number | null;
  bounce_rate: number;
}

export interface ReplayStats {
  total_sessions: number;
  avg_duration: number;
  error_sessions: number;
  desktop_count: number;
  mobile_count: number;
  tablet_count: number;
  unique_visitors: number;
}

@Injectable({ providedIn: 'root' })
export class ReplayApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/replay';

  // ─── Stats ──────────────────────────────────────────────────────────────────

  getStats(days = 30): Observable<ReplayStats> {
    return this.http.get<{ success: boolean; data: ReplayStats }>(
      `${this.base}/stats`, { params: { days: String(days) } }
    ).pipe(map(r => r.data));
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  getSessions(options: {
    phone?: string;
    visitor_id?: string;
    user_id?: string;
    days?: number;
    device_type?: string;
    page?: number;
    limit?: number;
    has_error?: boolean;
    min_duration?: number;
    landing_page?: string;
    sort?: 'started_at' | 'duration_seconds' | 'total_clicks';
    sort_dir?: 'asc' | 'desc';
  } = {}): Observable<{ data: ReplaySession[]; pagination: { total: number; pages: number } }> {
    let params = new HttpParams();
    if (options.phone)        params = params.set('phone', options.phone);
    if (options.visitor_id)   params = params.set('visitor_id', options.visitor_id);
    if (options.user_id)      params = params.set('user_id', options.user_id);
    if (options.days)         params = params.set('days', String(options.days));
    if (options.device_type)  params = params.set('device_type', options.device_type);
    if (options.page)         params = params.set('page', String(options.page));
    if (options.limit)        params = params.set('limit', String(options.limit));
    if (options.has_error != null) params = params.set('has_error', String(options.has_error));
    if (options.min_duration) params = params.set('min_duration', String(options.min_duration));
    if (options.landing_page) params = params.set('landing_page', options.landing_page);
    if (options.sort)         params = params.set('sort', options.sort);
    if (options.sort_dir)     params = params.set('sort_dir', options.sort_dir);

    return this.http.get<{ success: boolean; data: ReplaySession[]; pagination: { total: number; pages: number } }>(
      `${this.base}/sessions`, { params }
    ).pipe(map(r => ({ data: r.data, pagination: r.pagination })));
  }

  getSessionDetails(id: string): Observable<ReplaySession & { event_summary: { event_type: string; count: number }[] }> {
    return this.http.get<{ success: boolean; data: ReplaySession & { event_summary: { event_type: string; count: number }[] } }>(`${this.base}/sessions/${id}`)
      .pipe(map(r => r.data));
  }

  getSessionChunks(id: string): Observable<{ chunks: ReplayChunk[]; timeline: TimelineItem[] }> {
    return this.http.get<{ success: boolean; data: { chunks: ReplayChunk[]; timeline: TimelineItem[] } }>(`${this.base}/sessions/${id}/chunks`)
      .pipe(map(r => r.data));
  }

  // ─── Heatmap ─────────────────────────────────────────────────────────────────

  getHeatmapData(options: {
    page_path?: string;
    days?: number;
    device_type?: string;
    visitor_id?: string;
  } = {}): Observable<{ clicks: HeatmapClick[]; pages: HeatmapPage[] }> {
    let params = new HttpParams();
    if (options.page_path)  params = params.set('page_path', options.page_path);
    if (options.days)       params = params.set('days', String(options.days));
    if (options.device_type) params = params.set('device_type', options.device_type);
    if (options.visitor_id) params = params.set('visitor_id', options.visitor_id);

    return this.http.get<{ success: boolean; data: { clicks: HeatmapClick[]; pages: HeatmapPage[] } }>(`${this.base}/heatmap`, { params })
      .pipe(map(r => r.data));
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────

  getFunnelData(days = 30): Observable<FunnelStep[]> {
    return this.http.get<{ success: boolean; data: FunnelStep[] }>(
      `${this.base}/analytics/funnel`, { params: { days: String(days) } }
    ).pipe(map(r => r.data));
  }

  getTopPages(days = 30): Observable<TopPage[]> {
    return this.http.get<{ success: boolean; data: TopPage[] }>(
      `${this.base}/analytics/top-pages`, { params: { days: String(days) } }
    ).pipe(map(r => r.data));
  }
}
