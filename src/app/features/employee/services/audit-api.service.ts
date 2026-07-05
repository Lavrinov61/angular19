import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface AuditResponse {
  success: boolean;
  data: AuditEntry[];
  total: number;
}

export interface AuditFilters {
  userId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(HttpClient);

  getAuditLog(filters: AuditFilters): Observable<{ items: AuditEntry[]; total: number }> {
    let params = new HttpParams();
    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.action) params = params.set('action', filters.action);
    if (filters.entityType) params = params.set('entityType', filters.entityType);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.limit) params = params.set('limit', String(filters.limit));
    if (filters.offset) params = params.set('offset', String(filters.offset));

    return this.http.get<AuditResponse>('/api/crm/audit', { params }).pipe(
      map(res => ({ items: res.data, total: res.total }))
    );
  }
}
