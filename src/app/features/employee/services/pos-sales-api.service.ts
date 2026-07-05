import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SalesDashboard {
  receipts_count: number;
  total_sales: number;
  avg_receipt: number;
  total_commission: number;
  paid_invoices_count: number;
  paid_invoices_total: number;
  paid_invoices_avg: number;
  pending_links_count: number;
  pending_links_total: number;
  issued_invoices_count: number;
  issued_invoices_total: number;
}

@Injectable({ providedIn: 'root' })
export class PosSalesApiService {
  private readonly http = inject(HttpClient);

  getDashboard(date?: string): Observable<SalesDashboard> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return this.http.get<{ success: boolean; dashboard: SalesDashboard }>(
      '/api/pos/sales/dashboard', { params },
    ).pipe(map(r => r.dashboard));
  }
}
