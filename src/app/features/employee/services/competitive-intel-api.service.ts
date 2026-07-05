import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface CompetitorPrice {
  id: string;
  competitor_id: string;
  competitor_name: string;
  competitor_slug: string;
  service_name: string;
  service_category: string;
  price_min: number | null;
  price_max: number | null;
  price_text: string;
  unit: string | null;
  notes: string | null;
  scraped_at: string;
  verified: boolean;
}

export interface CompetitorSummary {
  competitor_name: string;
  competitor_slug: string;
  total_prices: number;
  last_scraped: string | null;
  avg_price: number | null;
}

export interface CategoryPositioning {
  service_category: string;
  competitor_name: string;
  competitor_slug: string;
  min_price: number | null;
  avg_price: number | null;
  service_count: number;
}

export interface PriceHistoryEntry {
  id: string;
  competitor_id: string;
  service_name: string;
  service_category: string;
  old_price: number | null;
  new_price: number | null;
  change_pct: number | null;
  change_type: string;
  recorded_at: string;
}

export interface PriceTrendPoint {
  competitor_name: string;
  price: number | null;
  recorded_at: string;
}

export interface PriceAlert {
  id: string;
  competitor_id: string;
  competitor_name: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface ScrapeLog {
  id: string;
  source_slug: string;
  competitor_slug: string | null;
  status: string;
  pages_discovered: number;
  pages_scraped: number;
  items_found: number;
  prices_extracted: number;
  prices_saved: number;
  extraction_method: string | null;
  chrome_used: boolean;
  reqwest_used: boolean;
  errors: string[];
  duration_ms: number | null;
  created_at: string;
}

export interface ScrapeResult {
  source: string;
  pages_scraped: number;
  items_found: number;
  prices_saved: number;
}

@Injectable({ providedIn: 'root' })
export class CompetitiveIntelApiService {
  private http = inject(HttpClient);
  private base = '/api/kb';

  getAllPrices(): Observable<CompetitorPrice[]> {
    return this.http.get<CompetitorPrice[]>(`${this.base}/competitor-prices`);
  }

  getSummary(): Observable<CompetitorSummary[]> {
    return this.http.get<CompetitorSummary[]>(`${this.base}/competitor-prices/summary`);
  }

  getPositioning(): Observable<CategoryPositioning[]> {
    return this.http.get<CategoryPositioning[]>(`${this.base}/competitor-prices/positioning`);
  }

  compareByCategory(category: string): Observable<CompetitorPrice[]> {
    return this.http.get<CompetitorPrice[]>(`${this.base}/competitor-prices/compare/${category}`);
  }

  getHistory(slug: string, days = 90): Observable<PriceHistoryEntry[]> {
    const params = new HttpParams().set('days', days);
    return this.http.get<PriceHistoryEntry[]>(`${this.base}/competitor-prices/history/${slug}`, { params });
  }

  getTrends(category: string, days = 90): Observable<PriceTrendPoint[]> {
    const params = new HttpParams().set('days', days);
    return this.http.get<PriceTrendPoint[]>(`${this.base}/competitor-prices/trends/${category}`, { params });
  }

  getAlerts(params?: { alert_type?: string; severity?: string; is_read?: boolean }): Observable<PriceAlert[]> {
    let httpParams = new HttpParams();
    if (params?.alert_type) httpParams = httpParams.set('alert_type', params.alert_type);
    if (params?.severity) httpParams = httpParams.set('severity', params.severity);
    if (params?.is_read !== undefined) httpParams = httpParams.set('is_read', params.is_read);
    return this.http.get<PriceAlert[]>(`${this.base}/price-alerts`, { params: httpParams });
  }

  getUnreadAlertCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/price-alerts/unread-count`);
  }

  markAlertRead(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/price-alerts/${id}/read`, {});
  }

  markAllAlertsRead(): Observable<unknown> {
    return this.http.post(`${this.base}/price-alerts/read-all`, {});
  }

  triggerScrape(sourceSlug: string): Observable<ScrapeResult> {
    return this.http.post<ScrapeResult>(`${this.base}/competitor-prices/scrape/${sourceSlug}`, {});
  }

  triggerScrapeAll(): Observable<{ status: string; sources: number }> {
    return this.http.post<{ status: string; sources: number }>(`${this.base}/competitor-prices/scrape-all`, {});
  }

  importMarkdown(): Observable<{ total_imported: number; files: unknown[] }> {
    return this.http.post<{ total_imported: number; files: unknown[] }>(`${this.base}/competitor-prices/import-markdown`, {});
  }

  verifyPrice(id: string, data: { verified: boolean; price_min?: number }): Observable<unknown> {
    return this.http.patch(`${this.base}/competitor-prices/${id}/verify`, data);
  }

  getScrapeLogs(sourceSlug?: string): Observable<ScrapeLog[]> {
    let params = new HttpParams();
    if (sourceSlug) params = params.set('source_slug', sourceSlug);
    return this.http.get<ScrapeLog[]>(`${this.base}/scrape-logs`, { params });
  }
}
