import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Опция ретуши. Исторически — массив строк, начиная с конфигуратора
 * «Супер обработки» — массив объектов {group, group_name, slug, label}.
 * Рендер ретушёра поддерживает оба формата (fallback opt.label ?? opt).
 */
export interface RetouchOptionObject {
  group?: string;
  group_name?: string;
  slug?: string;
  label?: string;
}
export type RetouchOption = string | RetouchOptionObject;

export interface RetouchTask {
  id: string;
  task_number: number;
  status: 'open' | 'assigned' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
  priority: string;
  retouch_level: 'basic' | 'extended' | 'maximum' | 'super';
  retouch_options: RetouchOption[];
  source_photo_url: string;
  result_photo_url: string | null;
  revision_count: number;
  assigned_to: string | null;
  retoucher_name: string | null;
  client_name: string | null;
  client_phone: string | null;
  order_id: string | null;
  approval_session_id: string | null;
  approval_token: string | null;
  approval_status: string | null;
  studio_name: string | null;
  due_date: string | null;
  started_at: string | null;
  created_at: string;
  title: string | null;
}

export interface RetouchDetail {
  task: RetouchTask;
  photos: { id: string; url: string; retouched_url?: string; status: string }[];
  history: { from_status: string; to_status: string; changed_by: string; reason?: string; created_at: string }[];
  feedback?: { comment: string; annotations?: unknown[] }[];
}

export interface RetouchStatsSummary {
  pending: number;
  in_progress: number;
  waiting_approval: number;
  completed: number;
  cancelled: number;
  avg_minutes: number | null;
  avg_revisions: number | null;
  active_retouchers: number;
}

export interface RetouchRetoucherStat {
  assigned_to: string;
  display_name: string;
  total: number;
  completed: number;
  avg_minutes: number | null;
}

export interface RetouchStats {
  summary: RetouchStatsSummary;
  retouchers: RetouchRetoucherStat[];
}

export interface RetouchPreset {
  id: string;
  name: string;
  description: string | null;
  retouch_level: 'basic' | 'extended' | 'maximum';
  retouch_options: string[];
  document_type: string | null;
  price: number | null;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class RetouchApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/retouch';

  getQueue(params?: { status?: string; assigned_to?: string; order_id?: string }): Observable<{ success: boolean; data: RetouchTask[] }> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          httpParams = httpParams.set(key, String(value));
        }
      });
    }
    return this.http.get<{ success: boolean; data: RetouchTask[] }>(`${this.baseUrl}/queue`, { params: httpParams });
  }

  getDetail(id: string): Observable<{ success: boolean; data: RetouchDetail }> {
    return this.http.get<{ success: boolean; data: RetouchDetail }>(`${this.baseUrl}/${id}`);
  }

  start(id: string): Observable<{ success: boolean; data: RetouchTask }> {
    return this.http.post<{ success: boolean; data: RetouchTask }>(`${this.baseUrl}/${id}/start`, {});
  }

  uploadResult(id: string, s3Key: string, notes?: string): Observable<{ success: boolean; data: RetouchTask }> {
    return this.http.post<{ success: boolean; data: RetouchTask }>(`${this.baseUrl}/${id}/upload-result`, { s3_key: s3Key, notes });
  }

  sendForApproval(id: string): Observable<{ success: boolean; data: RetouchTask }> {
    return this.http.post<{ success: boolean; data: RetouchTask }>(`${this.baseUrl}/${id}/send-for-approval`, {});
  }

  getStats(studioId?: string): Observable<{ success: boolean; data: RetouchStats }> {
    let params = new HttpParams();
    if (studioId) {
      params = params.set('studio_id', studioId);
    }
    return this.http.get<{ success: boolean; data: RetouchStats }>(`${this.baseUrl}/stats`, { params });
  }

  bulkAssign(taskIds: string[], retoucherId: string): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.baseUrl}/bulk/assign`, { task_ids: taskIds, retoucher_id: retoucherId });
  }

  bulkCancel(taskIds: string[]): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.baseUrl}/bulk/cancel`, { task_ids: taskIds });
  }

  bulkReassign(taskIds: string[], retoucherId: string): Observable<{ success: boolean; affected: number }> {
    return this.http.post<{ success: boolean; affected: number }>(`${this.baseUrl}/bulk/reassign`, { task_ids: taskIds, retoucher_id: retoucherId });
  }

  getPresets(documentType?: string): Observable<{ success: boolean; data: RetouchPreset[] }> {
    let params = new HttpParams();
    if (documentType) {
      params = params.set('document_type', documentType);
    }
    return this.http.get<{ success: boolean; data: RetouchPreset[] }>(`${this.baseUrl}/presets`, { params });
  }
}
