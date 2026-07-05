import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ReviewRequest {
  id: string;
  order_id: string | null;
  chat_session_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  channel: string;
  status: 'pending' | 'sent' | 'clicked' | 'failed' | 'cancelled';
  source: string;
  created_at: string;
  sent_at: string | null;
  clicked_at: string | null;
  click_platform: string | null;
  nps_rating: number | null;
  error_message: string | null;
  employee_name: string | null;
  location_slug: string | null;
  review_token: string;
}

export interface NpsFeedItem {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  nps_rating: number;
  channel: string;
  click_platform: string | null;
  location_slug: string | null;
  employee_name: string | null;
  comment: string | null;
  created_at: string;
}

export interface ReviewDashboardStats {
  requests: {
    total: number;
    sent: number;
    clicked: number;
    sent7d: number;
    clicked7d: number;
    conversionRate: number;
  };
  platforms: { platform: string; review_count: number; rating: number; location_slug: string }[];
  nps: {
    total: number;
    average: number;
    distribution: Record<number, number>;
  };
}

@Injectable({ providedIn: 'root' })
export class ReviewsApiService {
  private readonly http = inject(HttpClient);

  getDashboardStats(): Observable<{ success: boolean; data: ReviewDashboardStats }> {
    return this.http.get<{ success: boolean; data: ReviewDashboardStats }>('/api/reviews/dashboard-stats');
  }

  getRequests(params: { status?: string; channel?: string; limit?: number; offset?: number } = {}): Observable<{ success: boolean; data: ReviewRequest[]; total: number }> {
    const p: Record<string, string> = {};
    if (params.status && params.status !== 'all') p['status'] = params.status;
    if (params.channel && params.channel !== 'all') p['channel'] = params.channel;
    if (params.limit) p['limit'] = String(params.limit);
    if (params.offset) p['offset'] = String(params.offset);
    return this.http.get<{ success: boolean; data: ReviewRequest[]; total: number }>('/api/reviews/requests', { params: p });
  }

  getNpsFeed(limit = 50): Observable<{ success: boolean; data: NpsFeedItem[] }> {
    return this.http.get<{ success: boolean; data: NpsFeedItem[] }>(`/api/reviews/nps-feed?limit=${limit}`);
  }

  resend(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/reviews/requests/${id}/resend`, {});
  }

  cancel(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/api/reviews/requests/${id}/cancel`, {});
  }
}
