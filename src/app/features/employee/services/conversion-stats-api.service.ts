import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface ConversionStatsData {
  summary: {
    totalChats: number;
    totalOrders: number;
    totalBookings: number;
    totalRevenue: number;
    conversionRate: number;
    avgCheck: number;
  };
  daily: {
    day: string;
    chats: number;
    orders: number;
    bookings: number;
    revenue: number;
  }[];
  byChannel: {
    channel: string;
    chats: number;
    orders: number;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ConversionStatsApiService {
  private readonly http = inject(HttpClient);

  getStats(period: string): Observable<ConversionStatsData> {
    return this.http.get<{ success: boolean; data: ConversionStatsData }>(
      `/api/crm/inbox/conversion-stats?period=${period}`
    ).pipe(map(res => res.data));
  }
}
