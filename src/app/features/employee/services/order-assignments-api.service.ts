import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface OrderAssignment {
  id: string;
  order_id: string;
  order_type: 'print' | 'retouch' | 'photo' | 'marketplace' | 'scan' | 'design' | 'other';
  order_summary: string | null;
  source: 'online' | 'pos' | 'chat' | 'phone' | 'walk_in';
  studio_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  deadline_at: string | null;
  estimated_minutes: number | null;
  status: 'pending' | 'in_progress' | 'help_needed' | 'completed' | 'cancelled';
  completed_at: string | null;
  help_request: string | null;
  help_requested_at: string | null;
  helpers: string[];
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  studio_name?: string;
}

@Injectable({ providedIn: 'root' })
export class OrderAssignmentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/orders/assignments';

  getPending(studioId?: string): Observable<OrderAssignment[]> {
    const params: Record<string, string> = {};
    if (studioId) params['studio_id'] = studioId;
    return this.http.get<{ success: boolean; orders: OrderAssignment[] }>(
      `${this.base}/pending`, { params }
    ).pipe(map(r => r.orders));
  }

  getMy(): Observable<OrderAssignment[]> {
    return this.http.get<{ success: boolean; orders: OrderAssignment[] }>(
      `${this.base}/my`
    ).pipe(map(r => r.orders));
  }

  create(data: {
    order_id: string;
    order_type: OrderAssignment['order_type'];
    order_summary?: string;
    source?: OrderAssignment['source'];
    studio_id?: string;
    deadline_at?: string;
    estimated_minutes?: number;
    priority?: number;
    metadata?: Record<string, unknown>;
  }): Observable<OrderAssignment> {
    return this.http.post<{ success: boolean; assignment: OrderAssignment }>(
      this.base, data
    ).pipe(map(r => r.assignment));
  }

  take(assignmentId: string): Observable<OrderAssignment> {
    return this.http.post<{ success: boolean; assignment: OrderAssignment }>(
      `${this.base}/${assignmentId}/take`, {}
    ).pipe(map(r => r.assignment));
  }

  complete(assignmentId: string): Observable<OrderAssignment> {
    return this.http.post<{ success: boolean; assignment: OrderAssignment }>(
      `${this.base}/${assignmentId}/complete`, {}
    ).pipe(map(r => r.assignment));
  }

  requestHelp(assignmentId: string, message: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${assignmentId}/help`, { message });
  }

  join(assignmentId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${assignmentId}/join`, {});
  }

  cancel(assignmentId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${assignmentId}/cancel`, {});
  }
}
