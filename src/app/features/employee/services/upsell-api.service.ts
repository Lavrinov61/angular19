import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from '../../../core/services/api.service';

export interface BonusTier {
  pct: number;
  threshold: number;
  bonus_amount: number;
}

export interface QuarterlyTier {
  avg_check: number;
  threshold: number;
  bonus_amount: number;
}

export interface TeamTier {
  revenue: number;
  target: number;
  bonus_amount: number;
}

export interface UpsellStats {
  total_offers: number;
  accepted: number;
  conversion_pct: number;
  avg_check: number;
  streak_current: number;
  streak_best: number;
  bonus_progress: {
    conversion: BonusTier;
    quarterly: QuarterlyTier;
    team: TeamTier;
  };
}

export interface StreakDay {
  date: string;
  had_upsell: boolean;
}

export interface UpsellStreak {
  current: number;
  best: number;
  days: StreakDay[];
}

export interface StudioRevenue {
  total: number;
  target: number;
  bonus_if_reached: number;
}

export type UpsellItem = 'retouch' | 'portrait' | 'combo' | 'print' | 'frame';

@Injectable({ providedIn: 'root' })
export class UpsellApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/upsell';

  getMyStats(month: string): Observable<ApiResponse<UpsellStats>> {
    return this.http.get<ApiResponse<UpsellStats>>(`${this.baseUrl}/my/stats`, {
      params: new HttpParams().set('month', month),
    });
  }

  logUpsellOffer(data: {
    order_id?: string;
    offered_items: UpsellItem[];
    accepted: boolean;
  }): Observable<ApiResponse<{ id: string }>> {
    return this.http.post<ApiResponse<{ id: string }>>(`${this.baseUrl}/my/offer`, data);
  }

  getMyStreak(month: string): Observable<ApiResponse<UpsellStreak>> {
    return this.http.get<ApiResponse<UpsellStreak>>(`${this.baseUrl}/my/streak`, {
      params: new HttpParams().set('month', month),
    });
  }

  getStudioRevenue(month: string): Observable<ApiResponse<StudioRevenue>> {
    return this.http.get<ApiResponse<StudioRevenue>>(`${this.baseUrl}/studio/revenue`, {
      params: new HttpParams().set('month', month),
    });
  }
}
