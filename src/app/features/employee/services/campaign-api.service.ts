import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

// ── Types ──

export type CampaignType = 'flyer' | 'email' | 'social' | 'sms' | 'other';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface Campaign {
  id: number;
  name: string;
  type: CampaignType;
  channel: string | null;
  status: CampaignStatus;
  budget: string | null;
  spent: string | null;
  start_date: string | null;
  end_date: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  created_by: number | null;
  created_by_name: string | null;
  promo_codes: CampaignPromoCode[];
  created_at: string;
  updated_at: string;
}

export interface CampaignPromoCode {
  id: number;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  is_active: boolean;
  usage_count: number;
  max_uses: number | null;
}

export interface CampaignStats {
  total_redemptions: number;
  total_discount_amount: string;
  total_orders: number;
  total_revenue: string;
  roi: number | null;
}

export interface CampaignDetail extends Campaign {
  description: string | null;
  stats: CampaignStats;
}

export interface CampaignFilters {
  status?: CampaignStatus;
  type?: CampaignType;
  search?: string;
}

export interface CreateCampaignPayload {
  name: string;
  type: CampaignType;
  channel?: string;
  description?: string;
  budget?: number;
  start_date?: string;
  end_date?: string;
  utm_source?: string;
  utm_campaign?: string;
}

@Injectable({ providedIn: 'root' })
export class CampaignApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/campaigns';

  getCampaigns(filters: CampaignFilters = {}): Observable<Campaign[]> {
    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<{ success: boolean; data: Campaign[] }>(this.base, { params }).pipe(
      map(r => r.data),
    );
  }

  getCampaign(id: number): Observable<CampaignDetail> {
    return this.http.get<{ success: boolean; data: CampaignDetail }>(`${this.base}/${id}`).pipe(
      map(r => r.data),
    );
  }

  createCampaign(data: CreateCampaignPayload): Observable<Campaign> {
    return this.http.post<{ success: boolean; data: Campaign }>(this.base, data).pipe(
      map(r => r.data),
    );
  }

  updateStatus(id: number, status: CampaignStatus): Observable<void> {
    return this.http.patch<void>(`${this.base}/${id}/status`, { status });
  }
}
