import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type TriggerType = 'order_paid' | 'chat_created' | 'chat_closed' | 'booking_completed' | 'manual';
export type ActionType = 'create_task' | 'notify_team' | 'send_email' | 'add_note' | 'set_tag';
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with';

export interface WorkflowCondition {
  field: string;
  op: ConditionOp;
  value: string | number;
}

export interface WorkflowAction {
  type: ActionType;
  params: Record<string, unknown>;
  delay_seconds: number;
}

export interface Workflow {
  id: number;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
  total_runs?: number;
  success_runs?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  trigger_data: Record<string, unknown>;
  result: unknown[];
  error_message: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class WorkflowsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/workflows';

  list(params: { is_active?: boolean; trigger_type?: string } = {}): Observable<Workflow[]> {
    const q = new URLSearchParams();
    if (params.is_active !== undefined) q.set('is_active', String(params.is_active));
    if (params.trigger_type) q.set('trigger_type', params.trigger_type);
    const qs = q.toString() ? `?${q}` : '';
    return this.http.get<{ success: boolean; data: Workflow[] }>(`${this.base}/${qs}`).pipe(
      map(r => r.data),
    );
  }

  get(id: number): Observable<Workflow> {
    return this.http.get<{ success: boolean; data: Workflow }>(`${this.base}/${id}`).pipe(
      map(r => r.data),
    );
  }

  create(data: Omit<Workflow, 'id' | 'run_count' | 'last_run_at' | 'total_runs' | 'success_runs' | 'created_by_name' | 'created_at' | 'updated_at'>): Observable<Workflow> {
    return this.http.post<{ success: boolean; data: Workflow }>(this.base, data).pipe(map(r => r.data));
  }

  update(id: number, data: Partial<Workflow>): Observable<Workflow> {
    return this.http.patch<{ success: boolean; data: Workflow }>(`${this.base}/${id}`, data).pipe(map(r => r.data));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  run(id: number, payload: Record<string, unknown> = {}): Observable<{ message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.base}/${id}/run`, payload).pipe(
      map(r => ({ message: r.message })),
    );
  }

  getRuns(id: number, limit = 50): Observable<{ data: WorkflowRun[]; total: number }> {
    return this.http.get<{ success: boolean; data: WorkflowRun[]; total: number }>(
      `${this.base}/${id}/runs?limit=${limit}`,
    ).pipe(map(r => ({ data: r.data, total: r.total })));
  }
}
