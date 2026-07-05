import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import type { PhotoPrintOrder } from './orders-api.service';
import type { PaymentLink, ChannelType } from './payments.service';
import type { PosReceipt } from './pos-api.service';

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

interface SalesDashboardResponse {
  success: boolean;
  dashboard: SalesDashboard;
}

interface PaymentLinkDto extends Omit<PaymentLink, 'availableChannels'> {
  available_channels?: ChannelType[];
}

interface SalesHistoryResponse {
  success: boolean;
  receipts: PosReceipt[];
  links: PaymentLinkDto[];
  orders: PhotoPrintOrder[];
}

export interface SalesHistory {
  receipts: PosReceipt[];
  links: PaymentLink[];
  orders: PhotoPrintOrder[];
}

@Injectable({ providedIn: 'root' })
export class EmployeeSalesApiService {
  private readonly http = inject(HttpClient);

  getDashboard(date?: string): Observable<SalesDashboard | null> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    return this.http.get<SalesDashboardResponse>('/api/pos/sales/dashboard', { params }).pipe(
      map(res => res.success ? res.dashboard : null),
      catchError(() => of(null)),
    );
  }

  getHistory(query: {
    dateFrom: string;
    dateTo: string;
    limit?: number;
  }): Observable<SalesHistory> {
    let params = new HttpParams()
      .set('date_from', query.dateFrom)
      .set('date_to', query.dateTo);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));

    return this.http.get<SalesHistoryResponse>('/api/pos/sales/history', { params }).pipe(
      map((res) => ({
        receipts: res.receipts ?? [],
        links: this.mapLinks(res.links ?? []),
        orders: res.orders ?? [],
      })),
    );
  }

  private mapLinks(links: PaymentLinkDto[]): PaymentLink[] {
    return links.map((link) => {
      const { available_channels, ...rest } = link;
      return { ...rest, availableChannels: available_channels ?? [] };
    });
  }
}
