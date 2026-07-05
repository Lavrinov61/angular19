import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { LowStockItem } from './pos-api.service';

export interface InventoryReceipt {
  id: string;
  employee_id: string;
  employee_name: string;
  studio_id: string;
  studio_name: string;
  supplier: string | null;
  invoice_number: string | null;
  items: ReceiveItemPayload[];
  total_items: number;
  notes: string | null;
  received_at: string;
}

export interface ReceiveItemPayload {
  product_id: string;
  product_name?: string;
  quantity: number;
  condition: 'good' | 'damaged';
  notes?: string;
}

export interface StockItem {
  id: string;
  product_id: string;
  product_name: string;
  studio_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
  estimated_ink_ml?: number | null;
  last_refill_at?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/inventory';

  receiveItems(data: {
    studio_id: string;
    supplier?: string;
    invoice_number?: string;
    items: ReceiveItemPayload[];
    notes?: string;
  }): Observable<void> {
    return this.http.post<void>(`${this.base}/receive`, data);
  }

  getReceipts(params?: {
    studio_id?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Observable<{ receipts: InventoryReceipt[]; total: number }> {
    const qp: Record<string, string> = {};
    if (params?.studio_id) qp['studio_id'] = params.studio_id;
    if (params?.date_from) qp['date_from'] = params.date_from;
    if (params?.date_to) qp['date_to'] = params.date_to;
    if (params?.limit) qp['limit'] = String(params.limit);
    if (params?.offset) qp['offset'] = String(params.offset);
    return this.http.get<{ success: boolean; receipts: InventoryReceipt[]; total: number }>(
      `${this.base}/receipts`, { params: qp }
    ).pipe(map(r => ({ receipts: r.receipts, total: r.total })));
  }

  getReceiptById(id: string): Observable<InventoryReceipt> {
    return this.http.get<{ success: boolean; receipt: InventoryReceipt }>(
      `${this.base}/receipts/${id}`
    ).pipe(map(r => r.receipt));
  }

  getLowStock(studioId: string): Observable<LowStockItem[]> {
    return this.http.get<{ success: boolean; items: LowStockItem[] }>(
      `${this.base}/low-stock/${studioId}`
    ).pipe(map(r => r.items));
  }

  setMinStock(productId: string, studioId: string, minQuantity: number): Observable<void> {
    return this.http.put<void>(`${this.base}/stock/${productId}/min`, { studio_id: studioId, min_quantity: minQuantity });
  }

  getStock(studioId: string): Observable<StockItem[]> {
    return this.http.get<{ success: boolean; stock: StockItem[] }>(
      `/api/catalog/stock/${studioId}`
    ).pipe(map(r => r.stock));
  }
}
