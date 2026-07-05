import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaymentSummary {
  totalRevenue: number;
  orderCount: number;
  paidCount: number;
  failedCount: number;
  pendingCount: number;
  expiredCount: number;
  avgCheck: number;
  conversionRate: number;
  failureRate: number;
  refundCount: number;
  refundAmount: number;
}

export interface PaymentMethodBreakdown {
  method: string;
  count: number;
  amount: number;
}

export interface DailyRevenue {
  date: string;
  count: number;
  revenue: number;
}

export interface TopService {
  service: string;
  count: number;
  revenue: number;
}

@Injectable({ providedIn: 'root' })
export class PaymentAnalyticsApiService {
  private readonly http = inject(HttpClient);

  getSummary(period = '30d'): Observable<PaymentSummary> {
    return this.http.get<{ data: PaymentSummary }>(`/api/crm/payment-analytics/summary?period=${period}`).pipe(
      map(r => r.data),
    );
  }

  getByMethod(period = '30d'): Observable<PaymentMethodBreakdown[]> {
    return this.http.get<{ data: PaymentMethodBreakdown[] }>(`/api/crm/payment-analytics/by-method?period=${period}`).pipe(
      map(r => r.data),
    );
  }

  getDaily(period = '30d'): Observable<DailyRevenue[]> {
    return this.http.get<{ data: DailyRevenue[] }>(`/api/crm/payment-analytics/daily?period=${period}`).pipe(
      map(r => r.data),
    );
  }

  getTopServices(period = '30d'): Observable<TopService[]> {
    return this.http.get<{ data: TopService[] }>(`/api/crm/payment-analytics/top-services?period=${period}`).pipe(
      map(r => r.data),
    );
  }
}
