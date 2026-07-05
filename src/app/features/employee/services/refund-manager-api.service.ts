import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RefundRequest {
  id: string;
  order_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment: string | null;
  created_at: string;
  resolved_at: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  order_amount: number;
  service_type: string;
  resolved_by_name: string | null;
}

export interface RefundStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

@Injectable({ providedIn: 'root' })
export class RefundManagerApiService {
  private readonly http = inject(HttpClient);

  getRefunds(status?: string): Observable<{ success: boolean; data: RefundRequest[]; total: number }> {
    const params: Record<string, string> = { limit: '100' };
    if (status && status !== 'all') params['status'] = status;
    return this.http.get<{ success: boolean; data: RefundRequest[]; total: number }>(
      '/api/crm/refund-requests', { params },
    );
  }

  getStats(): Observable<{ success: boolean; data: RefundStats }> {
    return this.http.get<{ success: boolean; data: RefundStats }>('/api/crm/refund-requests/stats');
  }

  resolve(id: string, action: 'approve' | 'reject', comment?: string): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`/api/crm/refund-requests/${id}`, { action, comment });
  }
}
